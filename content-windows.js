/* content-windows.js
 * --------------------------------------------------------------------------
 * Generalized "live window" helper for content listed on live pages.
 *
 * Live pages (stories.html, future interviews.html, future audio-live.html,
 * etc.) show items only within their configured live-window. Items outside
 * the window age off the live page — they're still readable via direct
 * URL (per Philosophy A) but no longer surface on the live feed.
 *
 * This file exists to ensure the rule never drifts between content types.
 * Each new content type registers its window setting key here, and live
 * pages use the shared helpers to filter their feeds.
 *
 * IMPORTANT: this module does NOT gate URL access. That's access-control.js.
 * This module only filters what shows up on live pages. The two are
 * deliberately independent — see access-control.js for the rationale.
 *
 * Public API (attached to window.CTContentWindows):
 *   - REGISTRY: { contentType: { configKey, defaultDays } }
 *   - getWindowDays(db, contentType): Promise<number>
 *   - getEffectiveDate(item): Date | null
 *   - filterToLiveWindow(items, contentType, days): Item[]
 *
 * Today, only 'article' is registered (replicating the existing
 * article-window-filter.js behavior). Future content types add a one-line
 * entry to REGISTRY and reuse the same helpers.
 * -------------------------------------------------------------------------- */
(function () {
  'use strict';

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // ─── REGISTRY OF CONTENT TYPES ───────────────────────────────────────────
  // Each entry maps a content-type identifier to:
  //   - configKey:    field in config/site that holds the live-window days
  //   - defaultDays:  fallback if the config field is missing/invalid
  //
  // To add a new content type (e.g., interviews):
  //   1. Add an entry below (e.g. interview: { configKey: 'interviewWindowDays', defaultDays: 30 })
  //   2. Set the value in CMS → Site Settings
  //   3. The new live page calls
  //        CTContentWindows.filterToLiveWindow(items, 'interview', days)
  //      using days fetched via getWindowDays(db, 'interview').
  const REGISTRY = {
    article: {
      configKey:   'homepageWindowDays',
      defaultDays: 10
    }

    // Reserved slots — uncomment when content types ship:
    // ,audio:    { configKey: 'audioWindowDays',     defaultDays: 30 }
    // ,oracle:   { configKey: 'oracleWindowDays',    defaultDays: 30 }
    // ,interview:{ configKey: 'interviewWindowDays', defaultDays: 14 }
  };

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  // Read the live-window length (in days) from config/site for the given
  // content type. Falls back to the type's default on any error or if the
  // configured value isn't a valid positive number.
  //
  // Accepts either a Firestore v9 modular `db` OR the legacy compat
  // `firebase.firestore()` instance (codebase uses both).
  async function getWindowDays(db, contentType) {
    const entry = REGISTRY[contentType];
    if (!entry) {
      console.warn('[content-windows] unknown content type:', contentType);
      return 10; // safe default
    }

    try {
      let data = null;
      if (db && typeof db.collection === 'function') {
        // Compat SDK (firebase.firestore())
        const snap = await db.collection('config').doc('site').get();
        if (snap.exists) data = snap.data();
      } else if (db) {
        // Modular SDK
        const { getDoc, doc } = await import(
          'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'
        );
        const snap = await getDoc(doc(db, 'config', 'site'));
        if (snap.exists()) data = snap.data();
      }
      const n = data && Number(data[entry.configKey]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    } catch (e) {
      console.warn('[content-windows] could not read config/site for',
                   contentType, '— using default:', e && e.message || e);
    }
    return entry.defaultDays;
  }

  // Resolve an item's effective publish date. Prefers firstPublishedAt
  // (Firestore Timestamp), falls back to the YYYY-MM-DD `date` string.
  // Same logic as the original article-window-filter.js so behavior is
  // identical for articles.
  function getEffectiveDate(item) {
    if (!item) return null;

    const ts = item.firstPublishedAt;
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

    if (typeof item.date === 'string' && item.date) {
      const m = item.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        if (!isNaN(d)) return d;
      }
      const d = new Date(item.date);
      if (!isNaN(d)) return d;
    }

    return null;
  }

  // Filter to items whose effective date is within the last `days` days,
  // AND that have not been withdrawn. Items missing both timestamps are
  // excluded (defensive — a live-page candidate without a publish date is
  // a data bug, not something to render). The contentType parameter is
  // accepted for future per-type behavior (e.g. different "withdrawn"
  // flag names) but not currently used — the rules below apply uniformly.
  function filterToLiveWindow(items, contentType, days) {
    if (!Array.isArray(items)) return [];
    const entry = REGISTRY[contentType];
    const fallback = entry ? entry.defaultDays : 10;
    const n = Number.isFinite(days) && days > 0 ? days : fallback;
    const cutoff = Date.now() - n * MS_PER_DAY;
    return items.filter(item => {
      if (item && item.withdrawn === true) return false;
      const d = getEffectiveDate(item);
      return d && d.getTime() >= cutoff;
    });
  }

  window.CTContentWindows = {
    REGISTRY:           REGISTRY,
    getWindowDays:      getWindowDays,
    getEffectiveDate:   getEffectiveDate,
    filterToLiveWindow: filterToLiveWindow
  };
})();
