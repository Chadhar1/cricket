/* ===========================================================================
   Cricket Connect — app.js
   UI, navigation, persistence and cloud wiring.
   Cricket rules live in engine.js. Tournament maths lives in tournament.js.
   Supabase calls live in cloud.js and are safe no-ops when unconfigured.
   =========================================================================== */

import {
  createMatch, playBall, startSecondInnings, finishMatch, closeInnings,
  curInnings, teamName, fmtOvers, runRate, swapStrike, chaseInfo,
  bowlerEcon, strikeRate, newBowler, makeId, inningsLine, topPerformers,
  currentPartnership, lastOvers, recentRuns, projectedScore, tossText,
  playerOfTheMatch, createSuperOver,
  maxOversPerBowler, bowlerRemaining, bowlerExhausted, eligibleBowlers
} from './engine.js';

import {
  createTournament, generateRoundRobin, resultFromMatch, applyResult,
  computeStandings, leagueComplete, generateKnockout, advanceKnockout,
  tournamentChampion, teamNameById, allFixtures, formatNRR, newFixture
} from './tournament.js';

import { AVATARS, DEFAULT_AVATAR, avatarSVG, initialsBadge, brandMark, brandLockup } from './avatars.js';

import {
  buildCareers, topRunScorers, topWicketTakers, bestAverages, bestEconomy,
  bestBattingPerformances, bestBowlingPerformances, teamRecords, overallSummary
} from './stats.js';

import {
  initCloud, cloudReady, getUser, onAuth, resumeRedirect,
  signUpEmail, signInEmail, sendReset, signInGoogle, signOutUser,
  authErrorText, changeDisplayName,
  fetchProfile, saveProfile,
  saveMatchToCloud, fetchCloudMatches,
  saveTeam, fetchTeams, deleteTeam,
  saveTournament, fetchTournaments, deleteTournament,
  saveEvent, fetchEvents, deleteEvent,
  pushLive, pushLiveNow, stopLive,
  fetchMyPublicProfile, fetchPublicProfile, saveMyPublicProfile, searchProfilesByHandle,
  fetchMyConnections, sendConnectionRequest, respondToConnection, removeConnection,
  submitOrganiserApplication, fetchMyOrganiserApplications,
  isCurrentUserAdmin, fetchPendingOrganiserApplications, countOrganisers,
  approveOrganiserApplication, rejectOrganiserApplication
} from './cloud.js';

import {
  validateHandle, pairId, newConnection, connectionActionFor, canRespond,
  newOrganiserApplication, validateApplication
} from './social.js';

/* ---------------- storage keys ---------------- */
const K = {
  match:'cs_match_v3', history:'cs_history_v3', teams:'cs_teams_v3',
  tours:'cs_tournaments_v3', events:'cs_events_v3', profile:'cs_profile_v3'
};
const APP_VERSION = '4.1';

/* ---------------- state ---------------- */
let match = null;
let screen = 'home';
let tab = 'home';
let historyViewId = null;
let undoStack = [];
let teams = [], tournaments = [], events = [], cloudMatches = [];
let profile = { displayName:'', avatarId:DEFAULT_AVATAR };
let editingTeamId = null, teamFormRoster = [];
let pendingExtra = null;
let authMode = 'signin';
let authAvatar = DEFAULT_AVATAR;
let openTourId = null, tourTab = 'table';
let setupPrefill = null;
let mcTab = 'scorecard';
let statsTab = 'batting';
let pendingToss = null;
let deferredInstall = null;
let myPublicProfile = null;
let isAdminUser = false;
let myConnections = [];
let friendResults = [];
let profileCache = {};
let pendingApps = [];
let adminOverview = { organisers:0, tournaments:0, matches:0 };

const $ = (id)=>document.getElementById(id);

/* ---------------- storage ---------------- */
const load = (k, d)=>{ try{ const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; }catch(e){ return d; } };
const save = (k, v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){ console.warn('save failed', e); } };
const del  = (k)=>{ try{ localStorage.removeItem(k); }catch(e){} };

function persistMatch(){
  if(!match) return;
  save(K.match, match);
  if(cloudReady() && getUser()){
    saveMatchToCloud(match);
    if(match.liveShare) pushLive(match);
  }
}
function historyList(){ return load(K.history, []); }
function pushHistory(m){
  const list = historyList();
  const i = list.findIndex(x=>x.id === m.id);
  if(i >= 0) list[i] = m; else list.unshift(m);
  save(K.history, list.slice(0,150));
}
function saveTeams(){ save(K.teams, teams); }
function saveTours(){ save(K.tours, tournaments); }
function saveEvents(){ save(K.events, events); }
function saveProfileLocal(){ save(K.profile, profile); }

/* ---------------- util ---------------- */
let toastTimer = null;
function toast(msg){
  let el = $('toastEl');
  if(!el){ el = document.createElement('div'); el.id = 'toastEl'; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.style.display = 'none'; }, 2000);
}
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dayStart(d){ const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); }
function fmtWhen(iso){
  if(!iso) return 'No date set';
  const d = new Date(iso);
  const today = dayStart(new Date()), that = dayStart(d);
  const diff = Math.round((that - today) / 86400000);
  const time = d.getHours() || d.getMinutes()
    ? d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '';
  let day;
  if(diff === 0) day = 'Today';
  else if(diff === 1) day = 'Tomorrow';
  else if(diff === -1) day = 'Yesterday';
  else if(diff > 1 && diff < 7) day = d.toLocaleDateString([], { weekday:'long' });
  else day = d.getDate() + ' ' + MONTHS[d.getMonth()];
  return time ? day + ' · ' + time : day;
}

/* ---------------- account requirement ----------------
   Every feature now needs an account. Supabase keeps the session on the
   device, so a signed-in user still works fully offline at the ground — only
   the very first sign-in needs connectivity.
   ------------------------------------------------------------------------- */
function isSignedIn(){ return cloudReady() && !!getUser(); }

/* If Supabase isn't configured at all we can't ask anyone to sign in, so the
   app stays open rather than locking everybody out of their own data. */
function requiresAccount(){ return cloudReady(); }

/* ---------------- navigation ---------------- */
const SCREENS = ['auth','home','setup','live','result','history','teams','tournaments','tournament','stats','profile','friends','admin'];
const TAB_OF = { home:'home', tournaments:'tournaments', tournament:'tournaments',
                 teams:'teams', stats:'stats', history:'stats', profile:'profile',
                 friends:'friends', admin:'admin' };

function go(s){ screen = s; render(); window.scrollTo(0,0); }

function showScreen(name){
  const lp = $('sideLive');
  if(lp) lp.style.display = (match && !match.completed) ? '' : 'none';
  SCREENS.forEach(s=>{
    const el = $('screen-' + s);
    if(el) el.classList.toggle('hidden', s !== name);
  });
  const showTabs = !['auth','live','setup','result'].includes(name);
  $('tabbar').classList.toggle('hidden', !showTabs);
  document.body.classList.toggle('has-tabs', showTabs);
  if(TAB_OF[name]){
    tab = TAB_OF[name];
    document.querySelectorAll('[data-tabnav]').forEach(b=>
      b.classList.toggle('active', b.dataset.tabnav === tab));
  }
}

/* ---------------- AUTH SCREEN ---------------- */
function paintBrandMarks(){
  document.querySelectorAll('[data-brandmark]').forEach(el=>{
    if(!el.dataset.painted){ el.innerHTML = brandMark(34); el.dataset.painted = '1'; }
  });
}

function renderAuth(){
  $('authHero').innerHTML = brandLockup(80);
  $('authAvatarGrid').innerHTML = AVATARS.map(a=>
    `<div class="avatar-opt ${a.id === authAvatar ? 'sel':''}" data-avatar="${a.id}">${avatarSVG(a.id, 46)}</div>`).join('');
  const isUp = authMode === 'signup';
  $('segSignIn').classList.toggle('active', !isUp);
  $('segSignUp').classList.toggle('active', isUp);
  $('signUpFields').classList.toggle('hidden', !isUp);
  $('authSubmitBtn').textContent = isUp ? 'Create Account' : 'Sign in';
  $('forgotBtn').classList.toggle('hidden', isUp);
  $('authPassword').setAttribute('autocomplete', isUp ? 'new-password' : 'current-password');
  $('authPassword').placeholder = isUp ? 'At least 6 characters' : 'Your password';
}
function authMsg(text, ok){
  $('authMsg').innerHTML = text ? `<div class="${ok ? 'auth-ok':'auth-error'}">${esc(text)}</div>` : '';
}
function setAuthMode(m){ authMode = m; authMsg(''); renderAuth(); }

async function submitAuth(){
  const email = $('authEmail').value.trim();
  const pw = $('authPassword').value;
  const btn = $('authSubmitBtn');
  if(!cloudReady()){
    authMsg('Supabase is not configured yet. Add your project URL and key to supabase-config.js, or continue without an account.');
    return;
  }
  if(!email || !pw){ authMsg('Enter your email and password.'); return; }
  btn.disabled = true;
  btn.textContent = authMode === 'signup' ? 'Creating…' : 'Signing in…';
  try{
    if(authMode === 'signup'){
      const name = $('authName').value.trim() || email.split('@')[0];
      await signUpEmail(email, pw, name);
      profile = { displayName:name, avatarId:authAvatar };
      saveProfileLocal();
      await saveProfile(profile);
      toast('Welcome, ' + name);
    } else {
      await signInEmail(email, pw);
      toast('Signed in');
    }
    authMsg('');
    $('authPassword').value = '';
    go('home');
  }catch(err){
    authMsg(authErrorText(err));
  }finally{
    btn.disabled = false;
    renderAuth();
  }
}

async function doGoogle(){
  if(!cloudReady()){ authMsg('Supabase is not configured yet.'); return; }
  try{
    await signInGoogle();
    toast('Signed in');
  }catch(err){ authMsg(authErrorText(err)); }
}

async function doReset(){
  const email = $('authEmail').value.trim();
  if(!email){ authMsg('Enter your email above first, then tap reset.'); return; }
  if(!cloudReady()){ authMsg('Supabase is not configured yet.'); return; }
  try{
    await sendReset(email);
    authMsg('Password reset link sent to ' + email, true);
  }catch(err){ authMsg(authErrorText(err)); }
}

/* ---------------- profile photo ----------------
   Photos are resized to 256px and stored as a compressed JPEG data URL on the
   profile row. That avoids setting up Supabase Storage entirely, and a
   256px JPEG lands around 15-25 KB — comfortably small as a plain text
   column, with room to spare for the rest of the profile.
   ------------------------------------------------------------------------- */
const PHOTO_PX = 256;
const PHOTO_MAX_BYTES = 120 * 1024;      // refuse anything that won't compress

function readPhotoFile(file){
  return new Promise((resolve, reject)=>{
    if(!file) return reject(new Error('No file chosen.'));
    if(!/^image\//.test(file.type)) return reject(new Error('That is not an image.'));
    if(file.size > 12 * 1024 * 1024) return reject(new Error('Image is too large (max 12 MB).'));

    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error('Could not read that file.'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=>reject(new Error('Could not open that image.'));
      img.onload = ()=>{
        try{
          // centre-crop to a square, then scale to PHOTO_PX
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          const cv = document.createElement('canvas');
          cv.width = cv.height = PHOTO_PX;
          const ctx = cv.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, side, side, 0, 0, PHOTO_PX, PHOTO_PX);

          // step the quality down until it fits
          let q = 0.82, out = cv.toDataURL('image/jpeg', q);
          while(out.length * 0.75 > PHOTO_MAX_BYTES && q > 0.4){
            q -= 0.12;
            out = cv.toDataURL('image/jpeg', q);
          }
          if(out.length * 0.75 > PHOTO_MAX_BYTES){
            return reject(new Error('Could not compress that image enough. Try a smaller one.'));
          }
          resolve(out);
        }catch(err){ reject(new Error('Could not process that image.')); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Photo wins over the chosen icon wherever an avatar is shown. */
function avatarHTML(size){
  if(profile.photo) return `<img src="${esc(profile.photo)}" alt="Your profile photo">`;
  return avatarSVG(profile.avatarId || DEFAULT_AVATAR, size);
}

async function handlePhotoPick(file){
  try{
    toast('Processing photo…');
    const dataUrl = await readPhotoFile(file);
    profile.photo = dataUrl;
    saveProfileLocal();
    if(cloudReady() && getUser()) await saveProfile(profile);
    renderProfile(); renderHome();
    toast('Photo updated');
  }catch(err){
    toast(err.message || 'Could not use that photo');
  }
}

async function removePhoto(){
  delete profile.photo;
  saveProfileLocal();
  if(cloudReady() && getUser()) await saveProfile({ ...profile, photo:null });
  renderProfile(); renderHome();
  toast('Photo removed');
}

/* ---------------- PROFILE ---------------- */
function displayName(){
  const u = getUser();
  return profile.displayName || (u && (u.displayName || (u.email||'').split('@')[0])) || 'Guest';
}
function renderProfile(){
  $('profileAvatarBig').innerHTML = avatarHTML(84);
  $('photoPreview').innerHTML = avatarHTML(62);
  $('photoRemoveBtn').classList.toggle('hidden', !profile.photo);
  $('photoUploadBtn').textContent = profile.photo ? 'Change photo' : 'Upload photo';
  $('profileName').textContent = displayName();
  const u = getUser();
  $('profileEmail').textContent = u ? (u.email || 'Signed in') : 'Not signed in';
  $('profileNameInput').value = profile.displayName || (u && u.displayName) || '';
  $('profileHandleInput').value = (myPublicProfile && myPublicProfile.handle) || '';
  $('profileAvatarGrid').innerHTML = AVATARS.map(a=>
    `<div class="avatar-opt ${a.id === (profile.avatarId||DEFAULT_AVATAR) ? 'sel':''}" data-pavatar="${a.id}">${avatarSVG(a.id, 46)}</div>`).join('');

  const isOrganiser = myPublicProfile && myPublicProfile.isOrganiser;
  const applyBtn = $('applyOrganiserBtn');
  applyBtn.classList.toggle('hidden', !isSignedIn());
  if(isOrganiser){
    $('applyOrganiserLabel').textContent = 'Organiser';
    $('applyOrganiserSub').textContent = "You're approved to run public tournaments";
    applyBtn.onclick = ()=>toast("You're already an approved organiser");
  } else {
    $('applyOrganiserLabel').textContent = 'Apply to be an organiser';
    $('applyOrganiserSub').textContent = 'Run your own public tournaments';
    applyBtn.onclick = openApplyOrganiserModal;
  }
  $('goAdminBtn').classList.toggle('hidden', !isAdminUser);

  const who = $('authWho'), btn = $('authActionBtn');
  if(!cloudReady()){
    who.innerHTML = '<span class="dot offline"></span>Local only &middot; Supabase not configured';
    btn.textContent = 'How to connect';
    btn.onclick = ()=>toast('Add your project URL and key to supabase-config.js, then redeploy');
  } else if(u){
    who.innerHTML = '<span class="dot online"></span>Synced as <b>' + esc(u.email || displayName()) + '</b>';
    btn.textContent = 'Sign out';
    btn.onclick = async ()=>{ await signOutUser(); toast('Signed out'); go('auth'); };
  } else {
    who.innerHTML = '<span class="dot offline"></span>Not signed in';
    btn.textContent = 'Sign in / Create account';
    btn.onclick = ()=>go('auth');
  }
  $('versionNote').textContent = 'Version ' + APP_VERSION;
}
async function saveProfileForm(){
  profile.displayName = $('profileNameInput').value.trim() || displayName();
  saveProfileLocal();
  if(cloudReady() && getUser()){
    await changeDisplayName(profile.displayName);
    await saveProfile(profile);

    const rawHandle = $('profileHandleInput').value.trim();
    const currentHandle = myPublicProfile && myPublicProfile.handle;
    if(rawHandle && rawHandle !== currentHandle){
      const v = validateHandle(rawHandle);
      if(!v.ok){ toast(v.error); renderProfile(); return; }
      const res = await saveMyPublicProfile({
        handle: v.handle, displayName: profile.displayName,
        avatarId: profile.avatarId, bio: (myPublicProfile && myPublicProfile.bio) || ''
      });
      if(!res.ok){ toast(res.error); renderProfile(); return; }
      myPublicProfile = await fetchMyPublicProfile();
      toast('Username saved');
    }
  }
  renderProfile(); renderHome();
  toast('Profile saved');
}

/* ---------------- FRIENDS ---------------- */

async function resolveProfiles(uids){
  const missing = uids.filter(u=>u && !profileCache[u]);
  await Promise.all(missing.map(async u=>{ profileCache[u] = await fetchPublicProfile(u) || { uid:u, displayName:'Player', handle:'' }; }));
}

async function refreshFriendsData(){
  if(!isSignedIn()) return;
  myConnections = await fetchMyConnections();
  const uids = new Set();
  myConnections.forEach(c=>c.members.forEach(m=>{ if(m !== getUser().id) uids.add(m); }));
  await resolveProfiles([...uids]);
}

function renderFriends(){
  const hasHandle = myPublicProfile && myPublicProfile.handle;
  $('friendsHandleGate').classList.toggle('hidden', !!hasHandle);
  $('friendsMain').classList.toggle('hidden', !hasHandle);
  if(!hasHandle) return;

  const me = getUser().id;

  $('friendSearchResults').innerHTML = friendResults.length ? friendResults.map(p=>{
    const conn = myConnections.find(c=>c.members.includes(p.uid));
    const action = conn ? connectionActionFor(conn, me) : 'request';
    let btn;
    if(action === 'request') btn = `<button class="icon-btn" data-action="send-friend" data-uid="${esc(p.uid)}">Add</button>`;
    else if(action === 'awaiting') btn = `<button class="icon-btn" disabled>Pending</button>`;
    else if(action === 'respond') btn = `<button class="icon-btn" data-action="accept-friend" data-id="${esc(conn.id)}">Accept</button>`;
    else btn = `<span class="badge open">Friends</span>`;
    return `<div class="list-pick">
      ${initialsBadge(p.displayName || p.handle, 34)}
      <div class="lp-n">${esc(p.displayName || '')} <span class="stat-dim">@${esc(p.handle)}</span></div>
      ${btn}
    </div>`;
  }).join('') : '<div class="empty-note">Search a username above to find players.</div>';

  const incoming = myConnections.filter(c=>c.status === 'accepted' ? false : canRespond(c, me));
  const requestsCard = $('friendRequestsCard');
  requestsCard.classList.toggle('hidden', incoming.length === 0);
  $('friendRequestsList').innerHTML = incoming.map(c=>{
    const other = c.members.find(m=>m !== me);
    const p = profileCache[other] || { displayName:'Player', handle:'' };
    return `<div class="list-pick">
      ${initialsBadge(p.displayName || p.handle, 34)}
      <div class="lp-n">${esc(p.displayName || '')} <span class="stat-dim">@${esc(p.handle)}</span></div>
      <button class="icon-btn" data-action="accept-friend" data-id="${esc(c.id)}">Accept</button>
      <button class="icon-btn" data-action="decline-friend" data-id="${esc(c.id)}">Decline</button>
    </div>`;
  }).join('');

  const accepted = myConnections.filter(c=>c.status === 'accepted');
  $('friendsList').innerHTML = accepted.length ? accepted.map(c=>{
    const other = c.members.find(m=>m !== me);
    const p = profileCache[other] || { displayName:'Player', handle:'' };
    return `<div class="list-pick">
      ${initialsBadge(p.displayName || p.handle, 34)}
      <div class="lp-n">${esc(p.displayName || '')} <span class="stat-dim">@${esc(p.handle)}</span></div>
      <button class="icon-btn" data-action="unfriend" data-id="${esc(c.id)}">Remove</button>
    </div>`;
  }).join('') : '<div class="empty-note">No friends yet — search a username above.</div>';
}

async function doFriendSearch(){
  const q = $('friendSearchInput').value.trim();
  if(!q){ friendResults = []; renderFriends(); return; }
  friendResults = await searchProfilesByHandle(q);
  await resolveProfiles(friendResults.map(p=>p.uid));
  renderFriends();
}

async function sendFriendReq(uid){
  const me = getUser().id;
  const conn = newConnection(me, uid);
  if(!conn){ toast('Could not send request'); return; }
  const ok = await sendConnectionRequest(conn);
  if(ok){ toast('Request sent'); await refreshFriendsData(); renderFriends(); }
  else toast('Could not send request — try again');
}

async function respondFriendReq(connId, accept){
  const conn = myConnections.find(c=>c.id === connId);
  if(!conn) return;
  const ok = await respondToConnection(conn, accept);
  if(ok){ toast(accept ? 'Friend added' : 'Request declined'); await refreshFriendsData(); renderFriends(); }
  else toast('Something went wrong');
}

async function unfriend(connId){
  const ok = await removeConnection(connId);
  if(ok){ toast('Removed'); await refreshFriendsData(); renderFriends(); }
}

/* ---------------- ORGANISER APPLICATION ---------------- */

function openApplyOrganiserModal(){
  openModal(`
    <h3>Apply to be an organiser</h3>
    <label>League / tournament name</label>
    <input type="text" id="appOrgName" placeholder="e.g. Lahore Sunday League" maxlength="60">
    <label>Tell us about it</label>
    <textarea id="appDesc" rows="3" placeholder="Who plays, where, how often — at least 20 characters" maxlength="500"></textarea>
    <label>Contact (email or phone)</label>
    <input type="text" id="appContact" placeholder="you@example.com">
    <div class="auth-error hidden" id="appError"></div>
    <button class="btn" data-action="submit-organiser-app">Submit application</button>
    <button class="btn secondary" data-action="close">Cancel</button>
  `);
}

async function submitApplyOrganiser(){
  const orgName = $('appOrgName').value.trim();
  const description = $('appDesc').value.trim();
  const contact = $('appContact').value.trim();
  const app = newOrganiserApplication({
    uid: getUser().id, handle: myPublicProfile && myPublicProfile.handle,
    displayName: profile.displayName, orgName, description, contact
  });
  const v = validateApplication(app);
  if(!v.ok){
    $('appError').textContent = v.errors[0];
    $('appError').classList.remove('hidden');
    return;
  }
  const ok = await submitOrganiserApplication(app);
  closeModal();
  toast(ok ? 'Application submitted — an admin will review it' : 'Could not submit — try again');
}

/* ---------------- ADMIN ---------------- */

async function refreshAdminData(){
  if(!isAdminUser) return;
  const [apps, orgCount] = await Promise.all([fetchPendingOrganiserApplications(), countOrganisers()]);
  pendingApps = apps;
  adminOverview.organisers = orgCount;
  await resolveProfiles(pendingApps.map(a=>a.uid));
}

function renderAdmin(){
  $('adminStatPending').textContent = pendingApps.length;
  $('adminStatOrganisers').textContent = adminOverview.organisers;
  $('adminStatTournaments').textContent = tournaments.length;
  $('adminStatMatches').textContent = historyList().length;

  $('adminAppsList').innerHTML = pendingApps.length ? pendingApps.map(a=>{
    const p = profileCache[a.uid] || {};
    return `<div class="list-pick" style="align-items:flex-start;">
      <div class="lp-n">
        <div class="batter-name">${esc(a.orgName)}</div>
        <div class="stat-dim">${esc(a.displayName || p.displayName || 'Player')}${a.handle ? ' &middot; @' + esc(a.handle) : ''}</div>
        <div class="stat-dim" style="margin-top:4px;">${esc(a.description)}</div>
        <div class="stat-dim" style="margin-top:2px;">Contact: ${esc(a.contact)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="icon-btn on" data-action="approve-app" data-id="${esc(a.id)}">Approve</button>
        <button class="icon-btn" data-action="reject-app" data-id="${esc(a.id)}">Reject</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty-note">No pending requests.</div>';

  $('adminToursList').innerHTML = tournaments.length
    ? tournaments.map(t=>`<div class="hist-item"><div class="batter-name">${esc(t.name)}</div><div class="d">${(t.teams||[]).length} teams</div></div>`).join('')
    : '<div class="empty-note">No tournaments yet.</div>';
}

async function approveApp(id){
  const ok = await approveOrganiserApplication(id);
  if(ok){ toast('Approved'); pendingApps = pendingApps.filter(a=>a.id !== id); renderAdmin(); }
  else toast('Could not approve — try again');
}

async function rejectApp(id){
  const ok = await rejectOrganiserApplication(id, '');
  if(ok){ toast('Rejected'); pendingApps = pendingApps.filter(a=>a.id !== id); renderAdmin(); }
  else toast('Could not reject — try again');
}

/* ---------------- HOME ---------------- */
const QA = [
  { id:'qaNewMatch2',  label:'Start scoring', sub:'Ball by ball',    icon:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9h4M7 13h7M16 8v6"/>', go:'setup' },
  { id:'qaTeams2',     label:'Teams',         sub:'Build a squad',   icon:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1"/><circle cx="17" cy="9" r="2.5"/>', go:'teams' },
  { id:'qaTour2',      label:'Tournaments',   sub:'Tables & cups',   icon:'<path d="M6 4h12v5a6 6 0 01-12 0z"/><path d="M6 6H3v2a4 4 0 004 4M18 6h3v2a4 4 0 01-4 4"/><path d="M10 19h4M12 15v4"/>', go:'tournaments' },
  { id:'qaStats2',     label:'Rankings',      sub:'Career records',  icon:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', go:'stats' },
  { id:'qaSched2',     label:'Schedule',      sub:'Fixtures',        icon:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>', act:'schedule' },
  { id:'qaHist2',      label:'History',       sub:'Past results',    icon:'<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 4v4h4M12 7v5l3 2"/>', go:'history' }
];

function renderHeroAndRail(){
  const ms = mergedHistory().filter(m=>m.completed);
  const sum = overallSummary(ms);
  const upcoming = upcomingItems(20).length;
  const cells = [
    { v: ms.length,        l: 'Matches played' },
    { v: teams.length,     l: 'Teams' },
    { v: tournaments.length, l: 'Tournaments' },
    { v: upcoming,         l: 'Upcoming' }
  ];
  $('heroStats').innerHTML = cells.map(c=>
    `<div class="hero-stat"><div class="hs-v">${c.v}</div><div class="hs-l">${esc(c.l)}</div></div>`).join('');

  $('qaRail').innerHTML = QA.map(q=>
    `<button class="qa-item" data-qa="${q.id}">
       <span class="qa-ico"><svg viewBox="0 0 24 24">${q.icon}</svg></span>
       <b>${esc(q.label)}</b><span>${esc(q.sub)}</span>
     </button>`).join('');
}

function renderHome(){
  renderHeroAndRail();
  $('homeAvatar').innerHTML = avatarHTML(44);
  $('homeName').textContent = displayName();
  const u = getUser();
  $('homeSub').textContent = !cloudReady() ? 'Local only · not synced'
    : u ? 'Synced to your account' : 'Not signed in · tap to sign in';

  // resume banner
  const rb = $('resumeBanner');
  if(match && !match.completed){
    const inn = curInnings(match);
    rb.classList.remove('hidden');
    $('resumeTitle').textContent = 'Resume: ' + match.teamA + ' v ' + match.teamB;
    $('resumeSub').textContent = teamName(match, inn.battingTeam) + ' ' + inn.runs + '/' + inn.wickets +
      ' (' + fmtOvers(inn.legalBalls) + '/' + match.oversLimit + ' ov)';
  } else rb.classList.add('hidden');

  const adminCard = $('homeAdminCard');
  adminCard.classList.toggle('hidden', !isAdminUser);
  if(isAdminUser){
    $('homeAdminPending').textContent = pendingApps.length;
    $('homeAdminPendingBadge').textContent = pendingApps.length + ' pending';
    $('homeAdminPendingBadge').classList.toggle('hidden', pendingApps.length === 0);
    $('homeAdminOrganisers').textContent = adminOverview.organisers;
    $('homeAdminTournaments').textContent = tournaments.length;
    $('homeAdminMatches').textContent = historyList().length;
  }

  renderEventsWidget();
  renderRecent();
}

/* Upcoming = scheduled events + dated tournament fixtures, merged and sorted. */
function upcomingItems(limit = 6){
  const items = [];
  events.filter(e=>!e.done).forEach(e=>items.push({
    kind:'event', id:e.id, date:e.date, title:e.title || ((e.teamA||'') + ' v ' + (e.teamB||'')),
    venue:e.venue, teamA:e.teamA, teamB:e.teamB, tournamentId:e.tournamentId, fixtureId:e.fixtureId,
    oversLimit:e.oversLimit, type:e.type || 'match'
  }));
  tournaments.forEach(t=>{
    allFixtures(t).forEach(f=>{
      if(f.status === 'completed' || !f.date) return;
      if(events.some(e=>e.fixtureId === f.id)) return;   // already surfaced as an event
      items.push({
        kind:'fixture', id:f.id, date:f.date,
        title: teamNameById(t, f.teamAId) + ' v ' + teamNameById(t, f.teamBId),
        venue:f.venue, teamA:teamNameById(t, f.teamAId), teamB:teamNameById(t, f.teamBId),
        tournamentId:t.id, fixtureId:f.id, oversLimit:t.oversLimit,
        badge: f.stage === 'league' ? t.name : f.stage.replace('-', ' '),
        type:'match'
      });
    });
  });

  const cutoff = dayStart(new Date()) - 86400000 * 2;   // keep very recent past visible
  return items
    .filter(i=>!i.date || new Date(i.date).getTime() >= cutoff)
    .sort((a,b)=>{
      if(a.date && b.date) return new Date(a.date) - new Date(b.date);
      return a.date ? -1 : 1;
    })
    .slice(0, limit);
}

function renderEventsWidget(){
  const items = upcomingItems();
  const box = $('eventsWidget');
  if(!items.length){
    box.innerHTML = `<div class="empty-note">Nothing scheduled.<br>Tap <b>+ Schedule</b> to add a match, or create a tournament with fixture dates.</div>`;
    return;
  }
  const today = dayStart(new Date());
  box.innerHTML = items.map(i=>{
    const d = i.date ? new Date(i.date) : null;
    const ds = d ? dayStart(d) : null;
    const cls = ds === today ? 'today' : (ds !== null && ds < today ? 'past' : '');
    const canStart = i.type === 'match';
    return `<div class="event-item ${cls}">
      <div class="event-date">
        <div class="d">${d ? d.getDate() : '–'}</div>
        <div class="m">${d ? MONTHS[d.getMonth()] : ''}</div>
      </div>
      <div class="event-body">
        <div class="event-title">${esc(i.title || 'Match')}</div>
        <div class="event-meta">${esc(fmtWhen(i.date))}${i.venue ? ' · ' + esc(i.venue) : ''}${i.badge ? ' · ' + esc(i.badge) : ''}</div>
      </div>
      <div class="event-cta">
        ${canStart ? `<button class="icon-btn" data-action="start-event" data-kind="${i.kind}" data-id="${esc(i.id)}">Start</button>` : ''}
        ${i.kind === 'event' ? `<button class="icon-btn" data-action="del-event" data-id="${esc(i.id)}" style="margin-left:4px;">&times;</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderRecent(){
  const all = mergedHistory().filter(m=>m.completed).slice(0,4);
  const box = $('recentResults');
  if(!all.length){ box.innerHTML = '<div class="empty-note">No completed matches yet.</div>'; return; }
  box.innerHTML = all.map(m=>{
    const perf = topPerformers(m);
    const bits = [];
    if(perf.topBat) bits.push(perf.topBat.name + ' ' + perf.topBat.runs + '(' + perf.topBat.balls + ')');
    if(perf.topBowl && perf.topBowl.wickets > 0) bits.push(perf.topBowl.name + ' ' + perf.topBowl.wickets + '/' + perf.topBowl.runs);
    return `<div class="hist-item" data-action="view-history" data-id="${esc(m.id)}">
      <div style="min-width:0;">
        <div class="batter-name">${esc(m.teamA)} v ${esc(m.teamB)}</div>
        <div class="d">${esc(m.resultText || '')}</div>
        ${bits.length ? `<div class="d" style="color:var(--gold-soft);">${esc(bits.join(' · '))}</div>` : ''}
      </div>
      <div class="d">${m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}</div>
    </div>`;
  }).join('');
}

function mergedHistory(){
  const seen = new Set(); const out = [];
  [...cloudMatches, ...historyList()].forEach(m=>{
    if(!m || !m.id || seen.has(m.id)) return;
    seen.add(m.id); out.push(m);
  });
  return out.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}

/* ---------------- SCHEDULE EVENT ---------------- */
function openScheduleModal(prefill){
  const p = prefill || {};
  const todayISO = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  openModal(`
    <h3>Schedule a match</h3>
    <label>Team A</label>
    <input type="text" id="evA" placeholder="Team name" maxlength="24" value="${esc(p.teamA||'')}">
    <div class="chip-row">${teams.slice(0,6).map(t=>`<div class="chip pick" data-fill="evA" data-value="${esc(t.name)}">${esc(t.name)}</div>`).join('')}</div>
    <label>Team B</label>
    <input type="text" id="evB" placeholder="Team name" maxlength="24" value="${esc(p.teamB||'')}">
    <div class="chip-row">${teams.slice(0,6).map(t=>`<div class="chip pick" data-fill="evB" data-value="${esc(t.name)}">${esc(t.name)}</div>`).join('')}</div>
    <div class="row">
      <div><label>Date</label><input type="date" id="evDate" value="${todayISO}"></div>
      <div><label>Time</label><input type="time" id="evTime" value="15:00"></div>
    </div>
    <label>Venue</label>
    <input type="text" id="evVenue" placeholder="Ground name" maxlength="40" value="${esc(p.venue||'')}">
    <label>Overs</label>
    <input type="number" id="evOvers" min="1" max="90" value="${p.oversLimit || 20}">
    <button class="btn" data-action="save-event">Add to Schedule</button>
    <button class="btn secondary" data-action="close">Cancel</button>
  `);
}

async function saveEventForm(){
  const a = $('evA').value.trim(), b = $('evB').value.trim();
  const date = $('evDate').value, time = $('evTime').value || '00:00';
  if(!a || !b){ toast('Enter both teams'); return; }
  if(!date){ toast('Pick a date'); return; }
  const ev = {
    id: makeId(), type:'match',
    title: a + ' v ' + b, teamA:a, teamB:b,
    date: new Date(date + 'T' + time).toISOString(),
    venue: $('evVenue').value.trim(),
    oversLimit: Math.max(1, parseInt($('evOvers').value || '20', 10)),
    done:false, createdAt: Date.now()
  };
  events.push(ev); saveEvents();
  if(cloudReady() && getUser()) await saveEvent(ev);
  closeModal(); renderHome();
  toast('Match scheduled');
}

async function removeEvent(id){
  events = events.filter(e=>e.id !== id); saveEvents();
  if(cloudReady() && getUser()) await deleteEvent(id);
  renderHome(); toast('Removed');
}

function startFromItem(kind, id){
  const items = upcomingItems(50);
  const it = items.find(x=>x.id === id && x.kind === kind);
  if(!it) return;
  setupPrefill = {
    teamA: it.teamA, teamB: it.teamB, venue: it.venue || '',
    oversLimit: it.oversLimit || 20,
    tournamentId: it.tournamentId || null, fixtureId: it.fixtureId || null,
    eventId: kind === 'event' ? it.id : null
  };
  go('setup');
}

/* ---------------- MATCH SETUP ---------------- */
function renderSetup(){
  const p = setupPrefill;
  const ctx = $('setupContext');
  if(p && (p.tournamentId || p.eventId)){
    const t = tournaments.find(x=>x.id === p.tournamentId);
    ctx.classList.remove('hidden');
    ctx.textContent = t ? 'Part of ' + t.name + ' — the result will update the table automatically.'
                        : 'Starting a scheduled match.';
  } else ctx.classList.add('hidden');

  if(p){
    $('teamAName').value = p.teamA || '';
    $('teamBName').value = p.teamB || '';
    $('matchVenue').value = p.venue || '';
    const sel = $('oversLimit');
    const opt = [...sel.options].find(o=>o.value === String(p.oversLimit));
    if(opt) sel.value = String(p.oversLimit);
    else { sel.value = '0'; $('customOversWrap').classList.remove('hidden'); $('customOvers').value = p.oversLimit; }
  }
  refreshLiveToggle();
  renderSetupPicks();
}

function refreshLiveToggle(){
  const can = cloudReady() && !!getUser();
  const t = $('liveShareToggle');
  t.disabled = !can;
  if(!can){ t.checked = false; }
  $('liveHint').textContent = can ? 'Spectators get a link that updates ball by ball'
    : (cloudReady() ? 'Sign in to share a live link' : 'Connect Supabase to share a live link');
}

function rosterFor(name){
  const t = teams.find(x=>x.name.trim().toLowerCase() === String(name||'').trim().toLowerCase());
  return t && Array.isArray(t.players) ? t.players : [];
}
function chipsHTML(inputId, values){
  return values.slice(0,12).map(v=>
    `<div class="chip pick" data-fill="${inputId}" data-value="${esc(v)}">${esc(v)}</div>`).join('');
}
function renderSetupPicks(){
  const names = teams.map(t=>t.name);
  $('teamAPicks').innerHTML = chipsHTML('teamAName', names);
  $('teamBPicks').innerHTML = chipsHTML('teamBName', names);
  const batting = rosterFor($('teamAName').value);
  const bowling = rosterFor($('teamBName').value);
  $('strikerPicks').innerHTML = chipsHTML('strikerName', batting);
  $('nonStrikerPicks').innerHTML = chipsHTML('nonStrikerName', batting);
  $('bowlerPicks').innerHTML = chipsHTML('bowlerName', bowling);
}

function openTossModal(){
  const A = ($('teamAName').value || 'Team A').trim();
  const B = ($('teamBName').value || 'Team B').trim();
  pendingToss = { winner:'A', decision:'bat' };
  openModal(`<h3>Toss</h3>
    <div class="stat-dim">Optional, but it gets recorded on the scorecard.</div>
    <label>Who won the toss?</label>
    <div class="toss-grid">
      <div class="toss-opt sel" data-toss-winner="A">${esc(A)}</div>
      <div class="toss-opt" data-toss-winner="B">${esc(B)}</div>
    </div>
    <label>And elected to</label>
    <div class="toss-grid">
      <div class="toss-opt sel" data-toss-decision="bat">Bat<span class="to-sub">bats first</span></div>
      <div class="toss-opt" data-toss-decision="bowl">Bowl<span class="to-sub">fields first</span></div>
    </div>
    <div class="stat-dim" id="tossPreview" style="margin-top:14px;"></div>
    <button class="btn" data-action="confirm-toss">Confirm &amp; Start</button>
    <button class="btn secondary" data-action="skip-toss">Skip the toss</button>`);
  updateTossPreview();
}

function updateTossPreview(){
  if(!pendingToss) return;
  const A = ($('teamAName').value || 'Team A').trim();
  const B = ($('teamBName').value || 'Team B').trim();
  const winner = pendingToss.winner === 'A' ? A : B;
  // whoever bats first becomes team A internally
  const batsFirst = (pendingToss.decision === 'bat')
    ? (pendingToss.winner === 'A' ? A : B)
    : (pendingToss.winner === 'A' ? B : A);
  const el = $('tossPreview');
  if(el) el.innerHTML = `${esc(winner)} won the toss and elected to ${pendingToss.decision}.<br>
    <b style="color:var(--gold-soft)">${esc(batsFirst)}</b> will bat first.`;
}

function pickToss(kind, val){
  if(!pendingToss) return;
  if(kind === 'winner') pendingToss.winner = val; else pendingToss.decision = val;
  document.querySelectorAll(`[data-toss-${kind}]`).forEach(el=>
    el.classList.toggle('sel', el.dataset['toss' + kind[0].toUpperCase() + kind.slice(1)] === val));
  updateTossPreview();
}

function startMatch(toss){
  // If the toss says the side listed second bats first, swap them so that
  // innings 1 is always the batting side. Keeps the engine model simple.
  if(toss){
    const winnerBatsFirst = toss.decision === 'bat';
    const firstIsA = (toss.winner === 'A') === winnerBatsFirst;
    if(!firstIsA){
      const a = $('teamAName').value, b = $('teamBName').value;
      $('teamAName').value = b; $('teamBName').value = a;
      toss = { winner: toss.winner === 'A' ? 'B' : 'A', decision: toss.decision };
    }
  }
  const sel = $('oversLimit').value;
  const oversLimit = sel === '0'
    ? Math.max(1, parseInt($('customOvers').value || '20', 10)) : parseInt(sel, 10);
  const p = setupPrefill || {};
  match = createMatch({
    teamA: ($('teamAName').value || 'Team A').trim(),
    teamB: ($('teamBName').value || 'Team B').trim(),
    oversLimit,
    allOutWickets: Math.max(1, Math.min(11, parseInt($('allOutWickets').value || '10', 10))),
    striker: ($('strikerName').value || 'Batter 1').trim(),
    nonStriker: ($('nonStrikerName').value || 'Batter 2').trim(),
    bowler: ($('bowlerName').value || 'Bowler 1').trim(),
    liveShare: $('liveShareToggle').checked && cloudReady() && !!getUser(),
    venue: $('matchVenue').value.trim(),
    tournamentId: p.tournamentId || null,
    fixtureId: p.fixtureId || null,
    eventId: p.eventId || null,
    toss: toss || null
  });
  // remember which tournament team ids this match maps to
  if(p.tournamentId && p.fixtureId){
    const t = tournaments.find(x=>x.id === p.tournamentId);
    const f = t && allFixtures(t).find(x=>x.id === p.fixtureId);
    if(f){ match.teamAId = f.teamAId; match.teamBId = f.teamBId; }
  }
  setupPrefill = null;
  undoStack = [];
  persistMatch();
  if(match.liveShare) pushLiveNow(match).then(ok=>ok && toast('Live link active'));
  go('live');
}

/* ---------------- BALL ACTIONS ---------------- */
function snapshot(){
  undoStack.push(JSON.stringify(match));
  if(undoStack.length > 250) undoStack.shift();
}
function afterBall(res){
  persistMatch();
  if(res.inningsOver){ handleInningsEnd(); return; }
  if(res.overJustEnded){ openNewBowlerModal(); return; }
  render();
}
function doRun(n){
  if(!match || match.completed) return;
  snapshot();
  afterBall(playBall(match, { extra:null, batRuns:n, isWicket:false }));
}
function undo(){
  if(!undoStack.length){ toast('Nothing to undo'); return; }
  match = JSON.parse(undoStack.pop());
  closeModal(); persistMatch(); render();
}
function manualSwap(){
  if(!match || match.completed) return;
  snapshot(); swapStrike(curInnings(match)); persistMatch(); render();
  toast('Strike swapped');
}

async function handleInningsEnd(){
  const stage = closeInnings(match);
  if(stage === 'break'){ openSecondInningsModal(); return; }

  finishMatch(match);
  pushHistory(match);
  await linkResultToTournament(match);
  if(match.eventId){
    const ev = events.find(e=>e.id === match.eventId);
    if(ev){ ev.done = true; saveEvents(); if(cloudReady() && getUser()) saveEvent(ev); }
  }
  if(cloudReady() && getUser()){
    saveMatchToCloud(match);
    if(match.liveShare) pushLiveNow(match);
  }
  undoStack = [];
  persistMatch();
  go('result');
}

async function linkResultToTournament(m){
  if(!m.tournamentId || !m.fixtureId) return;
  const t = tournaments.find(x=>x.id === m.tournamentId);
  if(!t) return;
  const f = allFixtures(t).find(x=>x.id === m.fixtureId);
  if(!f) return;
  const result = resultFromMatch(m, f.teamAId, f.teamBId);
  if(!result) return;
  applyResult(t, f.id, result, m.id);
  advanceKnockout(t);
  if(t.format !== 'league' && !t.knockout.length && leagueComplete(t)){
    t.knockout = generateKnockout(t);
  }
  saveTours();
  if(cloudReady() && getUser()) await saveTournament(t);
}

/* ---------------- MODALS ---------------- */
function closeModal(){ $('modalRoot').innerHTML = ''; }
function openModal(html){ $('modalRoot').innerHTML = `<div class="modal-overlay"><div class="modal">${html}</div></div>`; }

function openExtraModal(type){
  pendingExtra = type;
  const labels = { wd:'Wide', nb:'No Ball', b:'Bye', lb:'Leg Bye' };
  const note = { wd:'Extra runs run off the wide (0 = just the 1 wide run).',
                 nb:'Runs scored off the bat on the no ball.',
                 b:'Runs run as byes.', lb:'Runs run as leg byes.' };
  openModal(`<h3>${labels[type]}</h3>
    <div class="stat-dim">${note[type]}</div>
    <div class="chip-row" style="margin-top:12px;">
      ${[0,1,2,3,4,6].map(n=>`<div class="chip" data-action="extra-run" data-n="${n}">${n}</div>`).join('')}
    </div>
    <button class="btn secondary" data-action="close">Cancel</button>`);
}

function openWicketModal(){
  const inn = curInnings(match);
  const s = inn.batters[inn.strikerIdx], ns = inn.batters[inn.nonStrikerIdx];
  const last = (inn.wickets + 1) >= inn.allOutWickets;
  const roster = rosterFor(teamName(match, inn.battingTeam))
    .filter(p=>!inn.batters.some(b=>b.name.toLowerCase() === p.toLowerCase()));
  openModal(`<h3>Wicket</h3>
    <label>How out</label>
    <select id="wkType">${['Bowled','Caught','LBW','Run Out','Stumped','Hit Wicket','Retired Out']
      .map(t=>`<option value="${t}">${t}</option>`).join('')}</select>
    <label>Which batter</label>
    <div class="radio-line"><input type="radio" name="whoOut" value="striker" id="woS" checked>
      <label for="woS" style="margin:0;color:var(--ink);">${esc(s.name)} (striker)</label></div>
    <div class="radio-line"><input type="radio" name="whoOut" value="nonstriker" id="woN">
      <label for="woN" style="margin:0;color:var(--ink);">${esc(ns.name)} (non-striker)</label></div>
    <label>Runs completed before the dismissal</label>
    <input type="number" id="wkRuns" min="0" max="6" value="0">
    ${last ? '<div class="stat-dim" style="margin-top:12px;">Last wicket — the innings will close.</div>'
      : `<label>Incoming batter</label>
         <input type="text" id="wkNewBatter" placeholder="Next batter name" maxlength="20" autocomplete="off">
         <div class="chip-row">${chipsHTML('wkNewBatter', roster)}</div>`}
    <button class="btn danger" data-action="confirm-wicket">Confirm Wicket</button>
    <button class="btn secondary" data-action="close">Cancel</button>`);
}

function submitWicket(){
  const inn = curInnings(match);
  const last = (inn.wickets + 1) >= inn.allOutWickets;
  const newName = last ? '' : ($('wkNewBatter').value || '').trim();
  if(!last && !newName){ toast('Enter the incoming batter'); return; }
  const ball = {
    extra:null,
    batRuns: Math.max(0, parseInt($('wkRuns').value || '0', 10)),
    isWicket:true,
    wicketType: $('wkType').value,
    whoOut: document.querySelector('input[name=whoOut]:checked').value,
    newBatsmanName: newName
  };
  closeModal(); snapshot(); afterBall(playBall(match, ball));
}

function openNewBowlerModal(){
  const inn = curInnings(match);
  const prev = inn.prevBowlerIdx >= 0 ? inn.bowlers[inn.prevBowlerIdx].name : null;
  const quota = maxOversPerBowler(match);

  const all = Array.from(new Set([
    ...inn.bowlers.map(b=>b.name),
    ...rosterFor(teamName(match, inn.bowlingTeam))
  ]));
  const eligible = eligibleBowlers(match, all);

  // Show remaining overs against each name so the scorer can plan the innings.
  const chips = eligible.map(n=>{
    const b = inn.bowlers.find(x=>x.name.toLowerCase() === n.toLowerCase());
    const left = b ? bowlerRemaining(match, b) : quota;
    return `<div class="chip pick" data-fill="nbName" data-value="${esc(n)}">${esc(n)}
      <span style="color:var(--gold-soft);font-size:11px;">${left} left</span></div>`;
  }).join('');

  const spent = all.filter(n=>{
    const b = inn.bowlers.find(x=>x.name.toLowerCase() === n.toLowerCase());
    return b && bowlerExhausted(match, b);
  });

  openModal(`<h3>Over complete — next bowler</h3>
    <div class="stat-dim">Each bowler may bowl at most <b>${quota}</b> over${quota===1?'':'s'}
      in a ${match.oversLimit}-over innings.</div>
    ${prev ? `<div class="stat-dim" style="margin-top:6px;">${esc(prev)} bowled the last over and cannot bowl again now.</div>` : ''}
    ${spent.length ? `<div class="stat-dim" style="margin-top:6px;">Bowled out: ${spent.map(esc).join(', ')}</div>` : ''}
    <label>Bowler for the next over</label>
    <input type="text" id="nbName" placeholder="Bowler name" maxlength="20" autocomplete="off">
    <div class="chip-row">${chips || '<div class="stat-dim">No saved players left — type a name.</div>'}</div>
    <button class="btn" data-action="confirm-bowler">Continue</button>`);
}

function submitNewBowler(){
  const inn = curInnings(match);
  const name = ($('nbName').value || '').trim();
  if(!name){ toast('Enter the bowler name'); return; }
  const prev = inn.prevBowlerIdx >= 0 ? inn.bowlers[inn.prevBowlerIdx].name : null;
  if(prev && name.toLowerCase() === prev.toLowerCase()){
    toast('Same bowler cannot bowl consecutive overs'); return;
  }
  const existing = inn.bowlers.find(b=>b.name.toLowerCase() === name.toLowerCase());
  if(existing && bowlerExhausted(match, existing)){
    toast(existing.name + ' has bowled their full ' + maxOversPerBowler(match) + ' overs');
    return;
  }
  let i = inn.bowlers.findIndex(b=>b.name.toLowerCase() === name.toLowerCase());
  if(i === -1){ inn.bowlers.push(newBowler(name)); i = inn.bowlers.length - 1; }
  inn.bowlerIdx = i;
  closeModal(); persistMatch(); render();
}

function openSecondInningsModal(){
  const i1 = match.innings[0];
  const batNext = teamName(match, i1.bowlingTeam), bowlNext = teamName(match, i1.battingTeam);
  openModal(`<h3>Innings Break</h3>
    <div class="stat-dim">${esc(teamName(match, i1.battingTeam))} scored <b>${i1.runs}/${i1.wickets}</b>
      in ${fmtOvers(i1.legalBalls)} overs. ${esc(batNext)} need <b>${i1.runs + 1}</b> to win.</div>
    <label>Opening striker (${esc(batNext)})</label>
    <input type="text" id="si2Striker" placeholder="Batter 1" maxlength="20" autocomplete="off">
    <div class="chip-row">${chipsHTML('si2Striker', rosterFor(batNext))}</div>
    <label>Opening non-striker</label>
    <input type="text" id="si2NonStriker" placeholder="Batter 2" maxlength="20" autocomplete="off">
    <div class="chip-row">${chipsHTML('si2NonStriker', rosterFor(batNext))}</div>
    <label>Opening bowler (${esc(bowlNext)})</label>
    <input type="text" id="si2Bowler" placeholder="Bowler" maxlength="20" autocomplete="off">
    <div class="chip-row">${chipsHTML('si2Bowler', rosterFor(bowlNext))}</div>
    <button class="btn" data-action="confirm-innings2">Start 2nd Innings</button>`);
}

function submitSecondInnings(){
  startSecondInnings(match, {
    striker: ($('si2Striker').value || 'Batter 1').trim(),
    nonStriker: ($('si2NonStriker').value || 'Batter 2').trim(),
    bowler: ($('si2Bowler').value || 'Bowler 1').trim()
  });
  closeModal(); undoStack = []; persistMatch(); go('live');
}

function confirmEndInnings(){
  openModal(`<h3>End this innings now?</h3>
    <div class="stat-dim">Closes at the current score. Use for rain, declarations or a forfeit.</div>
    <button class="btn danger" data-action="confirm-end-innings">End Innings</button>
    <button class="btn secondary" data-action="close">Cancel</button>`);
}

function openSuperOverModal(parent){
  openModal(`<h3>Super Over</h3>
    <div class="stat-dim">${esc(parent.teamA)} and ${esc(parent.teamB)} finished level.
      A super over is one over each, two wickets and you are out.</div>
    <label>Striker (${esc(parent.teamA)})</label>
    <input type="text" id="soStriker" placeholder="Batter 1" maxlength="20" autocomplete="off">
    <label>Non-striker</label>
    <input type="text" id="soNonStriker" placeholder="Batter 2" maxlength="20" autocomplete="off">
    <label>Bowler (${esc(parent.teamB)})</label>
    <input type="text" id="soBowler" placeholder="Bowler" maxlength="20" autocomplete="off">
    <button class="btn gold" data-action="start-super-over" data-id="${esc(parent.id)}">Start Super Over</button>
    <button class="btn secondary" data-action="close">Cancel</button>`);
}

function startSuperOver(parentId){
  const parent = mergedHistory().find(m=>m.id === parentId) || match;
  if(!parent) return;
  match = createSuperOver(parent, {
    striker: ($('soStriker').value || 'Batter 1').trim(),
    nonStriker: ($('soNonStriker').value || 'Batter 2').trim(),
    bowler: ($('soBowler').value || 'Bowler 1').trim()
  });
  closeModal();
  undoStack = [];
  historyViewId = null;
  persistMatch();
  go('live');
  toast('Super over started');
}

/* ---------------- LIVE RENDER ---------------- */
function renderLive(){
  const inn = curInnings(match);
  $('liveContext').textContent = match.tournamentId
    ? (tournaments.find(t=>t.id === match.tournamentId)?.name || 'LIVE').toUpperCase() : 'LIVE';
  $('sbTeams').textContent = teamName(match, inn.battingTeam) + ' vs ' + teamName(match, inn.bowlingTeam);
  $('sbScore').innerHTML = inn.runs + '<span>/' + inn.wickets + '</span>';
  $('sbOvers').textContent = fmtOvers(inn.legalBalls) + ' / ' + match.oversLimit;
  $('sbCRR').textContent = runRate(inn.runs, inn.legalBalls);

  const chase = chaseInfo(match);
  if(chase){
    $('sbRRRWrap').classList.remove('hidden');
    $('sbRRR').textContent = chase.runsNeeded > 0 ? chase.rrr : '0.00';
    $('sbTarget').classList.remove('hidden');
    $('sbTarget').textContent = 'Need ' + Math.max(chase.runsNeeded,0) + ' from ' + Math.max(chase.ballsLeft,0) + ' balls';
  } else { $('sbRRRWrap').classList.add('hidden'); $('sbTarget').classList.add('hidden'); }

  $('overTrack').innerHTML = inn.thisOverBalls.length ? inn.thisOverBalls.map(b=>{
    let c = 'over-ball';
    if(b.wicket) c += ' wicket'; else if(b.four) c += ' four';
    else if(b.six) c += ' six'; else if(b.extra) c += ' extra';
    return `<div class="${c}">${esc(b.txt)}</div>`;
  }).join('') : '<div class="stat-dim">New over</div>';

  const st = inn.batters[inn.strikerIdx];
  $('battersBox').innerHTML = [st, inn.batters[inn.nonStrikerIdx]].map(b=>
    `<div class="batters"><span class="batter-name ${b === st ? 'on-strike':''}">${esc(b.name)}</span>
     <span class="stat-dim">${b.runs} (${b.balls}) · 4s ${b.fours} 6s ${b.sixes} · SR ${strikeRate(b)}</span></div>`).join('');

  const e = inn.extras;
  $('extrasLine').textContent = `Extras: ${e.wd+e.nb+e.b+e.lb} (wd ${e.wd}, nb ${e.nb}, b ${e.b}, lb ${e.lb})`;

  const bw = inn.bowlers[inn.bowlerIdx];
  const left = bowlerRemaining(match, bw);
  $('bowlerBox').innerHTML = `<div class="bowler-line">
    <span class="batter-name">${esc(bw.name)}</span>
    <span class="stat-dim">${fmtOvers(bw.legalBalls)} ov · ${bw.runs} r · ${bw.wickets} w · Econ ${bowlerEcon(bw)}
      · <b style="color:var(--gold-soft)">${left} ov left</b></span></div>`;

  renderMatchPulse();

  const panel = $('sharePanel');
  if(match.liveShare && cloudReady() && getUser()){
    panel.classList.remove('hidden');
    $('shareUrl').textContent = shareUrl(match.id);
  } else panel.classList.add('hidden');
}
function renderMatchPulse(){
  const inn = curInnings(match);
  const p = currentPartnership(match);
  const rec = recentRuns(match, 5);
  const proj = projectedScore(match);

  const cells = [
    { v: p ? p.runs + ' (' + p.balls + ')' : '—', l: 'Partnership' },
    { v: rec.overs ? rec.runs + ' in ' + rec.overs : '—', l: 'Last ' + (rec.overs || 5) + ' ov' },
    { v: proj !== null ? proj : '—', l: 'Projected' }
  ];
  $('pulseGrid').innerHTML = cells.map(c=>
    `<div class="pulse-cell"><div class="pv">${esc(c.v)}</div><div class="pl">${esc(c.l)}</div></div>`).join('');

  const overs = lastOvers(match, 6);
  $('recentOversStrip').innerHTML = overs.length
    ? overs.map(o=>{
        const cls = o.runs >= 12 ? ' hot' : (o.runs <= 3 ? ' cold' : '');
        return `<div class="ro-chip${cls}"><div class="rv">${o.runs}</div><div class="rl">Ov ${o.over}</div></div>`;
      }).join('')
    : '<div class="stat-dim" style="font-size:11.5px;">Over-by-over appears once the first over is done.</div>';

  const fow = inn.fow || [];
  $('fowStrip').innerHTML = fow.length
    ? '<div class="fow-line"><b>Fall of wickets:</b> ' +
        fow.map(f=>`${f.runs}-${f.wicket} (${esc(f.batter)}, ${fmtOvers(f.balls)})`).join(' &middot; ') +
      '</div>'
    : '';
}

function shareUrl(id){
  return location.origin + location.pathname.replace(/index\.html$/, '') + 'live.html?m=' + id;
}

/* ---------------- RESULT / SCORECARD ---------------- */
function scorecardHTML(m){
  return m.innings.map((inn,i)=>{
    const bat = inn.batters.map(b=>`<tr><td>${esc(b.name)}</td>
      <td class="stat-dim">${b.out ? esc(b.howOut) : 'not out'}</td>
      <td class="num">${b.runs}</td><td class="num">${b.balls}</td>
      <td class="num">${b.fours}</td><td class="num">${b.sixes}</td>
      <td class="num">${strikeRate(b)}</td></tr>`).join('');
    const bowl = inn.bowlers.filter(b=>b.legalBalls>0).map(b=>`<tr><td>${esc(b.name)}</td>
      <td class="num">${fmtOvers(b.legalBalls)}</td><td class="num">${b.maidens||0}</td>
      <td class="num">${b.runs}</td><td class="num">${b.wickets}</td>
      <td class="num">${bowlerEcon(b)}</td></tr>`).join('');
    const e = inn.extras;
    const bt = inn.battingTeam === 'A' ? m.teamA : m.teamB;
    return `<div class="card scard-inn">
      <h4>Innings ${i+1} — ${esc(bt)} ${inn.runs}/${inn.wickets} (${fmtOvers(inn.legalBalls)} ov)</h4>
      <div class="table-scroll"><table class="sc-table">
        <thead><tr><th>Batter</th><th>How out</th><th class="num">R</th><th class="num">B</th>
        <th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr></thead>
        <tbody>${bat}</tbody></table></div>
      <div class="stat-dim" style="margin-top:8px;">Extras ${e.wd+e.nb+e.b+e.lb} (wd ${e.wd}, nb ${e.nb}, b ${e.b}, lb ${e.lb})</div>
      <div class="table-scroll"><table class="sc-table" style="margin-top:12px;">
        <thead><tr><th>Bowler</th><th class="num">O</th><th class="num">M</th>
        <th class="num">R</th><th class="num">W</th><th class="num">Econ</th></tr></thead>
        <tbody>${bowl}</tbody></table></div>
    </div>`;
  }).join('');
}

function resultMatch(){
  return historyViewId !== null ? mergedHistory().find(m=>m.id === historyViewId) || null : match;
}
function renderResult(){
  const m = resultMatch();
  if(!m){ go('home'); return; }

  $('resultBadge').textContent = m.isSuperOver ? 'SUPER OVER' : (m.completed ? 'RESULT' : 'IN PROGRESS');
  $('resultHeadline').textContent = m.resultText || 'Match in progress';
  $('resultSub').textContent = m.resultSub || '';

  // innings score cards
  const winnerCode = winningSide(m);
  $('resultScores').innerHTML = m.innings.map(inn=>{
    const nm = inn.battingTeam === 'A' ? m.teamA : m.teamB;
    const won = winnerCode === inn.battingTeam;
    return `<div class="rh-score ${won ? 'won' : ''}">
      <div class="rs-team">${esc(nm)}</div>
      <div class="rs-val">${inn.runs}/${inn.wickets}</div>
      <div class="rs-ov">${fmtOvers(inn.legalBalls)} ov</div>
    </div>`;
  }).join('');

  // player of the match
  const potm = m.completed ? playerOfTheMatch(m) : null;
  const pb = $('potmBox');
  if(potm){
    pb.classList.remove('hidden');
    pb.innerHTML = `<div class="pm-l">Player of the match</div>
      <div class="pm-n">${esc(potm.name)}</div>
      <div class="pm-s">${esc(potm.line)}</div>`;
  } else pb.classList.add('hidden');

  // tabs
  document.querySelectorAll('#mcTabs .pill').forEach(p=>
    p.classList.toggle('active', p.dataset.mc === mcTab));
  $('mcScorecard').classList.toggle('hidden', mcTab !== 'scorecard');
  $('mcCommentary').classList.toggle('hidden', mcTab !== 'commentary');
  $('mcInfo').classList.toggle('hidden', mcTab !== 'info');

  if(mcTab === 'scorecard') $('mcScorecard').innerHTML = scorecardHTML(m);
  else if(mcTab === 'commentary') $('mcCommentary').innerHTML = commentaryHTML(m);
  else $('mcInfo').innerHTML = matchInfoHTML(m);

  const btn = $('resultActionBtn');
  if(historyViewId !== null){
    btn.textContent = 'Back to History';
    btn.onclick = ()=>{ historyViewId = null; go('history'); };
  } else {
    btn.textContent = 'New Match';
    btn.onclick = ()=>{ del(K.match); match = null; undoStack = []; setupPrefill = null; go('setup'); };
  }
  $('resultShareBtn').onclick = ()=>shareResult(m);

  // super over offer on a tie
  const so = $('superOverBtn');
  const tied = m.completed && /tied/i.test(m.resultText || '') && !m.isSuperOver && historyViewId === null;
  so.classList.toggle('hidden', !tied);
  so.onclick = ()=>openSuperOverModal(m);
}

function winningSide(m){
  if(!m.completed || m.innings.length < 2) return null;
  const [i1, i2] = m.innings;
  if(i1.runs > i2.runs) return i1.battingTeam;
  if(i2.runs > i1.runs) return i2.battingTeam;
  return null;
}

function commentaryHTML(m){
  const c = m.commentary || [];
  if(!c.length) return '<div class="card"><div class="empty-note">No commentary recorded.</div></div>';
  return `<div class="card"><div class="comm-group">
    <h5>Ball by ball &mdash; most recent first</h5>
    ${c.map(x=>{
      const mk = String(x.m || '');
      let cls = '';
      if(mk === 'W') cls = ' w';
      else if(mk === '4') cls = ' four';
      else if(mk === '6') cls = ' six';
      return `<div class="comm-row">
        <div class="comm-badge${cls}">${esc(mk)}</div>
        <div class="comm-body">
          <div class="cb-ov">${esc(x.ov)} ov</div>
          <div class="cb-tx">${esc(x.txt)}</div>
        </div>
      </div>`;
    }).join('')}
  </div></div>`;
}

function matchInfoHTML(m){
  const rows = [];
  rows.push(['Match', m.teamA + ' v ' + m.teamB]);
  if(m.toss) rows.push(['Toss', tossText(m)]);
  rows.push(['Format', m.oversLimit + ' overs a side']);
  rows.push(['All out at', m.allOutWickets + ' wickets']);
  if(m.venue) rows.push(['Venue', m.venue]);
  if(m.createdAt) rows.push(['Date', new Date(m.createdAt).toLocaleString()]);
  if(m.tournamentId){
    const t = tournaments.find(x=>x.id === m.tournamentId);
    if(t) rows.push(['Tournament', t.name]);
  }
  if(m.isSuperOver) rows.push(['Type', 'Super over']);

  m.innings.forEach((inn,i)=>{
    const nm = inn.battingTeam === 'A' ? m.teamA : m.teamB;
    const e = inn.extras;
    rows.push(['Innings ' + (i+1), nm + ' ' + inn.runs + '/' + inn.wickets + ' (' + fmtOvers(inn.legalBalls) + ')']);
    rows.push(['— extras', (e.wd+e.nb+e.b+e.lb) + ' (wd ' + e.wd + ', nb ' + e.nb + ', b ' + e.b + ', lb ' + e.lb + ')']);
    if((inn.fow || []).length){
      rows.push(['— fall of wickets', inn.fow.map(f=>f.runs + '-' + f.wicket).join(', ')]);
    }
    const best = (inn.partnerships || []).slice().sort((x,y)=>y.runs - x.runs)[0];
    if(best && best.runs > 0){
      rows.push(['— best stand', best.runs + ' (' + best.a + ' & ' + best.b + ')']);
    }
  });

  return `<div class="card">${rows.map(([k,v])=>
    `<div class="info-row"><span class="ir-k">${esc(k)}</span><span class="ir-v">${esc(v)}</span></div>`).join('')}</div>`;
}
async function shareResult(m){
  const l = [`${m.teamA} vs ${m.teamB}`, inningsLine(m,0), m.innings[1] ? inningsLine(m,1) : '', '', m.resultText]
    .filter(Boolean).join('\n');
  try{
    if(navigator.share){ await navigator.share({ title:'Cricket Connect — match result', text:l }); return; }
    await navigator.clipboard.writeText(l); toast('Result copied');
  }catch(e){ toast('Could not share'); }
}

/* ---------------- HISTORY ---------------- */
function renderHistory(){
  const all = mergedHistory();
  const box = $('historyList');
  if(!all.length){ box.innerHTML = '<div class="empty-note">No matches yet.</div>'; return; }
  box.innerHTML = all.map(m=>`<div class="hist-item" data-action="view-history" data-id="${esc(m.id)}">
    <div style="min-width:0;">
      <div class="batter-name">${esc(m.teamA)} v ${esc(m.teamB)}</div>
      <div class="d">${esc(m.resultText || 'In progress')}</div>
    </div>
    <div class="d">${m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}</div>
  </div>`).join('');
}

/* ---------------- STATS ---------------- */
function allCompletedMatches(){ return mergedHistory().filter(m=>m.completed); }

function renderStats(){
  const ms = allCompletedMatches();
  const sum = overallSummary(ms);
  $('statStrip').innerHTML = [
    { v: sum.matches, l: 'Matches' },
    { v: sum.runs,    l: 'Runs' },
    { v: sum.wickets, l: 'Wickets' },
    { v: sum.runRate, l: 'Run rate' }
  ].map(x=>`<div class="stat-box"><div class="sv">${x.v}</div><div class="sl">${x.l}</div></div>`).join('');

  document.querySelectorAll('#statsTabs .pill').forEach(p=>
    p.classList.toggle('active', p.dataset.st === statsTab));
  [['batting','stTabBatting'],['bowling','stTabBowling'],['teams','stTabTeams'],['best','stTabBest']]
    .forEach(([k,id])=>$(id).classList.toggle('hidden', statsTab !== k));

  if(!ms.length){
    const empty = '<div class="card"><div class="empty-note">No completed matches yet.<br>Records appear here once you finish a match.</div></div>';
    ['stTabBatting','stTabBowling','stTabTeams','stTabBest'].forEach(id=>$(id).innerHTML = empty);
    return;
  }

  const careers = buildCareers(ms);

  if(statsTab === 'batting'){
    $('stTabBatting').innerHTML =
      rankCard('Most runs', topRunScorers(careers, 10), p=>({
        val:p.runs, lab:'Runs',
        sub:`${p.innings} inns · SR ${p.strikeRate} · HS ${p.hsText}` +
            (p.average !== null ? ` · Avg ${p.average}` : '')
      })) +
      rankCard('Best average (min 3 inns)', bestAverages(careers, 3, 8), p=>({
        val:p.average, lab:'Avg', sub:`${p.runs} runs · ${p.innings} inns · HS ${p.hsText}`
      }));
  }
  else if(statsTab === 'bowling'){
    $('stTabBowling').innerHTML =
      rankCard('Most wickets', topWicketTakers(careers, 10), p=>({
        val:p.wickets, lab:'Wkts',
        sub:`${p.overs.toFixed(1)} ov · Econ ${p.economy} · Best ${p.best}` +
            (p.bowlAvg !== null ? ` · Avg ${p.bowlAvg}` : '')
      })) +
      rankCard('Best economy (min 5 ov)', bestEconomy(careers, 5, 8), p=>({
        val:p.economy, lab:'Econ', sub:`${p.wickets} wkts · ${p.overs.toFixed(1)} ov · ${p.runsConceded} runs`
      }));
  }
  else if(statsTab === 'teams'){
    const tr = teamRecords(ms);
    $('stTabTeams').innerHTML = `<div class="card">
      <div class="sec-head"><h2>Team Records</h2></div>
      <div class="table-scroll"><table class="table-std">
        <thead><tr><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">L</th>
        <th class="num">T</th><th class="num">Win %</th><th class="num">High</th></tr></thead>
        <tbody>${tr.map(t=>`<tr>
          <td class="team">${esc(t.name)}</td><td class="num">${t.played}</td>
          <td class="num">${t.won}</td><td class="num">${t.lost}</td><td class="num">${t.tied}</td>
          <td class="num"><b>${t.winPct}</b></td><td class="num">${t.highest}</td>
        </tr>`).join('')}</tbody>
      </table></div></div>`;
  }
  else {
    const bb = bestBattingPerformances(ms, 5);
    const bw = bestBowlingPerformances(ms, 5);
    $('stTabBest').innerHTML =
      rankCard('Best batting performances', bb, p=>({
        val:p.runs + (p.notOut ? '*' : ''), lab:'Runs',
        sub:`${p.balls} balls · vs ${p.vs}`, name:p.name
      })) +
      rankCard('Best bowling performances', bw, p=>({
        val:p.wickets + '/' + p.runs, lab:'Figures',
        sub:`${fmtOvers(p.balls)} ov · vs ${p.vs}`, name:p.name
      }));
  }
}

function rankCard(title, rows, fmt){
  if(!rows.length) return '';
  return `<div class="card">
    <div class="sec-head"><h2>${esc(title)}</h2></div>
    ${rows.map((p,i)=>{
      const f = fmt(p);
      return `<div class="rank-row">
        <div class="rank-no">${i+1}</div>
        <div class="rank-body">
          <div class="rank-name">${esc(f.name || p.name)}</div>
          <div class="rank-sub">${esc(f.sub)}</div>
        </div>
        <div class="rank-val"><div class="rv">${esc(f.val)}</div><div class="rl">${esc(f.lab)}</div></div>
      </div>`;
    }).join('')}
  </div>`;
}

/* ---------------- TEAMS ---------------- */
function renderTeams(){
  $('teamsHint').textContent = cloudReady() && getUser()
    ? 'Synced to your account and available on any device.'
    : 'Saved on this device. Sign in to sync across devices.';
  $('teamFormTitle').textContent = editingTeamId ? 'Edit Team' : 'Add Team';
  const list = $('teamsList');
  list.innerHTML = teams.length ? teams.map(t=>`
    <div class="hist-item">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        ${initialsBadge(t.name, 34)}
        <div style="min-width:0;">
          <div class="batter-name">${esc(t.name)}</div>
          <div class="d">${(t.players||[]).length} player${(t.players||[]).length===1?'':'s'}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="icon-btn" data-action="edit-team" data-id="${esc(t.id)}">Edit</button>
        <button class="icon-btn" data-action="del-team" data-id="${esc(t.id)}">&times;</button>
      </div>
    </div>`).join('')
    : '<div class="empty-note">No teams yet.<br>Add one below to speed up match setup.</div>';
  renderRoster();
}
function renderRoster(){
  $('teamFormRoster').innerHTML = teamFormRoster.length
    ? teamFormRoster.map((p,i)=>`<span class="roster-chip">${esc(p)}<button data-action="rm-player" data-i="${i}">&times;</button></span>`).join('')
    : '<div class="stat-dim">No players added yet.</div>';
}
function addPlayer(){
  const inp = $('teamFormPlayer'); const n = inp.value.trim();
  if(!n) return;
  if(teamFormRoster.some(p=>p.toLowerCase() === n.toLowerCase())){ toast('Already added'); return; }
  teamFormRoster.push(n); inp.value = ''; inp.focus(); renderRoster();
}
async function saveTeamForm(){
  const name = $('teamFormName').value.trim();
  if(!name){ toast('Enter a team name'); return; }
  const team = { id: editingTeamId || makeId(), name, players:[...teamFormRoster], updatedAt: Date.now() };
  const i = teams.findIndex(t=>t.id === team.id);
  if(i >= 0) teams[i] = team; else teams.push(team);
  saveTeams();
  if(cloudReady() && getUser()) await saveTeam(team);
  clearTeamForm(); renderTeams(); toast('Team saved');
}
function clearTeamForm(){
  editingTeamId = null; teamFormRoster = [];
  $('teamFormName').value = ''; $('teamFormPlayer').value = '';
  $('teamFormTitle').textContent = 'Add Team';
  renderRoster();
}
function editTeam(id){
  const t = teams.find(x=>x.id === id); if(!t) return;
  editingTeamId = t.id; teamFormRoster = [...(t.players||[])];
  $('teamFormName').value = t.name;
  $('teamFormTitle').textContent = 'Edit Team';
  renderRoster();
  $('teamFormName').scrollIntoView({ behavior:'smooth', block:'center' });
}
async function removeTeam(id){
  teams = teams.filter(t=>t.id !== id); saveTeams();
  if(cloudReady() && getUser()) await deleteTeam(id);
  if(editingTeamId === id) clearTeamForm();
  renderTeams(); toast('Team deleted');
}

/* ---------------- TOURNAMENTS ---------------- */
function renderTournaments(){
  const box = $('tournamentsList');
  if(!tournaments.length){
    box.innerHTML = `<div class="card"><div class="empty-note">
      No tournaments yet.<br>Tap <b>+ New</b> to create a league with an automatic points table.</div></div>`;
    return;
  }
  box.innerHTML = tournaments.map(t=>{
    const fx = allFixtures(t);
    const done = fx.filter(f=>f.status === 'completed').length;
    const champ = tournamentChampion(t);
    const badge = champ ? `<span class="badge done">Complete</span>`
      : done > 0 ? `<span class="badge live">In progress</span>`
      : `<span class="badge open">Not started</span>`;
    return `<div class="tour-card" data-action="open-tour" data-id="${esc(t.id)}">
      ${initialsBadge(t.name, 40)}
      <div class="tc-b">
        <div class="tc-n">${esc(t.name)}</div>
        <div class="tc-m">${t.teams.length} teams · ${done}/${fx.length} played · ${t.oversLimit} ov</div>
        <div style="margin-top:6px;">${badge}${champ ? ` <span class="badge done">🏆 ${esc(champ.name)}</span>` : ''}</div>
      </div>
      <div class="pc-go">›</div>
    </div>`;
  }).join('');
}

function openNewTournamentModal(){
  openModal(`<h3>New Tournament</h3>
    <label>Name</label>
    <input type="text" id="tName" placeholder="e.g. Ramzan Cup 2026" maxlength="34">
    <label>Format</label>
    <select id="tFormat">
      <option value="league-knockout">League + knockouts</option>
      <option value="league">League table only</option>
    </select>
    <div class="row">
      <div><label>Overs</label><input type="number" id="tOvers" min="1" max="90" value="20"></div>
      <div><label>All out at</label><input type="number" id="tWickets" min="1" max="11" value="10"></div>
    </div>
    <label>Teams (tap to include)</label>
    <div id="tTeamPick">${teams.length ? teams.map(t=>
      `<div class="list-pick" data-action="toggle-tteam" data-id="${esc(t.id)}">
        <div class="lp-n">${esc(t.name)}</div><div class="check" data-check="${esc(t.id)}"></div></div>`).join('')
      : '<div class="stat-dim">You have no saved teams. Add teams first, or type names below.</div>'}</div>
    <label>Or add a team by name</label>
    <div class="row">
      <input type="text" id="tAdHoc" placeholder="Team name" maxlength="24">
      <button class="icon-btn" data-action="add-adhoc-team" style="flex:0 0 auto;">Add</button>
    </div>
    <div id="tAdHocList" class="chip-row"></div>
    <label>Double round robin?</label>
    <select id="tLegs"><option value="1">No — play each team once</option>
      <option value="2">Yes — home and away</option></select>
    <button class="btn" data-action="create-tour">Create Tournament</button>
    <button class="btn secondary" data-action="close">Cancel</button>`);
  window.__tSelected = new Set();
  window.__tAdHoc = [];
}

function toggleTourTeam(id){
  const set = window.__tSelected;
  set.has(id) ? set.delete(id) : set.add(id);
  const el = document.querySelector(`[data-check="${id}"]`);
  if(el){ el.classList.toggle('on', set.has(id)); el.textContent = set.has(id) ? '✓' : ''; }
}
function addAdHocTeam(){
  const inp = $('tAdHoc'); const n = inp.value.trim();
  if(!n) return;
  window.__tAdHoc.push(n); inp.value = '';
  $('tAdHocList').innerHTML = window.__tAdHoc.map((x,i)=>
    `<span class="roster-chip">${esc(x)}<button data-action="rm-adhoc" data-i="${i}">&times;</button></span>`).join('');
}

async function createTournamentFromForm(){
  const name = $('tName').value.trim();
  if(!name){ toast('Enter a tournament name'); return; }
  const picked = teams.filter(t=>window.__tSelected.has(t.id)).map(t=>({ id:t.id, name:t.name }));
  const adhoc = (window.__tAdHoc || []).map(n=>({ id:makeId(), name:n }));
  const list = [...picked, ...adhoc];
  if(list.length < 2){ toast('Pick at least 2 teams'); return; }

  const t = createTournament({
    name, format: $('tFormat').value,
    oversLimit: Math.max(1, parseInt($('tOvers').value || '20', 10)),
    allOutWickets: Math.max(1, Math.min(11, parseInt($('tWickets').value || '10', 10))),
    teams: list
  });
  t.fixtures = generateRoundRobin(t, { legs: parseInt($('tLegs').value || '1', 10) });
  tournaments.unshift(t); saveTours();
  if(cloudReady() && getUser()) await saveTournament(t);
  closeModal();
  openTourId = t.id; tourTab = 'fixtures'; go('tournament');
  toast(t.fixtures.length + ' fixtures generated');
}

function currentTour(){ return tournaments.find(t=>t.id === openTourId) || null; }

function renderTournament(){
  const t = currentTour();
  if(!t){ go('tournaments'); return; }
  $('tourName').textContent = t.name;

  const champ = tournamentChampion(t);
  $('championBox').innerHTML = champ
    ? `<div class="champion-box"><div class="ct">🏆 Champions</div><div class="cn">${esc(champ.name)}</div></div>` : '';

  document.querySelectorAll('#screen-tournament .pill').forEach(p=>
    p.classList.toggle('active', p.dataset.tab === tourTab));
  ['table','fixtures','knockout','teams'].forEach(x=>
    $('tourTab' + x[0].toUpperCase() + x.slice(1)).classList.toggle('hidden', x !== tourTab));

  if(tourTab === 'table') renderTourTable(t);
  else if(tourTab === 'fixtures') renderTourFixtures(t);
  else if(tourTab === 'knockout') renderTourKnockout(t);
  else renderTourTeams(t);
}

function renderTourTable(t){
  const table = computeStandings(t);
  const qualifiers = t.format === 'league' ? 1 : Math.min(4, table.length);
  $('tourTabTable').innerHTML = `<div class="card">
    <div class="sec-head"><h2>Points Table</h2></div>
    <div class="table-scroll"><table class="table-std">
      <thead><tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">W</th>
      <th class="num">L</th><th class="num">T</th><th class="num">Pts</th><th class="num">NRR</th></tr></thead>
      <tbody>${table.map((r,i)=>`<tr class="${i < qualifiers && r.played > 0 ? 'qualified':''}">
        <td><span class="pos-chip">${i+1}</span></td>
        <td class="team">${esc(r.name)}</td>
        <td class="num">${r.played}</td><td class="num">${r.won}</td>
        <td class="num">${r.lost}</td><td class="num">${r.tied}</td>
        <td class="num"><b>${r.points}</b></td>
        <td class="num" style="color:${r.nrr>=0?'#7be0b8':'#ff9f9f'}">${formatNRR(r.nrr)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="stat-dim" style="margin-top:10px;">
      Win ${2} pts · Tie 1 pt. NRR follows the ICC rule: a side bowled out is charged the full quota of overs.
      ${t.format !== 'league' ? 'Top 4 shaded green qualify for the knockouts.' : ''}
    </div>
  </div>`;
}

function renderTourFixtures(t){
  const rows = t.fixtures.map(f=>fixtureRowHTML(t, f)).join('');
  $('tourTabFixtures').innerHTML = `<div class="card">
    <div class="sec-head"><h2>League Fixtures</h2>
      <button class="icon-btn" data-action="regen-fixtures">Regenerate</button></div>
    ${rows || '<div class="empty-note">No fixtures yet.</div>'}
  </div>`;
}

function fixtureRowHTML(t, f){
  const done = f.status === 'completed' && f.result;
  const a = teamNameById(t, f.teamAId), b = teamNameById(t, f.teamBId);
  const canPlay = f.teamAId && f.teamBId && !done;
  let score = '';
  if(done){
    const r = f.result;
    const win = r.winnerId === 'tie' ? 'Tied'
      : teamNameById(t, r.winnerId) + ' won';
    score = `<div class="fx-score">${a} ${r.a.runs}/${r.a.wickets} · ${b} ${r.b.runs}/${r.b.wickets} — ${esc(win)}</div>`;
  }
  return `<div class="fixture-row">
    <div class="fx-b">
      <div class="fx-t">${esc(a)} v ${esc(b)}</div>
      <div class="fx-m">${f.stage === 'league' ? 'Round ' + f.round : esc(f.stage.replace('-',' '))}
        ${f.date ? ' · ' + esc(fmtWhen(f.date)) : ''}${f.venue ? ' · ' + esc(f.venue) : ''}</div>
      ${score}
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      ${!done ? `<button class="icon-btn" data-action="set-fixture-date" data-id="${esc(f.id)}">Date</button>` : ''}
      ${canPlay ? `<button class="icon-btn" data-action="play-fixture" data-id="${esc(f.id)}">Play</button>` : ''}
      ${done ? `<button class="icon-btn" data-action="view-fixture" data-id="${esc(f.id)}">Card</button>` : ''}
    </div>
  </div>`;
}

function renderTourKnockout(t){
  const box = $('tourTabKnockout');
  if(t.format === 'league'){
    box.innerHTML = `<div class="card"><div class="empty-note">This is a league-only tournament.<br>The team top of the table wins it.</div></div>`;
    return;
  }
  if(!t.knockout || !t.knockout.length){
    const ready = leagueComplete(t);
    box.innerHTML = `<div class="card">
      <div class="empty-note">${ready
        ? 'League complete. Generate the knockout bracket from the final table.'
        : 'The bracket unlocks when every league fixture has been played.<br>You can also generate it early if you want.'}</div>
      <button class="btn" data-action="gen-knockout">Generate Knockout Bracket</button>
    </div>`;
    return;
  }
  const semis = t.knockout.filter(f=>f.stage === 'semi-final');
  const final = t.knockout.find(f=>f.stage === 'final');
  const side = (t2, f, which)=>{
    const id = which === 'a' ? f.teamAId : f.teamBId;
    const nm = id ? teamNameById(t2, id) : 'TBD';
    const r = f.result;
    const sc = r ? (which === 'a' ? `${r.a.runs}/${r.a.wickets}` : `${r.b.runs}/${r.b.wickets}`) : '';
    const win = r && r.winnerId === id;
    return `<div class="bm-side ${win ? 'win':''}"><span>${esc(nm)}${win ? ' ✓':''}</span><span class="s">${sc}</span></div>`;
  };
  const mk = (f, label)=>`<div class="bracket-match">
    <div class="stat-dim" style="font-size:10.5px;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">${label}</div>
    ${side(t, f, 'a')}${side(t, f, 'b')}
    <div style="display:flex;gap:6px;margin-top:8px;">
      ${f.teamAId && f.teamBId && f.status !== 'completed'
        ? `<button class="icon-btn" data-action="play-fixture" data-id="${esc(f.id)}">Play</button>` : ''}
      ${f.status === 'completed' ? `<button class="icon-btn" data-action="view-fixture" data-id="${esc(f.id)}">Card</button>` : ''}
    </div></div>`;

  box.innerHTML = `<div class="card"><div class="sec-head"><h2>Knockout</h2>
      <button class="icon-btn" data-action="gen-knockout">Reset bracket</button></div>
    <div class="bracket">
      ${semis.length ? `<div class="bracket-round"><h5>Semi-finals</h5>
        ${semis.map((f,i)=>mk(f, 'Semi-final ' + (i+1))).join('')}</div>` : ''}
      ${final ? `<div class="bracket-round"><h5>Final</h5>${mk(final, 'Final')}</div>` : ''}
    </div></div>`;
}

function renderTourTeams(t){
  $('tourTabTeams').innerHTML = `<div class="card">
    <div class="sec-head"><h2>Teams</h2></div>
    ${t.teams.map(tm=>`<div class="hist-item">
      <div style="display:flex;align-items:center;gap:10px;">
        ${initialsBadge(tm.name, 32)}<div class="batter-name">${esc(tm.name)}</div>
      </div>
      <div class="d">${(rosterFor(tm.name) || []).length} players</div>
    </div>`).join('')}
    <button class="btn secondary small" data-action="delete-tour">Delete this tournament</button>
  </div>`;
}

function playFixture(fixtureId){
  const t = currentTour(); if(!t) return;
  const f = allFixtures(t).find(x=>x.id === fixtureId); if(!f) return;
  setupPrefill = {
    teamA: teamNameById(t, f.teamAId), teamB: teamNameById(t, f.teamBId),
    venue: f.venue || '', oversLimit: t.oversLimit,
    tournamentId: t.id, fixtureId: f.id, eventId:null
  };
  $('allOutWickets').value = t.allOutWickets;
  go('setup');
}

function openFixtureDateModal(fixtureId){
  const t = currentTour(); if(!t) return;
  const f = allFixtures(t).find(x=>x.id === fixtureId); if(!f) return;
  const d = f.date ? new Date(f.date) : new Date();
  const iso = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString();
  openModal(`<h3>${esc(teamNameById(t,f.teamAId))} v ${esc(teamNameById(t,f.teamBId))}</h3>
    <div class="row">
      <div><label>Date</label><input type="date" id="fxDate" value="${iso.slice(0,10)}"></div>
      <div><label>Time</label><input type="time" id="fxTime" value="${iso.slice(11,16)}"></div>
    </div>
    <label>Venue</label>
    <input type="text" id="fxVenue" placeholder="Ground" maxlength="40" value="${esc(f.venue||'')}">
    <button class="btn" data-action="save-fixture-date" data-id="${esc(fixtureId)}">Save</button>
    <button class="btn secondary" data-action="close">Cancel</button>`);
}

async function saveFixtureDate(fixtureId){
  const t = currentTour(); if(!t) return;
  const f = allFixtures(t).find(x=>x.id === fixtureId); if(!f) return;
  const date = $('fxDate').value, time = $('fxTime').value || '00:00';
  f.date = date ? new Date(date + 'T' + time).toISOString() : null;
  f.venue = $('fxVenue').value.trim();
  t.updatedAt = Date.now();
  saveTours();
  if(cloudReady() && getUser()) await saveTournament(t);
  closeModal(); render(); toast('Fixture updated');
}

async function genKnockout(){
  const t = currentTour(); if(!t) return;
  t.knockout = generateKnockout(t);
  advanceKnockout(t);
  saveTours();
  if(cloudReady() && getUser()) await saveTournament(t);
  render(); toast('Bracket generated');
}

async function regenFixtures(){
  const t = currentTour(); if(!t) return;
  const played = t.fixtures.filter(f=>f.status === 'completed').length;
  if(played > 0){ toast('Cannot regenerate — matches already played'); return; }
  t.fixtures = generateRoundRobin(t, { legs:1 });
  saveTours();
  if(cloudReady() && getUser()) await saveTournament(t);
  render(); toast('Fixtures regenerated');
}

async function removeTournament(){
  const t = currentTour(); if(!t) return;
  tournaments = tournaments.filter(x=>x.id !== t.id);
  saveTours();
  if(cloudReady() && getUser()) await deleteTournament(t.id);
  openTourId = null; go('tournaments'); toast('Tournament deleted');
}

/* ---------------- export ---------------- */
function exportData(){
  const blob = new Blob([JSON.stringify({
    exportedAt:new Date().toISOString(), version:APP_VERSION,
    profile, teams, tournaments, events, matches: mergedHistory()
  }, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'cricket-connect-backup.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded');
}

/* ---------------- install prompt & connectivity ---------------- */
const LS_INSTALL_DISMISSED = 'cc_install_dismissed_v1';

function setupInstallPrompt(){
  const banner = $('installBanner');
  $('installMark').innerHTML = brandMark(34);

  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredInstall = e;
    if(!load(LS_INSTALL_DISMISSED, false)) banner.classList.remove('hidden');
  });

  $('installBtn').addEventListener('click', async ()=>{
    if(!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    deferredInstall = null;
    banner.classList.add('hidden');
    if(outcome === 'accepted') toast('Installing Cricket Connect');
  });

  $('installDismiss').addEventListener('click', ()=>{
    banner.classList.add('hidden');
    save(LS_INSTALL_DISMISSED, true);
  });

  window.addEventListener('appinstalled', ()=>{
    banner.classList.add('hidden');
    save(LS_INSTALL_DISMISSED, true);
  });
}

function setupConnectivity(){
  const b = $('offlineBanner');
  const paint = ()=>b.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', ()=>{ paint(); toast('Back online — syncing'); });
  window.addEventListener('offline', paint);
  paint();
}

/* ---------------- MASTER RENDER ---------------- */
const GATED = {
  setup:'start scoring', live:'score a match', teams:'build teams',
  tournaments:'run tournaments', tournament:'run tournaments',
  stats:'see your records', history:'see your match history',
  friends:'find and add friends', admin:'manage the platform'
};

function render(){
  paintBrandMarks();

  /* Anyone without an account is sent to the sign-in screen. */
  if(requiresAccount() && !isSignedIn() && GATED[screen]){
    screen = 'auth';
  }

  showScreen(screen);
  switch(screen){
    case 'auth': renderAuth(); break;
    case 'home': renderHome(); break;
    case 'setup': renderSetup(); break;
    case 'live': if(match) renderLive(); else go('home'); break;
    case 'result': renderResult(); break;
    case 'history': renderHistory(); break;
    case 'teams': renderTeams(); break;
    case 'tournaments': renderTournaments(); break;
    case 'tournament': renderTournament(); break;
    case 'stats': renderStats(); break;
    case 'profile': renderProfile(); break;
    case 'friends': renderFriends(); break;
    case 'admin':
      if(!isAdminUser){ go('home'); return; }
      renderAdmin();
      break;
  }
}

/* ---------------- EVENTS ---------------- */
function bind(){
  // tabs
  document.querySelectorAll('[data-tabnav]').forEach(b=>
    b.addEventListener('click', ()=>{
      historyViewId = null;
      const target = b.dataset.tabnav;
      go(target);
      if(target === 'friends') refreshFriendsData().then(renderFriends);
      else if(target === 'admin') refreshAdminData().then(renderAdmin);
    }));

  // auth
  $('segSignIn').addEventListener('click', ()=>setAuthMode('signin'));
  $('segSignUp').addEventListener('click', ()=>setAuthMode('signup'));
  $('authSubmitBtn').addEventListener('click', submitAuth);
  $('googleBtn').addEventListener('click', doGoogle);
  $('forgotBtn').addEventListener('click', doReset);
  $('authPassword').addEventListener('keydown', e=>{ if(e.key === 'Enter') submitAuth(); });

  // home
  $('homeProfile').addEventListener('click', ()=>go(getUser() || !cloudReady() ? 'profile' : 'auth'));
  $('resumeBanner').addEventListener('click', ()=>go('live'));
  $('addEventBtn').addEventListener('click', ()=>openScheduleModal());
  $('qaNewMatch').addEventListener('click', ()=>{ setupPrefill = null; go('setup'); });
  $('heroScore').addEventListener('click', ()=>{ setupPrefill = null; go('setup'); });
  $('heroTournament').addEventListener('click', ()=>go('tournaments'));
  $('fabNew').addEventListener('click', ()=>{
    if(match && !match.completed) go('live');
    else { setupPrefill = null; go('setup'); }
  });
  $('qaTournament').addEventListener('click', ()=>go('tournaments'));
  $('qaTeams').addEventListener('click', ()=>go('teams'));
  $('qaHistory').addEventListener('click', ()=>go('history'));

  // setup
  $('setupBack').addEventListener('click', ()=>go('home'));
  $('oversLimit').addEventListener('change', e=>
    $('customOversWrap').classList.toggle('hidden', e.target.value !== '0'));
  ['teamAName','teamBName'].forEach(id=>$(id).addEventListener('input', renderSetupPicks));
  $('startMatchBtn').addEventListener('click', ()=>openTossModal());
  $('viewAllHistoryBtn').addEventListener('click', ()=>go('history'));

  document.querySelectorAll('#mcTabs .pill').forEach(p=>
    p.addEventListener('click', ()=>{ mcTab = p.dataset.mc; render(); }));
  document.querySelectorAll('#statsTabs .pill').forEach(p=>
    p.addEventListener('click', ()=>{ statsTab = p.dataset.st; render(); }));

  // live
  $('liveHomeBtn').addEventListener('click', ()=>go('home'));
  document.querySelectorAll('.run-btn').forEach(b=>
    b.addEventListener('click', ()=>doRun(parseInt(b.dataset.run,10))));
  document.querySelectorAll('.extra-btn').forEach(b=>
    b.addEventListener('click', ()=>{ if(match && !match.completed) openExtraModal(b.dataset.extra); }));
  $('wicketBtn').addEventListener('click', ()=>{ if(match && !match.completed) openWicketModal(); });
  $('undoBtn').addEventListener('click', undo);
  $('swapStrikeBtn').addEventListener('click', manualSwap);
  $('endInningsBtn').addEventListener('click', ()=>{ if(match && !match.completed) confirmEndInnings(); });
  $('copyShareBtn').addEventListener('click', async ()=>{
    try{
      const url = shareUrl(match.id);
      if(navigator.share) await navigator.share({ title:'Watch live on Cricket Connect', url });
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    }catch(e){ toast('Could not copy'); }
  });
  $('liveShareToggle').addEventListener('change', async e=>{
    if(!match) return;
    match.liveShare = e.target.checked;
    persistMatch();
    if(match.liveShare){ await pushLiveNow(match); toast('Live link active'); }
    else { await stopLive(match.id); toast('Live sharing stopped'); }
    render();
  });

  // result
  $('resultBack').addEventListener('click', ()=>{ historyViewId = null; go('home'); });

  // teams
  $('addPlayerBtn').addEventListener('click', addPlayer);
  $('teamFormPlayer').addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); addPlayer(); } });
  $('saveTeamBtn').addEventListener('click', saveTeamForm);
  $('clearTeamFormBtn').addEventListener('click', ()=>{ clearTeamForm(); toast('Form cleared'); });

  // tournaments
  $('newTournamentBtn').addEventListener('click', openNewTournamentModal);
  $('tourBack').addEventListener('click', ()=>go('tournaments'));
  $('tourMenuBtn').addEventListener('click', ()=>{ tourTab = 'teams'; render(); });
  document.querySelectorAll('#screen-tournament .pill').forEach(p=>
    p.addEventListener('click', ()=>{ tourTab = p.dataset.tab; render(); }));

  // profile
  $('saveProfileBtn').addEventListener('click', saveProfileForm);
  $('photoUploadBtn').addEventListener('click', ()=>$('photoInput').click());
  $('photoRemoveBtn').addEventListener('click', removePhoto);
  $('photoInput').addEventListener('change', (e)=>{
    const f = e.target.files && e.target.files[0];
    if(f) handlePhotoPick(f);
    e.target.value = '';
  });
  $('exportDataBtn').addEventListener('click', exportData);

  // friends
  $('friendSearchBtn').addEventListener('click', doFriendSearch);
  $('friendSearchInput').addEventListener('keydown', e=>{ if(e.key === 'Enter') doFriendSearch(); });

  // delegated
  document.addEventListener('click', async (e)=>{
    const fill = e.target.closest('[data-fill]');
    if(fill){
      const input = $(fill.dataset.fill);
      if(input){ input.value = fill.dataset.value; input.dispatchEvent(new Event('input')); }
      return;
    }
    const av = e.target.closest('[data-avatar]');
    if(av){ authAvatar = av.dataset.avatar; renderAuth(); return; }
    const pav = e.target.closest('[data-pavatar]');
    if(pav){
      profile.avatarId = pav.dataset.avatarId || pav.dataset.pavatar;
      // choosing an icon replaces the photo, otherwise the tap looks ignored
      if(profile.photo){ delete profile.photo; toast('Photo replaced with icon'); }
      saveProfileLocal();
      if(cloudReady() && getUser()) saveProfile({ ...profile, photo:null });
      renderProfile(); renderHome(); return;
    }
    const tw = e.target.closest('[data-toss-winner]');
    if(tw){ pickToss('winner', tw.dataset.tossWinner); return; }
    const td = e.target.closest('[data-toss-decision]');
    if(td){ pickToss('decision', td.dataset.tossDecision); return; }

    const qa = e.target.closest('[data-qa]');
    if(qa){
      const item = QA.find(x=>x.id === qa.dataset.qa);
      if(item){
        if(item.act === 'schedule') openScheduleModal();
        else if(item.go){ if(item.go === 'setup') setupPrefill = null; go(item.go); }
      }
      return;
    }

    const el = e.target.closest('[data-action]');
    if(!el) return;
    const a = el.dataset.action;

    if(a === 'close') closeModal();
    else if(a === 'confirm-toss'){ const t = pendingToss; pendingToss = null; closeModal(); startMatch(t); }
    else if(a === 'skip-toss'){ pendingToss = null; closeModal(); startMatch(null); }
    else if(a === 'start-super-over') startSuperOver(el.dataset.id);
    else if(a === 'extra-run'){
      const n = parseInt(el.dataset.n,10); const type = pendingExtra; pendingExtra = null;
      closeModal(); snapshot(); afterBall(playBall(match, { extra:type, batRuns:n, isWicket:false }));
    }
    else if(a === 'confirm-wicket') submitWicket();
    else if(a === 'confirm-bowler') submitNewBowler();
    else if(a === 'confirm-innings2') submitSecondInnings();
    else if(a === 'confirm-end-innings'){ closeModal(); handleInningsEnd(); }
    else if(a === 'view-history'){ historyViewId = el.dataset.id; go('result'); }
    else if(a === 'edit-team') editTeam(el.dataset.id);
    else if(a === 'del-team') removeTeam(el.dataset.id);
    else if(a === 'rm-player'){ teamFormRoster.splice(parseInt(el.dataset.i,10),1); renderRoster(); }
    else if(a === 'save-event') saveEventForm();
    else if(a === 'del-event') removeEvent(el.dataset.id);
    else if(a === 'start-event') startFromItem(el.dataset.kind, el.dataset.id);
    else if(a === 'open-tour'){ openTourId = el.dataset.id; tourTab = 'table'; go('tournament'); }
    else if(a === 'toggle-tteam') toggleTourTeam(el.dataset.id);
    else if(a === 'add-adhoc-team') addAdHocTeam();
    else if(a === 'rm-adhoc'){
      window.__tAdHoc.splice(parseInt(el.dataset.i,10),1);
      $('tAdHocList').innerHTML = window.__tAdHoc.map((x,i)=>
        `<span class="roster-chip">${esc(x)}<button data-action="rm-adhoc" data-i="${i}">&times;</button></span>`).join('');
    }
    else if(a === 'create-tour') createTournamentFromForm();
    else if(a === 'play-fixture') playFixture(el.dataset.id);
    else if(a === 'set-fixture-date') openFixtureDateModal(el.dataset.id);
    else if(a === 'save-fixture-date') saveFixtureDate(el.dataset.id);
    else if(a === 'gen-knockout') genKnockout();
    else if(a === 'regen-fixtures') regenFixtures();
    else if(a === 'delete-tour') removeTournament();
    else if(a === 'view-fixture'){
      const t = currentTour();
      const f = t && allFixtures(t).find(x=>x.id === el.dataset.id);
      if(f && f.matchId){ historyViewId = f.matchId; go('result'); }
      else toast('No scorecard saved for this fixture');
    }
    else if(a === 'go-friends'){ go('friends'); refreshFriendsData().then(renderFriends); }
    else if(a === 'go-admin'){ go('admin'); refreshAdminData().then(renderAdmin); }
    else if(a === 'go-profile') go('profile');
    else if(a === 'send-friend') sendFriendReq(el.dataset.uid);
    else if(a === 'accept-friend') respondFriendReq(el.dataset.id, true);
    else if(a === 'decline-friend') respondFriendReq(el.dataset.id, false);
    else if(a === 'unfriend') unfriend(el.dataset.id);
    else if(a === 'submit-organiser-app') submitApplyOrganiser();
    else if(a === 'approve-app') approveApp(el.dataset.id);
    else if(a === 'reject-app') rejectApp(el.dataset.id);
  });
}

/* ---------------- BOOT ---------------- */
async function boot(){
  teams = load(K.teams, []);
  tournaments = load(K.tours, []);
  events = load(K.events, []);
  profile = load(K.profile, { displayName:'', avatarId:DEFAULT_AVATAR });
  match = load(K.match, null);

  bind();
  setupInstallPrompt();
  setupConnectivity();

  const configured = await initCloud();

  if(configured){
    await resumeRedirect();
    onAuth(async (user)=>{
      if(user){
        const p = await fetchProfile();
        if(p) profile = { displayName: p.displayName || profile.displayName, avatarId: p.avatarId || profile.avatarId };
        else await saveProfile(profile);
        saveProfileLocal();

        const [cm, ct, ctr, ce] = await Promise.all([
          fetchCloudMatches(), fetchTeams(), fetchTournaments(), fetchEvents()
        ]);
        cloudMatches = cm;
        mergeById(teams, ct);       saveTeams();
        mergeById(tournaments, ctr); saveTours();
        mergeById(events, ce);      saveEvents();
        if(match) saveMatchToCloud(match);
        if(screen === 'auth') screen = 'home';

        const [pub, admin] = await Promise.all([fetchMyPublicProfile(), isCurrentUserAdmin()]);
        myPublicProfile = pub;
        isAdminUser = admin;
        $('sideAdminBtn').classList.toggle('hidden', !isAdminUser);
        await refreshFriendsData();
        if(isAdminUser) await refreshAdminData();
      } else {
        cloudMatches = [];
        myPublicProfile = null; isAdminUser = false; myConnections = []; pendingApps = [];
        $('sideAdminBtn').classList.add('hidden');
      }
      render();
    });
  }

  // Manifest shortcuts and deep links: ?go=setup | tournaments | stats | teams
  const deep = new URLSearchParams(location.search).get('go');
  const allowed = ['setup','tournaments','stats','teams','history','profile'];

  if(configured && !getUser()) screen = 'auth';
  else if(deep && allowed.includes(deep)) screen = deep;
  else screen = 'home';

  if(deep) history.replaceState({}, '', location.pathname);
  render();
}

function mergeById(localArr, cloudArr){
  cloudArr.forEach(c=>{
    const i = localArr.findIndex(x=>x.id === c.id);
    if(i === -1) localArr.push(c);
    else if((c.updatedAt || 0) > (localArr[i].updatedAt || 0)) localArr[i] = c;
  });
}

boot();
