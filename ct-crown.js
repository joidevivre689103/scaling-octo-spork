/* ct-crown.js — the Yorker crown beside a reader's name  (2026-11-25, IJ)
 *
 * Readers who finish in the top five of a monthly Yorker earn a crown. It is
 * shown beside their display name on comments (article.html) and in Behind
 * the Scenes (bts.html). One crown, never a number: its shade deepens with
 * how many they have earned. A crown once earned is kept for good; closing
 * the account removes it.
 *
 * The count comes from crowns/{uid} (public get, no list), which super-
 * fortnight's publishYorkerStats rewrites every hour. Pages look it up next
 * to publicProfiles/{uid} and call:
 *
 *   window.ctCrown(count)  ->  HTML string ('' when count is 0 or missing)
 *
 * Shades: 1 pale gold, 2 gold, 3-5 deep gold, 6 or more old gold.
 */
(function () {
  var SHADES = [
    [6, '#8c5a0a', '#5e3c06'],
    [3, '#b8860b', '#7a5807'],
    [2, '#d6a92b', '#8f6d14'],
    [1, '#ead27a', '#a8893a']
  ];
  var css = '.ct-crown{display:inline-block;width:1.05em;height:.85em;margin-left:.3em;vertical-align:-.05em;flex:none}';
  function addStyle() {
    if (document.getElementById('ct-crown-css')) return;
    var s = document.createElement('style');
    s.id = 'ct-crown-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  window.ctCrown = function (count) {
    var n = Number(count) || 0;
    if (n < 1) return '';
    addStyle();
    var fill = SHADES[SHADES.length - 1][1], line = SHADES[SHADES.length - 1][2];
    for (var i = 0; i < SHADES.length; i++) {
      if (n >= SHADES[i][0]) { fill = SHADES[i][1]; line = SHADES[i][2]; break; }
    }
    return '<svg class="ct-crown" viewBox="0 0 24 20" role="img" aria-label="Yorker crown">' +
      '<title>Yorker crown</title>' +
      '<path d="M2 6l5 5 5-9 5 9 5-5-2 11H4z" fill="' + fill + '" stroke="' + line +
      '" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<rect x="4" y="16.2" width="16" height="2.6" rx=".6" fill="' + line + '"/>' +
      '</svg>';
  };
})();
