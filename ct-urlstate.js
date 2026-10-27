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

  // A small Share button, placed at the right of a page heading.
  function mountShareButton(host, title) {
    if (!host || host.querySelector('.ct-share-btn')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ct-share-btn';
    b.setAttribute('aria-label', 'Share this view');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
      '<circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
      '<span>Share</span>';
    b.style.cssText = 'float:right;display:inline-flex;align-items:center;gap:6px;margin-left:12px;padding:7px 14px;' +
      'border:1px solid var(--border,#d4c5a9);border-radius:6px;background:var(--surface,#fffdf7);color:var(--accent,#8b0000);' +
      'font:600 12px Inter,sans-serif;letter-spacing:0.3px;cursor:pointer';
    b.addEventListener('click', function () { share(title); });
    host.insertBefore(b, host.firstChild);
  }

  window.CTUrlState = { attach: attach, share: share, sync: sync, mountShareButton: mountShareButton };
})();
