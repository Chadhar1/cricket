/* ===========================================================================
   cloud.js — Supabase layer: auth (email + Google), profiles, and Postgres
   sync for matches, teams, tournaments, events, friends, organiser
   applications, admin actions and live sharing.

   Every export is safe to call when Supabase is NOT configured. In that case
   `ready` stays false and calls quietly no-op, so the whole app keeps working
   as a local-only scorer. Schema + RLS policies live in supabase.sql — this
   file assumes that has already been run against your project.
   =========================================================================== */

import { supabaseConfig, isConfigured } from './supabase-config.js';

/* Supabase JS SDK, loaded straight from esm.sh as an ES module — no npm, no
   bundler. Pinned deliberately: an unpinned "latest" URL would be a silent
   breakage waiting to happen. */
const SDK_URL = 'https://esm.sh/@supabase/supabase-js@2.45.4';

let ready = false;
let sb = null;
let currentUser = null;
let currentSession = null;
let authCallbacks = [];

/* ---------------- init ---------------- */

export async function initCloud(){
  if(!isConfigured()) return false;
  try{
    const { createClient } = await import(SDK_URL);
    sb = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const { data: { session } } = await sb.auth.getSession();
    currentSession = session;
    currentUser = session ? session.user : null;

    sb.auth.onAuthStateChange((_event, session)=>{
      currentSession = session;
      currentUser = session ? session.user : null;
      authCallbacks.forEach(cb=>{ try{ cb(currentUser); }catch(e){ console.error(e); } });
    });

    ready = true;
    return true;
  }catch(err){
    console.error('Supabase init failed, running local-only:', err);
    ready = false;
    return false;
  }
}

export function cloudReady(){ return ready; }
export function getUser(){ return currentUser; }
export function onAuth(cb){
  authCallbacks.push(cb);
  if(ready) cb(currentUser);
  return ()=>{ authCallbacks = authCallbacks.filter(f=>f!==cb); };
}

/* No separate redirect-resume step needed — detectSessionInUrl above handles
   the OAuth return trip during initCloud(). Kept as a no-op so app.js's boot
   sequence (written against the Firebase version of this file) still works
   unchanged. */
export async function resumeRedirect(){ /* no-op under Supabase */ }

/* ---------------- auth: email ---------------- */

export async function signUpEmail(email, password, displayName){
  requireCloud();
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
  if(error) throw error;
  if(data.user){
    await sb.from('profiles').upsert({
      id: data.user.id, display_name: (displayName || '').trim(), avatar_id: 'helmet'
    });
  }
  return data.user;
}

export async function signInEmail(email, password){
  requireCloud();
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if(error) throw error;
  return data.user;
}

export async function sendReset(email){
  requireCloud();
  const { error } = await sb.auth.resetPasswordForEmail(email.trim());
  if(error) throw error;
}

export async function changeDisplayName(name){
  if(!ready || !currentUser) return;
  await sb.from('profiles').update({ display_name: name }).eq('id', currentUser.id);
}

/* ---------------- auth: Google ----------------
   For this to actually complete (not just open Google's screen and then
   silently fail to return a session), three separate places have to agree —
   this code can't fix any of them, they're dashboard config, not app code:

   1. Supabase dashboard -> Authentication -> Providers -> Google: enabled,
      with a Client ID + Client Secret from Google Cloud Console.
   2. Google Cloud Console -> the OAuth Client's "Authorized redirect URIs"
      must contain the *Supabase* callback URL
      (https://<project-ref>.supabase.co/auth/v1/callback) — NOT this app's
      own URL. Pointing it at the Vercel domain instead is the single most
      common way this breaks.
   3. Supabase dashboard -> Authentication -> URL Configuration: the app's
      real production URL (and any preview/staging URLs) must be in
      "Redirect URLs", and "Site URL" must not still be the localhost
      default — otherwise Supabase completes the Google side fine but then
      bounces the user somewhere that isn't this app.

   When any of the three is wrong, Supabase appends `error`/`error_description`
   to the URL it redirects back to instead of throwing anything this file's
   callers could catch — see readOAuthErrorFromUrl() in app.js, which reads
   those params on boot and turns them into the message the user actually
   sees on the sign-in screen. */

export async function signInGoogle(){
  requireCloud();
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if(error) throw error;
  // Supabase does a full-page redirect for OAuth; nothing more happens here.
}

export async function signOutUser(){
  if(!ready) return;
  await sb.auth.signOut();
}

/* Friendly text for the auth errors users actually hit. Supabase's AuthError
   carries a message but not the stable machine codes Firebase used, so this
   matches on message content instead. */
export function authErrorText(err){
  const msg = (err && err.message) || '';
  const m = msg.toLowerCase();
  if(m.includes('invalid login credentials')) return 'Email or password is incorrect.';
  if(m.includes('user already registered')) return 'That email already has an account. Try signing in.';
  if(m.includes('password should be at least')) return 'Password must be at least 6 characters.';
  if(m.includes('unable to validate email') || m.includes('invalid email')) return 'That email address does not look right.';
  if(m.includes('email not confirmed')) return 'Confirm your email first — check your inbox.';
  if(m.includes('rate limit')) return 'Too many attempts. Wait a minute and try again.';
  if(m.includes('network')) return 'Network problem. Check your connection.';
  if(m.includes('popup') || m.includes('redirect')) return 'Sign-in window was closed or blocked.';
  // Surfaces straight from Supabase when the Google provider isn't switched
  // on in the dashboard, or when the OAuth redirect URL isn't on the
  // project's allow-list — both are one-time dashboard config problems, not
  // something a retry fixes, so word it as a config error rather than a
  // generic failure (see cloud.js Google OAuth section for the checklist).
  if(m.includes('provider is not enabled') || m.includes('unsupported provider') || m.includes('requested path is invalid'))
    return 'Authentication configuration error. Please contact support.';
  if(m.includes('access_denied') || m.includes('cancelled') || m.includes('canceled')) return 'Google sign-in was cancelled.';
  return msg || 'Something went wrong.';
}

/* ---------------- profile ---------------- */
/* One `profiles` row per user covers both what used to be the private
   Firestore "users/{uid}" doc (display name, avatar) and the public
   "profiles/{uid}" doc (handle, bio, organiser/admin badges) — Postgres RLS
   makes that split unnecessary. */

export async function fetchProfile(){
  if(!ready || !currentUser) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  if(error){ console.error('fetchProfile failed:', error); return null; }
  return data ? toAppProfile(data) : null;
}

export async function saveProfile(profile){
  if(!ready || !currentUser) return false;
  const { error } = await sb.from('profiles').upsert({
    id: currentUser.id,
    display_name: profile.displayName || '',
    avatar_id: profile.avatarId || 'helmet',
    photo: profile.photo || null,
    country: profile.country || '',
    region: profile.region || '',
    district: profile.district || '',
    area: profile.area || ''
  });
  if(error){ console.error('saveProfile failed:', error); return false; }
  return true;
}

function toAppProfile(row){
  return {
    uid: row.id, handle: row.handle, displayName: row.display_name, avatarId: row.avatar_id,
    photo: row.photo || undefined,
    bio: row.bio, isOrganiser: row.is_organiser, isAdmin: row.is_admin, updatedAt: row.updated_at,
    country: row.country || '', region: row.region || '', district: row.district || '', area: row.area || '',
    points: row.points || 0, streakCurrent: row.streak_current || 0,
    streakLongest: row.streak_longest || 0, lastCheckin: row.last_checkin || null,
    // Self-reported playing identity — see supabase.sql's note on why these
    // are opinion fields, not derived stats.
    battingStyle: row.batting_style || '', bowlingStyle: row.bowling_style || '',
    primaryRole: row.primary_role || ''
  };
}

/* ---------------- public profile, handles, search ---------------- */

export async function fetchPublicProfile(uid){
  if(!ready) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if(error){ console.error('fetchPublicProfile failed:', error); return null; }
  return data ? toAppProfile(data) : null;
}

export async function fetchMyPublicProfile(){
  if(!ready || !currentUser) return null;
  return fetchPublicProfile(currentUser.id);
}

/* Claims/updates a handle. The table's UNIQUE constraint is the real
   uniqueness lock — a taken handle fails at the database (Postgres error
   23505), not merely in the app. */
export async function saveMyPublicProfile({ handle, displayName, avatarId, bio, battingStyle, bowlingStyle, primaryRole }){
  if(!ready || !currentUser) return { ok:false, error:'Not signed in.' };
  const { error } = await sb.from('profiles').upsert({
    id: currentUser.id, handle, display_name: displayName, avatar_id: avatarId, bio: bio || '',
    batting_style: battingStyle || '', bowling_style: bowlingStyle || '', primary_role: primaryRole || ''
  });
  if(error){
    console.error('saveMyPublicProfile failed:', error);
    if(error.code === '23505') return { ok:false, error:'That username was just taken — try another.' };
    return { ok:false, error:'Could not save your profile.' };
  }
  return { ok:true };
}

/* Matches on @handle (prefix, e.g. "har" -> "haris_23") OR display name
   (contains, e.g. "har" -> "Haris Khan") in one query — most people search
   for someone by the name they actually know them by, not their handle. */
export async function searchProfiles(query, max = 15){
  if(!ready) return [];
  const raw = String(query || '').trim();
  if(!raw) return [];
  // Postgrest .or() takes one comma-separated filter string, so strip
  // characters that would either break that syntax or be meaningless in
  // an ilike pattern anyway.
  const safe = raw.replace(/[,%]/g, '').trim();
  if(!safe) return [];
  const handleTerm = safe.toLowerCase().replace(/^@/, '');
  const { data, error } = await sb.from('profiles')
    .select('*')
    .or(`handle.ilike.${handleTerm}%,display_name.ilike.%${safe}%`)
    .limit(max);
  if(error){ console.error('searchProfiles failed:', error); return []; }
  return data.map(toAppProfile).filter(pr=>pr.uid !== (currentUser && currentUser.id));
}

/* Public player-profile card for the standalone, no-login-required
   player.html page — reachable by anyone, signed in or not. Deliberately a
   narrow column list (not `select('*')`) rather than reusing toAppProfile:
   this is the one read path that can be hit by a fully anonymous visitor,
   so it must never even request is_admin/points/streak/last_checkin,
   regardless of what RLS would otherwise allow through. */
export async function fetchPublicPlayerCard(handle){
  if(!isConfigured()) return null;
  if(!ready){ const ok = await initCloud(); if(!ok) return null; }
  const h = String(handle || '').trim().toLowerCase().replace(/^@/, '');
  if(!h) return null;
  const { data, error } = await sb.from('profiles')
    .select('id, handle, display_name, avatar_id, photo, bio, country, region, district, area, is_organiser')
    .eq('handle', h).maybeSingle();
  if(error){ console.error('fetchPublicPlayerCard failed:', error); return null; }
  if(!data) return null;
  return {
    uid: data.id, handle: data.handle, displayName: data.display_name, avatarId: data.avatar_id,
    photo: data.photo || undefined, bio: data.bio, isOrganiser: data.is_organiser,
    country: data.country || '', region: data.region || '', district: data.district || '', area: data.area || ''
  };
}

/* ---------------- generic collection sync ---------------- */

async function saveRowIn(table, obj, extra = {}){
  if(!ready || !currentUser || !obj || !obj.id) return false;
  const { error } = await sb.from(table).upsert({
    id: obj.id, user_id: currentUser.id, data: clean(obj), updated_at: new Date().toISOString(),
    ...extra
  });
  if(error){ console.error(`save ${table} failed:`, error); return false; }
  return true;
}

async function fetchAllIn(table, max = 200){
  if(!ready || !currentUser) return [];
  const { data, error } = await sb.from(table).select('data')
    .eq('user_id', currentUser.id).limit(max);
  if(error){ console.error(`fetch ${table} failed:`, error); return []; }
  return data.map(r=>r.data);
}

async function deleteRowIn(table, id){
  if(!ready || !currentUser) return;
  const { error } = await sb.from(table).delete().eq('id', id).eq('user_id', currentUser.id);
  if(error) console.error(`delete ${table} failed:`, error);
}

/* matches */
export const saveMatchToCloud  = (m)=>saveRowIn('matches', m);

/* Not fetchAllIn('matches') — that only selects `data`, which would silently
   drop the real `cancelled` column an admin may have set (see
   admin_cancel_match in supabase.sql), and the owner's own device would
   never find out their match was cancelled. Folding it onto the returned
   object as a plain `cancelled` property means app.js's existing
   `match.completed` scoring guards just need one extra check. */
export async function fetchCloudMatches(){
  if(!ready || !currentUser) return [];
  const { data, error } = await sb.from('matches').select('data, cancelled')
    .eq('user_id', currentUser.id).limit(200);
  if(error){ console.error('fetch matches failed:', error); return []; }
  return data.map(r=>({ ...r.data, cancelled: !!r.cancelled }));
}

export const deleteCloudMatch  = (id)=>deleteRowIn('matches', id);

/* teams */
export const saveTeam   = (t)=>saveRowIn('teams', t);
export const fetchTeams = ()=>fetchAllIn('teams');
export const deleteTeam = (id)=>deleteRowIn('teams', id);

/* tournaments — the queryable columns (name/location/dates/status/...) are
   promoted copies of fields also present in `data`, kept in sync on every
   save so listing/filtering/RLS never has to parse JSONB. `data` stays the
   source of truth tournament.js reads back on load. */
function tournamentColumns(t){
  return {
    is_public: !!t.isPublic,
    name: t.name || '',
    location: t.location || '',
    ground: t.ground || '',
    start_date: t.startDate || null,
    end_date: t.endDate || null,
    description: t.description || '',
    banner_url: t.bannerUrl || null,
    entry_rules: t.entryRules || '',
    rules: t.rules || '',
    status: t.status || 'upcoming'
  };
}
export const saveTournament    = (t)=>saveRowIn('tournaments', t, tournamentColumns(t));
export const fetchTournaments  = ()=>fetchAllIn('tournaments');
export const deleteTournament  = (id)=>deleteRowIn('tournaments', id);

/* Single tournament by id, for the public/shareable detail page — works
   for the owner, an admin, or anyone when the tournament is public; RLS
   alone decides (a private tournament you don't own simply comes back as
   no row, not an error, so this never leaks whether a private id exists). */
export async function fetchTournamentById(id){
  if(!ready || !id) return null;
  const { data, error } = await sb.from('tournaments')
    .select('data, user_id, is_public, name, location, ground, start_date, end_date, description, banner_url, entry_rules, rules, status')
    .eq('id', id).maybeSingle();
  if(error){ console.error('fetchTournamentById failed:', error); return null; }
  if(!data) return null;
  const d = data.data || {};
  return {
    ...d,
    ownerId: data.user_id, isPublic: !!data.is_public,
    name: data.name || d.name || '', location: data.location || d.location || '',
    ground: data.ground || d.ground || '', startDate: data.start_date || d.startDate || null,
    endDate: data.end_date || d.endDate || null, description: data.description || d.description || '',
    bannerUrl: data.banner_url || d.bannerUrl || null, entryRules: data.entry_rules || d.entryRules || '',
    rules: data.rules || d.rules || '', status: data.status || d.status || 'upcoming'
  };
}

/* Public tournament discovery — real, RLS-backed (see supabase.sql's
   "public tournaments are readable by anyone" policy). Only returns
   tournaments their owner explicitly marked public; excludes your own
   (those already show under "My Tournaments"). */
export async function fetchPublicTournaments(max = 30){
  if(!ready) return [];
  let q = sb.from('tournaments').select('data')
    .eq('is_public', true).order('updated_at', { ascending: false }).limit(max);
  if(currentUser) q = q.neq('user_id', currentUser.id);
  const { data, error } = await q;
  if(error){ console.error('fetchPublicTournaments failed:', error); return []; }
  return data.map(r=>r.data);
}

/* Points-based "Top Players" rail for the home dashboard. Points come from
   the existing daily-check-in/streak system (profiles.points) — the app has
   no skill/performance rating engine, so this shows real points rather than
   inventing a rating, per "don't fake statistics". Only players who've set a
   public username (handle) are eligible, matching how public profiles work
   everywhere else. Relies on the existing "profiles are readable by any
   signed-in user" RLS policy other reads already lean on — no schema change,
   and guests get an empty list rather than a leaked query. */
export async function fetchTopPlayers(limit = 8){
  if(!ready || !currentUser) return [];
  const { data, error } = await sb.from('profiles')
    .select('id, handle, display_name, avatar_id, photo, points, is_organiser, region, primary_role')
    .not('handle', 'is', null)
    .order('points', { ascending: false })
    .limit(limit);
  if(error){ console.error('fetchTopPlayers failed:', error); return []; }
  return data.map(r=>({
    uid: r.id, handle: r.handle, displayName: r.display_name || 'Player',
    avatarId: r.avatar_id, photo: r.photo || undefined, points: r.points || 0,
    isOrganiser: r.is_organiser, region: r.region || '', primaryRole: r.primary_role || ''
  }));
}

/* scheduled events */
export const saveEvent   = (e)=>saveRowIn('events', e);
export const fetchEvents = ()=>fetchAllIn('events');
export const deleteEvent = (id)=>deleteRowIn('events', id);

/* ---------------- connections (friends) ---------------- */

export async function fetchMyConnections(){
  if(!ready || !currentUser) return [];
  const { data, error } = await sb.from('connections').select('*').contains('members', [currentUser.id]);
  if(error){ console.error('fetchMyConnections failed:', error); return []; }
  return data.map(toAppConnection);
}

function toAppConnection(row){
  return {
    id: row.id, members: row.members, requestedBy: row.requested_by,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export async function sendConnectionRequest(conn){
  if(!ready || !currentUser || !conn) return false;
  const { error } = await sb.from('connections').insert({
    id: conn.id, members: conn.members, requested_by: conn.requestedBy, status: 'pending'
  });
  if(error){ console.error('sendConnectionRequest failed:', error); return false; }
  return true;
}

export async function respondToConnection(conn, accept){
  if(!ready || !currentUser || !conn) return false;
  const { error } = await sb.rpc('respond_to_connection', { conn_id: conn.id, accept });
  if(error){ console.error('respondToConnection failed:', error); return false; }
  return true;
}

export async function removeConnection(connId){
  if(!ready || !currentUser || !connId) return false;
  const { error } = await sb.from('connections').delete().eq('id', connId);
  if(error){ console.error('removeConnection failed:', error); return false; }
  return true;
}

/* ---------------- organiser applications ---------------- */

export async function submitOrganiserApplication(application){
  if(!ready || !currentUser) return false;
  const { error } = await sb.from('organiser_applications').insert({
    uid: currentUser.id, handle: application.handle, display_name: application.displayName,
    org_name: application.orgName, description: application.description, contact: application.contact
  });
  if(error){ console.error('submitOrganiserApplication failed:', error); return false; }
  return true;
}

export async function fetchMyOrganiserApplications(){
  if(!ready || !currentUser) return [];
  const { data, error } = await sb.from('organiser_applications').select('*').eq('uid', currentUser.id);
  if(error){ console.error('fetchMyOrganiserApplications failed:', error); return []; }
  return data.map(toAppApplication);
}

function toAppApplication(row){
  return {
    id: row.id, uid: row.uid, handle: row.handle, displayName: row.display_name,
    orgName: row.org_name, description: row.description, contact: row.contact,
    status: row.status, createdAt: row.created_at, reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by, adminNote: row.admin_note
  };
}

/* ---------------- admin ---------------- */

export async function isCurrentUserAdmin(){
  if(!ready || !currentUser) return false;
  const { data, error } = await sb.from('admins').select('uid').eq('uid', currentUser.id).maybeSingle();
  if(error) return false;
  return !!data;
}

export async function countOrganisers(){
  if(!ready) return 0;
  const { count, error } = await sb.from('profiles').select('id', { count:'exact', head:true }).eq('is_organiser', true);
  if(error){ console.error('countOrganisers failed:', error); throw error; }
  return count || 0;
}

/* ---------------- admin: platform-wide oversight ----------------
   The generic per-user tables (matches/teams/tournaments/events) are
   owner-only by default — fetchTeams()/fetchTournaments() etc. above
   deliberately filter to the signed-in user. These bypass that filter and
   rely on the "admin can read all rows" RLS policy (supabase.sql) instead,
   so they only ever return real data for an actual admin — for anyone else
   RLS silently returns nothing, same as querying a table you can't see.

   Deliberately different error contract from the rest of this file: most
   functions above quietly return [] / 0 / false on failure so a local-only
   or flaky-network user never sees a broken screen. These admin-only reads
   THROW on a real query error instead, because the admin dashboard needs to
   tell "genuinely zero records" apart from "the request failed" — silently
   showing 0 pending organisers when the query actually errored would hide a
   real problem from the one person meant to catch it. app.js's
   refreshAdminData() catches these and shows a distinct error+retry state. */

async function countAllIn(table){
  if(!ready) return 0;
  const { count, error } = await sb.from(table).select('id', { count:'exact', head:true });
  if(error){ console.error(`countAllIn ${table} failed:`, error); throw error; }
  return count || 0;
}

export async function fetchPlatformStats(){
  const [tournaments, matches, liveRows] = await Promise.all([
    countAllIn('tournaments'), countAllIn('matches'), fetchLiveMatchesNow()
  ]);
  return {
    tournaments, matches,
    liveMatches: liveRows.length,
    // Distinct tournaments with at least one match currently live — computed
    // client-side from the same small row set rather than a second query.
    liveTournaments: new Set(liveRows.map(r=>r.match && r.match.tournamentId).filter(Boolean)).size
  };
}

/* ---------------- daily rewards ----------------
   All the logic (streak math, points, once-per-day) lives server-side in
   daily_check_in() — see supabase.sql. This just calls it and returns
   whatever it decided. Safe to call every app open; a repeat call on the
   same day comes back with awarded:0. */
export async function dailyCheckIn(){
  if(!ready || !currentUser) return null;
  const { data, error } = await sb.rpc('daily_check_in');
  if(error){ console.error('dailyCheckIn failed:', error); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  if(!row) return null;
  return {
    points: row.points, streakCurrent: row.streak_current,
    streakLongest: row.streak_longest, awarded: row.awarded, milestone: row.milestone
  };
}

export async function fetchPlatformTournaments(max = 100){
  if(!ready) return [];
  const { data, error } = await sb.from('tournaments')
    .select('data').order('updated_at', { ascending: false }).limit(max);
  if(error){ console.error('fetchPlatformTournaments failed:', error); return []; }
  return data.map(r=>r.data);
}

export async function fetchPendingOrganiserApplications(){
  if(!ready || !currentUser) return [];
  const { data, error } = await sb.from('organiser_applications').select('*').eq('status', 'pending');
  if(error){ console.error('fetchPendingOrganiserApplications failed:', error); throw error; }
  return data.map(toAppApplication);
}

export async function approveOrganiserApplication(appId){
  if(!ready || !currentUser) return false;
  const { error } = await sb.rpc('approve_organiser_application', { app_id: appId });
  if(error){ console.error('approveOrganiserApplication failed:', error); return false; }
  return true;
}

export async function rejectOrganiserApplication(appId, note){
  if(!ready || !currentUser) return false;
  const { error } = await sb.rpc('reject_organiser_application', { app_id: appId, note: note || '' });
  if(error){ console.error('rejectOrganiserApplication failed:', error); return false; }
  return true;
}

/* Admin: grant or revoke organiser access on an existing account. Reuses the
   existing "owner can update own profile, admin can update any" RLS policy
   on profiles — that policy's WITH CHECK already lets an admin caller change
   is_organiser freely (see supabase.sql), so this needs no new migration. */
export async function adminSetOrganiserStatus(uid, isOrganiser){
  if(!ready || !currentUser) return false;
  const { error } = await sb.from('profiles').update({ is_organiser: !!isOrganiser }).eq('id', uid);
  if(error){ console.error('adminSetOrganiserStatus failed:', error); return false; }
  return true;
}

/* ---------------- admin: tournament / match / user management ----------------
   Richer than fetchPlatformTournaments()/countAllIn() above — these carry the
   owner id (for the "by organiser" filter) and, for matches, the moderation
   flag, neither of which live inside the jsonb `data` blob. Same RLS path:
   "admin can read all rows" on tournaments/matches, silently empty for
   anyone who isn't actually an admin. */

export async function fetchAllTournamentsAdmin(max = 300){
  if(!ready) return [];
  const { data, error } = await sb.from('tournaments')
    .select('id, user_id, data, updated_at').order('updated_at', { ascending: false }).limit(max);
  if(error){ console.error('fetchAllTournamentsAdmin failed:', error); throw error; }
  return data.map(r=>({ id: r.id, ownerId: r.user_id, tournament: r.data, updatedAt: r.updated_at }));
}

export async function fetchAllMatchesAdmin(max = 500){
  if(!ready) return [];
  const { data, error } = await sb.from('matches')
    .select('id, user_id, data, cancelled, updated_at').order('updated_at', { ascending: false }).limit(max);
  if(error){ console.error('fetchAllMatchesAdmin failed:', error); throw error; }
  return data.map(r=>({
    id: r.id, ownerId: r.user_id, cancelled: !!r.cancelled, updatedAt: r.updated_at,
    match: { ...r.data, cancelled: !!r.cancelled }
  }));
}

/* Every profile on the platform, for the admin Users/Players list. Same
   "profiles are readable by any signed-in user" policy every authenticated
   user already relies on elsewhere (friend search, public profiles) — not a
   new access grant, just a wider read of an already-broadly-readable table. */
export async function fetchAllProfilesAdmin(max = 500){
  if(!ready) return [];
  const { data, error } = await sb.from('profiles')
    .select('id, handle, display_name, avatar_id, is_organiser, is_admin, country, region, updated_at')
    .order('updated_at', { ascending: false }).limit(max);
  if(error){ console.error('fetchAllProfilesAdmin failed:', error); throw error; }
  return data;
}

/* Cancel — never delete. Both route through narrow SECURITY DEFINER
   functions that re-check is_admin() server-side themselves (see
   supabase.sql) rather than an admin-write RLS policy, so a bug here can
   never widen into "admin can edit the rest of someone's tournament/match". */
export async function adminCancelTournament(tournamentId){
  if(!ready || !currentUser) return false;
  const { data, error } = await sb.rpc('admin_cancel_tournament', { p_id: tournamentId });
  if(error){ console.error('adminCancelTournament failed:', error); return false; }
  return !!data;
}

export async function adminCancelMatch(matchId){
  if(!ready || !currentUser) return false;
  const { data, error } = await sb.rpc('admin_cancel_match', { p_id: matchId });
  if(error){ console.error('adminCancelMatch failed:', error); return false; }
  return !!data;
}

/* ---------------- feedback ---------------- */

export async function submitFeedback({ feedbackType, rating, message, page, appVersion }){
  if(!ready || !currentUser) return false;
  const { error } = await sb.from('feedback').insert({
    user_id: currentUser.id,
    feedback_type: feedbackType || 'other',
    rating: rating || null,
    message: (message || '').trim(),
    page: page || '',
    app_version: appVersion || ''
  });
  if(error){ console.error('submitFeedback failed:', error); return false; }
  return true;
}

export async function fetchAllFeedback(max = 300){
  if(!ready) return [];
  const { data, error } = await sb.from('feedback')
    .select('*').order('created_at', { ascending: false }).limit(max);
  if(error){ console.error('fetchAllFeedback failed:', error); throw error; }
  return data;
}

export async function updateFeedbackStatus(feedbackId, status){
  if(!ready || !currentUser) return false;
  const { error } = await sb.from('feedback').update({
    status, reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id
  }).eq('id', feedbackId);
  if(error){ console.error('updateFeedbackStatus failed:', error); return false; }
  return true;
}

/* ---------------- live share (public read) ---------------- */

let livePending = null, liveTimer = null;
const LIVE_THROTTLE_MS = 700;

export function pushLive(match){
  if(!ready || !currentUser || !match || !match.id || !match.liveShare) return;
  livePending = match;
  if(liveTimer) return;
  liveTimer = setTimeout(async ()=>{
    const m = livePending;
    livePending = null; liveTimer = null;
    await writeLive(m);
  }, LIVE_THROTTLE_MS);
}

export async function pushLiveNow(match){
  if(!ready || !currentUser || !match || !match.id) return false;
  return writeLive(match);
}

async function writeLive(m){
  const { error } = await sb.from('live_matches').upsert({
    id: m.id, user_id: currentUser.id, data: clean(m), live: true,
    // Free-text ground/venue the scorer typed at match setup, reused as the
    // "area" signal for the public Live Now list — no separate location
    // prompt needed, and it stays consistent with how profiles.location is
    // deliberately free text rather than a fixed region lookup.
    location: m.venue || null,
    updated_at: new Date().toISOString()
  });
  if(error){ console.error('live write failed:', error); return false; }
  return true;
}

export async function stopLive(matchId){
  if(!ready || !currentUser || !matchId) return;
  const { error } = await sb.from('live_matches').delete().eq('id', matchId);
  if(error) console.error('stopLive failed:', error);
}

/* ---------------- live now: public "what's on" browse list ---------------- */

/* Every currently-live match, most recently updated first. Public read (same
   RLS policy live.html already relies on) — no account needed to browse. */
export async function fetchLiveMatchesNow(){
  if(!ready) return [];
  const { data, error } = await sb.from('live_matches')
    .select('id, data, location, updated_at')
    .order('updated_at', { ascending: false });
  if(error){ console.error('fetchLiveMatchesNow failed:', error); return []; }
  return data.map(r=>({ id: r.id, match: r.data, location: r.location || '', updatedAt: r.updated_at }));
}

/* Fires `onChange` whenever any match starts, stops, or scores a ball, so the
   Live Now screen can just re-fetch and re-render — the row counts involved
   are small enough that a full re-fetch on each change is simpler and safer
   than hand-diffing, and matches the re-fetch-on-event pattern used
   elsewhere in this file. Returns an unsubscribe function. */
export function watchAllLiveMatches(onChange){
  if(!ready) return ()=>{};
  const channel = sb.channel('all_live_matches')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, onChange)
    .subscribe();
  return ()=>sb.removeChannel(channel);
}

/* ---------------- presence: how many people currently have the app open ----------------
   Uses Supabase Realtime Presence, not a database table — membership is
   ephemeral and tied to the websocket connection, so it needs no schema and
   self-cleans the instant a tab/app closes. Every client (signed in or
   guest) that calls joinPresence() is counted; the admin dashboard reads the
   same shared channel's state rather than running its own separate one. */
let presenceChannel = null;
let presenceListeners = [];

function guestPresenceKey(){
  return 'guest-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function ensurePresenceChannel(){
  if(!ready) return null;
  if(presenceChannel) return presenceChannel;
  const key = (currentUser && currentUser.id) || guestPresenceKey();
  presenceChannel = sb.channel('online-users', { config: { presence: { key } } });
  presenceChannel.on('presence', { event: 'sync' }, ()=>{
    const count = Object.keys(presenceChannel.presenceState()).length;
    presenceListeners.forEach(fn=>fn(count));
  });
  presenceChannel.subscribe(async (status)=>{
    if(status === 'SUBSCRIBED') await presenceChannel.track({ online_at: new Date().toISOString() });
  });
  return presenceChannel;
}

/* Call once at boot (any user, signed in or guest) so this session counts
   toward the platform's online total. */
export function joinPresence(){
  ensurePresenceChannel();
}

/* Admin dashboard: cb(count) immediately with what's currently known, then
   again every time someone joins or leaves. Returns an unsubscribe function. */
export function subscribeOnlineCount(cb){
  const ch = ensurePresenceChannel();
  if(!ch){ cb(0); return ()=>{}; }
  presenceListeners.push(cb);
  cb(Object.keys(ch.presenceState()).length);
  return ()=>{ presenceListeners = presenceListeners.filter(fn=>fn !== cb); };
}

export async function watchLiveMatch(matchId, onUpdate, onError){
  if(!isConfigured()){ onError && onError(new Error('not-configured')); return ()=>{}; }
  if(!ready){
    const ok = await initCloud();
    if(!ok){ onError && onError(new Error('init-failed')); return ()=>{}; }
  }
  try{
    const { data, error } = await sb.from('live_matches').select('data').eq('id', matchId).maybeSingle();
    if(error){ onError && onError(error); return ()=>{}; }
    if(!data){ onError && onError(new Error('not-found')); return ()=>{}; }
    onUpdate(data.data);

    const channel = sb.channel('live_match_' + matchId)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'live_matches', filter: `id=eq.${matchId}` },
        (payload)=>{
          if(payload.eventType === 'DELETE'){ onError && onError(new Error('not-found')); return; }
          onUpdate(payload.new.data);
        }
      )
      .subscribe();
    return ()=>sb.removeChannel(channel);
  }catch(err){ onError && onError(err); return ()=>{}; }
}

/* ---------------- notifications: admin authoring + sending ----------------
   Creating a notification row and sending it are deliberately two different
   calls: createNotification() is a plain RLS-scoped insert (any admin can
   already do this, no elevated access needed, and it's what makes "Save
   notification history" true even for a draft that's never sent). Actually
   delivering it — resolving the audience, fanning out recipient rows, and
   calling FCM — needs the service role key and the FCM service account, so
   that part runs entirely inside the send-notification Edge Function, never
   in this file. See supabase/functions/send-notification. */

export async function createNotification({
  type, title, message, imageUrl, actionType, actionTarget,
  audienceType, audienceFilter, templateId, scheduledAt
}){
  requireCloud();
  if(!currentUser) throw Object.assign(new Error('Not signed in'), { code:'app/not-signed-in' });
  const { data, error } = await sb.from('notifications').insert({
    type: type || 'announcement',
    title: (title || '').trim(),
    message: (message || '').trim(),
    image_url: imageUrl || null,
    action_type: actionType || 'none',
    action_target: actionTarget || null,
    audience_type: audienceType,
    audience_filter: audienceFilter || {},
    template_id: templateId || null,
    created_by: currentUser.id,
    status: scheduledAt ? 'scheduled' : 'draft',
    scheduled_at: scheduledAt || null
  }).select().maybeSingle();
  if(error) throw error;
  return toAppNotification(data);
}

/* Admin-only preview count ("Send this notification to 12,450 users?") —
   calls the same resolve_notification_audience() the database itself uses
   as the source of truth, so the number shown before sending can never
   drift from who actually receives it. */
export async function previewAudienceCount(audienceType, audienceFilter){
  requireCloud();
  const { data, error } = await sb.rpc('resolve_notification_audience', {
    p_audience_type: audienceType, p_filter: audienceFilter || {}
  });
  if(error) throw error;
  return (data || []).length;
}

/* Hands off to the Edge Function, which is the only thing in the system
   holding the service role key + FCM credentials. supabase-js automatically
   forwards the caller's own session as the Authorization header, which is
   what the function re-verifies server-side before doing anything — this
   call carries no special privilege of its own, it just asks. */
export async function sendNotificationNow(notificationId){
  requireCloud();
  const { data, error } = await sb.functions.invoke('send-notification', {
    body: { notification_id: notificationId }
  });
  if(error) throw error;
  return data;
}

export async function cancelScheduledNotification(id){
  requireCloud();
  const { error } = await sb.from('notifications')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'scheduled');
  if(error){ console.error('cancelScheduledNotification failed:', error); return false; }
  return true;
}

function toAppNotification(r){
  return {
    id: r.id, type: r.type, title: r.title, message: r.message, imageUrl: r.image_url,
    actionType: r.action_type, actionTarget: r.action_target,
    audienceType: r.audience_type, audienceFilter: r.audience_filter || {},
    templateId: r.template_id, createdBy: r.created_by, status: r.status,
    scheduledAt: r.scheduled_at, sentAt: r.sent_at,
    recipientsTotal: r.recipients_total, pushSubmitted: r.push_submitted, pushFailed: r.push_failed,
    errorMessage: r.error_message, createdAt: r.created_at
  };
}

/* History tab — admin can see every notification via RLS ("admin or
   recipient can read a notification"); ordinary users only ever see their
   own via fetchMyNotifications() below, never this. */
export async function fetchNotificationHistory(max = 100){
  if(!ready) return [];
  const { data, error } = await sb.from('notifications')
    .select('*').order('created_at', { ascending: false }).limit(max);
  if(error){ console.error('fetchNotificationHistory failed:', error); throw error; }
  return data.map(toAppNotification);
}

/* Admin dashboard summary card. Deliberately several small real counts
   rather than one invented "engagement score" — sent-this-month and
   scheduled come straight from `notifications` (admin can read every row);
   active devices goes through count_registered_devices() since
   notification_devices itself has no admin read policy (raw tokens stay
   owner-only) — see that function's comment in supabase.sql. */
export async function fetchNotificationStats(){
  if(!ready) return { total:0, sentThisMonth:0, scheduled:0, activeDevices:0, lastBroadcast:null };
  const monthAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const [totalRes, sentRes, scheduledRes, devicesRes, lastRes] = await Promise.all([
    sb.from('notifications').select('id', { count:'exact', head:true }),
    sb.from('notifications').select('id', { count:'exact', head:true }).eq('status','sent').gte('sent_at', monthAgo),
    sb.from('notifications').select('id', { count:'exact', head:true }).eq('status','scheduled'),
    sb.rpc('count_registered_devices'),
    sb.from('notifications').select('title, sent_at').eq('status','sent').order('sent_at',{ ascending:false }).limit(1).maybeSingle()
  ]);
  return {
    total: totalRes.count || 0,
    sentThisMonth: sentRes.count || 0,
    scheduled: scheduledRes.count || 0,
    activeDevices: devicesRes.data || 0,
    lastBroadcast: lastRes.data || null
  };
}

/* ---------------- notifications: templates ---------------- */

export async function fetchNotificationTemplates(){
  if(!ready) return [];
  const { data, error } = await sb.from('notification_templates').select('*').order('name');
  if(error){ console.error('fetchNotificationTemplates failed:', error); return []; }
  return data.map(t=>({
    id: t.id, name: t.name, type: t.type, titleTemplate: t.title_template,
    messageTemplate: t.message_template, actionType: t.action_type
  }));
}

export async function saveNotificationTemplate({ id, name, type, titleTemplate, messageTemplate, actionType }){
  requireCloud();
  const row = {
    name: (name || '').trim(), type: type || 'announcement',
    title_template: (titleTemplate || '').trim(), message_template: (messageTemplate || '').trim(),
    action_type: actionType || 'none', created_by: currentUser ? currentUser.id : null
  };
  if(id) row.id = id;
  const { data, error } = await sb.from('notification_templates').upsert(row).select().maybeSingle();
  if(error) throw error;
  return data;
}

export async function deleteNotificationTemplate(id){
  if(!ready) return false;
  const { error } = await sb.from('notification_templates').delete().eq('id', id);
  if(error){ console.error('deleteNotificationTemplate failed:', error); return false; }
  return true;
}

/* ---------------- notifications: the signed-in user's own inbox ----------------
   Everything below is scoped by notification_recipients' own RLS (owner or
   admin) — no special access, same trust level as any other "my data" read
   elsewhere in this file. */

function toAppNotificationItem(r){
  const n = r.notifications || {};
  return {
    recipientId: r.id, notificationId: r.notification_id,
    readAt: r.read_at, dismissedAt: r.dismissed_at, receivedAt: r.created_at,
    type: n.type, title: n.title, message: n.message, imageUrl: n.image_url,
    actionType: n.action_type, actionTarget: n.action_target
  };
}

export async function fetchMyNotifications(max = 50){
  if(!ready || !currentUser) return [];
  const { data, error } = await sb.from('notification_recipients')
    .select('id, notification_id, read_at, dismissed_at, created_at, notifications(type, title, message, image_url, action_type, action_target)')
    .eq('user_id', currentUser.id)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .limit(max);
  if(error){ console.error('fetchMyNotifications failed:', error); return []; }
  return data.map(toAppNotificationItem);
}

export async function fetchUnreadNotificationCount(){
  if(!ready || !currentUser) return 0;
  const { count, error } = await sb.from('notification_recipients')
    .select('id', { count:'exact', head:true })
    .eq('user_id', currentUser.id).is('read_at', null).is('dismissed_at', null);
  if(error){ console.error('fetchUnreadNotificationCount failed:', error); return 0; }
  return count || 0;
}

export async function markNotificationRead(recipientId){
  if(!ready || !currentUser) return false;
  const { error } = await sb.from('notification_recipients')
    .update({ read_at: new Date().toISOString() }).eq('id', recipientId).eq('user_id', currentUser.id);
  if(error){ console.error('markNotificationRead failed:', error); return false; }
  return true;
}

export async function markAllNotificationsRead(){
  if(!ready || !currentUser) return false;
  const { error } = await sb.from('notification_recipients')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', currentUser.id).is('read_at', null);
  if(error){ console.error('markAllNotificationsRead failed:', error); return false; }
  return true;
}

export async function dismissNotification(recipientId){
  if(!ready || !currentUser) return false;
  const { error } = await sb.from('notification_recipients')
    .update({ dismissed_at: new Date().toISOString() }).eq('id', recipientId).eq('user_id', currentUser.id);
  if(error){ console.error('dismissNotification failed:', error); return false; }
  return true;
}

/* Live badge updates while the app is open in a tab — push (FCM) is what
   wakes a closed/backgrounded app; this just covers "already looking at
   the app right now, in another tab, when a notification lands". */
export function watchMyNotifications(onChange){
  if(!ready || !currentUser) return ()=>{};
  const channel = sb.channel('my_notifications_' + currentUser.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'notification_recipients', filter: `user_id=eq.${currentUser.id}` },
      onChange
    ).subscribe();
  return ()=>sb.removeChannel(channel);
}

/* ---------------- notifications: device token registration ----------------
   Web Push registration itself (asking the browser for permission, getting
   a token from Firebase Messaging) happens in app.js — this file only ever
   sees the resulting token string, never Firebase credentials. */

export async function registerDeviceToken({ token, platform, deviceLabel }){
  if(!ready || !currentUser || !token) return false;
  const { error } = await sb.from('notification_devices').upsert({
    fcm_token: token, user_id: currentUser.id, platform: platform || 'web',
    device_label: (deviceLabel || '').slice(0, 120), last_seen: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'fcm_token' });
  if(error){ console.error('registerDeviceToken failed:', error); return false; }
  return true;
}

/* Called on sign-out for the current browser's own token, so a device that
   logged out stops receiving that account's pushes. Other devices/accounts
   are untouched. */
export async function removeDeviceToken(token){
  if(!ready || !token) return false;
  const { error } = await sb.from('notification_devices').delete().eq('fcm_token', token);
  if(error){ console.error('removeDeviceToken failed:', error); return false; }
  return true;
}

/* ---------------- notifications: automated cricket-event hooks ----------------
   Architecture-only, per the "future automated cricket notifications" brief.
   ONE of these is actually wired live (notifyOrganiserApplicationApproved,
   called from app.js's approveApp()) because it's the only event in this app
   that has BOTH a real trigger AND a real, spam-free, single-recipient
   audience — the applicant themselves.

   The rest (match started/completed, wicket, tournament starting, team
   qualified, match reminder) do NOT have a resolvable real audience yet:
   this schema has no "match followers" / "tournament subscribers" table (see
   the Task 142 plan for why "team members" / "tournament followers"
   audience-targeting was excluded from the admin composer for the same
   reason), so firing one automatically today could only ever legitimately
   target 'all', which would spam every user on every casual match anyone
   scores. That's exactly the "do NOT implement fake events" / anti-spam
   trap the brief warns about, so these stay defined-but-uncalled: real
   templates, real trigger points are commented at their call sites in
   app.js, gated behind AUTO_CRICKET_NOTIFICATIONS (see app.js), OFF by
   default. Turning one on for real means first deciding a real audience
   (e.g. wire it to 'all' deliberately for a tournament final, or build a
   followers table and target 'selected' with real subscriber ids) — never
   flip the flag without making that audience decision first.

   tournament_starting / match_reminder additionally can't be triggered from
   client-side JS at all — nothing keeps a browser tab open at the moment a
   tournament is scheduled to start. Those need the same server-side
   scheduled-dispatch mechanism already documented in supabase.sql for
   scheduled admin notifications (pg_cron + pg_net calling a "check what's
   starting soon" Edge Function) — there's no client-side hook for them to
   attach to, hence no stub function below for those two. */

/* The one live-wired hook: notifies the applicant, and only the applicant,
   the moment an admin approves their organiser application. Real trigger
   (approveOrganiserApplication succeeding), real recipient (the applicant's
   own uid — never broadcast), real data (their own org name). */
export async function notifyOrganiserApplicationApproved({ uid, orgName }){
  if(!ready || !uid) return false;
  try{
    const created = await createNotification({
      type: 'important_update',
      title: 'Organiser application approved',
      message: orgName
        ? `Your application for "${orgName}" has been approved — you can now create tournaments.`
        : 'Your organiser application has been approved — you can now create tournaments.',
      actionType: 'open_home',
      audienceType: 'user',
      audienceFilter: { user_id: uid }
    });
    await sendNotificationNow(created.id);
    return true;
  }catch(err){
    // Never let a notification failure block the approval itself — the
    // approval already succeeded by the time this runs.
    console.error('notifyOrganiserApplicationApproved failed (approval itself was unaffected):', err);
    return false;
  }
}

/* Defined for real, wired nowhere by default — see the block comment above.
   audienceType/audienceFilter are required args (no default to 'all') so a
   future caller has to make a deliberate audience choice, not fall into a
   silent broadcast. */
export async function notifyMatchStarted(match, { audienceType, audienceFilter }){
  if(!ready || !match || !audienceType) return false;
  try{
    const created = await createNotification({
      type: 'live_match',
      title: 'Match started',
      message: `${match.teamA || 'Team A'} vs ${match.teamB || 'Team B'} is live now.`,
      actionType: 'open_live_match', actionTarget: match.id,
      audienceType, audienceFilter: audienceFilter || {}
    });
    await sendNotificationNow(created.id);
    return true;
  }catch(err){ console.error('notifyMatchStarted failed:', err); return false; }
}

export async function notifyMatchCompleted(match, { audienceType, audienceFilter }){
  if(!ready || !match || !audienceType) return false;
  try{
    const created = await createNotification({
      type: 'match_result',
      title: 'Match completed',
      message: match.resultText || `${match.teamA || 'Team A'} vs ${match.teamB || 'Team B'} has finished.`,
      actionType: 'open_live_match', actionTarget: match.id,
      audienceType, audienceFilter: audienceFilter || {}
    });
    await sendNotificationNow(created.id);
    return true;
  }catch(err){ console.error('notifyMatchCompleted failed:', err); return false; }
}

/* ---------------- util ---------------- */

function requireCloud(){
  if(!ready) throw Object.assign(new Error('Supabase is not configured'), { code:'app/not-configured' });
}

/* Strip undefined so JSON.stringify (used under the hood for the jsonb
   `data` columns) never silently drops a key you meant to send. */
function clean(obj){
  if(Array.isArray(obj)) return obj.map(clean);
  if(obj && typeof obj === 'object' && !(obj instanceof Date)){
    const out = {};
    for(const [k,v] of Object.entries(obj)){
      if(v === undefined) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return obj;
}
