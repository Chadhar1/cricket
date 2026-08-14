/* ===========================================================================
   tournament.js — pure tournament logic: fixtures, points table, net run
   rate, and the knockout bracket. No DOM, no Firebase, fully testable.
   =========================================================================== */

import { makeId } from './engine.js';

export const POINTS = { win:2, tie:1, noResult:1, loss:0 };

/* ---------------------------------------------------------------------------
   TASK 5 ARCHITECTURE NOTE — tournament storage.

   A tournament is one row in Supabase: scalar fields the app needs to
   query/list/RLS (name, location, ground, start_date, end_date, status,
   is_public, ...) live as real columns; teams/fixtures/knockout stay
   nested inside the row's `data` column exactly as this file already
   models them below. Nothing in this file changed for Task 5 — the engine
   was already correct and UI-agnostic.

   Deliberately NOT introduced yet: separate `tournament_teams` and
   `fixtures` tables. Those become worth the two-source-of-truth cost only
   once something needs row-level access to a single team or fixture
   independent of loading the whole tournament — concretely: self-service
   team registration with captain/manager permissions (tournament_teams,
   with a `status: pending|approved|rejected` column and RLS keyed off
   captain_uid/manager_uid), or browsing fixtures across tournaments
   (fixtures as its own table). Until one of those is actually being
   built, that split would just be an unused, unsynced duplicate of what's
   already in `data.fixtures`/`data.teams`.

   Live scoring hook: `fixture.matchId` (already below) is where a real
   scored match attaches to a fixture once live scoring exists — no schema
   change needed for that either.
   =========================================================================== */

export const STATUSES = ['upcoming','live','paused','completed','cancelled'];

/* Default status when an organizer hasn't manually set one — derived from
   real dates/completion, never guessed. Manual overrides (e.g. an
   organizer marking a tournament "Cancelled", or an emergency "Paused")
   always win; this is only the fallback. Checked in this order on purpose:
   cancelled and paused are both organizer/admin decisions that should stick
   regardless of what the fixtures/dates would otherwise imply, and
   cancelled outranks paused since there's no coming back from cancelled. */
export function deriveStatus(tournament, storedStatus){
  if(storedStatus === 'cancelled') return 'cancelled';
  if(storedStatus === 'paused') return 'paused';
  if(tournamentChampion(tournament)) return 'completed';
  const started = allFixtures(tournament).some(f=>f.status === 'completed');
  if(started) return 'live';
  const start = tournament.startDate ? new Date(tournament.startDate) : null;
  if(start && start.getTime() <= Date.now()) return 'live';
  return 'upcoming';
}

/* ---------------------------------------------------------------------------
   Data shapes
   ---------------------------------------------------------------------------
   tournament = {
     id, name, format:'league'|'league-knockout'|'knockout',
     oversLimit, allOutWickets,
     teams:   [{ id, name }],
     fixtures:[ fixture ],
     knockout:[ fixture ],          // generated after the league finishes
     createdAt, updatedAt
   }

   fixture = {
     id, stage:'league'|'semi-final'|'final'|'quarter-final',
     round, teamAId, teamBId,
     date:ISO|null, venue:'',
     matchId:null,                  // set when a real scored match is linked
     status:'scheduled'|'completed'|'no-result',
     result: null | {
       a:{ runs, wickets, balls, allOut },
       b:{ runs, wickets, balls, allOut },
       winnerId: teamId|'tie',
       text
     }
   }
   --------------------------------------------------------------------------- */

export function createTournament({
  name, format = 'league-knockout', oversLimit = 20, allOutWickets = 10, teams = [],
  location = '', ground = '', startDate = null, endDate = null, description = '',
  bannerUrl = null, entryRules = '', rules = '', status = 'upcoming'
}){
  return {
    id: makeId(),
    name: name || 'Tournament',
    format,
    oversLimit,
    allOutWickets,
    teams: teams.map(t=>({ id: t.id || makeId(), name: t.name })),
    fixtures: [],
    knockout: [],
    location, ground, startDate, endDate, description, bannerUrl, entryRules, rules, status,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function newFixture(teamAId, teamBId, opts = {}){
  return {
    id: makeId(),
    stage: opts.stage || 'league',
    round: opts.round || 1,
    teamAId, teamBId,
    date: opts.date || null,
    venue: opts.venue || '',
    matchId: null,
    status: 'scheduled',
    result: null
  };
}

/* ---------------------------------------------------------------------------
   Round-robin fixture generation (circle method).
   With an odd number of teams a bye is rotated fairly.
   legs = 2 gives a home-and-away double round robin.
   --------------------------------------------------------------------------- */
export function generateRoundRobin(tournament, { legs = 1 } = {}){
  const ids = tournament.teams.map(t=>t.id);
  if(ids.length < 2) return [];

  const list = ids.slice();
  const bye = '__bye__';
  if(list.length % 2 === 1) list.push(bye);

  const n = list.length;
  const rounds = n - 1;
  const half = n / 2;
  const fixtures = [];
  let arr = list.slice();

  for(let leg = 0; leg < legs; leg++){
    for(let r = 0; r < rounds; r++){
      for(let i = 0; i < half; i++){
        const home = arr[i];
        const away = arr[n - 1 - i];
        if(home === bye || away === bye) continue;
        // alternate who bats first on the second leg
        const [a, b] = leg % 2 === 0 ? [home, away] : [away, home];
        fixtures.push(newFixture(a, b, { stage:'league', round: leg * rounds + r + 1 }));
      }
      // rotate everything except the first entry
      arr = [arr[0], arr[n-1], ...arr.slice(1, n-1)];
    }
  }
  return fixtures;
}

/* ---------------------------------------------------------------------------
   Turn a completed match (from engine.js) into a fixture result.
   teamAId / teamBId map the match's two sides onto tournament team ids.
   --------------------------------------------------------------------------- */
export function resultFromMatch(match, teamAId, teamBId){
  const i1 = match.innings[0];
  const i2 = match.innings[1];
  if(!i1 || !i2) return null;

  // innings[0].battingTeam is always 'A' (match.teamA); innings[1] is the other side
  const side = (inn)=>({
    runs: inn.runs,
    wickets: inn.wickets,
    balls: inn.legalBalls,
    allOut: inn.wickets >= (inn.allOutWickets ?? match.allOutWickets)
  });

  const a = side(i1);
  const b = side(i2);

  let winnerId;
  if(a.runs > b.runs) winnerId = teamAId;
  else if(b.runs > a.runs) winnerId = teamBId;
  else winnerId = 'tie';

  return { a, b, winnerId, text: match.resultText || '' };
}

export function applyResult(tournament, fixtureId, result, matchId = null){
  const all = [...tournament.fixtures, ...tournament.knockout];
  const f = all.find(x=>x.id === fixtureId);
  if(!f) return null;
  f.result = result;
  f.matchId = matchId;
  f.status = result ? 'completed' : 'scheduled';
  tournament.updatedAt = Date.now();
  return f;
}

/* ---------------------------------------------------------------------------
   Net run rate.
   Standard ICC treatment: a side bowled out is charged the FULL quota of
   overs, not the overs it actually used. That is the rule most people get
   wrong when doing this by hand.
   --------------------------------------------------------------------------- */
export function oversForNRR(side, oversLimit){
  if(side.allOut) return oversLimit;
  return side.balls / 6;
}

export function computeStandings(tournament){
  const rows = new Map();
  tournament.teams.forEach(t=>{
    rows.set(t.id, {
      teamId: t.id, name: t.name,
      played:0, won:0, lost:0, tied:0, noResult:0, points:0,
      runsFor:0, oversFor:0, runsAgainst:0, oversAgainst:0, nrr:0
    });
  });

  tournament.fixtures.forEach(f=>{
    if(f.status !== 'completed' || !f.result) return;
    const A = rows.get(f.teamAId);
    const B = rows.get(f.teamBId);
    if(!A || !B) return;

    const { a, b, winnerId } = f.result;
    const limit = tournament.oversLimit;
    const aOv = oversForNRR(a, limit);
    const bOv = oversForNRR(b, limit);

    A.played++; B.played++;
    A.runsFor += a.runs;      A.oversFor += aOv;
    A.runsAgainst += b.runs;  A.oversAgainst += bOv;
    B.runsFor += b.runs;      B.oversFor += bOv;
    B.runsAgainst += a.runs;  B.oversAgainst += aOv;

    if(winnerId === 'tie'){
      A.tied++; B.tied++;
      A.points += POINTS.tie; B.points += POINTS.tie;
    } else if(winnerId === A.teamId){
      A.won++; B.lost++;
      A.points += POINTS.win; B.points += POINTS.loss;
    } else {
      B.won++; A.lost++;
      B.points += POINTS.win; A.points += POINTS.loss;
    }
  });

  const table = Array.from(rows.values()).map(r=>{
    const scored  = r.oversFor > 0 ? r.runsFor / r.oversFor : 0;
    const conceded = r.oversAgainst > 0 ? r.runsAgainst / r.oversAgainst : 0;
    r.nrr = r.played ? +(scored - conceded).toFixed(3) : 0;
    return r;
  });

  table.sort((x,y)=>
    y.points - x.points ||
    y.nrr - x.nrr ||
    y.won - x.won ||
    x.name.localeCompare(y.name)
  );
  return table;
}

export function leagueComplete(tournament){
  return tournament.fixtures.length > 0 &&
         tournament.fixtures.every(f=>f.status === 'completed' || f.status === 'no-result');
}

/* ---------------------------------------------------------------------------
   Knockout stage. Seeds come from the finished league table.
   4+ teams  -> semi-finals (1v4, 2v3) then final
   2-3 teams -> straight final between the top two
   --------------------------------------------------------------------------- */
export function generateKnockout(tournament){
  const table = computeStandings(tournament);
  if(table.length < 2) return [];

  if(table.length >= 4){
    const [s1, s2, s3, s4] = table;
    const sf1 = newFixture(s1.teamId, s4.teamId, { stage:'semi-final', round:1 });
    const sf2 = newFixture(s2.teamId, s3.teamId, { stage:'semi-final', round:1 });
    const final = newFixture(null, null, { stage:'final', round:2 });
    final.dependsOn = [sf1.id, sf2.id];
    return [sf1, sf2, final];
  }

  const final = newFixture(table[0].teamId, table[1].teamId, { stage:'final', round:1 });
  return [final];
}

/* Once semi-finals are decided, drop the winners into the final. */
export function advanceKnockout(tournament){
  const ko = tournament.knockout || [];
  const final = ko.find(f=>f.stage === 'final');
  if(!final || !final.dependsOn) return ko;

  const winners = final.dependsOn.map(id=>{
    const sf = ko.find(f=>f.id === id);
    if(!sf || sf.status !== 'completed' || !sf.result) return null;
    const w = sf.result.winnerId;
    return w === 'tie' ? sf.teamAId : w;   // a tied knockout defaults to the higher seed
  });

  // Fill each side independently so a qualified finalist shows up straight
  // away as "Team A v TBD" instead of waiting for the other semi.
  if(winners[0]) final.teamAId = winners[0];
  if(winners[1]) final.teamBId = winners[1];
  return ko;
}

export function tournamentChampion(tournament){
  const final = (tournament.knockout || []).find(f=>f.stage === 'final');
  if(final && final.status === 'completed' && final.result){
    const w = final.result.winnerId;
    return w === 'tie' ? null : teamById(tournament, w);
  }
  if(tournament.format === 'league' && leagueComplete(tournament)){
    const table = computeStandings(tournament);
    return table.length ? teamById(tournament, table[0].teamId) : null;
  }
  return null;
}

/* ---------------- helpers ---------------- */

export function teamById(tournament, id){
  return tournament.teams.find(t=>t.id === id) || null;
}

export function teamNameById(tournament, id){
  const t = teamById(tournament, id);
  return t ? t.name : 'TBD';
}

export function fixtureLabel(tournament, f){
  return teamNameById(tournament, f.teamAId) + ' v ' + teamNameById(tournament, f.teamBId);
}

export function allFixtures(tournament){
  return [...(tournament.fixtures || []), ...(tournament.knockout || [])];
}

export function upcomingFixtures(tournament, limit = 5){
  return allFixtures(tournament)
    .filter(f=>f.status === 'scheduled')
    .sort((a,b)=>{
      if(a.date && b.date) return new Date(a.date) - new Date(b.date);
      if(a.date) return -1;
      if(b.date) return 1;
      return a.round - b.round;
    })
    .slice(0, limit);
}

export function formatNRR(n){
  const v = Number(n) || 0;
  return (v > 0 ? '+' : '') + v.toFixed(3);
}
