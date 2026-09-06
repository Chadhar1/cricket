/* ===========================================================================
   Six / Four / Wicket flash-pop
   ---------------------------------------------------------------------------
   Shared between the scorer's own live screen (app.js calls this the instant
   a ball is recorded, from inside afterBall()) and the public live viewer
   (live.html has no direct scoring action to hook, so it calls this by
   diffing the latest ball on every realtime update instead). One module so
   both surfaces get the exact same look instead of drifting apart.
   =========================================================================== */

const CONFIG = {
  six:    { label: 'SIX!'  },
  four:   { label: 'FOUR!' },
  wicket: { label: 'OUT!'  },
};

let hideTimer = null;

export function showFlashPop(type){
  const cfg = CONFIG[type];
  if(!cfg) return;

  const prev = document.getElementById('scoreFlashPop');
  if(prev) prev.remove();
  if(hideTimer) clearTimeout(hideTimer);

  const wrap = document.createElement('div');
  wrap.id = 'scoreFlashPop';
  wrap.className = 'flash-pop flash-pop-' + type;
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<div class="flash-pop-burst"></div>' +
    '<div class="flash-pop-label">' + cfg.label + '</div>';
  document.body.appendChild(wrap);

  hideTimer = setTimeout(()=>{ wrap.remove(); hideTimer = null; }, 1300);
}

/* Ball-diffing helper for pages (live.html) that only receive data updates
   rather than firing the scoring action themselves. Call once per render
   with the current innings; it tracks its own "have we seen this ball
   already" state internally so callers don't need to. Never flashes on the
   very first call (page load / first snapshot), only on genuine changes
   after that. */
let lastBallSig = null;
export function checkBallForFlash(inn){
  if(!inn) return;
  const balls = inn.thisOverBalls || [];
  const last = balls[balls.length - 1];
  const sig = inn.legalBalls + ':' + inn.wickets + ':' + balls.length + ':' + (last ? last.txt : '');
  const isFirstCall = lastBallSig === null;
  if(sig === lastBallSig) return;
  lastBallSig = sig;
  if(isFirstCall || !last) return;

  if(last.wicket) showFlashPop('wicket');
  else if(last.six) showFlashPop('six');
  else if(last.four) showFlashPop('four');
}
