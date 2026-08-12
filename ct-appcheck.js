/* ============================================================================
 * ct-appcheck.js — Firebase App Check (reCAPTCHA Enterprise) token provider
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

  /* reCAPTCHA Enterprise site key for App Check. NOT a secret — it ships in the
   * page like the Firebase apiKey and is restricted to the registered domains
   * (cricketimes.com, hitwicket-cba02.firebaseapp.com, hitwicket-cba02.web.app,
   * cricket-times-admin.web.app). reCAPTCHA matches subdomains implicitly, so
   * there is no wildcard entry here — unlike the API-key referrer list, which
   * needs an explicit https://*.cricketimes.com/* entry. Two lists, two shapes. */
  var RECAPTCHA_SITE_KEY = '6LfPGYEtAAAAAOy4SJRnsSxdImyfVczWtNV3_k44';

  var FB_APPCHECK_URL   = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js';
  var APPCHECK_TIMEOUT_MS = 5000;
  var DEBUG_FLAG_KEY      = 'ct-appcheck-debug';

  /* Debug flag must be set on self BEFORE initializeAppCheck is called. Set at
   * parse time even though init is deferred — cheap, and it removes any ordering
   * question about whether the flag beat the initialise call. */
  try {
    if (window.localStorage && localStorage.getItem(DEBUG_FLAG_KEY) === '1') {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      console.info('[ct-appcheck] debug mode on — a debug token UUID will be printed below. ' +
                   'Register it in Firebase Console -> App Check -> Manage debug tokens.');
    }
  } catch (_) { /* private mode / storage disabled -> no debug mode, fine */ }

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
        return mod.initializeAppCheck(app, {
          provider: new mod.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
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
        var timeout = new Promise(function (resolve) {
          setTimeout(function () { resolve(null); }, APPCHECK_TIMEOUT_MS);
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

  window.CTAppCheck = { token: token, _siteKey: RECAPTCHA_SITE_KEY };
})();
