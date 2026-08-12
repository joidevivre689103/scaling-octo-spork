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
 * THREE DESIGN RULES, EACH LEARNED THE HARD WAY
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
 * DEBUG TOKENS (browser-only workflow — read before enforcing)
 *   In a browser where you need to bypass attestation, run:
 *       localStorage.setItem('ct-appcheck-debug', '1'); location.reload();
 *   The SDK then prints a debug token UUID to the console. Register it at
 *   Firebase Console -> App Check -> Apps -> (Cricket Times) -> Manage debug
 *   tokens. To stop: localStorage.removeItem('ct-appcheck-debug').
 *   NOTE the flag must be set BEFORE initializeAppCheck runs, which is why it
 *   is read from localStorage at the top of this file rather than passed in.
 *   A registered debug token bypasses App Check for whoever holds it — treat it
 *   like a credential, register one per browser, and revoke when done.
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

  /* Debug flag must be set on self BEFORE initializeAppCheck is called. */
  try {
    if (window.localStorage && localStorage.getItem(DEBUG_FLAG_KEY) === '1') {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      console.info('[ct-appcheck] debug mode on — a debug token UUID will be printed below. ' +
                   'Register it in Firebase Console -> App Check -> Manage debug tokens.');
    }
  } catch (_) { /* private mode / storage disabled -> no debug mode, fine */ }

  var _initPromise = null;

  /* Resolve to the AppCheck instance, or null if anything at all goes wrong. */
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

  /* Public: resolve to a token string, or null. NEVER rejects. */
  function token() {
    return ensureAppCheck().then(function (ac) {
      if (!ac) return null;
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

  /* Start init immediately so the first data fetch isn't also paying for the
   * reCAPTCHA script load. Failure here is already swallowed above. */
  ensureAppCheck();

  window.CTAppCheck = { token: token, _siteKey: RECAPTCHA_SITE_KEY };
})();
