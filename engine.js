/* ===========================================================================
   engine.js — pure cricket scoring logic. No DOM, no Firebase.
   Kept separate so it can be unit-tested in isolation and reused anywhere.
   =========================================================================== */

/* Dismissal types credited to the bowler's own wicket tally — standard
   cricket scoring convention. Run outs, retirements and obstructing the
   field still end the batter's innings (inn.wickets still increments) but
   are not the bowler's wicket. */
export const BOWLER_CREDITED_DISMISSALS = new Set(['Bowled','Caught','LBW','Stumped','Hit Wicket']);

export function newBatter(name){
  return { name: name || 'Batter', runs:0, balls:0, fours:0, sixes:0, out:false, howOut:'' };
}

export function newBowler(name){
  return { name: name || 'Bowler', legalBalls:0, runs:0, wickets:0, maidens:0, _overRuns:0 };
}

export function newInnings(battingTeam, bowlingTeam, strikerName, nonStrikerName, bowlerName, allOutWickets){
  return {
    battingTeam, bowlingTeam,
    runs:0, wickets:0, legalBalls:0,
    extras:{ wd:0, nb:0, b:0, lb:0 },
    batters:[ newBatter(strikerName), newBatter(nonStrikerName) ],
    strikerIdx:0, nonStrikerIdx:1,
    bowlers:[ newBowler(bowlerName) ],
    bowlerIdx:0, prevBowlerIdx:-1,
    thisOverBalls:[],
    allOutWickets,
    target:null,
    completed:false,
    fow:[],                 // fall of wickets
    overRuns:[],            // total team runs in each completed over
    _overTeamRuns:0,        // running total for the over in progress
    partnerships:[ newPartnership(strikerName, nonStrikerName) ]
  };
}

export function newPartnership(a, b){
  return { runs:0, balls:0, a, b, out:false };
}

export function createMatch(opts){
  const {
    teamA, teamB, oversLimit, allOutWickets,
    striker, nonStriker, bowler, liveShare = false,
    tournamentId = null, fixtureId = null,
    teamAId = null, teamBId = null,
    venue = '', eventId = null
  } = opts;
  return {
    id: makeId(),
    teamA, teamB,
    oversLimit, allOutWickets,
    innings: [ newInnings('A','B', striker, nonStriker, bowler, allOutWickets) ],
    currentInningsIdx: 0,
    completed:false,
    resultText:'', resultSub:'',
    commentary: [],
    liveShare: !!liveShare,
    // links back to a tournament fixture / scheduled event, when started from one
    tournamentId, fixtureId, teamAId, teamBId, eventId,
    venue,
    toss: opts.toss || null,          // { winner:'A'|'B', decision:'bat'|'bowl' }
    isSuperOver: !!opts.isSuperOver,
    parentMatchId: opts.parentMatchId || null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function makeId(){
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for(let i=0;i<8;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

export function curInnings(match){ return match.innings[match.currentInningsIdx]; }
export function teamName(match, code){ return code === 'A' ? match.teamA : match.teamB; }

export function fmtOvers(legalBalls){
  return Math.floor(legalBalls/6) + '.' + (legalBalls % 6);
}

export function runRate(runs, legalBalls){
  if(!legalBalls) return '0.00';
  return (runs / (legalBalls/6)).toFixed(2);
}

export function swapStrike(inn){
  const t = inn.strikerIdx;
  inn.strikerIdx = inn.nonStrikerIdx;
  inn.nonStrikerIdx = t;
}

/* ---------------------------------------------------------------------------
   playBall — the heart of the scorer.
   ball = {
     extra: null | 'wd' | 'nb' | 'b' | 'lb',
     batRuns: number,          // runs off the bat, or runs run for byes/wides
     isWicket: bool,
     wicketType: string,
     whoOut: 'striker' | 'nonstriker',
     newBatsmanName: string
   }
   Returns { overJustEnded, inningsOver, wicketEndedInnings }
   --------------------------------------------------------------------------- */
export function playBall(match, ball){
  const inn = curInnings(match);
  const isLegal = !(ball.extra === 'wd' || ball.extra === 'nb');
  let teamRuns = 0, batsmanRuns = 0, runsRun = 0;

  if(ball.extra === 'wd'){
    const extra = 1 + (ball.batRuns || 0);
    inn.extras.wd += extra;
    teamRuns = extra;
    runsRun = ball.batRuns || 0;
  } else if(ball.extra === 'nb'){
    inn.extras.nb += 1;
    batsmanRuns = ball.batRuns || 0;
    teamRuns = 1 + batsmanRuns;
    runsRun = batsmanRuns;
  } else if(ball.extra === 'b'){
    const r = ball.batRuns || 0;
    inn.extras.b += r; teamRuns = r; runsRun = r;
  } else if(ball.extra === 'lb'){
    const r = ball.batRuns || 0;
    inn.extras.lb += r; teamRuns = r; runsRun = r;
  } else {
    batsmanRuns = ball.batRuns || 0;
    teamRuns = batsmanRuns;
    runsRun = batsmanRuns;
  }

  inn.runs += teamRuns;

  inn._overTeamRuns = (inn._overTeamRuns || 0) + teamRuns;

  // running partnership
  const pship = inn.partnerships[inn.partnerships.length - 1];
  if(pship){
    pship.runs += teamRuns;
    if(isLegal) pship.balls += 1;
  }

  const striker = inn.batters[inn.strikerIdx];
  if(isLegal) striker.balls += 1;
  if(!ball.extra || ball.extra === 'nb'){
    striker.runs += batsmanRuns;
    if(batsmanRuns === 4) striker.fours++;
    if(batsmanRuns === 6) striker.sixes++;
  }

  const bowler = inn.bowlers[inn.bowlerIdx];
  if(isLegal) bowler.legalBalls += 1;
  // Byes and leg byes are not charged to the bowler
  const chargedToBowler = (ball.extra !== 'b' && ball.extra !== 'lb') ? teamRuns : 0;
  bowler.runs += chargedToBowler;
  bowler._overRuns = (bowler._overRuns || 0) + chargedToBowler;

  // Ball marker for the over track
  let marker;
  if(ball.isWicket) marker = 'W';
  else if(ball.extra === 'wd') marker = 'wd' + (ball.batRuns ? '+' + ball.batRuns : '');
  else if(ball.extra === 'nb') marker = 'nb' + (ball.batRuns ? '+' + ball.batRuns : '');
  else if(ball.extra === 'b')  marker = (ball.batRuns || 0) + 'b';
  else if(ball.extra === 'lb') marker = (ball.batRuns || 0) + 'lb';
  else marker = String(ball.batRuns || 0);

  inn.thisOverBalls.push({
    txt: marker,
    wicket: !!ball.isWicket,
    four: (!ball.isWicket && !ball.extra && batsmanRuns === 4),
    six:  (!ball.isWicket && !ball.extra && batsmanRuns === 6),
    extra: !!ball.extra
  });

  addCommentary(match, inn, ball, marker, striker.name, bowler.name, teamRuns);

  let wicketEndedInnings = false;
  if(ball.isWicket){
    inn.wickets += 1;
    // Only these dismissal types are credited to the bowler's own tally —
    // a run out, retirement or obstructing-the-field still ends the
    // batter's innings and counts toward the team's fallen wickets, but is
    // not a bowler's wicket in standard cricket scoring.
    if(BOWLER_CREDITED_DISMISSALS.has(ball.wicketType)) bowler.wickets += 1;
    const outIdx = ball.whoOut === 'nonstriker' ? inn.nonStrikerIdx : inn.strikerIdx;
    inn.batters[outIdx].out = true;
    inn.batters[outIdx].howOut = ball.wicketType || 'out';
    const outBatter = inn.batters[outIdx];
    inn.fow.push({
      wicket: inn.wickets,
      runs: inn.runs,
      balls: inn.legalBalls + (isLegal ? 1 : 0),
      batter: outBatter.name,
      howOut: outBatter.howOut,
      bowler: bowler.name
    });
    if(pship) pship.out = true;

    if(inn.wickets >= inn.allOutWickets){
      wicketEndedInnings = true;
    } else {
      inn.batters.push(newBatter(ball.newBatsmanName || ('Batter ' + (inn.batters.length + 1))));
      if(ball.whoOut === 'nonstriker') inn.nonStrikerIdx = inn.batters.length - 1;
      else inn.strikerIdx = inn.batters.length - 1;
      inn.partnerships.push(newPartnership(
        inn.batters[inn.strikerIdx].name, inn.batters[inn.nonStrikerIdx].name));
    }
  } else if(runsRun % 2 === 1){
    swapStrike(inn);
  }

  if(isLegal) inn.legalBalls += 1;

  let overJustEnded = false;
  if(isLegal && inn.legalBalls > 0 && inn.legalBalls % 6 === 0){
    overJustEnded = true;
    if(bowler._overRuns === 0) bowler.maidens = (bowler.maidens || 0) + 1;
    inn.overRuns.push({
      over: inn.legalBalls / 6,
      runs: inn._overTeamRuns || 0,
      bowler: bowler.name
    });
    inn._overTeamRuns = 0;
    bowler._overRuns = 0;
    inn.thisOverBalls = [];
    if(!wicketEndedInnings){
      swapStrike(inn);
      inn.prevBowlerIdx = inn.bowlerIdx;
    }
  }

  const oversDone = inn.legalBalls >= match.oversLimit * 6;
  const chaseDone = inn.target !== null && inn.runs >= inn.target;
  const inningsOver = wicketEndedInnings || oversDone || chaseDone;

  match.updatedAt = Date.now();
  return { overJustEnded, inningsOver, wicketEndedInnings };
}

function addCommentary(match, inn, ball, marker, batterName, bowlerName, teamRuns){
  if(!match.commentary) match.commentary = [];
  const ballNo = fmtOvers(inn.legalBalls + ((ball.extra === 'wd' || ball.extra === 'nb') ? 0 : 1));
  let txt;
  if(ball.isWicket){
    txt = `${bowlerName} to ${batterName}, OUT! ${ball.wicketType || 'Wicket'}`;
  } else if(ball.extra === 'wd'){
    txt = `${bowlerName}, wide${ball.batRuns ? ' +' + ball.batRuns : ''} (${teamRuns} run${teamRuns===1?'':'s'})`;
  } else if(ball.extra === 'nb'){
    txt = `${bowlerName}, no ball${ball.batRuns ? ' +' + ball.batRuns : ''} (${teamRuns} run${teamRuns===1?'':'s'})`;
  } else if(ball.extra === 'b'){
    txt = `${bowlerName} to ${batterName}, ${ball.batRuns} bye${ball.batRuns===1?'':'s'}`;
  } else if(ball.extra === 'lb'){
    txt = `${bowlerName} to ${batterName}, ${ball.batRuns} leg bye${ball.batRuns===1?'':'s'}`;
  } else if(ball.batRuns === 0){
    txt = `${bowlerName} to ${batterName}, no run`;
  } else if(ball.batRuns === 4){
    txt = `${bowlerName} to ${batterName}, FOUR!`;
  } else if(ball.batRuns === 6){
    txt = `${bowlerName} to ${batterName}, SIX!`;
  } else {
    txt = `${bowlerName} to ${batterName}, ${ball.batRuns} run${ball.batRuns===1?'':'s'}`;
  }
  match.commentary.unshift({ ov: ballNo, txt, m: marker });
  if(match.commentary.length > 60) match.commentary.length = 60;
}

/* ---------------- innings / match transitions ---------------- */

export function startSecondInnings(match, { striker, nonStriker, bowler }){
  const inn1 = match.innings[0];
  const inn2 = newInnings(inn1.bowlingTeam, inn1.battingTeam, striker, nonStriker, bowler, match.allOutWickets);
  inn2.target = inn1.runs + 1;
  match.innings.push(inn2);
  match.currentInningsIdx = 1;
  match.updatedAt = Date.now();
  return inn2;
}

export function finishMatch(match){
  const inn1 = match.innings[0];
  const inn2 = match.innings[1];
  const target = inn2.target;
  let headline, sub;

  if(inn2.runs >= target){
    const wicketsInHand = match.allOutWickets - inn2.wickets;
    const ballsLeft = match.oversLimit * 6 - inn2.legalBalls;
    headline = teamName(match, inn2.battingTeam) + ' win by ' + wicketsInHand + (wicketsInHand === 1 ? ' wicket' : ' wickets');
    sub = teamName(match, inn2.battingTeam) + ' chased ' + target + ' with ' + ballsLeft + ' ball' + (ballsLeft===1?'':'s') + ' to spare.';
  } else if(inn2.runs === target - 1){
    headline = 'Match Tied';
    sub = 'Both teams finished level on ' + inn2.runs + ' runs.';
  } else {
    const margin = (target - 1) - inn2.runs;
    headline = teamName(match, inn1.battingTeam) + ' win by ' + margin + (margin === 1 ? ' run' : ' runs');
    sub = teamName(match, inn2.battingTeam) + ' finished on ' + inn2.runs + '/' + inn2.wickets + ', ' + margin + ' short of the target.';
  }

  match.completed = true;
  match.resultText = headline;
  match.resultSub = sub;
  match.updatedAt = Date.now();
  return { headline, sub };
}

/* Marks the current innings closed. Returns 'break' if the second innings
   still has to be set up, or 'done' if the match is over. */
export function closeInnings(match){
  curInnings(match).completed = true;
  match.updatedAt = Date.now();
  return match.currentInningsIdx === 0 ? 'break' : 'done';
}

/* ---------------- derived display helpers ---------------- */

export function chaseInfo(match){
  const inn = curInnings(match);
  if(inn.target === null) return null;
  const ballsLeft = (match.oversLimit * 6) - inn.legalBalls;
  const runsNeeded = inn.target - inn.runs;
  const rrr = ballsLeft > 0 ? (runsNeeded / (ballsLeft / 6)).toFixed(2) : '-';
  return { ballsLeft, runsNeeded, rrr };
}

export function bowlerEcon(b){
  return b.legalBalls > 0 ? (b.runs / (b.legalBalls / 6)).toFixed(2) : '0.00';
}

export function strikeRate(b){
  return b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : '0.0';
}

/* One-line score for lists and widgets, e.g. "Alpha 145/6 (20.0)" */
export function inningsLine(match, idx){
  const inn = match.innings[idx];
  if(!inn) return '';
  return teamName(match, inn.battingTeam) + ' ' + inn.runs + '/' + inn.wickets +
         ' (' + fmtOvers(inn.legalBalls) + ')';
}

/* Top performers of a finished innings, used on scorecards and the home feed. */
export function topPerformers(match){
  const bats = [], bowls = [];
  match.innings.forEach(inn=>{
    inn.batters.forEach(b=>{ if(b.balls > 0) bats.push(b); });
    inn.bowlers.forEach(b=>{ if(b.legalBalls > 0) bowls.push(b); });
  });
  bats.sort((a,b)=>b.runs - a.runs);
  bowls.sort((a,b)=>b.wickets - a.wickets || a.runs - b.runs);
  return { topBat: bats[0] || null, topBowl: bowls[0] || null };
}

/* ---------------------------------------------------------------------------
   Match-centre derived data
   --------------------------------------------------------------------------- */

/* The unbroken stand currently in progress. */
export function currentPartnership(match){
  const inn = curInnings(match);
  const p = inn.partnerships[inn.partnerships.length - 1];
  return p && !p.out ? p : null;
}

/* Last N completed overs, newest first — the "recent overs" strip. */
export function lastOvers(match, n = 5){
  const inn = curInnings(match);
  return (inn.overRuns || []).slice(-n).reverse();
}

/* Runs in the last N overs — the momentum figure commentators quote. */
export function recentRuns(match, n = 5){
  const inn = curInnings(match);
  const overs = (inn.overRuns || []).slice(-n);
  return {
    runs: overs.reduce((s,o)=>s + o.runs, 0),
    overs: overs.length
  };
}

/* Cumulative score after each over — used for the worm graph. */
export function scoreProgression(inn){
  let total = 0;
  return (inn.overRuns || []).map(o=>{
    total += o.runs;
    return { over: o.over, runs: total };
  });
}

/* Projected final score at the current run rate. */
export function projectedScore(match){
  const inn = curInnings(match);
  if(!inn.legalBalls) return null;
  const rr = inn.runs / (inn.legalBalls / 6);
  const ballsLeft = (match.oversLimit * 6) - inn.legalBalls;
  if(ballsLeft <= 0) return null;
  return Math.round(inn.runs + rr * (ballsLeft / 6));
}

/* ---------------------------------------------------------------------------
   Bowling quota.
   Standard limited-overs rule: no bowler may bowl more than a fifth of the
   innings, rounded up. 20 overs -> 4, 50 -> 10, 10 -> 2. Short or odd formats
   fall out of the same formula. Enforced in the UI when picking the next
   bowler, so an over can never be started by someone who is bowled out.
   --------------------------------------------------------------------------- */
export function maxOversPerBowler(match){
  return Math.max(1, Math.ceil(match.oversLimit / 5));
}

export function bowlerOversUsed(bowler){
  return bowler.legalBalls / 6;
}

export function bowlerRemaining(match, bowler){
  return maxOversPerBowler(match) - Math.floor(bowler.legalBalls / 6);
}

export function bowlerExhausted(match, bowler){
  return bowlerRemaining(match, bowler) <= 0;
}

/* Bowlers who may legally start the next over: not bowled out, and not the
   one who just bowled. */
export function eligibleBowlers(match, names){
  const inn = curInnings(match);
  const prev = inn.prevBowlerIdx >= 0 ? inn.bowlers[inn.prevBowlerIdx].name : null;
  return names.filter(n=>{
    if(prev && n.toLowerCase() === prev.toLowerCase()) return false;
    const b = inn.bowlers.find(x=>x.name.toLowerCase() === n.toLowerCase());
    return !b || !bowlerExhausted(match, b);
  });
}

/* Toss line, e.g. "Alpha won the toss and elected to bat". */
export function tossText(match){
  if(!match.toss) return '';
  const winner = teamName(match, match.toss.winner);
  return winner + ' won the toss and elected to ' + match.toss.decision;
}

/* ---------------------------------------------------------------------------
   Player of the match.
   Simple, defensible weighting: a run is worth 1, a wicket 20, and economy /
   strike rate nudge it. Enough to pick the obvious standout without pretending
   to be an official algorithm.
   --------------------------------------------------------------------------- */
export function playerOfTheMatch(match){
  const scores = new Map();
  const bump = (name, pts, detail)=>{
    if(!name) return;
    const cur = scores.get(name) || { name, pts:0, bat:null, bowl:null };
    cur.pts += pts;
    if(detail.bat) cur.bat = detail.bat;
    if(detail.bowl) cur.bowl = detail.bowl;
    scores.set(name, cur);
  };

  match.innings.forEach(inn=>{
    inn.batters.forEach(b=>{
      if(!b.balls) return;
      const sr = (b.runs / b.balls) * 100;
      let pts = b.runs + (b.fours * 1) + (b.sixes * 2);
      if(b.runs >= 50) pts += 10;
      if(b.runs >= 100) pts += 20;
      if(b.balls >= 10) pts += (sr - 100) * 0.1;
      bump(b.name, pts, { bat: b.runs + ' (' + b.balls + ')' });
    });
    inn.bowlers.forEach(b=>{
      if(!b.legalBalls) return;
      const econ = b.runs / (b.legalBalls / 6);
      let pts = b.wickets * 20 + (b.maidens || 0) * 5;
      if(b.wickets >= 3) pts += 10;
      if(b.wickets >= 5) pts += 20;
      pts += (7 - econ) * (b.legalBalls / 6) * 1.5;
      bump(b.name, pts, { bowl: b.wickets + '/' + b.runs });
    });
  });

  const ranked = Array.from(scores.values()).sort((a,b)=>b.pts - a.pts);
  if(!ranked.length) return null;
  const top = ranked[0];
  const bits = [top.bat, top.bowl].filter(Boolean);
  return { name: top.name, line: bits.join(' & '), points: Math.round(top.pts) };
}

/* ---------------------------------------------------------------------------
   Super over — a fresh 1-over match linked back to the tied original.
   --------------------------------------------------------------------------- */
export function createSuperOver(parent, { striker, nonStriker, bowler }){
  const m = createMatch({
    teamA: parent.teamA, teamB: parent.teamB,
    oversLimit: 1, allOutWickets: 2,
    striker, nonStriker, bowler,
    liveShare: parent.liveShare,
    venue: parent.venue,
    isSuperOver: true,
    parentMatchId: parent.id
  });
  return m;
}
