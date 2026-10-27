/*
 * ct-urlstate.js — keep a stats page's filters in its address, and share it.
 * Added 2026-10-27.
 *
 * Why: a phone reloads a backgrounded tab, the Back button returns to a fresh
 * page, and a reader who wants to send "this view" to a friend had nothing to
 * send. With the filters in the address, a refresh, Back, a bookmark and a
 * shared link all reopen the same view.
 *
 * Usage, once the page has built its filter lists (after its data loads):
 *
 *   CTUrlState.attach({
 *     root:  document.getElementById('filterPanel'),   // where the filters live
 *     apply: applyFilters,                             // re-runs the page after a restore
 *     extra: {                                         // optional page state outside the form
 *       get: () => ({ tb: currentTab, s: sortKey, d: sortDir }),
 *       defaults: { tb: 'runs', s: 'runs', d: 'desc' },
 *       set: (q) => { ... }                            // called with the restored extra keys
 *     }
 *   });
 *   CTUrlState.share('Batting');                       // from a Share button
 *
 * `keep: ['otd', 'test']` leaves keys that other code on the page owns alone.
 *
 * What is saved, generically, inside `root`:
 *   - every <select id=…>                → id=value
 *   - every text/number <input id=…>     → id=value
 *   - checkboxes, grouped by the nearest ancestor with an id (a multi-select
 *     wrapper such as #msEra)            → wrapperId=v1,v2
 * Only values that differ from what the page started with are written, so the
 * address stays short. The address is rewritten with replaceState: no extra
 * Back-button steps. Restore never throws; an unknown key is ignored.
 */
(function () {
  'use strict';
  var opts = null, defaults = {}, restoring = false, timer = null;

  function controls(root) {
    var out = {};
    root.querySelectorAll('select[id]').forEach(function (el) { out[el.id] = { kind: 'select', el: el }; });
    root.querySelectorAll('input[id]').forEach(function (el) {
      if (el.type === 'text' || el.type === 'number' || el.type === 'search') out[el.id] = { kind: 'input', el: el };
    });
    root.querySelectorAll('input[type=checkbox]').forEach(function (el) {
      var host = el.closest('.ms-wrap[id]') || (el.parentElement && el.parentElement.closest('[id]'));
      if (!host || !root.contains(host)) return;
      var g = out[host.id] || (out[host.id] = { kind: 'group', host: host });
      if (g.kind !== 'group') return;
    });
    return out;
  }

  function read(c) {
    if (c.kind === 'group') {
      return Array.prototype.filter.call(c.host.querySelectorAll('input[type=checkbox]'),
        function (b) { return b.checked; }).map(function (b) { return b.value; }).join(',');
    }
    return c.el.value;
  }

  function write(c, v) {
    if (c.kind === 'group') {
      var want = String(v).split(',');
      c.host.querySelectorAll('input[type=checkbox]').forEach(function (b) { b.checked = want.indexOf(b.value) !== -1; });
    } else if (c.kind === 'select') {
      if (Array.prototype.some.call(c.el.options, function (o) { return o.value === v; })) c.el.value = v;
    } else {
      c.el.value = v;
    }
  }

  function params() {
    var q = new URLSearchParams(), cs = controls(opts.root);
    // Keys other code on the page owns (e.g. countries' ?otd= / ?test=) pass through.
    var cur = new URLSearchParams(location.search);
    (opts.keep || []).forEach(function (k) { if (cur.has(k)) q.set(k, cur.get(k)); });
    Object.keys(cs).forEach(function (k) {
      var v = read(cs[k]);
      if (v !== (defaults[k] == null ? '' : defaults[k])) q.set(k, v);
    });
    if (opts.extra && opts.extra.get) {
      var x = opts.extra.get() || {}, d = opts.extra.defaults || {};
      Object.keys(x).forEach(function (k) {
        if (x[k] != null && String(x[k]) !== String(d[k] == null ? '' : d[k])) q.set(k, x[k]);
      });
    }
    return q.toString().replace(/%2C/g, ',');
  }

  function sync() {
    if (!opts || restoring) return;
    var qs = params();
    var next = location.pathname + (qs ? '?' + qs : '') + location.hash;
    if (next !== location.pathname + location.search + location.hash) {
      try { history.replaceState(null, '', next); } catch (e) { /* non-fatal */ }
    }
  }

  function attach(o) {
    if (!o || !o.root) return;
    opts = o;
    var cs = controls(o.root);
    Object.keys(cs).forEach(function (k) { defaults[k] = read(cs[k]); });

    var q = new URLSearchParams(location.search), touched = false;
    restoring = true;
    try {
      // Page state outside the form first (a page may reset its filters when,
      // say, the countries change), then the form controls, then one apply.
      var ex = {};
      if (o.extra && o.extra.defaults) {
        Object.keys(o.extra.defaults).forEach(function (k) { if (q.has(k)) { ex[k] = q.get(k); touched = true; } });
      }
      if (touched && o.extra && o.extra.set) o.extra.set(ex);
      Object.keys(cs).forEach(function (k) { if (q.has(k)) { write(cs[k], q.get(k)); touched = true; } });
      if (touched && o.apply) o.apply();
    } catch (e) {
      console.warn('[url-state] could not restore the view from the address:', e && e.message);
    }
    restoring = false;
    sync();

    ['click', 'change', 'input', 'keyup'].forEach(function (ev) {
      document.addEventListener(ev, function () { clearTimeout(timer); timer = setTimeout(sync, 80); });
    });
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2000;' +
      'background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;font:600 13px Inter,sans-serif;' +
      'box-shadow:0 6px 24px rgba(0,0,0,0.25)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  function share(title) {
    sync();
    var url = location.href, name = 'The Grass Bank — ' + (title || document.title);
    if (navigator.share) {
      navigator.share({ title: name, url: url }).catch(function () {});
      return;
    }
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
      .then(function () { toast('Link copied'); })
      .catch(function () { window.prompt('Copy this link:', url); });
  }

  // ── Share row: WhatsApp · X · Copy, the same buttons as the Yorker's
  // "Bowl it at a friend" (2026-10-27). Prominent on purpose: a lone icon in a
  // heading goes unnoticed. Each page passes the message to send (`text`) and,
  // if it builds its own address, `url`.
  var ICONS = {
    wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
  };
  var CSS = '.ct-share-host{position:relative}.ct-share{position:absolute;top:0;right:0;text-align:right}' +
    '.ct-share.ct-share-inline{position:static;margin:0 0 0 auto}' +
    '.ct-share-lbl{font:700 10px Inter,sans-serif;letter-spacing:2.5px;text-transform:uppercase;color:var(--accent,#8b0000);margin:0 0 8px}' +
    '.ct-share-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}' +
    '.ct-share-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;font:700 11px Inter,sans-serif;letter-spacing:1.3px;' +
      'text-transform:uppercase;border:1.5px solid var(--border2,#c8b898);border-radius:var(--radius,6px);background:var(--surface,#fffdf7);' +
      'color:var(--text2,#444);cursor:pointer;text-decoration:none;transition:background .15s,border-color .15s,color .15s;line-height:1}' +
    '.ct-share-btn:hover{background:var(--surface2,#f5edda);border-color:var(--accent,#8b0000);color:var(--accent,#8b0000)}' +
    '.ct-share-btn svg{width:14px;height:14px;flex-shrink:0}' +
    '@media(max-width:1000px){.ct-share{position:static;margin:14px 0 4px;text-align:left}.ct-share .ct-share-row{justify-content:flex-start}}' +
    '@media(max-width:700px){.ct-share,.ct-share.ct-share-inline{position:static;margin:14px 0 4px;text-align:left;width:100%}' +
      '.ct-share-row{justify-content:flex-start}.ct-share-btn{padding:9px 14px}}';

  function injectCss() {
    if (document.getElementById('ct-share-css')) return;
    var st = document.createElement('style');
    st.id = 'ct-share-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // Default message: page title, the open tab and the active filter chips.
  function defaultText(title) {
    var parts = [];
    var tab = document.querySelector('.tab.on');
    if (tab) parts.push(tab.textContent.trim());
    document.querySelectorAll('.fp-tag').forEach(function (t) {
      var v = t.textContent.replace(/[×✕✖]\s*$/, '').trim();
      if (v) parts.push(v);
    });
    return 'Test ' + (title || '').toLowerCase() + (parts.length ? ' — ' + parts.join(', ') : '') + ' · The Grass Bank';
  }

  function mountShareRow(host, o) {
    o = o || {};
    if (!host || host.querySelector('.ct-share')) return;
    injectCss();
    var getUrl = function () { if (o.url) return o.url(); sync(); return location.href; };
    var getText = function () { return o.text ? o.text() : defaultText(o.title); };
    var box = document.createElement('div');
    box.className = 'ct-share' + (o.inline ? ' ct-share-inline' : '');
    box.innerHTML = '<div class="ct-share-lbl">◆ ' + (o.label || 'Share this view') + '</div>' +
      '<div class="ct-share-row">' +
      '<a href="#" class="ct-share-btn" data-s="wa" target="_blank" rel="noopener">' + ICONS.wa + 'WhatsApp</a>' +
      '<a href="#" class="ct-share-btn" data-s="x" target="_blank" rel="noopener">' + ICONS.x + 'Share</a>' +
      '<button type="button" class="ct-share-btn" data-s="copy">' + ICONS.copy + '<span>Copy</span></button></div>';
    // Links are built on click, so they always carry the current view.
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.ct-share-btn');
      if (!b) return;
      var url = getUrl(), text = getText();
      if (b.dataset.s === 'wa') {
        b.href = 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url);
      } else if (b.dataset.s === 'x') {
        b.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
      } else {
        e.preventDefault();
        var label = b.querySelector('span');
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
          .then(function () { label.textContent = 'Copied ✓'; setTimeout(function () { label.textContent = 'Copy'; }, 2000); })
          .catch(function () { window.prompt('Copy this link:', url); });
      }
    });
    // Beside the heading on wide screens, under it on narrow ones.
    if (!o.inline) host.classList.add('ct-share-host');
    host.appendChild(box);
    return box;
  }

  // Kept for any caller of the earlier single button.
  function mountShareButton(host, title) { return mountShareRow(host, { title: title }); }

  window.CTUrlState = { attach: attach, share: share, sync: sync, mountShareButton: mountShareButton, mountShareRow: mountShareRow };
})();
