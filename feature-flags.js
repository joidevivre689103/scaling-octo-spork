/* feature-flags.js
 * --------------------------------------------------------------------------
 * Cricket Times — Feature Flags + Tier-based Access Control
 *
 * Single source of truth for "who can see what" across the site. Combines:
 *   - config/featureFlags.site.minimumTier  → site-wide access gate
 *   - settings/userTypes[email_key]         → per-user role (post-e: ops only)
 *   - subscriptions/{emailKey}.status       → per-user paid status (post-h)
 *   - settings/featureGates                  → per-page/per-feature tiers (post-e)
 *
 * Also (added 2026-05-29, item 7.5 / TODO #13): the SOLE owner of Firebase
 * init across the gated surface. Other scripts await CTFeatureFlags.
 * firebaseReady before calling getApp(). See the FIREBASE INIT block at the
 * top of the IIFE for SDK-version bump discipline.
 *
 * The tier ladder (lowest to highest), post-item-(e):
 *   public    — everyone, signed in or not
 *   beta      — beta testers (also serves as the pre-launch site gate)
 *   admin     — site administrators
 *   superadmin — site owner
 *   closed    — special: nobody (used pre-launch when even owners use ?preview=)
 *
 * Retired in item (e), 2026-05-20:
 *   regular  — was "any signed-in user". Replaced by 'none' as the implicit
 *              default for users with no entry in settings/userTypes.
 *              No longer a TIER_RANK value. Stale entries map silently.
 *   priority — was the pre-launch beta gate. Replaced by 'beta'. Still
 *              accepted as input by hasPaidAccess for backward compat with
 *              any config/featureFlags.site.minimumTier docs that still
 *              carry the old value on disk; mapped to 'beta' semantics.
 *
 * `minimumTier` is the gate: a user passes if their role's rank >= the gate's
 * rank. `closed` is a special gate that everyone fails — only the URL-bypass
 * gets through.
 *
 * Two-axis architecture (item h, 2026-05-18): operational role
 * (settings/userTypes, carries beta/admin/superadmin only) and paid status
 * (subscriptions/{emailKey}.status, driven by Stripe webhook).
 *
 * After item (e), the canonical access primitive is `requireAccess(db, {page,
 * feature, email})` which consults settings/featureGates. The legacy
 * `hasSiteAccess` / `hasPaidAccess` are retained for the pre-launch site
 * gate (prelaunch-guard.js) and any caller that hasn't migrated yet.
 *
 * --------------------------------------------------------------------------
 * Public API (attached to window.CTFeatureFlags):
 *   - TIER_RANK: object mapping tier name → numeric rank
 *   - emailToKey(email): converts an email to its `settings/userTypes` key
 *   - getSiteMinimumTier(db): Promise<string> — reads config/featureFlags
 *   - getUserRole(db, email): Promise<string> — reads settings/userTypes
 *   - getUserIsPaid(db, email): Promise<boolean> — reads subscriptions/{emailKey}.status
 *     (added 2026-05-18, item h)
 *   - getFeatureGates(db, { bypassCache? }): Promise<FeatureGates> — reads
 *     settings/featureGates with 5-min session cache
 *     (added 2026-05-20, item e)
 *   - requireAccess(db, { page?, feature?, email? }): Promise<Verdict> — the
 *     single primitive every gated page should consult
 *     (added 2026-05-20, item e)
 *   - hasSiteAccess(userRole, minimumTier): boolean — legacy rank comparison
 *   - hasPaidAccess(userRole, isPaid, minimumTier): boolean — axis-aware
 *     (added 2026-05-18, item h; prefer this over hasSiteAccess for new code)
 *   - firebaseReady: Promise<FirebaseApp> — resolves once initializeApp()
 *     has been called. Await before any getApp() call in any consumer.
 *     (added 2026-05-29, item 7.5 / TODO #13)
 * -------------------------------------------------------------------------- */
(function () {
  'use strict';

  // First executable line: the load-watchdog's liveness flag. The deploy-tool
  // injects an inline watchdog that, at 2.5s, redirects to /comingsoon.html
  // if this is still falsy — i.e. if feature-flags.js never loaded. Set at
  // SCRIPT-LOAD (not bootstrap-completion) on purpose: the watchdog then
  // guards exactly one failure domain ("this file never loaded") and never
  // races ctPageBootstrap's own gate budget (5s as of 2026-06-04; the
  // contract's original 2s — see the [2026-06-04] tags in the bootstrap).
  // COROLLARY: once this flag is set, the watchdog is satisfied — it does
  // NOT backstop stalls or throws inside ctPageBootstrap. The bootstrap's
  // own try/catch + timeout tiebreaker are the only safety net there.
  // (Contract §5/Q4, §6.)
  window.__ctFlagsLoaded = true;

  // ─── FIREBASE INIT ───────────────────────────────────────────────────
  // feature-flags.js is the SOLE owner of Firebase init across the gated
  // surface. Other scripts (prelaunch-guard.js today; page-level scripts
  // post-launch) await CTFeatureFlags.firebaseReady before calling getApp().
  //
  // Why this lives here and not in prelaunch-guard.js: at launch,
  // prelaunch-guard.js retires (per AT LAUNCH checklist). feature-flags.js
  // stays on every gated page. Init must outlive the prelaunch guard, so
  // it lives in the file that survives.
  //
  // SDK VERSION DISCIPLINE — READ THIS BEFORE BUMPING:
  //   The Firebase JS SDK version (10.12.5) is duplicated across every
  //   file that touches Firebase — pages, helpers, this file. That is
  //   intentional: each consumer is independently versioned so pages can
  //   be migrated one at a time. Cross-version Firestore objects fail
  //   type-check silently (collection()/doc() from one version produce
  //   objects another version's getDocs() rejects). To bump:
  //
  //     1. `grep -r "firebasejs/10\.12\.5"` to enumerate every file.
  //     2. Update every match to the new version in one commit.
  //     3. Bulk-deploy via github-deploy-tool.html.
  //     4. Spot-check login.html, bts.html, and one stats page.
  //
  //   See technicaldocs.html, 7.5 Session 1 card, for the full procedure
  //   and rationale (Option 1, no namespace, grep-and-sweep on bump).
  // ──────────────────────────────────────────────────────────────────────
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBnfn9hK0y-p6nvIZ_AwoJnWD7DfDuIQd4',
    authDomain: 'hitwicket-cba02.firebaseapp.com',
    projectId: 'hitwicket-cba02',
    storageBucket: 'hitwicket-cba02.firebasestorage.app',
    messagingSenderId: '196915483829',
    appId: '1:196915483829:web:071c47af79914aec88dafc'
  };

  // Kick off Firebase init eagerly. The outer IIFE is synchronous and
  // returns immediately; the inner async IIFE runs in the background and
  // resolves firebaseReady when initializeApp() has been called. Consumers
  // must `await window.CTFeatureFlags.firebaseReady` before calling
  // getApp() — otherwise getApp() may throw if their script runs before
  // the dynamic import resolves.
  //
  // Idempotent: getApps().length check defends against the unlikely case
  // that another script already initialized (e.g. a stale build during a
  // transition deploy). Throwing the second time would deadlock the page.
  const firebaseReady = (async () => {
    const { initializeApp, getApps, getApp } = await import(
      'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'
    );
    return getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
  })();
  // Swallow the bare-promise rejection so a transient init failure doesn't
  // surface as an unhandled-rejection on every gated page. Consumers that
  // explicitly await firebaseReady still see the rejection and can fail
  // closed in their own context (see prelaunch-guard.js performTierCheck).
  firebaseReady.catch(() => {});

  // ─── PAGE BOOTSTRAP (7-G runtime · sub-task 7.5 Session 3) ─────────────
  // The runtime half of the 7-G injection scheme. On every *injected* gated
  // page the deploy-tool stamps four <head> artifacts: window.CT_PAGE_ID,
  // body{visibility:hidden}, this script, and a load-watchdog. ctPageBootstrap
  // awaits auth, calls requireAccess, and resolves the page to revealed or
  // redirected.  Spec: technicaldocs.html#td-subtask-7.5-session-2-bootstrap-spec.
  //
  // THREE reconciliations against the S2 contract were forced by the real
  // item-(e) requireAccess shape and the real init state of this file. Each is
  // tagged [S3-DEV n] inline. See the 7.5 S3 session card for the full writeup.
  //
  // [S3-DEV 1] Absent CT_PAGE_ID is a NO-OP, not a redirect.
  //   The contract said "no pageId → fail closed → /comingsoon.html". But
  //   feature-flags.js is *also* loaded by NON-injected pages that correctly
  //   have no CT_PAGE_ID — exception-list pages (admin.html, cms.html, …) that
  //   pull this file in for requireAccess / featureGates. Redirecting them
  //   would bounce the owner out of admin to comingsoon. Injection is atomic
  //   (CT_PAGE_ID and this <script> are stamped together), so a genuine gated
  //   page cannot lose only its ID; therefore absence means "not an injection
  //   target" → do nothing. A present-but-malformed pageId still fails closed
  //   (requireAccess → not in any featureGates bucket → denyTarget → comingsoon).

  // TIMEOUT sentinel for withTimeout. Symbol so it can never collide with a
  // real verdict object.
  const CT_TIMEOUT = Symbol('ct-bootstrap-timeout');

  // [Contract §5/Q2] "auth has settled" = the FIRST onAuthStateChanged
  // emission, then unsubscribe. NOT a currentUser-first read: currentUser is
  // synchronously null before Firebase rehydrates a persisted session, so a
  // null read can't tell "anonymous" from "not yet restored". The first
  // emission fires only after persistence resolves — the authoritative barrier.
  // Takes onAuthStateChanged as an arg (rather than closing over an import) so
  // the helper is SDK-version-agnostic — the long-term fix for the cross-
  // version Firestore/Auth gotcha.
  function authSettled(auth, onAuthStateChanged) {
    return new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (user) => { unsub(); resolve(user); });
    });
  }

  // Resolves fn()'s result, or CT_TIMEOUT if ms elapses first. The losing
  // branch is abandoned (its later settle is ignored), not cancelled.
  function withTimeout(ms, fn) {
    return Promise.race([
      Promise.resolve().then(fn),
      new Promise((resolve) => setTimeout(() => resolve(CT_TIMEOUT), ms))
    ]);
  }

  // Clear the injected body{visibility:hidden}. Inline style so it wins over
  // the injected <style> regardless of cascade order. Guarded for the rare
  // case the verdict resolves before <body> has parsed.
  function reveal() {
    const show = () => { if (document.body) document.body.style.visibility = 'visible'; };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  }

  // location.replace so the gated URL doesn't pollute history (back button
  // must not bounce the user between a gated page and its redirect target).
  function redirect(url) { location.replace(url); }

  // [S3-DEV 2] denyTarget re-reads featureGates to classify the page.
  //   The contract's §4 table keyed on verdict.reason ∈ {denied, not_configured}
  //   and verdict.tier ∈ {paid, beta}. The REAL item-(e) requireAccess produces
  //   none of those: denial reasons are 'not-signed-in' / 'not-allowed', and
  //   `tier` reports what the user IS ('anonymous'|'loggedIn'|'paid'), never
  //   what the page REQUIRES, and never 'beta'. So the verdict alone cannot say
  //   whether a denied page is paid (→ subscribe), beta-only (→ home), or
  //   unconfigured (→ comingsoon). denyTarget therefore re-consults
  //   getFeatureGates — a cache hit, since requireAccess populated it
  //   milliseconds earlier (5-min TTL). requireAccess stays untouched, and this
  //   honours the contract's own principle that the redirect mapping is owned
  //   by the bootstrap, not by requireAccess.
  async function denyTarget(db, email, pageId) {
    const gates = await getFeatureGates(db);
    const inPaid     = gates.paid.pages.includes(pageId);
    const inBeta     = gates.beta.pages.includes(pageId);
    const inLoggedIn = gates.loggedIn.pages.includes(pageId);
    const inFree     = gates.free.pages.includes(pageId);
    const configured = inPaid || inBeta || inLoggedIn || inFree;

    // Page absent from every bucket → config error. Fail closed.
    if (!configured) return '/comingsoon.html';

    // Anonymous user on a non-free page → needs auth; login returns to path.
    // Param is `returnUrl` to match login.html (item a), which reads
    // params.get('returnUrl') and runs it through safeReturnUrl() — a
    // same-origin open-redirect guard that defaults to '/'. The S2 contract
    // said `return`; login.html is the shipped consumer, so the bootstrap
    // aligns to it (correct the canonical spec, not this). location.search is
    // included so a deep link to a gated page keeps its query through login.
    if (!email) return '/login.html?returnUrl=' + encodeURIComponent(location.pathname + location.search);

    // Signed in but not entitled:
    //   - paid page (incl. paid+beta): subscribing grants access → subscribe.
    //   - beta-ONLY page (in beta, not in paid): subscribing won't help — beta
    //     is role-granted → home with a soft notice. Currently UNREACHABLE
    //     (every beta page is also paid today, so `inBeta && !inPaid` is empty);
    //     kept for future beta-only pages. [§8 beta-deny UX: query param, the
    //     lightest mechanism — home can render a dismissible banner off it.]
    if (inPaid) return '/subscribe.html';
    if (inBeta) return '/?betaDenied=1';

    // loggedIn page yet still denied shouldn't occur (any signed-in user passes
    // loggedIn). Defensive fallback → home.
    return '/';
  }

  // The bootstrap. Self-invokes at load; no-ops on non-injected pages.
  (async function ctPageBootstrap() {
    const pageId = window.CT_PAGE_ID;
    if (!pageId) return;                          // [S3-DEV 1] not a target → no-op.

    // ── ORACLE EDITION CARVE-OUT [(g) 2026-06-03] ─────────────────────────
    // Editorial model for /oracle/{slug}/ permalinks (all share the single
    // pageId 'oracleEdition', PAID bucket):
    //   (a) the CURRENT edition is free — the gate compares the URL slug to
    //       config/currentOracle, so rotation flips the outgoing edition to
    //       paid automatically, no deploys or gate-map edits;
    //   (b) archived editions fall through to the normal paid gate;
    //   (c) SHARED LINKS carry ?s=1 — a marker that grants durable access to
    //       that one edition (persisted per-browser in localStorage), so a
    //       recipient can take/retake the shared quiz but hits the paywall on
    //       any other archived edition.
    // Checks run cheapest-first: the share path needs no network and no auth
    // settling, so viral visitors reveal instantly. The pointer read runs
    // under the same gate budget as the main gate (5s as of 2026-06-04);
    // on timeout/error it falls
    // CLOSED to the paid gate (never open). KNOWN TRADE: the marker is
    // client-visible and forgeable, and the grant is per-browser — this is a
    // discovery-level paywall by deliberate choice, not an oversight.
    if (pageId === 'oracleEdition') {
      const m = location.pathname.match(/^\/oracle\/([^\/]+)\//i);
      const slug = m ? decodeURIComponent(m[1]).toLowerCase() : null;
      if (slug) {
        const grantKey = 'ct_oracle_grant_' + slug;
        const hasMarker = new URLSearchParams(location.search).get('s') === '1';
        let granted = hasMarker;
        try {
          if (hasMarker) localStorage.setItem(grantKey, '1');
          else granted = localStorage.getItem(grantKey) === '1';
        } catch (e) { /* storage unavailable (private mode) → marker-only */ }
        if (granted) return reveal();

        let isCurrent = false;
        try {
          // [2026-06-04] 2000→5000: live testing showed real navigations
          // exceeding the S2-era 2s budget, gate-racing signed-in users to
          // login. The timeout is a hang-backstop, not the normal path —
          // fast loads are unaffected; see matching change in the main gate.
          isCurrent = await withTimeout(5000, async () => {
            const app = await firebaseReady;
            const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
            const snap = await fs.getDoc(fs.doc(fs.getFirestore(app), 'config', 'currentOracle'));
            return snap.exists() && String(snap.data().editionId || '').toLowerCase() === slug;
          });
        } catch (e) {
          // Init/read threw (not a timeout). Fall CLOSED to the paid gate —
          // an unhandled throw here would strand the page hidden INDEFINITELY.
          // [2026-06-05] Corrected: the 2.5s watchdog does NOT backstop this —
          // it checks __ctFlagsLoaded, which was set at script load, so it is
          // already satisfied by the time the bootstrap runs. This catch is
          // the only thing standing between a throw and a permanently hidden
          // page. Do not remove it.
          console.warn('[ct-bootstrap] oracle pointer check failed — falling to paid gate', (e && e.message) || e);
          isCurrent = false;
        }
        if (isCurrent === true) return reveal();
        if (isCurrent === CT_TIMEOUT) {
          console.warn('[ct-bootstrap] oracle pointer check timed out — falling to paid gate');
        }
      }
      // Not granted, not current → the normal paid gate below decides.
    }
    // ── end oracle carve-out ──────────────────────────────────────────────


    // Captured out here so the timeout tiebreaker (and denyTarget on the
    // success path) can read them even if a later step is what stalled.
    // [2026-06-04] gates added: the tier-aware tiebreaker below needs to know
    // whether the page is FREE even when a later step (auth/requireAccess)
    // is what timed out.
    let auth = null, db = null, email = null, gates = null;

    let verdict;
    try {
      // [Contract §6] the gate budget wraps steps 2–4 (init → auth → access);
      // the contract specified 2s — superseded below.
      // [2026-06-04] 2000→5000 — deviation from the locked S2 budget,
      // evidence-driven: two live gate-races in one day of testing (signed-in
      // admin bounced to login on slow navigations). The serial chain inside
      // this budget (SDK import → app init → featureGates read → auth
      // settling → requireAccess reads) outgrew 2s on real-world latency.
      // Anonymous visitors are unaffected: a no-session auth emission is
      // fast, so the timeout only binds on genuinely slow/hung loads.
      // Update the S2 contract doc when next open.
      verdict = await withTimeout(5000, async () => {
        const app = await firebaseReady;                                   // 2
        const [fs, au] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'),
          import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')
        ]);
        // [S3-DEV 3] Build db/auth here. The contract assumed feature-flags.js
        //   already exposed db/auth handles; it never did — every helper takes
        //   db as a parameter and this file had no Auth dependency at all
        //   before S3. getFirestore/getAuth are idempotent per app and the
        //   dynamic imports are module-cached, so this is cheap. NOTE: this
        //   adds firebase-auth.js as a NEW pinned-version surface in this file
        //   — the grep-and-sweep on the v12 bump must catch it too.
        db   = fs.getFirestore(app);
        auth = au.getAuth(app);
        // [2026-06-04] Explicit gates read BEFORE auth settling, captured for
        // the tiebreaker. Not a second Firestore read: getFeatureGates caches
        // for 5 minutes, so requireAccess below reuses this result. Ordering
        // matters — gates land even if auth settling is the step that stalls.
        gates = await getFeatureGates(db);
        const user = await authSettled(auth, au.onAuthStateChanged);        // 3
        email = user ? user.email : null;
        return requireAccess(db, { page: pageId, email });                  // 4 (db first)
      });
    } catch (e) {
      // Init / import / auth threw. Treat like a timeout: the tiebreaker below
      // decides (anon → fail closed, signed-in → fail open). requireAccess
      // itself never throws — it fails closed to a deny verdict internally.
      console.warn('[ct-bootstrap] error page=' + pageId + ' ' + ((e && e.message) || e));
      verdict = CT_TIMEOUT;
    }

    // [Contract §5/Q3] Timeout tiebreaker. Knowing "signed in" needs auth to
    // have settled — which is what timed out — so read currentUser synchronously.
    //   currentUser non-null → fail OPEN (reveal + warn). The requireAccess
    //     Firestore read stalled; a confirmed session is the lesser risk.
    //   currentUser null/absent → fail CLOSED (login). No confirmable session.
    // console.warn ONLY — never write a diagnostic to Firestore during a
    // Firestore stall.
    if (verdict === CT_TIMEOUT) {
      // [2026-06-04] Tier-aware first check — deviation #2 from the locked S2
      // tiebreaker, evidence-driven: a slow load of a FREE page was bouncing
      // anonymous visitors to login (observed live: sign-out reload of
      // stories.html). Free pages never require auth, so a timeout on one
      // should reveal, not demand a session. Only applies when the gates read
      // completed before the stall; otherwise tier is unknown → fall through
      // to the original auth-based tiebreaker. Update the S2 contract doc.
      if (gates && gates.free && gates.free.pages && gates.free.pages.indexOf(pageId) !== -1) {
        console.warn('[ct-bootstrap] timeout on free page → reveal page=' + pageId);
        return reveal();
      }
      if (auth && auth.currentUser) {
        console.warn('[ct-bootstrap] fail-open timeout page=' + pageId);
        return reveal();
      }
      return redirect('/login.html?returnUrl=' + encodeURIComponent(location.pathname + location.search));
    }

    // Real verdict → reveal or redirect.
    if (verdict.allowed) return reveal();
    return redirect(await denyTarget(db, email, pageId));   // [S3-DEV 2]
  })();

  // Numeric ranks. `closed` is a sentinel that never matches any user role,
  // so the gate always fails for everyone except the owner-bypass URL.
  //
  // Item (e) retirement notes:
  //   - 'regular' (rank 1) removed entirely. New role values from admin.html
  //     are none/beta/admin/superadmin. 'none' is implicit (no rank assigned;
  //     fails any non-public gate) — kept out of TIER_RANK on purpose.
  //   - 'priority' (was rank 2) removed as a ROLE value, but still accepted
  //     as a minimumTier INPUT to hasPaidAccess for backward compat with
  //     unmigrated config docs on disk. See hasPaidAccess.
  //   - 'beta' (rank 2) added. Same rank priority used to occupy; semantically
  //     "beta testers + admins" passes the gate. Note that beta is ALSO
  //     handled as an overlay by hasPaidAccess and requireAccess — the
  //     rank is the fallback used by the legacy hasSiteAccess only.
  const TIER_RANK = {
    public:     0,
    beta:       2,
    admin:      3,
    superadmin: 4,
    closed:     999  // gate sentinel only — no user is ever assigned this
  };

  const DEFAULT_TIER = 'closed';      // fail closed if config can't be read
  const DEFAULT_USER_ROLE = 'none';   // post-(e) replaces 'regular'; users
                                      // with no settings/userTypes entry are
                                      // 'none' — outside the TIER_RANK ladder.

  /**
   * Encode email to the form used as a key in settings/userTypes.
   * Matches admin.html line 1204: `email.replace(/[.@]/g, '_')`.
   */
  function emailToKey(email) {
    if (!email || typeof email !== 'string') return '';
    return email.toLowerCase().replace(/[.@]/g, '_');
  }

  /**
   * Read config/featureFlags.site.minimumTier.
   * Accepts either compat (`db.collection`) or modular (`db` from getFirestore) SDKs.
   * Returns one of TIER_RANK keys. Falls back to `closed` on any error
   * (failing closed is correct for an access gate).
   *
   * Legacy values: 'priority' on disk is mapped to 'beta'; 'regular' is
   * mapped to 'public'. These mirror the defensive mapping in admin.html's
   * loadSiteMinTier so the doc behaves consistently whether read by the
   * admin tab or by site code.
   */
  async function getSiteMinimumTier(db) {
    try {
      const data = await readDoc(db, 'config', 'featureFlags');
      let t = data && data.site && data.site.minimumTier;
      // Map legacy values up front so the validation check passes.
      if (t === 'priority') t = 'beta';
      if (t === 'regular')  t = 'public';
      if (typeof t === 'string' && Object.prototype.hasOwnProperty.call(TIER_RANK, t)) {
        return t;
      }
    } catch (e) {
      console.warn('[feature-flags] getSiteMinimumTier failed:', e?.message || e);
    }
    return DEFAULT_TIER;
  }

  /**
   * Read a user's role from settings/userTypes. Returns one of TIER_RANK
   * keys (excluding `closed`) OR 'none' if the email isn't listed or the
   * stored role isn't a known TIER_RANK value (e.g. legacy 'priority' or
   * 'regular' entries from before item (e); those map silently to 'none').
   */
  async function getUserRole(db, email) {
    if (!email) return DEFAULT_USER_ROLE;
    try {
      const data = await readDoc(db, 'settings', 'userTypes');
      const role = data && data[emailToKey(email)];
      if (typeof role === 'string' && Object.prototype.hasOwnProperty.call(TIER_RANK, role)) {
        return role;
      }
    } catch (e) {
      console.warn('[feature-flags] getUserRole failed:', e?.message || e);
    }
    return DEFAULT_USER_ROLE;
  }

  /**
   * Pure comparison: does this user's role meet or exceed the gate?
   * Both args are tier name strings.
   *
   * Legacy rank-only function — preserved for prelaunch-guard.js and any
   * caller that doesn't pass isPaid. New code should prefer requireAccess
   * (the featureGates-aware primitive) or hasPaidAccess.
   *
   * Post-(e) ranks: public(0), beta(2), admin(3), superadmin(4). Roles
   * not in TIER_RANK (e.g. 'none', legacy 'regular', legacy 'priority')
   * fail any gate above 'public' — returns false from the typeof guard.
   */
  function hasSiteAccess(userRole, minimumTier) {
    // Defensive: map legacy minimumTier values to their item-(e) equivalents
    // so unmigrated config docs on disk don't silently lock everyone out.
    //   'priority' → 'beta'   (same semantic: beta testers + admins pass)
    //   'regular'  → 'public' (closest match: 'regular' meant any signed-in
    //                          user, but there's no rank for that post-(e);
    //                          map to 'public' so the gate stays open
    //                          rather than locking out users who were
    //                          previously allowed)
    // Note: legacy userRole values 'priority'/'regular' are already filtered
    // out by getUserRole (which returns 'none' for any unrecognized role),
    // so we only need to defend minimumTier inputs.
    if (minimumTier === 'priority') minimumTier = 'beta';
    if (minimumTier === 'regular')  minimumTier = 'public';
    const u = TIER_RANK[userRole];
    const m = TIER_RANK[minimumTier];
    if (typeof u !== 'number' || typeof m !== 'number') return false;
    return u >= m;
  }

  /**
   * Read paid status from subscriptions/{emailKey}.status. Returns true if
   * the doc exists and status is one of ['active', 'past_due']:
   *   - 'active':   normal paid subscriber
   *   - 'past_due': renewal payment failed but Stripe Smart Retries are
   *                 still running. We preserve access during this grace
   *                 window — same policy as the rules-side isPaidSubscriber.
   * Returns false on any other status, on doc-not-exists, on rules denial,
   * or on network error. Failing closed is correct for an access signal.
   *
   * The rules grant owner-read on subscriptions/{emailKey} (matched via
   * caller's auth token email == emailKey), so this read works for the
   * signed-in user reading their own subscription.
   *
   * Added 2026-05-18 (item h). The single source of truth for client-side
   * paid-axis reads after the role/paid decoupling.
   */
  async function getUserIsPaid(db, email) {
    if (!email) return false;
    try {
      const data = await readDoc(db, 'subscriptions', emailToKey(email));
      if (!data) return false;
      const status = data.status;
      return status === 'active' || status === 'past_due';
    } catch (e) {
      console.warn('[feature-flags] getUserIsPaid failed:', e?.message || e);
      return false;
    }
  }

  /**
   * Axis-aware access check: does this user pass the site-wide gate?
   *
   * Behaviour by minimumTier:
   *   - 'beta' (new, post-(e)) OR 'priority' (legacy, pre-(e)): passes if
   *     isPaid OR role is 'beta' OR role rank >= admin. The two tier
   *     values are treated identically — 'priority' is the disk-state
   *     legacy alias for 'beta'. This disjunction lets paid subscribers,
   *     beta testers, and admins all through the pre-launch beta gate.
   *
   *   - All other tiers ('public', 'admin', 'superadmin', 'closed'):
   *     delegates to hasSiteAccess — those tier values don't involve paid
   *     status, so rank comparison is correct.
   *
   * Note: 'beta' role is checked via string equality, NOT just rank, even
   * though it now has a rank in TIER_RANK. This preserves the overlay
   * semantic: a beta user passes the 'beta' gate not because their rank
   * happens to match, but because their role is explicitly 'beta'.
   *
   * Added 2026-05-18 (item h). Updated 2026-05-20 (item e) to accept
   * 'beta' as a synonym for the legacy 'priority' minimumTier value.
   */
  function hasPaidAccess(userRole, isPaid, minimumTier) {
    // Both 'beta' (post-e) and 'priority' (pre-e, may still be on disk)
    // trigger the disjunction. The defensive admin.html mapping in
    // loadSiteMinTier translates 'priority' → 'beta' for display, but the
    // on-disk doc may still hold 'priority' until someone saves it.
    if (minimumTier === 'beta' || minimumTier === 'priority') {
      if (isPaid) return true;
      if (userRole === 'beta') return true;
      const u = TIER_RANK[userRole];
      const adminRank = TIER_RANK.admin;
      if (typeof u !== 'number' || typeof adminRank !== 'number') return false;
      return u >= adminRank;
    }
    return hasSiteAccess(userRole, minimumTier);
  }

  // ─────────────────────────────────────────────────────────────────────
  // featureGates: cached reader for settings/featureGates
  // ─────────────────────────────────────────────────────────────────────
  // Single doc describing per-page and per-feature access tiers. Schema:
  //   {
  //     free:     { pages: string[], features: string[] },
  //     loggedIn: { pages: string[], features: string[] },
  //     paid:     { pages: string[], features: string[] },
  //     beta:     { pages: string[], features: string[] },
  //     schemaVersion: number,
  //     updatedAt: string (ISO),
  //     updatedBy: string (email)
  //   }
  //
  // Additive semantics (enforced in requireAccess, not stored):
  //   loggedIn extends free; paid extends loggedIn; beta is overlay on top.
  //
  // Cache: 5-min TTL session cache (in-memory, module-scoped). The Access
  // Tiers admin tab passes { bypassCache: true } to always read fresh and
  // to see its own writes immediately.
  const FEATURE_GATES_TTL_MS = 5 * 60 * 1000;
  let _featureGatesCache = null;     // { data, fetchedAt }

  async function getFeatureGates(db, opts) {
    opts = opts || {};
    const now = Date.now();
    if (!opts.bypassCache && _featureGatesCache &&
        (now - _featureGatesCache.fetchedAt) < FEATURE_GATES_TTL_MS) {
      return _featureGatesCache.data;
    }
    try {
      const data = await readDoc(db, 'settings', 'featureGates');
      // Normalise: ensure all four sections exist as { pages: [], features: [] }
      // so callers can index into them without null-checks. A missing doc
      // (rules denial, network error, or genuinely-absent — though it
      // should always exist post-(e)) collapses to all-empty, which means
      // requireAccess will deny everything except admins. Failing closed.
      const norm = normaliseFeatureGates(data);
      _featureGatesCache = { data: norm, fetchedAt: now };
      return norm;
    } catch (e) {
      console.warn('[feature-flags] getFeatureGates failed:', e?.message || e);
      // Don't cache the failure — next call should retry rather than be
      // stuck with an empty doc for 5 minutes.
      return normaliseFeatureGates(null);
    }
  }

  function normaliseFeatureGates(data) {
    const sec = (s) => ({
      pages:    (s && Array.isArray(s.pages))    ? s.pages    : [],
      features: (s && Array.isArray(s.features)) ? s.features : []
    });
    if (!data) return { free: sec(), loggedIn: sec(), paid: sec(), beta: sec() };
    return {
      free:     sec(data.free),
      loggedIn: sec(data.loggedIn),
      paid:     sec(data.paid),
      beta:     sec(data.beta)
    };
  }

  /**
   * Resolve the access verdict for a user against a named page OR feature.
   *
   * Args:
   *   db    — Firestore instance (compat or modular SDK)
   *   opts  — { page?, feature?, email? }  exactly one of page/feature
   *
   * Returns: Promise<Verdict>
   *   {
   *     allowed: boolean,
   *     isAdmin: boolean,
   *     reason:  'free' | 'admin' | 'paid' | 'beta-overlay'
   *            | 'not-signed-in' | 'not-allowed' | 'invalid-args',
   *     tier:    'anonymous' | 'loggedIn' | 'paid'
   *   }
   *
   * The `tier` field reports the user's effective tier (what they ARE),
   * not what the gate required. Useful for analytics and differentiated
   * denial UIs (a paid-required page can show subscribe prompts; a beta-
   * only page can show "request beta access" prompts).
   *
   * isAdmin is set independently of allowed — it's always true for users
   * with admin/superadmin role, even when allowed is true for some other
   * reason (e.g. an admin accessing a free page gets reason='free' but
   * isAdmin=true). Useful for pages like bts.html that gate the page on
   * paid access but expose admin-only compose UI.
   *
   * Resolution order:
   *   1. Validate args (exactly one of page/feature).
   *   2. Read featureGates.
   *   3. If target is in `free` → allowed (anonymous OK).
   *   4. If no email → not-signed-in (denied).
   *   5. Look up role + paid status concurrently.
   *   6. If role in {admin, superadmin} → allowed, isAdmin=true, reason='admin'.
   *   7. If target in `loggedIn` → allowed, reason='free' (loggedIn extends free).
   *   8. If paid AND target in `paid` → allowed, reason='paid'.
   *   9. If role==='beta' AND target in `beta` → allowed, reason='beta-overlay'.
   *  10. Otherwise → not-allowed.
   *
   * Added 2026-05-20 (item e). The single primitive every gated page
   * should consult, replacing per-page bespoke auth checks.
   */
  async function requireAccess(db, opts) {
    const o = opts || {};
    const page = o.page;
    const feature = o.feature;
    const email = o.email;

    // Exactly one of page/feature must be provided.
    if ((!page && !feature) || (page && feature)) {
      return { allowed: false, isAdmin: false, reason: 'invalid-args', tier: 'anonymous' };
    }
    const target = page || feature;
    const targetList = page ? 'pages' : 'features';

    const gates = await getFeatureGates(db);
    const inFree = gates.free[targetList].includes(target);

    // Step 4: not signed in. Allowed iff target is in free.
    if (!email) {
      return inFree
        ? { allowed: true,  isAdmin: false, reason: 'free',          tier: 'anonymous' }
        : { allowed: false, isAdmin: false, reason: 'not-signed-in', tier: 'anonymous' };
    }

    // Signed in: look up role and paid status concurrently.
    const [role, isPaid] = await Promise.all([
      getUserRole(db, email),
      getUserIsPaid(db, email)
    ]);
    const isAdmin = (role === 'admin' || role === 'superadmin');
    const tier = isPaid ? 'paid' : 'loggedIn';

    // Step 3 (continued): free target, signed-in user.
    if (inFree) {
      return { allowed: true, isAdmin, reason: 'free', tier };
    }

    // Step 6: admins bypass everything.
    if (isAdmin) {
      return { allowed: true, isAdmin: true, reason: 'admin', tier: 'paid' };
    }

    // Step 7: loggedIn extends free — any signed-in user gets it.
    if (gates.loggedIn[targetList].includes(target)) {
      return { allowed: true, isAdmin: false, reason: 'free', tier };
    }

    // Step 8: paid subscribers get paid-tier targets.
    if (isPaid && gates.paid[targetList].includes(target)) {
      return { allowed: true, isAdmin: false, reason: 'paid', tier: 'paid' };
    }

    // Step 9: in requireAccess beta is an orthogonal overlay (NOT a rank).
    // Beta testers get beta-listed targets regardless of paid status. Note
    // that TIER_RANK does give beta a numeric rank (2) for the legacy
    // hasSiteAccess function, but requireAccess deliberately ignores rank
    // and uses string equality — matching hasPaidAccess's beta handling.
    if (role === 'beta' && gates.beta[targetList].includes(target)) {
      return { allowed: true, isAdmin: false, reason: 'beta-overlay', tier };
    }

    return { allowed: false, isAdmin: false, reason: 'not-allowed', tier };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal: read a Firestore doc, supporting compat AND modular SDKs.
  // ─────────────────────────────────────────────────────────────────────
  async function readDoc(db, collectionPath, docPath) {
    if (!db) return null;
    if (typeof db.collection === 'function') {
      // Compat SDK
      const snap = await db.collection(collectionPath).doc(docPath).get();
      return snap.exists ? snap.data() : null;
    }
    // Modular SDK — lazy-import getDoc/doc
    const { getDoc, doc } = await import(
      'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'
    );
    const snap = await getDoc(doc(db, collectionPath, docPath));
    return snap.exists() ? snap.data() : null;
  }

  window.CTFeatureFlags = {
    TIER_RANK,
    DEFAULT_TIER,
    DEFAULT_USER_ROLE,
    emailToKey,
    getSiteMinimumTier,
    getUserRole,
    getUserIsPaid,
    getFeatureGates,
    requireAccess,
    hasSiteAccess,
    hasPaidAccess,
    firebaseReady   // Promise that resolves once initializeApp() has run.
                    // Await this before calling getApp() in any consumer.
                    // Added 2026-05-29 (item 7.5, TODO #13).
  };
})();