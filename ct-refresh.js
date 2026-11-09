/*
 * ct-refresh.js — a Refresh button for the installed site (IJ, 2026-11-08).
 *
 * Opened from the home-screen icon, the site runs without the browser's
 * address bar, so there is no reload (and iOS has no pull-to-refresh there).
 * This adds a small round button, bottom-left, ONLY in that mode; in an
 * ordinary browser tab it does nothing. Loaded on every page that links the
 * manifest.
 */
(function () {
  'use strict';
  var standalone = false;
  try {
    standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  } catch (e) { /* not standalone */ }
  if (!standalone) return;

  function add() {
    if (document.getElementById('ctRefresh')) return;
    var css = document.createElement('style');
    css.textContent =
      '#ctRefresh{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:950;' +
      'width:42px;height:42px;border-radius:50%;border:1px solid #d8d4cc;background:rgba(253,250,243,.94);' +
      'color:#8b0000;box-shadow:0 2px 8px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;' +
      'cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent}' +
      '#ctRefresh svg{width:20px;height:20px}' +
      '#ctRefresh.spin svg{animation:ctRefreshSpin .8s linear infinite}' +
      '@keyframes ctRefreshSpin{to{transform:rotate(360deg)}}' +
      '@media print{#ctRefresh{display:none}}';
    document.head.appendChild(css);
    var b = document.createElement('button');
    b.id = 'ctRefresh';
    b.type = 'button';
    b.setAttribute('aria-label', 'Refresh');
    b.title = 'Refresh';
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/>' +
      '<path d="M20 4v7h-7"/></svg>';
    b.addEventListener('click', function () {
      b.classList.add('spin');
      window.location.reload();
    });
    document.body.appendChild(b);
  }
  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add);
})();
