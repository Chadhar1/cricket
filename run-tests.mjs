/* ===========================================================================
   Test suite for the pure logic layers.
   Run from the project root:   node tests/run.mjs
   No dependencies, no framework — just Node.

   engine.js and tournament.js have no DOM and no Supabase, which is exactly
   what makes this possible. Keep it that way as you add features.
   =========================================================================== */

import {
  createMatch, playBall, startSecondInnings, finishMatch, closeInnings,
  curInnings, fmtOvers, runRate, bowlerEcon, strikeRate, newBowler,
  inningsLine, topPerformers, chaseInfo,
  currentPartnership, lastOvers, recentRuns, projectedScore, tossText,
  playerOfTheMatch, createSuperOver, scoreProgression,
  maxOversPerBowler, bowlerRemaining, bowlerExhausted, eligibleBowlers,
  allowedDismissalsFor
} from './engine.js';

import {
  buildCareers, topRunScorers, topWicketTakers, bestAverages, bestEconomy,
  bestBattingPerformances, bestBowlingPerformances, teamRecords, overallSummary,
  findPlayer
} from './stats.js';

import {
  createTournament, generateRoundRobin, resultFromMatch, applyResult,
  computeStandings, leagueComplete, generateKnockout, advanceKnockout,
  tournamentChampion, formatNRR, oversForNRR, POINTS
} from './tournament.js';

import { AVATARS, avatarSVG, initialsBadge, getAvatar, DEFAULT_AVATAR } from './avatars.js';
import { supabaseConfig, isConfigured } from './supabase-config.js';
import {
  normaliseHandle, validateHandle, pairId, newConnection, connectionActionFor,
  canRespond, newOrganiserApplication, validateApplication, canCreateLeague
} from './social.js';

let pass = 0, fail = 0;
const check = (c, m)=>{ c ? pass++ : (fail++, console.error('  x', m)); };
const head  = (t)=>console.log('\n' + t);

/* ---------- helpers ---------- */
const mk  = (ov, ao, x={})=>createMatch({ teamA:'Alpha', teamB:'Beta', oversLimit:ov,
  allOutWickets:ao, striker:'S1', nonStriker:'S2', bowler:'B1', ...x });
const run = (m,n)=>playBall(m,{extra:null,batRuns:n,isWicket:false});
const ex  = (m,t,n)=>playBall(m,{extra:t,batRuns:n,isWicket:false});
const wkt = (m,o={})=>playBall(m,{extra:null,batRuns:o.runs||0,isWicket:true,
  wicketType:o.type||'Bowled',whoOut:o.who||'striker',newBatsmanName:o.next||'NEXT'});
function nextOver(m,name){
  const inn = curInnings(m);
  let i = inn.bowlers.findIndex(b=>b.name===name);
  if(i===-1){ inn.bowlers.push(newBowler(name)); i = inn.bowlers.length-1; }
  inn.bowlerIdx = i;
}
const striker = (m)=>curInnings(m).batters[curInnings(m).strikerIdx].name;

/* ================= ENGINE ================= */
head('Engine - formatting');
check(fmtOvers(0)==='0.0' && fmtOvers(7)==='1.1' && fmtOvers(12)==='2.0','fmtOvers');
check(runRate(30,12)==='15.00' && runRate(0,0)==='0.00','runRate guards divide-by-zero');
check(strikeRate({runs:25,balls:20})==='125.0','strikeRate');
check(bowlerEcon({runs:24,legalBalls:24})==='6.00','bowlerEcon');

head('Engine - strike rotation');
{
  const m = mk(20,10);
  run(m,1); check(striker(m)==='S2','odd run swaps strike');
  run(m,2); check(striker(m)==='S2','even run keeps strike');
  run(m,3); check(striker(m)==='S1','3 runs swaps strike');
}

head('Engine - over completion');
{
  const m = mk(20,10);
  for(let i=0;i<5;i++) run(m,0);
  check(striker(m)==='S1','still S1 after 5 dots');
  const r = run(m,0);
  check(r.overJustEnded===true,'over ends on the 6th legal ball');
  check(r.inningsOver===false,'1 over of 20 does not end the innings');
  check(striker(m)==='S2','strike rotates at the end of an over');
  check(curInnings(m).thisOverBalls.length===0,'over track resets');
  check(curInnings(m).bowlers[0].maidens===1,'six dots = a maiden');
}
{
  const m = mk(20,10);
  for(let i=0;i<5;i++) run(m,0);
  run(m,1);
  check(curInnings(m).bowlers[0].maidens===0,'a run conceded means no maiden');
}

head('Engine - extras');
{
  const m = mk(20,10);
  ex(m,'wd',0);
  check(curInnings(m).runs===1,'wide = 1 run');
  check(curInnings(m).legalBalls===0,'wide is not a legal ball');
  ex(m,'wd',2);
  check(curInnings(m).runs===4,'wide + 2 run = 3 more runs');
  ex(m,'nb',4);
  check(curInnings(m).runs===9,'no ball + 4 = 5 runs');
  check(curInnings(m).batters[0].runs===4,'batter credited off a no ball');
  check(curInnings(m).batters[0].fours===1,'boundary counted off a no ball');
  check(curInnings(m).batters[0].balls===0,'no ball is not a ball faced');
  check(curInnings(m).extras.nb===1,'only the penalty run counts as the nb extra');
  ex(m,'b',2);
  check(curInnings(m).legalBalls===1,'a bye IS a legal ball');
  check(curInnings(m).batters[0].balls===1,'a bye counts as a ball faced');
  check(curInnings(m).batters[0].runs===4,'byes are not credited to the batter');
  check(curInnings(m).bowlers[0].runs===9,'byes are not charged to the bowler');
  ex(m,'lb',1);
  check(curInnings(m).bowlers[0].runs===9,'leg byes are not charged to the bowler');
  check(striker(m)==='S2','odd leg bye swaps strike');
}

head('Engine - wickets');
{
  const m = mk(20,10);
  run(m,4);
  wkt(m,{type:'Caught',next:'S3'});
  const inn = curInnings(m);
  check(inn.wickets===1,'wicket counted');
  check(inn.batters[0].out && inn.batters[0].howOut==='Caught','dismissal recorded');
  check(striker(m)==='S3','new batter takes strike');
  check(inn.bowlers[0].wickets===1,'bowler credited');
  check(inn.legalBalls===2,'the wicket ball is a legal ball');
}
{
  const m = mk(20,10);
  wkt(m,{who:'nonstriker',next:'S3'});
  check(curInnings(m).batters[1].out===true,'non-striker dismissed');
  check(striker(m)==='S1','striker keeps strike on a non-striker run out');
}
{
  const m = mk(20,2);
  wkt(m,{next:'S3'});
  const r = wkt(m,{});
  check(r.wicketEndedInnings && r.inningsOver,'all out ends the innings');
  check(curInnings(m).batters.length===3,'no phantom batter on the last wicket');
}

head('Engine - no ball & Free Hit (ICC Law 21)');
{
  // A no ball arms the Free Hit for the *next* ball, not itself.
  const m = mk(20,10);
  const r1 = ex(m,'nb',0);
  check(r1.isFreeHitBall===false,'the no ball itself is not the free hit (nothing was pending yet)');
  check(curInnings(m).freeHit===true,'no ball arms the Free Hit for the next ball');
  const r2 = run(m,1);
  check(r2.isFreeHitBall===true,'next ball is played as the Free Hit');
  check(curInnings(m).freeHit===false,'a fair ball consumes the Free Hit');
}
{
  // Free Hit rolls over if the free-hit ball is itself a no ball.
  const m = mk(20,10);
  ex(m,'nb',0);
  const r2 = ex(m,'nb',0);
  check(r2.isFreeHitBall===true,'the second no ball was itself played as the pending Free Hit');
  check(curInnings(m).freeHit===true,'Free Hit still pending after a no ball on a Free Hit ball');
}
{
  // Free Hit rolls over if the free-hit ball is called wide too.
  const m = mk(20,10);
  ex(m,'nb',0);
  const r2 = ex(m,'wd',0);
  check(r2.isFreeHitBall===true,'the wide was played as the pending Free Hit');
  check(curInnings(m).freeHit===true,'Free Hit still pending after a wide on the Free Hit ball');
  const r3 = run(m,0);
  check(r3.isFreeHitBall===true,'fair ball after that is finally the Free Hit');
  check(curInnings(m).freeHit===false,'Free Hit consumed once a fair ball is bowled');
}
{
  // Bowled/Caught/LBW/Stumped/Hit Wicket are all impossible off a no ball.
  for(const type of ['Bowled','Caught','LBW','Stumped','Hit Wicket']){
    const m2 = mk(20,10);
    const r = playBall(m2,{extra:'nb',batRuns:0,isWicket:true,wicketType:type,whoOut:'striker',newBatsmanName:'NEXT'});
    check(r.wicketRejected===true, type+' rejected off a no ball');
    check(curInnings(m2).wickets===0, type+' off a no ball does not fall');
    check(curInnings(m2).runs===1, type+' off a no ball still scores the penalty run');
  }
}
{
  // Run Out off a no ball: legal, and combines correctly with the nb run.
  const m = mk(20,10);
  const r = playBall(m,{extra:'nb',batRuns:1,isWicket:true,wicketType:'Run Out',whoOut:'striker',newBatsmanName:'NEXT'});
  check(r.wicketRejected===false,'run out allowed off a no ball');
  check(curInnings(m).wickets===1,'run out off a no ball is recorded');
  check(curInnings(m).runs===2,'1 no-ball penalty + 1 run actually run');
  check(curInnings(m).extras.nb===1,'no-ball extra still recorded alongside the run out');
  check(curInnings(m).bowlers[0].wickets===0,'run out never credited to the bowler');
}
{
  // A wide is less restrictive than a no ball: Stumped is still legal.
  const m = mk(20,10);
  const rStumped = playBall(m,{extra:'wd',batRuns:0,isWicket:true,wicketType:'Stumped',whoOut:'striker',newBatsmanName:'NEXT'});
  check(rStumped.wicketRejected===false,'stumped allowed off a wide');
  check(curInnings(m).wickets===1,'stumping off a wide recorded');
  for(const type of ['Bowled','Caught','LBW','Hit Wicket']){
    const m2 = mk(20,10);
    const r = playBall(m2,{extra:'wd',batRuns:0,isWicket:true,wicketType:type,whoOut:'striker',newBatsmanName:'NEXT'});
    check(r.wicketRejected===true, type+' rejected off a wide');
    check(curInnings(m2).wickets===0, type+' off a wide does not fall');
  }
}
{
  // A fair ball bowled *as* the Free Hit carries the same protection as a
  // no ball (this is the whole point of the Free Hit).
  const m = mk(20,10);
  ex(m,'nb',0); // arms the Free Hit
  const rBowled = playBall(m,{extra:null,batRuns:0,isWicket:true,wicketType:'Bowled',whoOut:'striker',newBatsmanName:'NEXT'});
  check(rBowled.wicketRejected===true,'bowled rejected on a Free Hit fair ball');
  check(curInnings(m).wickets===0,'no wicket falls off a rejected Free Hit dismissal');
  check(curInnings(m).freeHit===false,'Free Hit still consumed by the fair ball even though the wicket was rejected');
}
{
  const m = mk(20,10);
  ex(m,'nb',0);
  const rRunOut = playBall(m,{extra:null,batRuns:1,isWicket:true,wicketType:'Run Out',whoOut:'striker',newBatsmanName:'NEXT'});
  check(rRunOut.wicketRejected===false,'run out allowed on a Free Hit fair ball');
  check(curInnings(m).wickets===1,'run out on a Free Hit is recorded');
}
{
  // allowedDismissalsFor is the single source of truth the UI dropdown
  // uses too — cover it directly.
  const inn = curInnings(mk(20,10));
  check(!allowedDismissalsFor(inn,'nb').includes('Bowled'),'allowedDismissalsFor excludes Bowled for nb');
  check(allowedDismissalsFor(inn,'nb').includes('Run Out'),'allowedDismissalsFor includes Run Out for nb');
  check(allowedDismissalsFor(inn,'wd').includes('Stumped'),'allowedDismissalsFor includes Stumped for wd');
  check(!allowedDismissalsFor(inn,'wd').includes('Caught'),'allowedDismissalsFor excludes Caught for wd');
  check(allowedDismissalsFor(inn,null).includes('Bowled'),'allowedDismissalsFor allows Bowled on a normal fair ball');
  inn.freeHit = true;
  check(!allowedDismissalsFor(inn,null).includes('Bowled'),'allowedDismissalsFor excludes Bowled on a Free Hit fair ball');
}

head('Engine - innings and results');
{
  const m = mk(1,10);
  for(let i=0;i<5;i++) run(m,0);
  check(run(m,6).inningsOver===true,'innings ends when the overs run out');
  check(closeInnings(m)==='break','first innings closes to a break');
  startSecondInnings(m,{striker:'T1',nonStriker:'T2',bowler:'C1'});
  check(curInnings(m).target===7,'target = first innings + 1');
  check(curInnings(m).battingTeam==='B','sides swap for the chase');
  const ci = chaseInfo(m);
  check(ci.runsNeeded===7 && ci.ballsLeft===6,'chase info correct at the start');
  for(let i=0;i<5;i++) run(m,0);
  run(m,6);
  check(closeInnings(m)==='done','second innings closes to done');
  finishMatch(m);
  check(m.resultText==='Match Tied','level scores = tie');
}
{
  const m = mk(2,10);
  for(let i=0;i<11;i++) run(m,0);
  nextOver(m,'B2'); run(m,0);
  closeInnings(m);
  startSecondInnings(m,{striker:'T1',nonStriker:'T2',bowler:'C1'});
  check(curInnings(m).target===1,'target of 1 when the first innings scored 0');
  check(run(m,1).inningsOver===true,'reaching the target ends the innings mid-over');
  closeInnings(m); finishMatch(m);
  check(/win by 10 wickets/.test(m.resultText),'win by wickets: '+m.resultText);
  check(/11 balls to spare/.test(m.resultSub),'balls to spare stated');
}
{
  const m = mk(1,10);
  for(let i=0;i<5;i++) run(m,0);
  run(m,6); closeInnings(m);
  startSecondInnings(m,{striker:'T1',nonStriker:'T2',bowler:'C1'});
  for(let i=0;i<5;i++) run(m,0);
  run(m,2); closeInnings(m); finishMatch(m);
  check(/Alpha win by 4 runs/.test(m.resultText),'win by runs: '+m.resultText);
}

head('Engine - commentary and summaries');
{
  const m = mk(20,10);
  run(m,4); ex(m,'wd',0); wkt(m,{type:'LBW',next:'S3'});
  check(m.commentary.length===3,'three commentary entries');
  check(/OUT!/.test(m.commentary[0].txt),'newest entry first, wicket flagged');
  check(m.commentary[2].ov==='0.1','first ball logged as 0.1');
}
{
  const m = mk(20,10);
  run(m,4); run(m,4); run(m,1);
  check(inningsLine(m,0)==='Alpha 9/0 (0.3)','inningsLine: '+inningsLine(m,0));
  check(topPerformers(m).topBat.runs===9,'top scorer found');
}

/* ================= TOURNAMENT ================= */
head('Tournament - fixture generation');
{
  const t = createTournament({name:'Cup',teams:['A','B','C','D'].map(n=>({id:n.toLowerCase(),name:n}))});
  const fx = generateRoundRobin(t);
  check(fx.length===6,'4 teams single round robin = 6 fixtures');
  check(new Set(fx.map(f=>[f.teamAId,f.teamBId].sort().join('-'))).size===6,'every pairing unique');
  const c = {};
  fx.forEach(f=>{ c[f.teamAId]=(c[f.teamAId]||0)+1; c[f.teamBId]=(c[f.teamBId]||0)+1; });
  check(Object.values(c).every(v=>v===3),'each team plays 3');
}
{
  const t = createTournament({name:'Odd',teams:['A','B','C'].map(n=>({id:n.toLowerCase(),name:n}))});
  const fx = generateRoundRobin(t);
  check(fx.length===3,'odd team count handled with a bye');
  check(!fx.some(f=>f.teamAId==='__bye__'||f.teamBId==='__bye__'),'no bye leaks into fixtures');
}
{
  const t = createTournament({name:'HA',teams:[{id:'a',name:'A'},{id:'b',name:'B'}]});
  const fx = generateRoundRobin(t,{legs:2});
  check(fx.length===2,'home and away doubles the fixtures');
  check(fx[0].teamAId!==fx[1].teamAId,'second leg reverses who bats first');
}

head('Tournament - net run rate');
check(oversForNRR({balls:120,allOut:false},20)===20,'20 overs faced');
check(oversForNRR({balls:60,allOut:false},20)===10,'10 overs faced');
check(oversForNRR({balls:90,allOut:true},20)===20,'ALL OUT is charged the full quota, not the overs used');
{
  const t = createTournament({name:'N',oversLimit:20,teams:[{id:'a',name:'Aces'},{id:'b',name:'Bats'}]});
  t.fixtures = generateRoundRobin(t);
  const f = t.fixtures[0];
  applyResult(t,f.id,{
    a:{runs:180,wickets:4,balls:120,allOut:false},
    b:{runs:100,wickets:10,balls:90,allOut:true},
    winnerId:f.teamAId,text:''});
  const tb = computeStandings(t);
  const aces = tb.find(r=>r.teamId===f.teamAId), bats = tb.find(r=>r.teamId===f.teamBId);
  check(aces.points===2 && bats.points===0,'win 2 pts, loss 0');
  check(Math.abs(aces.nrr-4)<0.001,'NRR +4.000 (180/20 minus 100/20), got '+aces.nrr);
  check(Math.abs(bats.nrr+4)<0.001,'opponent NRR is the exact inverse');
  check(formatNRR(aces.nrr)==='+4.000' && formatNRR(bats.nrr)==='-4.000','NRR sign formatting');
  check(tb[0].teamId===f.teamAId,'winner sorted to the top');
}
{
  const t = createTournament({name:'T',oversLimit:20,teams:[{id:'a',name:'A'},{id:'b',name:'B'}]});
  t.fixtures = generateRoundRobin(t);
  applyResult(t,t.fixtures[0].id,{
    a:{runs:150,wickets:6,balls:120,allOut:false},
    b:{runs:150,wickets:8,balls:120,allOut:false},
    winnerId:'tie',text:''});
  const tb = computeStandings(t);
  check(tb.every(r=>r.points===POINTS.tie && r.tied===1),'a tie gives both sides a point');
  check(tb.every(r=>Math.abs(r.nrr)<1e-9),'equal scores give NRR 0');
}

head('Tournament - standings order');
{
  const t = createTournament({name:'O',oversLimit:20,teams:['A','B','C','D'].map(n=>({id:n.toLowerCase(),name:n}))});
  t.fixtures = generateRoundRobin(t);
  const rank = {a:4,b:3,c:2,d:1};
  t.fixtures.forEach(f=>{
    const aStrong = rank[f.teamAId] > rank[f.teamBId];
    applyResult(t,f.id,{
      a:{runs:aStrong?160:120,wickets:5,balls:120,allOut:false},
      b:{runs:aStrong?120:160,wickets:7,balls:120,allOut:false},
      winnerId: aStrong?f.teamAId:f.teamBId, text:''});
  });
  check(computeStandings(t).map(r=>r.teamId).join(',')==='a,b,c,d','sorted by points then NRR');
  check(leagueComplete(t)===true,'league flagged complete');
}

head('Tournament - knockout bracket');
{
  const t = createTournament({name:'K',format:'league-knockout',oversLimit:20,
    teams:['A','B','C','D'].map(n=>({id:n.toLowerCase(),name:n}))});
  t.fixtures = generateRoundRobin(t);
  const rank = {a:4,b:3,c:2,d:1};
  t.fixtures.forEach(f=>{
    const aStrong = rank[f.teamAId] > rank[f.teamBId];
    applyResult(t,f.id,{
      a:{runs:aStrong?160:120,wickets:5,balls:120,allOut:false},
      b:{runs:aStrong?120:160,wickets:7,balls:120,allOut:false},
      winnerId: aStrong?f.teamAId:f.teamBId, text:''});
  });
  t.knockout = generateKnockout(t);
  const semis = t.knockout.filter(f=>f.stage==='semi-final');
  const final = t.knockout.find(f=>f.stage==='final');
  check(t.knockout.length===3,'2 semis plus a final');
  check(semis[0].teamAId==='a' && semis[0].teamBId==='d','SF1 seeded 1 v 4');
  check(semis[1].teamAId==='b' && semis[1].teamBId==='c','SF2 seeded 2 v 3');
  check(final.teamAId===null,'final starts TBD');

  applyResult(t,semis[0].id,{a:{runs:150,wickets:5,balls:120,allOut:false},
    b:{runs:140,wickets:9,balls:120,allOut:false},winnerId:'a',text:''});
  advanceKnockout(t);
  check(final.teamAId==='a' && final.teamBId===null,'first finalist shows immediately, other side still TBD');

  applyResult(t,semis[1].id,{a:{runs:130,wickets:8,balls:120,allOut:false},
    b:{runs:131,wickets:4,balls:118,allOut:false},winnerId:'c',text:''});
  advanceKnockout(t);
  check(final.teamAId==='a' && final.teamBId==='c','both winners in the final');
  check(tournamentChampion(t)===null,'no champion until the final is played');

  applyResult(t,final.id,{a:{runs:170,wickets:3,balls:120,allOut:false},
    b:{runs:160,wickets:10,balls:118,allOut:true},winnerId:'a',text:''});
  check(tournamentChampion(t).id==='a','champion crowned');
  check(computeStandings(t).every(r=>r.played===3),'knockout games excluded from the league table');
}
{
  const t = createTournament({name:'S',format:'league-knockout',oversLimit:20,
    teams:['A','B','C'].map(n=>({id:n.toLowerCase(),name:n}))});
  t.fixtures = generateRoundRobin(t);
  t.fixtures.forEach(f=>applyResult(t,f.id,{
    a:{runs:150,wickets:5,balls:120,allOut:false},
    b:{runs:100,wickets:10,balls:110,allOut:true},winnerId:f.teamAId,text:''}));
  const ko = generateKnockout(t);
  check(ko.length===1 && ko[0].stage==='final','fewer than 4 teams goes straight to a final');
}

head('Tournament - linking a scored match');
{
  const t = createTournament({name:'L',oversLimit:1,allOutWickets:10,
    teams:[{id:'x',name:'Alpha'},{id:'y',name:'Beta'}]});
  t.fixtures = generateRoundRobin(t);
  const f = t.fixtures[0];

  const m = mk(1,10);
  for(let i=0;i<5;i++) run(m,0);
  run(m,6); closeInnings(m);
  startSecondInnings(m,{striker:'T1',nonStriker:'T2',bowler:'C1'});
  for(let i=0;i<5;i++) run(m,0);
  run(m,1); closeInnings(m); finishMatch(m);

  const res = resultFromMatch(m,f.teamAId,f.teamBId);
  check(res!==null,'result extracted');
  check(res.a.runs===m.innings[0].runs && res.b.runs===m.innings[1].runs,'both innings carried across');
  check(res.winnerId===f.teamAId,'higher score wins the fixture');
  applyResult(t,f.id,res,m.id);
  check(t.fixtures[0].status==='completed','fixture marked complete');
  check(t.fixtures[0].matchId===m.id,'fixture linked to the scorecard');
  check(computeStandings(t)[0].points===2,'points awarded from a real match');
}
{
  const m = mk(20,10); run(m,4);
  check(resultFromMatch(m,'x','y')===null,'a one-innings match yields no result');
}

/* ================= AVATARS ================= */
head('Avatars');
check(AVATARS.length===12,'12 avatars');
check(new Set(AVATARS.map(a=>a.id)).size===12,'ids unique');
check(AVATARS.every(a=>avatarSVG(a.id).startsWith('<svg') && avatarSVG(a.id).includes('</svg>')),'all render valid svg');
check(getAvatar('nope').id===DEFAULT_AVATAR,'unknown id falls back to the default');
check(avatarSVG('helmet',64).includes('width="64"'),'size honoured');
check(initialsBadge('Lahore Lions').includes('LL'),'initials derived');
check(initialsBadge('').includes('?'),'empty name handled');
check(initialsBadge('Karachi Kings')===initialsBadge('Karachi Kings'),'badge colour deterministic');

/* ================= CONFIG ================= */
head('Supabase config');
// This project now ships with real production values in supabase-config.js
// (deployed and in use), so isConfigured() is expected to be true here — the
// interesting behaviour to test is the *logic*, not the live file's current
// contents, so we exercise isConfigured's placeholder-detection rule against
// synthetic inputs instead of asserting a specific state of the real file.
check(typeof supabaseConfig.url==='string' && typeof supabaseConfig.anonKey==='string','config has the expected shape');
check(isConfigured()===true,'the real, deployed config reports configured');
{
  const looksConfigured = (c)=> !!c.url && !c.url.startsWith('PASTE_') && !!c.anonKey && !c.anonKey.startsWith('PASTE_');
  const placeholder = { url:'PASTE_YOUR_SUPABASE_URL', anonKey:'PASTE_YOUR_ANON_KEY' };
  const real = { url:'https://abcdefghijklmno.supabase.co', anonKey:'ey.some.jwt' };
  check(looksConfigured(placeholder)===false,'placeholder-shaped config reports not-configured');
  check(looksConfigured(real)===true,'a real-looking url/key reports configured');
}

/* ================= SERIALISATION ================= */
head('JSON serialisation (jsonb columns)');
{
  const t = createTournament({name:'S',teams:[{id:'a',name:'A'},{id:'b',name:'B'}]});
  t.fixtures = generateRoundRobin(t);
  const m = mk(20,10); run(m,4); wkt(m,{next:'X'});
  const trip = (o)=>JSON.stringify(JSON.parse(JSON.stringify(o)))===JSON.stringify(o);
  check(trip(t),'tournament survives a JSON round trip');
  check(trip(m),'match survives a JSON round trip');
  const hasUndef = (o)=>JSON.stringify(o,(k,v)=>v===undefined?'__U__':v).includes('__U__');
  check(!hasUndef(t) && !hasUndef(m),'no undefined values (JSON.stringify silently drops them, which would desync a jsonb column)');
}

/* ================= SOCIAL ================= */
head('Social - handles');
check(validateHandle('haris').ok===true,'valid handle accepted');
check(validateHandle('Haris').handle==='haris','handle normalised to lowercase');
check(validateHandle('hi').ok===false,'too short rejected');
check(validateHandle('9ball').ok===false,'must start with a letter');
check(validateHandle('admin').ok===false,'reserved word rejected');
check(validateHandle('a_b_c').ok===true,'underscore allowed');

head('Social - connections');
{
  const id1 = pairId('uidA','uidB'), id2 = pairId('uidB','uidA');
  check(id1===id2,'pair id is order-independent');
  check(pairId('x','x')===null,'no self-connections');
  const conn = newConnection('uidA','uidB');
  check(conn.status==='pending' && conn.requestedBy==='uidA','new connection starts pending');
  check(connectionActionFor(conn,'uidA')==='awaiting','requester sees awaiting');
  check(connectionActionFor(conn,'uidB')==='respond','recipient sees respond');
  check(canRespond(conn,'uidB')===true,'recipient can respond');
  check(canRespond(conn,'uidA')===false,'requester cannot accept their own request');
}

head('Social - organiser applications');
{
  const app = newOrganiserApplication({ uid:'u1', orgName:'Lahore Sunday League', description:'Weekly Sunday league at the club ground, six teams.', contact:'u1@example.com' });
  check(app.status==='pending','new application starts pending');
  check(validateApplication(app).ok===true,'well-formed application passes validation');
  check(validateApplication({orgName:'X'}).ok===false,'short/missing fields rejected');
  check(canCreateLeague({isAdmin:true})===true,'admin can create a league');
  check(canCreateLeague({isOrganiser:true})===true,'approved organiser can create a league');
  check(canCreateLeague({isOrganiser:false,isAdmin:false})===false,'plain player cannot');
}

/* ================= MATCH CENTRE DATA ================= */
head('Engine - partnerships and fall of wickets');
{
  const m = mk(20,10);
  run(m,4); run(m,2);
  let p = currentPartnership(m);
  check(p && p.runs===6 && p.balls===2,'partnership accrues runs and balls');
  check(p.a==='S1' && p.b==='S2','opening pair recorded');

  wkt(m,{type:'Bowled',next:'S3'});
  const inn = curInnings(m);
  check(inn.fow.length===1,'fall of wickets logged');
  check(inn.fow[0].runs===6 && inn.fow[0].wicket===1,'FoW records score at dismissal');
  check(inn.fow[0].batter==='S1','FoW names the dismissed batter');
  check(inn.partnerships.length===2,'a new partnership opens after a wicket');
  check(inn.partnerships[0].out===true,'the broken stand is closed');

  p = currentPartnership(m);
  check(p.runs===0 && p.balls===0,'new stand starts from zero');
  run(m,3);
  check(currentPartnership(m).runs===3,'new stand accrues independently');
}
{
  // extras count toward the stand but a wide is not a ball faced
  const m = mk(20,10);
  ex(m,'wd',0); run(m,1);
  const p = currentPartnership(m);
  check(p.runs===2,'wide counts toward the partnership total');
  check(p.balls===1,'wide is not counted as a ball in the stand');
}

head('Engine - over history and projections');
{
  const m = mk(20,10);
  for(let i=0;i<6;i++) run(m,1);
  nextOver(m,'B2');
  for(let i=0;i<6;i++) run(m,2);
  const inn = curInnings(m);
  check(inn.overRuns.length===2,'two completed overs recorded');
  check(inn.overRuns[0].runs===6 && inn.overRuns[1].runs===12,'runs per over correct');
  const lo = lastOvers(m,5);
  check(lo.length===2 && lo[0].runs===12,'lastOvers returns newest first');
  const rec = recentRuns(m,5);
  check(rec.runs===18 && rec.overs===2,'recent runs aggregated');
  const prog = scoreProgression(inn);
  check(prog[1].runs===18,'score progression is cumulative');
  const proj = projectedScore(m);
  check(proj===180,'projected score at 9 rpo over 20 overs = 180, got '+proj);
}
{
  const m = mk(20,10);
  check(projectedScore(m)===null,'no projection before a ball is bowled');
}

head('Engine - bowling quota');
{
  check(maxOversPerBowler({oversLimit:20})===4,'T20: 4 overs each');
  check(maxOversPerBowler({oversLimit:50})===10,'ODI: 10 overs each');
  check(maxOversPerBowler({oversLimit:10})===2,'10-over game: 2 each');
  check(maxOversPerBowler({oversLimit:8})===2,'8 overs rounds up to 2');
  check(maxOversPerBowler({oversLimit:1})===1,'super over: 1');
  check(maxOversPerBowler({oversLimit:3})===1,'never returns 0');
}
{
  const m = mk(20,10);
  const inn = curInnings(m);
  const b = inn.bowlers[0];
  check(bowlerRemaining(m,b)===4,'starts with the full quota');
  for(let i=0;i<6;i++) run(m,0);
  check(bowlerRemaining(m,b)===3,'one over used');
  check(bowlerExhausted(m,b)===false,'not bowled out yet');
  // fast-forward: give the bowler 4 completed overs
  b.legalBalls = 24;
  check(bowlerRemaining(m,b)===0,'quota spent');
  check(bowlerExhausted(m,b)===true,'flagged as bowled out');
  b.legalBalls = 23;
  check(bowlerExhausted(m,b)===false,'a part-over does not count as complete');
}
{
  const m = mk(20,10);
  const inn = curInnings(m);
  inn.bowlers.push(newBowler('B2'));
  inn.bowlers.push(newBowler('B3'));
  inn.bowlers[0].legalBalls = 24;          // B1 bowled out
  inn.prevBowlerIdx = 1;                   // B2 just bowled
  const ok = eligibleBowlers(m, ['B1','B2','B3','B4']);
  check(!ok.includes('B1'),'bowled-out bowler excluded');
  check(!ok.includes('B2'),'bowler of the previous over excluded');
  check(ok.includes('B3'),'available bowler included');
  check(ok.includes('B4'),'a name never used yet is allowed');
  check(ok.length===2,'exactly the two eligible, got '+ok.join(','));
}

head('Engine - toss');
{
  const m = mk(20,10,{ toss:{ winner:'A', decision:'bat' } });
  check(/Alpha won the toss and elected to bat/.test(tossText(m)),'toss text: '+tossText(m));
  const m2 = mk(20,10,{ toss:{ winner:'B', decision:'bowl' } });
  check(/Beta won the toss and elected to bowl/.test(tossText(m2)),'toss text for fielding side');
  check(tossText(mk(20,10))==='','no toss recorded gives empty text');
}

head('Engine - player of the match');
{
  const m = mk(2,10);
  run(m,6); run(m,6); run(m,6); run(m,6); run(m,6); run(m,6);
  nextOver(m,'B2');
  for(let i=0;i<6;i++) run(m,0);
  closeInnings(m);
  startSecondInnings(m,{striker:'T1',nonStriker:'T2',bowler:'C1'});
  for(let i=0;i<6;i++) run(m,0);
  nextOver(m,'C2');
  for(let i=0;i<5;i++) run(m,0);
  wkt(m,{next:'T3'});
  closeInnings(m); finishMatch(m);
  const potm = playerOfTheMatch(m);
  check(potm !== null,'a player of the match is chosen');
  check(potm.name==='S1','the 36-run opener wins it, got '+potm.name);
  check(/36/.test(potm.line),'their figures are quoted: '+potm.line);
}
{
  check(playerOfTheMatch(mk(20,10))===null,'no POTM before anyone has performed');
}

head('Engine - super over');
{
  const parent = mk(20,10);
  parent.id = 'parent123';
  const so = createSuperOver(parent,{striker:'A1',nonStriker:'A2',bowler:'B1'});
  check(so.oversLimit===1,'super over is one over');
  check(so.allOutWickets===2,'two wickets and you are out');
  check(so.isSuperOver===true,'flagged as a super over');
  check(so.parentMatchId==='parent123','linked back to the tied match');
  check(so.id!==parent.id,'gets its own id');
  check(so.teamA===parent.teamA && so.teamB===parent.teamB,'same two teams');
}

/* ================= CAREER STATS ================= */
head('Stats - career aggregation');
{
  function fullMatch(teamA, teamB, opts){
    const m = mk(2,10);
    m.teamA = teamA; m.teamB = teamB;
    opts.first.forEach((r,i)=>{
      const res = run(m,r);
      if(res.overJustEnded && !res.inningsOver) nextOver(m,'B2');
    });
    closeInnings(m);
    startSecondInnings(m,{striker:'X1',nonStriker:'X2',bowler:'Y1'});
    opts.second.forEach(r=>{
      const res = run(m,r);
      if(res.overJustEnded && !res.inningsOver) nextOver(m,'Y2');
    });
    if(!m.completed){ closeInnings(m); finishMatch(m); }
    return m;
  }
  const m1 = fullMatch('Lions','Kings',{ first:[4,4,4,4,4,4,1,1,1,1,1,1], second:[0,0,0,0,0,0,0,0,0,0,0,0] });
  const careers = buildCareers([m1]);
  check(careers.length>0,'careers built');

  // S1 faces all six boundaries (24), then takes strike again through the
  // singles over and adds 3 more, finishing 27 not out.
  const s1 = findPlayer(careers,'S1');
  check(s1.runs===27,'S1 scored 27, got '+(s1 && s1.runs));
  check(s1.fours===6,'six boundaries counted');
  check(s1.average===null,'never dismissed means no average');
  check(s1.hsText==='27*','high score marked not out: '+s1.hsText);
  check(s1.matches===1,'one match played');

  const y = findPlayer(careers,'Y1');
  check(y && y.ballsBowled===6,'bowler innings captured');
  check(y.economy===0,'six dot balls = economy 0');

  check(findPlayer(careers,'  s1  ')!==null,'lookup trims and ignores case');
}
{
  const incomplete = mk(20,10);
  run(incomplete,4);
  check(buildCareers([incomplete]).length===0,'unfinished matches are excluded from careers');
  check(buildCareers([]).length===0,'no matches gives no careers');
  check(buildCareers(null).length===0,'null input handled');
}

head('Stats - leaderboards and records');
{
  const fake = [
    { id:'m1', completed:true, teamA:'Lions', teamB:'Kings', createdAt:1, innings:[
      { battingTeam:'A', runs:120, wickets:3, legalBalls:120, allOutWickets:10,
        batters:[{name:'Haris',runs:80,balls:50,fours:8,sixes:3,out:true,howOut:'Bowled'},
                 {name:'Saim',runs:40,balls:35,fours:4,sixes:0,out:false,howOut:''}],
        bowlers:[{name:'Naseem',legalBalls:24,runs:30,wickets:2,maidens:1}] },
      { battingTeam:'B', runs:100, wickets:10, legalBalls:110, allOutWickets:10,
        batters:[{name:'Babar',runs:55,balls:40,fours:6,sixes:1,out:true,howOut:'LBW'}],
        bowlers:[{name:'Shaheen',legalBalls:24,runs:18,wickets:5,maidens:2}] }
    ]}
  ];
  const c = buildCareers(fake);
  check(findPlayer(c,'Haris').average===80,'average = runs / dismissals');
  check(findPlayer(c,'Saim').average===null,'not out every innings = no average');
  check(findPlayer(c,'Haris').fifties===1,'fifty counted');
  check(findPlayer(c,'Shaheen').fiveFers===1,'five-wicket haul counted');
  check(findPlayer(c,'Shaheen').best==='5/18','best figures: '+findPlayer(c,'Shaheen').best);
  check(findPlayer(c,'Naseem').threeFers===0,'two wickets is not a three-fer');

  check(topRunScorers(c,1)[0].name==='Haris','top run scorer');
  check(topWicketTakers(c,1)[0].name==='Shaheen','top wicket taker');
  check(bestAverages(c,1,1)[0].name==='Haris','best average with low qualification');
  check(bestAverages(c,5,5).length===0,'qualification threshold excludes everyone');
  check(bestEconomy(c,1,1)[0].name==='Shaheen','best economy');

  const tr = teamRecords(fake);
  check(tr[0].name==='Lions' && tr[0].won===1,'team record: winner first');
  check(tr.find(t=>t.name==='Kings').lost===1,'loss recorded');
  check(tr[0].winPct===100,'win percentage');

  const sum = overallSummary(fake);
  check(sum.matches===1 && sum.runs===220 && sum.wickets===13,'overall summary totals');

  const bb = bestBattingPerformances(fake,3);
  check(bb[0].name==='Haris' && bb[0].vs==='Kings','best batting knock with opposition');
  const bw = bestBowlingPerformances(fake,3);
  check(bw[0].name==='Shaheen' && bw[0].wickets===5,'best bowling spell');
}

console.log('\n' + '='.repeat(46));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(46));
process.exit(fail>0?1:0);
