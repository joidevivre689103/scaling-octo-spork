// ═════════════════════════════════════════════════════════════════════════════
// oracle-engine.js — the shared Yorker quiz engine.
//
// RENAMED 2026-08-14: the quiz was "The Test Cricket Oracle" until CricketArchive's
// own Oracle search made the name a collision. ONLY READER-FACING STRINGS MOVED.
// Everything an identifier touches deliberately still says oracle:
//   • this filename, and the <script> tags in the three edition pages
//   • the oracleEditions / oracleScores collections, config/currentOracle
//   • the <meta name="oracle-edition"> tag
//   • the ct_oracle_{id}_* localStorage prefix in lsKey()  ← see the note there
//   • the /yorker.html and /yorker/{id}/ URLs
// Renaming any of those is a migration, not a rename.
//
// Extracted 2026-08-04 from three near-identical 2,800-line pages
// (/yorker.html, /yorker/june/, /yorker/inaugural/) which were 98%+ the same
// file and carried a comment asking whoever edited one to hand-copy the change
// into the others. That sync had already failed once. This is the fix that
// file asked for.
//
// Per-edition configuration stays in the page, as a meta tag:
//     <meta name="oracle-edition" content="current">   ← /yorker.html
//     <meta name="oracle-edition" content="june">      ← /yorker/june/
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
// as the standard site-wide component (ct-newsletter.js). Identity for the
// future leaderboard comes from the account, not from the quiz.
//
// [2026-10-21] LOGIN TO PLAY. A free account is now required to play; anonymous
// score documents are no longer written. One score per account per edition, at
// oracleScores/{uid}_{editionId}. See writeScoreDocument().
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
  from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc }
  from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';

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
// LOGIN TO PLAY — 2026-10-21, item (6) pre-launch half.
// Yorker now needs a (free) account to play. Anonymous play is over: the 2026-08-07
// note here said "the quiz gates nothing on identity", and that is no longer true,
// so the engine now WAITS for the first auth answer before routing to a screen.
// authReady resolves once with the user or null; null means definitively signed
// out, not still checking.
const auth = getAuth(_app);
const authReady = new Promise(resolve => {
  const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user || null); });
});
let currentUser = null;       // set from authReady in loadQuizFromFirestore()

// One score document per account per edition, at a FIXED id. The id is the lock:
// firestore.rules allows CREATE on this path and denies UPDATE, so a second
// attempt from any device is refused by the server, not just by this browser.
function scoreDocId() {
  return `${currentUser.uid}_${currentEdition.id}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// LAUNCH DATE TOGGLE
// The score reveal CTA block changes on June 1, 2026.
// Before that: "We'll email you when the site opens" + optional flagship link.
// After that: "Explore the archive" / "Read this week's deep-dive".
// ═══════════════════════════════════════════════════════════════════════════
const LAUNCH_DATE = new Date('2026-06-01T00:00:00');
const IS_POST_LAUNCH = new Date() >= LAUNCH_DATE;

// [2026-10-17] Years of Test cricket, counted from the first Test (March 1877).
// Computed so "149 years" can't go stale — it reads 150 from 1 January 2027.
// Every on-page mention is a <span data-test-years> placeholder in the edition
// pages (pre-JS fallback text), filled below. Static meta/OG copy can't run JS,
// so those say "since 1877" instead.
const FIRST_TEST_YEAR = 1877;
const TEST_YEARS = new Date().getFullYear() - FIRST_TEST_YEAR;
document.querySelectorAll('[data-test-years]').forEach(el => { el.textContent = String(TEST_YEARS); });

// ═══════════════════════════════════════════════════════════════════════════
// EDITION RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════
// Each HTML file that serves Yorker declares which edition it's meant to
// show. The canonical source is a <meta> tag in <head>:
//
//   <meta name="oracle-edition" content="inaugural">      → permanent URL for one edition
//   <meta name="oracle-edition" content="current">        → /yorker.html (reads config/currentOracle)
//   (no tag)                                              → same as 'current' (back-compat)
//
// /yorker.html uses 'current' (or no tag); it fetches the current-pointer
// doc to find out which edition to load.
// /yorker/{id}/index.html pins to a specific edition permanently. Even after
// the Bowlers edition becomes current, /yorker/inaugural/ continues to serve
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
// time, not to the quiz overall. Generated lazily via lsKey() once we
// know which edition we're dealing with (post-load).
// ═══════════════════════════════════════════════════════════════════════════
function lsKey(base) {
  const id = currentEdition?.id || 'unknown';
  // DO NOT RENAME THIS PREFIX to match the 2026-08-14 Yorker rename. It is the
  // single-attempt lock: every reader who has already completed an edition is
  // recorded under ct_oracle_{id}_completed in their own browser. Changing the
  // prefix orphans all of those records at once, and every one of those readers
  // is handed a fresh, retakeable quiz — silently breaking the one-score-per-
  // participant rule the leaderboard depends on. The reader never sees this string.
  //
  // [2026-10-21] Since login-to-play, these keys are a CACHE, not the lock. The
  // lock is oracleScores/{uid}_{editionId}, which the rules let an account create
  // once. On load, syncLockWithAccount() makes this browser agree with that doc:
  // a doc restores the completed state here (so a second device shows the score),
  // and no doc clears a stale `completed` left by an anonymous play from before
  // the change or by a different account on a shared browser. The prefix still
  // must not change — `answers` holds in-progress play across a refresh.
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

// MASTHEAD DATE — setMastheadDate() DELETED 2026-08-14. It looked up an
// #mastheadDate element that has not existed on any quiz page since the
// 2026-06-05 shared-chrome migration, so it had been a guarded no-op for two
// months, and it carried a hardcoded "Vol. I, No. 1" that would have been wrong
// the moment it ever ran again. ct-nav.js renders the real date into
// .ct-masthead-date. This is the last of the three 2026-06-05 leftovers — the
// .masthead CSS block went the same day, in oracle-engine.css.

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
// that data into oracleEditions/inaugural. If a deployed Yorker page somehow
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
        showError('No current edition of Yorker has been set yet. Check back soon.');
        return;
      }
      editionId = pointerDoc.data().editionId;
    }

    // Step 2: Fetch the edition document
    const editionDoc = await getDoc(doc(db, 'oracleEditions', editionId));
    if (!editionDoc.exists()) {
      showError(`The "${editionId}" edition of Yorker does not exist.`);
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
      showError('This edition of Yorker is still being prepared. Check back soon.');
      return;
    }

    currentEdition = {
      id: editionData.id || editionId,
      name: editionData.name || 'Yorker',
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

    // Question counts on the intro and progress meter — set before any branch
    // below returns, so the signed-out intro shows the right numbers too.
    document.getElementById('progress-total').textContent = questions.length;
    document.getElementById('score-total').textContent    = questions.length;

    // [2026-10-21] Login to play. A signed-out visitor sees the intro with a
    // sign-in button in place of Start. (The comment that sat here described a
    // ?subscribed=quiz MailerLite return path that was removed on 2026-08-04.)
    currentUser = await authReady;
    if (!currentUser) {
      showSignInToPlay();
      showScreen('intro');
      return;
    }
    await syncLockWithAccount();

    // Check for saved state: completed or in-progress.
    // Per-edition keys, so completing Inaugural doesn't block Bowlers etc.
    const completed = safeLS(() => localStorage.getItem(lsKey('completed')), null) === 'true';
    if (completed) {
      // Returning visitor — show intro with the welcome-back banner.
      // No retake is offered (single-attempt policy). They can only review.
      showReturnBanner();
      showAlreadyPlayedButton();
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

    showScreen('intro');
  } catch(e) {
    console.error('Quiz load error:', e);
    showError('Could not connect to the quiz database. Check your connection and try again.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// APPLY EDITION BRANDING
// Updates page elements that reflect edition-specific info. Called once per
// load, after the edition has been fetched from Firestore. Keeps the Yorker
// identity consistent across editions without any HTML edits per-edition.
// ═══════════════════════════════════════════════════════════════════════════
function applyEditionBranding() {
  if (!currentEdition) return;
  const editionLine = currentEdition.month
    ? `${currentEdition.name} · ${currentEdition.month}`
    : currentEdition.name;

  // Intro kicker (the small red line above "20 questions. {TEST_YEARS} years.")
  const introKicker = document.querySelector('.intro-kicker');
  if (introKicker) introKicker.textContent = `◆ Yorker · ${editionLine}`;

  // Browser tab title + meta tags. These matter for share-card previews —
  // a WhatsApp forward of this page shows the title and description baked in
  // at load time (OG meta tags don't update from JS for social crawlers, but
  // they do reflect correctly when a real human clicks through).
  document.title = `Yorker — ${editionLine} | The Grass Bank`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content',
    `Yorker · ${editionLine}. ${questions.length} questions on ${TEST_YEARS} years of Test cricket.`);

  // [2026-06-04] Edition-driven intro copy. The headline and stats strip are
  // populated from the LOADED edition's validated question count, so monthly
  // rotation can never leave stale numbers on screen (the "20 questions" /
  // "13/20 obsessives" copy was inaugural-specific and survived into June).
  // The static markup is only a pre-JS placeholder.
  const _qn = questions.length;
  const _mins = Math.max(2, Math.round(_qn * 0.35));
  const _headline = document.querySelector('.intro-headline');
  if (_headline) _headline.innerHTML = _qn + ' questions.<br>' + TEST_YEARS + ' years.';
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

// [2026-10-22] A reader who has played this edition sees the Start button
// greyed out (the existing .btn-primary:disabled style) and relabelled, so the
// only way forward is "See your score" in the banner above. Before this the
// button stayed live and quietly opened the old score instead.
function showAlreadyPlayedButton() {
  const btn = document.querySelector('#screen-intro .btn-big');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Already played';
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGN IN TO PLAY  [2026-10-21]
// Swaps the intro's Start button for a link to login.html, which sends the
// reader back here afterwards. returnUrl carries the query string too, so a
// shared link's ?s=1 marker (the share grant) survives the round trip.
// login.html's safeReturnUrl() accepts same-origin paths only.
// Done here rather than in markup so the three edition pages stay untouched.
// ═══════════════════════════════════════════════════════════════════════════
function showSignInToPlay() {
  const btn = document.querySelector('#screen-intro .btn-big');
  if (!btn) return;
  const link = document.createElement('a');
  link.className = btn.className;
  link.href = '/login.html?returnUrl=' + encodeURIComponent(location.pathname + location.search);
  link.innerHTML = 'Sign in to play <span>→</span>';
  btn.replaceWith(link);

  const note = document.createElement('p');
  note.className = 'intro-dek';
  note.style.marginTop = '14px';
  note.textContent = 'Yorker is free. You just need an account.';
  link.after(note);
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC THE LOCK WITH THE ACCOUNT  [2026-10-21]
// See the note in lsKey(). Reads the reader's own score doc (rules allow a
// reader to get only docs whose id starts with their own uid).
//   doc exists  → mirror it into localStorage, so this browser shows the
//                 already-played banner even if they played on another device
//   no doc      → clear any `completed` here: it is from an anonymous play
//                 before login-to-play, or from another account on this browser
//   read failed → leave localStorage alone; the server still refuses a second
//                 score, and completeAndShowScore() handles that refusal
// ═══════════════════════════════════════════════════════════════════════════
async function syncLockWithAccount() {
  try {
    const snap = await getDoc(doc(db, 'oracleScores', scoreDocId()));
    if (snap.exists()) {
      rememberCompleted(snap.data());
    } else if (safeLS(() => localStorage.getItem(lsKey('completed')), null) === 'true') {
      safeLS(() => {
        localStorage.removeItem(lsKey('completed'));
        localStorage.removeItem(lsKey('score'));
        localStorage.removeItem(lsKey('answers'));
      }, null);
    }
  } catch (e) {
    console.warn('Could not check for an existing Yorker score:', e);
  }
}

// Writes a recorded score into the localStorage cache. `score` in localStorage
// is the CORRECT COUNT (what renderScore shows as n/total), not the doc's
// `score` field, which is correctCount × 5 for the leaderboard.
function rememberCompleted(d) {
  safeLS(() => {
    localStorage.setItem(lsKey('completed'), 'true');
    localStorage.setItem(lsKey('score'), String(d.correctCount));
    if (Array.isArray(d.answers)) localStorage.setItem(lsKey('answers'), JSON.stringify(d.answers));
  }, null);
}

// ═══════════════════════════════════════════════════════════════════════════
// START
// Single-attempt enforcement: once a user has completed this edition, there
// is no retake. The welcome-back banner only shows "See your score". If
// something unexpectedly calls restartQuiz() we'd rather no-op than silently
// wipe localStorage.
// ═══════════════════════════════════════════════════════════════════════════
function startQuiz() {
  // Login to play. The signed-out intro has no Start button, so this only
  // fires if something calls startQuiz() directly.
  if (!currentUser) {
    location.href = '/login.html?returnUrl=' + encodeURIComponent(location.pathname + location.search);
    return;
  }
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
// Writes the reader's one doc to oracleScores/{uid}_{editionId}.
//
// History kept short: 2026-08-07 dropped email/pseudonym/isStaff and made the
// uid the only identity (no name is stored — the leaderboard resolves names
// server-side, because users/{uid} is owner-or-admin). 2026-10-21, login to
// play: the doc id is now FIXED per account and edition and written with
// setDoc, not addDoc. firestore.rules allows create and denies update, so a
// second attempt is refused by the server from any device. `anonymous` is
// always false now; the field stays because existing docs carry it and the
// leaderboard filters on it.
//
// `answers` is new: the picked option per question. It lets a second device
// show the full ball-by-ball breakdown, and it is what server-side grading
// (the deferred answer-key precondition in item (6)) would re-check.
//
// The write must be ACKNOWLEDGED before the reader's attempt counts. Offline,
// Firestore queues a write and the promise never settles, so it is raced
// against a timeout; a timed-out write that lands later is picked up on the
// retry (the retry is refused as a duplicate, and the recorded doc is read).
// ═══════════════════════════════════════════════════════════════════════════
const SCORE_WRITE_TIMEOUT_MS = 15000;

async function writeScoreDocument() {
  if (!currentEdition || !currentUser) throw new Error('not-ready');
  if (savedScoreDocId) return;  // already written this session

  const correctCount = computeScore();
  const score = correctCount * 5;  // per v2 §6: 5 points per correct answer

  // Handle for this one submission. Identifies a submission, not a person.
  const sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);

  const scoreDoc = {
    sessionId,
    uid: currentUser.uid,
    editionId: currentEdition.id,
    editionName: currentEdition.name,  // denormalised for leaderboard display without a join
    correctCount,
    score,
    total: questions.length,
    answers: answers.slice(),
    anonymous: false,
    timestamp: new Date().toISOString()
  };

  const id = scoreDocId();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), SCORE_WRITE_TIMEOUT_MS);
  });
  try {
    await Promise.race([setDoc(doc(db, 'oracleScores', id), scoreDoc), timeout]);
    savedScoreDocId = id;
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE AND SHOW SCORE
// The single completion path. Order matters, and is the fix for the bug noted
// in item (6): WRITE FIRST, THEN LOCK. The ct_oracle_* lock and the reveal only
// happen after the score is recorded. Setting the lock first meant a failed
// write spent the reader's one attempt and left no score.
//
// If the write fails, the reader stays on the last question with a message
// and presses Finish again; their answers are kept. Before showing that
// message we check whether a score is already recorded — the write may have
// landed after the timeout, or they finished this edition on another device
// first — and if so, the RECORDED score is shown, since that is the one that
// counts.
// ═══════════════════════════════════════════════════════════════════════════
let completing = false;

async function completeAndShowScore() {
  if (completing) return;
  completing = true;
  const nextBtn = document.getElementById('next-btn');
  nextBtn.disabled = true;
  nextBtn.textContent = 'Saving…';
  setSaveError('');

  try {
    await writeScoreDocument();
    finalizeAndShowScore();
  } catch (e) {
    console.warn('Score write failed:', e);
    let recorded = null;
    try {
      const snap = await getDoc(doc(db, 'oracleScores', scoreDocId()));
      if (snap.exists()) recorded = snap.data();
    } catch (_) { /* fall through to the retry message */ }

    if (recorded) {
      rememberCompleted(recorded);
      showPreviousScore();
    } else {
      renderQuestion();  // restores the Finish button
      setSaveError("Your score hasn't been saved yet. Check your connection and press Finish again.");
    }
  } finally {
    completing = false;
  }
}

function setSaveError(msg) {
  let el = document.getElementById('save-error');
  if (!el) {
    if (!msg) return;
    el = document.createElement('p');
    el.id = 'save-error';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'margin:14px 0 0;color:var(--accent);font-size:0.95rem;';
    const row = document.querySelector('#screen-quiz .nav-row');
    if (row) row.after(el); else return;
  }
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
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
  // block the user from taking Bowlers when it ships. Only ever reached after
  // the score doc is acknowledged (see completeAndShowScore).
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
// SCORE BANDS — the verdict on your innings.
// Mapped to spec bands (0–6, 7–11, 12–15, 16–18, 19–20 out of 20 → percentages).
// Percentage-based so they scale if question count changes in later editions.
//
// REWRITTEN 2026-08-14 with the rename, and not optionally. The old bands were
// an oracle SPEAKING — it bowed, nodded, was impressed, expected more. A yorker
// is a delivery, not a character: it cannot nod. So the verdicts became outcomes
// of a delivery rather than moods of a seer. Keep any future band in that
// register. (Rewritten again 2026-10-30 in IJ's words: from Impregnable
// Defence! down to Clean Bowled!)
// ═══════════════════════════════════════════════════════════════════════════
function getScoreBand(score, total) {
  const pct = (score / total) * 100;
  // Wording IJ's, 2026-10-30.
  if (pct >= 95) return { title: 'Impregnable Defence!', desc: 'Waqar, Lee and Akhtar need to look elsewhere.' };
  if (pct >= 80) return { title: 'Well played!',         desc: 'Not many can hit Yorkers for fours.' };
  if (pct >= 60) return { title: 'Good Defence.',        desc: 'But if Waqar doesn\u2019t get you, Brett Lee definitely will.' };
  if (pct >= 35) return { title: 'Ouch!',                desc: 'Watch those toes, friend.' };
  return              { title: 'Clean Bowled!',          desc: 'Don\u2019t tell anyone.' };
}

function getPercentileText(score, total) {
  // Wording IJ's, 2026-10-30. These describe the score; they are NOT a
  // ranking against other readers (the old "Top 1% of all takers" was not
  // worked out from real results). When real comparisons exist, append them
  // here, e.g. text + ' · better than 72% of readers this edition'.
  const pct = (score / total) * 100;
  if (pct >= 95) return 'Bradmanesque!';
  if (pct >= 80) return 'In great company \u2014 the 3 Ws will smile';
  if (pct >= 65) return 'You can play ODI cricket';
  if (pct >= 50) return 'You can play backyard cricket';
  if (pct >= 30) return 'You can play book cricket';
  return 'Tennis, anybody?';
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

  // Build share links — carry the Yorker brand so every share educates another
  // person about the franchise, AND embed the edition tag so a share forwarded
  // in 2027 still reads unambiguously as "a score on the Inaugural Edition"
  // rather than claiming to be a score on whatever edition is currently live.
  // Edition name is pulled from currentEdition metadata (set by the CMS),
  // which means when Bowlers is current, /yorker.html shares auto-say
  // "Bowlers Edition". Permanent-URL pages like /yorker/inaugural/ keep
  // saying "Inaugural Edition" because they pin to that edition's metadata.
  //
  // The CTA ("Reckon you can do better?") is deliberately band-agnostic: it
  // works whether the user scored 4/20 (mildly self-deprecating) or 20/20 (wry
  // humble-brag), because it is addressed to the RECIPIENT of the share, not to
  // the sharer. That's why there's just one CTA line instead of five
  // score-specific ones. It replaced "The Oracle doubts you can do better." in
  // the 2026-08-14 rename — the old line needed a speaker, and there isn't one
  // any more.
  const editionTag = currentEdition?.name || 'Yorker';
  const launchSuffix = currentEdition?.month ? ` Launching ${currentEdition.month}.` : ' Launching June 2026.';
  const CTA = 'Reckon you can do better?';
  const shareLine = IS_POST_LAUNCH
    ? `I scored ${score}/${total} on Yorker, The Grass Bank's Test quiz — ${editionTag}. "${band.title}". ${CTA}`
    : `I scored ${score}/${total} on Yorker, The Grass Bank's Test quiz — ${editionTag}. "${band.title}". ${CTA}${launchSuffix}`;
  // Share URL depends on the mode: /yorker.html for the current-mode page,
  // /yorker/{id}/ for a pinned-edition page. This keeps shares from a
  // permanent URL pointing at that permanent URL, not the rotating current.
  const editionReq = resolveEditionRequest();
  // [(g) 2026-06-03] Shares ALWAYS point at the edition's permanent URL with
  // the ?s=1 share marker — in BOTH modes. The marker is what the bootstrap's
  // oracleEdition carve-out honours: it grants the recipient durable access to
  // THIS edition (and only this edition) even after it rotates into the paid
  // archive. Pointing current-mode shares at the permalink (instead of
  // /yorker.html) also makes them edition-stable: the link still opens the
  // quiz the sharer actually played, not whatever is current when clicked.
  // PUBLISH-WORKFLOW CONTRACT: the pinned page /yorker/{id}/index.html must be
  // deployed BEFORE config/currentOracle points at the edition, or shares
  // generated in the gap 404. Fallback to /yorker.html only when no edition id
  // is resolvable (should not happen in practice).
  // [rebrand 2026-10-16] Share URLs use location.origin rather than a
  // hardcoded domain, so they follow the site's primary domain
  // (thegrassbank.com) without another edit if the name changes again.
  const _shareEditionId = (currentEdition && currentEdition.id) || editionReq.editionId || null;
  const shareUrl = _shareEditionId
    ? `${location.origin}/yorker/${encodeURIComponent(_shareEditionId)}/?s=1`
    : `${location.origin}/yorker.html`;
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
        <h3>The site opens soon.</h3>
        <p>
          The full archive, the tools and the long-form writing go live then.
          The Dispatch above is how you'll hear about it.
        </p>
        <div class="post-score-cta-row">
          <a href="/comingsoon.html" class="btn btn-primary">
            Back to Home <span>\u2192</span>
          </a>
        </div>
      </div>
    `;
  } else {
    html = `
      <div class="post-score-cta">
        <div class="post-score-cta-kicker">\u25c6 Keep Exploring</div>
        <h3>The archive has ${TEST_YEARS} years of this.</h3>
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
  const textToCopy = window._oracleShareText || `${location.origin}/yorker.html`;
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
