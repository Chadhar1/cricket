/* ===========================================================================
   avatars.js — bundled cricket avatars, drawn as inline SVG.
   No image files, no Firebase Storage, no network. Works offline.
   A user's profile stores only the avatar id (e.g. "helmet"), never an image.
   =========================================================================== */

export const AVATARS = [
  { id:'helmet',    name:'Helmet',     c1:'#1c3868', c2:'#0a1630' },
  { id:'ball',      name:'Ball',       c1:'#c0392b', c2:'#7d1f16' },
  { id:'bat',       name:'Bat',        c1:'#b9822f', c2:'#7a5219' },
  { id:'stumps',    name:'Stumps',     c1:'#0f7a52', c2:'#054d33' },
  { id:'cap',       name:'Cap',        c1:'#2b6cb0', c2:'#173f6b' },
  { id:'trophy',    name:'Trophy',     c1:'#d4af37', c2:'#8a6d1b' },
  { id:'gloves',    name:'Gloves',     c1:'#7b4bb7', c2:'#452a68' },
  { id:'ground',    name:'Ground',     c1:'#00693e', c2:'#02402a' },
  { id:'flag',      name:'Flag',       c1:'#0d7b7b', c2:'#064a4a' },
  { id:'umpire',    name:'Umpire',     c1:'#4a5568', c2:'#232a36' },
  { id:'scoreboard',name:'Scoreboard', c1:'#c2410c', c2:'#7a2708' },
  { id:'shield',    name:'Shield',     c1:'#9b1c4b', c2:'#5d0f2d' }
];

export const DEFAULT_AVATAR = 'helmet';

/* Inner artwork for each avatar, drawn on a 100x100 canvas. */
const GLYPHS = {
  helmet: `
    <path d="M50 24c-14 0-24 10-24 23v10h10V47c0-8 6-14 14-14s14 6 14 14v10h10V47c0-13-10-23-24-23z" fill="#fff" opacity=".95"/>
    <rect x="24" y="58" width="52" height="7" rx="3.5" fill="#fff" opacity=".95"/>
    <rect x="30" y="68" width="40" height="5" rx="2.5" fill="#fff" opacity=".55"/>
    <circle cx="50" cy="35" r="3" fill="#fff" opacity=".55"/>`,
  ball: `
    <circle cx="50" cy="50" r="24" fill="#fff" opacity=".95"/>
    <path d="M34 36c8 6 8 22 0 28M66 36c-8 6-8 22 0 28" stroke="#c0392b" stroke-width="3" fill="none" stroke-linecap="round"/>
    <g stroke="#c0392b" stroke-width="2.4" stroke-linecap="round">
      <path d="M37 40h5M36 47h5M36 54h5M37 61h5M63 40h-5M64 47h-5M64 54h-5M63 61h-5"/>
    </g>`,
  bat: `
    <rect x="46" y="20" width="8" height="22" rx="4" fill="#fff" opacity=".9"/>
    <path d="M38 44c0-3 2-5 5-5h14c3 0 5 2 5 5v24c0 6-5 11-12 11s-12-5-12-11V44z" fill="#fff" opacity=".95"/>
    <path d="M50 46v28" stroke="#b9822f" stroke-width="2.5" stroke-linecap="round"/>`,
  stumps: `
    <g fill="#fff" opacity=".95">
      <rect x="32" y="30" width="6" height="46" rx="3"/>
      <rect x="47" y="30" width="6" height="46" rx="3"/>
      <rect x="62" y="30" width="6" height="46" rx="3"/>
      <rect x="31" y="24" width="23" height="5" rx="2.5"/>
      <rect x="46" y="24" width="23" height="5" rx="2.5"/>
    </g>`,
  cap: `
    <path d="M50 26c-13 0-23 9-23 21v4h46v-4c0-12-10-21-23-21z" fill="#fff" opacity=".95"/>
    <path d="M27 51h52c6 0 10 3 10 7H27z" fill="#fff" opacity=".7"/>
    <circle cx="50" cy="30" r="4" fill="#fff" opacity=".6"/>`,
  trophy: `
    <path d="M36 24h28v14c0 8-6 14-14 14s-14-6-14-14V24z" fill="#fff" opacity=".95"/>
    <path d="M36 28h-8v6c0 5 4 9 9 9M64 28h8v6c0 5-4 9-9 9" stroke="#fff" stroke-width="3.5" fill="none" opacity=".8" stroke-linecap="round"/>
    <rect x="45" y="52" width="10" height="12" fill="#fff" opacity=".9"/>
    <rect x="35" y="64" width="30" height="8" rx="3" fill="#fff" opacity=".95"/>`,
  gloves: `
    <path d="M30 44c0-4 3-7 7-7s7 3 7 7v-6c0-4 3-7 7-7s7 3 7 7v20c0 8-6 14-14 14H44c-8 0-14-6-14-14V44z" fill="#fff" opacity=".95"/>
    <path d="M44 44v14M51 40v18" stroke="#7b4bb7" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="30" y="66" width="35" height="7" rx="3.5" fill="#fff" opacity=".7"/>`,
  ground: `
    <circle cx="50" cy="50" r="28" fill="none" stroke="#fff" stroke-width="3" opacity=".9"/>
    <circle cx="50" cy="50" r="17" fill="none" stroke="#fff" stroke-width="1.6" opacity=".4"/>
    <rect x="45" y="30" width="10" height="40" rx="2" fill="#fff" opacity=".88"/>
    <rect x="41" y="28" width="18" height="3" rx="1.5" fill="#fff" opacity=".7"/>
    <rect x="41" y="69" width="18" height="3" rx="1.5" fill="#fff" opacity=".7"/>`,
  flag: `
    <rect x="32" y="20" width="5" height="58" rx="2.5" fill="#fff" opacity=".95"/>
    <circle cx="34.5" cy="20" r="3.5" fill="#fff" opacity=".95"/>
    <path d="M39 25c9-4 18-4 27 0c-3 5-3 10 0 15c-9 4-18 4-27 0z" fill="#fff" opacity=".9"/>`,
  umpire: `
    <circle cx="50" cy="34" r="11" fill="#fff" opacity=".95"/>
    <path d="M30 76v-8c0-9 9-15 20-15s20 6 20 15v8z" fill="#fff" opacity=".95"/>
    <path d="M50 22v-6" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".85"/>`,
  scoreboard: `
    <rect x="23" y="27" width="54" height="40" rx="6" fill="#fff" opacity=".95"/>
    <rect x="23" y="27" width="54" height="40" rx="6" fill="none" stroke="#c2410c" stroke-width="2" opacity=".22"/>
    <g fill="#c2410c">
      <rect x="30" y="35" width="17" height="9" rx="2"/>
      <rect x="53" y="35" width="17" height="9" rx="2"/>
      <rect x="30" y="48" width="40" height="6" rx="2" opacity=".6"/>
      <rect x="30" y="57" width="26" height="5" rx="2" opacity=".4"/>
    </g>
    <rect x="42" y="67" width="16" height="9" fill="#fff" opacity=".85"/>`,
  shield: `
    <path d="M50 18l24 9v22c0 16-11 28-24 32-13-4-24-16-24-32V27z" fill="#fff" opacity=".95"/>
    <path d="M50 18l24 9v22c0 16-11 28-24 32-13-4-24-16-24-32V27z" fill="none" stroke="#9b1c4b" stroke-width="1.5" opacity=".25"/>
    <path d="M50 33v28M37 47h26" stroke="#9b1c4b" stroke-width="3.2" stroke-linecap="round"/>
    <circle cx="50" cy="47" r="3.2" fill="#9b1c4b"/>`
};

export function getAvatar(id){
  return AVATARS.find(a=>a.id === id) || AVATARS.find(a=>a.id === DEFAULT_AVATAR);
}

/* Returns a standalone <svg> string. Safe to inject with innerHTML.
   The gloss highlight + thin outer ring are drawn once here, shared by
   every avatar, rather than baked into each individual glyph — a cheap way
   to give the whole bundled set a consistent "badge" finish instead of
   flat filled circles. */
export function avatarSVG(id, size = 44){
  const a = getAvatar(id);
  const gid = 'ag_' + a.id;
  const hgid = 'agh_' + a.id;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${a.name} avatar">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${a.c1}"/><stop offset="1" stop-color="${a.c2}"/>
      </linearGradient>
      <radialGradient id="${hgid}" cx="32%" cy="26%" r="60%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".28"/>
        <stop offset="65%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="49" fill="url(#${gid})" stroke="rgba(255,255,255,.16)" stroke-width="1.5"/>
    ${GLYPHS[a.id] || ''}
    <circle cx="50" cy="50" r="49" fill="url(#${hgid})"/>
  </svg>`;
}

/* Initials fallback, used for team badges and players with no avatar. */
export function initialsBadge(name, size = 36){
  const txt = String(name || '?').trim().split(/\s+/).slice(0,2).map(w=>w[0] || '').join('').toUpperCase() || '?';
  let hash = 0;
  for(let i=0;i<String(name||'').length;i++) hash = (hash*31 + String(name).charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${txt}">
    <circle cx="50" cy="50" r="50" fill="hsl(${hue} 45% 34%)"/>
    <text x="50" y="50" dy="0.35em" text-anchor="middle"
      font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="40" font-weight="700" fill="#fff">${txt}</text>
  </svg>`;
}

/* ===========================================================================
   Brand mark — the Cricket Connect emblem.
   Distilled from the full logo: the open "C" swoosh (navy into green) with the
   ball breaking out of the gap. Deliberately simple — it has to stay legible
   at 48px on a home screen, where a batsman and a skyline would turn to mush.
   =========================================================================== */
export function brandMark(size = 40){
  const u = 'bm' + Math.random().toString(36).slice(2, 7);
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cricket Connect">
    <defs><clipPath id="${u}"><rect x="0" y="0" width="100" height="100" rx="22"/></clipPath></defs>
    <g clip-path="url(#${u})">
      <rect width="100" height="100" fill="#0f1c3e"/>
      <path d="M50 12a38 38 0 1 0 38 38" fill="none" stroke="#3a5696" stroke-width="13" stroke-linecap="butt"/>
      <path d="M14 52a36 36 0 0 0 72 0" fill="none" stroke="#227834" stroke-width="13"/>
      <circle cx="76" cy="26" r="15" fill="#0f1c3e"/>
      <circle cx="76" cy="26" r="12" fill="#c62828" stroke="#ffffff" stroke-width="2.6"/>
    </g>
  </svg>`;
}

/* Full logo lockup: emblem + wordmark + tagline. Used on the sign-in screen. */
export function brandLockup(size = 78){
  return `<div class="lockup">
    <div class="lockup-mark">${brandMark(size)}</div>
    <h1 class="lockup-name">Cricket <span>Connect</span></h1>
    <div class="lockup-rule"></div>
    <p class="lockup-tag">Connecting cricket. Creating champions.</p>
  </div>`;
}
