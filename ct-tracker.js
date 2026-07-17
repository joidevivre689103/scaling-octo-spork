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
  var FLUSH_MS        = 15000;              // batch flush cadence
  var MAX_BATCH       = 30;

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
  var idToken = null;
  var identifiedSent = false;
  function refreshToken() {
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return firebase.auth().currentUser.getIdToken()
          .then(function(t){ idToken = t; return t; }).catch(function(){});
      }
    } catch (e) {}
    return Promise.resolve(null);
  }
  function setupAuth() {
    try {
      firebase.auth().onAuthStateChanged(function (user) {
        if (user) {
          refreshToken();
          if (!identifiedSent) { identifiedSent = true; queue({ event_type: 'identify' }); }
        } else { idToken = null; }
      });
      setInterval(refreshToken, 30 * 60 * 1000); // refresh well within the 1h token life
    } catch (e) {}
  }
  // Load-order independent: this tracker may be injected before the Firebase
  // SDK finishes loading. Poll briefly for it, then wire up auth. Until then,
  // events queue and the first flush (15s) carries the token once auth resolves
  // (which normally happens in <1s), so even the initial page_view is attributed.
  (function waitForFirebase(tries) {
    tries = tries || 0;
    try { if (window.firebase && firebase.auth) { setupAuth(); return; } } catch (e) {}
    if (tries < 100) setTimeout(function(){ waitForFirebase(tries + 1); }, 100); // up to ~10s
  })();

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
    // NOTE: no uid, no email. The server derives uid from the ID token.
    batch.push(ev);
    if (batch.length >= MAX_BATCH) flush(false);
  }
  function flush(useBeacon) {
    if (!batch.length) return;
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
  setInterval(function(){ flush(false); }, FLUSH_MS);

  // ------------------------------------------------------------- page views ---
  var currentPageViewId = null;
  function trackPageView(isSpaNav) {
    touchSession();
    var sid = getSession();
    currentPageViewId = uuid();
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
  function isActive(){ return document.visibilityState === 'visible' && document.hasFocus(); }
  setInterval(function () {
    var now = Date.now();
    if (isActive()) {
      activeMsUnsent += (now - lastTick);
      touchSession();
      if (activeMsUnsent >= HEARTBEAT_MS && currentPageViewId) {
        queue({ event_type:'heartbeat', page_view_id: currentPageViewId, active_ms_delta: activeMsUnsent,
                content_section: meta('ct:section') || sectionFromPath() });
        activeMsUnsent = 0;
      }
    }
    lastTick = now;
  }, 1000);

  function flushActive(useBeacon) {
    if (activeMsUnsent > 0 && currentPageViewId) {
      queue({ event_type:'heartbeat', page_view_id: currentPageViewId, active_ms_delta: activeMsUnsent,
              content_section: meta('ct:section') || sectionFromPath() });
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
  function start(){ refreshToken(); trackPageView(false); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
