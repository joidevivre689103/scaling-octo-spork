/* ═══════════════════════════════════════════════════════════════════
   The Grass Bank — what each page holds (2026-11-07, IJ)

   ONE place for the description of each reader page. It is shown twice:
     · as that page's card on the guide, pages.html  (<div data-ct-pages-index>)
     · as the intro at the top of the page itself    (<div data-ct-intro="key">)
   on Countries, Batting, Bowling, Keeping, Captaincy, Compare, Simulations
   and Behind the Scenes. Edit a card here and both change together; there is
   nothing to copy across.

   Each card:
     key        id used by data-ct-intro and the guide's #anchor
     title      the card's heading
     href       where the card goes
     gate       the page's CT_PAGE_ID in settings/featureGates (for the
                reader's access label on the guide); null = no live check
     tier       label shown until (or unless) the live check runs:
                'free' | 'account' (free account) | 'paid' (subscribers)
     fixed      keep this label whatever featureGates says (Yorker: the page
                opens for everyone, playing needs an account)
     wide       full width on the guide
     blurb      one line on what the page is for
     questions  questions it answers
     inside     [label, text] rows: what is on the page
     note       small print under the rows (optional)
     cta        the guide's button text
   A new page: add a card here; if it should show the intro, put
   <div data-ct-intro="its key"></div> under its title and load this file.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SECTIONS = [
    {
      "id": "read",
      "title": "Read and listen",
      "dek": "The writing, the archive, and the conversation around it.",
      "cards": [
        {
          "key": "front",
          "title": "Front page",
          "href": "/",
          "gate": null,
          "tier": "free",
          "blurb": "The latest writing on Test cricket, read in full, with the day’s cricket around it.",
          "questions": [
            "What is happening in Test cricket right now?",
            "What happened on this day in years gone by?"
          ],
          "inside": [
            [
              "Articles",
              "every current essay and dispatch in full, most with a narrated version"
            ],
            [
              "State of play",
              "live scores and results from Tests in progress"
            ],
            [
              "On this day",
              "Tests played on today’s date, with links to their scorecards"
            ],
            [
              "Also",
              "At a Glance, Deep Analysis, Milestones, Up next, the WTC strip and the newsletter sign-up"
            ],
            [
              "Comments",
              "on every article, with a free account"
            ]
          ],
          "cta": "Go to the front page"
        },
        {
          "key": "archive",
          "title": "Article archive",
          "href": "/archive.html",
          "gate": "archive",
          "tier": "paid",
          "blurb": "Every essay and dispatch The Grass Bank has published, once it has left the front page.",
          "questions": [
            "What did we write about that series last year?",
            "Which piece was it that you meant to go back to?"
          ],
          "inside": [
            [
              "Search",
              "by headline or subject"
            ],
            [
              "Browse",
              "A to Z"
            ]
          ],
          "cta": "Open the archive"
        },
        {
          "key": "audio",
          "title": "Audio",
          "href": "/audio.html",
          "gate": "audio",
          "tier": "paid",
          "blurb": "Every narrated essay and broadcast in one place, for the commute or the long rain delay.",
          "questions": [
            "Rather listen than read?"
          ],
          "inside": [
            [
              "Library",
              "every narration, searchable, with a player that keeps going as you browse"
            ]
          ],
          "cta": "Open Audio"
        },
        {
          "key": "bts",
          "title": "Behind the Scenes",
          "href": "/bts.html",
          "gate": "bts",
          "tier": "paid",
          "blurb": "The editor’s notebook: how the site is made, what is coming next, and the thinking behind the numbers.",
          "questions": [
            "How is a page like this built, and why?",
            "Want to ask the editor something directly?"
          ],
          "inside": [
            [
              "Notebook",
              "notes and drafts from the workshop, with likes and replies"
            ],
            [
              "Conversations",
              "a private one-to-one with the moderator, and group conversations you are invited to"
            ]
          ],
          "cta": "Go behind the scenes"
        }
      ]
    },
    {
      "id": "records",
      "title": "The records",
      "dek": "Every Test since 1877, every player, filtered the way you want.",
      "cards": [
        {
          "key": "countries",
          "title": "Countries",
          "href": "/countries.html",
          "gate": "countries",
          "tier": "paid",
          "blurb": "Head-to-head records between any two nations, or groups of nations, with every result behind them.",
          "questions": [
            "England or Australia: who leads the oldest rivalry in Test cricket?",
            "When a side’s batters make two hundreds in a Test, how often does it win? And with three?",
            "Has India’s home record changed between the 1990s and the 2010s?"
          ],
          "inside": [
            [
              "Head-to-head",
              "one or more countries against one or more others, or all against all"
            ],
            [
              "Filters",
              "venue (home, away, neutral), result, era (Pre-1950, the 1950s through the 2020s, and the Bazball years (England, their opponents, or every Test in the window)), city, ground, and two date ranges side by side"
            ],
            [
              "Results",
              "the scoreboard, the record by venue with win %, records by era, and the match history with dates, margins and full scorecards"
            ],
            [
              "Impact Analysis",
              "how a side fares when its players reach a milestone: one to five hundreds, double and triple hundreds, four- and five-wicket hauls, ten in the match, in an innings or in the match, “at least” or “exactly”; compare two milestones"
            ],
            [
              "On this day",
              "the full scorecards of the Tests played on today’s date"
            ],
            [
              "Export",
              "results to Excel"
            ]
          ],
          "cta": "Open Countries"
        },
        {
          "key": "batting",
          "title": "Batting",
          "href": "/batting.html",
          "gate": "batting",
          "tier": "paid",
          "blurb": "Every Test batter’s record, sliced by where, when, against whom and in what position.",
          "questions": [
            "Who has the highest Test average after Bradman?",
            "Who scored the most runs in the Bazball years?",
            "Who has made the most runs batting at No. 6, away from home?"
          ],
          "inside": [
            [
              "Views",
              "individual players, all players added together, or every century grouped by size"
            ],
            [
              "Filters",
              "country, home / away / neutral, city, ground, era (Pre-1950, the 1950s through the 2020s, and the Bazball years (England, their opponents, or every Test in the window)), batting position, opponents, minimum Tests, innings, runs, average and strike rate, milestones (100s to 400s)"
            ],
            [
              "Leaderboards",
              "runs, average, strike rate, milestones, Man of the Match"
            ],
            [
              "Also",
              "one row per player per era when you pick several eras; show the top 10, 25, 50 or 100; search by name; export to Excel"
            ]
          ],
          "cta": "Open Batting"
        },
        {
          "key": "bowling",
          "title": "Bowling",
          "href": "/bowling.html",
          "gate": "bowling",
          "tier": "paid",
          "blurb": "Every Test bowler’s record, from tearaways to tweakers, filtered the same way as batting.",
          "questions": [
            "Anderson or Warne: who took more Test wickets?",
            "Which spinner has the best strike rate since 2000?",
            "Who has taken the most wickets at Lord’s?"
          ],
          "inside": [
            [
              "Views",
              "individual bowlers, or all bowlers added together"
            ],
            [
              "Filters",
              "country, home / away / neutral, city, ground, era (Pre-1950, the 1950s through the 2020s, and the Bazball years (England, their opponents, or every Test in the window)), pace or spin, opponents, minimum Tests, innings and wickets, maximum average, strike rate and economy, milestones (four and five in an innings, ten in an innings, eight and ten in a match)"
            ],
            [
              "Leaderboards",
              "wickets, average, economy, strike rate, milestones, Man of the Match"
            ],
            [
              "Also",
              "top 10 to 100, search by name, export to Excel"
            ]
          ],
          "cta": "Open Bowling"
        },
        {
          "key": "keeping",
          "title": "Keeping",
          "href": "/keeping.html",
          "gate": "keeping",
          "tier": "paid",
          "blurb": "Wicketkeepers’ records: catches, stumpings, and what they did with the bat.",
          "questions": [
            "Dhoni or Gilchrist: who made more stumpings?",
            "Which full-time keeper has the most dismissals per Test?"
          ],
          "inside": [
            [
              "Filters",
              "country, era, full-time or part-time keepers, minimum Tests as keeper, dismissals and stumpings"
            ],
            [
              "Sort by",
              "Tests, Tests as keeper, dismissals, stumpings, catches as keeper and as a fielder, dismissals per Test, batting, Man of the Match"
            ],
            [
              "Also",
              "search by name, export to Excel"
            ]
          ],
          "cta": "Open Keeping"
        },
        {
          "key": "captaincy",
          "title": "Captaincy",
          "href": "/captaincy.html",
          "gate": "captaincy",
          "tier": "paid",
          "blurb": "Every Test captain’s record: wins, losses, draws, and how they batted with the job.",
          "questions": [
            "Which captain won the biggest share of his Tests?",
            "Did the captaincy weigh on a batter’s average?"
          ],
          "inside": [
            [
              "Filters",
              "country, era, minimum Tests as captain, minimum win %"
            ],
            [
              "Sort by",
              "Tests, wins, win %, batting as captain, Man of the Match"
            ],
            [
              "Also",
              "search by name, export to Excel"
            ]
          ],
          "cta": "Open Captaincy"
        },
        {
          "key": "players",
          "title": "Players",
          "href": "/players.html",
          "gate": "players",
          "tier": "free",
          "blurb": "Every Test cricketer since 1877, each with a page of his own: his career in figures and, for many, a short profile of who he was and how good.",
          "questions": [
            "Who was he, and how good was he?"
          ],
          "inside": [
            [
              "Browse",
              "every Test player, A to Z, by country or by the decade he started"
            ],
            [
              "Search",
              "by name"
            ],
            [
              "Each page",
              "Tests, runs, average, highest score, hundreds, wickets, best bowling, and more"
            ]
          ],
          "cta": "Browse the players"
        }
      ]
    },
    {
      "id": "analyse",
      "title": "Compare and play it out",
      "dek": "Put players side by side, or put sides on the field and see what happens.",
      "cards": [
        {
          "key": "compare",
          "title": "Compare",
          "href": "/compare.html",
          "gate": "compare",
          "tier": "paid",
          "wide": true,
          "blurb": "Any players side by side, or whole groups of them, under the same filters.",
          "questions": [
            "Tendulkar or Lara: whose numbers hold up better side by side?",
            "How many times did Anderson get Smith out, and how many runs did Smith take off him?",
            "Was Kohli a better batter in his first five years or his next five?",
            "Which great opening pair scored more together?"
          ],
          "inside": [
            [
              "Players",
              "any number of players, free choice"
            ],
            [
              "Groups",
              "two against two, three against three, four, five, or a whole XI against another XI"
            ],
            [
              "Partnerships",
              "pairs of batters, compared on what they made together"
            ],
            [
              "1 against X",
              "one batter against up to ten bowlers he faced, or one bowler against up to ten batters, with ball-by-ball runs off each bowler where the data exists (from about 2001)"
            ],
            [
              "Career phases",
              "one player against himself across phases, or several players across theirs: peak, best phase, or your own date ranges (up to three)"
            ],
            [
              "Filters",
              "batting, bowling or both; opponent, home / away, city, ground, match innings, result, toss, team captain, opposing captain, only the matches they played together"
            ],
            [
              "Charts",
              "career trend of the cumulative average by year or by innings, bars by year, and each player’s slope"
            ],
            [
              "Also",
              "export to Excel, share a comparison by link"
            ]
          ],
          "cta": "Open Compare"
        },
        {
          "key": "simulations",
          "title": "Simulations",
          "href": "/simulations.html",
          "gate": "simulations",
          "tier": "paid",
          "wide": true,
          "blurb": "Settle the arguments cricket can’t. Pick two sides from any era and let them play it out thousands of times.",
          "questions": [
            "Would Bradman’s 1948 Invincibles beat the West Indies of the 1980s?",
            "Pick an XI from anyone in history: who could beat it?",
            "Would India have done better in the 2023 WTC final with Ashwin playing?"
          ],
          "inside": [
            [
              "Team vs Team",
              "two countries’ elevens from any era, picked player by player"
            ],
            [
              "Cross-Era XI",
              "build two sides from anyone who has played Test cricket, Bradman and Bumrah in the same team if you like"
            ],
            [
              "What-If Replay",
              "find a real Test by teams and year, change the elevens, and see how the result might have changed"
            ],
            [
              "Settings",
              "home, away or neutral; who bats first; a single Test or a series of up to five; 5,000 to 50,000 simulated matches"
            ],
            [
              "Results",
              "the chance of each result, the series outcome, and each side’s batting and bowling strength"
            ],
            [
              "Fair across eras",
              "players are rated against their own era, so a decade’s conditions don’t decide it"
            ]
          ],
          "note": "We don’t forecast real upcoming Tests: when both sides are today’s players you see their strength, not their chances. Up to 20 simulations an hour and 60 a day.",
          "cta": "Pick your XIs"
        },
        {
          "key": "wtc",
          "title": "WTC Race",
          "href": "/wtc.html",
          "gate": "wtc",
          "tier": "free",
          "blurb": "The World Test Championship table and the race to the final at Lord’s, worked out from the results alone.",
          "questions": [
            "Can your team still reach the final?",
            "Which results elsewhere would help your side?"
          ],
          "inside": [
            [
              "Free",
              "the table, each team’s best possible finish, who is through or out, whether it is in their own hands, and the Tests still to play"
            ],
            [
              "For subscribers",
              "what each team needs from its remaining series, the results that matter, and a what-if where you set the results yourself"
            ]
          ],
          "note": "Arithmetic, not prediction: nothing here is a forecast.",
          "cta": "See the race"
        }
      ]
    },
    {
      "id": "play",
      "title": "Test yourself",
      "dek": "A monthly quiz for people who think they know their Test cricket.",
      "cards": [
        {
          "key": "yorker",
          "title": "Yorker",
          "href": "/yorker.html",
          "gate": "yorker",
          "tier": "account",
          "fixed": true,
          "blurb": "Fifteen questions from 149 years of Test cricket, aimed at the base of the stumps. One attempt, no second innings.",
          "questions": [
            "How well do you really know Test cricket?"
          ],
          "inside": [
            [
              "Each edition",
              "fifteen questions, about five minutes, one attempt"
            ],
            [
              "After",
              "your score, every answer explained, and a link to share"
            ]
          ],
          "cta": "Play this month’s Yorker"
        },
        {
          "key": "yorker-archives",
          "title": "Yorker Archives",
          "href": "/yorker-archives.html",
          "gate": "yorker-archives",
          "tier": "paid",
          "blurb": "Every past edition of the Yorker, kept for the faithful.",
          "questions": [
            "Missed an edition?"
          ],
          "inside": [
            [
              "Every edition",
              "play any past Yorker from the start"
            ]
          ],
          "cta": "Open the archives"
        }
      ]
    }
  ];

  // The small print at the foot of the guide: [href, title, description].
  var SITE = [["/about.html", "About", "who writes The Grass Bank, and why"], ["/subscribe.html", "Subscribe", "what’s free, what subscribing gets you, and the newsletter"], ["/servicearea.html", "Service area", "where paid subscriptions are available"], ["/terms.html", "Terms of Service", ""], ["/privacy.html", "Privacy Policy", ""]];

  // ════════════════════════════════════════════════════════════════════
  // Rendering. Nothing below needs touching to change what a card says.
  // ════════════════════════════════════════════════════════════════════
  var LABEL = { free: 'Free', account: 'Free account', paid: 'Subscribers' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function find(key) {
    for (var i = 0; i < SECTIONS.length; i++)
      for (var j = 0; j < SECTIONS[i].cards.length; j++)
        if (SECTIONS[i].cards[j].key === key) return SECTIONS[i].cards[j];
    return null;
  }
  function qs(c) { return c.questions && c.questions.length ? '<ul class="ctp-qs">' + c.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>' : ''; }
  function inside(c) {
    return '<dl class="ctp-inside">' + c.inside.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>';
  }

  // Shared CSS, injected once. Each page keeps its own fonts; colours fall
  // back through the variable names the site's pages use.
  var CSS = [
    '.ctp-intro{margin:6px 0 18px;max-width:760px}',
    '.ctp-blurb{font-size:16px;line-height:1.55;color:var(--text2,var(--ink-soft,#4a4a46));margin:0 0 12px}',
    '.ctp-qs{list-style:none;margin:0 0 12px;padding:8px 0 8px 14px;border-left:3px solid var(--accent,var(--crimson,#a03020))}',
    '.ctp-qs li{font-family:"DM Serif Display",Georgia,serif;font-style:italic;font-size:17px;line-height:1.35;color:var(--text,var(--ink,#1a1a18))}',
    '.ctp-qs li+li{margin-top:5px}',
    '.ctp-inside{font-size:14px;line-height:1.45;color:var(--text2,var(--ink-soft,#4a4a46));margin:0}',
    '.ctp-inside>div{break-inside:avoid;padding:6px 0;border-top:1px solid var(--surface3,rgba(0,0,0,0.08))}',
    '.ctp-inside dt{display:inline;font-family:"Inter",system-ui,sans-serif;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--text,var(--ink,#1a1a18))}',
    '.ctp-inside dt::after{content:" \\2014\\00a0";font-weight:400;color:var(--text3,#7a7a74)}',
    '.ctp-inside dd{display:inline;margin:0}',
    '.ctp-note{font-size:13.5px;line-height:1.45;color:var(--text3,#7a7a74);font-style:italic;margin:10px 0 0}',
    '.ctp-more{margin:0}',
    '.ctp-more summary{cursor:pointer;font-family:"Inter",system-ui,sans-serif;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--accent,var(--crimson,#a03020));padding:4px 0;list-style:none;display:inline-block}',
    '.ctp-more summary::-webkit-details-marker{display:none}',
    '.ctp-more summary::before{content:"+ ";}',
    '.ctp-more[open] summary::before{content:"\\2212 ";}',
    '.ctp-more[open] .ctp-inside{margin-top:6px}',
    '.ctp-more .ctp-all{font-family:"Inter",system-ui,sans-serif;font-size:12px;margin:10px 0 0;color:var(--text3,#7a7a74)}',
    '.ctp-more .ctp-all a{color:var(--accent,var(--crimson,#a03020))}',
    '@media(max-width:600px){.ctp-blurb{font-size:15px}.ctp-qs li{font-size:16px}}'
  ].join('\n');
  function addCss(extra) {
    if (document.getElementById('ctp-css')) return;
    var s = document.createElement('style');
    s.id = 'ctp-css';
    s.textContent = CSS + (extra || '');
    document.head.appendChild(s);
  }

  // ── The intro at the top of a page: <div data-ct-intro="batting"></div> ──
  function renderIntro(el) {
    var c = find(el.getAttribute('data-ct-intro'));
    if (!c) return;
    el.classList.add('ctp-intro');
    el.innerHTML = '<p class="ctp-blurb">' + esc(c.blurb) + '</p>' + qs(c) +
      '<details class="ctp-more"><summary>What’s on this page</summary>' + inside(c) +
      (c.note ? '<p class="ctp-note">' + esc(c.note) + '</p>' : '') +
      '<p class="ctp-all">Everything on the site: <a href="/pages.html#' + esc(c.key) + '">Pages</a></p></details>';
  }

  // ── The whole guide (pages.html): <div data-ct-pages-index></div> ──
  function card(c) {
    var attrs = ' data-gate="' + esc(c.gate || '') + '" data-tier="' + c.tier + '" data-href="' + esc(c.href) + '"' + (c.fixed ? ' data-fixed="1"' : '');
    return '<article class="pg-card' + (c.wide ? ' wide' : '') + '" id="' + esc(c.key) + '"' + attrs + '>' +
      '<div class="pg-top"><h3 class="pg-title"><a href="' + esc(c.href) + '">' + esc(c.title) + '</a></h3>' +
      '<span class="pg-tier tier-' + c.tier + '">' + LABEL[c.tier] + '</span></div>' +
      '<p class="ctp-blurb">' + esc(c.blurb) + '</p>' + qs(c) + inside(c) +
      (c.note ? '<p class="ctp-note">' + esc(c.note) + '</p>' : '') +
      '<div class="pg-foot"><a class="pg-cta" href="' + esc(c.href) + '">' + esc(c.cta) + ' <span aria-hidden="true">&rarr;</span></a><span class="pg-alt"></span></div>' +
      '</article>';
  }
  function renderIndex(el) {
    var chips = SECTIONS.map(function (s) { return '<a href="#' + s.id + '">' + esc(s.title) + '</a>'; }).join('') + '<a href="#site">The site</a>';
    var html = '<nav class="chips" aria-label="Sections">' + chips + '</nav>';
    SECTIONS.forEach(function (s) {
      html += '<section class="pg-section" id="' + s.id + '"><h2 class="sec-title">' + esc(s.title) + '</h2><p class="sec-desc">' + esc(s.dek) + '</p>' +
        '<div class="pg-grid">' + s.cards.map(card).join('') + '</div></section>';
    });
    html += '<section class="pg-section" id="site"><h2 class="sec-title">The site</h2><ul class="pg-site">' +
      SITE.map(function (l) { return '<li><a href="' + esc(l[0]) + '">' + esc(l[1]) + '</a>' + (l[2] ? ' <span>&mdash; ' + esc(l[2]) + '</span>' : '') + '</li>'; }).join('') +
      '</ul></section>';
    el.innerHTML = html;
    if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
    accessLabels();
  }

  // ── Access labels and links for the reader in front of the guide ──
  // Tier from the live settings/featureGates doc (card.gate = the page's
  // CT_PAGE_ID), falling back to card.tier; whether this reader can open it,
  // by the same rule as requireAccess() in feature-flags.js. Fails quietly:
  // the cards then keep their written labels and link straight to the pages,
  // whose own gates decide. A link is only a link either way.
  var FB_AUTH = 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';       // same pin as feature-flags.js
  var FB_FS   = 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
  function whenFlags(cb) {
    var t = 0;
    (function poll() {
      if (window.__ctFlagsLoaded && window.CTFeatureFlags) return cb(window.CTFeatureFlags);
      if ((t += 100) > 6000) return;
      setTimeout(poll, 100);
    })();
  }
  function reader(F) {
    var app;
    return F.firebaseReady.then(function (a) { app = a; return import(FB_AUTH); })
      .then(function (m) {
        var auth = m.getAuth(app);
        return new Promise(function (res) { var u = m.onAuthStateChanged(auth, function (x) { if (typeof u === 'function') u(); res(x); }); });
      })
      .then(function (user) {
        return import(FB_FS).then(function (fs) {
          var db = fs.getFirestore(app), email = user && user.email;
          return Promise.all([
            F.getFeatureGates(db),
            email ? F.getUserRole(db, email, user) : 'none',
            email ? F.getUserHasPaidAccess(db, email, user) : false
          ]).then(function (r) { return { user: user, gates: r[0], role: r[1], paid: r[2] === true }; });
        });
      });
  }
  function inGate(g, k, id) { return !!(g && g[k] && g[k].pages && g[k].pages.indexOf(id) !== -1); }
  function tierOf(g, id) {
    if (inGate(g, 'free', id)) return 'free';
    if (inGate(g, 'loggedIn', id)) return 'account';
    if (inGate(g, 'paid', id) || inGate(g, 'beta', id)) return 'paid';
    return null;
  }
  function canOpen(s, id) {                       // mirrors requireAccess()
    var g = s.gates;
    if (inGate(g, 'free', id)) return true;
    if (!s.user) return false;
    if (s.role === 'admin' || s.role === 'superadmin') return true;
    if (inGate(g, 'loggedIn', id)) return true;
    if (s.paid && inGate(g, 'paid', id)) return true;
    return s.role === 'beta' && inGate(g, 'beta', id);
  }
  function apply(s) {
    var login = function (href) { return '/login.html?returnUrl=' + encodeURIComponent(href); };
    document.querySelectorAll('.pg-card[data-gate]').forEach(function (el) {
      var id = el.getAttribute('data-gate');
      if (!id) return;
      var href = el.getAttribute('data-href'), cta = el.querySelector('.pg-cta'), alt = el.querySelector('.pg-alt'), pill = el.querySelector('.pg-tier');
      var tier = el.hasAttribute('data-fixed') ? el.getAttribute('data-tier') : (tierOf(s.gates, id) || el.getAttribute('data-tier'));
      pill.className = 'pg-tier tier-' + tier;
      pill.textContent = LABEL[tier];
      var mine = function () { if (tier !== 'free') pill.insertAdjacentHTML('beforeend', ' <span class="yours">· yours</span>'); };
      if (tier === 'account') {                   // open to any account
        if (s.user) return mine();
        el.setAttribute('data-locked', '');
        cta.setAttribute('href', login(href));
        cta.innerHTML = 'Sign in or create a free account <span aria-hidden="true">&rarr;</span>';
        return;
      }
      if (!tierOf(s.gates, id)) return;           // not in the gates: leave as written
      if (canOpen(s, id)) return mine();
      el.setAttribute('data-locked', '');
      cta.setAttribute('href', '/subscribe.html');
      cta.innerHTML = 'Subscribe to open <span aria-hidden="true">&rarr;</span>';
      if (!s.user) alt.innerHTML = 'Already subscribed? <a href="' + login(href) + '">Sign in</a>';
    });
  }
  function accessLabels() {
    whenFlags(function (F) {
      if (!F.firebaseReady || typeof F.getFeatureGates !== 'function') return;
      var late = false;
      setTimeout(function () { late = true; }, 9000);
      reader(F).then(function (s) { if (!late) apply(s); })
        .catch(function (e) { console.warn('[ct-pages] access labels left as written:', e && e.message); });
    });
  }

  function init() {
    var intros = document.querySelectorAll('[data-ct-intro]');
    var index = document.querySelector('[data-ct-pages-index]');
    if (!intros.length && !index) return;
    addCss();
    intros.forEach(renderIntro);
    if (index) renderIndex(index);
  }
  window.CTPages = { sections: SECTIONS, find: find };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
