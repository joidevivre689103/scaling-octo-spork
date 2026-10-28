/* ct-player-link.js — player names open their profile (2026-10-28).
 *
 *   CTPlayer.href(pid)              → "/player.html?id=<pid>"
 *   CTPlayer.link(pid, text, title) → '<a class="ct-plink" …>text</a>' (HTML string;
 *                                     text and title are escaped here)
 *
 * Used by the stats pages where they render a player's name (batting, bowling,
 * keeping, captaincy, rankings, compare). Profiles are free (player.html).
 * The link looks like the name it replaces, underlined on hover, and a click
 * on it never reaches the table row's own click handler.
 */
(function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function href(pid) { return '/player.html?id=' + encodeURIComponent(pid); }
  function link(pid, text, title) {
    if (pid == null || pid === '' || !/^\d+$/.test(String(pid))) return esc(text);
    return '<a class="ct-plink" href="' + href(pid) + '"' + (title ? ' title="' + esc(title) + ' — profile"' : ' title="Profile"') +
      '>' + esc(text) + '</a>';
  }
  var css = document.createElement('style');
  css.textContent = 'a.ct-plink{color:inherit;text-decoration:none;border-bottom:1px dotted rgba(0,0,0,0.25)}' +
    'a.ct-plink:hover,a.ct-plink:focus-visible{color:var(--accent,#a03020);border-bottom-color:currentColor}';
  (document.head || document.documentElement).appendChild(css);
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a.ct-plink');
    if (a) e.stopPropagation();
  }, true);
  window.CTPlayer = { href: href, link: link };
})();
