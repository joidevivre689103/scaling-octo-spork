/*
 * Cricket Times — engagement tracker (ct-tracker.js) — FIREBASE-ONLY build
 * =======================================================================
 * First-party tracker for signed-in subscribers. Captures:
 *   • page views (incl. SPA route changes)
 *   • ACTIVE time on page (visibility-aware heartbeat — not wall-clock)
 *   • sessions (30-min inactivity + local-midnight cutoff)
 *
 * Posts batched events to the `collectEngagement` Cloud Function. Identity is
 * proven by the Firebase ID token in the payload (the function verifies it and
 * ignores any client-claimed uid), so no email or PII is ever sent — just the
 * token, which the function exchanges for the uid server-side.
 *
 * LOAD ORDER: after firebase-app + firebase-auth are initialised, on every
 * reader page. Safe on pages where nobody is signed in (events then count only
 * in the anonymous aggregate).
 *
 * CONFIG:
 *   COLLECT_URL — set to the deployed collectEngagement URL (printed on deploy;
 *                 looks like https://us-central1-hitwicket-cba02.cloudfunctions.net/collectEngagement).
 *   Optional per-page enrichment:
 *     <meta name="ct:section"    content="Match Report">
 *     <meta name="ct:content-id" content="match-2026-ind-aus-3rd-test">
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config ---
  var COLLECT_URL     = 'https://us-central1-hitwicket-cba02.cloudfunctions.net/collectEngagement';
  var HEARTBEAT_MS    = 15000;              // active-time tick
  var SESSION_TIMEOUT = 30 * 60 * 1000;     // 30-min inactivity ends a session
  var IDLE_TIMEOUT    = 180 * 1000;         // 180s with no real interaction = idle: active time
                                            // stops accruing and the session stops being touched,
                                            // even if the tab is still foreground+focused. Distinct
                                            // from SESSION_TIMEOUT: idle pauses accrual; 30min of
                                            // that idleness (measured from the last touch) rotates
                                            // the session id on the next interaction.
  var FLUSH_MS        = 15000;              // batch flush cadence
  var MAX_BATCH       = 30;
  var AUTH_WAIT_MS    = 4000;               // if Firebase never reports (static page, blocked
                                            // SDK), stop holding events after this and send anon
  var PENDING_KEY     = 'ct_pending';       // events carried to the next page when we unload
                                            // before identity is known — see flush()/replayPending()

  // ------------------------------------------------------------- utilities ---
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function lsSet(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
  function lsDel(k){ try { localStorage.removeItem(k); } catch(e){} }
  function meta(name){ var el = document.querySelector('meta[name="'+name+'"]'); return el ? el.content : null; }
  function localDate(){ // YYYY-MM-DD in the user's local timezone
    var d = new Date(), p = function(n){ return (n<10?'0':'')+n; };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
  }
  function sectionFromPath() {
    var seg = (location.pathname.split('/').filter(Boolean)[0] || 'home')
                .replace(/\.html?$/,'').replace(/[-_]/g,' ');
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  }

  // -------------------------------------------------------------- identity ---
  // The Firebase ID token proves who the user is. We cache it and refresh
  // periodically; the token (not email/uid) travels with each flush.
  // Cricket Times standardized on the MODULAR Firebase SDK (10.12.5), so there
  // is usually NO window.firebase (compat) global on reader pages. We reuse the
  // page's already-initialized modular app via getApp() and read the ID token
  // from there. A compat fallback is kept for any page still on the old global.
  // The verified token (never email/uid) is what travels with each flush.
  var idToken = null;
  var identifiedSent = false;
  // Identity travels per-BATCH (flush sends one idToken for all events in it),
  // and idToken is populated ASYNCHRONOUSLY once onIdTokenChanged fires. Any
  // flush before that lands is attributed to the anonymous aggregate. That is
  // survivable for page_views and heartbeats (re-emitted on every page and
  // every 15s, so later flushes carry the token) but FATAL for session_start,
  // which is emitted exactly once per session on the FIRST page. If that first
  // page unloads inside the auth window — the classic login-page bounce after a
  // fresh sign-in — the session_start beacons out tokenless and the session is
  // filed as anonymous, never against the user. `authResolved` closes that
  // window: no batch flushes until identity is known (a real token, or a
  // definitive signed-out), and the once-per-session event waits for it.
  var authResolved = false;
  // Firebase modular SDK URLs — pinned to 10.12.5 to match Cricket Times'
  // per-file SDK pinning. The literal "firebasejs/10.12.5" strings below mean
  // the standard `grep firebasejs/X.Y.Z` bump sweep catches THIS file too, so
  // the tracker stays in lockstep with every other SDK-importing file on a bump.
  var FB_APP_URL  = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
  var FB_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

  function onUser(user) {
    if (user) {
      // Resolve AFTER the token is in hand, not merely when a user appears —
      // otherwise the drain would still race an unset idToken.
      user.getIdToken().then(function (t) { idToken = t; markAuthResolved(); })
                       .catch(function () { markAuthResolved(); }); // token fetch failed; don't hang
      if (!identifiedSent) { identifiedSent = true; queue({ event_type: 'identify' }); }
    } else {
      idToken = null;
      markAuthResolved();   // definitively signed out — anonymous attribution is correct here
    }
  }

  // Identity is now known (token in hand, or known-anonymous). Release anything
  // buffered during the pre-auth window so it flushes WITH the right identity.
  // Safe to call more than once (token refreshes re-enter here); a flush with an
  // empty batch is a no-op.
  function markAuthResolved() {
    authResolved = true;
    flush(false);
  }

  // Path A — compat SDK (window.firebase), if a page happens to expose it.
  function tryCompat() {
    try {
      if (window.firebase && firebase.auth) {
        firebase.auth().onIdTokenChanged(onUser);   // fires now + on refresh/sign-in/out
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Path B — modular SDK. Dynamically import the SAME version the page uses so
  // we share its module instance and getApp() sees the already-initialized app.
  // (ES module imports are cached by URL, so this reuses the page's Firebase.)
  function tryModular() {
    return import(FB_APP_URL).then(function (appMod) {
      var app;
      try { app = appMod.getApp(); } catch (e) { return false; }   // app not initialized yet
      return import(FB_AUTH_URL).then(function (authMod) {
        authMod.onIdTokenChanged(authMod.getAuth(app), onUser);
        return true;
      });
    }).catch(function () { return false; });
  }

  // Try compat immediately; otherwise poll for the modular app to appear
  // (it's initialized by an ES-module <script> which may run after us).
  (function initAuth(tries) {
    tries = tries || 0;
    if (tryCompat()) return;
    tryModular().then(function (ok) {
      if (ok) return;
      if (tries < 100) setTimeout(function () { initAuth(tries + 1); }, 100); // up to ~10s
    });
  })();

  // Backstop: on a page where Firebase never reports (no SDK, blocked, or the
  // app is never initialised) onIdTokenChanged won't fire, so nothing would
  // ever resolve and the buffer would hold forever. Release it as anonymous
  // after AUTH_WAIT_MS. On a normal signed-in page auth resolves in well under
  // a second, so this timer never gets the chance to fire.
  setTimeout(function () { if (!authResolved) markAuthResolved(); }, AUTH_WAIT_MS);

  // --------------------------------------------------------------- session ---
  function getSession() {
    var now = Date.now();
    var sid = lsGet('ct_sid');
    var last = parseInt(lsGet('ct_sid_last') || '0', 10);
    var day = lsGet('ct_sid_day');
    var today = new Date().toDateString();
    if (!sid || (now - last) > SESSION_TIMEOUT || day !== today) {
      sid = uuid();
      lsSet('ct_sid', sid);
      lsSet('ct_sid_day', today);
      lsSet('ct_sid_last', String(now));
      queue({ event_type: 'session_start', session_id: sid });
    }
    return sid;
  }
  function touchSession() { lsSet('ct_sid_last', String(Date.now())); }

  // ------------------------------------------------------------ event queue ---
  var batch = [];
  function queue(ev) {
    ev.event_id   = ev.event_id   || uuid();
    ev.ts         = ev.ts         || new Date().toISOString();
    ev.local_date = ev.local_date || localDate();
    ev.session_id = ev.session_id || lsGet('ct_sid');
    // Stamp the last REAL interaction time so the server can separate genuine
    // engagement from the idle-grace tail: an event fired during the 180s grace
    // carries the (older) last-interaction ts, so the server sees the gap
    // between last interaction and last activity as grace, not engagement.
    // lastInteraction is hoisted (declared in the heartbeat section) and set
    // before any queue() call; the guard covers the pre-init instant.
    ev.last_interaction_ts = ev.last_interaction_ts ||
      new Date((typeof lastInteraction === 'number' ? lastInteraction : Date.now())).toISOString();
    // NOTE: no uid, no email. The server derives uid from the ID token.
    batch.push(ev);
    if (batch.length >= MAX_BATCH) flush(false);
  }
  function flush(useBeacon) {
    if (!batch.length) return;
    if (!authResolved) {
      // Identity unknown. A normal flush simply holds — the buffer waits for
      // markAuthResolved(). But an unload can't wait: rather than beacon these
      // events tokenless (which is exactly how session_start was being filed as
      // anonymous), persist the batch and let the next page replay it once its
      // auth is warm. The session is deferred, never lost, never misattributed.
      if (useBeacon) {
        try { lsSet(PENDING_KEY, JSON.stringify(batch)); } catch (e) {}
        batch = [];
      }
      return;
    }
    var payload = JSON.stringify({ events: batch, idToken: idToken });
    batch = [];
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(COLLECT_URL, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(COLLECT_URL, { method:'POST', body:payload, keepalive:true,
                             headers:{'Content-Type':'application/json'} });
      }
    } catch (e) { /* never let analytics break the page */ }
  }

  // Pull any events a previous page persisted on an unresolved unload and put
  // them at the front of this page's batch. Cleared BEFORE parsing so a crash
  // mid-replay can't cause a double-send (the collector counts every event, it
  // does not dedupe). These ride out on this page's flush once auth resolves.
  function replayPending() {
    var raw = lsGet(PENDING_KEY);
    if (!raw) return;
    lsDel(PENDING_KEY);
    try {
      var evs = JSON.parse(raw);
      if (evs && evs.length) batch = evs.concat(batch);
    } catch (e) { /* corrupt buffer — drop it */ }
  }
  setInterval(function(){ flush(false); }, FLUSH_MS);

  // ------------------------------------------------------------- page views ---
  var currentPageViewId = null;
  var currentPagePath = null;   // path of the current page_view, stamped onto its
                                // heartbeats so the server can attribute dwell time per page
  function trackPageView(isSpaNav) {
    touchSession();
    var sid = getSession();
    currentPageViewId = uuid();
    currentPagePath = location.pathname;
    activeMsUnsent = 0;
    queue({
      event_type:      'page_view',
      session_id:      sid,
      page_view_id:    currentPageViewId,
      url_path:        location.pathname,
      title:           document.title,
      referrer:        document.referrer || null,
      content_section: meta('ct:section') || sectionFromPath(),
      content_id:      meta('ct:content-id') || null,
      is_spa_nav:      !!isSpaNav
    });
  }
  ['pushState','replaceState'].forEach(function (fn) {
    var orig = history[fn];
    history[fn] = function () { var r = orig.apply(this, arguments); window.dispatchEvent(new Event('ct:locationchange')); return r; };
  });
  window.addEventListener('popstate', function(){ window.dispatchEvent(new Event('ct:locationchange')); });
  var lastPath = location.pathname;
  window.addEventListener('ct:locationchange', function () {
    if (location.pathname !== lastPath) { lastPath = location.pathname; trackPageView(true); }
  });

  // ------------------------------------------------ active-time heartbeat ----
  var activeMsUnsent = 0;
  var lastTick = Date.now();

  // Real-interaction clock. Without this, isActive() was true for any foreground
  // focused tab — so an article left open on screen counted every idle second as
  // engagement and never timed out (the 30-min rule only bites when the tab is
  // backgrounded or blurred, because only then do the heartbeat touches stop).
  // We now also require interaction within IDLE_TIMEOUT. Reading isn't clicking,
  // so the 180s window is deliberately generous — a long reading pause still
  // counts; only genuine abandonment goes idle.
  var lastInteraction = Date.now();
  function markInteraction(){ lastInteraction = Date.now(); }
  // passive:true — these listeners never call preventDefault, so this keeps
  // scroll/touch off the main-thread blocking path.
  ['mousemove','mousedown','keydown','scroll','touchstart','click','wheel','pointerdown'].forEach(function (evt) {
    window.addEventListener(evt, markInteraction, { passive: true, capture: true });
  });

  function isActive(){
    return document.visibilityState === 'visible'
        && document.hasFocus()
        && (Date.now() - lastInteraction) < IDLE_TIMEOUT;
  }
  setInterval(function () {
    var now = Date.now();
    if (isActive()) {
      activeMsUnsent += (now - lastTick);
      touchSession();
      if (activeMsUnsent >= HEARTBEAT_MS && currentPageViewId) {
        queue({ event_type:'heartbeat', page_view_id: currentPageViewId, active_ms_delta: activeMsUnsent,
                url_path: currentPagePath, content_section: meta('ct:section') || sectionFromPath() });
        activeMsUnsent = 0;
      }
    }
    lastTick = now;
  }, 1000);

  function flushActive(useBeacon) {
    if (activeMsUnsent > 0 && currentPageViewId) {
      queue({ event_type:'heartbeat', page_view_id: currentPageViewId, active_ms_delta: activeMsUnsent,
              url_path: currentPagePath, content_section: meta('ct:section') || sectionFromPath() });
      activeMsUnsent = 0;
    }
    flush(useBeacon);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushActive(true);
    else lastTick = Date.now();
  });
  window.addEventListener('pagehide', function(){ flushActive(true); });

  // ------------------------------------------------------------- kickoff -----
  function start(){ replayPending(); trackPageView(false); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
