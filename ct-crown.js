/* ct-crown.js — the Yorker crown beside a reader's name  (2026-11-25, IJ)
 *
 * Readers who finish in the top five of a monthly Yorker earn a crown. It is
 * shown beside their display name on comments (article.html) and in Behind
 * the Scenes (bts.html). One crown, never a number: its shade deepens with
 * how many they have earned. A crown once earned is kept for good; closing
 * the account removes it.
 *
 * Shades and count as decided 2026-10-30 (IJ; Yorker spec §7b): bronze from
 * 1 crown, silver from 5, gold from 12, deep gold from 25. Never a number
 * beside the name; the exact count shows on hover (the title).
 *
 * The count comes from crowns/{uid} (public get, no list), which super-
 * fortnight's publishYorkerStats rewrites every hour. Pages look it up next
 * to publicProfiles/{uid} and call:
 *
 *   window.ctCrown(count)  ->  HTML string ('' when count is 0 or missing)
 *
 */
(function () {
  var SHADES = [               // [from count, fill, outline]
    [25, '#b8860b', '#6e5006'],  // deep gold
    [12, '#e0b43a', '#9a7414'],  // gold
    [5,  '#c4c9cf', '#7d848c'],  // silver
    [1,  '#c27c3e', '#7f4c20']   // bronze
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
    var label = n === 1 ? 'Yorker crown' : 'Yorker crown \u00d7 ' + n;
    return '<svg class="ct-crown" viewBox="0 0 24 20" role="img" aria-label="' + label + '">' +
      '<title>' + label + '</title>' +
      '<path d="M2 6l5 5 5-9 5 9 5-5-2 11H4z" fill="' + fill + '" stroke="' + line +
      '" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<rect x="4" y="16.2" width="16" height="2.6" rx=".6" fill="' + line + '"/>' +
      '</svg>';
  };
})();
