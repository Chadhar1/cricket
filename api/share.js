/* ===========================================================================
   /api/share?m=<matchId>  ->  tiny server-rendered HTML shell

   This exists for the same reason as api/og.js: live.html is client-rendered,
   so a link straight to live.html?m=<id> has no <meta> tags a crawler can
   read at fetch time -- it just sees the static shell before JS runs.

   This endpoint is what shareUrl() now points people at instead. It fetches
   the match once (server-side, same as api/og.js), writes real og:title /
   og:description / og:image tags into the HTML it returns, and then sends a
   real visitor straight on to the interactive live.html page. WhatsApp/
   Facebook/etc.'s crawlers don't execute the redirect -- they just read the
   meta tags on this response, which is exactly what we want them to see.
   =========================================================================== */

export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://hkqiroednyfpkwmlrreg.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrcWlyb2VkbnlmcGt3bWxycmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NzQ0MDksImV4cCI6MjEwMTM1MDQwOX0.WsQ90f9RbOLbR-ibGurmAn4VIc-RdVa-qgGFKLKOgAQ';

async function fetchMatch(id) {
  if (!id) return null;
  try {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/live_matches?id=eq.' + encodeURIComponent(id) + '&select=data',
      { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows && rows[0] ? rows[0].data : null;
  } catch (e) {
    return null;
  }
}

function fmtOvers(legalBalls) {
  const n = legalBalls || 0;
  return Math.floor(n / 6) + '.' + (n % 6);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function handler(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get('m') || '';
  const dest = url.origin + '/live.html?m=' + encodeURIComponent(id);
  const imageUrl = url.origin + '/api/og?m=' + encodeURIComponent(id);

  const m = await fetchMatch(id);

  let title = 'Watch live on Cricket Connect';
  let description = 'Follow this match ball by ball, as it happens.';

  if (m && m.innings && m.innings.length) {
    const inn = m.innings[m.completed ? m.innings.length - 1 : m.currentInningsIdx];
    const battingName = inn.battingTeam === 'A' ? m.teamA : m.teamB;
    const bowlingName = inn.battingTeam === 'A' ? m.teamB : m.teamA;
    const overs = fmtOvers(inn.legalBalls);
    title = m.teamA + ' vs ' + m.teamB + ' — ' + (m.completed ? 'Final' : 'LIVE') + ' on Cricket Connect';
    description = m.completed
      ? m.resultText || battingName + ' ' + inn.runs + '/' + inn.wickets + ' (' + overs + ' ov)'
      : battingName + ' ' + inn.runs + '/' + inn.wickets + ' (' + overs + ' ov) vs ' + bowlingName + ' — live now';
  }

  const html =
    '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<title>' + esc(title) + '</title>\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n' +
    '<meta property="og:description" content="' + esc(description) + '">\n' +
    '<meta property="og:image" content="' + esc(imageUrl) + '">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:url" content="' + esc(dest) + '">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + esc(title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(description) + '">\n' +
    '<meta name="twitter:image" content="' + esc(imageUrl) + '">\n' +
    '<meta http-equiv="refresh" content="0;url=' + esc(dest) + '">\n' +
    '<script>location.replace(' + JSON.stringify(dest) + ');</script>\n' +
    '</head>\n' +
    '<body>\n' +
    '<p>Redirecting to the live match&hellip; <a href="' + esc(dest) + '">Tap here if you\'re not redirected.</a></p>\n' +
    '</body>\n' +
    '</html>\n';

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=30' },
  });
}
