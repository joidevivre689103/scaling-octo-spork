/*
 * ct-ads.js — the two ad modules on the free pages (IJ, 2026-11-23).
 * Spec: cricket-times-notes/ads-spec.md.
 *
 * WHAT IT DOES
 *   - A BANNER under the nav (the only full-width ad) and a 300×250 SQUARE on the
 *     right. On screens 1100px and wider the square sits in a right-hand column
 *     beside the page's main column; narrower, it drops into the page at a set
 *     point, centred, 300px wide, never full width.
 *   - Never for readers with paid access (paying OR granted), via
 *     CTFeatureFlags.getUserHasPaidAccess. Any doubt about a signed-in reader
 *     (an error, or no answer within 4s) shows nothing.
 *   - House ads (our own pages) are labelled "From The Grass Bank"; sponsor ads
 *     "Advertisement".
 *
 * NO TRACKING
 *   No cookies, no localStorage, no third-party script or image. The list of
 *   ads comes from Firestore ads/live (public get) or, if that document does
 *   not exist yet, from /ads/house.json on this site. Images must be on this
 *   site or our Firebase Storage. Nothing is sent anywhere when an ad is shown.
 *
 * ON A PAGE
 *   <script src="/ct-ads.js" data-ct-ad-page="fixtures" defer></script>
 *   Pages: home, article, fixtures, scores, wtc, players, player, yorker.
 *   article.html must call window.CTAds.articleLive(true|false) once it knows
 *   whether the article is still on the home page (archived = no ads).
 */
(function () {
  'use strict';
  if (window.CTAds) return;

  var script = document.currentScript;
  var PAGE = (script && script.getAttribute('data-ct-ad-page')) || '';
  var SDK = 'https://www.gstatic.com/firebasejs/13.0.0/';
  var RAIL_MIN = 1100;      // viewport width at which the square gets its own column
  var RAIL_W = 300, RAIL_GAP = 32;
  var AUTH_WAIT_MS = 4000;

  // Where each page puts its modules.
  //   main:   the page's main column; the square's column is added to its right
  //   banner: the element the banner goes after
  //   inline: on narrow screens, the square goes after the node this returns
  //           (null = not there yet; we wait for it, then fall back to the end of main)
  //   home:   the square always goes in the home page's own right-hand column
  var PAGES = {
    home:     { banner: '#pageNav', main: null, homeSidebar: '.hero-sidebar' },
    article:  { banner: 'nav.nav-bar', main: '.article-page',
                inline: function () {
                  var ps = document.querySelectorAll('.article-body > p');
                  return ps.length ? ps[Math.min(3, ps.length - 1)] : null;
                } },
    fixtures: { banner: 'nav[data-ct-nav="primary"]', main: 'main.main',
                inline: function () { return firstLoaded('#fxList', '.fx-empty'); } },
    scores:   { banner: 'nav[data-ct-nav="primary"]', main: 'main.main',
                inline: function () { return firstLoaded('#scList', '.sc-empty'); } },
    wtc:      { banner: 'nav[data-ct-nav="primary"]', main: 'main.main',
                inline: function () {
                  var h = document.querySelector('main.main h2.sec-title');
                  return h ? h.previousElementSibling : null;
                } },
    players:  { banner: 'nav[data-ct-nav="primary"]', main: 'main.main',
                inline: function () { return document.querySelector('main.main .filters'); } },
    player:   { banner: 'nav[data-ct-nav="primary"]', main: 'main.main',
                inline: function () { return document.querySelector('#main > .ranks') || document.querySelector('#main > .figs'); } },
    yorker:   { banner: 'nav[data-ct-nav="primary"]', main: 'main.main',
                inline: function () { return null; } }   // never inside the quiz: end of the page
  };
  var cfg = PAGES[PAGE];

  function firstLoaded(listSel, placeholderSel) {
    var list = document.querySelector(listSel);
    if (!list) return null;
    var first = list.firstElementChild;
    if (!first || first.matches(placeholderSel)) return null;
    return first;
  }

  // ── Styles ──────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ct-ads-style')) return;
    var st = document.createElement('style');
    st.id = 'ct-ads-style';
    st.textContent = [
      '.ct-ad{box-sizing:border-box;text-align:center}',
      '.ct-ad-label{display:block;font-family:\'Inter\',sans-serif;font-size:10px;font-weight:500;letter-spacing:.14em;',
      '  text-transform:uppercase;color:#8a8176;margin:0 0 5px;line-height:1.2}',
      '.ct-ad a{display:block;border:1px solid #d8d4cc;background:#fbf8f1;line-height:0;text-decoration:none}',
      '.ct-ad a:focus-visible{outline:2px solid #8b0000;outline-offset:2px}',
      '.ct-ad img{display:block;width:100%;height:auto}',
      '.ct-ad-banner{max-width:1002px;margin:14px auto 4px;padding:0 16px}',
      '.ct-ad-banner a{max-width:970px;margin:0 auto}',
      '.ct-ad-banner img{aspect-ratio:970/90}',
      '@media (max-width:1023px){.ct-ad-banner a{max-width:728px}.ct-ad-banner img{aspect-ratio:728/90}}',
      '@media (max-width:767px){.ct-ad-banner a{max-width:320px}.ct-ad-banner img{aspect-ratio:320/100}}',
      '.ct-ad-square{width:300px;max-width:100%}',
      '.ct-ad-square img{aspect-ratio:300/250}',
      '.ct-ad-square.ct-ad-inline{margin:28px auto}',
      '.ct-ad-square.ct-ad-rail{position:absolute;z-index:2}',
      '.ct-ad-square.ct-ad-home{margin:24px auto 0}',
      '@media print{.ct-ad{display:none!important}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── Who is reading ──────────────────────────────────────────────────────
  // Resolves true when ads may be shown: no one signed in, or a signed-in
  // reader WITHOUT paid access. Any doubt about a signed-in reader → false.
  function mayShowAds() {
    var FF = window.CTFeatureFlags;
    if (!FF || !FF.firebaseReady) return Promise.resolve(false);
    var check = FF.firebaseReady.then(function (app) {
      return import(SDK + 'firebase-auth.js').then(function (A) {
        return new Promise(function (res) {
          var off = A.onAuthStateChanged(A.getAuth(app), function (u) { off(); res(u); });
        });
      }).then(function (user) {
        if (!user) return true;
        if (!user.email || !FF.getUserHasPaidAccess) return false;
        return import(SDK + 'firebase-firestore.js').then(function (F) {
          return FF.getUserHasPaidAccess(F.getFirestore(app), user.email, user);
        }).then(function (paid) { return paid === false; });
      });
    }).catch(function () { return false; });
    return Promise.race([check, new Promise(function (r) { setTimeout(function () { r(false); }, AUTH_WAIT_MS); })]);
  }

  // ── The list of ads ─────────────────────────────────────────────────────
  function loadList() {
    var FF = window.CTFeatureFlags;
    var fromFirestore = (FF && FF.firebaseReady ? FF.firebaseReady : Promise.reject())
      .then(function (app) {
        return import(SDK + 'firebase-firestore.js').then(function (F) {
          return F.getDoc(F.doc(F.getFirestore(app), 'ads', 'live'));
        });
      })
      .then(function (snap) { return snap.exists() ? snap.data() : null; })
      .catch(function () { return null; });
    return fromFirestore.then(function (d) {
      if (d && Array.isArray(d.creatives)) return d.creatives;
      return fetch('/ads/house.json', { cache: 'no-cache', credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && Array.isArray(j.creatives)) ? j.creatives : []; })
        .catch(function () { return []; });
    });
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Our own images only: a path on this site, or our Firebase Storage bucket.
  function safeImage(src) {
    if (typeof src !== 'string' || !src) return null;
    if (/^\/[^/]/.test(src)) return src;
    if (/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/hitwicket-cba02\.firebasestorage\.app\//.test(src)) return src;
    return null;
  }
  function safeLink(href) {
    if (typeof href !== 'string' || !href) return null;
    if (/^\/[^/]/.test(href)) return href;
    if (/^https:\/\/[^\s"'<>]+$/i.test(href)) return href;
    return null;
  }

  function samePage(href) {
    try {
      var u = new URL(href, location.href);
      if (u.origin !== location.origin) return false;
      var p = function (x) { return x.replace(/index\.html$/, '').replace(/\/$/, '') || '/'; };
      return p(u.pathname) === p(location.pathname);
    } catch (e) { return false; }
  }

  function pick(list, slot, avoid) {
    var t = today();
    var ok = list.filter(function (c) {
      if (!c || c.slot !== slot) return false;
      if (Array.isArray(c.pages) && c.pages.indexOf(PAGE) === -1) return false;
      if (c.start && t < c.start) return false;
      if (c.end && t > c.end) return false;
      if (!safeImage(c.image) || !safeLink(c.link)) return false;
      if (c.house && samePage(c.link)) return false;   // no promo for the page you're on
      return true;
    });
    // Two house ads on one page promote two different pages.
    if (avoid && avoid.house) {
      var other = ok.filter(function (c) { return !(c.house && c.link === avoid.link); });
      if (other.length) ok = other;
    }
    // Sponsors first: a house ad only fills a slot no sponsor has.
    var paid = ok.filter(function (c) { return !c.house; });
    var pool = paid.length ? paid : ok;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  // ── Building a module (no innerHTML) ────────────────────────────────────
  function build(c, slot) {
    var wrap = document.createElement('aside');
    wrap.className = 'ct-ad ct-ad-' + slot;
    var label = c.house ? 'From The Grass Bank' : 'Advertisement';
    wrap.setAttribute('aria-label', label);
    var lab = document.createElement('span');
    lab.className = 'ct-ad-label';
    lab.textContent = label;
    wrap.appendChild(lab);

    var a = document.createElement('a');
    a.href = safeLink(c.link);
    if (!c.house) {
      a.target = '_blank';
      a.rel = 'sponsored noopener';
    }
    var pic = document.createElement('picture');
    if (slot === 'banner') {
      var mob = safeImage(c.imageMobile), mid = safeImage(c.imageMid);
      if (mob) { var s1 = document.createElement('source'); s1.media = '(max-width:767px)'; s1.srcset = mob; pic.appendChild(s1); }
      if (mid) { var s2 = document.createElement('source'); s2.media = '(max-width:1023px)'; s2.srcset = mid; pic.appendChild(s2); }
    }
    var img = document.createElement('img');
    img.src = safeImage(c.image);
    img.alt = typeof c.alt === 'string' ? c.alt : '';
    img.width = slot === 'banner' ? 970 : 300;
    img.height = slot === 'banner' ? 90 : 250;
    img.decoding = 'async';
    pic.appendChild(img);
    a.appendChild(pic);
    wrap.appendChild(a);
    return wrap;
  }

  // ── Placing the square ──────────────────────────────────────────────────
  var square = null, mainEl = null, origMax = null, origPadR = null, inlineTarget = null;

  function px(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function resetRail() {
    if (mainEl && origMax !== null) {
      mainEl.style.maxWidth = origMax;
      mainEl.style.paddingRight = origPadR;
      mainEl.style.position = '';
      mainEl.classList.remove('ct-has-ad-rail');
    }
  }

  function place() {
    if (!square || !cfg || !mainEl) return;
    resetRail();
    square.classList.remove('ct-ad-rail', 'ct-ad-inline');
    square.style.top = square.style.right = '';
    if (window.innerWidth >= RAIL_MIN) {
      // The main column keeps its width: it grows by the square's column
      // when the screen has room, and only narrows when it doesn't.
      var cs = getComputedStyle(mainEl);
      var padR = px(cs.paddingRight), padT = px(cs.paddingTop);
      var maxW = cs.maxWidth === 'none' ? null : px(cs.maxWidth);
      if (maxW) mainEl.style.maxWidth = (maxW + RAIL_W + RAIL_GAP) + 'px';
      mainEl.style.paddingRight = (padR + RAIL_W + RAIL_GAP) + 'px';
      if (cs.position === 'static') mainEl.style.position = 'relative';
      mainEl.classList.add('ct-has-ad-rail');
      square.classList.add('ct-ad-rail');
      square.style.top = padT + 'px';
      square.style.right = padR + 'px';
      if (square.parentNode !== mainEl) mainEl.insertBefore(square, mainEl.firstChild);
    } else {
      square.classList.add('ct-ad-inline');
      var t = inlineTarget && inlineTarget.isConnected ? inlineTarget : null;
      if (t && t.parentNode) t.parentNode.insertBefore(square, t.nextSibling);
      else mainEl.appendChild(square);
    }
  }

  function findInline(done) {
    if (!cfg.inline) return done(null);
    var found = cfg.inline();
    if (found) return done(found);
    var mo = new MutationObserver(function () {
      var f = cfg.inline();
      if (f) { mo.disconnect(); clearTimeout(tm); done(f); }
    });
    mo.observe(mainEl, { childList: true, subtree: true });
    var tm = setTimeout(function () { mo.disconnect(); done(null); }, 10000);
  }

  // ── Start ───────────────────────────────────────────────────────────────
  var started = false;
  function start() {
    if (started || !cfg) return;
    started = true;
    Promise.all([mayShowAds(), loadList()]).then(function (r) {
      if (!r[0]) return;
      var list = r[1];
      injectStyles();

      var b = pick(list, 'banner');
      var anchor = b && document.querySelector(cfg.banner);
      if (b && anchor && anchor.parentNode) anchor.parentNode.insertBefore(build(b, 'banner'), anchor.nextSibling);

      var s = pick(list, 'square', b);
      if (!s) return;
      if (cfg.homeSidebar) {
        var side = document.querySelector(cfg.homeSidebar);
        if (!side) return;
        var sq = build(s, 'square');
        sq.classList.add('ct-ad-home');
        side.appendChild(sq);
        return;
      }
      mainEl = document.querySelector(cfg.main);
      if (!mainEl) return;
      origMax = mainEl.style.maxWidth;
      origPadR = mainEl.style.paddingRight;
      square = build(s, 'square');
      findInline(function (t) { inlineTarget = t; place(); });
      place();
      // Some pages rebuild their main column once their data arrives
      // (player.html empties it first). Put the square back if it was swept away.
      new MutationObserver(function () {
        if (!square.isConnected) {
          if (inlineTarget && !inlineTarget.isConnected) {
            inlineTarget = null;
            findInline(function (t) { inlineTarget = t; place(); });
          }
          place();
        }
      }).observe(mainEl, { childList: true });
      var rt;
      window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(place, 150); });
    }).catch(function (e) { console.warn('[ct-ads]', e && e.message || e); });
  }

  // Articles wait until article.html says whether the piece is still on the
  // home page; every other page starts straight away.
  var articleState = null;
  window.CTAds = {
    articleLive: function (live) {
      if (PAGE !== 'article' || articleState !== null) return;
      articleState = !!live;
      if (articleState) start();
    }
  };
  if (PAGE === 'article') {
    if (window.CT_ARTICLE_LIVE === true) window.CTAds.articleLive(true);
  } else if (cfg) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})();
