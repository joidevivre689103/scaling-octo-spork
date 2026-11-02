/* ═══════════════════════════════════════════════════════════════════
   THE GRASS BANK — PRE-LAUNCH GUARD (v2: tier-based access)
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
     quiz.html, yorker.html      — Yorker (the quiz; called "The Test
                                   Cricket Oracle" until 2026-08-14)
     (article.html removed 2026-10-21 — it had been allowlisted for the
      coming-soon "Read the evidence" link and hidden behind a client-side
      password that sat in the public source. It now takes the tier check
      like any gated page, and the link is off coming-soon until the
      five-for article is ready.)
     login.html                  — universal auth surface (build item
                                   (a), spec §9.2). Must be reachable
                                   unauthenticated, otherwise the gate
                                   would have nowhere to send people
                                   when they need to sign in. Auth
                                   primitive is built on top of this.
     /yorker/{edition}/...       — permanent edition pages
   On allowlisted pages, nav is hidden (consistent with original guard).

   ─── OWNER BYPASS ─────────────────────────────────────────────────
   Visit any page once with ?preview=<owner preview code>.
   Saved to localStorage, sticky thereafter on that browser/device.

   [2026-11-02] THE CODE ITSELF IS NO LONGER IN THIS FILE. Until today the
   plaintext code sat in a constant here — and this file is served to every
   visitor AND lives in the public repo, so anyone reading the source had a
   ready-made bypass. Now only its SHA-256 hash is stored (OWNER_BYPASS_HASH);
   the guard hashes whatever ?preview= value arrives and compares hashes. The
   hash cannot be turned back into the code. The old code is dead: it stays in
   git history, which is why the code was rotated rather than just moved.
   Keep the code itself OUTSIDE both repos.

   To rotate: pick a new random code (20+ characters), compute its SHA-256
   hex (any online SHA-256 tool, or in a browser console:
     [...new Uint8Array(await crypto.subtle.digest('SHA-256',
       new TextEncoder().encode('NEWCODE')))]
       .map(b => b.toString(16).padStart(2,'0')).join('')
   ), paste the hex into OWNER_BYPASS_HASH and redeploy. Every browser
   holding the old code drops back to the normal tier check.

   Honest limit: this guard runs in the reader's browser, so anyone willing
   to edit JavaScript in DevTools can skip it with or without a code. It hides
   the pre-launch site from ordinary visitors; the real protection for paid
   data is server-side (serveDerivedData re-checks every request).

   ─── ASYNC NOTE ───────────────────────────────────────────────────
   Tier checking requires Firebase Auth + Firestore reads. While that
   resolves, the page is hidden via injected CSS.

   [2026-11-02] SLOW CHECKS NO LONGER LOOK LIKE A "NO". Before today a
   check that ran past ASYNC_TIMEOUT_MS, or whose config read failed (which
   getSiteMinimumTier reports as 'closed'), sent the visitor to comingsoon —
   so a signed-in superadmin on a phone opening the site cold was bounced,
   signed in again, and was bounced again. Now:
     1. An UNCERTAIN result (timeout, error, or a 'closed' reading) gets ONE
        retry with RETRY_TIMEOUT_MS. The SDK files are cached by then, so
        the retry is much faster. The first attempt keeps running too —
        whichever gives a firm answer first wins.
     2. Uncertain results are NEVER written to the session cache. Only firm
        answers are.
     3. If both attempts stay uncertain and we know someone is signed in,
        the page shows a small "taking longer than usual — Try again" note
        instead of redirecting. Content stays hidden; nobody is bounced.
        Signed-out or unknown visitors still go to comingsoon, as before.
   Side effect to know about: a failed config read and a deliberate
   minimumTier = 'closed' look identical to this file, so if 'closed' is ever
   set on purpose, signed-in non-owners see the "Try again" note rather than
   comingsoon. Content stays hidden either way.
   The owner-bypass URL still works regardless of Firestore reachability.

   Allowlisted pages (yorker.html, coming-soon, etc.)
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

  // Owner bypass — SHA-256 of the owner preview code. NOT the code itself;
  // see "OWNER BYPASS" in the header. Rotated 2026-11-02 (the previous
  // plaintext code was public and no longer works).
  const OWNER_BYPASS_HASH = '3de25b36401a354546b49d64b77a3ea7787811c29093d439e532927c7e34b5b9';
  const OWNER_FLAG_KEY = 'ct_owner_preview';

  // How long the FIRST attempt at the tier check gets before it is treated
  // as uncertain and retried (see the [2026-11-02] ASYNC NOTE in the header).
  // Before 2026-11-02 running past this failed CLOSED straight to comingsoon.
  //
  // [2026-08-12] 3000 → 8000. TWO reasons, and the comment this replaces was
  // wrong on both counts: it said "failing open (revealing the page anyway)",
  // which is the opposite of what finalize(false) does, and it called 3 seconds
  // generous.
  //
  //   (1) BUDGET DRIFT. ctPageBootstrap in feature-flags.js raised its own gate
  //       budget 2000 → 5000 on 2026-06-04 after live evidence of signed-in
  //       users being bounced on slow navigations. THIS constant was never
  //       raised to match, so the guard became the tighter of the two gates and
  //       started failing first — which is why a slow load lands on comingsoon
  //       rather than on the bootstrap's login redirect. Observed 2026-08-12: a
  //       first sign-in on a cold Firefox profile went to comingsoon, and the
  //       immediate retry succeeded because everything was then warm.
  //
  //   (2) THE WORK IS NOT SMALL. This check waits for Firebase init, imports
  //       THREE SDK modules, settles auth, forces an ID token, then makes three
  //       Firestore reads. On a cold profile with nothing cached that is not a
  //       sub-second operation, and the typical-round-trip figure the old
  //       comment quoted measured only the last step.
  //
  // 8000 rather than 5000 because this gate does strictly more work than the
  // bootstrap's, and because failing closed here costs a reader the whole site
  // rather than one page. NOTE this file is DELETED at launch per the AT-LAUNCH
  // checklist, so raising a threshold — rather than fixing the tiebreaker
  // properly, as feature-flags.js now does — is a deliberate trade against a
  // known deletion date, not a pattern to copy.
  const ASYNC_TIMEOUT_MS = 8000;

  // [2026-11-02] Budget for the single retry. Shorter than the first, because
  // the SDK files are cached by then and Firebase is already initialised; the
  // first attempt is still allowed to finish during this window.
  const RETRY_TIMEOUT_MS = 6000;

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
  // NOTE: /yorker/<edition>/index.html is unaffected — it matches
  // ALLOWED_SUBPATHS before the filename matters.
  // [2026-08-14] oracle.html -> yorker.html, /oracle/ -> /yorker/ with the Yorker
  // rename. THIS FILE MATCHES ON FILENAME AND PATH, NOT ON CT_PAGE_ID — so it does
  // not follow a page rename automatically. Leaving the old strings here would have
  // dropped the quiz off the pre-launch allowlist entirely: every shared quiz link
  // would fall through to the tier check and bounce a visitor to comingsoon, which
  // is the one page on the site that is deliberately reachable by strangers.
  // The old names are NOT kept alongside — those paths were deleted outright.
  const ALLOWED = ['comingsoon.html', 'quiz.html', 'yorker.html', 'login.html'];
  const HIDE_NAV_ON = ['quiz.html', 'yorker.html'];
  const ALLOWED_SUBPATHS = ['/yorker/'];
  const HIDE_NAV_SUBPATHS = ['/yorker/'];

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
  // [2026-11-02] Compares SHA-256 hashes, never the code itself. Stays
  // synchronous (sha256Hex below is a plain-JS implementation, not the async
  // crypto.subtle) so the bypass still decides before anything renders.
  // localStorage keeps the code the owner typed, and it is re-hashed on every
  // load — so a browser holding a rotated-out code simply stops bypassing.
  function isOwnerCode(v) {
    return typeof v === 'string' && v.length > 0 && sha256Hex(v) === OWNER_BYPASS_HASH;
  }
  let previewParam;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    previewParam = urlParams.get('preview');
    if (isOwnerCode(previewParam)) {
      window.localStorage.setItem(OWNER_FLAG_KEY, previewParam);
    }
    if (isOwnerCode(window.localStorage.getItem(OWNER_FLAG_KEY))) {
      return;
    }
  } catch (e) {
    if (isOwnerCode(previewParam)) {
      return;
    }
  }

  // ─── ALLOWLISTED PAGES — short-circuit synchronously ──────────────
  // Allowlisted pages (coming-soon, article reader, the quiz, etc.) render
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

  // [2026-11-02] Two attempts, firm answers only. performTierCheck resolves
  // to 'allow', 'deny' (firm) or 'unknown' (timed out, threw, or read the
  // tier as 'closed', which is also what a failed config read looks like).
  // Both attempts report into settle(); the first FIRM answer wins, whichever
  // attempt it comes from. See the ASYNC NOTE in the header.
  //
  // signedInSeen is set the moment either attempt sees a signed-in user, so
  // that a check which then stalls on Firestore can still tell "someone is
  // signed in" from "nobody is".
  let settled = false;
  let signedInSeen = false;
  let retryStarted = false;
  let firstTimer = null;
  let retryTimer = null;

  // source is 'first' or 'retry'. A firm answer from either wins. An
  // uncertain answer from the FIRST attempt starts the retry (once); a late
  // uncertain answer from it after that is ignored, so it can't cut the
  // retry short. An uncertain answer from the RETRY ends the wait.
  function settle(verdict, source) {
    if (settled) return;
    if (verdict === 'allow' || verdict === 'deny') {
      settled = true;
      clearTimeout(firstTimer);
      clearTimeout(retryTimer);
      writeSessionCache(verdict === 'allow');
      finalize(verdict === 'allow');
      return;
    }
    if (source === 'first') {
      if (!retryStarted) startRetry();
      return;
    }
    giveUp();
  }

  function runAttempt(label) {
    return performTierCheck()
      .then((v) => {
        console.log('[guard-debug] ' + label + ' attempt →', v);
        return v;
      })
      .catch((e) => {
        console.warn('[prelaunch-guard] ' + label + ' tier check failed:', e?.message || e);
        return 'unknown';
      });
  }

  function startRetry() {
    retryStarted = true;
    clearTimeout(firstTimer);
    console.warn('[prelaunch-guard] tier check uncertain; retrying once');
    retryTimer = setTimeout(() => {
      console.warn('[prelaunch-guard] retry timed out');
      settle('unknown', 'retry');
    }, RETRY_TIMEOUT_MS);
    runAttempt('retry').then((v) => settle(v, 'retry'));
  }

  function giveUp() {
    if (settled) return;
    settled = true;
    clearTimeout(firstTimer);
    clearTimeout(retryTimer);
    if (signedInSeen) {
      // A signed-in reader is never sent to comingsoon just because the check
      // was slow. Content stays hidden; they get a "Try again" note.
      console.warn('[prelaunch-guard] still uncertain for a signed-in user — showing retry note, not redirecting');
      showSlowNote();
    } else {
      // Nobody signed in (or auth itself never answered): same as before.
      console.warn('[prelaunch-guard] still uncertain, no signed-in user seen — failing closed');
      finalize(false);
    }
  }

  firstTimer = setTimeout(() => {
    console.warn('[prelaunch-guard] first tier check timed out');
    settle('unknown', 'first');
  }, ASYNC_TIMEOUT_MS);

  // The first attempt keeps running after a timeout starts the retry — a late
  // FIRM answer from it is still accepted.
  runAttempt('first').then((v) => settle(v, 'first'));

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
   * Resolve to 'allow' or 'deny' (FIRM answers, safe to cache) or 'unknown'
   * (could not get a trustworthy answer — retried once, never cached).
   * [2026-11-02] Was a plain true/false, which made "the check broke" and
   * "this person may not enter" look identical.
   *
   * Firebase ownership: as of 2026-05-29 (item 7.5 / TODO #13),
   * feature-flags.js owns Firebase init. This guard awaits
   * CTFeatureFlags.firebaseReady before calling getApp(). The move
   * exists so that init outlives this file's retirement at launch
   * (per the AT LAUNCH checklist, this file is removed; feature-flags.js
   * stays and continues to own init for any post-launch consumer).
   *
   * SDK strategy: modular Firebase 13.0.0 (matching feature-flags.js
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
      console.warn('[prelaunch-guard] CTFeatureFlags missing');
      return 'unknown';
    }

    // Wait for feature-flags.js to finish Firebase init. Owns init since
    // 2026-05-29 (item 7.5 / TODO #13) so init outlives this file's
    // retirement at launch.
    try {
      await window.CTFeatureFlags.firebaseReady;
    } catch (e) {
      console.warn('[prelaunch-guard] Firebase init (in feature-flags.js) failed:', e?.message || e);
      return 'unknown';
    }

    let getApp, getAuth, onAuthStateChanged, getFirestore;
    try {
      ({ getApp } = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'));
      ({ getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js'));
      ({ getFirestore } = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js'));
    } catch (e) {
      console.warn('[prelaunch-guard] failed to load Firebase modular SDK:', e?.message || e);
      return 'unknown';
    }

    // feature-flags.js has already called initializeApp() above. getApp()
    // returns the default app it created. If this throws, something is
    // very wrong (feature-flags.js's init silently failed despite
    // firebaseReady resolving) — uncertain, not a firm deny.
    let app;
    try {
      app = getApp();
    } catch (e) {
      console.warn('[prelaunch-guard] getApp() failed after firebaseReady:', e?.message || e);
      return 'unknown';
    }

    const auth = getAuth(app);
    const db = getFirestore(app);

    const user = await new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
    });

    console.log('[guard-debug] onAuthStateChanged resolved.',
      'user:', user ? user.email : 'null',
      'uid:', user ? user.uid : 'null');

    // [2026-11-02] Remember that a signed-in user exists, so that if the
    // Firestore reads below then stall, the give-up path shows a retry note
    // instead of bouncing them to comingsoon.
    if (user) signedInSeen = true;

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
      return 'allow';
    }
    if (minimumTier === 'closed') {
      // [2026-11-02] getSiteMinimumTier ALSO returns 'closed' when the config
      // read fails, so 'closed' cannot be trusted as a firm answer. Treat it as
      // uncertain: it is still a deny in the end (after one retry), just never
      // cached and never a bounce for a signed-in reader.
      console.log('[guard-debug] minimumTier=closed (configured, or config read failed) → uncertain.');
      return 'unknown';
    }
    if (!user || !user.email) {
      console.log('[guard-debug] No authenticated user → deny.');
      return 'deny';
    }

    const emailKey = user.email.toLowerCase().replace(/[.@]/g, '_');
    console.log('[guard-debug] Looking up role + paid status for email:', user.email, '→ key:', emailKey);

    // Resolve role and paid status in parallel. Both reads target Firestore
    // and either both succeed or both fail in the same auth-state way, so
    // parallelizing buys ~one round-trip of latency. Both helpers swallow
    // their own errors (role → 'none', paid → false); anything that still
    // throws is caught by runAttempt and treated as uncertain.
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

    // [2026-10-20] Granted paid access (role 'paidSubscriber', admin label
    // "Paid access (granted)") counts as paid here, as it already does on the
    // paid pages and in serveDerivedData. getUserIsPaid() is Stripe-only, so
    // before this a comped reader was sent to comingsoon until launch.
    const hasAccess = window.CTFeatureFlags.hasPaidAccess(role, isPaid || role === 'paidSubscriber', minimumTier);
    console.log('[guard-debug] hasPaidAccess(', role, ',', isPaid, ',', minimumTier, ') →', hasAccess);

    return hasAccess ? 'allow' : 'deny';
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

  // [2026-11-02] Shown instead of a redirect when a signed-in reader's check
  // could not finish (see giveUp). The page itself stays hidden — only this
  // note is made visible (a visible child of a visibility:hidden body shows).
  // Kept deliberately short, in the site's palette, no external fonts.
  function showSlowNote() {
    function mount() {
      if (document.getElementById('ct-guard-slow')) return;
      const box = document.createElement('div');
      box.id = 'ct-guard-slow';
      box.setAttribute('role', 'alert');
      box.style.cssText =
        'visibility:visible;position:fixed;inset:0;display:flex;align-items:center;' +
        'justify-content:center;padding:16px;background:#fbf8f1;z-index:2147483647;' +
        'font-family:Georgia,"Times New Roman",serif;color:#1a1208;text-align:center;';
      box.innerHTML =
        '<div style="max-width:340px">' +
          '<p style="font-size:18px;line-height:1.5;margin:0 0 20px">' +
            'This page is taking longer than usual to load.' +
          '</p>' +
          '<button type="button" style="font:inherit;font-size:16px;padding:10px 22px;' +
            'background:#8b1a1a;color:#fbf8f1;border:0;border-radius:4px;cursor:pointer">' +
            'Try again</button>' +
        '</div>';
      box.querySelector('button').addEventListener('click', () => window.location.reload());
      document.body.appendChild(box);
    }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  // [2026-11-02] Synchronous SHA-256 → lowercase hex, for the owner bypass.
  // Plain JS so the bypass decision stays synchronous (crypto.subtle is async).
  // Standard FIPS 180-4; input is UTF-8 encoded first. Checked against Node's
  // crypto on empty, short, multi-block and non-ASCII inputs before shipping.
  function sha256Hex(str) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const bytes = unescape(encodeURIComponent(str));   // UTF-8 as a byte string
    const len = bytes.length;
    const words = new Array(((len + 9 + 63) >> 6) << 4).fill(0);
    for (let i = 0; i < len; i++) words[i >> 2] |= (bytes.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    words[words.length - 1] = len * 8;   // bit length (codes are short; high word stays 0)
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let j = 0; j < words.length; j += 16) {
      for (let t = 0; t < 64; t++) {
        if (t < 16) {
          w[t] = words[j + t] | 0;
        } else {
          const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
          const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
          w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
        }
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map((x) => ('00000000' + (x >>> 0).toString(16)).slice(-8))
      .join('');
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
