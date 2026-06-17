/* ============================================================================
 * ct-data-loader.js  —  Cricket Times shared derived-data loader (Phase 3, §3)
 * ----------------------------------------------------------------------------
 * Replaces the public, unauthenticated data path
 *     fetch('data.json.gz')  +  manual DecompressionStream      (countries.html)
 *     <script src="data.js">                                    (other stats pages)
 * with an authenticated call to the serveDerivedData Cloud Function, so the
 * proprietary dataset is no longer wholesale-downloadable.
 *
 * Public API (window.CTData):
 *     await CTData.load('data')      -> full dataset D    (derived/data.json.gz)
 *     await CTData.load('ratings')   -> sim ratings       (derived/sim_ratings.json.gz)
 *     await CTData.load('model')     -> sim model         (derived/sim_model.json.gz)
 *     CTData.clearCache(['data'])    -> drop cached copy/copies (default: all)
 *
 * Requires (already provided by feature-flags.js / prelaunch-guard.js on every
 * gated page): an initialised Firebase compat app + auth, AND a signed-in user
 * holding the `derivedData` entitlement (paid / beta / admin). On a public or
 * anonymous page the endpoint 401s by design -- gate the page first.
 *
 * Contract source: functions/serveDerivedData.js (confirmed 2026-06-11).
 * PARITY: the server runs requireAccessServer (a port of client requireAccess)
 * for feature `derivedData`. This file does NOT make access decisions -- it only
 * carries the token. Keep "who gets the data" in featureGates, mirrored server-side.
 * ========================================================================== */
(function () {
  'use strict';

  var ENDPOINT = 'https://us-west1-hitwicket-cba02.cloudfunctions.net/serveDerivedData';

  // Client-side mirror of the server's ?file= allowlist -- fail fast before a
  // round-trip, and a reminder to keep the two lists in lockstep (PARITY).
  var ALLOWED = { data: 1, ratings: 1, model: 1 };

  // Pages run the MODULAR Firebase SDK (10.12.5) -- there is no compat `firebase`
  // global. feature-flags.js owns init and exposes window.CTFeatureFlags.firebaseReady
  // (-> the FirebaseApp). We reach auth via getAuth(app), which is idempotent per app,
  // so we share the exact same instance (and persisted session) the bootstrap uses.
  // Must stay pinned to the SAME version as feature-flags.js (cross-version SDK objects
  // fail type-checks).
  var FB_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

  var AUTH_WAIT_MS       = 8000;   // wait this long for auth state to resolve
  var REQUEST_TIMEOUT_MS = 30000;  // generous: first call may hit a cold start (minInstances:0)

  var mem = {};            // in-page cache: file -> parsed object (lives for one page load)

  function CTDataError(code, message, extra) {
    var e = new Error(message || code);
    e.name = 'CTDataError';
    e.code = code;
    if (extra) { e.status = extra.status; e.reason = extra.reason; }
    return e;
  }

  /* --- auth ----------------------------------------------------------------
   * Modular SDK: get the app from feature-flags.js's firebaseReady, then
   * getAuth(app) (idempotent -> same instance the bootstrap uses). Page IIFEs
   * (e.g. countries.html's initH2HFromPipeline) can fire before the bootstrap
   * has settled auth, so we wait for the first non-null onAuthStateChanged
   * emission rather than reading currentUser once (it's synchronously null
   * before a persisted session rehydrates). A genuinely anonymous page times
   * out with a clear 'no-user' error. */
  var _authReady = null;
  function getAuthCtx() {
    if (_authReady) return _authReady;
    _authReady = (function () {
      var ff = window.CTFeatureFlags;
      if (!ff || !ff.firebaseReady) {
        return Promise.reject(CTDataError('no-firebase',
          'window.CTFeatureFlags.firebaseReady not found -- load feature-flags.js before ct-data-loader.js.'));
      }
      return Promise.all([ff.firebaseReady, import(FB_AUTH_URL)]).then(function (r) {
        var app = r[0], mod = r[1];
        return { auth: mod.getAuth(app), onAuthStateChanged: mod.onAuthStateChanged };
      });
    })();
    // don't cache a rejection (e.g. transient import failure) -- let it retry
    _authReady.catch(function () { _authReady = null; });
    return _authReady;
  }

  function waitForUser() {
    return getAuthCtx().then(function (ctx) {
      return new Promise(function (resolve, reject) {
        if (ctx.auth.currentUser) return resolve(ctx.auth.currentUser);
        var done = false;
        var unsub = ctx.onAuthStateChanged(ctx.auth, function (u) {
          if (done || !u) return;          // ignore the initial null fire; wait for a user or timeout
          done = true; unsub(); resolve(u);
        });
        setTimeout(function () {
          if (done) return;
          done = true; try { unsub(); } catch (_) {}
          reject(CTDataError('no-user',
            'No signed-in user -- this page must be gated (requireAccess) before loading derived data.'));
        }, AUTH_WAIT_MS);
      });
    });
  }

  function getToken(force) {
    return waitForUser().then(function (u) { return u.getIdToken(!!force); });
  }

  /* --- cross-page cache (sessionStorage; the function sends Cache-Control:
   * no-store, so without this every stats-page navigation re-runs the full
   * auth + function round-trip). The plain `data` object (~6.7 MB as JSON)
   * overflows the ~5 MB quota, so where the browser supports Compression
   * Streams we cache a gzip+base64 copy (~1.7 MB) under a separate `ctdz:` key
   * -- small enough to persist across navigations within the session.
   * ratings/model are tiny and cache the same way. Without Compression Streams
   * (or if even the compressed copy overflows) we fall back to plain JSON,
   * which overflows for `data` and is silently skipped -- i.e. exactly the old
   * behaviour, so there is no regression. Reads and writes are async because
   * (de)compression streams.
   *
   * Exposure: the cached copy is origin-scoped, readable only by same-origin JS
   * (which already holds the parsed object in memory), is never sent anywhere,
   * and dies when the tab closes -- the same trust boundary as the live `D`
   * object, NOT persistent on-disk storage. See td-derived-data-loader.
   * Freshness: a cached `data` copy lives for the browser session, so a mid-
   * session pipeline refresh isn't seen until a new tab/session or clearCache()
   * -- acceptable for a once-daily dataset, and the same model already used for
   * ratings/model. */
  var SS_KEY    = 'ctd:';    // plain-JSON entries (fallback / older browsers)
  var SS_GZ_KEY = 'ctdz:';   // gzip+base64 entries (the default when supported)
  var HAS_CS = (typeof CompressionStream === 'function' &&
                typeof DecompressionStream === 'function' &&
                typeof Response === 'function' &&
                typeof TextEncoder === 'function');

  function ssKey(file)   { return SS_KEY + file; }
  function ssGzKey(file) { return SS_GZ_KEY + file; }

  // Uint8Array <-> base64, chunked to dodge call-stack / arg-length limits.
  function bytesToB64(bytes) {
    var CH = 0x8000, bin = '';
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // string -> gzipped bytes (Promise<Uint8Array>)
  function gzipString(str) {
    var cs = new CompressionStream('gzip');
    var w  = cs.writable.getWriter();
    w.write(new TextEncoder().encode(str)); w.close();
    return new Response(cs.readable).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }
  // gzipped bytes -> string (Promise<string>)
  function gunzipBytes(bytes) {
    var ds = new DecompressionStream('gzip');
    var w  = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Response(ds.readable).text();
  }

  /* Read the cross-page cache. ALWAYS returns a Promise<object|null>. Tries the
   * compressed entry first, then a plain entry; a corrupt / un-parseable entry
   * resolves to null (treated as a clean miss -> a fresh fetch). */
  function ssGet(file) {
    if (HAS_CS) {
      var gz = null;
      try { gz = sessionStorage.getItem(ssGzKey(file)); } catch (_) {}
      if (gz) {
        return gunzipBytes(b64ToBytes(gz))
          .then(function (txt) { return JSON.parse(txt); })
          .catch(function () { return null; });
      }
    }
    var raw = null;
    try { raw = sessionStorage.getItem(ssKey(file)); } catch (_) {}
    try { return Promise.resolve(raw ? JSON.parse(raw) : null); }
    catch (_) { return Promise.resolve(null); }
  }

  /* Write the cross-page cache. Fire-and-forget: never blocks load() and never
   * throws to the caller. Compresses when supported (so the big `data` file
   * fits); otherwise stores plain JSON (which overflows for `data` and is
   * skipped). Writes ONE representation and clears the other, so a stale plain
   * copy can't shadow a fresh compressed one (or vice-versa). */
  function ssSet(file, obj) {
    var json;
    try { json = JSON.stringify(obj); } catch (_) { return; }
    if (HAS_CS) {
      gzipString(json).then(function (bytes) {
        try {
          sessionStorage.setItem(ssGzKey(file), bytesToB64(bytes));
          try { sessionStorage.removeItem(ssKey(file)); } catch (_) {}
        } catch (_) { /* quota / private mode -> skip cross-page cache */ }
      }).catch(function () { /* compression failed at runtime -> skip */ });
      return;
    }
    try {
      sessionStorage.setItem(ssKey(file), json);
      try { sessionStorage.removeItem(ssGzKey(file)); } catch (_) {}
    } catch (_) { /* quota or private mode -> skip */ }
  }

  /* --- network -------------------------------------------------------------- */
  function doFetch(file, token) {
    var ctrl  = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS) : null;

    return fetch(ENDPOINT + '?file=' + encodeURIComponent(file), {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      signal: ctrl ? ctrl.signal : undefined
      // No credentials: the token rides in the header. Sending Authorization
      // triggers a CORS preflight, which serveDerivedData answers (204) by design.
    }).then(
      function (resp) { if (timer) clearTimeout(timer); return resp; },
      function (err)  {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') {
          throw CTDataError('timeout', 'serveDerivedData timed out (possible cold start).');
        }
        // A failed fetch with no status is almost always the apex-only CORS rule:
        // the function echoes Access-Control-Allow-Origin: https://cricketimes.com
        // ONLY. A page served from www. / *.web.app / a preview host passes auth
        // then dies here. Serve every migrated page from https://cricketimes.com
        // exactly, or widen ALLOWED_ORIGIN in the function.
        throw CTDataError('network',
          'serveDerivedData unreachable -- likely a CORS origin mismatch (this page must be served from https://cricketimes.com exactly).');
      }
    );
  }

  /* --- response handling + retry branches ----------------------------------- */
  function handle(file, resp, isRetry) {
    var s = resp.status;

    if (s === 200) {
      // The function sets Content-Encoding: gzip, so the browser has already
      // inflated the body -- response.json() works directly (no DecompressionStream).
      return resp.json().catch(function () {
        throw CTDataError('parse', 'serveDerivedData returned a body that was not valid JSON.');
      });
    }
    if (s === 401 && !isRetry) {                 // stale/expired token -> force-refresh once
      return getToken(true)
        .then(function (t) { return doFetch(file, t); })
        .then(function (r) { return handle(file, r, true); });
    }
    if (s === 502 && !isRetry) {                 // transient upstream -> one retry
      return getToken(false)
        .then(function (t) { return doFetch(file, t); })
        .then(function (r) { return handle(file, r, true); });
    }
    if (s === 403) {
      return resp.json().catch(function () { return {}; }).then(function (body) {
        throw CTDataError('forbidden',
          'Access to derived data was denied (your plan does not include it).',
          { status: 403, reason: (body && body.reason) || 'paywall' });
      });
    }
    if (s === 401) throw CTDataError('unauthorized', 'Authentication failed for serveDerivedData.', { status: 401 });
    if (s === 400) throw CTDataError('bad-file',    'serveDerivedData rejected the file parameter.', { status: 400 });
    if (s === 405) throw CTDataError('method',      'serveDerivedData requires GET.',                { status: 405 });
    if (s === 500) throw CTDataError('server',      'serveDerivedData failed (fail-closed).',        { status: 500 });
    if (s === 502) throw CTDataError('transient',   'serveDerivedData is temporarily unavailable -- please retry.', { status: 502 });
    throw CTDataError('http', 'serveDerivedData returned HTTP ' + s + '.', { status: s });
  }

  /* --- public load (with in-memory + sessionStorage cache + single-flight) --- */
  function load(file) {
    if (!ALLOWED[file]) {
      return Promise.reject(CTDataError('bad-file',
        'Unknown derived-data file "' + file + '" (allowed: data, ratings, model).'));
    }
    if (mem[file]) return Promise.resolve(mem[file]);

    if (!load._inflight) load._inflight = {};
    if (load._inflight[file]) return load._inflight[file];   // share an in-progress load

    // ssGet is async (decompression streams), so the cross-page cache read is
    // folded into the single-flight promise -- two near-simultaneous load()
    // calls share one cache-read + (at most) one fetch.
    var p = ssGet(file).then(function (cached) {
      if (cached) { mem[file] = cached; return cached; }      // cross-page cache hit
      return getToken(false)
        .then(function (token) { return doFetch(file, token); })
        .then(function (resp)  { return handle(file, resp, false); })
        .then(function (data)  { mem[file] = data; ssSet(file, data); return data; });
    });

    // clear the in-flight slot on either outcome
    var cleaned = p.then(
      function (v) { delete load._inflight[file]; return v; },
      function (e) { delete load._inflight[file]; throw e; }
    );
    load._inflight[file] = cleaned;
    return cleaned;
  }

  function clearCache(files) {
    (files || Object.keys(ALLOWED)).forEach(function (f) {
      delete mem[f];
      try { sessionStorage.removeItem(ssKey(f)); } catch (_) {}
      try { sessionStorage.removeItem(ssGzKey(f)); } catch (_) {}
    });
  }

  window.CTData = { load: load, clearCache: clearCache, _endpoint: ENDPOINT };
})();
