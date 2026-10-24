/* ============================================================================
 * ct-appcheck.js — Firebase App Check token provider (Cloudflare Turnstile)
 * ----------------------------------------------------------------------------
 * Item (1a). Loaded on the gated stats pages AFTER feature-flags.js and BEFORE
 * ct-data-loader.js.
 *
 * WHAT THIS DOES
 *   Initialises App Check against the FirebaseApp that feature-flags.js already
 *   created, and exposes `window.CTAppCheck.token()` -> Promise<string|null>.
 *   ct-data-loader.js attaches that string as the `X-Firebase-AppCheck` header
 *   on its serveDerivedData fetch.
 *
 * PROVIDER — CHANGED 2026-10-24 FROM reCAPTCHA ENTERPRISE TO CLOUDFLARE TURNSTILE
 *   reCAPTCHA is Google's, and EU regulators have treated it as needing consent.
 *   IJ switched before any reader joined, so "strictly necessary, no banner"
 *   rests on a provider that doesn't use the data for advertising and sets no
 *   cookie in normal use. App Check has no built-in Turnstile provider, so this
 *   is a CustomProvider:
 *     1. Render a Turnstile widget (appearance 'interaction-only': invisible
 *        unless Cloudflare wants the visitor to tick a box) and get its
 *        one-time token.
 *     2. POST it to the mintAppCheckToken function (super-fortnight,
 *        turnstileAppCheck.js), which checks it with Cloudflare and returns an
 *        App Check token minted by the Admin SDK.
 *     3. Hand that to the App Check SDK, which attaches and refreshes it as it
 *        did with reCAPTCHA. serveDerivedData verifies it unchanged.
 *   Every rule below still holds; "the reCAPTCHA script" now reads "the
 *   Turnstile script". One addition to rule 3: if Cloudflare shows the visitor a
 *   box to tick, the time cap waits for them (up to 60 seconds) instead of
 *   giving up while they are clicking.
 *
 * FOUR DESIGN RULES, EACH LEARNED THE HARD WAY
 *
 * 1. IT NEVER CALLS getApp(). The app is taken from
 *    window.CTFeatureFlags.firebaseReady, exactly as ct-data-loader.js does.
 *    prelaunch-guard.js owns Firebase init today and is DELETED at launch; a
 *    helper that reaches for the ambient app would work now and break then.
 *
 * 2. IT FAILS SOFT, ALWAYS. Every failure path resolves to null rather than
 *    rejecting, and the loader sends the request without the header. During
 *    monitoring mode an un-minted token must never blank a stats page — the
 *    reader-facing cost of a false negative is total, the security cost is nil
 *    because nothing is enforcing yet.
 *
 * 3. IT IS TIME-BOUNDED. getToken() is capped at APPCHECK_TIMEOUT_MS. reCAPTCHA
 *    Enterprise loads a third-party script; if that script is blocked (ad
 *    blocker, corporate proxy, offline) the promise would otherwise hang and
 *    take the data fetch down with it.
 *
 * 4. IT DOES NOT START AT PARSE TIME. Added 2026-08-12 — see below. This is a
 *    CORRECTNESS rule, not a performance one; do not "optimise" it back.
 *
 * ─── WHY INIT IS DEFERRED (2026-08-12) ──────────────────────────────────────
 *   This file previously called ensureAppCheck() on the last line, at parse
 *   time, so the reCAPTCHA script load would overlap the rest of page load and
 *   the first data fetch would find a token already minted. That optimisation
 *   was costing correctness.
 *
 *   ctPageBootstrap in feature-flags.js wraps a FIVE-SECOND budget around a
 *   serial chain — firebaseReady, SDK imports, getFeatureGates, auth settling,
 *   requireAccess — and decides from it whether the reader may see the page. An
 *   eager App Check init runs a third-party module import plus the reCAPTCHA
 *   Enterprise script and its assessment CONCURRENTLY with that budget, on every
 *   gated page load. On a cold profile (incognito, cleared cache, slow network)
 *   that contention pushed the chain past five seconds.
 *
 *   What happens then is not a slow page — it is a REDIRECT. The bootstrap's
 *   timeout tiebreaker reads auth.currentUser synchronously, which is null
 *   precisely when auth settling is the step that stalled, so it concludes there
 *   is no session and sends the reader to login.html. login.html then resolves
 *   the session correctly, offers Continue, and returns them to the gated page —
 *   where the same race runs again. That is the login loop observed 2026-08-12.
 *
 *   Note the budget was already raised 2000 -> 5000 on 2026-06-04 for this exact
 *   failure ("signed-in admin bounced to login on slow navigations"). App Check
 *   ate the headroom that bump created.
 *
 *   THE SHAPE OF THE FIX. Not "lazy" — that would move the whole reCAPTCHA cost
 *   in front of the table and make a blocked script a visible stall. Instead the
 *   warm-up is SCHEDULED for the moment page load settles, which is after the
 *   gate has decided. Whichever comes first wins:
 *     - the `load` event fires    -> warm up speculatively, token ready early
 *     - token() is called first   -> initialise on demand, same as before
 *   The gate runs uncontended either way, and the common case keeps its
 *   parallelism.
 *
 *   THIS FILE IS ONLY HALF THE FIX. The tiebreaker in feature-flags.js is wrong
 *   independently of App Check: on timeout it must not read currentUser
 *   synchronously, because currentUser is null until Firebase rehydrates the
 *   persisted session — so the "signed in, fail open" branch cannot fire in the
 *   one case it exists for. Raising the budget a third time only moves the
 *   threshold. Fix that too.
 *
 * DEBUG TOKENS (browser-only workflow — read before enforcing)
 *   In a browser where you need to bypass attestation, run:
 *       localStorage.setItem('ct-appcheck-debug', '1'); location.reload();
 *   The SDK then prints a debug token UUID to the console. Register it at
 *   Firebase Console -> App Check -> Apps -> (Cricket Times) -> Manage debug
 *   tokens. To stop: localStorage.removeItem('ct-appcheck-debug').
 *   NOTE the flag must be set BEFORE initializeAppCheck runs, which is why it
 *   is read from localStorage at the top of this file rather than passed in —
 *   that is still true with deferred init, because the flag is set on `self` at
 *   parse time while only the initialise CALL is deferred.
 *   A registered debug token bypasses App Check for whoever holds it — treat it
 *   like a credential, register one per browser, and revoke when done.
 *   DEBUG TOKENS ARE PER-ORIGIN: the SDK persists its UUID in localStorage, so
 *   cricket-times-admin.web.app needs its own registration separate from the
 *   apex. A second UUID is expected, not a fault.
 * ========================================================================== */
(function () {
  'use strict';

  /* Cloudflare Turnstile site key. NOT a secret — it ships in the page, and the
   * widget only works on the hostnames registered with it in Cloudflare
   * (thegrassbank.com, cricket-times-admin.web.app). The matching secret is
   * TURNSTILE_SECRET in Secret Manager, used only by mintAppCheckToken. */
  var TURNSTILE_SITE_KEY = '0x4AAAAAAFkSb7gcZw7nxTjO';
  var TURNSTILE_SCRIPT   = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var TURNSTILE_ACTION   = 'appcheck';   // must match ACTION in turnstileAppCheck.js
  var MINT_URL           = 'https://us-west1-hitwicket-cba02.cloudfunctions.net/mintAppCheckToken';

  var FB_APPCHECK_URL   = 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app-check.js';
  // 10 s, up from 5 s with reCAPTCHA (2026-10-24): a Turnstile token now also
  // has to go through our own function, which can take a few seconds to start
  // when nobody has used it for a while. A blocked script still fails at once
  // (onerror), so this cap only matters for a genuine hang.
  var APPCHECK_TIMEOUT_MS = 10000;
  var CHALLENGE_TIMEOUT_MS = 60000;   // a visitor ticking Turnstile's box
  var DEBUG_FLAG_KEY      = 'ct-appcheck-debug';

  /* Debug flag must be set on self BEFORE initializeAppCheck is called. Set at
   * parse time even though init is deferred — cheap, and it removes any ordering
   * question about whether the flag beat the initialise call. With it set, the
   * SDK uses its debug provider and Turnstile never runs. */
  try {
    if (window.localStorage && localStorage.getItem(DEBUG_FLAG_KEY) === '1') {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      console.info('[ct-appcheck] debug mode on — a debug token UUID will be printed below. ' +
                   'Register it in Firebase Console -> App Check -> Manage debug tokens.');
    }
  } catch (_) { /* private mode / storage disabled -> no debug mode, fine */ }

  /* ── Turnstile ─────────────────────────────────────────────────────────── */

  var _turnstilePromise = null;
  var _challengeShowing = false;

  function loadTurnstile() {
    if (_turnstilePromise) return _turnstilePromise;
    _turnstilePromise = new Promise(function (resolve, reject) {
      if (window.turnstile) { resolve(window.turnstile); return; }
      var s = document.createElement('script');
      s.src = TURNSTILE_SCRIPT;
      s.async = true;
      s.onload = function () {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('turnstile script loaded without turnstile'));
      };
      s.onerror = function () { reject(new Error('turnstile script blocked or offline')); };
      document.head.appendChild(s);
    });
    // A failed load may be transient (offline); let the next attempt retry.
    _turnstilePromise.catch(function () { _turnstilePromise = null; });
    return _turnstilePromise;
  }

  /* The box Cloudflare shows only when it wants the visitor to tick it. Fixed
   * bottom-right, empty and invisible otherwise. */
  function widgetHost() {
    var host = document.getElementById('ct-turnstile');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ct-turnstile';
      host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
      document.body.appendChild(host);
    }
    var slot = document.createElement('div');
    host.appendChild(slot);
    return slot;
  }

  /* One fresh Turnstile token. Each token is single-use, so each call renders
   * its own widget and removes it once it has answered. */
  function turnstileToken() {
    return loadTurnstile().then(function (ts) {
      return new Promise(function (resolve, reject) {
        var slot = widgetHost();
        var id = null;
        var done = function (fn, v) {
          _challengeShowing = false;
          setTimeout(function () {
            try { if (id !== null) ts.remove(id); } catch (_) {}
            if (slot.parentNode) slot.parentNode.removeChild(slot);
          }, 0);
          fn(v);
        };
        try {
          id = ts.render(slot, {
            sitekey: TURNSTILE_SITE_KEY,
            action: TURNSTILE_ACTION,
            appearance: 'interaction-only',
            'refresh-expired': 'never',
            callback: function (t) { done(resolve, t); },
            'error-callback': function (code) {
              done(reject, new Error('turnstile error ' + code));
              return true;   // handled: no automatic retry loop
            },
            'timeout-callback': function () { done(reject, new Error('turnstile challenge timed out')); },
            'before-interactive-callback': function () { _challengeShowing = true; },
            'after-interactive-callback': function () { _challengeShowing = false; }
          });
        } catch (e) { done(reject, e); }
      });
    });
  }

  /* CustomProvider.getToken: Turnstile token in, App Check token out. Rejects
   * on any failure; the SDK turns that into a getToken() error, which token()
   * below turns into null (rule 2). */
  function mintAppCheckToken(appId) {
    return turnstileToken().then(function (t) {
      return fetch(MINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken: t, appId: appId })
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('mintAppCheckToken HTTP ' + res.status);
      return res.json();
    }).then(function (j) {
      if (!j || !j.token) throw new Error('mintAppCheckToken returned no token');
      return { token: j.token, expireTimeMillis: Date.now() + (Number(j.ttlMillis) || 30 * 60 * 1000) };
    });
  }

  var _initPromise = null;

  /* Resolve to the AppCheck instance, or null if anything at all goes wrong.
   * Idempotent: the first caller starts the work, everyone else joins it. */
  function ensureAppCheck() {
    if (_initPromise) return _initPromise;

    _initPromise = (function () {
      var ff = window.CTFeatureFlags;
      if (!ff || !ff.firebaseReady) {
        console.warn('[ct-appcheck] CTFeatureFlags.firebaseReady missing — ' +
                     'load feature-flags.js before ct-appcheck.js. Continuing without App Check.');
        return Promise.resolve(null);
      }
      return Promise.all([ff.firebaseReady, import(FB_APPCHECK_URL)]).then(function (r) {
        var app = r[0], mod = r[1];
        // isTokenAutoRefreshEnabled keeps a valid token in hand across the 1h TTL
        // without the reader ever waiting on a mint mid-session.
        var appId = app && app.options && app.options.appId;
        return mod.initializeAppCheck(app, {
          provider: new mod.CustomProvider({
            getToken: function () { return mintAppCheckToken(appId); }
          }),
          isTokenAutoRefreshEnabled: true
        });
      }).catch(function (e) {
        console.warn('[ct-appcheck] init failed, continuing without App Check:', e && e.message || e);
        return null;
      });
    })();

    return _initPromise;
  }

  /* Public: resolve to a token string, or null. NEVER rejects.
   * If the warm-up below has already run, ensureAppCheck() returns the settled
   * promise and this is effectively instant. If it has not, this initialises on
   * demand — so a fetch that beats the `load` event still gets a token. */
  function token() {
    return ensureAppCheck().then(function (ac) {
      if (!ac) return null;   // init failed hard — return immediately, no waiting
      return import(FB_APPCHECK_URL).then(function (mod) {
        // Give up after APPCHECK_TIMEOUT_MS, unless Cloudflare is showing the
        // visitor a box to tick: then wait for them, up to CHALLENGE_TIMEOUT_MS.
        var timeout = new Promise(function (resolve) {
          var started = Date.now();
          (function check() {
            var waited = Date.now() - started;
            if (waited >= CHALLENGE_TIMEOUT_MS ||
                (waited >= APPCHECK_TIMEOUT_MS && !_challengeShowing)) { resolve(null); return; }
            setTimeout(check, 250);
          })();
        });
        var minted = mod.getToken(ac, /* forceRefresh */ false).then(function (res) {
          return (res && res.token) || null;
        }).catch(function (e) {
          console.warn('[ct-appcheck] getToken failed, sending request unattested:', e && e.message || e);
          return null;
        });
        return Promise.race([minted, timeout]);
      });
    }).catch(function () { return null; });
  }

  /* ── Warm-up scheduling ────────────────────────────────────────────────────
   * Start init once page load has settled, so it never overlaps the gate budget
   * in feature-flags.js. If document load has ALREADY fired by the time this
   * script runs, start on the next macrotask rather than synchronously — the
   * point is to leave the current turn of the event loop to the bootstrap.
   *
   * Do NOT change this to a parse-time call. See the header block: an eager init
   * is what produced the 2026-08-12 login loop. */
  function scheduleWarmUp() {
    var start = function () { setTimeout(ensureAppCheck, 0); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }
  scheduleWarmUp();

  window.CTAppCheck = { token: token, _siteKey: TURNSTILE_SITE_KEY };
})();
