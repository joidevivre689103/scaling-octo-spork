/* ═══════════════════════════════════════════════════════════════════════════
   ct-newsletter.js — The Cricket Times Dispatch signup, canonical component
   ───────────────────────────────────────────────────────────────────────────
   ONE implementation, ONE injection point, used on every surface that asks
   for an email address. Drop a placeholder anywhere:

       <div class="ct-newsletter" data-ct-source="article"></div>
       <script src="/ct-newsletter.js" defer></script>

   Optional attributes:
       data-ct-source   REQUIRED. Which surface this instance sits on.
                        Sent to MailerLite as fields[signup_source] so you can
                        see which surface actually converts. Values in use:
                        article · subscribe-page · oracle · oracle-june ·
                        oracle-inaugural · comingsoon · quiz-score
       data-ct-variant  "full" (default) or "compact". Compact drops the
                        kicker and the dek — for inline placement mid-page.
       data-ct-note     Optional extra sentence appended to the dek. Used on
                        the quiz score screen to mention the next edition.
       data-ct-name     Optional prefill for the name field. Pass the signed-in
                        reader's account display name here so they aren't asked
                        twice. Falls back to whatever they last typed on this
                        device.

   ───────────────────────────────────────────────────────────────────────────
   THE NAME FIELD IS NOT THE ACCOUNT DISPLAY NAME

   This field is optional, private, and unvalidated. It exists to greet the
   reader in the confirmation email and in the newsletter itself — nobody else
   ever sees it. A reader may put a nickname here and that is fine.

   The account display name — the one that appears on article comments, and
   later on the leaderboard — is a DIFFERENT thing: public, unique, and stored
   on users/{uid}. Do not enforce uniqueness on this field or wire it to
   usedPseudonyms; that would put a name-collision check in front of a
   newsletter signup, which is the exact friction the quiz screen is losing.

   The two are bridged by prefill, not by sync: pass the account name in via
   data-ct-name when the reader is signed in, and the name typed here is kept
   in localStorage so a later signup can offer it back.

   ───────────────────────────────────────────────────────────────────────────
   WHY THERE IS NO CONSENT CHECKBOX (decided 2026-08-04)

   Consent rests on double opt-in, not on a ticked box. The reader types an
   address into a form that does one thing, then clicks a link in a
   confirmation email; MailerLite records that confirmation with a timestamp,
   which is a demonstrable record. The old checkbox on subscribe.html was
   validated and then discarded — it never reached MailerLite or Firestore, so
   it recorded nothing at all.

   ⚠ DOUBLE OPT-IN IS LOAD-BEARING. It is what makes the no-checkbox design
   defensible. If anyone ever switches it off in MailerLite (Account →
   Subscribe settings, and per-form), the consent record disappears and this
   component must go back to an explicit, RECORDED checkbox. Do not flip that
   toggle for conversion reasons without revisiting this.

   Three things must also stay true:
     · the form does one thing — never bundle signup with anything else
     · the fineprint names MailerLite and links the privacy policy
     · nothing is pre-selected

   ───────────────────────────────────────────────────────────────────────────
   PREREQUISITE: create a custom field named exactly `signup_source` in
   MailerLite (Subscribers → Fields) before deploying, or that value is
   silently dropped.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var FORM_ACTION =
    'https://assets.mailerlite.com/jsonp/2259944/forms/184395234410497566/subscribe';

  var COPY = {
    kicker:  'The Cricket Times Dispatch',
    heading: 'Get new analysis in your inbox',
    dek:     'Summaries of our latest stories and statistical deep dives, ' +
             'sent when new pieces are published.',
    nameLabel:    'First name or nickname',
    nameOptional: 'optional',
    namePlaceholder: 'e.g. Jay, or Cover Drive',
    emailLabel:   'Email address',
    button:  'Subscribe',
    // The confirm sentence is doing real work twice: it is the informed-consent
    // statement, and it tells readers to expect the email — which is the
    // cheapest available fix for unconfirmed signups.
    fine:    'We\u2019ll email you a link to confirm. Unsubscribe anytime.',
    fineProcessor: 'Your email is handled by MailerLite \u2014 see our ',
    privacyHref:   '/privacy.html',
    privacyText:   'privacy policy',
    working: 'Subscribing\u2026',
    success: 'Check your inbox \u2014 we\u2019ve sent a link to confirm. ' +
             'You\u2019ll join the list once you click it.',
    errBadEmail: 'That doesn\u2019t look like a valid email address.',
    errFailed:   'That didn\u2019t go through. Try again, or write to ' +
                 'ivan@cricketimes.com.'
  };

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* ── Styles, injected once ───────────────────────────────────────────────
     Uses the site's custom properties with hard fallbacks, so the component
     is correct on pages that don't define the full palette. */
  function injectStyles() {
    if (document.getElementById('ct-nl-styles')) return;
    var css = [
      '.ct-nl{background:var(--paper,#faf5e9);border:1px solid var(--rule,#c9bda5);',
      'padding:32px 28px 26px;margin:56px 0;position:relative;',
      'font-family:"Source Serif 4",Georgia,serif;color:var(--ink,#1a1612)}',
      '.ct-nl--compact{padding:24px 24px 20px;margin:40px 0}',
      '.ct-nl__kicker{font-family:"Special Elite",monospace;font-size:11px;',
      'letter-spacing:.28em;text-transform:uppercase;color:var(--ink-mute,#6b6157);',
      'text-align:center;margin:0 0 8px}',
      '.ct-nl__heading{font-family:"Playfair Display",serif;font-weight:700;',
      'font-size:28px;line-height:1.15;letter-spacing:-.01em;text-align:center;margin:0 0 8px}',
      '.ct-nl--compact .ct-nl__heading{font-size:23px}',
      '.ct-nl__dek{text-align:center;font-style:italic;font-size:16px;',
      'color:var(--ink-soft,#3a322a);max-width:460px;margin:0 auto 20px;line-height:1.55}',
      '.ct-nl__form{max-width:460px;margin:0 auto}',
      '.ct-nl__row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}',
      '.ct-nl__label{display:block;font-family:"Special Elite",monospace;font-size:10px;',
      'letter-spacing:.18em;text-transform:uppercase;color:var(--ink-mute,#6b6157);margin-bottom:4px}',
      '.ct-nl__opt{font-family:"Source Serif 4",Georgia,serif;font-style:italic;font-size:11px;',
      'letter-spacing:0;text-transform:none;margin-left:4px}',
      '.ct-nl__input{width:100%;padding:11px 13px;font-family:inherit;font-size:16px;',
      'border:1px solid var(--rule,#c9bda5);background:#fff;border-radius:2px;color:inherit}',
      '.ct-nl__input:focus{outline:2px solid var(--crimson,#8b1a1a);outline-offset:1px;',
      'border-color:var(--crimson,#8b1a1a)}',
      '.ct-nl__btn{display:block;width:100%;padding:12px 24px;font-family:"Special Elite",monospace;',
      'font-size:12px;letter-spacing:.18em;text-transform:uppercase;',
      'background:var(--crimson,#8b1a1a);color:var(--paper,#faf5e9);',
      'border:1px solid var(--crimson,#8b1a1a);border-radius:2px;cursor:pointer;',
      'transition:background .15s}',
      '.ct-nl__btn:hover{background:var(--crimson-deep,#6b1010);border-color:var(--crimson-deep,#6b1010)}',
      '.ct-nl__btn:focus-visible{outline:2px solid var(--ink,#1a1612);outline-offset:2px}',
      '.ct-nl__btn[disabled]{opacity:.6;cursor:not-allowed}',
      '.ct-nl__msg{max-width:460px;margin:12px auto 0;font-size:14px;font-style:italic;',
      'text-align:center;line-height:1.5;min-height:20px}',
      '.ct-nl__msg--err{color:var(--crimson,#8b1a1a)}',
      '.ct-nl__msg--ok{color:var(--ink-soft,#3a322a);font-size:15px}',
      '.ct-nl__fine{max-width:460px;margin:12px auto 0;font-size:12px;line-height:1.55;',
      'color:var(--ink-mute,#6b6157);text-align:center}',
      '.ct-nl__fine a{color:var(--crimson,#8b1a1a)}',
      '.ct-nl__hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
      '.ct-nl__spin{display:inline-block;width:11px;height:11px;margin-right:7px;',
      'border:2px solid rgba(250,245,233,.4);border-top-color:var(--paper,#faf5e9);',
      'border-radius:50%;animation:ct-nl-spin .7s linear infinite;vertical-align:middle}',
      '@keyframes ct-nl-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.ct-nl__spin{animation:none;opacity:.6}}',
      '@media (max-width:480px){.ct-nl__row{grid-template-columns:1fr}',
      '.ct-nl{padding:24px 20px 20px}}'
    ].join('');
    var el = document.createElement('style');
    el.id = 'ct-nl-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ── Markup ──────────────────────────────────────────────────────────────
     The form carries a real action/method, so if this script fails to load
     entirely the submit still reaches MailerLite rather than navigating to
     the current page and silently discarding the address. Hidden inputs are
     in the markup for the same reason; `ajax` is added by JS only, so the
     no-JS path gets MailerLite's normal HTML response instead of raw JSON. */
  var seq = 0;

  var NAME_KEY = 'ct_display_name';

  function safeLS(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* Prefill order: an explicit data-ct-name set by the page (use this to pass
     the signed-in reader's account display name) → the name they last chose on
     this device → empty. Never invents a name from the email address. */
  function prefillName(host) {
    return host.getAttribute('data-ct-name') ||
           safeLS(function () { return localStorage.getItem(NAME_KEY); }, '') || '';
  }

  function build(host) {
    var source  = host.getAttribute('data-ct-source') || 'unknown';
    var compact = host.getAttribute('data-ct-variant') === 'compact';
    var note    = host.getAttribute('data-ct-note') || '';
    var id      = 'ct-nl-' + (++seq);

    host.className = 'ct-nl' + (compact ? ' ct-nl--compact' : '');
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Subscribe to The Cricket Times Dispatch');

    var head = '';
    if (!compact) head += '<p class="ct-nl__kicker">' + COPY.kicker + '</p>';
    head += '<h2 class="ct-nl__heading">' + COPY.heading + '</h2>';
    if (!compact || note) {
      head += '<p class="ct-nl__dek">' + COPY.dek + (note ? ' ' + note : '') + '</p>';
    }

    host.innerHTML =
      head +
      '<form class="ct-nl__form" action="' + FORM_ACTION + '" method="post" novalidate>' +
        '<label class="ct-nl__hp" aria-hidden="true">Leave this blank' +
          '<input type="text" name="ct_hp" tabindex="-1" autocomplete="off"></label>' +
        '<div class="ct-nl__row">' +
          '<div class="ct-nl__field">' +
            '<label class="ct-nl__label" for="' + id + '">' + COPY.emailLabel + '</label>' +
            '<input class="ct-nl__input" id="' + id + '" type="email" name="fields[email]" ' +
              'placeholder="your@email.com" autocomplete="email" required>' +
          '</div>' +
          '<div class="ct-nl__field">' +
            '<label class="ct-nl__label" for="' + id + '-name">' + COPY.nameLabel +
              '<span class="ct-nl__opt">' + COPY.nameOptional + '</span></label>' +
            '<input class="ct-nl__input" id="' + id + '-name" type="text" name="fields[name]" ' +
              'value="' + esc(prefillName(host)) + '" ' +
              'placeholder="' + COPY.namePlaceholder + '" autocomplete="given-name">' +
          '</div>' +
        '</div>' +
        '<input type="hidden" name="fields[signup_source]" value="' + source + '">' +
        '<input type="hidden" name="ml-submit" value="1">' +
        '<input type="hidden" name="anticsrf" value="true">' +
        '<button class="ct-nl__btn" type="submit">' + COPY.button + '</button>' +
      '</form>' +
      '<p class="ct-nl__msg" role="status" aria-live="polite"></p>' +
      '<p class="ct-nl__fine">' + COPY.fine + ' ' + COPY.fineProcessor +
        '<a href="' + COPY.privacyHref + '">' + COPY.privacyText + '</a>.</p>';
  }

  function mountAll() {
    injectStyles();
    var hosts = document.querySelectorAll('.ct-newsletter:not([data-ct-mounted])');
    for (var i = 0; i < hosts.length; i++) {
      hosts[i].setAttribute('data-ct-mounted', '1');
      build(hosts[i]);
    }
  }

  /* ── Submission ──────────────────────────────────────────────────────────
     Delegated on document, so it works on pages whose body is rendered from
     Firestore after load. This replaces article.html's old 300ms × 20 poll,
     which had a six-second ceiling and failed silently past it. */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.classList || !form.classList.contains('ct-nl__form')) return;
    e.preventDefault();

    var host  = form.closest('.ct-nl');
    // Select by name, NOT by class: there are two .ct-nl__input elements in
    // the row and querySelector returns the first, which is the name field.
    var input = form.querySelector('input[name="fields[email]"]');
    var btn   = form.querySelector('.ct-nl__btn');
    var msg   = host.querySelector('.ct-nl__msg');
    var hp    = form.querySelector('input[name="ct_hp"]');

    function say(kind, text) {
      msg.className = 'ct-nl__msg' + (kind ? ' ct-nl__msg--' + kind : '');
      msg.textContent = text;
    }

    // Honeypot: a bot filled a field no human can see. Show success, send
    // nothing — telling scrapers they were caught only helps them.
    if (hp && hp.value) { form.style.display = 'none'; say('ok', COPY.success); return; }

    var email = (input.value || '').trim();
    if (!EMAIL_RE.test(email)) { say('err', COPY.errBadEmail); input.focus(); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="ct-nl__spin"></span>' + COPY.working;
    say('', '');

    var payload = new FormData(form);
    payload.delete('ct_hp');
    payload.set('fields[email]', email);

    // Send the name only when there is one. An absent field and an empty
    // string are not the same thing to MailerLite's greeting variable, and the
    // confirmation email can't be edited on the free plan — so give the
    // template the best chance of degrading gracefully.
    var nameInput = form.querySelector('input[name="fields[name]"]');
    var name = nameInput ? (nameInput.value || '').trim() : '';
    if (name) payload.set('fields[name]', name);
    else payload.delete('fields[name]');

    // Remember it so the next block on this device is prefilled, and so an
    // anonymous subscriber who later creates an account can be offered the
    // same name rather than starting again. Local only — nothing is synced.
    if (name) safeLS(function () { localStorage.setItem(NAME_KEY, name); });

    payload.append('ajax', '1');

    fetch(FORM_ACTION, { method: 'POST', body: payload })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        form.style.display = 'none';
        say('ok', COPY.success);
      })
      .catch(function (err) {
        console.error('[ct-newsletter]', err);
        btn.disabled = false;
        btn.textContent = COPY.button;
        say('err', COPY.errFailed);
      });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }

  // Late-rendered pages (article.html renders from Firestore) may insert the
  // placeholder after DOMContentLoaded. No ceiling, unlike the old poll.
  if (window.MutationObserver) {
    new MutationObserver(function () { mountAll(); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }

  window.ctNewsletterMount = mountAll;   // manual hook if a page needs it
}());
