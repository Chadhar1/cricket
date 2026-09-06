/* ===========================================================================
   CricketConnect — real-logo brandmark swap
   ---------------------------------------------------------------------------
   Same technique already proven in the Capacitor app
   (cricket-connect-capacitor/native-src/brand-native.js), applied here so the
   web app / PWA / TWA show the real logo too instead of the inline SVG.

   WHAT PROBLEM THIS SOLVES
   ------------------------
   The app draws its emblem as an inline SVG built in avatars.js (brandMark(),
   a simplified "C swoosh + ball" with hardcoded fills), painted into ~14
   places by paintBrandMarks(). Those fills are baked into the markup, so CSS
   can't retheme them and the placeholder can never become the real logo art.

   Rather than edit avatars.js, this replaces the rendered mark in the DOM
   with the real logo PNG (icon-192.png, generated from the same official
   source image and crop box as the Capacitor build's cc-mark-192.png).

   HOW IT AVOIDS FIGHTING app.js
   -----------------------------
   paintBrandMarks() is guarded by `if(!el.dataset.painted)`. Setting our own
   content AND dataset.painted = '1' therefore makes app.js skip the element
   entirely on every subsequent render — no flicker, no tug of war, and no
   change to app.js required. Screens are re-rendered constantly, so a
   MutationObserver catches marks as they appear instead of running once.
   =========================================================================== */

(function () {
  'use strict';

  var LOGO = './icon-192.png';

  /* Containers whose contents are a brandmark. The first is app.js's own hook;
     .lockup-mark is the sign-in lockup (brandLockup() emits no data-brandmark
     attribute); #installMark is set directly by a one-off line in app.js. */
  var SELECTOR = '[data-brandmark], .lockup-mark, #installMark';

  /* Sizes app.js itself uses: brandMark(34) for the inline marks, brandMark(78)
     for the sign-in lockup. These are the fallbacks when we get to an element
     BEFORE app.js has painted an SVG into it — which is the normal case, since
     the MutationObserver fires the moment the node is inserted. Without a
     fallback the <img> would have no dimensions at all and collapse or stretch. */
  var DEFAULT_SIZE = 34;
  var LOCKUP_SIZE = 78;

  function swap(el) {
    if (!el || el.dataset.ccBranded === '1') return;

    var svg = el.querySelector('svg');
    var attr = svg && (svg.getAttribute('width') || svg.getAttribute('height'));
    var size = parseInt(attr, 10);
    if (!size || isNaN(size)) {
      size = el.classList && el.classList.contains('lockup-mark') ? LOCKUP_SIZE : DEFAULT_SIZE;
    }

    var img = document.createElement('img');
    img.src = LOGO;
    img.alt = 'Cricket Connect';
    img.className = 'cc-brand-img';
    img.width = size;
    img.height = size;
    img.style.width = size + 'px';
    img.style.height = size + 'px';
    img.style.borderRadius = Math.round(size * 0.225) + 'px';

    el.innerHTML = '';
    el.appendChild(img);

    el.dataset.ccBranded = '1';
    el.dataset.painted = '1';
  }

  function sweep(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var found = scope.querySelectorAll(SELECTOR);
    for (var i = 0; i < found.length; i++) swap(found[i]);
    if (root && root.matches && root.matches(SELECTOR)) swap(root);
  }

  function start() {
    sweep(document);

    if (!window.MutationObserver) return;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) sweep(added[j]);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
