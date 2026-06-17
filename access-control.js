/* access-control.js
 * --------------------------------------------------------------------------
 * Single source of truth for page-access rules across Cricket Times.
 *
 * Loaded by every gated page (and by prelaunch-guard.js) BEFORE any other
 * gating logic runs. Exposes:
 *
 *   window.CTAccess.tierRank       — numeric rank for each role/tier
 *   window.CTAccess.alwaysPublic   — pages reachable to anyone regardless
 *                                    of site-wide tier (prelaunch allowlist)
 *   window.CTAccess.freePostLaunch — pages free post-launch but gated by
 *                                    the site-wide tier during beta phases
 *   window.CTAccess.perPageGate    — pages with a bespoke gate
 *                                    (e.g. archive.html → 'paid')
 *   window.CTAccess.perPathGate    — path-prefix gates for permanent URL
 *                                    patterns (e.g. /oracle/{edition}/*)
 *   window.CTAccess.adminPages     — pages gated by Firebase Auth + admin
 *                                    email; the prelaunch-guard skips these
 *   window.CTAccess.userHasAccess(role, page, siteFloor) — main helper
 *   window.CTAccess.gateKindFor(page) — which kind of gate governs a page
 *
 * To change access rules: edit this file and deploy via the deploy tool.
 * No Firestore writes, no admin-panel UI. Hardcoded by design.
 *
 * If this file starts growing complex per-page logic, that's the signal
 * to revisit a cohort-based system instead.
 *
 * ─── PHILOSOPHY (decided 2026-04-29) ─────────────────────────────────────
 * Cricket Times follows "Philosophy A" for content access:
 *   - Direct content URLs (article.html?id=N, oracle.html, etc.) are
 *     PERMANENTLY PUBLIC — preserves shared-link integrity, supports SEO,
 *     and treats top-of-funnel readers as future subscribers, not enemies.
 *   - Discovery/archive pages (archive.html, audio.html, /oracle/{edition}/*)
 *     are PAID — this is where the subscription value lives.
 *   - Standalone premium features (bts.html, simulation.html) are PAID
 *     because they're genuinely exclusive, not because content is gated.
 *   - Admin pages: Firebase Auth + admin email, separate concern entirely.
 *
 * The "live window" (homepageWindowDays, future audioWindowDays etc.) is
 * orthogonal to access — it controls what's listed on the live page
 * (stories.html, etc.) but does NOT gate URL access. See content-windows.js.
 * -------------------------------------------------------------------------- */
(function () {
  'use strict';

  // ─── TIER LADDER ─────────────────────────────────────────────────────────
  const tierRank = {
    public:     0,
    regular:    1,
    beta:       2,
    priority:   3,
    admin:      4,
    superadmin: 5
  };

  // ─── ALWAYS-PUBLIC PAGES (prelaunch allowlist) ───────────────────────────
  // Reachable to ANYONE regardless of site-wide tier — these bypass the
  // prelaunch-guard entirely. Match the existing prelaunch-guard allowlist:
  // landing pages, the live oracle quiz, and direct article URLs (so
  // shared links work pre-launch and post-launch).
  const alwaysPublic = [
    'comingsoon.html',
    'index.html',
    'article.html',          // direct article URLs always loadable per
                             // Philosophy A (shared-link integrity)
    'oracle.html',           // live oracle quiz
    'quiz.html'              // live quiz alias
  ];

  // ─── FREE POST-LAUNCH PAGES ──────────────────────────────────────────────
  // Free for any signed-in user (or anonymous if site floor allows it),
  // but gated by the site-wide tier during pre-launch / beta phases.
  // After launch (siteMinimumTier='public'), these become open to all.
  // During beta (siteMinimumTier='priority'), they're locked down.
  //
  // These are the "main site" pages — discoverable through the homepage
  // and free in the launched state, but not part of the prelaunch
  // allowlist.
  const freePostLaunch = [
    'about.html',
    'subscribe.html',
    'submit.html',           // public submission form
    'privacy.html',

    'stories.html',          // homepage / article feed

    // Stats & analysis tools (free)
    'countries.html',
    'country-results.html',
    'batting.html',
    'bowling-records.html',
    'keeping.html',
    'captaincy.html',
    'compare.html',

    // Community
    'voices.html'
  ];

  // ─── PER-PAGE BESPOKE GATES ──────────────────────────────────────────────
  // Pages that override the site-wide tier with a specific gate.
  //
  // Values are either:
  //   - A tier-rank key from `tierRank` (e.g. 'beta', 'admin', 'superadmin'):
  //     user passes if their role's rank >= the named tier's rank.
  //   - 'paid' (sentinel): user passes if they are an active paid subscriber.
  //     userHasAccess() in this file does NOT have an isPaid signal and
  //     therefore cannot evaluate 'paid' gates — it returns false for them.
  //     Callers needing paid-gate evaluation must use a different mechanism
  //     (post-(e): requireAccess({page: '...'}); interim: page-side checks
  //     via CTFeatureFlags.getUserIsPaid).
  //
  // Architecture note (2026-05-18, item h): values for paid pages were
  // 'priority' pre-(h), reflecting the role-as-paid conflation that (h)
  // unwound. Switched to the 'paid' sentinel so future readers don't
  // confuse the post-(h) operational role taxonomy (none/beta/admin/
  // superadmin) with paid status. (e) will replace this whole map with
  // settings/featureGates.
  const perPageGate = {
    // Paid features (require active subscription — evaluated by requireAccess,
    // NOT by userHasAccess in this file)
    'archive.html':       'paid',  // article archive (browsing UI)
    'audio.html':         'paid',  // audio archive page
    'bts.html':           'paid',  // Behind the Scenes
    'simulation.html':    'paid'   // simulation tool

    // Reserved slots for upcoming pages (uncomment when built):
    // 'leaderboard.html':         'paid',
    // 'interviews-archive.html':  'paid'
  };

  // ─── PATH-PREFIX GATES ───────────────────────────────────────────────────
  // For permanent URL patterns where exact filename matching doesn't fit.
  // Same value semantics as perPageGate (tier-rank key or 'paid' sentinel).
  // Note: filename matches above (alwaysPublic, adminPages, perPageGate)
  // win over prefix matches, so 'oracle.html' (live) stays public while
  // '/oracle/march-2026/...' (past edition) is paid.
  const perPathGate = {
    'oracle/':      'paid'   // past oracle editions
  };

  // ─── ADMIN / CMS PAGES ───────────────────────────────────────────────────
  // Firebase Auth + admin email — the prelaunch-guard skips these.
  const adminPages = [
    // Content management
    'cms.html',
    'admin.html',

    // Tools & diagnostics
    'github-deploy-tool.html',
    'secrets.html',
    'technicaldocs.html',
    'reference.html',
    'architecture.html',
    'test.html',
    'models.html',
    'js-compressor.html',
    'dat-compressor.html',
    'cricsheetananthcheck.html',

    // Authors & Payouts (per April 29 spec)
    'author-login.html',
    'author-dashboard.html',
    'author-cms.html',
    'author-profile.html',
    'author-earnings.html',
    'contributor-agreement.html',
    'payouts.html',
    'analytics-sync.html'
  ];

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  function normalizePage(page) {
    if (!page) return '';
    let p = String(page).trim();
    p = p.replace(/^https?:\/\/[^/]+\//, '');
    p = p.replace(/^\/+/, '');
    p = p.split('?')[0].split('#')[0];
    return p;
  }

  function matchPathPrefix(path) {
    for (const prefix in perPathGate) {
      if (path.indexOf(prefix) === 0) return prefix;
    }
    return null;
  }

  // Logic order (first match wins):
  //   1. superadmin   → always allowed
  //   2. perPathGate  → check FIRST (before filename) so nested paths like
  //                     'oracle/march-2026/index.html' match the prefix
  //                     rather than the filename 'index.html'
  //   3. alwaysPublic → bypass site floor (prelaunch allowlist)
  //   4. adminPages   → delegated to page's own auth flow (allow here)
  //   5. perPageGate  → must meet that page's specific gate
  //   6. freePostLaunch → must meet site-wide floor (free post-launch,
  //                       gated during beta when floor>public)
  //   7. Unknown page → must meet siteMinimumTier (defensive default)
  //
  // 'paid' sentinel handling (post-h):
  //   Paid gates require an isPaid signal that this function doesn't
  //   receive. Returns false (fail closed) for any 'paid' gate. Callers
  //   that need paid-gate evaluation must use requireAccess (post-(e))
  //   or page-side CTFeatureFlags.getUserIsPaid checks (interim).
  function userHasAccess(currentRole, page, siteMinimumTier) {
    const userRank = tierRank[currentRole] != null ? tierRank[currentRole] : 0;
    const norm = normalizePage(page);
    const filename = norm.indexOf('/') === -1 ? norm : norm.split('/').pop();

    // 1. superadmin: bypass everything
    if (currentRole === 'superadmin') return true;

    // 2. path prefix: checked FIRST so nested paths (e.g. oracle/edition/...)
    //    are not accidentally captured by their tail filename.
    const matchedPrefix = matchPathPrefix(norm);
    if (matchedPrefix) {
      const gateValue = perPathGate[matchedPrefix];
      if (gateValue === 'paid') return false;  // see "'paid' sentinel handling" above
      const requiredRank = tierRank[gateValue] || 0;
      return userRank >= requiredRank;
    }

    // 3. always-public (prelaunch allowlist)
    if (alwaysPublic.indexOf(filename) !== -1) return true;

    // 4. admin pages — delegated to the page's own gate (Firebase Auth)
    if (adminPages.indexOf(filename) !== -1) return true;

    // 5. exact-filename per-page gate (paid features or role-based)
    if (perPageGate[filename]) {
      const gateValue = perPageGate[filename];
      if (gateValue === 'paid') return false;  // see "'paid' sentinel handling" above
      const requiredRank = tierRank[gateValue] || 0;
      return userRank >= requiredRank;
    }

    // 6 & 7. fall through to site-wide floor — free post-launch pages
    // and any unrecognised pages are both governed by siteMinimumTier.
    const floorRank = tierRank[siteMinimumTier] != null ? tierRank[siteMinimumTier] : 0;
    return userRank >= floorRank;
  }

  // Returns: 'public' | 'admin' | 'paid' | 'site-floor'
  function gateKindFor(page) {
    const norm = normalizePage(page);
    const filename = norm.indexOf('/') === -1 ? norm : norm.split('/').pop();

    if (matchPathPrefix(norm))                  return 'paid';
    if (alwaysPublic.indexOf(filename) !== -1) return 'public';
    if (adminPages.indexOf(filename)   !== -1) return 'admin';
    if (perPageGate[filename])                  return 'paid';
    return 'site-floor';
  }

  window.CTAccess = {
    tierRank:        tierRank,
    alwaysPublic:    alwaysPublic,
    freePostLaunch:  freePostLaunch,
    perPageGate:     perPageGate,
    perPathGate:     perPathGate,
    adminPages:      adminPages,
    userHasAccess:   userHasAccess,
    gateKindFor:     gateKindFor,
    normalizePage:   normalizePage
  };
})();
