/* ===========================================================================
   /api/og?m=<matchId>  ->  1200x630 PNG scorecard image

   Why this exists: WhatsApp/Facebook/Twitter link previews are built by a
   crawler that fetches the URL and reads <meta property="og:image">. That
   crawler never runs our JavaScript, so live.html (a client-rendered page
   that fetches the score from Supabase after load) can never produce a real
   preview image on its own -- the crawler only ever sees an empty shell.

   This Edge function is the fix: it does the same Supabase read live.html
   does, but server-side, and renders the current score into an actual image
   that a crawler (or a human) can just download. legacy-app/api/share.js is
   the page that points its og:image meta tag at this endpoint.

   Same Supabase URL/anon key already shipped in supabase-config.js -- these
   are meant to be public (RLS decides what the anon key can read, not
   secrecy of the key itself), so duplicating them here is not a new
   exposure. live_matches has an "anyone can read" RLS policy already.
   =========================================================================== */

export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://hkqiroednyfpkwmlrreg.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrcWlyb2VkbnlmcGt3bWxycmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NzQ0MDksImV4cCI6MjEwMTM1MDQwOX0.WsQ90f9RbOLbR-ibGurmAn4VIc-RdVa-qgGFKLKOgAQ';

const LOGO_URL = 'https://cricket-chadhar.vercel.app/icon-192.png';

// Palette lifted straight from styles.css's new brand tokens (--cc-*) so the
// share image matches the site instead of drifting into its own colours.
const NAVY_DEEP = '#020C1B';
const NAVY = '#041221';
const SURFACE = '#122C52';
const BLUE = '#3D7BFF';
const CYAN = '#59C3F8';
const LIME = '#A4F851';
const GOLD = '#EFB23E';
const TEXT = '#F5F5F0';
const TEXT_DIM = '#A9B8C8';

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

function el(type, props, children) {
  return { type: type, props: Object.assign({}, props, { children: children }) };
}

function genericImage() {
  return el(
    'div',
    {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(160deg, ' + NAVY_DEEP + ' 0%, ' + NAVY + ' 100%)',
        fontFamily: 'sans-serif',
      },
    },
    [
      el('img', { src: LOGO_URL, width: 110, height: 110, style: { borderRadius: 24, marginBottom: 30 } }),
      el('div', { style: { fontSize: 58, fontWeight: 800, color: TEXT } }, 'Cricket Connect'),
      el(
        'div',
        { style: { fontSize: 28, color: TEXT_DIM, marginTop: 16 } },
        'Live ball-by-ball cricket scoring'
      ),
    ]
  );
}

function teamScoreBox(name, inn, highlight) {
  return el(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: highlight ? 'rgba(61,123,255,.16)' : 'rgba(89,195,248,.06)',
        border: '2px solid ' + (highlight ? BLUE : 'rgba(89,195,248,.24)'),
        borderRadius: 20,
        padding: '26px 44px',
        minWidth: 320,
      },
    },
    [
      el(
        'div',
        { style: { fontSize: 26, fontWeight: 700, color: TEXT_DIM, textTransform: 'uppercase', letterSpacing: 1 } },
        name
      ),
      el(
        'div',
        { style: { fontSize: 64, fontWeight: 800, color: TEXT, marginTop: 10 } },
        inn ? inn.runs + '/' + inn.wickets : '-'
      ),
      el(
        'div',
        { style: { fontSize: 24, color: TEXT_DIM, marginTop: 6 } },
        inn ? fmtOvers(inn.legalBalls) + ' overs' : ''
      ),
    ]
  );
}

function matchImage(m) {
  const teamAInn = m.innings.find((i) => i.battingTeam === 'A');
  const teamBInn = m.innings.find((i) => i.battingTeam === 'B');
  const currentInn = m.innings[m.completed ? m.innings.length - 1 : m.currentInningsIdx];
  const currentIsA = currentInn && currentInn.battingTeam === 'A';

  const badgeText = m.completed ? 'FINAL' : 'LIVE';
  const badgeColor = m.completed ? GOLD : LIME;
  const headline = m.completed
    ? m.resultText || m.teamA + ' vs ' + m.teamB
    : m.teamA + ' vs ' + m.teamB;

  return el(
    'div',
    {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '54px 60px',
        background:
          'radial-gradient(1000px 520px at 82% -10%, rgba(61,123,255,.22), transparent 62%), ' +
          'radial-gradient(900px 600px at 20% 118%, rgba(164,248,81,.10), transparent 62%), ' +
          'linear-gradient(160deg, ' + NAVY_DEEP + ' 0%, ' + NAVY + ' 100%)',
        fontFamily: 'sans-serif',
      },
    },
    [
      // header row: logo + wordmark left, LIVE/FINAL badge right
      el(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' } },
        [
          el('div', { style: { display: 'flex', alignItems: 'center' } }, [
            el('img', { src: LOGO_URL, width: 56, height: 56, style: { borderRadius: 13, marginRight: 16 } }),
            el('div', { style: { fontSize: 32, fontWeight: 800, color: TEXT } }, 'Cricket Connect'),
          ]),
          el(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                background: m.completed ? 'rgba(239,178,62,.16)' : 'rgba(164,248,81,.16)',
                border: '2px solid ' + badgeColor,
                borderRadius: 999,
                padding: '10px 26px',
                fontSize: 26,
                fontWeight: 800,
                color: badgeColor,
                letterSpacing: 2,
              },
            },
            badgeText
          ),
        ]
      ),

      // center: headline + two score boxes
      el(
        'div',
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
        [
          el(
            'div',
            {
              style: {
                fontSize: m.completed ? 34 : 44,
                fontWeight: 800,
                color: TEXT,
                marginBottom: 34,
                textAlign: 'center',
                maxWidth: 1000,
              },
            },
            headline
          ),
          el('div', { style: { display: 'flex', gap: 40 } }, [
            teamScoreBox(m.teamA, teamAInn, currentIsA && !m.completed),
            teamScoreBox(m.teamB, teamBInn, !currentIsA && !m.completed),
          ]),
        ]
      ),

      // footer
      el(
        'div',
        { style: { fontSize: 24, color: TEXT_DIM, letterSpacing: 1 } },
        'Gully to Gallery.'
      ),
    ]
  );
}

export default async function handler(req) {
  const { ImageResponse } = await import('@vercel/og');
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('m');
  const m = await fetchMatch(id);

  const tree = m ? matchImage(m) : genericImage();

  return new ImageResponse(tree, {
    width: 1200,
    height: 630,
    headers: { 'cache-control': 'public, max-age=30, s-maxage=30' },
  });
}
