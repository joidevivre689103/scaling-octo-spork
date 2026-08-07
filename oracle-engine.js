// ═════════════════════════════════════════════════════════════════════════════
// oracle-engine.js — the shared Test Cricket Oracle quiz engine.
//
// Extracted 2026-08-04 from three near-identical 2,800-line pages
// (/oracle.html, /oracle/june/, /oracle/inaugural/) which were 98%+ the same
// file and carried a comment asking whoever edited one to hand-copy the change
// into the others. That sync had already failed once. This is the fix that
// file asked for.
//
// Per-edition configuration stays in the page, as a meta tag:
//     <meta name="oracle-edition" content="current">   ← /oracle.html
//     <meta name="oracle-edition" content="june">      ← /oracle/june/
// resolveEditionRequest() reads it. Nothing else differs between editions.
//
// ─── Removed in the same pass (newsletter rework) ───
// The email wall is gone. The quiz never withheld the score — there was always
// a skip link — but the copy implied otherwise, and the screen collected a
// display name for a leaderboard that will be paid and account-based, so a
// quiz-taker's typed name could never have appeared on it. Removed with it:
// the MailerLite embed and universal.js, the submit-intercept, the pseudonym
// uniqueness check against usedPseudonyms, the localStorage handoff, and
// handlePostSubscribeReturn() with its origin-edition bounce (which existed
// only because MailerLite redirected every edition back to one hardcoded URL).
//
// The newsletter invitation now lives on the score screen, after the reveal,
// as the standard site-wide component (ct-newsletter.js). Score documents are
// always anonymous; identity for the future leaderboard comes from the
// account, not from the quiz.
// ═════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// FIREBASE INIT — same project as CMS (hitwicket-cba02)
// [Migrated 2026-06-03, item (g)] compat 9.23.0 → modular 10.12.5 so this
// page can rejoin deploy-tool injection. feature-flags.js owns initializeApp
// via firebaseReady; both inits are getApps()-guarded on the same project, so
// whichever resolves first creates the default app and the other reuses it —
// the same coexistence pattern as bts.html. NOTE: this is now a module
// script: it executes deferred and in strict mode, and the inline onclick
// handlers in the markup are wired up via the explicit window exports at the
// bottom of this script.
// ═══════════════════════════════════════════════════════════════════════════
import { initializeApp, getApps, getApp }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFirestore, collection, doc, getDoc, addDoc, setDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getAuth }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

const _fbConfig = {
  apiKey: "AIzaSyBnfn9hK0y-p6nvIZ_AwoJnWD7DfDuIQd4",
  authDomain: "hitwicket-cba02.firebaseapp.com",
  projectId: "hitwicket-cba02",
  storageBucket: "hitwicket-cba02.firebasestorage.app",
  messagingSenderId: "196915483829",
  appId: "1:196915483829:web:071c47af79914aec88dafc"
};
const _app = getApps().length ? getApp() : initializeApp(_fbConfig);
const db = getFirestore(_app);
// Added 2026-08-07 for the score document's uid. Read at write time via
// auth.currentUser rather than subscribed via onAuthStateChanged: the quiz gates
// nothing on identity, so there is no UI to hold back while auth resolves, and a
// reader who finishes a quiz has been on the page long enough for the token to
// have settled. If currentUser is null the score is simply anonymous, which is
// the correct outcome for a signed-out visitor either way.
const auth = getAuth(_app);

// ═══════════════════════════════════════════════════════════════════════════
// LAUNCH DATE TOGGLE
// The score reveal CTA block changes on June 1, 2026.
// Before that: "We'll email you when the site opens" + optional flagship link.
// After that: "Explore the archive" / "Read this week's deep-dive".
// ═══════════════════════════════════════════════════════════════════════════
const LAUNCH_DATE = new Date('2026-06-01T00:00:00');
const IS_POST_LAUNCH = new Date() >= LAUNCH_DATE;

// ═══════════════════════════════════════════════════════════════════════════
// EDITION RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════
// Each HTML file that serves the Oracle declares which edition it's meant to
// show. The canonical source is a <meta> tag in <head>:
//
//   <meta name="oracle-edition" content="inaugural">      → permanent URL for one edition
//   <meta name="oracle-edition" content="current">        → /oracle.html (reads config/currentOracle)
//   (no tag)                                              → same as 'current' (back-compat)
//
// /oracle.html uses 'current' (or no tag); it fetches the current-pointer
// doc to find out which edition to load.
// /oracle/{id}/index.html pins to a specific edition permanently. Even after
// the Bowlers edition becomes current, /oracle/inaugural/ continues to serve
// the Inaugural questions, correctly-tagged in share text, etc.
// ═══════════════════════════════════════════════════════════════════════════
function resolveEditionRequest() {
  const meta = document.querySelector('meta[name="oracle-edition"]');
  const content = meta ? (meta.getAttribute('content') || '').trim() : '';
  if (!content || content === 'current') return { mode: 'current' };
  return { mode: 'fixed', editionId: content };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCALSTORAGE KEYS
// Per-edition scope: ..._{editionId}. A user who completed Inaugural can
// still take Bowlers — the single-attempt lock applies to one edition at a
// time, not to the Oracle overall. Generated lazily via lsKey() once we
// know which edition we're dealing with (post-load).
// ═══════════════════════════════════════════════════════════════════════════
function lsKey(base) {
  const id = currentEdition?.id || 'unknown';
  return `ct_oracle_${id}_${base}`;
}
// Legacy keys preserved (read-only for migration). If we ever see these on
// load, we don't act on them — they were from the pre-franchise schema where
// there was only one quiz. A user with stale localStorage will just see the
// fresh quiz without a welcome-back banner. Acceptable.
const LS_LEGACY_ANSWERS   = 'cricketTimes_quizAnswers';
const LS_LEGACY_COMPLETED = 'cricketTimes_quizCompleted';
const LS_LEGACY_SCORE     = 'cricketTimes_quizScore';
const LS_LEGACY_EMAIL     = 'cricketTimes_quizEmail';

function safeLS(fn, fallback) {
  // Some browsers (private mode, strict cookies) throw on localStorage access
  try { return fn(); } catch(e) { return fallback; }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════
let currentEdition = null;    // { id, name, month, theme, questions, ... }
let questions = [];           // currentEdition.questions, after validation filter
let answers = [];             // one entry per question; null = unanswered
let currentQIndex = 0;        // which question is on screen
let savedScoreDocId = null;   // Firestore doc ID of the score, once written

// ═══════════════════════════════════════════════════════════════════════════
// MASTHEAD DATE
// ═══════════════════════════════════════════════════════════════════════════
(function setMastheadDate() {
  const d = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const el = document.getElementById('mastheadDate');
  if (el) el.textContent = `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · Vol. I, No. 1`;
})();

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN MANAGEMENT
// Only one screen visible at a time. showScreen('quiz') hides all others
// and reveals #screen-quiz. Scrolls to top on each change.
// ═══════════════════════════════════════════════════════════════════════════
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('screen-' + name);
  if (target) {
    target.classList.add('active');
    // On mobile, a fresh screen should start at the top
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY: escape HTML to prevent accidental injection from Firestore content
// ═══════════════════════════════════════════════════════════════════════════
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

// ═══════════════════════════════════════════════════════════════════════════
// LOAD QUIZ FROM FIRESTORE
// Two-step load:
//   1. Resolve which edition to show (via <meta name="oracle-edition">
//      content, falling back to config/currentOracle if content === 'current')
//   2. Fetch oracleEditions/{id} and render
// The legacy config/launchQuiz path is gone — the CMS migration converts
// that data into oracleEditions/inaugural. If a deployed Oracle page somehow
// hits a Firestore where the migration hasn't been run, it will show the
// "no quiz published" error rather than silently serving stale data.
// ═══════════════════════════════════════════════════════════════════════════
async function loadQuizFromFirestore() {
  try {
    // Step 1: Resolve which edition this page serves
    const req = resolveEditionRequest();
    let editionId = req.editionId;

    if (req.mode === 'current') {
      // Fetch the current-edition pointer
      const pointerDoc = await getDoc(doc(db, 'config', 'currentOracle'));
      if (!pointerDoc.exists() || !pointerDoc.data().editionId) {
        showError('No current edition of The Oracle has been set yet. Check back soon.');
        return;
      }
      editionId = pointerDoc.data().editionId;
    }

    // Step 2: Fetch the edition document
    const editionDoc = await getDoc(doc(db, 'oracleEditions', editionId));
    if (!editionDoc.exists()) {
      showError(`The "${editionId}" edition of The Oracle does not exist.`);
      return;
    }
    const editionData = editionDoc.data();

    // A draft (unpublished) edition must never be served to the public via
    // the current-edition pointer. But a permanent URL explicitly pinned to
    // a draft is borderline OK — in theory it's still findable via the admin
    // sharing a preview link. For safety, block both for now: if it's a
    // draft, refuse to render. Admins previewing drafts should use a
    // separate mechanism (e.g. the CMS preview).
    if (editionData.published !== true) {
      showError('This edition of The Oracle is still being prepared. Check back soon.');
      return;
    }

    currentEdition = {
      id: editionData.id || editionId,
      name: editionData.name || 'The Test Cricket Oracle',
      month: editionData.month || '',
      theme: editionData.theme || '',
      questions: Array.isArray(editionData.questions) ? editionData.questions : []
    };

    if (currentEdition.questions.length === 0) {
      showError('The quiz is being prepared. Check back soon.');
      return;
    }

    // Normalise and validate each question. Options can be 2–6 (True/False,
    // classic multiple choice, etc.) — the CMS enforces the same range.
    // Anything outside that is rejected as malformed and logged to console.
    questions = currentEdition.questions.filter(q => {
      const ok =
        q && typeof q.question === 'string' &&
        Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6 &&
        q.options.every(o => typeof o === 'string') &&
        typeof q.correctIndex === 'number' &&
        q.correctIndex >= 0 && q.correctIndex < q.options.length;
      if (!ok) console.warn('Dropped malformed quiz question:', q);
      return ok;
    });
    if (questions.length === 0) {
      showError('The quiz questions are being finalised. Check back soon.');
      return;
    }

    // Initialise answer array
    answers = new Array(questions.length).fill(null);

    // Apply edition-specific branding to the page (kicker, title, etc.)
    applyEditionBranding();

    // ═══════════════════════════════════════════════════════════════════════
    // Post-MailerLite-redirect path: if the URL has ?subscribed=quiz, the user
    // just came back from MailerLite's form submission. Restore their quiz
    // state from localStorage and jump to the score screen with the banner.
    // If this fires, we stop here — don't want to also show the intro or the
    // completed-visitor banner.
    // ═══════════════════════════════════════════════════════════════════════

    // Check for saved state: completed or in-progress.
    // Per-edition keys, so completing Inaugural doesn't block Bowlers etc.
    const completed = safeLS(() => localStorage.getItem(lsKey('completed')), null) === 'true';
    if (completed) {
      // Returning visitor — show intro with "The Oracle remembers" banner.
      // No retake is offered (single-attempt policy). They can only review.
      showReturnBanner();
      showScreen('intro');
      return;
    }

    // Otherwise, try to restore partial progress
    const savedRaw = safeLS(() => localStorage.getItem(lsKey('answers')), null);
    if (savedRaw) {
      try {
        const saved = JSON.parse(savedRaw);
        if (Array.isArray(saved) && saved.length === questions.length) {
          answers = saved;
        }
      } catch(e) { /* ignore */ }
    }

    // Update question total on intro & progress meter
    document.getElementById('progress-total').textContent = questions.length;
    document.getElementById('score-total').textContent    = questions.length;
    showScreen('intro');
  } catch(e) {
    console.error('Quiz load error:', e);
    showError('Could not connect to the quiz database. Check your connection and try again.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// APPLY EDITION BRANDING
// Updates page elements that reflect edition-specific info. Called once per
// load, after the edition has been fetched from Firestore. Keeps the Oracle
// identity consistent across editions without any HTML edits per-edition.
// ═══════════════════════════════════════════════════════════════════════════
function applyEditionBranding() {
  if (!currentEdition) return;
  const editionLine = currentEdition.month
    ? `${currentEdition.name} · ${currentEdition.month}`
    : currentEdition.name;

  // Intro kicker (the small red line above "20 questions. 149 years.")
  const introKicker = document.querySelector('.intro-kicker');
  if (introKicker) introKicker.textContent = `◆ The Test Cricket Oracle · ${editionLine}`;

  // Browser tab title + meta tags. These matter for share-card previews —
  // a WhatsApp forward of this page shows the title and description baked in
  // at load time (OG meta tags don't update from JS for social crawlers, but
  // they do reflect correctly when a real human clicks through).
  document.title = `The Test Cricket Oracle — ${editionLine} | Cricket Times`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content',
    `The Test Cricket Oracle · ${editionLine}. ${questions.length} questions on 149 years of Test cricket.`);

  // [2026-06-04] Edition-driven intro copy. The headline and stats strip are
  // populated from the LOADED edition's validated question count, so monthly
  // rotation can never leave stale numbers on screen (the "20 questions" /
  // "13/20 obsessives" copy was inaugural-specific and survived into June).
  // The static markup is only a pre-JS placeholder.
  const _qn = questions.length;
  const _mins = Math.max(2, Math.round(_qn * 0.35));
  const _headline = document.querySelector('.intro-headline');
  if (_headline) _headline.innerHTML = _qn + ' questions.<br>149 years.';
  const _statNums = document.querySelectorAll('.intro-stat .intro-stat-num');
  if (_statNums.length >= 2) {
    _statNums[0].textContent = String(_qn);
    _statNums[1].textContent = '~' + _mins;
  }
}

function showError(msg) {
  document.getElementById('error-message').textContent = msg;
  showScreen('error');
}

function showReturnBanner() {
  const savedScore = safeLS(() => localStorage.getItem(lsKey('score')), null);
  if (savedScore == null) return;
  document.getElementById('returnScore').textContent = savedScore + '/' + questions.length;
  document.getElementById('returnBanner').classList.add('visible');
}

// ═══════════════════════════════════════════════════════════════════════════
// START
// Single-attempt enforcement: once a user has completed this edition, there
// is no retake. The welcome-back banner only shows "See your score". If
// something unexpectedly calls restartQuiz() we'd rather no-op than silently
// wipe localStorage.
// ═══════════════════════════════════════════════════════════════════════════
function startQuiz() {
  // Block start if the user has already completed this edition
  const completed = safeLS(() => localStorage.getItem(lsKey('completed')), null) === 'true';
  if (completed) {
    // They clicked Start on an edition they already completed (e.g. tapped a
    // link while the welcome-back banner was showing). Route them to their
    // score instead of letting them re-attempt.
    showPreviousScore();
    return;
  }
  // Jump to the first unanswered question (so partial-progress users continue
  // where they left off; fresh starts go to 0)
  const firstUnanswered = answers.findIndex(a => a == null);
  currentQIndex = firstUnanswered === -1 ? 0 : firstUnanswered;
  renderQuestion();
  showScreen('quiz');
}

// Retained as a no-op shim so any lingering onclick handlers don't throw.
// Under the single-attempt policy, retaking isn't allowed.
function restartQuiz() {
  console.warn('restartQuiz() called — single-attempt policy prevents retakes.');
  showPreviousScore();
}

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION RENDERING
// ═══════════════════════════════════════════════════════════════════════════
function renderQuestion() {
  const q = questions[currentQIndex];
  if (!q) return;

  const letters = ['A','B','C','D','E','F'];
  const selected = answers[currentQIndex];

  document.getElementById('question-num').textContent = `Question ${currentQIndex + 1}`;
  document.getElementById('question-text').textContent = q.question;
  document.getElementById('progress-current').textContent = currentQIndex + 1;
  document.getElementById('progress-fill').style.width = `${((currentQIndex + 1) / questions.length) * 100}%`;

  const listEl = document.getElementById('options-list');
  listEl.innerHTML = q.options.map((opt, i) => `
    <button class="option ${selected === i ? 'selected' : ''}" onclick="selectAnswer(${i})" aria-pressed="${selected === i}">
      <span class="option-letter">${letters[i]}</span>
      <span class="option-text">${escHtml(opt)}</span>
    </button>
  `).join('');

  // Prev button disabled on Q1
  document.getElementById('prev-btn').disabled = currentQIndex === 0;

  // Next button enabled only when an option is selected; label changes on last Q
  const nextBtn = document.getElementById('next-btn');
  nextBtn.disabled = selected == null;
  const isLast = currentQIndex === questions.length - 1;
  nextBtn.innerHTML = isLast ? 'Finish <span>→</span>' : 'Next <span>→</span>';
}

function selectAnswer(i) {
  answers[currentQIndex] = i;
  // Persist partial progress so refreshes don't lose the user's work
  safeLS(() => localStorage.setItem(lsKey('answers'), JSON.stringify(answers)), null);
  renderQuestion();
}

function prevQuestion() {
  if (currentQIndex > 0) {
    currentQIndex--;
    renderQuestion();
  }
}

function nextQuestion() {
  if (answers[currentQIndex] == null) return; // guard: shouldn't happen (button disabled)
  if (currentQIndex < questions.length - 1) {
    currentQIndex++;
    renderQuestion();
  } else {
    // Last question finished. Nothing is withheld: the score screen is next.
    // The newsletter invitation lives ON that screen, after the reveal.
    completeAndShowScore();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE SCORE DOCUMENT
// Writes one doc to oracleScores.
//
// SHAPE CHANGED 2026-08-07. It previously wrote `email: null`, `pseudonym: null`
// and `isStaff: false`, justified as "retained for backward compatibility with
// existing documents". That reason expired the same day: email and pseudonym
// were stripped from every existing oracleScores document during the privacy
// sweep, so there is nothing left to be compatible with, and writing them only
// recreated two empty fields shaped like the retired email wall. isStaff was
// hardcoded false and never read.
//
// IDENTITY IS NOW THE uid AND NOTHING ELSE. Signed in -> store the uid; signed
// out -> store nothing identifying. No name is captured or stored here,
// deliberately: a stored display name is a second copy that goes stale when the
// reader renames and outlives their account when it is closed, which is the
// exact class of defect the August sweep existed to remove. The leaderboard
// resolves names from users/{uid} SERVER-SIDE into a derived public document —
// it cannot resolve them in the browser, because users/{uid} is owner-or-admin
// and one reader may not read another's displayName.
//
// `anonymous` is now DERIVED from whether a user is signed in, not passed in.
// It was a parameter with exactly one caller that always passed true, i.e. a
// constant wearing a variable's clothes. It is the field the leaderboard
// filters on, so it needs to mean something.
// ═══════════════════════════════════════════════════════════════════════════
async function writeScoreDocument() {
  if (!currentEdition) return;  // safety — shouldn't happen
  if (savedScoreDocId) return;  // already written this session

  const correctCount = computeScore();
  const score = correctCount * 5;  // per v2 §6: 5 points per correct answer

  // Handle for this one submission — random per attempt, so it identifies a
  // submission and NOT a person. Do not build anything person-shaped on it.
  const sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);

  const user = auth.currentUser;

  const scoreDoc = {
    sessionId,
    uid: user ? user.uid : null,
    editionId: currentEdition.id,
    editionName: currentEdition.name,  // denormalised for leaderboard display without a join
    correctCount,
    score,
    total: questions.length,
    anonymous: !user,
    timestamp: new Date().toISOString()
  };

  try {
    const docRef = await addDoc(collection(db, 'oracleScores'), scoreDoc);
    savedScoreDocId = docRef.id;
    console.log('Score written:', docRef.id);
  } catch (e) {
    console.warn('Score write failed:', e);
    // Re-throw so callers can choose whether to surface the failure
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE AND SHOW SCORE
// The single completion path. There is no email gate and no skip path — the
// header that used to sit here described "users who refuse the email gate" and
// a "✓ You're subscribed" banner, both of which left with the wall in the
// 2026-08-04 rework. It is rewritten rather than amended because a comment
// describing two routes, directly above a body that says "single completion
// path", is worse than no comment at all.
//
// The score is written for analytics and, once a reader is signed in, for the
// leaderboard. Non-blocking: the score renders whether or not the write lands.
// ═══════════════════════════════════════════════════════════════════════════
function completeAndShowScore() {
  writeScoreDocument()
    .catch(e => console.warn('Score write failed (non-blocking):', e));

  finalizeAndShowScore();
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORING
// ═══════════════════════════════════════════════════════════════════════════
function computeScore() {
  return answers.reduce((sum, a, i) => {
    if (a == null) return sum;
    return sum + (a === questions[i].correctIndex ? 1 : 0);
  }, 0);
}

function finalizeAndShowScore() {
  const score = computeScore();

  // Persist completion — per-edition keys, so completing Inaugural doesn't
  // block the user from taking Bowlers when it ships.
  safeLS(() => {
    localStorage.setItem(lsKey('completed'), 'true');
    localStorage.setItem(lsKey('score'), String(score));
  }, null);

  renderScore(score);
  showScreen('score');
}

function showPreviousScore() {
  // Returning visitor wants to see their old score — no retake.
  const saved = safeLS(() => localStorage.getItem(lsKey('score')), null);
  if (saved == null) return;
  // Restore answers if available — otherwise the breakdown won't render correctly.
  const savedAnswers = safeLS(() => localStorage.getItem(lsKey('answers')), null);
  if (savedAnswers) {
    try {
      const parsed = JSON.parse(savedAnswers);
      if (Array.isArray(parsed) && parsed.length === questions.length) answers = parsed;
    } catch(e) { /* ignore */ }
  }
  renderScore(parseInt(saved, 10));
  showScreen('score');
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORE BANDS — The Oracle's verdicts.
// Mapped to spec bands (0–6, 7–11, 12–15, 16–18, 19–20 out of 20 → percentages).
// Percentage-based so they scale if question count changes in later editions.
// ═══════════════════════════════════════════════════════════════════════════
function getScoreBand(score, total) {
  const pct = (score / total) * 100;
  if (pct >= 95) return { title: 'The Oracle bows',          desc: 'The Oracle has rarely met its match. Please confirm your answer to question 14 was not a fluke.' };
  if (pct >= 80) return { title: 'The Oracle is impressed',  desc: 'You know your five-fors from your five wickets. Rare company.' };
  if (pct >= 60) return { title: 'The Oracle nods',          desc: 'A respectable showing. The Oracle has time for you.' };
  if (pct >= 35) return { title: 'The Oracle expected more', desc: 'You watch the game. The Oracle expects you to read about it too.' };
  return              { title: 'The Oracle has questions',   desc: 'Did you mean to take a T20 quiz?' };
}

function getPercentileText(score, total) {
  const pct = (score / total) * 100;
  if (pct >= 95) return 'Top 1% of all takers';
  if (pct >= 80) return 'Top 10% · Rare air';
  if (pct >= 65) return 'Above average';
  // [2026-06-04] Edition-agnostic: the old "(13/20)" suffix was inaugural
  // data and rendered nonsense on other editions (e.g. an 8/15 in June).
  if (pct >= 50) return 'Right around average';
  if (pct >= 30) return 'Below average';
  return 'Below average — plenty to learn';
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORE PAGE RENDER
// ═══════════════════════════════════════════════════════════════════════════
function renderScore(score) {
  const total = questions.length;
  const band = getScoreBand(score, total);

  document.getElementById('score-num').textContent = score;
  document.getElementById('score-total').textContent = total;
  document.getElementById('score-percentile').textContent = getPercentileText(score, total);
  document.getElementById('score-band').textContent = band.title;
  document.getElementById('score-band-desc').textContent = band.desc;

  // Build share links — carry the Oracle brand so every share educates another
  // person about the franchise, AND embed the edition tag so a share forwarded
  // in 2027 still reads unambiguously as "a score on the Inaugural Edition"
  // rather than claiming to be a score on whatever Oracle is currently live.
  // Edition name is pulled from currentEdition metadata (set by the CMS),
  // which means when Bowlers is current, /oracle.html shares auto-say
  // "Bowlers Edition". Permanent-URL pages like /oracle/inaugural/ keep
  // saying "Inaugural Edition" because they pin to that edition's metadata.
  //
  // The CTA ("The Oracle doubts you can do better.") is deliberately band-
  // agnostic: it works whether the user scored 4/20 (mildly self-deprecating)
  // or 20/20 (wry humble-brag) because the doubt comes from the Oracle, not
  // the user. That's why there's just one CTA line instead of five
  // score-specific ones.
  const editionTag = currentEdition?.name || 'The Test Cricket Oracle';
  const launchSuffix = currentEdition?.month ? ` Launching ${currentEdition.month}.` : ' Launching June 2026.';
  const CTA = 'The Oracle doubts you can do better.';
  const shareLine = IS_POST_LAUNCH
    ? `I scored ${score}/${total} on The Test Cricket Oracle — ${editionTag}. "${band.title}". ${CTA}`
    : `I scored ${score}/${total} on The Test Cricket Oracle — ${editionTag}. "${band.title}". ${CTA}${launchSuffix}`;
  // Share URL depends on the mode: /oracle.html for the current-mode page,
  // /oracle/{id}/ for a pinned-edition page. This keeps shares from a
  // permanent URL pointing at that permanent URL, not the rotating current.
  const editionReq = resolveEditionRequest();
  // [(g) 2026-06-03] Shares ALWAYS point at the edition's permanent URL with
  // the ?s=1 share marker — in BOTH modes. The marker is what the bootstrap's
  // oracleEdition carve-out honours: it grants the recipient durable access to
  // THIS edition (and only this edition) even after it rotates into the paid
  // archive. Pointing current-mode shares at the permalink (instead of
  // /oracle.html) also makes them edition-stable: the link still opens the
  // quiz the sharer actually played, not whatever is current when clicked.
  // PUBLISH-WORKFLOW CONTRACT: the pinned page /oracle/{id}/index.html must be
  // deployed BEFORE config/currentOracle points at the edition, or shares
  // generated in the gap 404. Fallback to /oracle.html only when no edition id
  // is resolvable (should not happen in practice).
  const _shareEditionId = (currentEdition && currentEdition.id) || editionReq.editionId || null;
  const shareUrl = _shareEditionId
    ? `https://cricketimes.com/oracle/${encodeURIComponent(_shareEditionId)}/?s=1`
    : 'https://cricketimes.com/oracle.html';
  // Store the full share text on window so copyShareLink() can read it.
  // We hoist it here rather than inlining because the Copy button was
  // relabelled "Copy" (used to be "Copy Link") — it now copies the full
  // score+verdict+CTA+URL rather than just the URL, to match user intent:
  // clicking Copy usually means "grab what I'd tweet", not "grab the URL".
  window._oracleShareText = `${shareLine} ${shareUrl}`;

  document.getElementById('share-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(window._oracleShareText);
  document.getElementById('share-twitter').href  = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(window._oracleShareText);

  renderBreakdown();
  renderPostScoreCta(score, total);
}

// ═══════════════════════════════════════════════════════════════════════════
// PER-QUESTION BREAKDOWN
// Each question shows:
//   - Question text
//   - All options (2–6 of them) with "your pick" and "correct" tagged
//   - Short explainer (always visible, inline)
//   - "Read full explanation" toggle → long explanation (expandable)
//   - Optional article link (post-launch only, from Firestore)
// ═══════════════════════════════════════════════════════════════════════════
function renderBreakdown() {
  const letters = ['A','B','C','D','E','F'];
  const breakdownHtml = questions.map((q, i) => {
    const picked  = answers[i];
    const correct = q.correctIndex;
    const isCorrect = picked === correct;
    const isSkipped = picked == null;

    const cssState = isSkipped ? 'skipped' : (isCorrect ? 'correct' : 'incorrect');
    const badgeText = isSkipped ? 'Skipped' : (isCorrect ? 'Correct' : 'Wrong');

    // Options list with tags
    const optsHtml = q.options.map((opt, j) => {
      const isPicked    = picked === j;
      const isCorrectOpt = correct === j;
      let rowClass = '';
      let tagHtml = '';
      if (isCorrectOpt) {
        rowClass = 'is-correct';
        tagHtml = '<span class="breakdown-answer-tag correct">Correct</span>';
      }
      if (isPicked && !isCorrectOpt) {
        rowClass = 'is-picked-wrong';
        tagHtml = '<span class="breakdown-answer-tag yours">Your answer</span>';
      } else if (isPicked && isCorrectOpt) {
        tagHtml = '<span class="breakdown-answer-tag yours">Your answer ✓</span>';
      }
      return `<div class="breakdown-answer-row ${rowClass}">
        <span class="breakdown-answer-letter">${letters[j]}.</span>
        <span>${escHtml(opt)}</span>
        ${tagHtml}
      </div>`;
    }).join('');

    // Long explanation — split on blank lines into paragraphs, preserve single newlines as <br>
    const longHtml = q.longExplanation && q.longExplanation.trim()
      ? q.longExplanation.trim()
          .split(/\n\s*\n/)
          .map(p => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`)
          .join('')
      : '';

    // Article link — only show post-launch, only if present
    const articleLinkHtml = (IS_POST_LAUNCH && q.articleLink && q.articleLink.trim())
      ? `<a href="${escHtml(q.articleLink)}" class="breakdown-article-link">
          ${escHtml(q.articleLinkText || 'Read more')} <span>→</span>
        </a>`
      : '';

    // Short explainer is always shown (if present); long + link expandable below
    const shortExplainerHtml = q.shortExplainer && q.shortExplainer.trim()
      ? `<div class="breakdown-short-explainer">${escHtml(q.shortExplainer)}</div>`
      : '';

    // Only render expand toggle if there's a long explanation OR an article link to show
    const hasExpandable = longHtml || articleLinkHtml;
    const expandId = `expand-${i}`;
    const expandHtml = hasExpandable
      ? `<div class="breakdown-expand" id="${expandId}">
          <button class="breakdown-expand-toggle" onclick="toggleExpand('${expandId}')">
            <span>Read full explanation</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="breakdown-long-explanation">
            ${longHtml}
            ${articleLinkHtml}
          </div>
        </div>`
      : '';

    return `
      <div class="breakdown-q ${cssState}">
        <div class="breakdown-q-header">
          <span class="breakdown-q-num">Question ${i + 1}</span>
          <span class="breakdown-q-badge ${cssState}">${badgeText}</span>
        </div>
        <div class="breakdown-q-text">${escHtml(q.question)}</div>
        <div class="breakdown-answers">${optsHtml}</div>
        ${shortExplainerHtml}
        ${expandHtml}
      </div>
    `;
  }).join('');

  document.getElementById('breakdown-list').innerHTML = breakdownHtml;
}

function toggleExpand(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// ═══════════════════════════════════════════════════════════════════════════
// POST-SCORE CTA BLOCK
// Spec-driven: pre-launch = "we'll email you when the site opens" + optional
// flagship-article link; post-launch = "explore the archive / deep-dive".
// ═══════════════════════════════════════════════════════════════════════════
function renderPostScoreCta(score, total) {
  const wrap = document.getElementById('post-score-cta-wrap');
  let html;

  if (!IS_POST_LAUNCH) {
    html = `
      <div class="post-score-cta">
        <div class="post-score-cta-kicker">\u25c6 What Happens Next</div>
        <h3>The site opens in June 2026.</h3>
        <p>
          The full archive, the tools and the long-form writing go live then.
          The Dispatch above is how you'll hear about it.
        </p>
        <div class="post-score-cta-row">
          <a href="/comingsoon.html" class="btn btn-primary">
            Back to Home <span>\u2192</span>
          </a>
          <a href="/article.html?id=five-for-evidence" class="btn btn-ghost">
            Read Our First Piece
          </a>
        </div>
      </div>
    `;
  } else {
    html = `
      <div class="post-score-cta">
        <div class="post-score-cta-kicker">\u25c6 Keep Exploring</div>
        <h3>The archive has 149 years of this.</h3>
        <p>
          Settle the next argument the same way. Browse every Test, every player,
          every era \u2014 or dive into this week's long-form piece.
        </p>
        <div class="post-score-cta-row">
          <a href="/stories.html" class="btn btn-primary">
            Read This Week's Deep-Dive <span>\u2192</span>
          </a>
          <a href="/index.html" class="btn btn-ghost">
            Explore the Archive
          </a>
        </div>
      </div>
    `;
  }
  wrap.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// COPY-TO-CLIPBOARD
// The "Copy" button (formerly "Copy Link") copies the full share text —
// score, verdict, CTA, and URL — matching what WhatsApp and X would post.
// This is a deliberate UX change: clicking Copy usually means "grab what
// I'd tweet", not "grab the URL". Users who want just the URL can still
// grab it from the browser's address bar.
//
// Falls back to a URL-only copy if renderScore hasn't run yet (shouldn't
// happen in practice — the button only exists on the score screen — but
// guards against edge cases like someone calling copyShareLink() from
// the console before completing the quiz).
// ═══════════════════════════════════════════════════════════════════════════
function copyShareLink() {
  const textToCopy = window._oracleShareText || 'https://cricketimes.com/oracle.html';
  const fallback = () => {
    // Older browsers: create a temp textarea and execCommand copy
    const ta = document.createElement('textarea');
    ta.value = textToCopy;
    ta.style.position = 'fixed';
    ta.style.top = '-999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(e) { /* give up silently */ }
    document.body.removeChild(ta);
    flashCopyToast();
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(flashCopyToast, fallback);
  } else {
    fallback();
  }
}

function flashCopyToast() {
  const toast = document.getElementById('copyToast');
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 1800);
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// Press A/B/C/D to select, → to advance, ← to go back.
// Only active on the quiz screen.
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  const quizActive = document.getElementById('screen-quiz').classList.contains('active');
  if (!quizActive) return;
  // Don't hijack typing in inputs (there aren't any on quiz screen, but future-proof)
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const key = e.key.toLowerCase();
  if (['a','b','c','d'].includes(key)) {
    const idx = ['a','b','c','d'].indexOf(key);
    const q = questions[currentQIndex];
    if (q && idx < q.options.length) {
      selectAnswer(idx);
      e.preventDefault();
    }
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (!document.getElementById('next-btn').disabled) {
      nextQuestion();
      e.preventDefault();
    }
  } else if (e.key === 'ArrowLeft') {
    if (!document.getElementById('prev-btn').disabled) {
      prevQuestion();
      e.preventDefault();
    }
  }
});

// (The Enter-key-submits-on-email-wall listener was removed when we switched
// to the MailerLite embedded form — MailerLite's own form handles Enter
// natively, so no custom keydown wiring is needed here any more.)

// ═══════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════
// Load the quiz. loadQuizFromFirestore() populates `questions`, initialises
// `answers`, then routes the user to the right screen (intro / return /
// score via subscribed-return).
loadQuizFromFirestore();

// ═══════════════════════════════════════════════════════════════════════════
// WINDOW EXPORTS — required by the module conversion [(g) 2026-06-03]
// ═══════════════════════════════════════════════════════════════════════════
// This script is now type="module", so top-level functions live in module
// scope, NOT on window. The markup's inline onclick= handlers (including the
// runtime-templated selectAnswer(${i}) and toggleExpand('${id}')) resolve
// against window, so every function referenced from an inline handler must be
// exported explicitly. If you add a new inline handler, add its function here.
window.startQuiz = startQuiz;
window.prevQuestion = prevQuestion;
window.nextQuestion = nextQuestion;
window.selectAnswer = selectAnswer;
window.showPreviousScore = showPreviousScore;
window.copyShareLink = copyShareLink;
window.toggleExpand = toggleExpand;
