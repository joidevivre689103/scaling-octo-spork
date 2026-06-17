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
  var FOOTER_EXTRAS = [
    { href: '/about.html',                 label: 'About' },
    { href: 'mailto:contact@cricketimes.com', label: 'Contact' },
    { href: '/subscribe.html',             label: 'Subscribe' },
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
    '.ct-nav-inner{max-width:1400px;margin:0 auto;padding:0 24px;display:flex;justify-content:center;gap:0}',
    // Explicit border:0 override: some pages use border-bottom for their own active-underline, causing a double-line.
    '.ct-nav-link{font-family:\'Inter\',sans-serif;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#5a5450;text-decoration:none;padding:14px 14px;position:relative;transition:color 0.2s;border:0;border-bottom:0}',
    '.ct-nav-link:hover{color:#8b0000;border-bottom:0}',
    '.ct-nav-link.active{color:#8b0000;border-bottom:0}',
    '.ct-nav-link.active::after{content:\'\';position:absolute;bottom:0;left:14px;right:14px;height:2px;background:#8b0000}',
    // Breakpoint raised 900→1100px when nav grew 10→12 items (2026-06-05):
    // 12 centered no-wrap items clip between ~900-1100px without scroll.
    '@media(max-width:1100px){',
    '  .ct-nav-inner{overflow-x:auto;justify-content:flex-start;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
    '  .ct-nav-inner::-webkit-scrollbar{display:none}',
    '  .ct-nav-link{white-space:nowrap;padding:12px 14px;font-size:11px}',
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
    '.ct-footer-bottom{font-family:\'Inter\',sans-serif;font-size:11px;color:rgba(255,255,255,0.4);display:flex;justify-content:space-between;align-items:flex-start;gap:24px}',
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
      return '<a href="' + esc(item.href) + '">' + esc(item.label) + '</a>';
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
            'Test match and player records compiled by Ananth Narayanan.<br>' +
            'Cross-reference data from <a href="https://cricsheet.org" target="_blank" rel="noopener">Cricsheet</a>, ' +
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

  function init() {
    ensureFonts();
    injectCss();
    var mastheads = document.querySelectorAll('[data-ct-nav="masthead"]');
    var primaries = document.querySelectorAll('[data-ct-nav="primary"]');
    var footers   = document.querySelectorAll('[data-ct-nav="footer"]');
    for (var a = 0; a < mastheads.length; a++) renderMasthead(mastheads[a]);
    for (var b = 0; b < primaries.length; b++) renderPrimary(primaries[b]);
    for (var c = 0; c < footers.length;   c++) renderFooter(footers[c]);
    if (mastheads.length) applyTaglineOverride();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
