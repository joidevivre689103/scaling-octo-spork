/* article-window-filter.js
 * --------------------------------------------------------------------------
 * Shared helper for the homepage "live window" rule:
 *   An article appears on the homepage for N days after first publish,
 *   then ages off (it remains in the archive forever via everPublished).
 *
 * Used by stories.html (current homepage) and any future page that becomes
 * the homepage (e.g. index.html post-launch). Lives as a single source of
 * truth so the rule never drifts between pages.
 *
 * Public API (attached to window.CTArticleWindow):
 *   - DEFAULT_WINDOW_DAYS: number  (10)
 *   - getWindowDays(db): Promise<number>
 *       Reads config/site.homepageWindowDays. Falls back to default on any
 *       error / missing field.
 *   - getEffectiveDate(article): Date | null
 *       Prefers article.firstPublishedAt (Firestore Timestamp), falls back
 *       to article.date (YYYY-MM-DD string). Returns null if neither valid.
 *   - filterToLiveWindow(articles, days): Article[]
 *       Returns the subset of articles whose effective date is within the
 *       last `days` days from now, AND that are not withdrawn. Articles
 *       missing both timestamps are excluded (defensive — a homepage
 *       candidate without a publish date is a data bug, not something to
 *       render). Withdrawn articles (withdrawn === true) are also
 *       excluded — their URL still resolves to a withdrawal notice via
 *       article.html, but they don't appear in any feed.
 * -------------------------------------------------------------------------- */
(function () {
  'use strict';

  const DEFAULT_WINDOW_DAYS = 10;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  /**
   * Load the homepage window length (in days) from config/site.
   * Accepts either a Firestore v9 modular `db` (with getDoc/doc imported
   * inside) OR the legacy compat `firebase.firestore()` instance, since the
   * codebase uses both. Detects which by checking for `.collection`.
   */
  async function getWindowDays(db) {
    try {
      let data = null;
      if (db && typeof db.collection === 'function') {
        // Compat SDK (firebase.firestore())
        const snap = await db.collection('config').doc('site').get();
        if (snap.exists) data = snap.data();
      } else if (db) {
        // Modular SDK — caller passes the modular db; we lazy-import getDoc/doc
        const { getDoc, doc } = await import(
          'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'
        );
        const snap = await getDoc(doc(db, 'config', 'site'));
        if (snap.exists()) data = snap.data();
      }
      const n = data && Number(data.homepageWindowDays);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    } catch (e) {
      console.warn('[article-window-filter] could not read config/site, using default:', e?.message || e);
    }
    return DEFAULT_WINDOW_DAYS;
  }

  /**
   * Resolve an article's effective publish date.
   * Prefers firstPublishedAt (Firestore Timestamp object with .toDate()),
   * falls back to the YYYY-MM-DD `date` string.
   */
  function getEffectiveDate(article) {
    if (!article) return null;

    // Preferred: server timestamp written on first publish
    const ts = article.firstPublishedAt;
    if (ts) {
      if (typeof ts.toDate === 'function') {
        const d = ts.toDate();
        if (!isNaN(d)) return d;
      } else if (ts instanceof Date && !isNaN(ts)) {
        return ts;
      } else if (typeof ts === 'string' || typeof ts === 'number') {
        const d = new Date(ts);
        if (!isNaN(d)) return d;
      }
    }

    // Fallback: editorial date string (YYYY-MM-DD)
    if (typeof article.date === 'string' && article.date) {
      // Parse as local date at midnight to avoid TZ surprises
      const m = article.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        if (!isNaN(d)) return d;
      }
      const d = new Date(article.date);
      if (!isNaN(d)) return d;
    }

    return null;
  }

  /**
   * Filter to articles whose effective date is within the last `days` days,
   * AND that have not been withdrawn. Articles without a usable date or
   * with withdrawn === true are excluded.
   */
  function filterToLiveWindow(articles, days) {
    if (!Array.isArray(articles)) return [];
    const n = Number.isFinite(days) && days > 0 ? days : DEFAULT_WINDOW_DAYS;
    const cutoff = Date.now() - n * MS_PER_DAY;
    return articles.filter(a => {
      if (a && a.withdrawn === true) return false;
      const d = getEffectiveDate(a);
      return d && d.getTime() >= cutoff;
    });
  }

  window.CTArticleWindow = {
    DEFAULT_WINDOW_DAYS,
    getWindowDays,
    getEffectiveDate,
    filterToLiveWindow
  };
})();