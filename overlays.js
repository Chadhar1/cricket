/* ===========================================================================
   overlays.js — the Broadcast Overlay Renderer layer.

   Pure <canvas> drawing. This file has never heard of getUserMedia,
   MediaRecorder, or a video file — it just draws a score bug + (optionally)
   one event animation onto whatever 2D context it's handed, given a plain
   state object. recorder.js (the Video Compositor) is the only thing that
   knows this output is being burned into a recording; overlays.js itself
   could equally well feed a future live-streaming layer untouched, exactly
   per the architecture proposal (Scoring Engine -> Event Adapter ->
   Broadcast Overlay Renderer -> Video Compositor -> Local Video File).

   5 templates, matching the spec:
     classic            - clean traditional dark/blue broadcast style, minimal animation
     modern              - dark bg, CricketConnect green identity, dynamic transitions
     broadcast-pro        - TV-style layout with batter/bowler panels
     minimal              - small unobtrusive corner overlay, footage stays the focus
     tournament-premium   - tournament name + team crests + fuller match info

   Mid-recording template switching just means calling drawOverlay() with a
   different templateId on the next frame — there is no per-template setup
   or teardown state kept anywhere else, so it's safe by construction.
   =========================================================================== */

import { curInnings, teamName, runRate, chaseInfo, fmtOvers, bowlerEcon } from './engine.js';

export const TEMPLATES = [
  { id:'classic',             name:'Classic',             blurb:'Clean traditional dark/blue broadcast style, minimal animation.' },
  { id:'modern',               name:'Modern',               blurb:'Dark background, CricketConnect green identity, dynamic transitions.' },
  { id:'broadcast-pro',         name:'Broadcast Pro',         blurb:'Professional TV-style layout with batter and bowler panels.' },
  { id:'minimal',               name:'Minimal',               blurb:'Small, unobtrusive overlay — your footage stays the focus.' },
  { id:'tournament-premium',    name:'Tournament Premium',    blurb:'Tournament name, team crests, and full match info.' }
];

const COLOR = {
  bg0:'#0D1B2A', bg2:'#162A3A', bg3:'#1B3245',
  acc:'#1E7D3A', acc2:'#25A244',
  live:'#ef4444', warn:'#f59e0b', info:'#0ea5e9',
  ink:'#FFFFFF', inkDim:'#A7B0B8', gold:'#F8C539',
  line:'rgba(255,255,255,.18)'
};

const EVENT_DURATION = {
  FOUR:3500, SIX:4000, WICKET:4000, FIFTY:3500, CENTURY:4500,
  WIDE:1800, NO_BALL:1800, OVER_COMPLETE:2500, INNINGS_COMPLETE:3500, MATCH_COMPLETE:6000
};
export function eventDuration(type){ return EVENT_DURATION[type] || 2500; }

function eventText(evt){
  switch(evt.type){
    case 'FOUR':    return { title:'🔥 FOUR!',    sub: evt.player || '',                          color: COLOR.gold };
    case 'SIX':     return { title:'💥 SIX!',     sub: evt.player || '',                          color: COLOR.live };
    case 'WICKET':  return { title:'⚡ WICKET!',  sub: [evt.player, evt.dismissal].filter(Boolean).join(' · '), color: COLOR.live };
    case 'FIFTY':   return { title:'⭐ FIFTY!',   sub: evt.player || '',                          color: COLOR.gold };
    case 'CENTURY': return { title:'💯 CENTURY!', sub: evt.player || '',                          color: COLOR.gold };
    case 'WIDE':    return { title:'WIDE',        sub:'',                                         color: COLOR.info };
    case 'NO_BALL': return { title:'NO BALL',     sub:'Free Hit next ball',                       color: COLOR.warn };
    case 'OVER_COMPLETE':    return { title:'END OF OVER',     sub:'', color: COLOR.inkDim };
    case 'INNINGS_COMPLETE': return { title:'INNINGS BREAK',   sub:'', color: COLOR.acc2 };
    case 'MATCH_COMPLETE':   return { title:'MATCH COMPLETE',  sub: evt.resultText || '', color: COLOR.gold };
    default:        return { title: evt.type || '', sub:'', color: COLOR.ink };
  }
}

/* Generic fade/scale/slide envelope shared by every template's event
   animation — in over the first 12% of its duration, held, out over the
   last 18%. Templates vary in how they use alpha/scale/ty, not whether
   they have an envelope at all. */
function animPhase(progress){
  const inEnd = 0.12, outStart = 0.82;
  let alpha = 1, scale = 1, ty = 0;
  if(progress < inEnd){
    const t = progress / inEnd;
    alpha = t; scale = 0.82 + 0.18 * t; ty = (1 - t) * 18;
  } else if(progress > outStart){
    const t = (progress - outStart) / (1 - outStart);
    alpha = 1 - t; ty = -t * 14;
  }
  return { alpha, scale, ty };
}

function rr(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx, str, x, y, { size = 24, weight = 700, color = COLOR.ink, align = 'left', family = '-apple-system,Segoe UI,Roboto,sans-serif' } = {}){
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

/* ---------------------------------------------------------------------------
   Overlay state — read-only snapshot of the live match, built fresh every
   frame from data engine.js already exposes. Nothing here mutates match
   state; this is purely "what should currently be on screen".
   --------------------------------------------------------------------------- */
export function buildOverlayState(match, opts = {}){
  if(!match) return null;
  const inn = curInnings(match);
  const striker = inn.batters[inn.strikerIdx] || null;
  const nonStriker = inn.batters[inn.nonStrikerIdx] || null;
  const bowler = inn.bowlers[inn.bowlerIdx] || null;
  return {
    teamA: match.teamA, teamB: match.teamB,
    battingName: teamName(match, inn.battingTeam),
    bowlingName: teamName(match, inn.bowlingTeam),
    runs: inn.runs, wickets: inn.wickets,
    oversStr: fmtOvers(inn.legalBalls), oversLimit: match.oversLimit,
    crr: runRate(inn.runs, inn.legalBalls),
    chase: chaseInfo(match),
    striker: striker && { name: striker.name, runs: striker.runs, balls: striker.balls },
    nonStriker: nonStriker && { name: nonStriker.name, runs: nonStriker.runs, balls: nonStriker.balls },
    bowler: bowler && { name: bowler.name, wickets: bowler.wickets, runs: bowler.runs, econ: bowlerEcon(bowler), oversStr: fmtOvers(bowler.legalBalls) },
    recentBalls: (inn.thisOverBalls || []).slice(-6),
    venue: match.venue || '',
    tournamentName: opts.tournamentName || null,
    teamALogoImg: opts.teamALogoImg || null,
    teamBLogoImg: opts.teamBLogoImg || null
  };
}

/* ---------------------------------------------------------------------------
   Template 1 — Classic: a slim lower-third bar, minimal motion.
   --------------------------------------------------------------------------- */
function drawClassic(ctx, w, h, s, activeEvent){
  const barH = Math.round(h * 0.09);
  const y = h - barH - Math.round(h * 0.03);
  const barW = Math.round(w * 0.82);
  const x = (w - barW) / 2;

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = COLOR.bg0;
  rr(ctx, x, y, barW, barH, 8);
  ctx.fill();
  ctx.strokeStyle = COLOR.gold; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + barW, y); ctx.stroke();
  ctx.restore();

  const pad = barW * 0.03;
  const scoreStr = `${s.battingName} ${s.runs}/${s.wickets}`;
  text(ctx, scoreStr, x + pad, y + barH * 0.42, { size: barH * 0.34, color: COLOR.ink, weight: 800 });
  text(ctx, `(${s.oversStr}/${s.oversLimit} ov)  CRR ${s.crr}`, x + pad, y + barH * 0.78, { size: barH * 0.22, color: COLOR.inkDim, weight: 500 });

  if(s.striker){
    const right = `${s.striker.name} ${s.striker.runs}(${s.striker.balls})`;
    text(ctx, right, x + barW - pad, y + barH * 0.42, { size: barH * 0.24, color: COLOR.gold, weight: 700, align:'right' });
  }
  if(s.chase){
    text(ctx, `Need ${Math.max(0, s.chase.runsNeeded)} off ${Math.max(0, s.chase.ballsLeft)}`, x + barW - pad, y + barH * 0.78, { size: barH * 0.2, color: COLOR.inkDim, align:'right' });
  }

  if(activeEvent) drawClassicEvent(ctx, w, h, activeEvent);
}
function drawClassicEvent(ctx, w, h, evt){
  const { title, sub, color } = eventText(evt.type ? evt : evt);
  const { alpha } = animPhase(evt.progress);
  ctx.save();
  ctx.globalAlpha = alpha;
  const cy = h * 0.28;
  text(ctx, title, w / 2, cy, { size: h * 0.07, color, weight: 800, align:'center' });
  if(sub) text(ctx, sub, w / 2, cy + h * 0.045, { size: h * 0.03, color: COLOR.ink, weight: 500, align:'center' });
  ctx.restore();
}

/* ---------------------------------------------------------------------------
   Template 2 — Modern: rounded pill top-left, green brand accent, event
   banner slides in from the right with a small bounce.
   --------------------------------------------------------------------------- */
function drawModern(ctx, w, h, s, activeEvent){
  const pillW = Math.round(w * 0.34), pillH = Math.round(h * 0.13);
  const x = Math.round(w * 0.03), y = Math.round(h * 0.04);

  ctx.save();
  ctx.globalAlpha = 0.93;
  ctx.fillStyle = COLOR.bg0;
  rr(ctx, x, y, pillW, pillH, pillH / 2.4);
  ctx.fill();
  ctx.fillStyle = COLOR.acc;
  rr(ctx, x, y, pillW * 0.02 + 6, pillH, pillH / 2.4);
  ctx.fill();
  ctx.restore();

  const pad = pillW * 0.09;
  text(ctx, s.battingName, x + pad, y + pillH * 0.36, { size: pillH * 0.24, color: COLOR.acc2, weight: 700 });
  text(ctx, `${s.runs}/${s.wickets}`, x + pad, y + pillH * 0.74, { size: pillH * 0.4, color: COLOR.ink, weight: 800 });
  text(ctx, `(${s.oversStr}) CRR ${s.crr}`, x + pillW - pad, y + pillH * 0.74, { size: pillH * 0.2, color: COLOR.inkDim, align:'right' });

  if(s.striker){
    const boxW = Math.round(w * 0.26), boxH = Math.round(h * 0.075);
    const bx = w - boxW - Math.round(w * 0.03), by = h - boxH - Math.round(h * 0.04);
    ctx.save(); ctx.globalAlpha = 0.88; ctx.fillStyle = COLOR.bg2;
    rr(ctx, bx, by, boxW, boxH, 8); ctx.fill(); ctx.restore();
    text(ctx, `${s.striker.name}* ${s.striker.runs}(${s.striker.balls})`, bx + 10, by + boxH * 0.42, { size: boxH * 0.32, color: COLOR.ink, weight: 700 });
    if(s.bowler) text(ctx, `${s.bowler.name} ${s.bowler.wickets}/${s.bowler.runs}`, bx + 10, by + boxH * 0.82, { size: boxH * 0.26, color: COLOR.acc2, weight: 600 });
  }

  if(activeEvent) drawModernEvent(ctx, w, h, activeEvent);
}
function drawModernEvent(ctx, w, h, evt){
  const { title, sub, color } = eventText(evt);
  const p = animPhase(evt.progress);
  const slideIn = p.alpha < 1 && evt.progress < 0.12 ? (1 - p.alpha) * w * 0.25 : 0;
  ctx.save();
  ctx.globalAlpha = p.alpha;
  ctx.translate(slideIn, 0);
  const bw = w * 0.5, bh = h * 0.16, bx = w / 2 - bw / 2, by = h * 0.12;
  ctx.fillStyle = COLOR.bg0; ctx.globalAlpha = p.alpha * 0.85;
  rr(ctx, bx, by, bw, bh, 14); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  rr(ctx, bx, by, bw, bh, 14); ctx.stroke();
  ctx.globalAlpha = p.alpha;
  text(ctx, title, w / 2, by + bh * 0.55, { size: bh * 0.4, color, weight: 800, align:'center' });
  if(sub) text(ctx, sub, w / 2, by + bh * 0.85, { size: bh * 0.2, color: COLOR.ink, align:'center' });
  ctx.restore();
}

/* ---------------------------------------------------------------------------
   Template 3 — Broadcast Pro: full lower-third split into striker / bowler
   panels, TV-style. Event animation gets a pulsing ring burst.
   --------------------------------------------------------------------------- */
function drawBroadcastPro(ctx, w, h, s, activeEvent){
  const barH = Math.round(h * 0.16);
  const y = h - barH;
  ctx.save();
  const grad = ctx.createLinearGradient(0, y, 0, h);
  grad.addColorStop(0, 'rgba(13,27,42,0)');
  grad.addColorStop(0.25, COLOR.bg0);
  ctx.globalAlpha = 0.95; ctx.fillStyle = grad;
  ctx.fillRect(0, y, w, barH);
  ctx.restore();

  const scoreW = w * 0.38;
  text(ctx, s.battingName.toUpperCase(), 24, y + barH * 0.32, { size: barH * 0.16, color: COLOR.gold, weight: 700 });
  text(ctx, `${s.runs}-${s.wickets}`, 24, y + barH * 0.68, { size: barH * 0.44, color: COLOR.ink, weight: 900 });
  text(ctx, `${s.oversStr} ov · CRR ${s.crr}`, 24, y + barH * 0.9, { size: barH * 0.14, color: COLOR.inkDim });

  // striker / non-striker panel
  const p1x = scoreW + 20;
  if(s.striker){
    text(ctx, '● ' + s.striker.name, p1x, y + barH * 0.34, { size: barH * 0.16, color: COLOR.ink, weight: 700 });
    text(ctx, `${s.striker.runs} (${s.striker.balls})`, p1x, y + barH * 0.58, { size: barH * 0.2, color: COLOR.gold, weight: 800 });
  }
  if(s.nonStriker){
    text(ctx, s.nonStriker.name, p1x, y + barH * 0.82, { size: barH * 0.14, color: COLOR.inkDim });
    text(ctx, `${s.nonStriker.runs} (${s.nonStriker.balls})`, p1x + 160, y + barH * 0.82, { size: barH * 0.14, color: COLOR.inkDim });
  }
  // bowler panel, right-aligned
  if(s.bowler){
    text(ctx, 'BOWLER', w - 24, y + barH * 0.32, { size: barH * 0.14, color: COLOR.info, weight: 700, align:'right' });
    text(ctx, s.bowler.name, w - 24, y + barH * 0.58, { size: barH * 0.2, color: COLOR.ink, weight: 700, align:'right' });
    text(ctx, `${s.bowler.wickets}/${s.bowler.runs} (${s.bowler.oversStr}) econ ${s.bowler.econ}`, w - 24, y + barH * 0.82, { size: barH * 0.14, color: COLOR.inkDim, align:'right' });
  }

  if(activeEvent) drawBroadcastProEvent(ctx, w, h, activeEvent);
}
function drawBroadcastProEvent(ctx, w, h, evt){
  const { title, sub, color } = eventText(evt);
  const p = animPhase(evt.progress);
  ctx.save();
  ctx.globalAlpha = p.alpha;
  const cx = w / 2, cy = h * 0.32;
  // pulsing concentric rings, radius grows with progress
  for(let i = 0; i < 3; i++){
    const rad = (h * 0.05) + (evt.progress * h * 0.22) + i * h * 0.03;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = p.alpha * Math.max(0, 0.35 - i * 0.1);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.globalAlpha = p.alpha;
  text(ctx, title, cx, cy + h * 0.02, { size: h * 0.08, color, weight: 900, align:'center' });
  if(sub) text(ctx, sub, cx, cy + h * 0.065, { size: h * 0.028, color: COLOR.ink, align:'center' });
  ctx.restore();
}

/* ---------------------------------------------------------------------------
   Template 4 — Minimal: tiny top-right chip, camera footage stays the
   focus. Event is a brief small toast, not a full-screen takeover.
   --------------------------------------------------------------------------- */
function drawMinimal(ctx, w, h, s, activeEvent){
  const chW = w * 0.22, chH = h * 0.07;
  const x = w - chW - w * 0.02, y = h * 0.02;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = COLOR.bg0;
  rr(ctx, x, y, chW, chH, chH / 2);
  ctx.fill();
  ctx.restore();
  text(ctx, `${s.runs}/${s.wickets}`, x + 12, y + chH * 0.68, { size: chH * 0.42, color: COLOR.ink, weight: 800 });
  text(ctx, `(${s.oversStr})`, x + chW - 12, y + chH * 0.68, { size: chH * 0.32, color: COLOR.inkDim, align:'right' });

  if(activeEvent) drawMinimalEvent(ctx, w, h, activeEvent, x, y, chH);
}
function drawMinimalEvent(ctx, w, h, evt, chipX, chipY, chH){
  const { title, color } = eventText(evt);
  const p = animPhase(evt.progress);
  ctx.save();
  ctx.globalAlpha = p.alpha;
  const by = chipY + chH + 8;
  const bw = w * 0.22;
  ctx.fillStyle = COLOR.bg0; ctx.globalAlpha = p.alpha * 0.85;
  rr(ctx, chipX, by, bw, chH * 0.8, chH * 0.4); ctx.fill();
  ctx.globalAlpha = p.alpha;
  text(ctx, title, chipX + bw / 2, by + chH * 0.52, { size: chH * 0.3, color, weight: 800, align:'center' });
  ctx.restore();
}

/* ---------------------------------------------------------------------------
   Template 5 — Tournament Premium: top bar with tournament name + team
   crests, fuller lower-third with score + match info.
   --------------------------------------------------------------------------- */
function drawTournamentPremium(ctx, w, h, s, activeEvent){
  // top tournament bar
  const topH = h * 0.09;
  ctx.save();
  ctx.globalAlpha = 0.9; ctx.fillStyle = COLOR.bg0;
  ctx.fillRect(0, 0, w, topH);
  ctx.restore();
  if(s.tournamentName){
    text(ctx, s.tournamentName.toUpperCase(), w / 2, topH * 0.65, { size: topH * 0.32, color: COLOR.gold, weight: 800, align:'center' });
  }
  const crestSize = topH * 0.72;
  if(s.teamALogoImg) ctx.drawImage(s.teamALogoImg, w * 0.03, topH * 0.14, crestSize, crestSize);
  if(s.teamBLogoImg) ctx.drawImage(s.teamBLogoImg, w * 0.97 - crestSize, topH * 0.14, crestSize, crestSize);

  // lower-third
  const barH = h * 0.14, y = h - barH;
  ctx.save();
  ctx.globalAlpha = 0.92; ctx.fillStyle = COLOR.bg0;
  ctx.fillRect(0, y, w, barH);
  ctx.fillStyle = COLOR.acc;
  ctx.fillRect(0, y, w, 3);
  ctx.restore();

  text(ctx, `${s.battingName} ${s.runs}/${s.wickets}`, 24, y + barH * 0.42, { size: barH * 0.3, color: COLOR.ink, weight: 800 });
  text(ctx, `${s.teamA} v ${s.teamB} · (${s.oversStr}/${s.oversLimit} ov) · CRR ${s.crr}`, 24, y + barH * 0.78, { size: barH * 0.16, color: COLOR.inkDim });
  if(s.venue) text(ctx, s.venue, w - 24, y + barH * 0.42, { size: barH * 0.16, color: COLOR.inkDim, align:'right' });
  if(s.striker) text(ctx, `${s.striker.name} ${s.striker.runs}(${s.striker.balls})`, w - 24, y + barH * 0.78, { size: barH * 0.22, color: COLOR.gold, weight: 700, align:'right' });

  if(activeEvent) drawTournamentPremiumEvent(ctx, w, h, activeEvent, s);
}
function drawTournamentPremiumEvent(ctx, w, h, evt, s){
  const { title, sub, color } = eventText(evt);
  const p = animPhase(evt.progress);
  ctx.save();
  ctx.globalAlpha = p.alpha;
  const cy = h * 0.3 + p.ty;
  const bw = w * 0.56, bh = h * 0.15, bx = w / 2 - bw / 2;
  ctx.fillStyle = COLOR.bg0; ctx.globalAlpha = p.alpha * 0.88;
  rr(ctx, bx, cy, bw, bh, 10); ctx.fill();
  ctx.strokeStyle = COLOR.gold; ctx.lineWidth = 2;
  rr(ctx, bx, cy, bw, bh, 10); ctx.stroke();
  ctx.globalAlpha = p.alpha;
  text(ctx, title, w / 2, cy + bh * 0.5, { size: bh * 0.38, color, weight: 900, align:'center' });
  if(sub) text(ctx, sub, w / 2, cy + bh * 0.8, { size: bh * 0.18, color: COLOR.ink, align:'center' });
  ctx.restore();
}

const TEMPLATE_DRAW = {
  'classic': drawClassic,
  'modern': drawModern,
  'broadcast-pro': drawBroadcastPro,
  'minimal': drawMinimal,
  'tournament-premium': drawTournamentPremium
};

/* The one function recorder.js (and any live preview) needs to call, once
   per frame. `activeEvent`, if given, is
   { type, player, dismissal, resultText, progress } — progress is 0..1
   through eventDuration(type), computed by the caller from a startedAt
   timestamp. Switching templateId between calls is completely safe — nore
   per-template state is kept anywhere outside this call. */
export function drawOverlay(templateId, ctx, w, h, state, activeEvent){
  const fn = TEMPLATE_DRAW[templateId] || drawClassic;
  if(!state) return;
  fn(ctx, w, h, state, activeEvent || null);
}

export function templateThumbnailSVG(templateId, size = 160){
  // Small static preview swatch for the template picker — same colour
  // language as the real overlay so the picker isn't a lie about what
  // recording will actually look like.
  const t = TEMPLATES.find(x=>x.id === templateId) || TEMPLATES[0];
  const accents = {
    classic:'#F8C539', modern:'#25A244', 'broadcast-pro':'#ef4444',
    minimal:'#A7B0B8', 'tournament-premium':'#F8C539'
  };
  const accent = accents[t.id] || COLOR.gold;
  return `<svg viewBox="0 0 160 90" width="${size}" height="${size * 0.5625}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${t.name} preview">
    <rect width="160" height="90" rx="6" fill="${COLOR.bg2}"/>
    <rect x="0" y="66" width="160" height="24" fill="${COLOR.bg0}" opacity=".92"/>
    <rect x="0" y="66" width="160" height="2" fill="${accent}"/>
    <text x="10" y="80" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="11" font-weight="700" fill="#fff">142/4</text>
    <text x="150" y="80" text-anchor="end" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="8" fill="${accent}">(15.2)</text>
  </svg>`;
}
