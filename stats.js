/* ===========================================================================
   stats.js — career records aggregated from saved matches.
   Pure: no DOM, no Firebase. Feed it an array of completed match objects.

   Players are identified by name, which is how club cricket actually works —
   there is no player ID to join on. Names are matched case-insensitively and
   trimmed so "haris" and "Haris " count as the same player.
   =========================================================================== */

const key = (n)=>String(n || '').trim().toLowerCase();

function blank(name){
  return {
    name,
    // batting
    innings:0, notOuts:0, runs:0, balls:0, fours:0, sixes:0,
    highScore:0, highScoreNotOut:false, fifties:0, hundreds:0, ducks:0,
    // bowling
    bowlInnings:0, ballsBowled:0, runsConceded:0, wickets:0, maidens:0,
    bestWickets:0, bestRuns:0, threeFers:0, fiveFers:0,
    // general
    matches:0, _matchIds:new Set()
  };
}

/* ---------------------------------------------------------------------------
   Build the full career table from a list of matches.
   Only completed matches count, so an abandoned game does not pollute averages.
   --------------------------------------------------------------------------- */
export function buildCareers(matches){
  const table = new Map();
  const get = (name)=>{
    const k = key(name);
    if(!k) return null;
    if(!table.has(k)) table.set(k, blank(String(name).trim()));
    return table.get(k);
  };

  (matches || []).filter(m=>m && m.completed && Array.isArray(m.innings)).forEach(m=>{
    m.innings.forEach(inn=>{
      (inn.batters || []).forEach(b=>{
        const p = get(b.name);
        if(!p) return;
        p._matchIds.add(m.id);
        if(b.balls > 0 || b.out){
          p.innings++;
          p.runs += b.runs;
          p.balls += b.balls;
          p.fours += b.fours || 0;
          p.sixes += b.sixes || 0;
          if(!b.out) p.notOuts++;
          if(b.runs === 0 && b.out) p.ducks++;
          if(b.runs >= 100) p.hundreds++;
          else if(b.runs >= 50) p.fifties++;
          if(b.runs > p.highScore || (b.runs === p.highScore && !b.out && !p.highScoreNotOut)){
            p.highScore = b.runs;
            p.highScoreNotOut = !b.out;
          }
        }
      });

      (inn.bowlers || []).forEach(b=>{
        const p = get(b.name);
        if(!p) return;
        p._matchIds.add(m.id);
        if(b.legalBalls > 0){
          p.bowlInnings++;
          p.ballsBowled += b.legalBalls;
          p.runsConceded += b.runs;
          p.wickets += b.wickets;
          p.maidens += b.maidens || 0;
          if(b.wickets >= 5) p.fiveFers++;
          else if(b.wickets >= 3) p.threeFers++;
          // best figures: most wickets, then fewest runs
          if(b.wickets > p.bestWickets ||
             (b.wickets === p.bestWickets && b.wickets > 0 && b.runs < p.bestRuns)){
            p.bestWickets = b.wickets;
            p.bestRuns = b.runs;
          }
        }
      });
    });
  });

  return Array.from(table.values()).map(p=>{
    p.matches = p._matchIds.size;
    delete p._matchIds;
    return withDerived(p);
  });
}

/* Averages, strike rates and economy — the numbers people actually quote. */
function withDerived(p){
  const dismissals = p.innings - p.notOuts;
  p.average    = dismissals > 0 ? +(p.runs / dismissals).toFixed(2) : null; // null = "not out enough to have an average"
  p.strikeRate = p.balls > 0 ? +((p.runs / p.balls) * 100).toFixed(2) : 0;
  p.overs      = p.ballsBowled / 6;
  p.economy    = p.ballsBowled > 0 ? +(p.runsConceded / (p.ballsBowled / 6)).toFixed(2) : 0;
  p.bowlAvg    = p.wickets > 0 ? +(p.runsConceded / p.wickets).toFixed(2) : null;
  p.bowlSR     = p.wickets > 0 ? +(p.ballsBowled / p.wickets).toFixed(1) : null;
  p.best       = p.bestWickets > 0 ? p.bestWickets + '/' + p.bestRuns : '–';
  p.hsText     = p.innings > 0 ? p.highScore + (p.highScoreNotOut ? '*' : '') : '–';
  return p;
}

/* ---------------------------------------------------------------------------
   Leaderboards
   --------------------------------------------------------------------------- */

export function topRunScorers(careers, limit = 10){
  return careers.filter(p=>p.runs > 0)
    .sort((a,b)=>b.runs - a.runs || (b.average || 0) - (a.average || 0))
    .slice(0, limit);
}

export function topWicketTakers(careers, limit = 10){
  return careers.filter(p=>p.wickets > 0)
    .sort((a,b)=>b.wickets - a.wickets || a.economy - b.economy)
    .slice(0, limit);
}

/* Batting average needs a qualification threshold or one 30* tops the table. */
export function bestAverages(careers, minInnings = 3, limit = 10){
  return careers.filter(p=>p.innings >= minInnings && p.average !== null)
    .sort((a,b)=>b.average - a.average)
    .slice(0, limit);
}

export function bestEconomy(careers, minOvers = 5, limit = 10){
  return careers.filter(p=>p.overs >= minOvers)
    .sort((a,b)=>a.economy - b.economy)
    .slice(0, limit);
}

export function findPlayer(careers, name){
  const k = key(name);
  return careers.find(p=>key(p.name) === k) || null;
}

/* ---------------------------------------------------------------------------
   Single innings highlights across all matches — "best performances".
   --------------------------------------------------------------------------- */
export function bestBattingPerformances(matches, limit = 5){
  const out = [];
  (matches || []).filter(m=>m && m.completed).forEach(m=>{
    (m.innings || []).forEach(inn=>{
      (inn.batters || []).forEach(b=>{
        if(b.balls > 0) out.push({
          name:b.name, runs:b.runs, balls:b.balls, notOut:!b.out,
          matchId:m.id, vs: oppositionFor(m, inn), date:m.createdAt
        });
      });
    });
  });
  return out.sort((a,b)=>b.runs - a.runs || a.balls - b.balls).slice(0, limit);
}

export function bestBowlingPerformances(matches, limit = 5){
  const out = [];
  (matches || []).filter(m=>m && m.completed).forEach(m=>{
    (m.innings || []).forEach(inn=>{
      (inn.bowlers || []).forEach(b=>{
        if(b.legalBalls > 0 && b.wickets > 0) out.push({
          name:b.name, wickets:b.wickets, runs:b.runs, balls:b.legalBalls,
          matchId:m.id, vs: battingSideFor(m, inn), date:m.createdAt
        });
      });
    });
  });
  return out.sort((a,b)=>b.wickets - a.wickets || a.runs - b.runs).slice(0, limit);
}

function battingSideFor(m, inn){ return inn.battingTeam === 'A' ? m.teamA : m.teamB; }
function oppositionFor(m, inn){ return inn.battingTeam === 'A' ? m.teamB : m.teamA; }

/* ---------------------------------------------------------------------------
   Team records
   --------------------------------------------------------------------------- */
export function teamRecords(matches){
  const t = new Map();
  const get = (name)=>{
    const k = key(name);
    if(!k) return null;
    if(!t.has(k)) t.set(k, { name:String(name).trim(), played:0, won:0, lost:0, tied:0,
                             highest:0, lowest:null });
    return t.get(k);
  };

  (matches || []).filter(m=>m && m.completed && m.innings && m.innings.length === 2).forEach(m=>{
    const A = get(m.teamA), B = get(m.teamB);
    if(!A || !B) return;
    const i1 = m.innings[0], i2 = m.innings[1];
    A.played++; B.played++;

    [[A, i1], [B, i2]].forEach(([side, inn])=>{
      if(inn.runs > side.highest) side.highest = inn.runs;
      if(side.lowest === null || inn.runs < side.lowest) side.lowest = inn.runs;
    });

    if(i1.runs > i2.runs){ A.won++; B.lost++; }
    else if(i2.runs > i1.runs){ B.won++; A.lost++; }
    else { A.tied++; B.tied++; }
  });

  return Array.from(t.values()).map(x=>{
    x.winPct = x.played ? +((x.won / x.played) * 100).toFixed(1) : 0;
    if(x.lowest === null) x.lowest = 0;
    return x;
  }).sort((a,b)=>b.won - a.won || b.winPct - a.winPct);
}

/* A compact summary for the top of the stats screen. */
export function overallSummary(matches){
  const done = (matches || []).filter(m=>m && m.completed);
  let runs = 0, wickets = 0, balls = 0, sixes = 0, fours = 0;
  done.forEach(m=>(m.innings || []).forEach(inn=>{
    runs += inn.runs;
    wickets += inn.wickets;
    balls += inn.legalBalls;
    (inn.batters || []).forEach(b=>{ sixes += b.sixes || 0; fours += b.fours || 0; });
  }));
  return {
    matches: done.length,
    runs, wickets, fours, sixes,
    overs: Math.floor(balls / 6),
    runRate: balls ? +(runs / (balls / 6)).toFixed(2) : 0
  };
}
