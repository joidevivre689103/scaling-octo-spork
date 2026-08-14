/* ═══════════════════════════════════════════════════════════════════
   Cricket Times — Shared Chrome Include

   Single source of truth for site-wide masthead, primary nav, and
   footer. Renders into any element tagged with:
     data-ct-nav="masthead"   → masthead with date/logo/tagline
     data-ct-nav="primary"    → 12-item nav bar
     data-ct-nav="footer"     → footer with nav + copyright

   Active nav state auto-detected from URL.

   To change chrome site-wide, edit the constants/CSS in this file and
   redeploy. No other pages need touching.
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // Hrefs are root-absolute [2026-06-05]: the chrome now also renders on
  // subdirectory pages (/oracle/<edition>/), where relative hrefs would
  // resolve into the subdirectory and 404.
  var NAV_ITEMS = [
    { href: '/',                label: 'Stories' },
    { href: '/countries.html',  label: 'Countries' },
    { href: '/batting.html',    label: 'Batting' },
    { href: '/bowling.html',    label: 'Bowling' },
    { href: '/keeping.html',    label: 'Keeping' },
    { href: '/captaincy.html',  label: 'Captaincy' },
    { href: '/compare.html',    label: 'Compare' },
    { href: '/simulations.html', label: 'Simulations' },
    { href: '/oracle.html',      label: 'Oracle' },
    { href: '/oracle-archive.html', label: 'Past Oracles' },
    { href: '/archive.html',     label: 'Archive' },
    { href: '/audio.html',       label: 'Audio' }
  ];

  // Footer appends these to the primary items
  //
  // `gated: 'paidAccess'` [2026-07-24] renders the link hidden and reveals it only
  // for readers who actually hold paid access — Stripe subscribers AND complimentary
  // (`paidSubscriber` role) readers alike. See revealGatedLinks() for the mechanism
  // and why it fails closed.
  //
  // 'Service Area' [2026-08-14] is deliberately NOT gated. It lists the countries in
  // which paid subscriptions are sold (Terms §5.3), so the readers who most need it
  // are precisely those who cannot subscribe — gating it would hide it from them.
  // It sits after Manage Subscription, which means that for a signed-out or
  // non-paying reader (Manage hidden) it renders immediately after Subscribe.
  var FOOTER_EXTRAS = [
    { href: '/bts.html',                   label: 'Behind the Scenes' },
    { href: '/about.html',                 label: 'About' },
    { href: 'mailto:contact@cricketimes.com', label: 'Contact' },
    { href: '/subscribe.html',             label: 'Subscribe' },
    { href: '/manage.html',                label: 'Manage Subscription', gated: 'paidAccess' },
    { href: '/servicearea.html',          label: 'Service Area' },
    { href: '/voices.html',                label: 'Voices' },
    { href: '/terms.html',                 label: 'Terms of Service' },
    { href: '/privacy.html',               label: 'Privacy Policy' }
  ];

  var TAGLINE = 'The Definitive Voice of Test Cricket';

  // Firestore project for CMS-driven tagline override. See applyTaglineOverride().
  var FIRESTORE_PROJECT = 'hitwicket-cba02';

  // ── Self-contained CSS ──
  // All colors hardcoded, no per-page CSS variable dependency. These
  // values mirror bowling.html's canonical palette.
  var CHROME_CSS = [
    // Unified site background (overrides each page's body bg to one cream)
    'body{background:#fdfaf3}',

    // Masthead
    '.ct-masthead{text-align:center;padding:20px 24px 16px;border-bottom:2px solid #1a1917;position:relative;background:#fdfaf3}',
    '.ct-masthead-date{font-family:\'Inter\',sans-serif;font-size:11px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;color:#8a8176;margin-bottom:8px}',
    '.ct-masthead-logo{font-family:\'Playfair Display\',serif;font-size:clamp(36px,8vw,58px);font-weight:700;font-style:normal;letter-spacing:-1px;line-height:1.1}',
    '.ct-masthead-logo a{text-decoration:none;color:#1a1917}',
    // Explicit font-style+font-weight overrides: some pages set italic/400 on this span.
    '.ct-masthead-logo span{color:#8b0000;font-style:normal;font-weight:700}',
    '.ct-masthead-tagline{font-family:\'Inter\',sans-serif;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:#8a8176;margin-top:6px}',

    // Primary nav
    '.ct-nav-bar{border-bottom:1px solid #e5e0d8;background:#fff;position:sticky;top:0;z-index:100}',
    // overflow-x + scrollbar-hiding are UNCONDITIONAL as of 2026-07-24, not
    // media-scoped. They used to live only in the max-width:1100px block below,
    // which left 1101px–1448px (viewport wider than the breakpoint but narrower
    // than max-width 1400 + 48 padding) with no escape hatch: 12 centred items
    // simply clipped. Pages happened to be covered because several carried
    // their own duplicate `.ct-nav-inner{overflow-x:auto}` — dead CSS in every
    // other respect (this block outranks it: injectCss appends to <head> after
    // the page's own <style>), but load-bearing for exactly this one property.
    // Folding it in here is what lets those page-level blocks be deleted.
    '.ct-nav-inner{max-width:1400px;margin:0 auto;padding:0 24px;display:flex;justify-content:center;gap:0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
    '.ct-nav-inner::-webkit-scrollbar{display:none}',
    // Explicit border:0 override: some pages use border-bottom for their own active-underline, causing a double-line.
    // white-space:nowrap likewise unconditional (same 2026-07-24 reason): without
    // it a two-word label ("Behind the Scenes", "Past Oracles") wraps mid-item
    // above the breakpoint instead of the row scrolling.
    '.ct-nav-link{font-family:\'Inter\',sans-serif;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#5a5450;text-decoration:none;padding:14px 14px;position:relative;transition:color 0.2s;white-space:nowrap;border:0;border-bottom:0}',
    '.ct-nav-link:hover{color:#8b0000;border-bottom:0}',
    // font-weight repeated from .ct-nav-link on purpose. Several pages carry a
    // legacy `.ct-nav-link.active{font-weight:600}` in their own <style>, which
    // outranks the single-class base rule above (0,2,0 beats 0,1,0). Declaring it
    // on the equally specific selector here lets load order settle it — this sheet
    // is appended to <head> last, so at equal specificity it wins.
    '.ct-nav-link.active{color:#8b0000;font-weight:600;border-bottom:0}',
    '.ct-nav-link.active::after{content:\'\';position:absolute;bottom:0;left:14px;right:14px;height:2px;background:#8b0000}',
    // Breakpoint raised 900→1100px when nav grew 10→12 items (2026-06-05):
    // 12 centered no-wrap items clip between ~900-1100px without scroll.
    '@media(max-width:1100px){',
    '  .ct-nav-inner{justify-content:flex-start}',
    '  .ct-nav-link{padding:12px 14px;font-size:11px}',
    '}',

    // Footer
    '.ct-footer{background:#1a1917;color:rgba(255,255,255,0.7);padding:48px 24px 32px;margin-top:60px}',
    '.ct-footer-inner{max-width:1400px;margin:0 auto}',
    '.ct-footer-top{display:flex;justify-content:flex-start;align-items:baseline;gap:48px;flex-wrap:wrap;padding-bottom:32px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:24px}',
    '.ct-footer-brand{font-family:\'Playfair Display\',serif;font-size:28px;font-weight:700;color:#fff;white-space:nowrap;letter-spacing:-0.5px;line-height:1}',
    // Brand link styling — uniform white treatment against dark background. The masthead
    // uses crimson for "Times" because the cream backdrop provides contrast; on the dark
    // footer, crimson reads muddy, so both halves stay white here.
    '.ct-footer-brand a{text-decoration:none;color:#fff}',
    '.ct-footer-brand span{color:#fff;font-style:normal;font-weight:700}',
    '.ct-footer-nav{display:flex;gap:32px;flex-wrap:wrap}',
    '.ct-footer-nav a{font-family:\'Inter\',sans-serif;font-size:12px;font-weight:500;color:rgba(255,255,255,0.6);text-decoration:none}',
    '.ct-footer-nav a:hover{color:#fff}',
    // Entitlement-gated footer links start hidden and are revealed by
    // revealGatedLinks() (attribute removed). Hiding in CSS rather than by
    // omitting the node keeps the reveal a single attribute write with no
    // re-render, and means the link is never briefly visible to the wrong reader.
    '.ct-footer-nav a[data-ct-gated]{display:none}',
    // flex-wrap:wrap folded in from the page-level chrome blocks (2026-07-24).
    // Above the 900px breakpoint this row is legal text left / data attribution
    // right; without wrap a long attribution line overlaps rather than dropping.
    '.ct-footer-bottom{font-family:\'Inter\',sans-serif;font-size:11px;color:rgba(255,255,255,0.4);display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}',
    // Left column: copyright + no-copying notice stacked vertically
    '.ct-footer-legal{display:flex;flex-direction:column;gap:6px;max-width:48%}',
    '.ct-footer-copy{color:rgba(255,255,255,0.5)}',
    '.ct-footer-notice{color:rgba(255,255,255,0.4);font-style:italic;line-height:1.6}',
    '.ct-footer-attrib{text-align:right;line-height:1.7}',
    '.ct-footer-attrib a{color:rgba(255,255,255,0.55);text-decoration:none;border-bottom:1px dotted rgba(255,255,255,0.25)}',
    '.ct-footer-attrib a:hover{color:rgba(255,255,255,0.8);border-bottom-color:rgba(255,255,255,0.5)}',
    '@media(max-width:900px){.ct-footer-top{flex-direction:column;gap:24px}.ct-footer-nav{flex-wrap:wrap;gap:16px}.ct-footer-bottom{flex-direction:column;gap:12px}.ct-footer-legal{max-width:100%}.ct-footer-attrib{text-align:left}}'
  ].join('');

  // ── Ensure Playfair Display + Inter fonts are loaded ──
  function ensureFonts() {
    if (document.getElementById('ct-nav-fonts')) return;
    var link = document.createElement('link');
    link.id = 'ct-nav-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap';
    (document.head || document.documentElement).appendChild(link);
  }

  // ── Inject shared CSS once ──
  function injectCss() {
    if (document.getElementById('ct-nav-styles')) return;
    var style = document.createElement('style');
    style.id = 'ct-nav-styles';
    style.textContent = CHROME_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── Detect current page filename ──
  function currentPage() {
    var path = window.location.pathname;
    // Permanent edition pages (/oracle/<edition>/) highlight the Oracle
    // nav item [2026-06-05].
    if (path.indexOf('/oracle/') === 0) return 'oracle.html';
    var seg = path.split('/').filter(Boolean).pop() || '';
    // Post index-swap (2026-06-05): the homepage lives at / (index.html).
    // NOTE for the CMS tagline override: the homepage slug is now 'index'
    // (was 'stories') — taglinePages must list 'index' to target it.
    if (!seg || seg === '/') return 'index.html';
    if (seg.indexOf('.') === -1) return seg + '.html';
    return seg;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Formatted date like "Thursday, April 16, 2026" ──
  function todayString() {
    try {
      return new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    } catch (e) {
      return '';
    }
  }

  // ── Render masthead into placeholder ──
  function renderMasthead(el) {
    el.className = 'ct-masthead';
    el.innerHTML =
      '<div class="ct-masthead-date">' + esc(todayString()) + '</div>' +
      '<div class="ct-masthead-logo"><a href="/">Cricket <span>Times</span></a></div>' +
      '<div class="ct-masthead-tagline">' + esc(TAGLINE) + '</div>';
  }

  // ── Render primary nav ──
  function renderPrimary(el) {
    var active = currentPage();
    var inner = NAV_ITEMS.map(function(item) {
      // item.href is root-absolute ('/x.html') or '/' for the homepage;
      // currentPage() returns a bare filename ('x.html', 'index.html').
      var hrefFile = item.href === '/' ? 'index.html' : item.href.replace(/^\//, '');
      var cls = 'ct-nav-link' + (hrefFile === active ? ' active' : '');
      return '<a href="' + esc(item.href) + '" class="' + cls + '">' + esc(item.label) + '</a>';
    }).join('');
    el.className = 'ct-nav-bar';
    el.innerHTML = '<div class="ct-nav-inner">' + inner + '</div>';
  }

  // ── Render footer ──
  function renderFooter(el) {
    var all = NAV_ITEMS.concat(FOOTER_EXTRAS);
    var links = all.map(function(item) {
      var attrs = item.gated ? ' data-ct-gated="' + esc(item.gated) + '"' : '';
      return '<a href="' + esc(item.href) + '"' + attrs + '>' + esc(item.label) + '</a>';
    }).join('');
    el.className = 'ct-footer';
    el.innerHTML =
      '<div class="ct-footer-inner">' +
        '<div class="ct-footer-top">' +
          '<div class="ct-footer-brand"><a href="/">Cricket <span>Times</span></a></div>' +
          '<nav class="ct-footer-nav">' + links + '</nav>' +
        '</div>' +
        '<div class="ct-footer-bottom">' +
          '<div class="ct-footer-legal">' +
            '<span class="ct-footer-copy">&copy; 2026 Cricket Times. All rights reserved.</span>' +
            '<span class="ct-footer-notice">Site code, content, and design may not be copied or republished without permission.</span>' +
          '</div>' +
          '<span class="ct-footer-attrib">' +
            'Test match and player records compiled by Ananth Narayanan and used with permission.<br>' +
            'Data derived from <a href="https://cricsheet.org/" target="_blank" rel="noopener">Cricsheet (cricsheet.org)</a>, ' +
            'licensed under <a href="https://opendatacommons.org/licenses/by/1-0/" target="_blank" rel="noopener">ODC-BY 1.0</a>.' +
          '</span>' +
        '</div>' +
      '</div>';
  }

  // ── CMS-driven tagline override ──
  // The CMS (Tagline view) writes { tagline, taglinePages } to config/site in
  // Firestore. Each page checks at load time whether its slug is in the
  // allowlist; if so, the hardcoded TAGLINE is replaced by the CMS value.
  //
  // Design notes:
  // - Uses the Firestore REST API directly (no SDK). ct-nav.js runs on pages
  //   with no Firebase, pages using the modular v10 SDK (stories.html), and
  //   pages using the compat v9 SDK (cms.html). REST is the only approach
  //   that works across all three.
  // - Slug = filename stem (stories.html → "stories"). Must match the value=
  //   attributes on the CMS checkboxes in cms.html.
  // - Silent failure: any network/parse/shape error leaves the hardcoded
  //   fallback in place. Pages never render empty or broken.
  // - Pop-in is accepted (~200ms). Masthead renders synchronously with the
  //   fallback; this swaps in async once Firestore responds.
  function currentSlug() {
    var page = currentPage();            // e.g. "stories.html"
    return page.replace(/\.html$/i, ''); // e.g. "stories"
  }

  function applyTaglineOverride() {
    var slug = currentSlug();
    var url = 'https://firestore.googleapis.com/v1/projects/' +
              FIRESTORE_PROJECT + '/databases/(default)/documents/config/site';

    fetch(url).then(function(r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function(doc) {
      // Firestore REST wraps values: { fields: { tagline: { stringValue: "…" },
      //                                          taglinePages: { arrayValue: { values: [{stringValue:"…"}, …] } } } }
      var fields = (doc && doc.fields) || {};
      var tagline = fields.tagline && fields.tagline.stringValue;
      var pagesArr = fields.taglinePages &&
                     fields.taglinePages.arrayValue &&
                     fields.taglinePages.arrayValue.values;
      if (!tagline || !pagesArr) return;

      var pages = pagesArr.map(function(v) { return v.stringValue; });
      if (pages.indexOf(slug) === -1) return;  // not in allowlist → keep fallback

      var nodes = document.querySelectorAll('.ct-masthead-tagline');
      for (var i = 0; i < nodes.length; i++) nodes[i].textContent = tagline;
    }).catch(function() {
      // Silent: fallback stays. Don't spam the console on offline/404.
    });
  }

  // ── Entitlement-gated footer links ──
  // Added 2026-07-24 for the "Manage Subscription" link.
  //
  // MUST be getUserHasPaidAccess (Stripe OR `paidSubscriber` role), NOT
  // getUserIsPaid (Stripe only). Using the latter would hide the link from exactly
  // the complimentary readers it most needs to reach — the same Stripe-only
  // assumption behind the manage/subscribe bugs fixed in #73 and the
  // serveDerivedData parity break.
  //
  // WHY THIS IS NOT A PLAIN window.getUserHasPaidAccess() CALL (fixed 2026-07-24):
  // the first cut of this function probed bare `window` and called the function
  // with no arguments. Both were wrong, and it warned on every page:
  //   1. feature-flags.js exports nothing onto bare window. Its entire API hangs
  //      off window.CTFeatureFlags (single namespace object, assigned last).
  //   2. The signature is getUserHasPaidAccess(db, email) — a Firestore instance
  //      and an email address. Called bare it hits `if (!email) return false` and
  //      reports "not paid" for everyone, which fails closed but silently and for
  //      the wrong reason. Worse, it would look like it was working.
  // So we have to supply db and email ourselves.
  //
  // THE "NO FIREBASE SDK" RULE, AND WHY WE BEND IT HERE:
  // ct-nav.js deliberately loads no Firebase SDK (see the tagline-override note
  // above — it runs on pages with no Firebase, with modular v10, and with compat
  // v9, so REST is the only portable call). That rule still holds for the tagline.
  // Here we bend it, narrowly and safely: we only reach for the SDK *after*
  // __ctFlagsLoaded is true, i.e. only on pages where feature-flags.js is present
  // and has already called initializeApp(). We never initialize anything — we
  // await CTFeatureFlags.firebaseReady and use the app it hands back. On a page
  // with no feature-flags.js this branch is never entered and no SDK is fetched.
  //
  // The alternative — re-deriving entitlement over Firestore REST right here —
  // was rejected: it would make this the FIFTH place the paid predicate is
  // spelled out (feature-flags.js, firestore.rules, serveDerivedData.js,
  // manage.html's hasComplimentaryAccess, and this). Delegating to
  // CTFeatureFlags keeps exactly one definition of "paid" on the client.
  //
  // FAILS CLOSED. No flags, no namespace, no such function, an SDK import failure,
  // an anonymous visitor, an error, or a timeout all leave the link hidden. A
  // missing link is a discoverability annoyance; a link shown to a non-subscriber
  // sends them to a page telling them to subscribe, which is worse.
  var FLAGS_WAIT_MS = 6000;   // generous: cold Firestore read on mobile data
  var FLAGS_POLL_MS = 100;
  var GATE_WAIT_MS  = 9000;   // hard ceiling on the whole resolve chain

  // MUST match the version pinned in feature-flags.js and every gated page.
  // Same URL string ⇒ the browser reuses the already-fetched module graph, so
  // this adds no network cost on a page that has loaded feature-flags.js, and
  // guarantees we're not mixing SDK versions against the same FirebaseApp
  // (the cross-version Firestore/Auth gotcha in the 7.5 notes).
  // On a version bump this file is caught by `grep -r "firebasejs/10\.12\.5"`.
  var FB_FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
  var FB_AUTH_URL      = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

  function whenFlagsReady(cb) {
    var waited = 0;
    (function poll() {
      if (window.__ctFlagsLoaded) return cb(true);
      if (waited >= FLAGS_WAIT_MS) return cb(false);
      waited += FLAGS_POLL_MS;
      setTimeout(poll, FLAGS_POLL_MS);
    })();
  }

  // Returns Promise<boolean>. Rejects only on a genuinely unexpected failure;
  // every "we can't tell" path resolves false so the caller stays fail-closed.
  //
  // Order matters: auth first, then Firestore. If nobody is signed in there is
  // no email, so there is nothing to look up and we skip the Firestore import
  // and both document reads entirely — the common case on public pages.
  function resolvePaidAccess(CTFF) {
    var app;
    return CTFF.firebaseReady
      .then(function(a) {
        app = a;
        return import(FB_AUTH_URL);
      })
      .then(function(authMod) {
        var auth = authMod.getAuth(app);
        // The first onAuthStateChanged emission — NOT auth.currentUser. See the
        // authSettled note in feature-flags.js: currentUser is synchronously
        // null until Firebase rehydrates a persisted session, so reading it
        // directly would report "signed out" for a signed-in returning visitor
        // and hide the link from the exact people who need it. The first
        // emission fires only after persistence resolves.
        return new Promise(function(resolve) {
          var unsub = authMod.onAuthStateChanged(auth, function(user) {
            if (typeof unsub === 'function') unsub();
            resolve(user);
          });
        });
      })
      .then(function(user) {
        var email = user && user.email;
        if (!email) return false;     // anonymous — nothing to reveal
        return import(FB_FIRESTORE_URL).then(function(fsMod) {
          var db = fsMod.getFirestore(app);
          // The single source of truth for "should this person see paid
          // content?" — Stripe active/past_due OR the paidSubscriber role.
          return CTFF.getUserHasPaidAccess(db, email);
        });
      })
      .then(function(v) { return v === true; });
  }

  function revealGatedLinks() {
    var gated = document.querySelectorAll('.ct-footer-nav a[data-ct-gated="paidAccess"]');
    if (!gated.length) return;

    whenFlagsReady(function(ready) {
      if (!ready) {
        // Not an error worth shouting about: on an ungated page feature-flags.js
        // may simply not be present. Left hidden by design.
        return;
      }
      var CTFF = window.CTFeatureFlags;
      if (!CTFF || typeof CTFF.getUserHasPaidAccess !== 'function') {
        // Loud, because __ctFlagsLoaded was true — feature-flags.js ran but did
        // not expose the API we expect. That's a contract break, not a missing
        // dependency, and it silently hides the link for every paying user.
        console.warn('[ct-nav] window.CTFeatureFlags.getUserHasPaidAccess is not ' +
          'a function — the "Manage Subscription" footer link will stay hidden ' +
          'for everyone. feature-flags.js loaded (__ctFlagsLoaded is true) but ' +
          'its export shape changed. Update this probe to match.');
        return;
      }
      if (!CTFF.firebaseReady || typeof CTFF.firebaseReady.then !== 'function') {
        console.warn('[ct-nav] CTFeatureFlags.firebaseReady is missing or not a ' +
          'promise; cannot obtain a Firestore instance. Gated links stay hidden.');
        return;
      }

      // One chain, one hard timeout, one fail-closed catch.
      var settled = false;
      var timer = setTimeout(function() {
        if (settled) return;
        settled = true;
        console.warn('[ct-nav] entitlement check exceeded ' + GATE_WAIT_MS +
          'ms; leaving gated links hidden.');
      }, GATE_WAIT_MS);

      resolvePaidAccess(CTFF).then(function(hasAccess) {
        if (settled) return;          // timed out already; do not reveal late
        settled = true;
        clearTimeout(timer);
        if (!hasAccess) return;
        for (var i = 0; i < gated.length; i++) gated[i].removeAttribute('data-ct-gated');
      }).catch(function(e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn('[ct-nav] entitlement check failed; gated links stay hidden.', e);
      });
    });
  }

  function init() {
    ensureFonts();
    injectCss();
    var mastheads = document.querySelectorAll('[data-ct-nav="masthead"]');
    var primaries = document.querySelectorAll('[data-ct-nav="primary"]');
    var footers   = document.querySelectorAll('[data-ct-nav="footer"]');
    for (var a = 0; a < mastheads.length; a++) renderMasthead(mastheads[a]);
    for (var b = 0; b < primaries.length; b++) renderPrimary(primaries[b]);
    for (var c = 0; c < footers.length;   c++) renderFooter(footers[c]);
    if (footers.length) revealGatedLinks();
    if (mastheads.length) applyTaglineOverride();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
