/*
 * ct-metrics.js — "Metrics shown" picker for the stats tables. Added 2026-11-17.
 *
 * The same include/exclude filter compare.html got on 2026-11-14, shared by
 * batting, bowling, keeping and captaincy. A hidden metric drops out of every
 * table the page draws (each tab, the aggregate and century views, the Total
 * row) so the table focuses on what is left. It is not a row filter: it never
 * changes which players or innings are counted, so it does not count towards
 * the two-filter export gate, and the Excel export stays complete on purpose
 * (as on compare). Identity columns (#, Player, Country, Era) are never
 * hidden — only keys listed in `metrics` (or aliased onto one) can be.
 *
 * The items are not <input type=checkbox>: ct-urlstate.js saves every checkbox
 * in the filter panel by itself, which would write out the whole list of
 * SHOWN metrics. Instead the page saves the HIDDEN list through its `extra`
 * hook under `hm=`, the key compare already uses.
 *
 * Usage, before CTUrlState.attach():
 *
 *   CTMetrics.init({
 *     mount:    'msMetrics',          // id of an empty <div> in the filter panel
 *     btnClass: 'ms-btn',             // the page's own control class, so it matches its neighbours
 *     arrow:    false,                // add a ▾ (for pages whose class doesn't draw one)
 *     metrics:  [{ g:'Batting', key:'runs', label:'Runs' }, …],
 *     alias:    { from:'years', to:'years' },   // column key → metric key
 *     onChange: () => { renderTags(); render(); },
 *     onToggle: () => {},             // optional: called when the list opens or closes
 *     lift:     '.fp'                 // optional: ancestor that is overflow:hidden; it is
 *                                     // let overflow while the list is open
 *   });
 *   cols = CTMetrics.cols(cols);      // drop hidden columns
 *   CTMetrics.tag()                   // 'Hidden: SR, AvRate +2' or ''
 *   CTMetrics.reset()                 // show all, silently (for Reset all)
 *   CTMetrics.toParam() / fromParam() // for ct-urlstate's extra hook
 */
(function () {
  'use strict';

  var CSS =
    '.ctm-wrap{position:relative}.ctm-lift{overflow:visible!important}' +
    '.ctm-btn{width:100%;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.ctm-btn.ctm-arrow::after{content:"\\25BE";font-size:10px;color:var(--text3,#888);margin-left:8px}' +
    '.ctm-drop{display:none;position:absolute;top:calc(100% + 4px);left:0;min-width:100%;width:max-content;max-width:290px;' +
      'max-height:320px;overflow-y:auto;z-index:60;background:var(--surface,#fff);border:1px solid var(--border,#e0dcd5);' +
      'border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.12);text-align:left}' +
    '.ctm-drop.open{display:block}' +
    '.ctm-group{padding:7px 10px 4px;font-size:9.5px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;' +
      'color:var(--text3,#888);background:var(--surface2,#f5f0ea);border-bottom:1px solid var(--border,#e0dcd5)}' +
    '.ctm-item{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12.5px;cursor:pointer;' +
      'border-bottom:1px solid var(--border,#e0dcd5);outline:none}' +
    '.ctm-item:hover,.ctm-item:focus{background:var(--surface2,#f5f0ea)}' +
    '.ctm-cb{width:14px;height:14px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;' +
      'border:1.5px solid var(--border2,#ccc);border-radius:3px;background:var(--surface,#fff)}' +
    '.ctm-item.on .ctm-cb{background:var(--accent,#8b2500);border-color:var(--accent,#8b2500)}' +
    '.ctm-item.on .ctm-cb::after{content:"\\2713";color:#fff;font-size:10px;font-weight:700;line-height:1}' +
    '.ctm-foot{position:sticky;bottom:0;display:flex;justify-content:space-between;gap:12px;padding:6px 10px;' +
      'background:var(--surface,#fff);border-top:1px solid var(--border,#e0dcd5)}' +
    '.ctm-foot button{font:inherit;font-size:11px;font-weight:600;color:var(--accent,#8b2500);background:none;' +
      'border:none;padding:0;cursor:pointer}';

  var o = null, hidden = new Set(), keys = new Set(), alias = {}, host = null, btn = null, drop = null;

  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function injectCss() {
    if (document.getElementById('ctm-css')) return;
    var st = document.createElement('style');
    st.id = 'ctm-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function metricOf(colKey) { return alias[colKey] || colKey; }
  function isHidden(colKey) { return hidden.has(metricOf(colKey)); }

  function updateButton() {
    if (!btn) return;
    var total = o.metrics.length;
    btn.textContent = hidden.size === 0
      ? (o.allLabel || 'All metrics')
      : (total - hidden.size) + ' of ' + total + ' shown';
  }
  // In place, so a click on an item never detaches the node that was clicked
  // (a detached target would read as a click outside and shut the list).
  function syncItems() {
    if (!drop) return;
    drop.querySelectorAll('.ctm-item').forEach(function (el) {
      var on = !hidden.has(el.dataset.k);
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    updateButton();
  }
  function changed() {
    syncItems();
    if (o && o.onChange) o.onChange();
  }

  function setOpen(open) {
    drop.classList.toggle('open', open);
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    var box = o.lift && host.closest(o.lift);
    if (box) box.classList.toggle('ctm-lift', open);
    if (o.onToggle) o.onToggle();
  }

  function build() {
    var html = '', g = '';
    o.metrics.forEach(function (m) {
      if (m.g && m.g !== g) { g = m.g; html += '<div class="ctm-group">' + esc(g) + '</div>'; }
      html += '<div class="ctm-item" role="menuitemcheckbox" tabindex="0" data-k="' + esc(m.key) + '">' +
        '<span class="ctm-cb"></span><span>' + esc(m.label) + '</span></div>';
    });
    html += '<div class="ctm-foot"><button type="button" data-a="none">Hide all</button>' +
      '<button type="button" data-a="all">Show all</button></div>';
    drop.innerHTML = html;
  }

  function init(opts) {
    o = opts || {};
    host = document.getElementById(o.mount);
    if (!host || !Array.isArray(o.metrics)) return;
    injectCss();
    alias = o.alias || {};
    keys = new Set(o.metrics.map(function (m) { return m.key; }));
    host.classList.add('ctm-wrap');
    host.innerHTML =
      '<button type="button" class="' + esc(o.btnClass || '') + ' ctm-btn' + (o.arrow ? ' ctm-arrow' : '') +
      '" aria-haspopup="true" aria-expanded="false"></button><div class="ctm-drop" role="menu"></div>';
    btn = host.querySelector('.ctm-btn');
    drop = host.querySelector('.ctm-drop');
    build();
    syncItems();

    btn.addEventListener('click', function () { setOpen(!drop.classList.contains('open')); });
    // No stopPropagation anywhere: ct-urlstate rewrites the address on document clicks.
    drop.addEventListener('click', function (e) {
      var a = e.target.closest('[data-a]');
      if (a) {
        if (a.dataset.a === 'all') hidden.clear();
        else o.metrics.forEach(function (m) { hidden.add(m.key); });
        changed();
        return;
      }
      var it = e.target.closest('.ctm-item');
      if (!it) return;
      var k = it.dataset.k;
      if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
      changed();
    });
    drop.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ctm-item')) {
        e.preventDefault(); e.target.click();
      } else if (e.key === 'Escape') { setOpen(false); btn.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (drop.classList.contains('open') && !host.contains(e.target)) setOpen(false);
    });
  }

  function cols(list, keyOf) {
    keyOf = keyOf || function (c) { return c.key; };
    return list.filter(function (c) { return !isHidden(keyOf(c)); });
  }

  function tag() {
    if (!hidden.size) return '';
    var hid = o.metrics.filter(function (m) { return hidden.has(m.key); }).map(function (m) { return m.short || m.label; });
    return 'Hidden: ' + (hid.length <= 3 ? hid.join(', ') : hid.slice(0, 3).join(', ') + ' +' + (hid.length - 3));
  }

  function showAll() { hidden.clear(); changed(); }
  function reset() { hidden.clear(); syncItems(); }
  function toParam() { return o ? o.metrics.filter(function (m) { return hidden.has(m.key); }).map(function (m) { return m.key; }).join(',') : ''; }
  function fromParam(s) {
    hidden.clear();
    String(s || '').split(',').forEach(function (k) { if (keys.has(k)) hidden.add(k); });
    syncItems();
  }

  window.CTMetrics = {
    init: init, cols: cols, hidden: isHidden, tag: tag, count: function () { return hidden.size; },
    showAll: showAll, reset: reset, toParam: toParam, fromParam: fromParam
  };
})();
