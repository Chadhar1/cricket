/* ===========================================================================
   broadcast-events.js — turns the existing scoring engine's output into the
   typed events a broadcast overlay needs: FOUR, SIX, WICKET, FIFTY, CENTURY,
   WIDE, NO_BALL, OVER_COMPLETE, INNINGS_COMPLETE, MATCH_COMPLETE.

   This file has zero knowledge of canvas, video, or recording — it only
   looks at data engine.js already produces from a single playBall() call
   (read from the OUTSIDE, at the call sites in app.js that already call
   playBall() — engine.js itself is never modified). That keeps this the
   "Event Adapter" layer of the recording feature's architecture:

     Scoring Engine -> Event Adapter (this file) -> Broadcast Overlay
     Renderer (overlays.js) -> Video Compositor (recorder.js)

   so the same event stream could feed a live-streaming overlay later
   without this file, or engine.js, changing at all.

   Publish/subscribe rather than a hard call into the recorder: app.js
   reports every ball unconditionally (reportBallEvents is cheap and a
   no-op with nothing subscribed), and recorder.js only subscribes for the
   duration of an actual recording. Neither side needs to know whether the
   other is active.
   =========================================================================== */

const listeners = [];

export function onBroadcastEvent(fn){
  listeners.push(fn);
  return ()=>{ const i = listeners.indexOf(fn); if(i >= 0) listeners.splice(i, 1); };
}

function emit(evt){
  if(!evt) return;
  listeners.forEach(fn=>{
    try{ fn(evt); }catch(err){ console.error('broadcast event listener failed:', err); }
  });
}

/* ctx = {
     ball,             // the same object passed into playBall()
     res,              // playBall()'s return value
     strikerName,      // name of whoever faced this specific ball
     strikerRunsBefore, strikerRunsAfter   // that same batter's total, before/after this ball
   }
   Called once per delivery, straight after playBall() returns — see the
   three call sites in app.js (doRun, submitWicket, extra-run) for how
   strikerRunsBefore/strikerName are captured (a reference to the batter
   object grabbed *before* calling playBall(), since it mutates in place). */
export function deriveBallEvents(ctx){
  const { ball, res, strikerName, strikerRunsBefore, strikerRunsAfter, dismissedName } = ctx;
  const events = [];
  if(!ball || !res) return events;

  // effectiveWicket, mirrored from engine.js's own logic: a wicket that
  // wasn't rejected as an illegal dismissal for this delivery.
  const isWicket = !!(ball.isWicket && !res.wicketRejected);

  if(isWicket){
    events.push({ type:'WICKET', player: dismissedName || strikerName, dismissal: ball.wicketType || null });
  } else if(!ball.extra){
    if(ball.batRuns === 4) events.push({ type:'FOUR', player: strikerName });
    else if(ball.batRuns === 6) events.push({ type:'SIX', player: strikerName });
  }

  if(ball.extra === 'wd') events.push({ type:'WIDE' });
  if(ball.extra === 'nb') events.push({ type:'NO_BALL' });

  // Milestones fire exactly once, on the ball that crosses the line —
  // never re-fired on later balls once the batter is already past it.
  if(typeof strikerRunsBefore === 'number' && typeof strikerRunsAfter === 'number'){
    if(strikerRunsBefore < 100 && strikerRunsAfter >= 100) events.push({ type:'CENTURY', player: strikerName });
    else if(strikerRunsBefore < 50 && strikerRunsAfter >= 50) events.push({ type:'FIFTY', player: strikerName });
  }

  if(res.overJustEnded) events.push({ type:'OVER_COMPLETE' });
  if(res.inningsOver) events.push({ type:'INNINGS_COMPLETE' });

  return events;
}

export function reportBallEvents(ctx){
  deriveBallEvents(ctx).forEach(emit);
}

export function reportMatchComplete(match){
  emit({ type:'MATCH_COMPLETE', resultText: match.resultText || '', resultSub: match.resultSub || '' });
}
