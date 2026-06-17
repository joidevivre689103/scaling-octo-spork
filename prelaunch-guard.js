/* ═══════════════════════════════════════════════════════════════════
   CRICKET TIMES — PRE-LAUNCH GUARD (v2: tier-based access)
   ───────────────────────────────────────────────────────────────────
   Loaded on every public page of the site via:
     <script src="/feature-flags.js"></script>
     <script src="/prelaunch-guard.js"></script>
   placed at the TOP of <head>, before anything else.

   ─── FIREBASE INIT OWNERSHIP (post-2026-05-29, item 7.5 / TODO #13) ─
   feature-flags.js owns Firebase initializeApp(). This guard awaits
   CTFeatureFlags.firebaseReady before calling getApp(). Rationale: at
   launch this file retires (per AT LAUNCH checklist) but feature-flags.js
   stays. Putting init in feature-flags.js means init survives the
   transition. Prior to 2026-05-29 this file held init directly; if you
   are reading an older version, the firebaseConfig const and
   initializeApp() fallback lived inside performTierCheck.

   ─── ACCESS LADDER ────────────────────────────────────────────────
   Three independent gates, checked in order:

     1. Owner bypass  — ?preview=<secret> (synchronous, sticky)
     2. Hardcoded kill-switch — PRELAUNCH_FORCE_OPEN below
     3. Tier check    — config/featureFlags.site.minimumTier vs
                        signed-in user's role + paid status (post-h)

   ─── SITE-WIDE TIER VALUES (config/featureFlags.site.minimumTier) ─
   The tier value sets the bar everyone must clear:
     closed     — site fully gated; only URL-bypass owner gets in
     admin      — only admins / superadmins
     priority   — pre-launch beta gate. Passes if the user is paid,
                  is a beta tester, or is an admin. See "axis-aware
                  semantics" below.
     regular    — any signed-in user
     public     — open to all (= "launched")

   ─── PER-USER ROLES (settings/userTypes[email_key]) ───────────────
   Post-(h) the role axis carries OPERATIONAL ROLES only:
     beta | admin | superadmin
   (signed-in users with no entry are treated as 'regular' by
   getUserRole's fallback — that's the catch-all for free signed-in
   users.)

   Pre-(h) the role axis also doubled as paid-status storage via a
   'priority' role written by the Stripe webhook. That mirroring is
   gone as of item (h); paid status now lives in
   subscriptions/{emailKey}.status and is read via
   CTFeatureFlags.getUserIsPaid(). Stale 'priority' entries may
   linger in settings/userTypes from pre-(h) writes — they are
   harmless (no reader consults them) and will be cleaned up by item (e).

   ─── AXIS-AWARE SEMANTICS (post-h) ────────────────────────────────
   The 'priority' tier value uses a disjunction rather than a rank
   comparison: a user passes if ANY of these is true:
     - role is 'admin' or 'superadmin' (operational roles)
     - role is 'beta' (beta-tester overlay)
     - isPaid is true (active or past_due subscription)
   This is the post-(h) gate during pre-launch / beta phases: paid
   subscribers and beta testers come and go via real Stripe events
   and role assignments, no longer via a single 'priority' role.

   All other tier values ('public', 'regular', 'admin', 'superadmin',
   'closed') still use simple rank comparison via hasSiteAccess.

   ─── ALLOWLISTED PAGES (always accessible) ────────────────────────
     comingsoon.html             — pre-launch landing page
     (index.html removed 2026-06-05 — the root is now the real stories
      homepage and takes the tier check like any gated page)
     quiz.html, oracle.html      — Test Cricket Oracle
     article.html                — article reader (allowlisted so the
                                   coming-soon "Read the evidence" CTA
                                   works without sign-in; the article
                                   page itself has its own inline
                                   preview gate while content is being
                                   finalised — see article.html for
                                   the temporary password screen)
     login.html                  — universal auth surface (build item
                                   (a), spec §9.2). Must be reachable
                                   unauthenticated, otherwise the gate
                                   would have nowhere to send people
                                   when they need to sign in. Auth
                                   primitive is built on top of this.
     /oracle/{edition}/...       — permanent edition pages
   On allowlisted pages, nav is hidden (consistent with original guard).

   ─── OWNER BYPASS ─────────────────────────────────────────────────
   Visit any page once with ?preview=<OWNER_BYPASS_SECRET>.
   Saved to localStorage, sticky thereafter on that browser/device.
   To revoke: change OWNER_BYPASS_SECRET below and redeploy.

   ─── ASYNC NOTE ───────────────────────────────────────────────────
   Tier checking requires Firebase Auth + Firestore reads. While that
   resolves, the page is hidden via injected CSS. If the check takes
   longer than ASYNC_TIMEOUT_MS, we fail CLOSED (redirect) — exposing
   content during a slow check is worse than a brief redirect. The
   owner-bypass URL works regardless of Firestore reachability and is
   the proper escape hatch if Firestore is down.

   Allowlisted pages (article.html, oracle.html, coming-soon, etc.)
   short-circuit synchronously BEFORE any async work, so they render
   instantly even if Firestore is slow or unreachable.

   ─── SESSION CACHE ────────────────────────────────────────────────
   The verdict (boolean allow/deny) is cached in sessionStorage for
   SESSION_CACHE_TTL_MS (5 min). Post-(h) the verdict depends on both
   role and paid status, so a stale cache could mean stale paid state
   — a user who just paid and returns within 5 minutes might still
   see deny. Same staleness existed pre-(h) for role changes. Sign-out
   clears the cache; tab close clears it.

   ─── TO LAUNCH ────────────────────────────────────────────────────
   Set config/featureFlags.site.minimumTier = "public" in admin panel.
   Every page unlocks for everyone on next page load.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── EMERGENCY KILL-SWITCH (NOT the launch mechanism) ─────────────
  // To launch the site, DO NOT change this — instead, set
  //   config/featureFlags.site.minimumTier = 'public'
  // in the admin panel (Launch Dashboard → Site Access).
  //
  // This constant is a panic button: set to true ONLY if Firestore is
  // unreachable and you need every page to load without the tier check
  // (e.g. site-wide outage, you need to ship a fix). It bypasses ALL
  // gating including the tier system — every page becomes public.
  // Production default: false.
  const PRELAUNCH_FORCE_OPEN = false;
  // ──────────────────────────────────────────────────────────────────

  // Owner bypass secret — preserved from v1.
  const OWNER_BYPASS_SECRET = '8n50brmcd1mei2oq';
  const OWNER_FLAG_KEY = 'ct_owner_preview';

  // How long to wait for the async tier check before failing open
  // (revealing the page anyway). 3 seconds is generous; typical Firestore
  // round-trip is well under 1s.
  const ASYNC_TIMEOUT_MS = 3000;

  // Cache the access verdict for this session so we don't re-query
  // Firestore on every page navigation. Cleared automatically when the
  // tab/browser closes; explicitly cleared if the user signs out.
  const SESSION_CACHE_KEY = 'ct_access_verdict_v1';
  const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes

  // Hide-the-page CSS while the async check resolves. Removed when
  // verdict is in (or on timeout). Without this, page contents flash
  // visible before any redirect lands.
  const HIDE_STYLE_ID = 'ct-prelaunch-hide';

  // ─── PATH ANALYSIS (preserved from v1) ────────────────────────────
  const path = window.location.pathname;
  const pathLower = path.toLowerCase();
  let file = (path.split('/').pop() || 'index.html').toLowerCase();
  if (file === '') file = 'index.html';

  // index.html REMOVED from ALLOWED 2026-06-05 (index swap): the root now
  // serves the real stories homepage, so it must take the tier check like
  // any gated page. Pre-swap, index.html was a redirect stub to comingsoon
  // and had to be allowlisted for its redirect to run un-intercepted.
  // NOTE: /oracle/<edition>/index.html is unaffected — it matches
  // ALLOWED_SUBPATHS before the filename matters.
  const ALLOWED = ['comingsoon.html', 'quiz.html', 'oracle.html', 'article.html', 'login.html'];
  const HIDE_NAV_ON = ['quiz.html', 'oracle.html', 'article.html'];
  const ALLOWED_SUBPATHS = ['/oracle/'];
  const HIDE_NAV_SUBPATHS = ['/oracle/'];

  function matchesSubpath(list) {
    for (let i = 0; i < list.length; i++) {
      if (pathLower.indexOf(list[i]) === 0) return true;
    }
    return false;
  }

  const isAllowedSubpath = matchesSubpath(ALLOWED_SUBPATHS);
  const isHideNavSubpath = matchesSubpath(HIDE_NAV_SUBPATHS);
  const isAllowedFile = ALLOWED.indexOf(file) !== -1;

  // ─── 1. KILL SWITCH ───────────────────────────────────────────────
  if (PRELAUNCH_FORCE_OPEN) return;

  // ─── 2. OWNER BYPASS (synchronous, sticky) ────────────────────────
  let previewParam;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    previewParam = urlParams.get('preview');
    if (previewParam === OWNER_BYPASS_SECRET) {
      window.localStorage.setItem(OWNER_FLAG_KEY, OWNER_BYPASS_SECRET);
    }
    if (window.localStorage.getItem(OWNER_FLAG_KEY) === OWNER_BYPASS_SECRET) {
      return;
    }
  } catch (e) {
    if (typeof previewParam !== 'undefined' && previewParam === OWNER_BYPASS_SECRET) {
      return;
    }
  }

  // ─── ALLOWLISTED PAGES — short-circuit synchronously ──────────────
  // Allowlisted pages (coming-soon, article reader, oracle, etc.) render
  // for everyone regardless of tier. Skip the async Firestore check
  // entirely so allowlisted pages keep their original instant render
  // and don't depend on Firestore reachability.
  if (isAllowedFile || isAllowedSubpath) {
    if (HIDE_NAV_ON.indexOf(file) !== -1 || (isAllowedSubpath && isHideNavSubpath)) {
      injectNavHide();
      rewriteMastheadLink();
    }
    return;
  }

  // ─── 3. ASYNC TIER CHECK (gated pages only) ───────────────────────
  injectHideStyle();

  // Try the session cache first.
  const cached = readSessionCache();
  console.log('[guard-debug] session cache:', cached === null ? 'MISS' : 'HIT (allowed=' + cached + ')');
  if (cached !== null) {
    finalize(cached);
    return;
  }

  const timeoutHandle = setTimeout(() => {
    console.warn('[prelaunch-guard] tier check timed out; failing closed');
    // Fail closed: an access gate that exposes content during slow Firestore
    // is worse than one that briefly redirects. The owner-bypass URL is the
    // proper escape hatch when Firestore is unavailable.
    finalize(false);
  }, ASYNC_TIMEOUT_MS);

  performTierCheck()
    .then((allowed) => {
      clearTimeout(timeoutHandle);
      writeSessionCache(allowed);
      finalize(allowed);
    })
    .catch((e) => {
      clearTimeout(timeoutHandle);
      console.warn('[prelaunch-guard] tier check failed:', e?.message || e);
      // On hard error, fail closed — redirect rather than expose content.
      finalize(false);
    });

  // ────────────────────────────────────────────────────────────────────
  //                             helpers
  // ────────────────────────────────────────────────────────────────────

  function finalize(allowed) {
    // This only runs for gated (non-allowlisted) pages. Allowlisted pages
    // returned earlier in the synchronous fast-path.
    if (allowed) {
      removeHideStyle();
      return;
    }
    window.location.replace('/comingsoon.html');
  }

  /**
   * Resolve to true if the visitor passes the tier gate.
   *
   * Firebase ownership: as of 2026-05-29 (item 7.5 / TODO #13),
   * feature-flags.js owns Firebase init. This guard awaits
   * CTFeatureFlags.firebaseReady before calling getApp(). The move
   * exists so that init outlives this file's retirement at launch
   * (per the AT LAUNCH checklist, this file is removed; feature-flags.js
   * stays and continues to own init for any post-launch consumer).
   *
   * SDK strategy: modular Firebase 10.12.5 (matching feature-flags.js
   * and the rest of the gated surface). Imports are URL-cached by the
   * browser so other scripts on the page importing the same URL get the
   * same module instance — no duplicate code download.
   *
   * App strategy: uses the DEFAULT app (no name). feature-flags.js
   * creates it via initializeApp(); this guard reuses it via getApp().
   * Crucially, Firebase Auth's IndexedDB persistence keys include the app
   * name (e.g. firebase:authUser:GUID:[DEFAULT]) — so a named app would
   * NOT see the auth state created by the default app. We use the default
   * app to ensure auth state from any sign-in (including index.html's
   * compat-default-app sign-in) flows through to this check.
   *
   * Host pages with their own Firebase usage must also use getApp() (or
   * the getApps().length ? getApp() : initializeApp(...) idempotent
   * pattern) — not an unconditional initializeApp(), which will throw
   * "already exists" once feature-flags.js has run.
   */
  async function performTierCheck() {
    if (!window.CTFeatureFlags) {
      console.warn('[prelaunch-guard] CTFeatureFlags missing — failing closed');
      return false;
    }

    // Wait for feature-flags.js to finish Firebase init. Owns init since
    // 2026-05-29 (item 7.5 / TODO #13) so init outlives this file's
    // retirement at launch.
    try {
      await window.CTFeatureFlags.firebaseReady;
    } catch (e) {
      console.warn('[prelaunch-guard] Firebase init (in feature-flags.js) failed:', e?.message || e);
      return false;
    }

    let getApp, getAuth, onAuthStateChanged, getFirestore;
    try {
      ({ getApp } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'));
      ({ getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'));
      ({ getFirestore } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'));
    } catch (e) {
      console.warn('[prelaunch-guard] failed to load Firebase modular SDK:', e?.message || e);
      return false;
    }

    // feature-flags.js has already called initializeApp() above. getApp()
    // returns the default app it created. If this throws, something is
    // very wrong (feature-flags.js's init silently failed despite
    // firebaseReady resolving) — fail closed.
    let app;
    try {
      app = getApp();
    } catch (e) {
      console.warn('[prelaunch-guard] getApp() failed after firebaseReady:', e?.message || e);
      return false;
    }

    const auth = getAuth(app);
    const db = getFirestore(app);

    const user = await new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
    });

    console.log('[guard-debug] onAuthStateChanged resolved.',
      'user:', user ? user.email : 'null',
      'uid:', user ? user.uid : 'null');

    // Force the SDK to fetch a valid ID token before making any Firestore
    // requests. onAuthStateChanged resolves with the user record, but the
    // Firestore SDK may not have attached an auth token to its request
    // pipeline yet — which causes settings/userTypes reads to fail with
    // permission-denied at page-load time even though the same read works
    // moments later from the console. Awaiting getIdToken() blocks until
    // the token is in place. Failure here is non-fatal: we'll still attempt
    // the read, but it may fail and we'll fall back to default tier.
    if (user) {
      try {
        const token = await user.getIdToken();
        console.log('[guard-debug] getIdToken success. token length:', token.length);
      } catch (e) {
        console.warn('[guard-debug] getIdToken failed:', e?.message || e);
      }
    }

    const minimumTier = await window.CTFeatureFlags.getSiteMinimumTier(db);
    console.log('[guard-debug] minimumTier from Firestore:', minimumTier);

    if (minimumTier === 'public') {
      console.log('[guard-debug] minimumTier=public → allow.');
      return true;
    }
    if (minimumTier === 'closed') {
      console.log('[guard-debug] minimumTier=closed → deny.');
      return false;
    }
    if (!user || !user.email) {
      console.log('[guard-debug] No authenticated user → deny.');
      return false;
    }

    const emailKey = user.email.toLowerCase().replace(/[.@]/g, '_');
    console.log('[guard-debug] Looking up role + paid status for email:', user.email, '→ key:', emailKey);

    // Resolve role and paid status in parallel. Both reads target Firestore
    // and either both succeed or both fail in the same auth-state way, so
    // parallelizing buys ~one round-trip of latency. Promise.all rejects
    // on the first error, which falls through to the catch in finalize()
    // and fails closed — same defensive default as pre-(h).
    //
    // Architecture note (2026-05-18, item h): pre-(h) this was a single
    // getUserRole() read, and paid status was inferred from role==='priority'.
    // After (h), role and paid status are independent axes; getUserIsPaid()
    // reads subscriptions/{emailKey}.status directly.
    const [role, isPaid] = await Promise.all([
      window.CTFeatureFlags.getUserRole(db, user.email),
      window.CTFeatureFlags.getUserIsPaid(db, user.email),
    ]);
    console.log('[guard-debug] role returned by getUserRole:', role);
    console.log('[guard-debug] isPaid returned by getUserIsPaid:', isPaid);

    const hasAccess = window.CTFeatureFlags.hasPaidAccess(role, isPaid, minimumTier);
    console.log('[guard-debug] hasPaidAccess(', role, ',', isPaid, ',', minimumTier, ') →', hasAccess);

    return hasAccess;
  }

  function readSessionCache() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.allowed !== 'boolean' || typeof obj.ts !== 'number') return null;
      if (Date.now() - obj.ts > SESSION_CACHE_TTL_MS) return null;
      return obj.allowed;
    } catch (e) {
      return null;
    }
  }

  function writeSessionCache(allowed) {
    try {
      window.sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
        allowed: !!allowed,
        ts: Date.now()
      }));
    } catch (e) { /* ignore */ }
  }

  function injectHideStyle() {
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = 'body { visibility: hidden !important; }';
    (document.head || document.documentElement).appendChild(style);
  }

  function removeHideStyle() {
    const el = document.getElementById(HIDE_STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function injectNavHide() {
    const style = document.createElement('style');
    style.setAttribute('data-prelaunch-guard', 'nav-hide');
    style.textContent =
      '[data-ct-nav="primary"],' +
      '[data-ct-nav="secondary"],' +
      '.site-nav-bar,' +
      '.nav-bar,' +
      '#pageNav,' +
      '.ct-nav-primary,' +
      '.ct-nav-secondary' +
      '{ display: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  }

  function rewriteMastheadLink() {
    let attempts = 0;
    const maxAttempts = 40;
    function tryRewrite() {
      attempts++;
      const masthead = document.querySelector('[data-ct-nav="masthead"]');
      let rewritten = false;
      if (masthead) {
        const links = masthead.querySelectorAll('a');
        for (let i = 0; i < links.length; i++) {
          links[i].setAttribute('href', '/comingsoon.html');
          rewritten = true;
        }
      }
      const logoLinks = document.querySelectorAll('a.masthead-logo');
      for (let j = 0; j < logoLinks.length; j++) {
        logoLinks[j].setAttribute('href', '/comingsoon.html');
        rewritten = true;
      }
      if (rewritten || attempts >= maxAttempts) return;
      setTimeout(tryRewrite, 100);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryRewrite);
    } else {
      tryRewrite();
    }
  }
})();
