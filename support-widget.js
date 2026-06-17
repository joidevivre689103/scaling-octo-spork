/* ══════════════════════════════════════════════════════════════════════════
   Cricket Times — Support Widget  (support-widget.js)
   ──────────────────────────────────────────────────────────────────────────
   Single-file, self-contained widget that injects:
     • Component 1  — above-footer support banner   (all pages)
     • Component 3  — inline article nudge           (article pages only)

   Usage:  <script src="support-widget.js" defer></script>
           Add to every page, just before </body>.

   Config: Edit the CONFIG object below to change URL, copy, or behaviour.
══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── CONFIG ─────────────────────────────────────────────────────────── */
  var CONFIG = {
    url: 'https://buymeacoffee.com/YOUR_USERNAME',

    // Component 1 — Footer Banner
    banner: {
      headline: 'Support <em>Independent</em> Cricket Stories',
      body: 'Cricket Times is free and independent. If you find value in our stories, analyses and tools, consider buying me a coffee to keep the scoreboard ticking.',
      btnText: 'Buy Me a Coffee',
      disclaimer: 'This is a personal contribution, not a donation — contributions are not tax-deductible.'
    },

    // Component 3 — Inline Article Nudge
    nudge: {
      headline: 'Enjoying these stories?',
      body: 'Cricket Times is free and independent. If you find value in our stories, analyses and tools, consider contributing a coffee. This is a personal contribution, not a donation — contributions are not tax-deductible.',
      linkText: 'Support Cricket Times'
    }
  };

  /* ── SVG ICONS ──────────────────────────────────────────────────────── */
  var ICON_BELL =
    '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
    '<path d="M12 2a2.5 2.5 0 0 0-2.5 2.5h5A2.5 2.5 0 0 0 12 2z"/>' +
    '<circle cx="12" cy="19" r="2" fill="var(--accent,#a03020)" stroke="none"/></svg>';

  var ICON_CUP =
    '<svg viewBox="0 0 24 24"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/>' +
    '<path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>' +
    '<line x1="6" y1="2" x2="6" y2="4"/>' +
    '<line x1="10" y1="2" x2="10" y2="4"/>' +
    '<line x1="14" y1="2" x2="14" y2="4"/></svg>';

  var ICON_ARROW =
    '<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';

  /* ── CSS (injected once) ────────────────────────────────────────────── */
  var CSS = '' +
    /* Component 1 — Footer Banner */
    '.ct-support-banner{max-width:1400px;margin:0 auto;padding:0 24px}' +
    '.ct-support-inner{border-top:3px double var(--border2,#c8c4bc);border-bottom:3px double var(--border2,#c8c4bc);padding:36px 0;display:flex;align-items:center;gap:40px}' +
    '.ct-support-icon{flex-shrink:0;width:72px;height:72px;border:2px solid var(--accent,#a03020);border-radius:50%;display:flex;align-items:center;justify-content:center}' +
    '.ct-support-icon svg{width:32px;height:32px;stroke:var(--accent,#a03020);fill:none;stroke-width:1.5}' +
    '.ct-support-content{flex:1}' +
    '.ct-support-headline{font-family:"Playfair Display",serif;font-size:22px;font-weight:700;line-height:1.3;margin-bottom:8px;color:var(--text,#1a1a18)}' +
    '.ct-support-headline em{font-style:italic;color:var(--accent,#a03020)}' +
    '.ct-support-body{font-family:"Source Serif 4",Georgia,serif;font-size:15px;color:var(--text2,#4a4a46);line-height:1.6;max-width:560px}' +
    '.ct-support-actions{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:8px}' +
    '.ct-support-btn{display:inline-flex;align-items:center;gap:8px;padding:12px 28px;background:var(--accent,#a03020);color:#fff;font-family:"Inter",sans-serif;font-size:13px;font-weight:600;letter-spacing:0.5px;text-decoration:none;border:none;cursor:pointer;transition:all 0.2s ease}' +
    '.ct-support-btn:hover{background:var(--accent-hover,#801810);transform:translateY(-1px)}' +
    '.ct-support-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2}' +
    '.ct-support-aside{font-family:"Inter",sans-serif;font-size:10px;color:var(--text3,#7a7a74);letter-spacing:0.3px;text-align:center;max-width:220px}' +
    '@media(max-width:768px){' +
      '.ct-support-inner{flex-direction:column;text-align:center;gap:24px;padding:28px 0}' +
      '.ct-support-body{margin:0 auto}' +
      '.ct-support-headline{font-size:20px}' +
    '}' +

    /* Component 3 — Inline Nudge */
    '.ct-inline-support{margin:32px 0;padding:24px 28px;background:rgba(160,48,32,0.08);border-left:3px solid var(--accent,#a03020);position:relative}' +
    '.ct-inline-support::before{content:"";position:absolute;top:0;left:0;right:0;bottom:0;' +
      'background:url("data:image/svg+xml,%3Csvg width=\'6\' height=\'6\' viewBox=\'0 0 6 6\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0h1v1H0z\' fill=\'%23a03020\' fill-opacity=\'0.03\'/%3E%3C/svg%3E");' +
      'pointer-events:none}' +
    '.ct-inline-headline{font-family:"Playfair Display",serif;font-size:16px;font-weight:600;margin-bottom:6px;color:var(--text,#1a1a18)}' +
    '.ct-inline-text{font-family:"Source Serif 4",Georgia,serif;font-size:14px;color:var(--text2,#4a4a46);line-height:1.5;margin-bottom:12px}' +
    '.ct-inline-link{font-family:"Inter",sans-serif;font-size:12px;font-weight:600;color:var(--accent,#a03020);text-decoration:none;letter-spacing:0.3px;display:inline-flex;align-items:center;gap:4px;transition:gap 0.2s}' +
    '.ct-inline-link:hover{gap:8px}' +
    '.ct-inline-link svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2}';

  /* ── INJECT STYLESHEET ──────────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  /* ── COMPONENT 1: FOOTER BANNER ─────────────────────────────────────
     Finds the first <footer> on the page and inserts the banner before it.
     If no <footer> exists, appends before </body>.
  ──────────────────────────────────────────────────────────────────────── */
  function injectBanner() {
    // Don't double-inject
    if (document.querySelector('.ct-support-banner')) return;

    var html =
      '<div class="ct-support-banner">' +
        '<div class="ct-support-inner">' +
          '<div class="ct-support-icon">' + ICON_BELL + '</div>' +
          '<div class="ct-support-content">' +
            '<div class="ct-support-headline">' + CONFIG.banner.headline + '</div>' +
            '<div class="ct-support-body">' + CONFIG.banner.body + '</div>' +
          '</div>' +
          '<div class="ct-support-actions">' +
            '<a href="' + CONFIG.url + '" target="_blank" rel="noopener" class="ct-support-btn">' +
              ICON_CUP + ' ' + CONFIG.banner.btnText +
            '</a>' +
            '<span class="ct-support-aside">' + CONFIG.banner.disclaimer + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    var container = document.createElement('div');
    container.innerHTML = html;
    var banner = container.firstChild;

    var footer = document.querySelector('footer');
    if (footer) {
      footer.parentNode.insertBefore(banner, footer);
    } else {
      document.body.appendChild(banner);
    }
  }

  /* ── COMPONENT 3: INLINE ARTICLE NUDGE ──────────────────────────────
     Only runs on article pages (detected by .article-body element).
     Inserts after .article-body, before .article-footer.
  ──────────────────────────────────────────────────────────────────────── */
  function injectNudge() {
    var articleBody = document.querySelector('.article-body');
    if (!articleBody) return;

    // Don't double-inject
    if (document.querySelector('.ct-inline-support')) return;

    var html =
      '<div class="ct-inline-support">' +
        '<div class="ct-inline-headline">' + CONFIG.nudge.headline + '</div>' +
        '<div class="ct-inline-text">' + CONFIG.nudge.body + '</div>' +
        '<a href="' + CONFIG.url + '" target="_blank" rel="noopener" class="ct-inline-link">' +
          CONFIG.nudge.linkText + ' ' + ICON_ARROW +
        '</a>' +
      '</div>';

    var container = document.createElement('div');
    container.innerHTML = html;
    var nudge = container.firstChild;

    // Insert after article-body
    if (articleBody.nextSibling) {
      articleBody.parentNode.insertBefore(nudge, articleBody.nextSibling);
    } else {
      articleBody.parentNode.appendChild(nudge);
    }
  }

  /* ── INIT ───────────────────────────────────────────────────────────── */
  function init() {
    injectBanner();
    injectNudge();
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ── ARTICLE PAGE: OBSERVE FOR DYNAMIC CONTENT ──────────────────────
     article.html loads content dynamically from Firestore, so .article-body
     may not exist at DOMContentLoaded. Watch for it to appear.
  ──────────────────────────────────────────────────────────────────────── */
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function () {
      if (document.querySelector('.article-body') && !document.querySelector('.ct-inline-support')) {
        injectNudge();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

})();