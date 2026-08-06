/* ===========================================================================
   social.js — the rules of the social layer, with no DOM and no Firebase.

   Everything here is pure so it can be unit-tested, and so the same logic can
   be mirrored in the Firestore security rules. Anything the client enforces
   here is ALSO enforced server-side in firestore.rules — this file is for a
   good user experience, not for security.

   Data model this describes:

     profiles/{uid}                 public: handle, name, avatar, bio
     handles/{handle}               uniqueness lock -> { uid }
     connections/{pairId}           friendship between two players
     chats/{chatId}                 dm or team conversation
     chats/{chatId}/messages/{id}   the messages
     clubs/{clubId}                 shared team: captain, members, squad cap
     clubs/{clubId}/requests/{uid}  join requests awaiting the captain
     leagues/{leagueId}             public tournament
     leagues/{id}/roster/{uid}      ONE doc per player — the one-team lock
     organiserApplications/{id}     request to organise, awaiting admin
     reports/{id}                   moderation reports
     admins/{uid}                   super-admin allowlist (console-only)
   =========================================================================== */

/* ---------------------------------------------------------------------------
   Handles
   Lowercase, 3–20 chars, letters/numbers/underscore, must start with a letter.
   Stored lowercased so "Haris" and "haris" can't both be claimed.
   --------------------------------------------------------------------------- */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

/* Words that shouldn't be claimable as handles — either they'd let someone
   impersonate the platform, or they collide with routes we may add later. */
const RESERVED = new Set([
  'admin','administrator','root','support','help','official','cricketconnect',
  'cricket','connect','team','teams','club','clubs','league','leagues',
  'tournament','tournaments','player','players','match','matches','api',
  'system','moderator','mod','staff','null','undefined','me','you','settings'
]);

export function normaliseHandle(raw){
  return String(raw || '').trim().replace(/^@+/, '').toLowerCase();
}

/* Returns { ok, error } so the UI can show exactly what's wrong. */
export function validateHandle(raw){
  const h = normaliseHandle(raw);
  if(!h) return { ok:false, error:'Pick a username.' };
  if(h.length < HANDLE_MIN) return { ok:false, error:`At least ${HANDLE_MIN} characters.` };
  if(h.length > HANDLE_MAX) return { ok:false, error:`At most ${HANDLE_MAX} characters.` };
  if(!/^[a-z]/.test(h)) return { ok:false, error:'Must start with a letter.' };
  if(!/^[a-z0-9_]+$/.test(h)) return { ok:false, error:'Letters, numbers and underscore only.' };
  if(RESERVED.has(h)) return { ok:false, error:'That username is reserved.' };
  return { ok:true, handle:h };
}

export function displayHandle(h){ return h ? '@' + normaliseHandle(h) : ''; }

/* ---------------------------------------------------------------------------
   Connections
   One document per pair, with a deterministic id so the same two people can
   never end up with two competing requests. Sorting the uids is what makes it
   deterministic regardless of who asks first.
   --------------------------------------------------------------------------- */

export function pairId(uidA, uidB){
  if(!uidA || !uidB) return null;
  if(uidA === uidB) return null;                 // no self-connections
  return [uidA, uidB].sort().join('__');
}

export const CONNECTION = { PENDING:'pending', ACCEPTED:'accepted', DECLINED:'declined' };

export function newConnection(fromUid, toUid){
  const id = pairId(fromUid, toUid);
  if(!id) return null;
  return {
    id,
    members: [fromUid, toUid].sort(),
    requestedBy: fromUid,
    status: CONNECTION.PENDING,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

/* What the current user can do with a given connection doc. Drives the button
   shown on a profile: Add / Pending / Accept / Message. */
export function connectionActionFor(conn, myUid){
  if(!conn) return 'request';
  if(conn.status === CONNECTION.ACCEPTED) return 'connected';
  if(conn.status === CONNECTION.PENDING){
    return conn.requestedBy === myUid ? 'awaiting' : 'respond';
  }
  return 'request';                               // declined can be re-requested
}

/* Only the person who did NOT send it may accept. Prevents someone
   auto-accepting their own request by writing straight to the document. */
export function canRespond(conn, myUid){
  return !!conn
      && conn.status === CONNECTION.PENDING
      && conn.requestedBy !== myUid
      && Array.isArray(conn.members)
      && conn.members.includes(myUid);
}

export function otherMember(conn, myUid){
  if(!conn || !Array.isArray(conn.members)) return null;
  return conn.members.find(u=>u !== myUid) || null;
}

/* ---------------------------------------------------------------------------
   Chat
   A DM id is derived from the pair, so opening a chat with someone twice
   always lands in the same conversation. Team chats use the club id.
   --------------------------------------------------------------------------- */

export function dmChatId(uidA, uidB){
  const p = pairId(uidA, uidB);
  return p ? 'dm__' + p : null;
}

export function teamChatId(clubId){
  return clubId ? 'team__' + clubId : null;
}

export const MESSAGE_MAX = 1000;

export function validateMessage(text){
  const t = String(text || '').trim();
  if(!t) return { ok:false, error:'Message is empty.' };
  if(t.length > MESSAGE_MAX) return { ok:false, error:`Keep it under ${MESSAGE_MAX} characters.` };
  return { ok:true, text:t };
}

/* You may only message someone you're connected to, and neither of you has
   blocked the other. Team chats need club membership instead. */
export function canDM(conn, myUid, blockedByMe, blockedMe){
  if(blockedByMe || blockedMe) return false;
  return !!conn && conn.status === CONNECTION.ACCEPTED && conn.members.includes(myUid);
}

export function canReadChat(chat, myUid){
  return !!chat && Array.isArray(chat.members) && chat.members.includes(myUid);
}

/* ---------------------------------------------------------------------------
   Clubs (shared teams)
   A club has a captain, a member list and a squad cap. Everything below is
   about who may do what, and whether there's room.
   --------------------------------------------------------------------------- */

export const SQUAD_MIN = 2;
export const SQUAD_MAX = 30;
export const SQUAD_DEFAULT = 15;

export const CLUB_ROLE = { CAPTAIN:'captain', VICE:'vice', MEMBER:'member' };

export function newClub({ name, captainUid, squadSize = SQUAD_DEFAULT, id, open = true }){
  return {
    id,
    name: String(name || '').trim(),
    captainUid,
    viceUids: [],
    memberUids: [captainUid],
    squadSize: clampSquad(squadSize),
    open,                                          // accepting join requests?
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function clampSquad(n){
  const v = parseInt(n, 10);
  if(isNaN(v)) return SQUAD_DEFAULT;
  return Math.max(SQUAD_MIN, Math.min(SQUAD_MAX, v));
}

export function squadCount(club){
  return Array.isArray(club && club.memberUids) ? club.memberUids.length : 0;
}

export function squadSpaces(club){
  return Math.max(0, (club.squadSize || SQUAD_DEFAULT) - squadCount(club));
}

export function isClubFull(club){
  return squadSpaces(club) <= 0;
}

export function roleInClub(club, uid){
  if(!club || !uid) return null;
  if(club.captainUid === uid) return CLUB_ROLE.CAPTAIN;
  if(Array.isArray(club.viceUids) && club.viceUids.includes(uid)) return CLUB_ROLE.VICE;
  if(Array.isArray(club.memberUids) && club.memberUids.includes(uid)) return CLUB_ROLE.MEMBER;
  return null;
}

export function isClubMember(club, uid){ return roleInClub(club, uid) !== null; }

/* Captains and vice-captains can approve requests and manage the squad. */
export function canManageClub(club, uid){
  const r = roleInClub(club, uid);
  return r === CLUB_ROLE.CAPTAIN || r === CLUB_ROLE.VICE;
}

/* Only the captain can do the destructive things. */
export function canAdministerClub(club, uid){
  return roleInClub(club, uid) === CLUB_ROLE.CAPTAIN;
}

/* Why a join request would be refused — returned so the UI can explain. */
export function joinRefusalReason(club, uid){
  if(!club) return 'That team no longer exists.';
  if(isClubMember(club, uid)) return 'You are already in this squad.';
  if(!club.open) return 'This team is not accepting requests.';
  if(isClubFull(club)) return `Squad is full (${club.squadSize} players).`;
  return null;
}

export function canRequestToJoin(club, uid){
  return joinRefusalReason(club, uid) === null;
}

/* Approving needs a free space AND the approver to have authority. Checked
   again at approval time because the squad may have filled in the meantime. */
export function canApproveJoin(club, approverUid){
  if(!canManageClub(club, approverUid)) return { ok:false, error:'Only the captain can approve.' };
  if(isClubFull(club)) return { ok:false, error:`Squad is full (${club.squadSize} players).` };
  return { ok:true };
}

/* The captain can't simply walk out — someone has to be left holding it. */
export function canLeaveClub(club, uid){
  if(!isClubMember(club, uid)) return { ok:false, error:'You are not in this squad.' };
  if(roleInClub(club, uid) === CLUB_ROLE.CAPTAIN){
    if(squadCount(club) > 1){
      return { ok:false, error:'Hand the captaincy to someone else before leaving.' };
    }
  }
  return { ok:true };
}

export function canRemoveMember(club, actorUid, targetUid){
  if(targetUid === club.captainUid) return { ok:false, error:'The captain cannot be removed.' };
  if(!canManageClub(club, actorUid)) return { ok:false, error:'Only the captain can remove players.' };
  if(actorUid === targetUid) return { ok:false, error:'Use Leave squad instead.' };
  return { ok:true };
}

/* ---------------------------------------------------------------------------
   Leagues and the one-team-per-player rule

   The rule: within a single league, a player may be registered to exactly one
   team. Enforced by a roster document whose id IS the player's uid:

       leagues/{leagueId}/roster/{uid}  ->  { teamId, clubId, joinedAt }

   Because the document id is the uid, a second registration in the same league
   collides with an existing document. The security rules only allow `create`
   when the document does not already exist, so the database itself refuses the
   duplicate — it does not depend on the app checking first.
   --------------------------------------------------------------------------- */

export function rosterDocId(uid){ return uid; }

export function rosterEntry(uid, leagueId, clubId, teamName){
  return { uid, leagueId, clubId, teamName, joinedAt: Date.now() };
}

/* Given the roster docs already loaded, is this player free to be registered? */
export function rosterConflict(existingEntry, clubId){
  if(!existingEntry) return null;
  if(existingEntry.clubId === clubId) return null;      // already in, same team — fine
  return {
    error: 'Already registered in this league with ' + (existingEntry.teamName || 'another team') + '.',
    clubId: existingEntry.clubId
  };
}

/* Validate a whole squad before entering a league: no duplicates, enough
   players, and nobody already tied to a different team in that league. */
export function validateLeagueEntry({ club, minPlayers = 2, rosterByUid = {} }){
  const errors = [];
  if(!club) return { ok:false, errors:['Team not found.'] };

  const members = Array.isArray(club.memberUids) ? club.memberUids : [];
  if(members.length < minPlayers){
    errors.push(`Need at least ${minPlayers} players in the squad (currently ${members.length}).`);
  }
  if(new Set(members).size !== members.length){
    errors.push('Squad contains a duplicated player.');
  }
  members.forEach(uid=>{
    const clash = rosterConflict(rosterByUid[uid], club.id);
    if(clash) errors.push(clash.error);
  });
  return { ok: errors.length === 0, errors };
}

/* ---------------------------------------------------------------------------
   Organiser applications
   --------------------------------------------------------------------------- */

export const APPLICATION = { PENDING:'pending', APPROVED:'approved', REJECTED:'rejected' };

export function newOrganiserApplication({ uid, handle, displayName, orgName, description, contact }){
  return {
    uid, handle, displayName,
    orgName: String(orgName || '').trim(),
    description: String(description || '').trim(),
    contact: String(contact || '').trim(),
    status: APPLICATION.PENDING,
    createdAt: Date.now(),
    reviewedAt: null,
    reviewedBy: null,
    adminNote: ''
  };
}

export function validateApplication(app){
  const errors = [];
  if(!app.orgName || app.orgName.length < 3) errors.push('Give the league or tournament a name.');
  if(!app.description || app.description.length < 20){
    errors.push('Describe it in at least 20 characters — who plays, where, how often.');
  }
  if(!app.contact) errors.push('Add a contact so you can be reached.');
  return { ok: errors.length === 0, errors };
}

export function canCreateLeague(profile){
  return !!profile && (profile.isAdmin === true || profile.isOrganiser === true);
}

/* ---------------------------------------------------------------------------
   Moderation — required by Google Play for anything with user content
   --------------------------------------------------------------------------- */

export const REPORT_REASONS = [
  { id:'abuse',      label:'Abusive or threatening' },
  { id:'harassment', label:'Harassment or bullying' },
  { id:'spam',       label:'Spam or scam' },
  { id:'impersonation', label:'Pretending to be someone else' },
  { id:'inappropriate', label:'Inappropriate content' },
  { id:'other',      label:'Something else' }
];

export function newReport({ reporterUid, targetUid, targetType, targetId, reason, detail }){
  return {
    reporterUid, targetUid,
    targetType,                                    // 'user' | 'message' | 'club' | 'league'
    targetId,
    reason,
    detail: String(detail || '').trim().slice(0, 500),
    status: 'open',                                // open | actioned | dismissed
    createdAt: Date.now(),
    reviewedBy: null,
    reviewedAt: null
  };
}

export function validateReport(r){
  if(!r.targetId) return { ok:false, error:'Nothing selected to report.' };
  if(!REPORT_REASONS.some(x=>x.id === r.reason)) return { ok:false, error:'Pick a reason.' };
  if(r.reporterUid === r.targetUid) return { ok:false, error:'You cannot report yourself.' };
  return { ok:true };
}

/* Blocking is one-directional in storage but two-directional in effect: if
   either party has blocked the other, no messages flow between them. */
export function isBlockedEitherWay(myBlocks, theirBlocks, myUid, otherUid){
  const iBlocked = Array.isArray(myBlocks) && myBlocks.includes(otherUid);
  const theyBlocked = Array.isArray(theirBlocks) && theirBlocks.includes(myUid);
  return iBlocked || theyBlocked;
}

/* ---------------------------------------------------------------------------
   Public profile shaping
   Only these fields ever leave the private user document. Keeps email and
   anything else out of the publicly readable collection by construction.
   --------------------------------------------------------------------------- */

export function publicProfileFrom({ uid, handle, displayName, avatarId, bio, isOrganiser, isAdmin }){
  return {
    uid,
    handle: normaliseHandle(handle),
    displayName: String(displayName || '').trim().slice(0, 40),
    avatarId: avatarId || 'helmet',
    bio: String(bio || '').trim().slice(0, 160),
    isOrganiser: !!isOrganiser,
    isAdmin: !!isAdmin,
    updatedAt: Date.now()
  };
}

/* Client-side search over already-fetched profiles. Firestore can prefix-match
   on handle server-side; this covers name matching once results are back. */
export function matchesSearch(profile, query){
  const q = String(query || '').trim().toLowerCase().replace(/^@/, '');
  if(!q) return false;
  return normaliseHandle(profile.handle).includes(q)
      || String(profile.displayName || '').toLowerCase().includes(q);
}
