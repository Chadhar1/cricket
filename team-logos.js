/* ===========================================================================
   team-logos.js — procedurally generated team crests, drawn as inline SVG.

   Mirrors avatars.js's approach (bundled glyphs composed at render time, no
   image files, no network, works fully offline) but for teams instead of
   players: 5 crest frames x 10 icon glyphs = 50 distinct combinations,
   deterministically picked from a hash of the team's id (or name, if the id
   is missing) so the same team always gets the same default crest — nothing
   is re-randomized on every render.

   A team can later override this with a real uploaded image (see
   readTeamLogoFile() in app.js, which mirrors the existing readPhotoFile()
   profile-photo pattern). That upload is stored as team.logo — a plain data
   URL string on the team object, saved through the exact same local-first
   + best-effort-cloud-sync path every other team field already uses (no
   schema change: teams are stored as an opaque JSON blob both in
   localStorage and in Supabase's teams.data / tournaments.data columns, so
   a new object key just works). resolveTeamLogo() below is the single
   entry point everything else (team lists, tournament screens, and the
   broadcast overlay renderer) should call — it prefers team.logo and only
   falls back to a generated crest when nothing has been uploaded, exactly
   like initialsBadge() already does for players without an avatar.
   =========================================================================== */

/* ---- 5 crest frame silhouettes (100x100 viewBox) ---- */
const SHAPES = [
  { id:'shield',  d:'M50 5 L91 20 V50 C91 75 72 91 50 96 C28 91 9 75 9 50 V20 Z' },
  { id:'circle',  d:'M50 2a48 48 0 1 0 0.1 0Z' },
  { id:'hex',     d:'M50 4 L90 27 V73 L50 96 L10 73 V27 Z' },
  { id:'square',  d:'M6 6h88v88H6z' },
  { id:'pennant', d:'M7 9h86v62L50 97 7 71Z' }
];

/* ---- 10 icon glyphs, drawn white over the crest, ~100x100 space ---- */
const ICONS = {
  bat: `
    <rect x="46" y="18" width="8" height="20" rx="4" fill="#fff" opacity=".92"/>
    <path d="M39 40c0-3 2-5 5-5h12c3 0 5 2 5 5v23c0 6-5 10-11 10s-11-4-11-10V40z" fill="#fff" opacity=".95"/>`,
  ball: `
    <circle cx="50" cy="50" r="23" fill="#fff" opacity=".95"/>
    <path d="M35 37c7 6 7 20 0 26M65 37c-7 6-7 20 0 26" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  stumps: `
    <g fill="#fff" opacity=".95">
      <rect x="34" y="32" width="6" height="42" rx="3"/>
      <rect x="47" y="32" width="6" height="42" rx="3"/>
      <rect x="60" y="32" width="6" height="42" rx="3"/>
      <rect x="33" y="27" width="21" height="5" rx="2.5"/>
      <rect x="46" y="27" width="21" height="5" rx="2.5"/>
    </g>`,
  star: `<path d="M50,20 57.6,39.5 78.5,40.7 62.4,54 67.6,74.3 50,63 32.4,74.3 37.6,54 21.5,40.7 42.4,39.5Z" fill="#fff" opacity=".95"/>`,
  flame: `<path d="M50 18c-9 15-23 24-23 41a23 23 0 0 0 46 0c0-10-6-17-10-23c-2 9-6 11-8 7-3-6 3-17-5-25z" fill="#fff" opacity=".95"/>`,
  bolt: `<path d="M57 14 27 55h18l-6 31 34-44H55z" fill="#fff" opacity=".95"/>`,
  wing: `
    <path d="M12 56c22 11 46 11 70-4-6 17-28 32-53 30-11-1-19-14-17-26z" fill="#fff" opacity=".95"/>
    <path d="M20 54c14-1 28-7 36-18" stroke="currentColor" stroke-width="2" fill="none" opacity=".3" stroke-linecap="round"/>`,
  crown: `
    <path d="M22 66 26 36 42 52 50 26 58 52 74 36 78 66Z" fill="#fff" opacity=".95"/>
    <rect x="20" y="66" width="60" height="8" rx="2" fill="#fff" opacity=".9"/>
    <circle cx="50" cy="26" r="4" fill="#fff" opacity=".95"/>
    <circle cx="26" cy="36" r="3" fill="#fff" opacity=".85"/>
    <circle cx="74" cy="36" r="3" fill="#fff" opacity=".85"/>`,
  cup: `
    <path d="M36 22h28v11c0 12-8 20-14 20s-14-8-14-20V22z" fill="#fff" opacity=".95"/>
    <path d="M36 27h-7v3c0 7 4 11 9 12M64 27h7v3c0 7-4 11-9 12" stroke="#fff" stroke-width="3" fill="none" opacity=".85" stroke-linecap="round"/>
    <rect x="45" y="52" width="10" height="11" fill="#fff" opacity=".9"/>
    <rect x="34" y="64" width="32" height="7" rx="3" fill="#fff" opacity=".95"/>`,
  wreath: `
    <g stroke="#fff" stroke-width="4" fill="none" opacity=".9" stroke-linecap="round">
      <path d="M41 19C27 25 21 39 24 55c2 12 11 21 20 24"/>
      <path d="M59 19c14 6 20 20 17 36-2 12-11 21-20 24"/>
    </g>
    <g stroke="#fff" stroke-width="2.2" opacity=".65" stroke-linecap="round">
      <path d="M30 30l6 4M26 42l6 2M27 53l6-1"/>
      <path d="M70 30l-6 4M74 42l-6 2M73 53l-6-1"/>
    </g>
    <circle cx="50" cy="50" r="6" fill="#fff" opacity=".9"/>`
};
const ICON_IDS = Object.keys(ICONS);

export const TEAM_LOGO_VARIANT_COUNT = SHAPES.length * ICON_IDS.length; // 50

function hashOf(str){
  let h = 0;
  const s = String(str || '');
  for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/* Deterministic (shape, icon, hue) triple for a given team id/name — same
   input always yields the same crest, this is not re-rolled per render. */
function variantFor(team){
  const seed = (team && (team.id || team.name)) || 'team';
  const h = hashOf(seed);
  const shape = SHAPES[h % SHAPES.length];
  const icon = ICON_IDS[Math.floor(h / SHAPES.length) % ICON_IDS.length];
  const hue = (h * 137) % 360; // independent spread so same shape+icon pair still varies by team
  return { shape, icon, hue };
}

/* Standalone <svg> string for a generated crest — safe to inject with
   innerHTML, same convention as avatars.js's avatarSVG()/initialsBadge().
   The inset inner-border and gloss highlight are drawn from the same
   shape path, scaled/overlaid, rather than baked into each shape — one
   real "team crest" treatment shared by all 50 variants instead of a
   flat filled outline. */
export function teamLogoSVG(team, size = 64){
  const { shape, icon, hue } = variantFor(team);
  const gid = 'tlg_' + shape.id + '_' + (hue|0);
  const hgid = 'tlh_' + shape.id + '_' + (hue|0);
  const c1 = `hsl(${hue} 58% 42%)`, c2 = `hsl(${hue} 64% 17%)`;
  const name = (team && team.name) || 'Team';
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${name} crest" color="${c2}">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
      </linearGradient>
      <radialGradient id="${hgid}" cx="30%" cy="24%" r="65%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".3"/>
        <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <path d="${shape.d}" fill="url(#${gid})" stroke="rgba(255,255,255,.3)" stroke-width="2"/>
    <path d="${shape.d}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1" transform="translate(50 50) scale(.87) translate(-50 -50)"/>
    ${ICONS[icon]}
    <path d="${shape.d}" fill="url(#${hgid})"/>
  </svg>`;
}

/* Markup for wherever a team's logo is shown — prefers an uploaded image
   (team.logo, a data URL) and only falls back to the generated crest when
   nothing has been uploaded. This is the one function everything else
   (team list, tournament screens, broadcast overlay template previews)
   should call rather than re-deciding the fallback logic themselves. */
export function resolveTeamLogoMarkup(team, size = 64){
  if(team && team.logo){
    const name = esc(team.name || 'Team');
    return `<img src="${team.logo}" width="${size}" height="${size}" style="border-radius:50%;object-fit:cover;display:block" alt="${name} crest">`;
  }
  return teamLogoSVG(team, size);
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Loads a team's crest (uploaded photo or generated SVG) as a real
   HTMLImageElement, resolved once decoded. This is what the video
   compositor (recorder.js) and any <canvas>-based overlay renderer need —
   canvas.drawImage() can't draw an SVG string or a data URL directly, it
   needs an Image that has actually finished loading. Never rejects: on any
   failure it resolves with null so a template can just skip drawing the
   crest for that frame rather than crashing the recording. */
export function loadTeamLogoImage(team, size = 128){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = ()=>resolve(null);
    if(team && team.logo){
      img.src = team.logo;
    } else {
      const svg = teamLogoSVG(team, size);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }
  });
}
