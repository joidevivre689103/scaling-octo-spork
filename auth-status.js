/* ============================================================================
 * auth-status.js — site-wide auth-status pill + sign-in recorder
 *
 * [2026-07-25] THIS FILE NOW OWNS THE `logins` COLLECTION.
 * ------------------------------------------------------------------------
 * The admin panel's Login History tab reads logins/{autoId} = {email, page,
 * timestamp}. Nothing had written that collection since 2026-03-09 — the write
 * lived in whatever ran before the ct-tracker/auth-status split, and when the
 * engagement pipeline replaced it the sign-in half was never carried across.
 * ct-tracker.js measures ENGAGEMENT (page views, active time, sessions) and
 * deliberately sends no identity — only an ID token the function exchanges
 * server-side — so it is the wrong place for an email-keyed audit trail.
 *
 * This file is the right place: it already runs on every gated page, already
 * subscribes to onAuthStateChanged, and already knows the email. See
 * recordLogin() for the dedupe rule — onAuthStateChanged fires on EVERY page
 * load for a persisted session, so an unguarded write would log a "sign-in"
 * per page view and the collection would be page views wearing the wrong name.
 *
 * REQUIRES a Firestore rule allowing authenticated create on /logins. Without
 * it every write fails permission-denied — caught and logged, never fatal.
 * ------------------------------------------------------------------------
 *
 * A small fixed top-right "email · Sign out" / "Sign in" control, mirroring
 * bts.html's user-pill, so login state is visible and switchable from any page
 * it's included on. Extracted from feature-flags.js (2026-06-02) to keep the
 * access-control core free of presentation code — this is pure UI.
 *
 * INCLUSION CONTROLS PLACEMENT. The widget renders on whatever page loads this
 * script. The 7-G deploy-tool injection stamps it onto the gated surface; add
 * a plain <script src="/auth-status.js"></script> to any exception page (e.g.
 * index.html) that should also show it.
 *
 * Self-contained:
 *   - Reuses window.CTFeatureFlags.firebaseReady when present (gated pages);
 *     otherwise inits its own Firebase app (getApps-guarded, same project) so
 *     it works standalone on pages that don't load feature-flags.js.
 *   - Injects its own scoped styles; hardcodes the typewriter palette so it
 *     never depends on the host page's CSS variables.
 *   - Skips if the page already has its own #userPill (bts) — no double pill.
 *   - Opt out on any page with `window.CT_NO_AUTH_WIDGET = true`.
 * ========================================================================== */
(function () {
  'use strict';

  // [2026-07-25] Re-entry guard only. The three checks that used to live here
  // as bare `return`s (CT_NO_AUTH_WIDGET, an existing #userPill, an already-
  // mounted #ct-auth-status) all decide whether to draw the PILL — and they
  // now gate rendering alone, in shouldRenderPill(). They must not gate the
  // sign-in recorder: bts.html has its own #userPill, so under the old
  // structure this script bailed out entirely there and every bts sign-in
  // would have gone unrecorded. Suppressing a UI widget is not a request to
  // stop keeping the audit trail.
  //
  // A second benefit of moving them: they now run after the body exists.
  // getElementById('userPill') at script-eval time returns null for a
  // <head>-loaded script no matter what the page contains, so the "page has
  // its own pill" check only ever worked by accident of load position.
  if (window.__ctAuthStatusLoaded) return;
  window.__ctAuthStatusLoaded = true;

  function shouldRenderPill() {
    if (window.CT_NO_AUTH_WIDGET) return false;
    if (document.getElementById('userPill')) return false;  // page has its own (bts)
    return true;
  }

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.5/';
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBnfn9hK0y-p6nvIZ_AwoJnWD7DfDuIQd4',
    authDomain: 'hitwicket-cba02.firebaseapp.com',
    projectId: 'hitwicket-cba02',
    storageBucket: 'hitwicket-cba02.firebasestorage.app',
    messagingSenderId: '196915483829',
    appId: '1:196915483829:web:071c47af79914aec88dafc'
  };

  // Resolve the Firebase app: reuse feature-flags.js's if it's on the page,
  // else init our own (getApps-guarded, so it coexists with any other init).
  async function resolveApp() {
    if (window.CTFeatureFlags && window.CTFeatureFlags.firebaseReady) {
      return window.CTFeatureFlags.firebaseReady;
    }
    var m = await import(SDK + 'firebase-app.js');
    return m.getApps().length ? m.getApp() : m.initializeApp(FIREBASE_CONFIG);
  }

  function injectStyles() {
    if (document.getElementById('ct-auth-status-style')) return;
    var st = document.createElement('style');
    st.id = 'ct-auth-status-style';
    st.textContent =
      '#ct-auth-status{position:fixed;top:14px;right:18px;z-index:9999;' +
      "font-family:'Special Elite','Courier New',monospace;font-size:16px;color:#1a1612;" +
      'display:flex;gap:10px;align-items:center;background:rgba(250,245,233,0.92);' +
      'padding:6px 10px;border-radius:3px}' +
      '#ct-auth-status a,#ct-auth-status button{font-family:inherit;font-size:13px;' +
      'letter-spacing:0.15em;text-transform:uppercase;padding:5px 12px;border-radius:2px;' +
      'border:1px solid #c9bda5;color:#1a1612;background:none;cursor:pointer;text-decoration:none}' +
      '#ct-auth-status a:hover,#ct-auth-status button:hover{background:#1a1612;color:#faf5e9;border-color:#1a1612}';
    document.head.appendChild(st);
  }

  function mount() {
    var el = document.getElementById('ct-auth-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ct-auth-status';
      document.body.appendChild(el);
    }
    return el;
  }

  function render(user, auth, signOut) {
    var el = mount();
    el.textContent = '';                                  // clear; never innerHTML w/ user data
    if (user) {
      var span = document.createElement('span');
      span.textContent = user.email || '(signed in)';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Sign out';
      btn.addEventListener('click', function () {
        // [2026-06-04] Sign-out lands on the homepage ('/'), not a reload of
        // the current page. Rationale: reloading a PAID page post-sign-out
        // bounced the user to the login screen (correct gating, hostile UX —
        // it reads like an error). '/' is deliberately not '/stories.html':
        // the root always means "the homepage, whatever that is today," so
        // this survives stories.html becoming the index at launch with zero
        // rework. location.replace so Back doesn't return to a gated page
        // as a ghost.
        // [2026-07-25] Clear the sign-in marker synchronously, here, as well as
        // in the onAuthStateChanged(null) branch. The navigation below can win
        // the race against that callback, and a marker that survives a sign-out
        // would suppress the NEXT sign-in's log entry for up to 30 minutes.
        markerClear();
        signOut(auth).then(function () { location.replace('/'); })
                     .catch(function () { location.replace('/'); });
      });
      el.appendChild(span);
      el.appendChild(btn);
    } else {
      var a = document.createElement('a');
      a.textContent = 'Sign in';
      a.href = '/login.html?returnUrl=' + encodeURIComponent(location.pathname + location.search);
      el.appendChild(a);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * SIGN-IN RECORDER — writes logins/{autoId} = {email, page, timestamp}
   * ══════════════════════════════════════════════════════════════════════
   * THE DEDUPE RULE IS THE WHOLE DESIGN. onAuthStateChanged does not mean
   * "this user just signed in" — it fires on every page load for an already-
   * persisted session, and again on token refresh. Writing on each emission
   * would produce one doc per page view, i.e. a page-view log mislabelled as a
   * login log, which is a worse failure than the empty collection we started
   * with because it looks plausible.
   *
   * What counts as a new sign-in, then, is decided against a localStorage
   * marker holding {uid, ts}:
   *
   *   uid differs from the marker  → a different person, or a real sign-in
   *                                  after a sign-out cleared it. RECORD.
   *   marker older than RELOGIN_WINDOW_MS → the previous visit ended and a new
   *                                  one began. RECORD. The window matches
   *                                  ct-tracker.js's 30-minute SESSION_TIMEOUT
   *                                  on purpose, so "sessions" in the analytics
   *                                  tab and "sign-ins" here divide time the
   *                                  same way and the two tabs stay comparable.
   *   otherwise                    → same person, same visit. SKIP.
   *
   * localStorage, not sessionStorage: sessionStorage is per-TAB, so opening
   * three articles in three tabs would log three sign-ins for one person on one
   * visit. The marker must be shared across tabs of the same browser profile.
   *
   * Sign-out clears the marker, so signing out and back in always records —
   * that IS a new sign-in however fast it happens.
   *
   * The marker is refreshed on every emission within the window (a rolling
   * touch, same as the tracker's touchSession) so a long reading session never
   * accumulates a spurious second entry at the 30-minute mark.
   *
   * Failure is always silent-but-logged. A missing Firestore rule, an offline
   * device, a blocked SDK — none of it may break the page or the pill.
   */
  var LOGIN_MARKER_KEY   = 'ct_login_marker';
  var RELOGIN_WINDOW_MS  = 30 * 60 * 1000;   // matches ct-tracker.js SESSION_TIMEOUT

  function markerGet() {
    try {
      var raw = localStorage.getItem(LOGIN_MARKER_KEY);
      if (!raw) return null;
      var m = JSON.parse(raw);
      return (m && m.uid) ? m : null;
    } catch (e) { return null; }   // corrupt or storage-denied → treat as absent
  }
  function markerSet(uid) {
    try { localStorage.setItem(LOGIN_MARKER_KEY, JSON.stringify({ uid: uid, ts: Date.now() })); }
    catch (e) {}
  }
  function markerClear() {
    try { localStorage.removeItem(LOGIN_MARKER_KEY); } catch (e) {}
  }

  // Decide, and refresh the marker as a side effect. Returns true exactly once
  // per sign-in as defined above.
  function isNewSignIn(uid) {
    var m = markerGet();
    var fresh = !m || m.uid !== uid || (Date.now() - (m.ts || 0)) > RELOGIN_WINDOW_MS;
    markerSet(uid);        // rolling touch on every emission, new or not
    return fresh;
  }

  // Firestore is imported lazily and ONLY when there is something to write, so
  // a signed-out visitor — or a signed-in one mid-visit — never pays for the
  // module. Cached because the marker can go stale mid-page on a long visit.
  var fsModPromise = null;
  function loadFirestore() {
    if (!fsModPromise) fsModPromise = import(SDK + 'firebase-firestore.js');
    return fsModPromise;
  }

  function recordLogin(app, user) {
    if (!user || !user.email) return;              // anonymous or emailless: nothing to key on
    if (!isNewSignIn(user.uid)) return;
    loadFirestore().then(function (fs) {
      // Field names and shape are fixed by the existing 71 documents and by
      // admin.html's reader — {email, page, timestamp}. Do not "improve" them
      // without migrating the historical docs; the table would go half-blank.
      // `page` is pathname only: no query string, so a returnUrl or a UTM tag
      // can never smuggle another user's address into the audit trail.
      return fs.addDoc(fs.collection(fs.getFirestore(app), 'logins'), {
        email: String(user.email).toLowerCase(),
        page: location.pathname,
        timestamp: fs.serverTimestamp()           // server clock: a device with a
                                                  // wrong date can't reorder the log
      });
    }).catch(function (e) {
      // Most likely cause by far is a missing/narrow Firestore rule on /logins.
      // Say so explicitly — a bare permission-denied here sent the last
      // investigation looking at the tracker for four months.
      console.warn('[auth-status] sign-in not recorded (check the Firestore rule on /logins):',
                   (e && (e.code || e.message)) || e);
      markerClear();   // let the next emission retry rather than silently skipping
                       // for 30 minutes on a transient failure
    });
  }

  (async function init() {
    var app;
    try { app = await resolveApp(); } catch (e) { return; }
    var authMod = await import(SDK + 'firebase-auth.js');
    var auth = authMod.getAuth(app);

    var wantPill = shouldRenderPill();
    if (wantPill) injectStyles();
    function start() {
      authMod.onAuthStateChanged(auth, function (user) {
        // Record first: rendering touches the DOM and could in principle throw
        // on a hostile page, and losing the pill is cheaper than losing the log.
        if (user) recordLogin(app, user);
        else markerClear();      // signed out — re-arm so the next sign-in records
        if (wantPill) render(user, auth, authMod.signOut);
      });
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  })();
})();
