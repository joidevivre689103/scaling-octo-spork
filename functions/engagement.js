/*
 * Cricket Times — engagement collector (Firebase Cloud Function)
 * =============================================================
 * File: functions/engagement.js  (require + re-export from functions/index.js)
 *
 * ONE HTTPS function, `collectEngagement`, that receives batched events from
 * ct-tracker.js and aggregates them into SITE-WIDE totals only.
 *
 * ── AGGREGATE-ONLY REWRITE (2026-08-07, item (0)) ─────────────────────────
 * This function used to maintain a per-reader record. It no longer does, and
 * must not be allowed to again. What was removed, and why:
 *
 *   userEngagement/{uid}              — lifetime per-reader totals.   DELETED
 *   userEngagementDaily/{uid}_{date}  — per-reader per-day totals AND a
 *                                       per-reader `pages` map, i.e. a list of
 *                                       which pages that account opened.  DELETED
 *   engagementEvents/{auto}           — raw page_view rows carrying
 *                                       { uid, path, section, contentId }.
 *                                       A 90-day reading trail that NOTHING
 *                                       ever read — no admin page, and the
 *                                       Firestore rules denied every client.
 *                                                                     DELETED
 *
 * `privacy.html` §1.4 states that measurement counts pages and visits, not
 * readers, and that no list of which pages an account opened is kept or
 * reconstructable. The three stores above each falsified that sentence. This
 * file is now the thing that makes it true.
 *
 * THE RULE THIS FILE ENFORCES: no uid, no email, and no page path is ever
 * written against anything that identifies a person. A uid IS still derived
 * from the ID token — but only to choose which of two counters to increment
 * (signed-in vs anonymous page views), and it is discarded when the request
 * ends. It is never written to Firestore, in any collection, in any field.
 *
 * ── HOW SESSION DURATION SURVIVES WITHOUT A uid ──────────────────────────
 * Session span and the engaged/grace split used to be computed by grouping a
 * reader's events under their uid. They are now grouped under `ct_sid`, the
 * per-visit id ct-tracker.js already stamps on every event. It rotates after
 * 30 minutes idle and at local midnight, so it identifies a VISIT, not a
 * person, and it never leaves the day it belongs to.
 *
 * Span is a min/max over event timestamps, which cannot be expressed as a
 * Firestore increment, so it needs a read-modify-write somewhere. That
 * somewhere is a scratch document:
 *
 *   engagementSessions/{date}_{sid}   — { first, last, lastInteraction,
 *                                         appliedSpanMs, appliedGraceMs }
 *
 * It holds TIMESTAMPS ONLY. No uid, no path, no section, no title. It is not
 * a reading trail in a different key, and it must never be allowed to become
 * one — do not add a `pages` map here, however convenient it looks.
 *
 * Each batch folds its events into that doc, computes the DELTA against what
 * has already been applied, and increments the day aggregate by the delta —
 * so a session whose events arrive across ten batches is counted once, not
 * ten times. The doc carries `expireAt` at +2 days and is deleted by a
 * Firestore TTL policy: the sid is discarded once the day's totals are
 * written, exactly as item (0) requires. Two days rather than one because a
 * session can start before local midnight, and because ct-tracker's
 * `ct_pending` buffer can replay a batch on the next page load.
 *
 * ── WHAT IS WRITTEN ──────────────────────────────────────────────────────
 *   engagementAggregate/{date}   — site-wide, non-identifying:
 *                                    pageViews      all traffic
 *                                    anonPageViews  logged-out subset
 *                                    sessions       session_start count
 *                                    activeTimeMs   heartbeat sum (engaged)
 *                                    sessionTimeMs  Σ session spans
 *                                    graceTimeMs    Σ idle-grace tails
 *                                    pages{}        per-path views + dwell
 *   engagementSessions/{date}_{sid} — scratch span state, TTL 2 days
 *
 * ── DELIBERATELY NOT WRITTEN ─────────────────────────────────────────────
 *   uniqueUsers — was incremented once per reader per day, which required
 *                 knowing the reader. It cannot be computed under this model
 *                 and is no longer written. Historical values on existing day
 *                 docs are left alone. A headcount now comes from `logins`
 *                 (sign-in events) — a separate piece of work.
 *   sections{}  — the per-section rollup only ever landed on the per-reader
 *                 daily doc and no page ever read it. Not carried over; if
 *                 site-wide section popularity is wanted later it can be
 *                 added to the aggregate cleanly, since it is not per-person.
 *
 * ── EXPECTED CHANGES IN THE NUMBERS (not bugs) ───────────────────────────
 *   • sessionTimeMs / graceTimeMs will JUMP. They previously counted signed-in
 *     readers only, because spans lived on the per-reader daily doc. Anonymous
 *     visits now contribute too. This is better coverage, not inflation.
 *   • uniqueUsers stops advancing. See above.
 *
 * Security model (unchanged):
 *   - Identity comes from the Firebase ID token in the request body, verified
 *     server-side. The client-sent uid is IGNORED.
 *   - All writes use the Admin SDK, which BYPASSES Firestore security rules —
 *     that's why the rules deny every client write to these collections.
 */
'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const VALID_TYPES = new Set(['page_view', 'heartbeat', 'session_start', 'identify']);

// Reflect the caller's Origin when it's the apex cricketimes.com or any of its
// subdomains (www, etc.). Reflecting (rather than hardcoding one exact string)
// is what makes www + apex both work. Falls back to the apex for anything else.
function corsAllowOrigin(req) {
  const o = req.get('origin') || '';
  try {
    const host = new URL(o).hostname;
    if (host === 'cricketimes.com' || host.endsWith('.cricketimes.com')) return o;
  } catch (e) { /* no/invalid Origin */ }
  return 'https://cricketimes.com';
}

const MAX_EVENTS_PER_REQUEST = 200;
const MAX_MS_PER_BEAT = 5 * 60 * 1000; // sanity cap on a single heartbeat
const MAX_SPANS_PER_REQUEST = 50;  // distinct sids folded per request (bot/pathology guard)
const MAX_SESSION_SPAN_MS = 12 * 60 * 60 * 1000; // 12h — a span longer than this is a clock
                                   // glitch or a left-open tab, not a real session; clamp it
const MAX_GRACE_MS = 240 * 1000;   // grace tail can't exceed the 180s idle window by much;
                                   // clamp defensively so a clock jump can't invent huge grace
const MAX_PAGES_PER_DAY = 500;     // cap on the per-path `pages` map size (distinct pages/day)
const SPAN_TTL_DAYS = 2;           // engagementSessions scratch retention — see header

exports.collectEngagement = onRequest(
  { region: 'us-central1', maxInstances: 10, cors: false },
  async (req, res) => {
    // ---- CORS (first-party only) ----
    // Allow-Credentials: 'true' is required because navigator.sendBeacon always
    // sends the request in credentialed mode (it includes cookies). Without it,
    // the beacon's preflight fails. With credentials, Allow-Origin MUST be a
    // specific origin (never '*') — which corsAllowOrigin() guarantees.
    res.set('Access-Control-Allow-Origin', corsAllowOrigin(req));
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    // ---- simple bot guard ----
    const ua = req.get('user-agent') || '';
    if (/bot|crawler|spider|headless|monitoring/i.test(ua)) {
      return res.status(202).json({ dropped: 'bot' });
    }

    const body = req.body || {};
    const events = Array.isArray(body.events) ? body.events : [];
    if (!events.length) return res.status(400).json({ error: 'no events' });

    // ---- identity: verified, used, and thrown away ----
    // The token is verified so that a signed-in visit can be told apart from an
    // anonymous one in the aggregate counters. `signedIn` is the ONLY thing that
    // survives this block. The uid is scoped to it and never leaves — do not
    // hoist it, do not pass it to a write, do not log it.
    let signedIn = false;
    if (body.idToken) {
      try {
        const decoded = await admin.auth().verifyIdToken(body.idToken);
        signedIn = !!(decoded && decoded.uid);
      } catch (_) {
        signedIn = false;   // invalid/expired → counts as anonymous
      }
    }

    // ---- group events by local day ----
    const serverDate = new Date().toISOString().slice(0, 10);
    const perDay = {};
    for (const ev of events.slice(0, MAX_EVENTS_PER_REQUEST)) {
      if (!VALID_TYPES.has(ev.event_type)) continue;
      const date = (typeof ev.local_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.local_date))
        ? ev.local_date : serverDate;
      const d = perDay[date] || (perDay[date] = { pageViews: 0, sessions: 0, activeMs: 0, spans: {}, pages: {} });
      const pageKey = ev.url_path ? fieldSafe(String(ev.url_path).slice(0, 120)) : null;

      // Session duration is derived, not measured client-side: sessions have no
      // clean "end" (a closed tab never fires one), so instead of trusting an
      // end event we track the first and last CLIENT timestamp seen for each
      // session_id and take (last − first). Every event already carries both
      // session_id and ts, so this needs nothing from the tracker. Using the
      // client clock is fine because a DIFFERENCE between two stamps from the
      // same clock is skew-free even if the absolute time is wrong. The last
      // heartbeat before a tab closes sets the final `last`, so duration is
      // captured even when the session ends by the reader simply leaving.
      //
      // We also track the latest last_interaction_ts per session. The gap
      // between the last real interaction and the last recorded activity is the
      // idle-GRACE tail (up to 180s the tracker keeps counting after the reader
      // stops interacting). Separating it lets the admin show ENGAGED time
      // apart from padded wall-clock time.
      //
      // [2026-08-07] The grouping key was the uid until this rewrite; it is now
      // the tracker's per-visit ct_sid. The arithmetic below is unchanged —
      // only what it is keyed on, and where the running state is kept.
      var _sid = (typeof ev.session_id === 'string' && ev.session_id) ? ev.session_id : null;
      var _ts  = ev.ts ? Date.parse(ev.ts) : NaN;
      var _its = ev.last_interaction_ts ? Date.parse(ev.last_interaction_ts) : NaN;
      if (_sid && !isNaN(_ts)) {
        var _sp = d.spans[_sid];
        if (_sp) {
          if (_ts < _sp.first) _sp.first = _ts;
          if (_ts > _sp.last)  _sp.last  = _ts;
          if (!isNaN(_its) && _its > _sp.lastInteraction) _sp.lastInteraction = _its;
        } else if (Object.keys(d.spans).length < MAX_SPANS_PER_REQUEST) {
          d.spans[_sid] = { first: _ts, last: _ts, lastInteraction: (!isNaN(_its) ? _its : _ts) };
        }
      }

      if (ev.event_type === 'page_view') {
        d.pageViews++;
        if (pageKey) bumpPage(d, pageKey, 1, 0);
      } else if (ev.event_type === 'session_start') {
        d.sessions++;
      } else if (ev.event_type === 'heartbeat') {
        const ms = Math.max(0, Math.min(Number(ev.active_ms_delta) || 0, MAX_MS_PER_BEAT));
        d.activeMs += ms;
        if (pageKey) bumpPage(d, pageKey, 0, ms);   // per-page dwell time
      }
      // 'identify' carries no metric payload — used only to confirm auth. Its
      // session_id/ts still feed the span above, which is why it stays valid.
    }

    try {
      for (const [date, d] of Object.entries(perDay)) {
        // Counters first: pure increments, no read, concurrent-batch safe.
        // ONE write path for everybody. There is no identified branch any more,
        // and there must not be one — `signedIn` picks a counter, nothing else.
        await db.doc(`engagementAggregate/${date}`).set({
          date,
          pageViews: FieldValue.increment(d.pageViews),
          sessions: FieldValue.increment(d.sessions),
          activeTimeMs: FieldValue.increment(d.activeMs),
          ...(signedIn ? {} : { anonPageViews: FieldValue.increment(d.pageViews) }),
          pages: pagesInc(d.pages),   // per-path views + dwell, site-wide
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Then the spans, one transaction per visit. Sequential rather than
        // parallel: a batch normally carries exactly one sid, and serialising
        // keeps contention on the day doc predictable when it carries more.
        for (const [sid, sp] of Object.entries(d.spans)) {
          await applySpan(date, sid, sp);
        }
      }
      return res.status(202).json({ ok: true, identified: signedIn });
    } catch (e) {
      console.error('collectEngagement write failed:', e);
      return res.status(500).json({ error: 'write failed' });
    }
  }
);

// ── Session span folding ────────────────────────────────────────────────────
// Read-modify-write on ONE scratch doc per visit, plus a delta increment on the
// day aggregate, inside a single transaction so the two can never disagree.
//
// Why the delta: a visit's events arrive across many batches, and each batch may
// extend the span. `appliedSpanMs` records how much of this visit has already
// been added to the day total, so each batch contributes only the growth. Write
// the doc without the transaction and a retry would double-count; increment the
// aggregate outside it and a crash between the two would lose the growth
// permanently, because the scratch doc would already claim it was applied.
//
// The doc holds timestamps and nothing else. See the header — this is the line
// that keeps it from becoming a reading trail under a different key.
async function applySpan(date, sid, sp) {
  const ref = db.doc(`engagementSessions/${date}_${sid}`);
  const aggRef = db.doc(`engagementAggregate/${date}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() || {}) : null;

    const first = cur && typeof cur.first === 'number' ? Math.min(cur.first, sp.first) : sp.first;
    const last  = cur && typeof cur.last  === 'number' ? Math.max(cur.last,  sp.last)  : sp.last;
    const lastInteraction = Math.max(
      (cur && (cur.lastInteraction || cur.last)) || 0,
      sp.lastInteraction || sp.last || 0
    );

    const spanMs  = Math.max(0, Math.min(last - first, MAX_SESSION_SPAN_MS));
    const graceMs = Math.max(0, Math.min(last - lastInteraction, MAX_GRACE_MS, spanMs));

    const spanDelta  = spanMs  - ((cur && cur.appliedSpanMs)  || 0);
    const graceDelta = graceMs - ((cur && cur.appliedGraceMs) || 0);

    tx.set(ref, {
      date,
      first, last, lastInteraction,
      appliedSpanMs: spanMs,
      appliedGraceMs: graceMs,
      // Firestore TTL field — the policy on engagementSessions.expireAt is what
      // actually discards the sid. Without that policy this collection grows
      // forever and the sid is not discarded at all, which is the whole point.
      expireAt: new Date(Date.now() + SPAN_TTL_DAYS * 86400000),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (spanDelta !== 0 || graceDelta !== 0) {
      tx.set(aggRef, {
        date,
        sessionTimeMs: FieldValue.increment(spanDelta),
        graceTimeMs: FieldValue.increment(graceDelta),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });
}

// Per-path accumulator, capped at MAX_PAGES_PER_DAY distinct paths per request.
function bumpPage(d, pageKey, views, ms) {
  let p = d.pages[pageKey];
  if (!p) {
    if (Object.keys(d.pages).length >= MAX_PAGES_PER_DAY) return; // cap distinct paths/request
    p = d.pages[pageKey] = { views: 0, ms: 0 };
  }
  p.views += views; p.ms += ms;
}
// Build a Firestore-mergeable increment object from a {pathKey:{views,ms}} map:
// { pages: { path: { views: inc, activeTimeMs: inc } } } — pure increments, so
// no read needed and concurrent batches stay safe.
//
// NOTE: this map is site-wide. It says "/compare.html was opened 240 times",
// never who opened it. That distinction is the whole difference between this
// file before and after the rewrite — the identical structure on the per-reader
// daily doc was the reading trail that had to go.
function pagesInc(pages) {
  const out = {};
  for (const [k, v] of Object.entries(pages)) {
    out[k] = { views: FieldValue.increment(v.views), activeTimeMs: FieldValue.increment(v.ms) };
  }
  return out;
}
// Firestore map keys can't contain . $ [ ] / ~ * — make path keys safe.
function fieldSafe(s) { return s.replace(/[.$\[\]/~*()]/g, '_'); }
