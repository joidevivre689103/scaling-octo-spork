/* ============================================================================
 * auth-status.js — site-wide auth-status pill
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

  if (window.CT_NO_AUTH_WIDGET) return;
  if (document.getElementById('userPill')) return;        // page has its own (bts)
  if (document.getElementById('ct-auth-status')) return;  // already mounted

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

  (async function init() {
    var app;
    try { app = await resolveApp(); } catch (e) { return; }
    var authMod = await import(SDK + 'firebase-auth.js');
    var auth = authMod.getAuth(app);

    injectStyles();
    function start() {
      authMod.onAuthStateChanged(auth, function (user) { render(user, auth, authMod.signOut); });
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  })();
})();
