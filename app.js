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
  maxOversPerBowler, bowlerRemaining, bowlerExhausted, eligibleBowlers,
  allowedDismissalsFor
} from './engine.js';

import {
  createTournament, generateRoundRobin, resultFromMatch, applyResult,
  computeStandings, leagueComplete, generateKnockout, advanceKnockout,
  tournamentChampion, teamNameById, allFixtures, formatNRR, newFixture,
  STATUSES, deriveStatus, POINTS
} from './tournament.js';

import { AVATARS, DEFAULT_AVATAR, avatarSVG, initialsBadge, brandMark, brandLockup } from './avatars.js';

import {
  buildCareers, topRunScorers, topWicketTakers, bestAverages, bestEconomy,
  bestBattingPerformances, bestBowlingPerformances, teamRecords, overallSummary,
  findPlayer, matchesForPlayer, preferredFormat, derivedRole, teamsForPlayer,
  tournamentsForTeams
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
  fetchMyPublicProfile, fetchPublicProfile, saveMyPublicProfile, searchProfiles,
  fetchMyConnections, sendConnectionRequest, respondToConnection, removeConnection,
  submitOrganiserApplication, fetchMyOrganiserApplications,
  isCurrentUserAdmin, fetchPendingOrganiserApplications, countOrganisers,
  approveOrganiserApplication, rejectOrganiserApplication,
  fetchPlatformStats, fetchPlatformTournaments, dailyCheckIn, fetchPublicTournaments,
  fetchTournamentById,
  fetchLiveMatchesNow, watchAllLiveMatches, joinPresence, subscribeOnlineCount,
  submitFeedback, fetchAllFeedback, updateFeedbackStatus,
  fetchAllTournamentsAdmin, fetchAllMatchesAdmin, fetchAllProfilesAdmin,
  adminCancelTournament, adminCancelMatch, adminSetOrganiserStatus,
  fetchTopPlayers
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
let authGateReason = null;   // e.g. "access live scoring" — why render() bounced here
let authAvatar = DEFAULT_AVATAR;
let openTourId = null, tourTab = 'overview';
let viewedTournamentPublic = null;   // non-owned tournament fetched for read-only viewing
let tourLoading = false;
let tourLoadError = '';
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
let adminOverview = { organisers:0, tournaments:0, matches:0, liveMatches:0, liveTournaments:0 };
let adminLoadError = null;      // set to an Error when the last refreshAdminData() failed
let adminLoading = false;
let adminTab = 'overview';
let adminMatchFilter = 'all';
let adminFeedbackFilter = 'all';
let adminFeedbackTypeFilter = '';
let adminTourSearch = '', adminTourStatusFilter = '', adminTourLocationFilter = '';
let adminUserSearch = '';
let adminTournamentsAll = [];   // [{ id, ownerId, tournament, updatedAt }]
let adminMatchesAll = [];       // [{ id, ownerId, match, cancelled, updatedAt }]
let adminProfilesAll = [];      // raw profile rows
let adminFeedbackAll = [];      // raw feedback rows
let adminLiveNowById = {};      // id -> { match, location, updatedAt } — from live_matches, the
                                 // only source with genuine per-ball freshness (see note below)
let adminLiveUnsub = null;      // realtime teardown, mirrors liveNowUnsub/onlineUnsub

// Stale-live thresholds, in seconds — deliberately named constants, not
// magic numbers buried in the render function, so they're easy to retune.
// This is an admin-facing warning only: nothing here ever auto-ends a
// match, matching the brief ("do not automatically stop a match").
const STALE_WARN_SECONDS = 90;     // 🟡 no update for a couple of minutes
const STALE_DANGER_SECONDS = 300;  // 🔴 potentially stale
let liveNowMatches = [];      // [{ id, match, location, updatedAt }] — currently-live, all users
let liveNowFilter = '';
let liveNowUnsub = null;      // realtime unsubscribe for the Live Now screen
let onlineCount = null;       // live presence count, shown on the admin dashboard
let onlineUnsub = null;
let viewedPlayer = null;      // { uid, name, isSelf } — who the player screen is showing
let playerTab = 'overview';
let playerReturnScreen = 'home';

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
/* Small day/month "date chip" (reuses the existing .event-date component
   styling) — used on tournament cards so the date reads at a glance instead
   of only inside a text line. Falls back to a "?" chip when no date is set
   yet, same honesty rule as everywhere else (no invented date). */
function dateChipHTML(iso){
  if(!iso) return `<div class="event-date"><div class="d">?</div><div class="m">TBC</div></div>`;
  const d = new Date(iso);
  return `<div class="event-date"><div class="d">${d.getDate()}</div><div class="m">${MONTHS[d.getMonth()]}</div></div>`;
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
const SCREENS = ['auth','home','setup','live','result','history','teams','tournaments','tournament','stats','profile','friends','admin','player','live-now','feedback'];
const TAB_OF = { home:'home', tournaments:'tournaments', tournament:'tournaments',
                 teams:'teams', stats:'profile', history:'history', profile:'profile',
                 friends:'friends', admin:'admin', 'live-now':'live-now' };

function go(s){ screen = s; render(); window.scrollTo(0,0); }

function showScreen(name){
  const isLive = match && !match.completed;
  const lp = $('sideLive');
  if(lp) lp.style.display = isLive ? '' : 'none';
  const tl = $('tabLive');
  if(tl) tl.style.display = isLive ? '' : 'none';
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

/* ---------------- Desktop sidebar account menu ----------------
   Guest: Login / Create account.
   Signed in: Dashboard, My Profile, My Teams, My Tournaments, Rankings,
   Settings, Logout. Only rendered/used at the desktop (>=1024px) sidebar —
   mobile reaches the same destinations via the Profile screen itself. */
function renderSidebarAccount(){
  const u = getUser();
  $('saAvatar').innerHTML = avatarHTML(30);
  $('saName').textContent = u ? displayName() : 'Guest';
  $('saSub').textContent = !cloudReady() ? 'Local only'
    : u ? 'Signed in' : 'Not signed in';

  const menu = $('saMenu');
  if(u){
    menu.innerHTML = `
      <button data-sa="home">Dashboard</button>
      <button data-sa="profile">My Profile</button>
      <button data-sa="teams">My Teams</button>
      <button data-sa="tournaments">My Tournaments</button>
      <button data-sa="stats">Rankings</button>
      <button data-sa="settings">Settings</button>
      <button data-sa="logout" class="sa-danger">Logout</button>`;
  } else {
    menu.innerHTML = `
      <button data-sa="login">Login</button>
      <button data-sa="signup">Create account</button>`;
  }
  menu.querySelectorAll('[data-sa]').forEach(b=>
    b.addEventListener('click', ()=>{
      menu.classList.add('hidden');
      const action = b.dataset.sa;
      if(action === 'logout'){ signOutUser().then(()=>{ toast('Signed out'); go('auth'); }); return; }
      if(action === 'login'){ setAuthMode('signin'); go('auth'); return; }
      if(action === 'signup'){ setAuthMode('signup'); go('auth'); return; }
      if(action === 'settings'){ go('profile'); return; }
      go(action);
    }));
}

function renderAuth(){
  const notice = $('authGateNotice');
  if(authGateReason){
    notice.classList.remove('hidden');
    $('authGateText').textContent = 'Please sign in to ' + authGateReason + '.';
  } else {
    notice.classList.add('hidden');
  }
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
      profile = {
        displayName:name, avatarId:authAvatar,
        country: $('authCountry').value.trim(),
        region: $('authRegion').value.trim(),
        district: $('authDistrict').value.trim(),
        area: $('authArea').value.trim()
      };
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
  $('profileRewardsStrip').classList.toggle('hidden', !myPublicProfile);
  if(myPublicProfile){
    $('profilePoints').textContent = myPublicProfile.points || 0;
    $('profileStreak').textContent = myPublicProfile.streakCurrent || 0;
    $('profileBestStreak').textContent = myPublicProfile.streakLongest || 0;
  }
  $('profileNameInput').value = profile.displayName || (u && u.displayName) || '';
  $('profileHandleInput').value = (myPublicProfile && myPublicProfile.handle) || '';
  // local `profile` wins over myPublicProfile here (not the other way like
  // handle) since it's updated in place the moment the form is saved, while
  // myPublicProfile is only refetched when the handle itself changes.
  $('profileCountryInput').value = profile.country || (myPublicProfile && myPublicProfile.country) || '';
  $('profileRegionInput').value = profile.region || (myPublicProfile && myPublicProfile.region) || '';
  $('profileDistrictInput').value = profile.district || (myPublicProfile && myPublicProfile.district) || '';
  $('profileAreaInput').value = profile.area || (myPublicProfile && myPublicProfile.area) || '';
  $('profilePrimaryRoleInput').value = (myPublicProfile && myPublicProfile.primaryRole) || '';
  $('profileBattingStyleInput').value = (myPublicProfile && myPublicProfile.battingStyle) || '';
  $('profileBowlingStyleInput').value = (myPublicProfile && myPublicProfile.bowlingStyle) || '';
  $('playingIdentityHint').classList.toggle('hidden', !!(myPublicProfile && myPublicProfile.handle));
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
  $('feedbackCard').classList.toggle('hidden', !isSignedIn());

  // Identity should be unambiguous about elevated access, not just a hidden
  // "Admin dashboard" button an admin might miss — shown here regardless of
  // which tab they're on. Ordinary players get no role line at all.
  const roleLine = $('profileRoleLine');
  if(isAdminUser){ roleLine.textContent = 'Role: Administrator'; roleLine.classList.remove('hidden'); }
  else if(isOrganiser){ roleLine.textContent = 'Role: Organiser'; roleLine.classList.remove('hidden'); }
  else roleLine.classList.add('hidden');

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
  profile.country = $('profileCountryInput').value.trim();
  profile.region = $('profileRegionInput').value.trim();
  profile.district = $('profileDistrictInput').value.trim();
  profile.area = $('profileAreaInput').value.trim();
  saveProfileLocal();
  if(cloudReady() && getUser()){
    await changeDisplayName(profile.displayName);
    await saveProfile(profile);

    const rawHandle = $('profileHandleInput').value.trim();
    const currentHandle = myPublicProfile && myPublicProfile.handle;
    const battingStyle = $('profileBattingStyleInput').value;
    const bowlingStyle = $('profileBowlingStyleInput').value;
    const primaryRole = $('profilePrimaryRoleInput').value;
    const handleChanging = rawHandle && rawHandle !== currentHandle;
    let handleToUse = currentHandle || null;
    if(handleChanging){
      const v = validateHandle(rawHandle);
      if(!v.ok){ toast(v.error); renderProfile(); return; }
      handleToUse = v.handle;
    }
    // Playing identity lives on the same public-profile row as the handle,
    // so it only actually persists once a handle exists (or is being set
    // right now) — playingIdentityHint above explains this in the UI.
    const identityChanging = handleChanging
      || battingStyle !== ((myPublicProfile && myPublicProfile.battingStyle) || '')
      || bowlingStyle !== ((myPublicProfile && myPublicProfile.bowlingStyle) || '')
      || primaryRole  !== ((myPublicProfile && myPublicProfile.primaryRole)  || '');
    if(identityChanging && handleToUse){
      const res = await saveMyPublicProfile({
        handle: handleToUse, displayName: profile.displayName,
        avatarId: profile.avatarId, bio: (myPublicProfile && myPublicProfile.bio) || '',
        battingStyle, bowlingStyle, primaryRole
      });
      if(!res.ok){ toast(res.error); renderProfile(); return; }
      myPublicProfile = await fetchMyPublicProfile();
      if(handleChanging) toast('Username saved');
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
      <div class="lp-identity" data-action="view-player" data-uid="${esc(p.uid)}" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer;">
        ${initialsBadge(p.displayName || p.handle, 34)}
        <div class="lp-n">${esc(p.displayName || '')} <span class="stat-dim">@${esc(p.handle)}</span></div>
      </div>
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
      <div class="lp-identity" data-action="view-player" data-uid="${esc(other)}" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer;">
        ${initialsBadge(p.displayName || p.handle, 34)}
        <div class="lp-n">${esc(p.displayName || '')} <span class="stat-dim">@${esc(p.handle)}</span></div>
      </div>
      <button class="icon-btn" data-action="accept-friend" data-id="${esc(c.id)}">Accept</button>
      <button class="icon-btn" data-action="decline-friend" data-id="${esc(c.id)}">Decline</button>
    </div>`;
  }).join('');

  const accepted = myConnections.filter(c=>c.status === 'accepted');
  $('friendsList').innerHTML = accepted.length ? accepted.map(c=>{
    const other = c.members.find(m=>m !== me);
    const p = profileCache[other] || { displayName:'Player', handle:'' };
    return `<div class="list-pick">
      <div class="lp-identity" data-action="view-player" data-uid="${esc(other)}" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer;">
        ${initialsBadge(p.displayName || p.handle, 34)}
        <div class="lp-n">${esc(p.displayName || '')} <span class="stat-dim">@${esc(p.handle)}</span></div>
      </div>
      <button class="icon-btn" data-action="unfriend" data-id="${esc(c.id)}">Remove</button>
    </div>`;
  }).join('') : '<div class="empty-note">No friends yet — search a username above.</div>';
}

async function doFriendSearch(){
  const q = $('friendSearchInput').value.trim();
  if(!q){ friendResults = []; renderFriends(); return; }
  friendResults = await searchProfiles(q);
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

/* ---------------- daily rewards ----------------
   Called once per sign-in — daily_check_in() is cheap and idempotent
   server-side, so there's no need to pre-check the date on the client (and
   it sidesteps any client/server timezone mismatch near midnight). */
async function runDailyCheckIn(){
  const reward = await dailyCheckIn();
  if(!reward || !myPublicProfile) return;
  myPublicProfile.points = reward.points;
  myPublicProfile.streakCurrent = reward.streakCurrent;
  myPublicProfile.streakLongest = reward.streakLongest;
  if(reward.awarded > 0){
    if(reward.milestone) toast(reward.milestone + '-day streak! +' + reward.awarded + ' points \u{1F525}');
    else toast('Day ' + reward.streakCurrent + ' streak — +' + reward.awarded + ' points');
  }
  renderHome(); renderProfile();
}

/* Admin authorization note: every action below (cancel tournament/cancel
   match/approve-reject organiser/set organiser status/review feedback) is
   also independently enforced server-side — either by a SECURITY DEFINER
   function that re-checks is_admin() itself (admin_cancel_tournament,
   admin_cancel_match, approve/reject_organiser_application) or by an RLS
   policy scoped to public.is_admin() (profiles update, feedback update,
   admin read-all on tournaments/matches/teams/events). isAdminUser here is a
   UI convenience for what to show — it is never the actual security
   boundary. A non-admin calling any of these directly gets rejected by the
   database, not just a hidden button. */

async function refreshAdminData(){
  if(!isAdminUser) return;
  adminLoading = true; adminLoadError = null;
  try{
    const [apps, orgCount, platformStats, tours, matchesAdmin, profilesAdmin, feedbackAll, liveNow] = await Promise.all([
      fetchPendingOrganiserApplications(), countOrganisers(), fetchPlatformStats(),
      fetchAllTournamentsAdmin(), fetchAllMatchesAdmin(), fetchAllProfilesAdmin(), fetchAllFeedback(),
      fetchLiveMatchesNow()
    ]);
    pendingApps = apps;
    adminOverview.organisers = orgCount;
    adminOverview.tournaments = platformStats.tournaments;
    adminOverview.matches = platformStats.matches;
    adminOverview.liveMatches = platformStats.liveMatches;
    adminOverview.liveTournaments = platformStats.liveTournaments;
    adminTournamentsAll = tours;
    adminMatchesAll = matchesAdmin;
    adminProfilesAll = profilesAdmin;
    adminFeedbackAll = feedbackAll;
    applyLiveNowSnapshot(liveNow);
    await resolveProfiles([
      ...pendingApps.map(a=>a.uid),
      ...tours.map(t=>t.ownerId), ...matchesAdmin.map(m=>m.ownerId), ...feedbackAll.map(f=>f.user_id)
    ]);
  } catch(err){
    // Deliberately don't clear the previous values on failure — better to
    // show slightly stale numbers behind a clear "this may be out of date"
    // banner than to flash everything to 0 and have that read as real data.
    console.error('refreshAdminData failed:', err);
    adminLoadError = err;
  } finally {
    adminLoading = false;
  }
}

/* Keeps adminLiveNowById in sync with the freshest live_matches rows. This is
   the only source with genuine per-ball freshness — score/wickets/overs on
   the `matches` table snapshot (adminMatchesAll) is only ever written at
   innings checkpoints, so a match mid-over would show stale numbers there.
   Kept as a small side table, keyed by id, rather than merged into
   adminMatchesAll, so a live_matches realtime tick can update just this
   without re-fetching the larger matches/tournaments/profiles/feedback
   tables (per the brief's "avoid unnecessary database requests" note). */
function applyLiveNowSnapshot(rows){
  adminLiveNowById = {};
  rows.forEach(r=>{ adminLiveNowById[r.id] = r; });
}

async function refreshAdminLiveNow(){
  if(!isAdminUser) return;
  try{
    applyLiveNowSnapshot(await fetchLiveMatchesNow());
  }catch(err){
    console.error('refreshAdminLiveNow failed:', err);
  }
  if(screen === 'admin' && adminTab === 'matches') renderAdminMatches();
  if(screen === 'admin' && adminTab === 'overview') renderAdminOverview();
}

/* "12 seconds ago" / "4 minutes ago" — small and local to admin, since it's
   only needed for the Live Match Control Center's last-updated line. */
function timeAgoShort(iso){
  if(!iso) return 'unknown';
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if(secs < 5) return 'just now';
  if(secs < 60) return secs + ' second' + (secs===1?'':'s') + ' ago';
  const mins = Math.round(secs / 60);
  if(mins < 60) return mins + ' minute' + (mins===1?'':'s') + ' ago';
  const hrs = Math.round(mins / 60);
  return hrs + ' hour' + (hrs===1?'':'s') + ' ago';
}

/* Admin warning only — never used to stop or otherwise act on a match, just
   to flag one for a human to look at. Thresholds are the two named
   constants near the top of this file; retune there, not here. */
function staleness(iso){
  if(!iso) return { cls:'stale-unknown', label:'⚪ No data' };
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if(secs < STALE_WARN_SECONDS) return { cls:'stale-ok', label:'🟢 Active' };
  if(secs < STALE_DANGER_SECONDS) return { cls:'stale-warn', label:'🟡 No update for a few minutes' };
  return { cls:'stale-danger', label:'🔴 Potentially stale' };
}

function renderAdmin(){
  const errBox = $('adminErrorBox');
  errBox.classList.toggle('hidden', !adminLoadError);
  if(adminLoadError){
    $('adminErrorText').textContent = 'Something went wrong talking to the database. Numbers below may be out of date or incomplete.';
    // Surface the actual Supabase/Postgres error (message + code) instead of
    // only a generic line — "relation does not exist" / "permission denied"
    // / "column does not exist" all look identical in the generic message
    // above, and previously only ever reached the browser console, which
    // isn't visible on a phone. This turns "something's wrong" into
    // something a screenshot can actually be diagnosed from.
    const detailEl = $('adminErrorDetail');
    const detail = adminLoadError.message
      ? adminLoadError.message + (adminLoadError.code ? ' (code ' + adminLoadError.code + ')' : '')
      : String(adminLoadError);
    detailEl.textContent = detail;
    detailEl.classList.toggle('hidden', !detail);
  }
  $('adminRefreshBtn').disabled = adminLoading;
  $('adminRefreshBtn').textContent = adminLoading ? 'Refreshing…' : '⟲ Refresh';

  $('adminStatPending').textContent = pendingApps.length;
  $('adminStatOrganisers').textContent = adminOverview.organisers;
  $('adminStatTournaments').textContent = adminOverview.tournaments;
  $('adminStatMatches').textContent = adminOverview.matches;
  $('adminStatLiveMatches').textContent = adminOverview.liveMatches;
  $('adminStatLiveTournaments').textContent = adminOverview.liveTournaments;

  // Live presence count updates on its own timer (join/leave events), not
  // tied to the refreshAdminData() pull above — subscribe once per visit to
  // the admin screen (render() tears it down on navigating away).
  if(!onlineUnsub){
    $('adminStatOnline').textContent = '…';
    onlineUnsub = subscribeOnlineCount(count=>{ $('adminStatOnline').textContent = count; });
  }

  // Live Match Control Center freshness: a dedicated live_matches
  // subscription so scores/overs update as balls are bowled, without
  // re-polling the larger matches/tournaments/profiles/feedback tables that
  // refreshAdminData() covers. Subscribed once per admin visit, torn down
  // on leaving the admin screen (same pattern as onlineUnsub above).
  if(!adminLiveUnsub){
    adminLiveUnsub = watchAllLiveMatches(()=>{ if(screen === 'admin') refreshAdminLiveNow(); });
  }

  ['overview','tournaments','matches','organisers','users','feedback','activity'].forEach(x=>
    $('adminTab' + x[0].toUpperCase() + x.slice(1)).classList.toggle('hidden', x !== adminTab));
  document.querySelectorAll('#adminTabs .pill').forEach(p=>p.classList.toggle('active', p.dataset.atab === adminTab));

  if(adminTab === 'overview') renderAdminOverview();
  else if(adminTab === 'tournaments') renderAdminTournaments();
  else if(adminTab === 'matches') renderAdminMatches();
  else if(adminTab === 'organisers') renderAdminOrganisers();
  else if(adminTab === 'users') renderAdminUsers();
  else if(adminTab === 'feedback') renderAdminFeedback();
  else if(adminTab === 'activity') renderAdminActivity();
}

function renderAdminOverview(){
  const items = [];
  if(pendingApps.length) items.push({
    text: pendingApps.length + ' organiser application' + (pendingApps.length===1?'':'s') + ' awaiting review',
    go: ()=>{ adminTab = 'organisers'; renderAdmin(); }
  });
  const newFeedback = adminFeedbackAll.filter(f=>f.status === 'new').length;
  if(newFeedback) items.push({
    text: newFeedback + ' new feedback submission' + (newFeedback===1?'':'s'),
    go: ()=>{ adminTab = 'feedback'; renderAdmin(); }
  });
  if(adminOverview.liveMatches) items.push({
    text: adminOverview.liveMatches + ' match' + (adminOverview.liveMatches===1?'':'es') + ' live right now',
    go: ()=>{ adminTab = 'matches'; adminMatchFilter = 'live'; renderAdmin(); }
  });
  $('adminAttentionList').innerHTML = items.length
    ? items.map((it,i)=>`<div class="list-pick" data-attn="${i}"><div class="lp-n">${esc(it.text)}</div><span class="arb-go">&rsaquo;</span></div>`).join('')
    : '<div class="empty-note">Nothing needs attention right now.</div>';
  document.querySelectorAll('#adminAttentionList [data-attn]').forEach(el=>
    el.addEventListener('click', ()=>items[+el.dataset.attn].go()));
}

function tournamentOwnerLabel(ownerId){
  const p = profileCache[ownerId];
  return p ? (p.displayName || 'Player') + (p.handle ? ' (@' + p.handle + ')' : '') : 'Unknown';
}

function renderAdminTournaments(){
  const q = adminTourSearch.trim().toLowerCase();
  const rows = adminTournamentsAll.filter(r=>{
    const t = r.tournament || {};
    if(q && !(t.name || '').toLowerCase().includes(q)) return false;
    if(adminTourStatusFilter && t.status !== adminTourStatusFilter) return false;
    if(adminTourLocationFilter.trim() && !(t.location || '').toLowerCase().includes(adminTourLocationFilter.trim().toLowerCase())) return false;
    return true;
  });
  $('adminToursList').innerHTML = rows.length ? rows.map(r=>{
    const t = r.tournament || {};
    const cancelled = t.status === 'cancelled';
    return `<div class="card" style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
        <div class="lp-n">
          <div class="batter-name">${esc(t.name || 'Untitled tournament')}</div>
          <div class="stat-dim">Organiser: ${esc(tournamentOwnerLabel(r.ownerId))}</div>
          <div class="stat-dim">${(t.teams||[]).length} teams${t.location ? ' &middot; ' + esc(t.location) : ''}</div>
        </div>
        ${statusBadgeHTML(t.status || 'upcoming')}
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;">
        <button class="icon-btn" data-action="admin-view-tournament" data-id="${esc(r.id)}">View</button>
        ${!cancelled ? `<button class="icon-btn" data-action="admin-cancel-tournament" data-id="${esc(r.id)}" data-name="${esc(t.name||'this tournament')}">Cancel</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty-note">No tournaments match your filters.</div>';
}

let adminMatchManageOpen = new Set();  // ids currently showing the Manage panel

function renderAdminMatches(){
  document.querySelectorAll('#adminMatchFilters .pill').forEach(p=>p.classList.toggle('active', p.dataset.mf === adminMatchFilter));
  const rows = adminMatchesAll.filter(r=>{
    const m = r.match || {};
    if(adminMatchFilter === 'cancelled') return r.cancelled;
    if(r.cancelled) return adminMatchFilter === 'all';
    if(adminMatchFilter === 'live') return !m.completed && m.liveShare;
    if(adminMatchFilter === 'completed') return !!m.completed;
    if(adminMatchFilter === 'upcoming') return !m.completed && !m.liveShare;
    return true;
  });

  $('adminMatchesList').innerHTML = rows.length ? rows.map(r=>{
    const isLive = !r.cancelled && !r.match?.completed && r.match?.liveShare;
    return isLive ? renderAdminLiveMatchCard(r) : renderAdminPlainMatchCard(r);
  }).join('') : '<div class="empty-note">No matches match this filter.</div>';
}

/* The HIGH PRIORITY Live Match Control Center card. Score/wickets/overs and
   "last updated" come from adminLiveNowById (the live_matches table) when
   available — that's the only place with genuine per-ball freshness; the
   `matches` row (r.match) is only a fallback for teams/venue/tournament if
   the live row hasn't arrived yet (e.g. right after a refresh, before the
   subscription's first tick). */
function renderAdminLiveMatchCard(r){
  const live = adminLiveNowById[r.id];
  const m = (live && live.match) || r.match || {};
  const inn = (m.innings && m.innings[m.currentInningsIdx]) || null;
  const scoreLine = inn ? teamName(m, inn.battingTeam) + ' ' + inn.runs + '/' + inn.wickets : (m.teamA || 'Team A');
  const oversLine = inn ? fmtOvers(inn.legalBalls) + ' overs' : '';
  const battingTeam = inn ? teamName(m, inn.battingTeam) : (m.teamA || 'Team A');
  const otherTeam = inn ? teamName(m, inn.bowlingTeam) : (m.teamB || 'Team B');
  const tour = m.tournamentId ? adminTournamentsAll.find(t=>t.id === m.tournamentId) : null;
  const lastUpdatedIso = (live && live.updatedAt) || r.updatedAt;
  const st = staleness(lastUpdatedIso);
  const open = adminMatchManageOpen.has(r.id);

  return `<div class="card" style="margin-bottom:8px;border-color:var(--live, #c0392b);">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <span class="pill-live mini">LIVE</span>
      <span class="stat-dim ${st.cls}" title="Admin warning only — never auto-stops a match">${st.label}</span>
    </div>
    <div class="batter-name" style="margin-top:8px;font-size:16px;">${esc(scoreLine)}</div>
    ${oversLine ? `<div class="stat-dim">${esc(oversLine)}</div>` : ''}
    <div class="stat-dim" style="margin-top:2px;">vs ${esc(otherTeam)}</div>
    <div class="stat-dim" style="margin-top:6px;">
      ${tour ? 'Tournament: ' + esc(tour.tournament?.name || 'Untitled') + '<br>' : ''}
      ${(m.venue || (live && live.location)) ? 'Ground: ' + esc(m.venue || live.location) + '<br>' : ''}
      Scorer: ${esc(tournamentOwnerLabel(r.ownerId))}<br>
      Last updated: ${esc(timeAgoShort(lastUpdatedIso))}
    </div>
    <div style="display:flex;gap:6px;margin-top:10px;">
      <a class="icon-btn" href="./live.html?m=${esc(r.id)}" target="_blank" rel="noopener">View live</a>
      <button class="icon-btn" data-action="admin-toggle-manage" data-id="${esc(r.id)}">${open ? 'Hide manage' : 'Manage'}</button>
    </div>
    ${open ? `<div style="display:flex;gap:6px;margin-top:8px;">
      <button class="icon-btn" data-action="admin-cancel-match" data-id="${esc(r.id)}" data-name="${esc(battingTeam+' vs '+otherTeam)}">Cancel match</button>
      <button class="icon-btn" data-action="admin-stop-live" data-id="${esc(r.id)}">Stop live scoring</button>
    </div>` : ''}
  </div>`;
}

function renderAdminPlainMatchCard(r){
  const m = r.match || {};
  const label = r.cancelled ? 'cancelled' : m.completed ? 'completed' : 'upcoming';
  return `<div class="card" style="margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
      <div class="lp-n">
        <div class="batter-name">${esc(m.teamA || 'Team A')} vs ${esc(m.teamB || 'Team B')}</div>
        <div class="stat-dim">Scorer: ${esc(tournamentOwnerLabel(r.ownerId))}${m.venue ? ' &middot; ' + esc(m.venue) : ''}</div>
      </div>
      <span class="badge ${label === 'cancelled' ? 'cancelled' : label === 'completed' ? 'done' : 'open'}">${label}</span>
    </div>
    <div style="display:flex;gap:6px;margin-top:10px;">
      ${!r.cancelled && !m.completed ? `<button class="icon-btn" data-action="admin-cancel-match" data-id="${esc(r.id)}" data-name="${esc((m.teamA||'Team A')+' vs '+(m.teamB||'Team B'))}">Cancel match</button>` : ''}
    </div>
  </div>`;
}

function renderAdminOrganisers(){
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

  const organisers = adminProfilesAll.filter(p=>p.is_organiser);
  $('adminOrganisersList').innerHTML = organisers.length ? organisers.map(p=>`
    <div class="list-pick">
      <div class="lp-n">
        <div class="batter-name">${esc(p.display_name || 'Player')}${p.handle ? ' &middot; @' + esc(p.handle) : ''}</div>
        <div class="stat-dim">${adminTournamentsAll.filter(t=>t.ownerId === p.id).length} tournaments</div>
      </div>
      <button class="icon-btn" data-action="admin-suspend-organiser" data-id="${esc(p.id)}" data-name="${esc(p.display_name||'this organiser')}">Suspend</button>
    </div>`).join('') : '<div class="empty-note">No approved organisers yet.</div>';
}

function renderAdminUsers(){
  const q = adminUserSearch.trim().toLowerCase();
  const rows = q ? adminProfilesAll.filter(p=>
    (p.display_name||'').toLowerCase().includes(q) || (p.handle||'').toLowerCase().includes(q)
  ) : adminProfilesAll;
  $('adminUsersList').innerHTML = rows.length ? rows.map(p=>`
    <div class="list-pick">
      <div class="lp-n">
        <div class="batter-name">${esc(p.display_name || 'Player')}${p.handle ? ' &middot; @' + esc(p.handle) : ''}</div>
        <div class="stat-dim">${[p.is_admin ? 'Admin' : null, p.is_organiser ? 'Organiser' : null].filter(Boolean).join(' &middot; ') || 'Player'}${p.region ? ' &middot; ' + esc(p.region) : ''}</div>
      </div>
      <button class="icon-btn" data-action="view-player" data-uid="${esc(p.id)}" data-name="${esc(p.display_name||'')}">View</button>
    </div>`).join('') : '<div class="empty-note">No users match your search.</div>';
}

function renderAdminFeedback(){
  document.querySelectorAll('#adminFeedbackFilters .pill').forEach(p=>p.classList.toggle('active', p.dataset.ff === adminFeedbackFilter));
  const TYPE_LABEL = { bug:'Bug report', feature:'Feature request', suggestion:'Suggestion', ux:'User experience', tournament_match:'Tournament/match issue', other:'Other' };
  const rows = adminFeedbackAll.filter(f=>{
    if(adminFeedbackFilter !== 'all' && f.status !== adminFeedbackFilter) return false;
    if(adminFeedbackTypeFilter && f.feedback_type !== adminFeedbackTypeFilter) return false;
    return true;
  });
  $('adminFeedbackList').innerHTML = rows.length ? rows.map(f=>{
    const p = profileCache[f.user_id] || {};
    const stars = f.rating ? '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating) : 'No rating';
    return `<div class="card" style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
        <div class="lp-n">
          <div class="batter-name">${TYPE_LABEL[f.feedback_type] || 'Other'}</div>
          <div class="stat-dim">${esc(p.displayName || 'Player')} &middot; ${new Date(f.created_at).toLocaleDateString()} &middot; ${stars}</div>
        </div>
        <span class="badge ${f.status === 'new' ? 'live' : f.status === 'resolved' ? 'done' : 'open'}">${f.status}</span>
      </div>
      <div style="margin-top:8px;">${esc(f.message)}</div>
      <div style="display:flex;gap:6px;margin-top:10px;">
        ${f.status !== 'reviewed' ? `<button class="icon-btn" data-action="admin-review-feedback" data-id="${esc(f.id)}" data-status="reviewed">Mark reviewed</button>` : ''}
        ${f.status !== 'resolved' ? `<button class="icon-btn on" data-action="admin-review-feedback" data-id="${esc(f.id)}" data-status="resolved">Mark resolved</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty-note">No feedback matches this filter.</div>';
}

function renderAdminActivity(){
  // Recent-events feed, computed client-side from data already loaded for
  // the other tabs. Not a persisted audit log — there's no audit_log table
  // in the schema, so "who did what" for admin actions specifically (as
  // opposed to "what was created/reviewed and when") isn't tracked yet. See
  // the Task 8 report for the honest limitation this implies.
  const events = [];
  adminTournamentsAll.forEach(r=>events.push({ t: r.updatedAt, text: `Tournament "${r.tournament?.name || 'Untitled'}" updated (${r.tournament?.status || 'upcoming'})` }));
  adminFeedbackAll.forEach(f=>{
    events.push({ t: f.created_at, text: `Feedback submitted (${f.feedback_type})` });
    if(f.reviewed_at) events.push({ t: f.reviewed_at, text: `Feedback marked ${f.status}` });
  });
  pendingApps.forEach(a=>events.push({ t: a.createdAt || a.created_at, text: `Organiser application from ${a.orgName}` }));
  events.sort((a,b)=> new Date(b.t) - new Date(a.t));
  $('adminActivityList').innerHTML = events.length
    ? '<div class="card">' + events.slice(0, 60).map(e=>
        `<div class="hist-item"><div class="d">${e.t ? new Date(e.t).toLocaleString() : ''}</div><div class="batter-name">${esc(e.text)}</div></div>`
      ).join('') + '</div>'
    : '<div class="empty-note">No recent activity.</div>';
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

/* Confirmation is deliberately a distinct, explicitly-labelled button (never
   a bare "OK") for every destructive admin action below — see Task 8 rules:
   "make the action difficult to trigger accidentally". */
function openConfirmModal(title, body, confirmLabel, onConfirm){
  openModal(`
    <h3>${esc(title)}</h3>
    <div class="stat-dim" style="margin:8px 0 16px;">${body}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn secondary" data-action="close">Cancel</button>
      <button class="btn" id="modalConfirmBtn">${esc(confirmLabel)}</button>
    </div>
  `);
  $('modalConfirmBtn').addEventListener('click', async ()=>{ closeModal(); await onConfirm(); });
}

function adminCancelTournamentPrompt(id, name){
  openConfirmModal('Cancel tournament?',
    `"${esc(name)}" will be marked <b>Cancelled</b> and hidden from active listings. Its matches, teams and
     historical results are kept exactly as they are — nothing is deleted, and this cannot be undone from here.`,
    'Yes, cancel this tournament',
    async ()=>{
      const ok = await adminCancelTournament(id);
      if(ok){ toast('Tournament cancelled'); await refreshAdminData(); renderAdmin(); }
      else toast('Could not cancel — try again');
    });
}

function adminCancelMatchPrompt(id, name){
  openConfirmModal('Cancel match?',
    `"${esc(name)}" will be marked cancelled and any live share stopped immediately. The match record and its
     ball-by-ball history are kept, not deleted.`,
    'Yes, cancel this match',
    async ()=>{
      const ok = await adminCancelMatch(id);
      if(ok){ toast('Match cancelled'); await refreshAdminData(); renderAdmin(); }
      else toast('Could not cancel — try again');
    });
}

async function adminStopLiveAction(id){
  await stopLive(id);
  toast('Live scoring stopped');
  await refreshAdminData(); renderAdmin();
}

function adminSuspendOrganiserPrompt(uid, name){
  openConfirmModal('Suspend organiser access?',
    `${esc(name)} will lose the organiser badge and the ability to create new public tournaments.
     Tournaments they already created are not affected or deleted.`,
    'Yes, suspend organiser access',
    async ()=>{
      const ok = await adminSetOrganiserStatus(uid, false);
      if(ok){ toast('Organiser access suspended'); await refreshAdminData(); renderAdmin(); }
      else toast('Could not update — try again');
    });
}

async function adminReviewFeedbackAction(id, status){
  const ok = await updateFeedbackStatus(id, status);
  if(ok){ toast('Feedback marked ' + status); await refreshAdminData(); renderAdmin(); }
  else toast('Could not update — try again');
}

/* ---------------- HOME ---------------- */
const QA = [
  { id:'qaNewMatch2',  label:'Start scoring', sub:'Ball by ball',    icon:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9h4M7 13h7M16 8v6"/>', go:'setup' },
  { id:'qaTeams2',     label:'Teams',         sub:'Build a squad',   icon:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1"/><circle cx="17" cy="9" r="2.5"/>', go:'teams' },
  { id:'qaTour2',      label:'Tournaments',   sub:'Tables & cups',   icon:'<path d="M6 4h12v5a6 6 0 01-12 0z"/><path d="M6 6H3v2a4 4 0 004 4M18 6h3v2a4 4 0 01-4 4"/><path d="M10 19h4M12 15v4"/>', go:'tournaments' },
  { id:'qaStats2',     label:'Rankings',      sub:'Career records',  icon:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', go:'stats' },
  { id:'qaSched2',     label:'Schedule',      sub:'Fixtures',        icon:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>', act:'schedule' },
  { id:'qaHist2',      label:'History',       sub:'Past results',    icon:'<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 4v4h4M12 7v5l3 2"/>', go:'history' },
  { id:'qaFriends2',   label:'Find Players',  sub:'Search & connect', icon:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', go:'friends' }
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

  // Welcome header — real, signed-in users only; guests keep the pitch copy.
  const u = getUser();
  if(u){
    const first = (displayName() || 'there').split(' ')[0];
    $('heroKicker').textContent = 'Welcome back';
    $('heroHeading').innerHTML = `Hi, ${esc(first)} <span style="display:inline;">&#128075;</span>`;
    const bits = [];
    bits.push(ms.length + (ms.length === 1 ? ' match played' : ' matches played'));
    if(teams.length) bits.push(teams.length + (teams.length === 1 ? ' team' : ' teams'));
    if(tournaments.length) bits.push(tournaments.length + (tournaments.length === 1 ? ' tournament' : ' tournaments'));
    $('heroSub').textContent = bits.join(' · ') + ' — here\'s where things stand.';
  } else {
    $('heroKicker').textContent = 'Gully to Gallery.';
    $('heroHeading').innerHTML = 'One platform.<span>Every cricketer.</span>';
    $('heroSub').textContent = 'Connect with players, build teams, and join tournaments — score ball by ball, and share a live link so anyone can follow along.';
  }
}

/* Next match = the single soonest upcoming item, reusing the same real
   source as the Upcoming widget (scheduled events + dated fixtures). */
function renderNextMatch(){
  const box = $('nextMatchBox');
  const next = upcomingItems(1)[0];
  if(!next){
    box.innerHTML = `<div class="empty-note">No upcoming matches.</div>
      <button class="btn secondary" id="nextMatchCta" style="margin-top:2px;">Find a Tournament</button>`;
    $('nextMatchCta').addEventListener('click', ()=>go('tournaments'));
    return;
  }
  const d = next.date ? new Date(next.date) : null;
  const today = d ? dayStart(d) === dayStart(new Date()) : false;
  box.innerHTML = `
    <div class="next-match">
      <div class="nm-teams">${esc(next.title || 'Match')}</div>
      <div class="nm-meta">${today ? 'Today' : esc(fmtWhen(next.date))}${next.venue ? ' &middot; ' + esc(next.venue) : ''}</div>
      ${next.badge ? `<div class="nm-badge">${esc(next.badge)}</div>` : ''}
    </div>`;
}

/* My cricket stats — real career record, matched by display name against
   ball-by-ball data already saved from completed matches. No fabricated
   numbers: if the name has never been used to score a match, every field
   is an honest zero, and Player Rating stays a clear "coming soon" (there's
   no rating model yet — same honesty line as the marketing site). */
function renderMyStats(){
  const careers = buildCareers(mergedHistory().filter(m=>m.completed));
  const mine = findPlayer(careers, displayName());
  const cells = [
    { v: mine ? mine.matches : 0,  l: 'Matches' },
    { v: mine ? mine.runs : 0,     l: 'Runs' },
    { v: mine ? mine.wickets : 0,  l: 'Wickets' },
    { v: '—',                      l: 'Rating' }
  ];
  $('myStatsStrip').innerHTML = cells.map(c=>
    `<div class="stat-box"><div class="sv">${c.v}</div><div class="sl">${esc(c.l)}</div></div>`).join('');
  $('myStatsNote').textContent = mine
    ? 'Matched from matches scored under your display name. Player Rating is on the roadmap.'
    : "No matches scored under your display name yet — score a match to start your record.";
}

/* Achievements — real, computed from data that already exists. Locked
   badges are an honest "not yet", not a fake progress bar. Shared between
   the home screen (always "me") and the public player profile (anyone
   whose matches/teams/tournaments are locally known) so the badge
   definitions live in exactly one place. */
function achievementBadges({ hasMatch, teamsCount, toursCount, career, streak, includeStreak }){
  const badges = [
    { id:'first-match', label:'First Match', icon:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9h4M7 13h7"/>', on: hasMatch },
    { id:'first-team', label:'First Team', icon:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1"/>', on: teamsCount > 0 },
    { id:'first-tournament', label:'First Tournament', icon:'<path d="M6 4h12v5a6 6 0 01-12 0z"/><path d="M10 19h4M12 15v4"/>', on: toursCount > 0 },
    { id:'century', label:'Century Scorer', icon:'<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/>', on: !!(career && career.hundreds > 0) },
    { id:'five-wickets', label:'5-Wicket Haul', icon:'<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/>', on: !!(career && career.fiveFers > 0) }
  ];
  if(includeStreak){
    badges.splice(3, 0,
      { id:'streak-7', label:'7-Day Streak', icon:'<path d="M12 2s6 5.5 6 11a6 6 0 11-12 0c0-2 1-3.5 2-5 .5 2 1.5 2.5 1.5 2.5C9 7 12 2 12 2z"/>', on: streak >= 7 },
      { id:'streak-30', label:'30-Day Streak', icon:'<path d="M12 2s6 5.5 6 11a6 6 0 11-12 0c0-2 1-3.5 2-5 .5 2 1.5 2.5 1.5 2.5C9 7 12 2 12 2z"/>', on: streak >= 30 }
    );
  }
  return badges;
}

function achievementBadgesHTML(badges){
  return badges.map(b=>`
    <div class="ach-badge ${b.on ? 'on' : ''}" title="${b.on ? 'Unlocked' : 'Not yet unlocked'}">
      <span class="ach-ico"><svg viewBox="0 0 24 24">${b.icon}</svg></span>
      <span class="ach-l">${esc(b.label)}</span>
    </div>`).join('');
}

function renderAchievements(){
  const careers = buildCareers(mergedHistory().filter(m=>m.completed));
  const mine = findPlayer(careers, displayName());
  const streak = (myPublicProfile && myPublicProfile.streakLongest) || 0;
  const badges = achievementBadges({
    hasMatch: mergedHistory().some(m=>m.completed),
    teamsCount: teams.length, toursCount: tournaments.length,
    career: mine, streak, includeStreak: true
  });
  $('achGrid').innerHTML = achievementBadgesHTML(badges);
}

/* ===========================================================================
   PUBLIC PLAYER PROFILE
   A player's "digital cricket CV". Identity (name/handle/avatar/location)
   comes from the profiles table when we know who the player is on the
   platform (their uid) — via fetchPublicProfile/profileCache, same as the
   Friends screen already uses. Stats/teams/tournaments come from
   stats.js, run over whatever matches/teams/tournaments this device
   already knows about (mergedHistory() + the local teams/tournaments
   arrays) — there is no cross-account query for "everything player X has
   ever played", so a player viewed by bare name (no uid, e.g. tapping a
   leaderboard row) still gets real stats when they appear in locally-known
   matches, and an honest empty state when they don't.
   =========================================================================== */

function avatarHTMLFor(person, size){
  if(person && person.photo) return `<img src="${esc(person.photo)}" alt="Player photo">`;
  if(person && person.avatarId) return avatarSVG(person.avatarId, size);
  return initialsBadge((person && (person.displayName || person.name)) || '?', size);
}

function normName(s){ return String(s || '').trim().toLowerCase(); }

/* Opens the player screen. Pass { uid } when the viewer came from somewhere
   that knows who the player is on the platform (friends, search, "my
   profile"); pass { name } when only a scored-match name is known
   (leaderboard, team roster). Either works — identity fields simply stay
   empty when there's no uid to resolve. */
async function openPlayerProfile({ uid, name } = {}){
  playerReturnScreen = screen;
  let resolvedName = name;
  if(uid){
    if(!profileCache[uid]) await resolveProfiles([uid]);
    const pub = profileCache[uid];
    resolvedName = resolvedName || (pub && pub.displayName) || (pub && pub.handle) || 'Player';
  }
  if(!resolvedName){ toast('No player to show'); return; }
  const me = getUser();
  const isSelf = (uid && me && uid === me.id) || (!uid && normName(resolvedName) === normName(displayName()));
  viewedPlayer = { uid: uid || (isSelf && me ? me.id : null), name: resolvedName, isSelf };
  playerTab = 'overview';
  go('player');
}

function playerShareUrl(handle){
  return location.origin + location.pathname.replace(/index\.html$/, '') + 'player.html?u=' + encodeURIComponent(handle);
}

/* Tournament links reuse the main app (not a standalone page like
   live.html/player.html) because viewing one is a full in-app screen with
   its own tabs, not a single-purpose scoreboard — index.html?tour=<id>
   opens straight into it, guest or not (see boot()). */
function tourShareUrl(id){
  return location.origin + location.pathname.replace(/index\.html$/, '') + 'index.html?tour=' + encodeURIComponent(id);
}

function playerIdentity(){
  const vp = viewedPlayer;
  if(!vp) return null;
  const pub = vp.uid ? profileCache[vp.uid] : null;
  if(vp.isSelf){
    return {
      name: displayName(),
      handle: myPublicProfile && myPublicProfile.handle,
      avatar: avatarHTML(84),
      isOrganiser: !!(myPublicProfile && myPublicProfile.isOrganiser),
      location: [profile.district || profile.area, profile.country].filter(Boolean).join(', '),
      points: myPublicProfile ? (myPublicProfile.points || 0) : null,
      primaryRole: (myPublicProfile && myPublicProfile.primaryRole) || '',
      battingStyle: (myPublicProfile && myPublicProfile.battingStyle) || '',
      bowlingStyle: (myPublicProfile && myPublicProfile.bowlingStyle) || '',
      bio: (myPublicProfile && myPublicProfile.bio) || ''
    };
  }
  return {
    name: (pub && pub.displayName) || vp.name,
    handle: pub && pub.handle,
    avatar: pub ? avatarHTMLFor(pub, 84) : initialsBadge(vp.name, 84),
    isOrganiser: !!(pub && pub.isOrganiser),
    location: pub ? [pub.district || pub.area, pub.country].filter(Boolean).join(', ') : '',
    // pub is only populated for a signed-in viewer (fetchPublicProfile) —
    // points intentionally stay unknown (not zero) for a guest viewer or a
    // player only known by a scored-match name, so the UI can tell "no
    // points yet" apart from "we don't actually know".
    points: pub ? (pub.points || 0) : null,
    primaryRole: (pub && pub.primaryRole) || '',
    battingStyle: (pub && pub.battingStyle) || '',
    bowlingStyle: (pub && pub.bowlingStyle) || '',
    bio: (pub && pub.bio) || ''
  };
}

function renderPlayerProfile(){
  const vp = viewedPlayer;
  if(!vp){ go('home'); return; }

  const id = playerIdentity();
  const verifyBadge = id.isOrganiser
    ? `<span class="avatar-verify-badge" title="Verified organiser"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></span>`
    : '';
  $('playerAvatarBig').innerHTML = id.avatar + verifyBadge;
  $('playerNameEl').textContent = id.name;

  const ms = allCompletedMatches();
  const careers = buildCareers(ms);
  const career = findPlayer(careers, vp.name);
  const playerMatches = matchesForPlayer(ms, vp.name);
  const role = derivedRole(career);
  const fmt = preferredFormat(playerMatches);
  const myTeams = teamsForPlayer(teams, vp.name);
  const myTours = tournamentsForTeams(tournaments, myTeams.map(t=>t.name));

  // Self-reported primary role wins when set (it's the player's own claim,
  // shown on Top Players too, so profile and leaderboard stay consistent);
  // falls back to the role derived from this device's own match history.
  const displayRole = id.primaryRole || role;
  $('playerRoleRow').innerHTML = [
    displayRole ? `<span class="role-badge">${esc(displayRole)}</span>` : '',
    // "Organiser" doubles as this app's verification signal — it's the one
    // status here that's actually vetted (admin-approved application). The
    // checkmark itself now lives on the avatar photo (avatar-verify-badge)
    // per the reference design, so this text badge stays plain.
    id.isOrganiser ? `<span class="role-badge organiser">Organiser</span>` : '',
    id.handle ? `<span class="stat-dim">@${esc(id.handle)}</span>` : ''
  ].filter(Boolean).join(' ');
  $('playerLocEl').textContent = id.location || (fmt ? 'Mostly plays ' + fmt : '');
  const ratingChip = $('playerRatingVal').closest('.player-rating-chip');
  if(id.points === null){
    ratingChip.classList.add('hidden');
  } else {
    ratingChip.classList.remove('hidden');
    $('playerRatingVal').textContent = id.points + (id.points === 1 ? ' point' : ' points');
  }

  // Six real, computed career numbers — no invented "Catches" cell (the
  // scoring engine never records which fielder took a catch, and adding
  // that would mean changing the live-scoring UI, which the brief says not
  // to touch for appearance's sake). Strike Rate and 5-Wicket Hauls *are*
  // genuinely derivable from existing ball-by-ball data (stats.js
  // withDerived: strikeRate, fiveFers), so they replace it honestly.
  $('playerStatStrip').innerHTML = [
    { v: career ? career.matches : 0, l:'Matches' },
    { v: career ? career.runs : 0,    l:'Runs' },
    { v: career ? career.wickets : 0, l:'Wickets' },
    { v: career && career.average !== null ? career.average : '—', l:'Bat Avg' },
    { v: career && career.balls > 0 ? career.strikeRate : '—', l:'Strike Rate' },
    { v: career ? career.fiveFers : 0, l:'5W Hauls' }
  ].map(c=>`<div class="stat-box"><div class="sv">${esc(c.v)}</div><div class="sl">${esc(c.l)}</div></div>`).join('');

  document.querySelectorAll('#playerTabs .pill').forEach(p=>
    p.classList.toggle('active', p.dataset.pt === playerTab));
  [['overview','ptOverview'],['batting','ptBatting'],['bowling','ptBowling'],['recent','ptRecent'],
   ['teams','ptTeams'],['tournaments','ptTournaments'],['achievements','ptAchievements']]
    .forEach(([k,elId])=>$(elId).classList.toggle('hidden', playerTab !== k));

  if(playerTab === 'overview') renderPlayerOverview(career, playerMatches, fmt, id);
  else if(playerTab === 'batting') renderPlayerBatting(career, playerMatches);
  else if(playerTab === 'bowling') renderPlayerBowling(career, playerMatches);
  else if(playerTab === 'recent') renderPlayerRecent(playerMatches);
  else if(playerTab === 'teams') renderPlayerTeams(myTeams);
  else if(playerTab === 'tournaments') renderPlayerTournaments(myTours);
  else if(playerTab === 'achievements') renderPlayerAchievements(vp, career, myTeams, myTours, playerMatches);
}

function trendBars(values, label){
  if(!values.length) return '';
  const max = Math.max(1, ...values.map(v=>Math.abs(v)));
  return `<div class="trend-block">
    <div class="trend-label">${esc(label)}</div>
    <div class="trend-bars">${values.map(v=>
      `<div class="trend-bar" style="height:${Math.max(6, Math.round((Math.abs(v)/max)*54))}px" title="${esc(v)}"><span>${esc(v)}</span></div>`
    ).join('')}</div>
  </div>`;
}

function playingIdentityCardHTML(id){
  const rows = [
    id.bio ? ['About', esc(id.bio)] : null,
    id.battingStyle ? ['Batting style', esc(id.battingStyle)] : null,
    id.bowlingStyle ? ['Bowling style', esc(id.bowlingStyle)] : null
  ].filter(Boolean);
  if(!rows.length) return '';
  return `<div class="card">
    <div class="sec-head"><h2>Playing identity</h2></div>
    <div class="kv-list">${rows.map(([k,v])=>`<div class="kv-row"><div class="kv-k">${esc(k)}</div><div class="kv-v">${v}</div></div>`).join('')}</div>
  </div>`;
}

function renderPlayerOverview(career, playerMatches, fmt, id){
  const identityCard = playingIdentityCardHTML(id || {});
  if(!career || !playerMatches.length){
    $('ptOverview').innerHTML = identityCard + `<div class="card"><div class="empty-note">
      No matches found for this player yet in the matches this device knows about.<br>
      Scores here update automatically once a match involving them is completed.</div></div>`;
    return;
  }
  const recent = playerMatches.slice(0, 8).slice().reverse(); // oldest → newest, left to right
  const runsTrend = recent.filter(m=>m.runs !== null).map(m=>m.runs);
  const wktsTrend = recent.filter(m=>m.wickets !== null).map(m=>m.wickets);
  $('ptOverview').innerHTML = identityCard + `
    <div class="card">
      <div class="sec-head"><h2>Career summary</h2></div>
      <div class="stat-dim">
        ${career.innings} batting inns · ${career.bowlInnings} bowling inns
        ${fmt ? ' · mostly ' + esc(fmt) : ''}
      </div>
    </div>
    <div class="card">
      <div class="sec-head"><h2>Recent performance</h2></div>
      ${runsTrend.length ? trendBars(runsTrend, 'Runs — last ' + runsTrend.length + ' innings') : '<div class="empty-note">No batting innings yet.</div>'}
      ${wktsTrend.length ? trendBars(wktsTrend, 'Wickets — last ' + wktsTrend.length + ' innings') : ''}
      <div class="stat-dim" style="margin-top:10px;">Rating trend isn't shown — Cricket Connect doesn't have a rating model yet.</div>
    </div>`;
}

function renderPlayerBatting(career, playerMatches){
  const innings = playerMatches.filter(m=>m.runs !== null);
  if(!career || !innings.length){
    $('ptBatting').innerHTML = '<div class="card"><div class="empty-note">No batting innings recorded yet.</div></div>';
    return;
  }
  $('ptBatting').innerHTML = `
    <div class="stat-strip">
      ${[{v:career.innings,l:'Innings'},{v:career.average ?? '—',l:'Average'},{v:career.strikeRate,l:'S/R'},{v:career.hsText,l:'Best'}]
        .map(c=>`<div class="stat-box"><div class="sv">${esc(c.v)}</div><div class="sl">${esc(c.l)}</div></div>`).join('')}
    </div>
    <div class="card">
      <div class="sec-head"><h2>Batting log</h2></div>
      ${innings.map(m=>`
        <div class="rank-row" style="cursor:default;">
          <div class="rank-body">
            <div class="rank-name">${esc(m.teamA)} vs ${esc(m.teamB)}</div>
            <div class="rank-sub">${esc(fmtWhen(m.date))}${m.resultText ? ' · ' + esc(m.resultText) : ''}</div>
          </div>
          <div class="rank-val"><div class="rv">${esc(m.runs)}${m.notOut ? '*' : ''}</div><div class="rl">(${esc(m.balls)})</div></div>
        </div>`).join('')}
    </div>`;
}

function renderPlayerBowling(career, playerMatches){
  const spells = playerMatches.filter(m=>m.wickets !== null);
  if(!career || !spells.length){
    $('ptBowling').innerHTML = '<div class="card"><div class="empty-note">No bowling spells recorded yet.</div></div>';
    return;
  }
  $('ptBowling').innerHTML = `
    <div class="stat-strip">
      ${[{v:career.wickets,l:'Wickets'},{v:career.economy,l:'Economy'},{v:career.bowlAvg ?? '—',l:'Average'},{v:career.best,l:'Best'}]
        .map(c=>`<div class="stat-box"><div class="sv">${esc(c.v)}</div><div class="sl">${esc(c.l)}</div></div>`).join('')}
    </div>
    <div class="card">
      <div class="sec-head"><h2>Bowling log</h2></div>
      ${spells.map(m=>`
        <div class="rank-row" style="cursor:default;">
          <div class="rank-body">
            <div class="rank-name">${esc(m.teamA)} vs ${esc(m.teamB)}</div>
            <div class="rank-sub">${esc(fmtWhen(m.date))}${m.resultText ? ' · ' + esc(m.resultText) : ''}</div>
          </div>
          <div class="rank-val"><div class="rv">${esc(m.wickets)}/${esc(m.runsConceded)}</div><div class="rl">${esc(fmtOvers(m.legalBalls))} ov</div></div>
        </div>`).join('')}
    </div>`;
}

function renderPlayerRecent(playerMatches){
  if(!playerMatches.length){
    $('ptRecent').innerHTML = '<div class="card"><div class="empty-note">No completed matches yet.</div></div>';
    return;
  }
  $('ptRecent').innerHTML = `<div class="card">
    <div class="sec-head"><h2>Recent matches</h2></div>
    ${playerMatches.map(m=>`
      <div class="rank-row" style="cursor:default;">
        <div class="rank-body">
          <div class="rank-name">${esc(m.teamA)} vs ${esc(m.teamB)}</div>
          <div class="rank-sub">${esc(fmtWhen(m.date))}${m.resultText ? ' · ' + esc(m.resultText) : ''}</div>
        </div>
        <div class="rank-val">
          <div class="rv">${m.runs !== null ? esc(m.runs) + (m.notOut ? '*' : '') : '—'}</div>
          <div class="rl">${m.wickets !== null ? esc(m.wickets) + ' wkt' + (m.wickets === 1 ? '' : 's') : ''}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

function renderPlayerTeams(myTeams){
  $('ptTeams').innerHTML = myTeams.length ? `<div class="card">
      <div class="sec-head"><h2>Teams</h2></div>
      ${myTeams.map(t=>`
        <div class="list-pick">
          ${initialsBadge(t.name, 34)}
          <div class="lp-n">${esc(t.name)}<div class="stat-dim">${(t.players||[]).length} player${(t.players||[]).length===1?'':'s'}</div></div>
        </div>`).join('')}
    </div>` : '<div class="card"><div class="empty-note">No teams found for this player yet.</div></div>';
}

function renderPlayerTournaments(myTours){
  $('ptTournaments').innerHTML = myTours.length ? `<div class="card">
      <div class="sec-head"><h2>Tournaments</h2></div>
      ${myTours.map(t=>`
        <button class="list-pick" data-action="open-tour" data-id="${esc(t.id)}" style="width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--line);cursor:pointer;font-family:inherit;">
          ${initialsBadge(t.name, 34)}
          <div class="lp-n">${esc(t.name)}<div class="stat-dim">${(t.teams||[]).length} team${(t.teams||[]).length===1?'':'s'}</div></div>
        </button>`).join('')}
    </div>` : '<div class="card"><div class="empty-note">No tournaments found for this player yet.</div></div>';
}

function renderPlayerAchievements(vp, career, myTeams, myTours, playerMatches){
  const streak = vp.isSelf ? ((myPublicProfile && myPublicProfile.streakLongest) || 0) : 0;
  const badges = achievementBadges({
    hasMatch: playerMatches.length > 0, teamsCount: myTeams.length, toursCount: myTours.length,
    career, streak, includeStreak: vp.isSelf
  });
  $('ptAchievements').innerHTML = `<div class="card"><div class="ach-grid">${achievementBadgesHTML(badges)}</div></div>`;
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

  const rewardsCard = $('homeRewardsCard');
  rewardsCard.classList.toggle('hidden', !myPublicProfile);
  if(myPublicProfile){
    $('homeRewardsPoints').textContent = myPublicProfile.points || 0;
    $('homeRewardsStreak').textContent = myPublicProfile.streakCurrent || 0;
    $('homeRewardsBest').textContent = myPublicProfile.streakLongest || 0;
    const badge = $('homeRewardsStreakBadge');
    badge.textContent = (myPublicProfile.streakCurrent || 0) + ' day streak';
    badge.classList.toggle('hidden', !myPublicProfile.streakCurrent);
  }

  const adminCard = $('homeAdminCard');
  adminCard.classList.toggle('hidden', !isAdminUser);
  if(isAdminUser){
    $('homeAdminPending').textContent = pendingApps.length;
    $('homeAdminPendingBadge').textContent = pendingApps.length + ' pending';
    $('homeAdminPendingBadge').classList.toggle('hidden', pendingApps.length === 0);
    $('homeAdminOrganisers').textContent = adminOverview.organisers;
    $('homeAdminTournaments').textContent = adminOverview.tournaments;
    $('homeAdminMatches').textContent = adminOverview.matches;
  }

  renderEventsWidget();
  renderRecent();
  renderHomeTournaments();
  renderHomeTeams();
  renderNextMatch();
  renderMyStats();
  renderAchievements();
  renderHomeLiveMatches();
  renderUpcomingTournaments();
  renderHomeTopPlayers();
  $('homeGuestCta').classList.toggle('hidden', !!u);
}

function renderHomeTournaments(){
  const box = $('homeTournamentsRail');
  if(!tournaments.length){
    box.innerHTML = `<div class="empty-note">No tournaments yet.<br>Create one to get a table, fixtures and knockouts.</div>`;
    return;
  }
  box.innerHTML = `<div class="mini-rail">` +
    tournaments.slice(0, 8).map(t=>`
      <button class="mini-card" data-home-tournament>
        <div class="mc-t">${esc(t.name)}</div>
        <div class="mc-s">${t.teams.length} team${t.teams.length === 1 ? '' : 's'}</div>
      </button>`).join('') +
    `<button class="mini-card add" data-home-tournament>
      <span style="font-size:20px;line-height:1;">+</span><span style="font-size:11px;">New</span>
    </button></div>`;
  box.querySelectorAll('[data-home-tournament]').forEach(b=>
    b.addEventListener('click', ()=>go('tournaments')));
}

const TOUR_FORMAT_LABEL = { 'league-knockout':'League + knockouts', 'league':'League table', 'knockout':'Knockout' };

/* "Upcoming Tournaments" — public tournaments other organisers marked
   public (fetchPublicTournaments, existing RLS-backed read, no schema
   change). Card shows every field the brief asks for: name, status, date,
   location, format, team count. Was "Recommended Tournaments" lower on the
   page; moved up + renamed to match the new home priority (what's
   happening in cricket right now), same data source. */
async function renderUpcomingTournaments(){
  const box = $('homeUpcomingTourBox');
  if(!box) return;
  if(!cloudReady()){
    box.innerHTML = `<div class="empty-note">Tournament discovery needs the cloud connection. In local-only mode there's no way to see other organisers' tournaments.</div>`;
    return;
  }
  box.innerHTML = `<div class="stat-dim">Loading…</div>`;
  let list = [];
  let failed = false;
  try{ list = await fetchPublicTournaments(6); }
  catch(e){ console.error('renderUpcomingTournaments failed:', e); failed = true; }
  if(!box.isConnected) return; // screen changed while awaiting
  if(failed){
    box.innerHTML = `<div class="empty-note">Couldn't load tournaments right now.
      <button class="btn secondary small" data-retry>Try again</button></div>`;
    box.querySelector('[data-retry]').addEventListener('click', renderUpcomingTournaments);
    return;
  }
  if(!list.length){
    box.innerHTML = `<div class="empty-note">No tournaments found nearby yet.<br>
      When an organiser marks one public, it'll show up here.
      <button class="btn secondary small" data-action="open-new-tournament">Start one yourself</button></div>`;
    return;
  }
  box.innerHTML = list.map(t=>`
    <button class="tour-card" data-action="open-tour" data-id="${esc(t.id)}" style="width:100%;text-align:left;font-family:inherit;">
      ${dateChipHTML(t.startDate)}
      <div class="tc-b">
        <div class="tc-n">${esc(t.name)}</div>
        <div class="tc-m">${fmtDateRange(t.startDate, t.endDate) || 'Date TBC'}${t.location ? ' &middot; ' + esc(t.location) : ''}</div>
        <div class="tc-m">${TOUR_FORMAT_LABEL[t.format] || 'League'} &middot; ${(t.teams || []).length} team${(t.teams || []).length === 1 ? '' : 's'}</div>
      </div>
      ${statusBadgeHTML(t.status || 'upcoming')}
    </button>`).join('');
}

/* "Live Matches" — the home screen's top-priority section per the brief
   ("what's happening in cricket right now"). Real data via
   fetchLiveMatchesNow(), the same read the public Live Now screen and the
   admin Live Match Control Center already use — no new query, no fake
   scores. Shows both teams' scores where known ("Yet to bat" otherwise),
   current overs, and the venue/area, matching the brief's example layout. */
function inningsForTeam(m, key){
  return (m.innings || []).find(i=>i.battingTeam === key) || null;
}
function homeLiveCardHTML(r){
  const m = r.match || {};
  const scoreFor = key=>{
    const inn = inningsForTeam(m, key);
    return inn ? (inn.runs + '/' + inn.wickets) : 'Yet to bat';
  };
  const cur = (m.innings && m.innings[m.currentInningsIdx]) || null;
  const oversNote = cur ? fmtOvers(cur.legalBalls) + ' overs' : '';
  return `<a class="live-card" href="./live.html?m=${esc(r.id)}" target="_blank" rel="noopener">
    <div class="lc-top">
      <span class="lc-comp">${esc(r.location || 'Live match')}</span>
      <span class="badge-live"><i></i>LIVE</span>
    </div>
    <div class="lc-teams">
      <div class="lc-side">
        <div class="lc-badge">${initialsBadge(m.teamA || 'Team A', 30)}</div>
        <div class="lcs-n">${esc(m.teamA || 'Team A')}</div><div class="lcs-s">${esc(scoreFor('A'))}</div>
      </div>
      <div class="lc-vs">VS</div>
      <div class="lc-side">
        <div class="lc-badge">${initialsBadge(m.teamB || 'Team B', 30)}</div>
        <div class="lcs-n">${esc(m.teamB || 'Team B')}</div><div class="lcs-s">${esc(scoreFor('B'))}</div>
      </div>
    </div>
    ${oversNote ? `<div class="lc-note">${esc(oversNote)}<span class="lc-arrow">&#8250;</span></div>` : `<div class="lc-note lc-note-arrow-only"><span class="lc-arrow">&#8250;</span></div>`}
  </a>`;
}
async function renderHomeLiveMatches(){
  const box = $('homeLiveRail');
  if(!box) return;
  if(!cloudReady()){
    box.innerHTML = `<div class="empty-note">Live match discovery needs the cloud connection.</div>`;
    return;
  }
  box.innerHTML = `<div class="stat-dim">Loading…</div>`;
  let rows = [];
  let failed = false;
  try{ rows = await fetchLiveMatchesNow(); }
  catch(e){ console.error('renderHomeLiveMatches failed:', e); failed = true; }
  if(!box.isConnected) return;
  if(failed){
    box.innerHTML = `<div class="empty-note">Couldn't load live matches right now.
      <button class="btn secondary small" data-retry>Try again</button></div>`;
    box.querySelector('[data-retry]').addEventListener('click', renderHomeLiveMatches);
    return;
  }
  if(!rows.length){
    box.innerHTML = `<div class="empty-note">No live matches right now.<br>
      Start one yourself and turn on <b>Share Live</b> during setup.</div>`;
    return;
  }
  box.innerHTML = `<div class="live-rail">` + rows.slice(0, 6).map(homeLiveCardHTML).join('') + `</div>`;
}

/* "Top Players" — real points-leaderboard rail (see cloud.js
   fetchTopPlayers; no invented "rating"). Signed-out visitors get an
   explicit sign-in prompt rather than a silently empty section, since
   points are only readable once signed in (existing RLS/privacy pattern —
   see fetchPublicPlayerCard's comment on why points stay out of the fully
   anonymous read path). */
async function renderHomeTopPlayers(){
  const box = $('homeTopPlayersRail');
  if(!box) return;
  if(!isSignedIn()){
    box.innerHTML = `<div class="empty-note">Sign in to see top players by points.
      <button class="btn secondary small" data-action="go-auth">Sign in</button></div>`;
    return;
  }
  if(!cloudReady()){
    box.innerHTML = `<div class="empty-note">Top players needs the cloud connection.</div>`;
    return;
  }
  box.innerHTML = `<div class="stat-dim">Loading…</div>`;
  let rows = [];
  let failed = false;
  try{ rows = await fetchTopPlayers(10); }
  catch(e){ console.error('renderHomeTopPlayers failed:', e); failed = true; }
  if(!box.isConnected) return;
  if(failed){
    box.innerHTML = `<div class="empty-note">Couldn't load top players right now.
      <button class="btn secondary small" data-retry>Try again</button></div>`;
    box.querySelector('[data-retry]').addEventListener('click', renderHomeTopPlayers);
    return;
  }
  if(!rows.length){
    box.innerHTML = `<div class="empty-note">No ranked players yet.<br>Open the app daily to start earning points.</div>`;
    return;
  }
  box.innerHTML = `<div class="player-rail">` + rows.map(p=>`
    <button class="player-card" data-action="view-player" data-uid="${esc(p.uid)}" data-name="${esc(p.displayName)}">
      <div class="pc-av">${avatarHTMLFor(p, 56)}</div>
      <div class="pc-n">${esc(p.displayName)}</div>
      <div class="rating-star">&#9733; ${esc(p.points)}</div>
      <div class="pc-l">${p.primaryRole || (p.isOrganiser ? 'Organiser' : (p.region || 'Player'))}</div>
    </button>`).join('') + `</div>`;
}

function renderHomeTeams(){
  const box = $('homeTeamsRail');
  if(!teams.length){
    box.innerHTML = `<div class="empty-note">No teams yet.<br>Build a squad to get started.</div>`;
    return;
  }
  box.innerHTML = `<div class="mini-rail">` +
    teams.slice(0, 8).map(t=>`
      <button class="mini-card" data-home-team>
        <div class="mc-t">${esc(t.name)}</div>
        <div class="mc-s">${t.players.length} player${t.players.length === 1 ? '' : 's'}</div>
      </button>`).join('') +
    `<button class="mini-card add" data-home-team>
      <span style="font-size:20px;line-height:1;">+</span><span style="font-size:11px;">New</span>
    </button></div>`;
  box.querySelectorAll('[data-home-team]').forEach(b=>
    b.addEventListener('click', ()=>go('teams')));
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

/* Guards every ball-scoring entry point (run buttons, extras, wickets)
   against accidental double-submission — a fast double-tap on a touch
   screen, or a stray double click, firing the same delivery twice. All
   three entry points below call this before touching `match`, so a
   duplicate tap inside the window is silently ignored rather than
   recorded as a second ball. */
let lastBallAt = 0;
function ballLock(){
  const now = Date.now();
  if(now - lastBallAt < 350) return false;
  lastBallAt = now;
  return true;
}

/* A match an admin has cancelled is locked exactly like a completed one —
   every scoring entry point (runs, extras, wickets, strike swap) checks
   this alongside `match.completed`. This only catches it once the flag has
   actually synced to this device (next load/save, or immediately for an
   admin themselves) — see adminCancelMatch()'s comment in cloud.js for why
   a true mid-ball realtime kill-switch isn't implemented. */
function matchLocked(m){ return !m || m.completed || m.cancelled; }

function doRun(n){
  if(matchLocked(match) || !ballLock()) return;
  snapshot();
  afterBall(playBall(match, { extra:null, batRuns:n, isWicket:false }));
}
function undo(){
  if(!undoStack.length){ toast('Nothing to undo'); return; }
  match = JSON.parse(undoStack.pop());
  closeModal(); persistMatch(); render();
}
function manualSwap(){
  if(matchLocked(match)) return;
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

/* The "Delivery" selector below is what lets a run out (or the other
   dismissals still legal on an irregular ball) actually be scored *with*
   its no-ball/wide, instead of forcing a choice between recording the
   extra or the wicket. The "How out" list is filtered live to whatever
   ICC Law 21 (No ball) actually permits for the chosen delivery — see
   engine.js allowedDismissalsFor for the exact rules (a no ball or a Free
   Hit fair ball allow only Run Out / Obstructing the Field / retirements;
   a wide additionally still allows Stumped). */
function openWicketModal(){
  const inn = curInnings(match);
  const s = inn.batters[inn.strikerIdx], ns = inn.batters[inn.nonStrikerIdx];
  const last = (inn.wickets + 1) >= inn.allOutWickets;
  const roster = rosterFor(teamName(match, inn.battingTeam))
    .filter(p=>!inn.batters.some(b=>b.name.toLowerCase() === p.toLowerCase()));
  openModal(`<h3>Wicket</h3>
    ${inn.freeHit ? `<div class="stat-dim" style="color:var(--gold-soft);font-weight:600;margin-bottom:10px;">
      FREE HIT is active — Bowled, Caught, LBW, Stumped and Hit Wicket can't apply unless this ball is also a no ball or wide.</div>` : ''}
    <label>Delivery</label>
    <select id="wkDelivery">
      <option value="">Fair ball</option>
      <option value="wd">Wide</option>
      <option value="nb">No Ball</option>
    </select>
    <label>How out</label>
    <select id="wkType"></select>
    <label>Which batter</label>
    <div class="radio-line"><input type="radio" name="whoOut" value="striker" id="woS" checked>
      <label for="woS" style="margin:0;color:var(--ink);">${esc(s.name)} (striker)</label></div>
    <div class="radio-line"><input type="radio" name="whoOut" value="nonstriker" id="woN">
      <label for="woN" style="margin:0;color:var(--ink);">${esc(ns.name)} (non-striker)</label></div>
    <label id="wkRunsLabel">Runs completed before the dismissal</label>
    <input type="number" id="wkRuns" min="0" max="6" value="0">
    ${last ? '<div class="stat-dim" style="margin-top:12px;">Last wicket — the innings will close.</div>'
      : `<label>Incoming batter</label>
         <input type="text" id="wkNewBatter" placeholder="Next batter name" maxlength="20" autocomplete="off">
         <div class="chip-row">${chipsHTML('wkNewBatter', roster)}</div>`}
    <button class="btn danger" data-action="confirm-wicket">Confirm Wicket</button>
    <button class="btn secondary" data-action="close">Cancel</button>`);

  const deliverySel = $('wkDelivery'), typeSel = $('wkType'), runsLabel = $('wkRunsLabel');
  function refreshWicketOptions(){
    const extra = deliverySel.value || null;
    const prevType = typeSel.value;
    const allowed = allowedDismissalsFor(inn, extra);
    typeSel.innerHTML = allowed.map(t=>`<option value="${t}">${t}</option>`).join('');
    typeSel.value = allowed.includes(prevType) ? prevType : allowed[0];
    runsLabel.textContent = extra === 'nb' ? 'Runs scored off the bat before the dismissal'
      : extra === 'wd' ? 'Extra run(s) run off the wide before the dismissal'
      : 'Runs completed before the dismissal';
  }
  deliverySel.addEventListener('change', refreshWicketOptions);
  refreshWicketOptions();
}

function submitWicket(){
  if(matchLocked(match) || !ballLock()) return;
  const inn = curInnings(match);
  const last = (inn.wickets + 1) >= inn.allOutWickets;
  const newName = last ? '' : ($('wkNewBatter').value || '').trim();
  if(!last && !newName){ toast('Enter the incoming batter'); return; }
  const delivery = $('wkDelivery').value || null;
  const ball = {
    extra: delivery,
    batRuns: Math.max(0, parseInt($('wkRuns').value || '0', 10)),
    isWicket:true,
    wicketType: $('wkType').value,
    whoOut: document.querySelector('input[name=whoOut]:checked').value,
    newBatsmanName: newName
  };
  closeModal(); snapshot();
  const res = playBall(match, ball);
  // Belt-and-braces: the dropdown above only ever offers legal options, so
  // this should be unreachable in normal use, but the engine is the source
  // of truth — if it ever disagrees, tell the scorer rather than silently
  // dropping the appeal.
  if(res.wicketRejected){
    toast(`Not out — ${ball.wicketType} isn't a legal dismissal off ${
      delivery === 'wd' ? 'a wide' : delivery === 'nb' ? 'a no ball' : 'a Free Hit'}`);
  }
  afterBall(res);
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
  $('liveCancelledBanner').classList.toggle('hidden', !match.cancelled);
  const inn = curInnings(match);
  $('liveContext').textContent = match.tournamentId
    ? (tournaments.find(t=>t.id === match.tournamentId)?.name || 'LIVE').toUpperCase() : 'LIVE';
  $('sbTeams').textContent = teamName(match, inn.battingTeam) + ' vs ' + teamName(match, inn.bowlingTeam);
  $('sbFreeHit').classList.toggle('hidden', !inn.freeHit);
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
    if(b.freeHit) c += ' freehit';
    return `<div class="${c}" title="${b.freeHit ? 'Free Hit' : ''}">${esc(b.txt)}</div>`;
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
      return `<div class="rank-row" data-action="view-player" data-name="${esc(f.name || p.name)}" style="cursor:pointer;">
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
      <div style="display:flex;align-items:center;gap:10px;min-width:0;cursor:pointer;" data-action="view-team" data-id="${esc(t.id)}">
        ${initialsBadge(t.name, 34)}
        <div style="min-width:0;">
          <div class="batter-name">${esc(t.name)}</div>
          <div class="d">${(t.players||[]).length} player${(t.players||[]).length===1?'':'s'}${t.captain ? ' &middot; Captain: ' + esc(t.captain) : ''}</div>
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
  const capSel = $('teamFormCaptain');
  const prev = capSel.value;
  capSel.innerHTML = '<option value="">No captain set</option>' +
    teamFormRoster.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
  capSel.value = teamFormRoster.includes(prev) ? prev : '';
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
  const captain = $('teamFormCaptain').value || null;
  const team = { id: editingTeamId || makeId(), name, players:[...teamFormRoster], captain, updatedAt: Date.now() };
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
  $('teamFormCaptain').value = '';
}
function editTeam(id){
  const t = teams.find(x=>x.id === id); if(!t) return;
  editingTeamId = t.id; teamFormRoster = [...(t.players||[])];
  $('teamFormName').value = t.name;
  $('teamFormTitle').textContent = 'Edit Team';
  renderRoster();
  $('teamFormCaptain').value = t.captain || '';
  $('teamFormName').scrollIntoView({ behavior:'smooth', block:'center' });
}

/* Team detail — a modal rather than a new full screen/route, to keep this
   addition low-risk (no changes to SCREENS/TAB_OF/GATED routing). Record
   and tournament participation are real, computed from the same
   allCompletedMatches()/tournaments data every other stats screen already
   uses — nothing invented, no captain-less team gets a fake one. */
function openTeamDetailModal(id){
  const t = teams.find(x=>x.id === id); if(!t) return;
  const rec = teamRecords(allCompletedMatches()).find(r=>normName(r.name) === normName(t.name));
  const myTours = tournamentsForTeams(tournaments, [t.name]);
  const roster = t.players || [];
  openModal(`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      ${initialsBadge(t.name, 56)}
      <div style="min-width:0;">
        <div class="batter-name" style="font-size:17px;">${esc(t.name)}</div>
        ${t.captain ? `<div class="stat-dim">Captain: ${esc(t.captain)}</div>` : ''}
      </div>
    </div>
    <div class="stat-strip">
      <div class="stat-box"><div class="sv">${rec ? rec.played : 0}</div><div class="sl">Played</div></div>
      <div class="stat-box"><div class="sv">${rec ? rec.won : 0}</div><div class="sl">Won</div></div>
      <div class="stat-box"><div class="sv">${rec ? rec.lost : 0}</div><div class="sl">Lost</div></div>
      <div class="stat-box"><div class="sv">${rec ? rec.winPct : 0}%</div><div class="sl">Win rate</div></div>
    </div>
    <h3 style="margin:16px 0 8px;font-size:14px;color:var(--gold-soft);">Squad (${roster.length})</h3>
    <div>${roster.length ? roster.map(p=>
      `<span class="roster-chip">${initialsBadge(p, 18)} ${esc(p)}${t.captain === p ? ' <b>(C)</b>' : ''}</span>`
    ).join('') : '<div class="empty-note">No players added yet.</div>'}</div>
    ${myTours.length ? `<h3 style="margin:16px 0 8px;font-size:14px;color:var(--gold-soft);">Tournaments</h3>
      <div class="kv-list">${myTours.map(x=>`<div class="kv-row"><div class="kv-k">${esc(x.name)}</div><div class="kv-v">${statusBadgeHTML(deriveStatus(x, x.status))}</div></div>`).join('')}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn secondary" data-action="close">Close</button>
      <button class="btn" data-action="edit-team-from-modal" data-id="${esc(t.id)}">Edit team</button>
    </div>
  `);
}
async function removeTeam(id){
  teams = teams.filter(t=>t.id !== id); saveTeams();
  if(cloudReady() && getUser()) await deleteTeam(id);
  if(editingTeamId === id) clearTeamForm();
  renderTeams(); toast('Team deleted');
}

/* ---------------- TOURNAMENTS ---------------- */

const STATUS_BADGE = {
  upcoming: ['open','Upcoming'], live: ['live','Live'],
  completed: ['done','Completed'], cancelled: ['cancelled','Cancelled']
};
function statusBadgeHTML(status){
  const [cls, label] = STATUS_BADGE[status] || STATUS_BADGE.upcoming;
  return `<span class="badge ${cls}">${label}</span>`;
}
function fmtDateRange(startDate, endDate){
  if(startDate && endDate && startDate !== endDate) return fmtWhen(startDate) + ' – ' + fmtWhen(endDate);
  if(startDate) return fmtWhen(startDate);
  return '';
}

/* ---------------- live now: public, all-users "what's on" list ---------------- */

async function renderLiveNow(){
  const box = $('liveNowList');
  box.innerHTML = '<div class="empty-note">Loading live matches&hellip;</div>';
  liveNowMatches = await fetchLiveMatchesNow();
  if(!liveNowUnsub){
    liveNowUnsub = watchAllLiveMatches(()=>{ if(screen === 'live-now') renderLiveNow(); });
  }
  paintLiveNowList();
}

function paintLiveNowList(){
  const box = $('liveNowList');
  if(!box) return;
  const q = liveNowFilter.trim().toLowerCase();
  const rows = q ? liveNowMatches.filter(r=>(r.location || '').toLowerCase().includes(q)) : liveNowMatches;

  if(!liveNowMatches.length){
    box.innerHTML = `<div class="card"><div class="empty-note">
      No matches are being scored live right now.<br>Start one yourself and turn on
      <b>Share Live</b> during setup, or check back during a match.</div></div>`;
    return;
  }
  if(!rows.length){
    box.innerHTML = `<div class="card"><div class="empty-note">
      No live matches match "${esc(liveNowFilter)}".
      <button class="icon-btn" id="liveNowClearFilter" style="margin-top:8px;">Clear filter</button>
    </div></div>`;
    $('liveNowClearFilter').addEventListener('click', ()=>{
      liveNowFilter = ''; $('liveNowAreaFilter').value = ''; paintLiveNowList();
    });
    return;
  }

  box.innerHTML = rows.map(r=>{
    const m = r.match;
    const line = (m && m.innings && m.innings[m.currentInningsIdx]) ? inningsLine(m, m.currentInningsIdx) : '';
    return `
    <a class="card live-now-card" href="./live.html?m=${esc(r.id)}" target="_blank" rel="noopener" style="display:block;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <b>${esc((m && m.teamA) || 'Team A')} <span class="stat-dim">vs</span> ${esc((m && m.teamB) || 'Team B')}</b>
        <span class="pill-live mini">LIVE</span>
      </div>
      <div style="margin-top:4px;">${esc(line)}</div>
      <div class="stat-dim" style="margin-top:2px;">${r.location ? esc(r.location) : 'Venue not given'}</div>
    </a>`;
  }).join('');
}

/* ---------------- feedback ---------------- */

let feedbackRating = 0;

function renderFeedback(){
  $('feedbackForm').classList.remove('hidden');
  $('feedbackDone').classList.add('hidden');
  $('fbType').value = 'bug';
  $('fbMessage').value = '';
  feedbackRating = 0;
  paintStars();
}

function paintStars(){
  const box = $('fbStars');
  box.innerHTML = [1,2,3,4,5].map(n=>
    `<span data-star="${n}" style="color:${n <= feedbackRating ? 'var(--gold-soft)' : 'var(--ink-dim)'};">${n <= feedbackRating ? '★' : '☆'}</span>`
  ).join('');
}

async function submitFeedbackForm(){
  if(!isSignedIn()){ go('feedback'); return; }  // render() will bounce to auth with the reason
  const message = $('fbMessage').value.trim();
  if(!message){ toast('Tell us a little about what you think first'); return; }
  const btn = $('fbSubmitBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  const ok = await submitFeedback({
    feedbackType: $('fbType').value,
    rating: feedbackRating || null,
    message,
    page: 'feedback',
    appVersion: APP_VERSION
  });
  btn.disabled = false; btn.textContent = 'Send Feedback';
  if(ok){
    $('feedbackForm').classList.add('hidden');
    $('feedbackDone').classList.remove('hidden');
  } else {
    toast('Could not send feedback — check your connection and try again');
  }
}

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
    const status = deriveStatus(t, t.status);
    const metaLine = [t.location, fmtDateRange(t.startDate, t.endDate)].filter(Boolean).join(' · ');
    return `<div class="tour-card" data-action="open-tour" data-id="${esc(t.id)}">
      ${initialsBadge(t.name, 40)}
      <div class="tc-b">
        <div class="tc-n">${esc(t.name)}</div>
        <div class="tc-m">${TOUR_FORMAT_LABEL[t.format] || 'League'} &middot; ${t.teams.length} teams &middot; ${done}/${fx.length} played</div>
        ${metaLine ? `<div class="tc-m">${esc(metaLine)}</div>` : ''}
        <div style="margin-top:6px;">${statusBadgeHTML(status)}${champ ? ` <span class="badge done">🏆 ${esc(champ.name)}</span>` : ''}</div>
      </div>
      <div class="pc-go">›</div>
    </div>`;
  }).join('');
}

function openNewTournamentModal(){
  openModal(`<h3>New Tournament</h3>
    <label>Name</label>
    <input type="text" id="tName" placeholder="e.g. Ramzan Cup 2026" maxlength="34">
    <div class="auth-error hidden" id="tNameError">Enter a tournament name</div>
    <label>Description</label>
    <textarea id="tDesc" rows="2" placeholder="What's this tournament about?" maxlength="300"></textarea>
    <label>Format</label>
    <select id="tFormat">
      <option value="league-knockout">League + knockouts</option>
      <option value="league">League table only</option>
    </select>
    <div class="row">
      <div><label>Overs</label><input type="number" id="tOvers" min="1" max="90" value="20"></div>
      <div><label>All out at</label><input type="number" id="tWickets" min="1" max="11" value="10"></div>
    </div>
    <label>Location</label>
    <input type="text" id="tLocation" placeholder="City / area" maxlength="60">
    <label>Ground</label>
    <input type="text" id="tGround" placeholder="Ground name" maxlength="60">
    <div class="row">
      <div><label>Start date</label><input type="date" id="tStartDate"></div>
      <div><label>End date</label><input type="date" id="tEndDate"></div>
    </div>
    <label>Entry rules</label>
    <textarea id="tEntryRules" rows="2" placeholder="Who can join, fees, registration deadline&hellip;" maxlength="500"></textarea>
    <label>Tournament rules</label>
    <textarea id="tRules" rows="2" placeholder="Playing conditions, tie-breakers&hellip;" maxlength="1000"></textarea>
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
    <div class="toggle-line" style="margin-top:14px;">
      <div>
        <div style="font-size:14px;font-weight:600;">Make this tournament public</div>
        <div class="stat-dim" id="tPublicHint">Anyone can find it under Recommended Tournaments${cloudReady() && getUser() ? '' : ' (requires sign-in)'}</div>
      </div>
      <label class="switch"><input type="checkbox" id="tPublicToggle" ${cloudReady() && getUser() ? '' : 'disabled'}><span class="slider"></span></label>
    </div>
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
  const nameErr = $('tNameError');
  if(!name){ nameErr.classList.remove('hidden'); toast('Enter a tournament name'); return; }
  nameErr.classList.add('hidden');
  const picked = teams.filter(t=>window.__tSelected.has(t.id)).map(t=>({ id:t.id, name:t.name }));
  const adhoc = (window.__tAdHoc || []).map(n=>({ id:makeId(), name:n }));
  const list = [...picked, ...adhoc];
  if(list.length < 2){ toast('Pick at least 2 teams'); return; }

  const startDate = $('tStartDate').value || null;
  const endDate = $('tEndDate').value || null;
  if(startDate && endDate && endDate < startDate){ toast('End date is before the start date'); return; }

  const t = createTournament({
    name, format: $('tFormat').value,
    oversLimit: Math.max(1, parseInt($('tOvers').value || '20', 10)),
    allOutWickets: Math.max(1, Math.min(11, parseInt($('tWickets').value || '10', 10))),
    teams: list,
    location: $('tLocation').value.trim(), ground: $('tGround').value.trim(),
    startDate, endDate, description: $('tDesc').value.trim(),
    entryRules: $('tEntryRules').value.trim(), rules: $('tRules').value.trim(),
    status: 'upcoming'
  });
  t.fixtures = generateRoundRobin(t, { legs: parseInt($('tLegs').value || '1', 10) });
  const publicToggle = $('tPublicToggle');
  t.isPublic = !!(publicToggle && !publicToggle.disabled && publicToggle.checked);
  tournaments.unshift(t); saveTours();
  if(cloudReady() && getUser()) await saveTournament(t);
  closeModal();
  openTourId = t.id; tourTab = 'overview'; viewedTournamentPublic = null; go('tournament');
  toast(t.fixtures.length + ' fixtures generated');
}

/* ---------------- tournament viewing: owner (My Tournaments) or public ---------------- */

function currentTour(){
  return tournaments.find(t=>t.id === openTourId) ||
    (viewedTournamentPublic && viewedTournamentPublic.id === openTourId ? viewedTournamentPublic : null);
}

/* True when this device/account can manage the tournament: either it's in
   this device's own list (local or synced — created by this account), or
   (defensive, e.g. a fresh device before sync finishes) the fetched row's
   owner matches the signed-in user. Every mutating action gated on this is
   also independently enforced server-side by the "owner has full access"
   RLS policy, so this flag is a UI convenience, not the real boundary. */
function isTourOwner(t){
  if(!t) return false;
  if(tournaments.some(x=>x.id === t.id)) return true;
  const u = getUser();
  return !!(u && t.ownerId && t.ownerId === u.id);
}

/* Opens a tournament for viewing. Synchronous for your own (already
   local); for anything else, fetches it read-only — RLS decides whether
   that succeeds (public tournaments only, or your own from another
   device). */
async function openTournamentView(id){
  openTourId = id; tourTab = 'overview';
  const mine = tournaments.find(x=>x.id === id);
  if(mine){ viewedTournamentPublic = null; tourLoading = false; tourLoadError = ''; go('tournament'); return; }
  viewedTournamentPublic = null; tourLoadError = '';
  tourLoading = true; go('tournament');
  const t = cloudReady() ? await fetchTournamentById(id) : null;
  tourLoading = false;
  if(openTourId !== id) return; // navigated elsewhere while this was loading
  if(!t){ tourLoadError = "This tournament is private, was deleted, or the link isn't valid."; render(); return; }
  viewedTournamentPublic = t;
  render();
}

function renderTournament(){
  const t = currentTour();
  const statusBox = $('tourStatusBox');
  const content = $('tourContent');

  if(!t){
    if(tourLoading || tourLoadError){
      statusBox.classList.remove('hidden'); content.classList.add('hidden');
      $('tourStatusText').textContent = tourLoading ? 'Loading tournament…' : tourLoadError;
      return;
    }
    go('tournaments'); return;
  }
  statusBox.classList.add('hidden'); content.classList.remove('hidden');

  const owner = isTourOwner(t);
  const status = deriveStatus(t, t.status);

  $('tourName').textContent = t.name;
  $('tourMenuBtn').classList.toggle('hidden', !owner);
  $('tourStatusBadge').innerHTML = statusBadgeHTML(status);

  const champ = tournamentChampion(t);
  $('championBox').innerHTML = champ
    ? `<div class="champion-box"><div class="ct">🏆 Champions</div><div class="cn">${esc(champ.name)}</div></div>` : '';

  document.querySelectorAll('#screen-tournament .pill').forEach(p=>
    p.classList.toggle('active', p.dataset.tab === tourTab));
  ['overview','table','fixtures','knockout','teams','organizer','rules'].forEach(x=>
    $('tourTab' + x[0].toUpperCase() + x.slice(1)).classList.toggle('hidden', x !== tourTab));

  if(tourTab === 'overview') renderTourOverview(t, owner, status);
  else if(tourTab === 'table') renderTourTable(t);
  else if(tourTab === 'fixtures') renderTourFixtures(t, owner);
  else if(tourTab === 'knockout') renderTourKnockout(t, owner);
  else if(tourTab === 'teams') renderTourTeams(t, owner);
  else if(tourTab === 'organizer') renderTourOrganizer(t);
  else if(tourTab === 'rules') renderTourRules(t, owner);
}

function renderTourOverview(t, owner, status){
  const fx = allFixtures(t);
  const done = fx.filter(f=>f.status === 'completed').length;
  const metaRows = [
    ['Status', statusBadgeHTML(status)],
    ['Format', esc(t.format === 'league' ? 'League table only' : 'League + knockouts')],
    ['Overs', esc(t.oversLimit) + ' overs · all out at ' + esc(t.allOutWickets)],
    t.location ? ['Location', esc(t.location)] : null,
    t.ground ? ['Ground', esc(t.ground)] : null,
    (t.startDate || t.endDate) ? ['Dates', esc(fmtDateRange(t.startDate, t.endDate) || '—')] : null,
    ['Teams', esc(t.teams.length)],
    ['Fixtures', `${done}/${fx.length} played`],
    ['Visibility', t.isPublic ? 'Public — anyone can find and view this'
      : owner ? 'Private — only visible to you' : 'Private — visible to the organizer and admins']
  ].filter(Boolean);

  $('tourTabOverview').innerHTML = `
    ${t.description ? `<div class="card"><div class="stat-dim">${esc(t.description)}</div></div>` : ''}
    <div class="card">
      <div class="sec-head"><h2>Tournament information</h2></div>
      <div class="kv-list">
        ${metaRows.map(([k,v])=>`<div class="kv-row"><div class="kv-k">${esc(k)}</div><div class="kv-v">${v}</div></div>`).join('')}
      </div>
    </div>
  `;
}

function renderTourOrganizer(t){
  const box = $('tourTabOrganizer');
  box.innerHTML = '<div class="card"><div class="empty-note">Loading organizer info…</div></div>';
  (async ()=>{
    let name = 'Organizer', handle = '', avatar = initialsBadge('Organizer', 40);
    if(t.ownerId){
      if(!profileCache[t.ownerId]) await resolveProfiles([t.ownerId]);
      const p = profileCache[t.ownerId];
      if(p){ name = p.displayName || name; handle = p.handle || ''; avatar = avatarHTMLFor(p, 40); }
    } else if(isTourOwner(t)){
      name = displayName(); handle = (myPublicProfile && myPublicProfile.handle) || ''; avatar = avatarHTML(40);
    }
    if($('tourTabOrganizer').classList.contains('hidden')) return; // navigated away
    box.innerHTML = `<div class="card">
      <div class="list-pick" style="cursor:default;">
        ${avatar}
        <div class="lp-n">${esc(name)}${handle ? ` <span class="stat-dim">@${esc(handle)}</span>` : ''}</div>
      </div>
      ${handle ? `<button class="btn secondary small" data-action="view-player" data-uid="${esc(t.ownerId || (getUser() && getUser().id) || '')}" data-name="${esc(name)}">View profile</button>` : '<div class="stat-dim">This organizer hasn\'t set up a public profile yet.</div>'}
    </div>`;
  })();
}

function renderTourRules(t, owner){
  $('tourTabRules').innerHTML = `
    <div class="card">
      <div class="sec-head"><h2>Entry rules</h2></div>
      ${t.entryRules ? `<div class="stat-dim">${esc(t.entryRules)}</div>` : '<div class="empty-note">No entry rules added yet.</div>'}
    </div>
    <div class="card">
      <div class="sec-head"><h2>Tournament rules</h2></div>
      ${t.rules ? `<div class="stat-dim">${esc(t.rules)}</div>` : '<div class="empty-note">No rules added yet.</div>'}
    </div>
    <div class="card">
      <div class="sec-head"><h2>Points &amp; NRR</h2></div>
      <div class="stat-dim">Win ${POINTS.win} pts · Tie ${POINTS.tie} pt · Loss ${POINTS.loss} pts.
        NRR follows the ICC rule: a side bowled out is charged the full quota of overs.</div>
    </div>`;
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

function renderTourFixtures(t, owner){
  const rows = t.fixtures.map(f=>fixtureRowHTML(t, f, owner)).join('');
  $('tourTabFixtures').innerHTML = `<div class="card">
    <div class="sec-head"><h2>League Fixtures</h2>
      ${owner ? `<button class="icon-btn" data-action="regen-fixtures">Regenerate</button>` : ''}</div>
    ${rows || '<div class="empty-note">No fixtures yet.</div>'}
  </div>`;
}

function fixtureRowHTML(t, f, owner){
  const done = f.status === 'completed' && f.result;
  const a = teamNameById(t, f.teamAId), b = teamNameById(t, f.teamBId);
  const canPlay = owner && f.teamAId && f.teamBId && !done;
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
      ${owner && !done ? `<button class="icon-btn" data-action="set-fixture-date" data-id="${esc(f.id)}">Date</button>` : ''}
      ${canPlay ? `<button class="icon-btn" data-action="play-fixture" data-id="${esc(f.id)}">Play</button>` : ''}
      ${done ? `<button class="icon-btn" data-action="view-fixture" data-id="${esc(f.id)}">Card</button>` : ''}
    </div>
  </div>`;
}

function renderTourKnockout(t, owner){
  const box = $('tourTabKnockout');
  if(t.format === 'league'){
    box.innerHTML = `<div class="card"><div class="empty-note">This is a league-only tournament.<br>The team top of the table wins it.</div></div>`;
    return;
  }
  if(!t.knockout || !t.knockout.length){
    const ready = leagueComplete(t);
    box.innerHTML = `<div class="card">
      <div class="empty-note">${ready
        ? 'League complete.' + (owner ? ' Generate the knockout bracket from the final table.' : ' The knockout bracket hasn\'t been generated yet.')
        : owner
          ? 'The bracket unlocks when every league fixture has been played.<br>You can also generate it early if you want.'
          : 'The knockout bracket hasn\'t started yet.'}</div>
      ${owner ? `<button class="btn" data-action="gen-knockout">Generate Knockout Bracket</button>` : ''}
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
      ${owner && f.teamAId && f.teamBId && f.status !== 'completed'
        ? `<button class="icon-btn" data-action="play-fixture" data-id="${esc(f.id)}">Play</button>` : ''}
      ${f.status === 'completed' ? `<button class="icon-btn" data-action="view-fixture" data-id="${esc(f.id)}">Card</button>` : ''}
    </div></div>`;

  box.innerHTML = `<div class="card"><div class="sec-head"><h2>Knockout</h2>
      ${owner ? `<button class="icon-btn" data-action="gen-knockout">Reset bracket</button>` : ''}</div>
    <div class="bracket">
      ${semis.length ? `<div class="bracket-round"><h5>Semi-finals</h5>
        ${semis.map((f,i)=>mk(f, 'Semi-final ' + (i+1))).join('')}</div>` : ''}
      ${final ? `<div class="bracket-round"><h5>Final</h5>${mk(final, 'Final')}</div>` : ''}
    </div></div>`;
}

function renderTourTeams(t, owner){
  $('tourTabTeams').innerHTML = `<div class="card">
    <div class="sec-head"><h2>Teams</h2></div>
    ${t.teams.map(tm=>`<div class="hist-item">
      <div style="display:flex;align-items:center;gap:10px;">
        ${initialsBadge(tm.name, 32)}<div class="batter-name">${esc(tm.name)}</div>
      </div>
      ${owner ? `<div class="d">${(rosterFor(tm.name) || []).length} players</div>` : ''}
    </div>`).join('')}
    ${owner ? `<button class="btn secondary small" data-action="delete-tour">Delete this tournament</button>` : ''}
  </div>`;
}

function playFixture(fixtureId){
  const t = currentTour(); if(!t || !isTourOwner(t)) return;
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
  const t = currentTour(); if(!t || !isTourOwner(t)) return;
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
  const t = currentTour(); if(!t || !isTourOwner(t)) return;
  t.knockout = generateKnockout(t);
  advanceKnockout(t);
  saveTours();
  if(cloudReady() && getUser()) await saveTournament(t);
  render(); toast('Bracket generated');
}

async function regenFixtures(){
  const t = currentTour(); if(!t || !isTourOwner(t)) return;
  const played = t.fixtures.filter(f=>f.status === 'completed').length;
  if(played > 0){ toast('Cannot regenerate — matches already played'); return; }
  t.fixtures = generateRoundRobin(t, { legs:1 });
  saveTours();
  if(cloudReady() && getUser()) await saveTournament(t);
  render(); toast('Fixtures regenerated');
}

async function removeTournament(){
  const t = currentTour(); if(!t || !isTourOwner(t)) return;
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

function iosInstallInstructions(){
  openModal(`<h3>Install Cricket Connect</h3>
    <div class="stat-dim" style="margin-bottom:10px;">Full screen, works with no signal at the ground.</div>
    <div class="stat-dim">1. Tap the <b>Share</b> icon in Safari's toolbar</div>
    <div class="stat-dim" style="margin-top:6px;">2. Scroll down and choose <b>"Add to Home Screen"</b></div>
    <div class="stat-dim" style="margin-top:6px;">3. Tap <b>Add</b> — that's it</div>
    <button class="btn secondary" style="margin-top:14px;" data-action="close">Got it</button>`);
}

function setupInstallPrompt(){
  const banner = $('installBanner');
  $('installMark').innerHTML = brandMark(34);
  const card = $('installCard');
  const rowBtn = $('installRowBtn');

  // Already running as an installed app (either platform) — nothing to do,
  // there's no "install" affordance to show.
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if(isStandalone) return;

  // The dismissible top banner is easy to miss or swipe away, so the same
  // action also lives permanently in Profile -> Get the app for anyone who
  // wants to install later.
  card.classList.remove('hidden');

  // iOS Safari never fires `beforeinstallprompt` and has no programmatic
  // install API at all — Apple only exposes it through the manual
  // Share -> "Add to Home Screen" flow. Without this branch, iPhone/iPad
  // users (a large share of visitors) never see any install prompt.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  if(isIOS){
    $('installBtn').classList.add('hidden');
    $('installSub').textContent = 'Tap Share, then "Add to Home Screen"';
    $('installRowSub').textContent = 'Tap Share, then "Add to Home Screen"';
    rowBtn.addEventListener('click', iosInstallInstructions);
    if(!load(LS_INSTALL_DISMISSED, false)) banner.classList.remove('hidden');
  } else {
    rowBtn.addEventListener('click', async ()=>{
      if(!deferredInstall){ toast('Open this in Chrome/Edge on your phone to install'); return; }
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      deferredInstall = null;
      banner.classList.add('hidden');
      if(outcome === 'accepted') toast('Installing Cricket Connect');
    });

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
  }

  $('installDismiss').addEventListener('click', ()=>{
    banner.classList.add('hidden');
    save(LS_INSTALL_DISMISSED, true);
  });

  window.addEventListener('appinstalled', ()=>{
    banner.classList.add('hidden');
    card.classList.add('hidden');
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
/* `tournament` (the detail page, singular) is deliberately NOT in this list
   — viewing a tournament is meant to work for guests too, same as a public
   player profile or a live match link. Only `tournaments` (creating/
   managing your own) stays gated. Every mutating action reachable from the
   detail page is separately guarded by isTourOwner() and, underneath that,
   by Supabase RLS — so this isn't the real security boundary, just where
   guests stop being asked to sign in for something they're allowed to see. */
const GATED = {
  setup:'access live scoring', live:'access live scoring', teams:'build teams',
  tournaments:'run tournaments',
  stats:'see your records', history:'see your match history',
  friends:'find and add friends', admin:'manage the platform',
  feedback:'leave feedback'
};

function render(){
  paintBrandMarks();
  renderSidebarAccount();

  /* Anyone without an account trying to reach a gated screen is sent to the
     sign-in screen instead, with the reason carried along so renderAuth()
     can show a specific "sign in to X" message rather than a blank prompt.
     This is the single choke point every gated screen passes through —
     there's no separate path into 'setup'/'live' that skips it (see the
     `?go=` deep-link handling in boot(), which applies the same check
     before ever setting screen to a gated value). */
  authGateReason = (requiresAccount() && !isSignedIn() && GATED[screen]) ? GATED[screen] : null;
  if(authGateReason){
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
    case 'player': renderPlayerProfile(); break;
    case 'live-now': renderLiveNow(); break;
    case 'feedback': renderFeedback(); break;
    case 'admin':
      if(!isAdminUser){ go('home'); return; }
      renderAdmin();
      break;
  }

  // Tear down the two realtime subscriptions unique to this session (Live
  // Now's all-matches feed, admin's presence count) when their screen isn't
  // the one showing, so they don't keep running in the background forever.
  if(screen !== 'live-now' && liveNowUnsub){ liveNowUnsub(); liveNowUnsub = null; }
  if(screen !== 'admin' && onlineUnsub){ onlineUnsub(); onlineUnsub = null; }
  if(screen !== 'admin' && adminLiveUnsub){ adminLiveUnsub(); adminLiveUnsub = null; }
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

  // desktop sidebar account dropdown
  $('saChipBtn').addEventListener('click', (e)=>{
    e.stopPropagation();
    $('saMenu').classList.toggle('hidden');
  });
  document.addEventListener('click', (e)=>{
    const acc = $('sidebarAccount');
    if(!acc.contains(e.target)) $('saMenu').classList.add('hidden');
  });

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
  $('heroFindTournaments').addEventListener('click', ()=>go('tournaments'));
  $('heroFindPlayers').addEventListener('click', ()=>go('friends'));
  // Previously identical to "Explore Tournaments" (both just opened the list) —
  // this one now actually opens the create-tournament flow once the auth gate
  // (tournaments is a GATED screen) has let the user through.
  $('heroCreateTournament').addEventListener('click', ()=>{
    go('tournaments');
    if(isSignedIn()) openNewTournamentModal();
  });
  $('homeFindPlayersBtn').addEventListener('click', ()=>go('friends'));
  $('homeTournamentsSeeAll').addEventListener('click', ()=>go('tournaments'));
  $('homeLiveSeeAll').addEventListener('click', ()=>go('live-now'));
  $('homeUpcomingTourSeeAll').addEventListener('click', ()=>go('tournaments'));
  $('homeTeamsSeeAll').addEventListener('click', ()=>go('teams'));
  $('homeStatsSeeAll').addEventListener('click', ()=>go('stats'));
  $('homeCtaSignIn').addEventListener('click', ()=>go('auth'));
  $('fabNew').addEventListener('click', ()=>{
    if(match && !match.completed) go('live');
    else { setupPrefill = null; go('setup'); }
  });
  $('qaTournament').addEventListener('click', ()=>go('tournaments'));
  $('qaTeams').addEventListener('click', ()=>go('teams'));
  $('qaHistory').addEventListener('click', ()=>go('history'));
  $('qaLiveNow').addEventListener('click', ()=>go('live-now'));
  $('liveNowAreaFilter').addEventListener('input', e=>{ liveNowFilter = e.target.value; paintLiveNowList(); });

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

  // player profile
  document.querySelectorAll('#playerTabs .pill').forEach(p=>
    p.addEventListener('click', ()=>{ playerTab = p.dataset.pt; render(); }));
  $('playerBackBtn').addEventListener('click', ()=>go(playerReturnScreen || 'home'));
  $('playerShareBtn').addEventListener('click', async ()=>{
    const vp = viewedPlayer; if(!vp) return;
    const handle = vp.isSelf ? (myPublicProfile && myPublicProfile.handle)
      : (vp.uid && profileCache[vp.uid] && profileCache[vp.uid].handle);
    if(!handle){
      toast(vp.isSelf ? 'Set a username in My Profile first to get a shareable link'
                       : "This player hasn't set a public username yet");
      return;
    }
    try{
      const url = playerShareUrl(handle);
      if(navigator.share) await navigator.share({ title: vp.name + ' — Cricket Connect', url });
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    }catch(e){ toast('Could not copy'); }
  });

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
  $('feedbackBack').addEventListener('click', ()=>go('profile'));
  $('fbStars').addEventListener('click', e=>{
    const s = e.target.closest('[data-star]');
    if(!s) return;
    feedbackRating = parseInt(s.dataset.star, 10);
    paintStars();
  });
  $('fbSubmitBtn').addEventListener('click', submitFeedbackForm);
  $('fbAnotherBtn').addEventListener('click', renderFeedback);
  $('tourMenuBtn').addEventListener('click', ()=>{ tourTab = 'teams'; render(); });
  $('tourShareBtn').addEventListener('click', async ()=>{
    const t = currentTour(); if(!t) return;
    if(!t.isPublic && isTourOwner(t)){
      toast('Turn on "Make this tournament public" first so the link works for others');
      return;
    }
    try{
      const url = tourShareUrl(t.id);
      if(navigator.share) await navigator.share({ title: t.name + ' — Cricket Connect', url });
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    }catch(e){ toast('Could not copy'); }
  });
  document.querySelectorAll('#screen-tournament .pill').forEach(p=>
    p.addEventListener('click', ()=>{ tourTab = p.dataset.tab; render(); }));

  // admin
  $('adminRefreshBtn').addEventListener('click', ()=>refreshAdminData().then(renderAdmin));
  $('adminRetryBtn').addEventListener('click', ()=>refreshAdminData().then(renderAdmin));
  document.querySelectorAll('#adminTabs .pill').forEach(p=>
    p.addEventListener('click', ()=>{ adminTab = p.dataset.atab; renderAdmin(); }));
  document.querySelectorAll('#adminMatchFilters .pill').forEach(p=>
    p.addEventListener('click', ()=>{ adminMatchFilter = p.dataset.mf; renderAdmin(); }));
  document.querySelectorAll('#adminFeedbackFilters .pill').forEach(p=>
    p.addEventListener('click', ()=>{ adminFeedbackFilter = p.dataset.ff; renderAdmin(); }));
  $('adminTourSearch').addEventListener('input', e=>{ adminTourSearch = e.target.value; renderAdminTournaments(); });
  $('adminTourStatusFilter').addEventListener('change', e=>{ adminTourStatusFilter = e.target.value; renderAdminTournaments(); });
  $('adminTourLocationFilter').addEventListener('input', e=>{ adminTourLocationFilter = e.target.value; renderAdminTournaments(); });
  $('adminUserSearch').addEventListener('input', e=>{ adminUserSearch = e.target.value; renderAdminUsers(); });
  $('adminFeedbackTypeFilter').addEventListener('change', e=>{ adminFeedbackTypeFilter = e.target.value; renderAdminFeedback(); });

  // profile
  $('saveProfileBtn').addEventListener('click', saveProfileForm);
  $('photoUploadBtn').addEventListener('click', ()=>$('photoInput').click());
  $('photoRemoveBtn').addEventListener('click', removePhoto);
  $('photoInput').addEventListener('change', (e)=>{
    const f = e.target.files && e.target.files[0];
    if(f) handlePhotoPick(f);
    e.target.value = '';
  });
  // Export-as-JSON is intentionally no longer exposed to normal users — the
  // exportData() function still exists elsewhere in this file in case it's
  // useful for a future admin/dev tool, it's just not wired to any button.
  $('goFeedbackBtn').addEventListener('click', ()=>go('feedback'));
  $('viewMyProfileBtn').addEventListener('click', ()=>{
    const u = getUser();
    openPlayerProfile(u ? { uid: u.id, name: displayName() } : { name: displayName() });
  });

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
      if(matchLocked(match) || !ballLock()) return;
      const n = parseInt(el.dataset.n,10); const type = pendingExtra; pendingExtra = null;
      closeModal(); snapshot(); afterBall(playBall(match, { extra:type, batRuns:n, isWicket:false }));
    }
    else if(a === 'confirm-wicket') submitWicket();
    else if(a === 'confirm-bowler') submitNewBowler();
    else if(a === 'confirm-innings2') submitSecondInnings();
    else if(a === 'confirm-end-innings'){ closeModal(); handleInningsEnd(); }
    else if(a === 'view-history'){ historyViewId = el.dataset.id; go('result'); }
    else if(a === 'edit-team') editTeam(el.dataset.id);
    else if(a === 'view-team') openTeamDetailModal(el.dataset.id);
    else if(a === 'edit-team-from-modal'){ closeModal(); editTeam(el.dataset.id); }
    else if(a === 'del-team') removeTeam(el.dataset.id);
    else if(a === 'rm-player'){ teamFormRoster.splice(parseInt(el.dataset.i,10),1); renderRoster(); }
    else if(a === 'save-event') saveEventForm();
    else if(a === 'del-event') removeEvent(el.dataset.id);
    else if(a === 'start-event') startFromItem(el.dataset.kind, el.dataset.id);
    else if(a === 'open-tour') openTournamentView(el.dataset.id);
    else if(a === 'open-new-tournament'){ go('tournaments'); if(isSignedIn()) openNewTournamentModal(); }
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
    else if(a === 'go-auth') go('auth');
    else if(a === 'send-friend') sendFriendReq(el.dataset.uid);
    else if(a === 'accept-friend') respondFriendReq(el.dataset.id, true);
    else if(a === 'decline-friend') respondFriendReq(el.dataset.id, false);
    else if(a === 'unfriend') unfriend(el.dataset.id);
    else if(a === 'submit-organiser-app') submitApplyOrganiser();
    else if(a === 'approve-app') approveApp(el.dataset.id);
    else if(a === 'reject-app') rejectApp(el.dataset.id);
    else if(a === 'view-player') openPlayerProfile({ uid: el.dataset.uid || null, name: el.dataset.name || null });
    else if(a === 'admin-toggle-manage'){
      const id = el.dataset.id;
      if(adminMatchManageOpen.has(id)) adminMatchManageOpen.delete(id); else adminMatchManageOpen.add(id);
      renderAdminMatches();
    }
    else if(a === 'admin-view-tournament') openTournamentView(el.dataset.id);
    else if(a === 'admin-cancel-tournament') adminCancelTournamentPrompt(el.dataset.id, el.dataset.name);
    else if(a === 'admin-cancel-match') adminCancelMatchPrompt(el.dataset.id, el.dataset.name);
    else if(a === 'admin-stop-live') adminStopLiveAction(el.dataset.id);
    else if(a === 'admin-suspend-organiser') adminSuspendOrganiserPrompt(el.dataset.id, el.dataset.name);
    else if(a === 'admin-review-feedback') adminReviewFeedbackAction(el.dataset.id, el.dataset.status);
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
    // Counts this session toward the admin dashboard's "online now" figure —
    // works for guests too, since watching live matches never required an
    // account.
    joinPresence();

    await resumeRedirect();
    onAuth(async (user)=>{
      if(user){
        const p = await fetchProfile();
        if(p) profile = {
          displayName: p.displayName || profile.displayName,
          avatarId: p.avatarId || profile.avatarId,
          photo: p.photo || profile.photo,
          country: p.country || profile.country,
          region: p.region || profile.region,
          district: p.district || profile.district,
          area: p.area || profile.area
        };
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
        await runDailyCheckIn();
      } else {
        cloudMatches = [];
        myPublicProfile = null; isAdminUser = false; myConnections = []; pendingApps = [];
        $('sideAdminBtn').classList.add('hidden');
      }
      render();
    });
  }

  // Manifest shortcuts and deep links: ?go=setup | tournaments | stats | teams
  // ?tour=<id> — a shareable tournament link. Works for guests: it bypasses
  // the "sign in first" redirect below the same way a live-match link does,
  // since viewing a tournament doesn't require an account.
  const params = new URLSearchParams(location.search);
  const deep = params.get('go');
  const tourDeep = params.get('tour');
  const allowed = ['setup','tournaments','stats','teams','history','profile'];

  if(tourDeep){
    history.replaceState({}, '', location.pathname);
    openTournamentView(tourDeep); // sets its own loading state and calls render()
    return;
  }

  // Don't special-case "not signed in" here by jumping straight to 'auth' —
  // that used to skip past render()'s own GATED check, so a guest opening a
  // deep link straight into a gated screen (e.g. ?go=setup) landed on a
  // blank sign-in screen with no explanation. Set the *intended* screen and
  // let render()'s single gate check (below, same one every other
  // navigation already goes through) redirect with the proper reason.
  screen = (deep && allowed.includes(deep)) ? deep : 'home';

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
