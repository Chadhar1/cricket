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
export const fetchCloudMatches = ()=>fetchAllIn('matches');
export const deleteCloudMatch  = (id)=>deleteRowIn('matches', id);

/* teams */
export const saveTeam   = (t)=>saveRowIn('teams', t);
export const fetchTeams = ()=>fetchAllIn('teams');
export const deleteTeam = (id)=>deleteRowIn('teams', id);

/* tournaments */
export const saveTournament    = (t)=>saveRowIn('tournaments', t, { is_public: !!t.isPublic });
export const fetchTournaments  = ()=>fetchAllIn('tournaments');
export const deleteTournament  = (id)=>deleteRowIn('tournaments', id);

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
  if(error){ console.error('countOrganisers failed:', error); return 0; }
  return count || 0;
}

/* ---------------- admin: platform-wide oversight ----------------
   The generic per-user tables (matches/teams/tournaments/events) are
   owner-only by default — fetchTeams()/fetchTournaments() etc. above
   deliberately filter to the signed-in user. These bypass that filter and
   rely on the "admin can read all rows" RLS policy (supabase.sql) instead,
   so they only ever return real data for an actual admin — for anyone else
   RLS silently returns nothing, same as querying a table you can't see. */

async function countAllIn(table){
  if(!ready) return 0;
  const { count, error } = await sb.from(table).select('id', { count:'exact', head:true });
  if(error){ console.error(`countAllIn ${table} failed:`, error); return 0; }
  return count || 0;
}

export async function fetchPlatformStats(){
  const [tournaments, matches] = await Promise.all([
    countAllIn('tournaments'), countAllIn('matches')
  ]);
  return { tournaments, matches };
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
  if(error){ console.error('fetchPendingOrganiserApplications failed:', error); return []; }
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
    id: m.id, user_id: currentUser.id, data: clean(m), live: true, updated_at: new Date().toISOString()
  });
  if(error){ console.error('live write failed:', error); return false; }
  return true;
}

export async function stopLive(matchId){
  if(!ready || !currentUser || !matchId) return;
  const { error } = await sb.from('live_matches').delete().eq('id', matchId);
  if(error) console.error('stopLive failed:', error);
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
