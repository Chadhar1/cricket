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

/* ---------------- auth: Google ---------------- */

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
    streakLongest: row.streak_longest || 0, lastCheckin: row.last_checkin || null
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
export async function saveMyPublicProfile({ handle, displayName, avatarId, bio }){
  if(!ready || !currentUser) return { ok:false, error:'Not signed in.' };
  const { error } = await sb.from('profiles').upsert({
    id: currentUser.id, handle, display_name: displayName, avatar_id: avatarId, bio: bio || ''
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
