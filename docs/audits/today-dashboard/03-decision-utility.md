# 03. Decision Utility: the Today dashboard (`/`)

Method: every rendered element is asked three questions. Q1: what decision does it change? Q2: what would the user do differently if the number moved? Q3: what is the next click? An element failing all three is CUT. Otherwise: KEEP (earns its place as-is), MERGE (true content, wrong surface or duplicated), PROMOTE (more useful than its current altitude), DEMOTE (true but overweighted). Evidence: live digest (`/tmp/home-digest.json`), live brief stream, `shots/baseline/1440.png`, and file:line cites.

---

## 1. The full element table

### Page header (app/_home/home-header.tsx)

| # | Element | Q1 decision it changes | Q2 if it moved | Q3 next click | Verdict |
|---|---|---|---|---|---|
| 1 | h1 "Today" | none (orientation/landmark) | n/a | none | KEEP (a11y landmark, home-header.tsx:11-14) |
| 2 | Date "Saturday, August 8" | whether to expect live prices | weekday -> expect intraday moves | none | KEEP |
| 3 | "Updated 3:11 AM" | whether to trust/refresh the data | stale stamp -> hit refresh | a refresh control (not here; on 3 cards) | KEEP, but make it the ONLY stamp (02 RD-11) |

### Today's Brief hero (app/_home/modules/todays-brief.tsx)

| # | Element | Q1 | Q2 | Q3 | Verdict |
|---|---|---|---|---|---|
| 4 | "AI EXECUTIVE BRIEF" eyebrow + Sparkles | provenance: is this prose a model output | n/a | none | KEEP (paired with 5) |
| 5 | "Computed" pill when fallback (:226-228) | trust calibration: deterministic vs generated prose | appears -> read prose as engine text | none | KEEP |
| 6 | Regime chip "NEUTRAL" + breathing dot (:220-225) | sizing/aggression of any trade today | flips risk-off -> defer adds, review threats | none (dead chip, no popover, no link) | PROMOTE: attach explain/link; it is the page's context-setter and currently un-clickable |
| 7 | "6 changes, 4 new" chip (:231-255) | whether to read the change band first | worsened>0 turns it red -> read now | scrolls to #whats-changed | MERGE into the change band's own header (duplicate count, 02 RD-07) |
| 8 | "2 min read" (:162-166,256) | none | none | none | CUT (fails all three; reading time of a note you are already looking at) |
| 9 | Brief generated-at "3:10 AM" (:259-266) | whether the prose reflects current facts | old stamp -> refresh brief | none | KEEP (honesty stamp for cached generations) |
| 10 | KPI Portfolio Value $4.07M (:275) | almost none day-to-day (slow state) | large jump -> investigate | none | DEMOTE (context stat, not a headline decision driver; no click target) |
| 11 | KPI Today +1.2% / +$31.68K (:276-283) | whether today needs attention at all | large negative -> open movers/queue | none (no click) | MERGE into book card Day P&L (identical figure 300 px right, book.tsx:234-244) |
| 12 | KPI Grade "C 68" + explain (:284-293) | none directly; health is slow | grade drop -> open decisions | explainHealth popover | MERGE into book ring (same popover twice on one screen) |
| 13 | KPI Actions "1" (:294-299) | whether the CTA is worth clicking | 0 -> skip queue | none on the KPI itself | MERGE with queue's "19 open" into one count (they contradict in spirit; 02 RD-07) |
| 14 | Headline verdict sentence (:325-327) | the one thing to watch today | different watch-item -> different first click | none inline | KEEP (this is the product) |
| 15 | Support paragraph (:328-332) | reinforces 14 | n/a | none | KEEP, cap at facts not shown elsewhere (02 RD-01) |
| 16 | Session note "MARKETS CLOSED - FRI, AUG 7 CLOSE" (:341-345) | whether any number is actionable NOW | markets open -> intraday relevance | none | MERGE to page header (one session note per page) |
| 17 | Top ABNB +17.4% (:346-354) | review winner? (trim/take profit) | bigger move -> research it | SymbolTag hover context -> /research | MERGE into book contributors (same fact, different unit; 02 RD-12) |
| 18 | Weakest AMD -1.2% (:356-364) | review loser? | bigger drop -> research | SymbolTag -> /research | MERGE likewise |
| 19 | CTA "Open Action Center" (:372-378) | primary navigation | n/a | scrolls to #action-center | KEEP (the page's verb) |
| 20 | "Resume: RELIANCE.NS" (:379-388) | continue yesterday's work | different ref -> different resume | /research?symbol=RELIANCE.NS | KEEP (real workflow utility) |
| 21 | "Writing AI brief..." indicator (:389-397) | wait vs read fallback | n/a | acts as refresh | KEEP |
| 22 | Dismiss (hero) (:398-404) | declutter for this session | n/a | collapses hero | CUT or persist: state is `useState` (:139), resets every load, so the affordance lies about its effect |
| 23 | Count-up animation on value/today (use-count-up.ts, :186-187) | none; 760 ms of transient WRONG values (a +1.2% day rolls up from 0.0%) | n/a | none | CUT as default; it is pure decoration and briefly displays false figures; reduced-motion users already get the honest snap (use-count-up.ts:32-36) |

### Portfolio Health book card (app/_home/modules/book.tsx)

| # | Element | Q1 | Q2 | Q3 | Verdict |
|---|---|---|---|---|---|
| 24 | Header + "Updated 3:11 AM" caption (:200-206) | trust | n/a | refresh via shell | MERGE stamp to page header |
| 25 | Health ring C 68/100 + explain (:46-73,220-222) | which weakness to fix (via popover factors) | grade move -> open decisions | explainHealth popover (the real value: Income 5, Inflation 34 are visible there) | KEEP; PROMOTE the popover's weakest-dimension line onto the card face (biggestWeakness ships in pulse but is unrendered) |
| 26 | "health since last visit" delta pill (:224-233) | re-check what moved | appears -> expand whats-changed | title tooltip only | KEEP |
| 27 | Day P&L +1.2% +$31.68K + session date (:234-247) | today's triage | big red -> contributors, queue | none | KEEP (single owner after merging #11) |
| 28 | Return (XIRR) +68.6% + "vs SPY +29.6, excess +39.0" (:262-300) | strategy-level: am I adding value vs indexing | excess goes negative -> rethink active picks | /portfolio?tab=performance | KEEP one of {this, #29}, MERGE the other (02 RD-08) |
| 29 | Cash 33% stat (:279-284) | redeploy decision context | falls to 20% -> trim action disappears | none (no link to the trim action!) | KEEP + PROMOTE: link it to the spotlight action that exists precisely to change this number |
| 30 | 90-day vs SPY sparkline + endpoint labels (:106-176,304-322) | see section 3 | slope flips -> review recent adds | none | KEEP with caveats (section 3) |
| 31 | "prices 100% of book" coverage note (:307-311) | trust in #30 | <95 -> discount the chart | none | KEEP (honesty affordance, hidden when clean) |
| 32 | Contributors ABNB/VOO/GOOGL in bps (:325-345) | which position drove today; trim/add review | order change -> research the mover | SymbolTag-less currently (plain text symbol) | KEEP; add symbol links |
| 33 | Monogram avatars (:78-96) | none | n/a | none | KEEP as decoration (cheap, aids scanning) or CUT; zero decision content |
| 34 | Footer "Open portfolio" / "Attribution" (:348-361) | navigation | n/a | /portfolio | KEEP |

### What Changed band (app/_home/modules/whats-changed.tsx)

| # | Element | Q1 | Q2 | Q3 | Verdict |
|---|---|---|---|---|---|
| 35 | "SINCE LAST VISIT - today 12:53 AM" label (:104-110) | how much catch-up to do | longer gap -> read more carefully | none | KEEP |
| 36 | Change chips x5 (:130-141) | what to re-examine first | worsened chips -> click through | chip href (queue/radar/portfolio) | KEEP the DELTA chips (regime shift, items cleared); MERGE the 4 "X entered queue/radar" chips into one count chip ("2 new ideas"), since the items sit 200 px below with their own New pills (02 RD-06) |
| 37 | "Details (+1)" expander (:142-150) | see overflow + before/after sentences | n/a | expand | KEEP |
| 38 | Detail rows with before -> after text (:71-93) | audit a specific delta | n/a | Open -> per-item href | KEEP |

### Attention queue (app/_home/modules/attention-queue.tsx)

| # | Element | Q1 | Q2 | Q3 | Verdict |
|---|---|---|---|---|---|
| 39 | Header "Attention - 19 open" (:613-618) | is the queue finishable today | grows -> triage | none on count | KEEP count; reconcile with hero "1" (02 RD-07) |
| 40 | Subtitle "One ranked stream. Clear it, and you're done." (:630) | expectation setting | n/a | none | KEEP |
| 41 | Filter toggle + kind chips (:620-628,634-650) | narrow to one kind | n/a | filters list | KEEP (plus `f` key, :595-600) |
| 42 | "PRIORITY" column label + title tooltip (:680-687) | how to read the rail numbers | n/a | none | KEEP while the number exists; falls with DU-01 if bucketed |
| 43 | Spotlight: "NEXT BEST STEP" label + kind pill (:236-239) | what to do first | different item -> different first action | none | KEEP (the promotion IS the decision aid) |
| 44 | Spotlight priority 73 + explain (:241-246) | supposedly, how urgent vs the rest | see section 2: it cannot move except in 5-pt severity cliffs | explainAttentionScore popover | MERGE into buckets (section 2 verdict) |
| 45 | Spotlight headline + rationale (:258-263) | understand the risk | n/a | none | KEEP (but dedupe with the trim ACTION row, 02 RD-01) |
| 46 | "If executed" strip: health 68 -> 71.3 (+3.3), vol +1.0pp, income delta, "alternatives simulated" (:266-293) | THE trade decision: is the improvement worth it | smaller delta -> skip the trade | explainDecision popover | PROMOTE: this is the highest-decision-density element on the page and it renders only when the spotlight happens to be a decision-sourced item; today it renders on the 62-scored action row, NOT the 73-scored spotlight, so the best content sits below the fold of the card |
| 47 | "Why this, why now" memo expander (:296-316) | conviction check before executing | n/a | expand -> 4-part memo | PROMOTE with #46 |
| 48 | Spotlight CTA "Review threat" + mergedHrefs (:319-331) | act | n/a | /portfolio?tab=risk | KEEP |
| 49 | Signal rows x5 "X fits your book" 67/66/66/65/65 (:350-433) | in principle: research a new idea | see section 2: a 66 vs 65 difference is not actionable | Open research | MERGE into Radar (they are the Radar, 02 RD-02); the queue keeps only decision-needing kinds |
| 50 | Signal rationale lines ("Well-rounded fundamentals", "fit 72/100", "10.5% allocation fits...") | differentiate the five ideas | they barely differ; fit-scorer.ts:775-798 appends score strings precisely because the sentences collide | none | MERGE; the uniquifier is a code-smell proof that the rows carry near-zero marginal information |
| 51 | Context chips ("Surfaced", "x% of book", "Researched Nd ago") (:176-197) | join queue item to what I already know/own | held weight appears -> treat as portfolio risk not idea | none | KEEP (the unified-intelligence join is real utility) |
| 52 | Action row "Trim USD Cash from 33% to 20%" 62 (:350-433) | the actual trade | target/sizing move -> re-read memo | "Open decision" -> /portfolio?tab=decisions | PROMOTE to spotlight (see DU-03: it is currently outranked by its own restatement) |
| 53 | Event rows "US Employment Report (Jul)" 55, "MA dividend" 55 | calendar awareness | date nearer -> plan around it | Open calendar | DEMOTE both, and fix: the employment report is dated 2026-08-07, YESTERDAY at render time; seedsFromEvents admits events down to now minus 1 day (attention.ts:290) and computeUrgency maxes urgency for hours <= 0 (attention.ts:147), so a PAST macro print ranks as maximally urgent "upcoming" 55. MA is a dividend on an unheld name (impact = flat 0.3 floor). |
| 54 | Alert rows x3 (CART breakout, TSM 81/100, TSM below targets) 42 (behind fold) | re-check a tripwire I set | severity up -> research | Open watchlist / research | KEEP alerts as a kind; MERGE the two TSM alerts (one thesis, two rows) |
| 55 | Priority scores on every row rail + explain (:404-412) | rank credibility | see section 2 | explainAttentionScore | MERGE into buckets (section 2) |
| 56 | Dismiss X per row + undo toast (:413-420,498-563) | queue hygiene; zero-is-reachable | n/a | dismiss/undo | KEEP (persisted, TTL'd, honest) |
| 57 | "11 more items" expander (:722-737) | how deep is the backlog | n/a | expand | KEEP |
| 58 | Keyboard listbox (arrows/Enter/Delete/f) (:575-603) | power-user throughput | n/a | n/a | KEEP |
| 59 | Degraded-feeders footer (:739-746) | trust: which sources are dead | feeder named -> retry | retry | KEEP |
| 60 | Clear state "Nothing needs your attention." (:768-775) | stop; you are done | n/a | none | KEEP (the reward loop) |

### Radar (app/_home/modules/radar.tsx)

| # | Element | Q1 | Q2 | Q3 | Verdict |
|---|---|---|---|---|---|
| 61 | Header + "The Wire" link (:194-217) | go to the source scanner | n/a | /wire | KEEP |
| 62 | Stale-scan warning (:245-247) | trust the tiles | appears -> re-run scanner | none (no re-run affordance here) | KEEP; add the re-run link it asks the user to perform |
| 63 | Tile symbol + tier pill ("good fit") (:119-124) | which candidate first | tier drop -> deprioritize | SymbolTag -> research | KEEP within the merged single surface |
| 64 | Tile FIT score 80/79/79/75/75 + explain (:125-140) | differentiate candidates | 5-pt spread; see section 2.4: mostly constants + shrinkage | explainOpportunityScore popover | MERGE to tier + rank only (bucket verdict, section 2) |
| 65 | "New" pill (:141-145) | look at these two first | n/a | none | KEEP |
| 66 | Reason line (fitDetail / quality-appended fitSummary) (:57-61,147-149) | why this fits | n/a | none | KEEP one reason per candidate on the single surface |
| 67 | Add-to-watchlist + button with optimistic exit (:76-165) | pipeline intake: promote idea to tracked | n/a | POST /api/watchlist | PROMOTE: this is the Radar's one true verb and the main reason the tiles should be the surviving surface of the queue/radar merge |
| 68 | Footer "Watchlist: 1 buy, 1 near-buy" + Open (:257-269) | is my existing pipeline already ripe | buys > 0 -> open watchlist first | /watchlist | KEEP (real funnel state; the only genuinely new fact on the card, 02 section 3) |

### Market Overview (app/_home/modules/market-intelligence.tsx)

| # | Element | Q1 | Q2 | Q3 | Verdict |
|---|---|---|---|---|---|
| 69 | Header + stamp + refresh + "See all" (:372-399) | freshness; go to The Wire | n/a | /wire | KEEP; stamp merges per 02 RD-11 |
| 70 | Index strip S&P/NASDAQ/DOW (:91-129) | market context for any trade today | large gap move -> caution on adds | none | KEEP S&P + NASDAQ; MERGE DOW (adds nothing S&P does not for this book) |
| 71 | FTSE 100 / NIKKEI 225 (:95-96) | non-US exposure context | n/a | none | CUT for this portfolio (no rendered non-US equity sleeve; the one researched non-US name RELIANCE.NS is not indexed by either) or make the strip watchlist/holdings-aware |
| 72 | Sentiment tile "EXTREME GREED" + gradient thumb (:299-330) | contrarian caution on new buys? unclear: no threshold or guidance is offered | 81 -> 60: caption softens, nothing else changes | InfoTip only; explainSentiment exists (explain.ts:181-201) but is not wired to this tile | MERGE into VIX tile (02 RD-10); if kept, wire the explain popover and state what a user should DO at extremes |
| 73 | VIX tile 14.90 -1.65% + caption bands (:145-161) | risk-regime input: cheap hedges, sizing | crosses 20/30 -> tighten sizing | none | KEEP (one of the few tape tiles with a stated interpretation) |
| 74 | 10Y yield 4.66% (:162-169) | cash-redeploy timing: the page's top action is about 33% idle cash; the risk-free yield is exactly its opportunity-cost number | yield falls -> holding cash costs more relative | none | PROMOTE: link/co-render with the trim-cash action context |
| 75 | Oil (WTI) tile (:171-177) | inflation/energy exposure context (book has an inflation threat, digest threats[0]) | sustained rise -> revisit inflation threat | none | KEEP (weak but connectable); connect it to threat-inflation |
| 76 | Gold tile (:178-184) | inflation hedge context | n/a | none | DEMOTE (not held; relevant only via the inflation threat) |
| 77 | USD Index tile (:185-191) | FX exposure decision | n/a | none | DEMOTE or CUT: the currency threat did not fire for this book (digest threats list has no threat-currency; foreignCurrencyPct below the 15% gate, threats.ts:92) |
| 78 | BTC/USD tile (:192-198) | none for this book (no crypto held or watched in buckets) | n/a | none | CUT for this portfolio; tape should be exposure-aware |
| 79 | Brent tile (:199-205) | duplicate of #75 | n/a | none | CUT (02 RD-09) |
| 80 | 30-day sparklines on 7 tiles (:260-267; \_viz/sparkline.tsx) | see section 3 | n/a | none | DEMOTE: no on-screen window label, no scale; direction-only decoration |
| 81 | InfoTip tooltips per tile (:209-230) | learn what the instrument is | n/a | hover/focus | KEEP (good, honest definitions) |
| 82 | Caption lines ("Yields lower on the day." etc.) (:169-205) | restate the delta already shown above them | n/a | none | CUT the directional captions (they verbalize the +/- sign one line above); keep the banded VIX caption |

### AI Investment Brief, the long read (app/_home/modules/ai-investment-brief.tsx)

| # | Element | Q1 | Q2 | Q3 | Verdict |
|---|---|---|---|---|---|
| 83 | Collapse chevron + persisted state (:286-290,460-474) | manage page length | n/a | expand | KEEP |
| 84 | "AI generated" badge (:480-482) | provenance | n/a | none | KEEP |
| 85 | Regime hero band (word + prose + participation pill) (:361-403) | restates hero chip + breadth | n/a | none | MERGE into one regime owner (02 map F5/F6) |
| 86 | Opportunities band (:383-399) | restates the trim/redeploy action | n/a | none | MERGE (prompt-scope fix, 02 RD-03) |
| 87 | Risks tile (:163,408-422) | restates F1 | n/a | none | MERGE |
| 88 | Portfolio observations tile (:164) | restates F3/F4/F1 | n/a | none | MERGE |
| 89 | Sectors tile (:165) | the ONE novel claim (Technology leader today vs multi-week laggard) | divergence resolves -> revisit sector tilts | none | KEEP; this is what the whole long read should look like |
| 90 | Macro tile (:166) + isEmptySection filter (:109-114) | none: live text says no macro was provided | n/a | none | KEEP the filter, CUT the padding sentence via prompt (feed it the calendar it already has: the digest holds CPI 2026-08-13, unshown to the model) |
| 91 | Recommendations list x5 (:425-444) | action checklist | items change -> act | none (no links on recommendations) | MERGE 4 of 5 into existing surfaces (02); link the survivors to their queue rows |
| 92 | Disclaimer footer (:506-512) | compliance/trust | n/a | none | KEEP |
| 93 | Refresh + sr-only live region (:487-495,314-321) | regenerate | n/a | refresh | KEEP |

93 elements assessed; 6 CUT, 20 MERGE, 8 PROMOTE, 7 DEMOTE, rest KEEP.

---

## 2. The signal stream and the priority number

### 2.1 What the priority scale actually is

`score = 100 x impact^0.5 x urgency^0.3 x confidence^0.2` (attention.ts:46, 120-130). The scale has no external referent: it is not a probability, not dollars at risk, not a percentile. Its meaning is entirely relative, and relative meaning requires that the three inputs be measured on comparable scales across kinds. They are not:

| Kind | impact input | urgency input | confidence input | source |
|---|---|---|---|---|
| threat | measured `abs(impactPct)/25` when present, else severity floor {high 0.8, med 0.5, low 0.3} | 0.6 constant (undated) | 0.8 constant | attention.ts:228-251, 102-106, 69-75, 87 |
| action | decisionScore/100 (a scale where 50 = "doing nothing", explain.ts:255) | 0.6 constant | engine confidence (real, 0.78 here) x observation decay | attention.ts:201-225 |
| signal | combinedScore/100 (idea quality, where 75-85 is a normal good idea) | 0.6 constant | 0.5 constant | attention.ts:314-329 |
| event | held book weight, else 0.3 flat floor | real time ramp (the only measured urgency on the page) | 1.0 constant | attention.ts:280-311, 137-153 |
| alert | held book weight, else 0.3 flat floor | 0.6 constant | 0.6 constant | attention.ts:255-277 |

### 2.2 The live queue, decomposed into information vs constants

Reproduced from the digest (all arithmetic verified):

| Item | score | impact | urgency | confidence | measured inputs | constant inputs |
|---|---|---|---|---|---|---|
| USD Cash concentration (threat) | 73.4 | 0.8 severity floor | 0.6 | 0.8 | none (impactPct is null for concentration threats, threats.ts:163) | ALL THREE |
| SYF signal | 66.8 | 0.80 | 0.6 | 0.5 | combinedScore only | 2 of 3 |
| ALL / TSM signals | 66.4 | 0.79 | 0.6 | 0.5 | combinedScore only | 2 of 3 |
| BAC / SCHW signals | 64.7 | 0.75 | 0.6 | 0.5 | combinedScore only | 2 of 3 |
| Trim USD Cash (action) | 62.2 | 0.58 | 0.6 | 0.78 | decisionScore + engine confidence | 1 of 3 |
| US Employment Report (event) | 54.8 | 0.30 floor | 1.0 | 1.0 | urgency only (and it is wrong: the event is past, see #53) | 2 of 3 |
| MA dividend (event) | 54.8 | 0.30 floor | 1.0 | 1.0 | urgency only | 2 of 3 |
| CART / TSM alerts x3 | 42.4 | 0.30 floor | 0.6 | 0.6 | none | ALL THREE |
| LLY ex-div (event, HELD ~3.3%) | 10.3 | 0.033 held weight | 0.15 | 1.0 | both | conf |

The top-ranked item (73) is built from three constants. Three alert rows are built from three constants and are therefore forever 42.4 for any unheld symbol regardless of what the alert says. A macro event and an unheld dividend tie at exactly 54.8 because they share the same floor constants.

### 2.3 The 65-67 signal spread: how much is real?

For every signal, urgency and confidence are fixed, so `score = 74.7 x sqrt(combinedScore/100)` (100 x 0.6^0.3 x 0.5^0.2 = 74.69). The entire visible spread 64.7 to 66.8 (rendered 65/65/66/66/67) is a square-root compression of combinedScore 75 to 80. Sensitivity: ~0.42 priority points per combinedScore point at this level. Even the theoretical extremes are narrow: combined 70 -> 62.5, combined 85 -> 68.9, combined 100 -> 74.7. The geometric mean with these exponents maps the practical scanner range (70-85) into a 6.4-point priority band, and rounding then collapses adjacent candidates into ties (ALL and TSM both render 66; BAC and SCHW both 65).

And combinedScore itself is compressed upstream. `combined = 0.6 x absoluteScore + 0.4 x fitScore` (rankByFit, fit-scorer.ts:752-765, DEFAULT_FIT_WEIGHT 0.4). The fit component cannot spread out for scanner candidates because `buildOpportunitySnapshot` constructs them with `sector: null` and no geography (mission-control.ts:298-305). Consequences inside computePortfolioFit:

- scoreSector: sector unknown -> confidence 0 (fit-scorer.ts:196-199)
- scoreCorrelation: unheld + sector unknown -> confidence 0 (:239-243)
- scoreGeographic: geography absent -> confidence 0 (:396-399)
- Only objective (0.24), style (0.10), sizing (0.18) carry evidence: evidenceFrac ~= 0.52 of nominal weight, so the portfolio-effects composite is shrunk halfway to the neutral prior 50 (:591-610)
- fit = 0.45 x research + 0.55 x shrunk, clamped to research +15 / -35 (:96-100, 615-619)

Result in the live data: fitScore 70-77, absoluteScore 77-83, combined 75-80. Three of the six fit dimensions are structurally silent for every radar candidate, so the "fit to your book" number is roughly half research score, a quarter neutral prior, and a quarter sizing/objective boilerplate; that is why five different companies produce the same "Well-rounded fundamentals" sentence and the uniquifier at fit-scorer.ts:775-798 has to append "fit 72/100" strings to keep the rows textually distinct.

### 2.4 Can a user act on 66 vs 65?

No. One rendered point of priority corresponds to ~2.4 points of combinedScore, which is inside the noise of the scanner composite itself; two of the five pairs are rendered ties; and the explain popover for every signal shows identical urgency and confidence rows ("60% -> x0.86", "50% -> x0.87"), so even the transparency layer tells the user the differences are not differences. Nothing in the UI binds any threshold to behavior (nothing happens at 70 that does not happen at 60).

### 2.5 Cross-kind comparability: threat 73 vs signal 67 vs action 62 vs event 55

The ordering between kinds is determined by which constants each kind was assigned, not by any commensurable measurement:

- The threat at 73 beats the action at 62, yet they are THE SAME STORY (both restate the 32.9% cash position), and the action is strictly more informative (it carries the simulated +3.3 health, sizing, and memo). The threat wins only because a "high" severity floor (0.8) beats decisionScore 58/100 in the impact slot; a decision scale where 50 means "do nothing" is being compared against a severity scale where 0.8 means "high". |
- All five passive scanner ideas (65-67) outrank the engine's #1 simulated decision (62). An idea-quality number (0.75-0.80) and a decision-score number (0.58) occupy the same impact slot with different semantics.
- Events invert held/unheld priority: the flat UNHELD floor (0.3, attention.ts:111) exceeds any realistic single-position book weight, so a dividend on unheld MA scores 54.8 while the ex-div on HELD LLY (~3.3% of a $4.07M book, a ~$135K position) scores 10.3. Owning the stock makes its event rank 5x LOWER. Same for ABBV (9.4).
- Alerts are constant 42.4 for unheld names regardless of content: "TSM scoring 81/100 STRONG_BUY" and "CART +11.4% breakout" are indistinguishable to the ranker.

### 2.6 Verdict on the number

Replace the rendered 0-100 priority with buckets. The engine can keep the geometric score internally for ordering, but the rail should render a 3-band label (for example Act / Review / FYI) derived from kind-aware thresholds, plus rank order. Justification: (a) within-kind, the number is a monotone transform of one input, so rank preserves all its information; (b) cross-kind, the number is dominated by per-kind constants, so its apparent precision (73 vs 67 vs 62) is fabricated comparability; (c) the two-significant-digit rendering promises a resolution (1 point) that is ~2.4x finer than the noise floor of its only live input. The explain popover survives intact as the bucket's disclosure. Prerequisites for ever bringing a number back: measured impact for threats (impactPct for concentration findings), real per-symbol book weights for events/alerts with a floor BELOW typical held weights, and a mapping of decisionScore onto the same impact scale as everything else.

---

## 3. Specific instruments

**Equity sparkline (book.tsx:106-176).** Supports exactly one decision: "over the last 90 days, am I tracking or beating SPY?" It has the minimum context to do so: the window is named in the band label ("90-day vs SPY", :305-306), both endpoints are labeled (+9.7% / +4.9%), coverage is disclosed when dirty (:307-311), and the two lines share one normalized scale (:113-117). What it cannot support: any magnitude judgment in between (no axis, no gridline, no min/max), and any volatility judgment (normalization hides scale). Verdict: KEEP as a direction-and-gap glyph; it is honest about being one. The real redundancy problem is that it coexists with the XIRR comparison (element #28, 02 RD-08), not the chart itself.

**Market tile sparklines (\_viz/sparkline.tsx; market-intelligence.tsx:260-267).** No window label on screen (the 30-day fact lives only in a code comment, market-intelligence.tsx:12), no endpoints, no scale, min-max normalized per tile so a 0.5% wiggle and a 15% swing render identically. They answer "was the recent path up or down", which the delta beside them already states numerically. Fails Q1 and Q2 independently of the delta; Q3 is nothing. Verdict: DEMOTE to decoration knowingly, or add "30d" and an endpoint value; the missing-history skeleton shimmer (:262-266) should also become a static dash, since a permanent shimmer reads as perpetually loading.

**Health radar.** Finding of fact: it is not rendered anywhere. `buildHealthRadar` computes six axes into `portfolioPulse.radar` on every digest (pulse.ts:125-159, :285) and the SVG component exists (app/\_home/\_viz/radar.tsx), but no file imports it (grep for `_viz/radar` imports: zero) and the explain popover renders factor BARS (explain-popover.tsx:33-48), not the radar. So the question "does the radar in the explain popover support a decision" resolves to: the popover's bar list is the better instrument anyway (labeled values, weights, abstentions, coverage caveats, explain.ts:133-178), and the radar is dead code plus dead payload. Verdict: CUT `pulse.radar` from the digest and delete or consciously shelve the component; if a shape-glance is wanted later, the popover is where it belongs.

**Market tape relevance (which of the 8 tiles change a decision for THIS portfolio).** Decision-relevant: VIX (#73, sizing/hedging regime, has stated bands), 10Y (#74, direct opportunity cost of the 33% cash position the page is begging the user to redeploy), arguably WTI (#75, connects to the live inflation threat). Not decision-relevant for this book as rendered: sentiment (#72, composite of two visible neighbors, no action threshold), gold (#76), DXY (#77, currency threat did not fire), BTC (#78, no crypto exposure anywhere in the digest), Brent (#79, duplicate). Score: 2-3 of 8. The tape is portfolio-blind by construction; making the tile set exposure-aware (or demoting the card below the long read) would roughly double its utility per pixel.

**Timeline / intelligence feeds.** Not rendered. Both slices ship in the digest (`timeline`, `intelligence`) with fully-formed items, and no module selects them (grep `useHomeSlice("timeline"|"intelligence")`: zero matches). Their content already reaches the queue via the events/alerts feeders. Verdict: CUT from the wire (they are payload, not UI); this is the same class as `threats`, `upcomingEvents`, `attribution`, `calibration`, `portfolioSummary` (02 RD-13).

**Count-up animations (use-count-up.ts; todays-brief.tsx:186-187).** Pure decoration by the code's own description ("the hero's signature moment"). Costs: 760 ms during which the two most important numbers on the page display values that are false (a +1.2% day reads 0.0%, then +0.4%...), an rAF loop per number, and a hydration-forced initial 0. Benefits: none that pass Q1-Q3. It does honor reduced-motion (:32-36) and lands byte-identical (:8-10). Verdict: CUT or make it opt-in; a dashboard that elsewhere refuses to fabricate data (skeletons instead of fake lines, :262-266 market-intelligence) fabricates two numbers on every load for effect.

---

## 4. Findings

**DU-01 (high) - The rendered priority number is pseudo-precision.** Two of three scoring inputs are per-kind constants for every undated item; the live top item (73.4) is built from three constants; rendered signal differences of 1 point encode ~2.4 combinedScore points, below input noise; two of five signal pairs render as ties anyway. Replace with buckets + rank (section 2.6). Evidence: attention.ts:46, 69-75, 87, 102-106, 111; digest attention items; arithmetic in section 2.2-2.4.

**DU-02 (high) - The queue's cross-kind ordering is an artifact of incommensurable impact scales.** Idea quality (signals), decision score with a 50 no-op baseline (actions), severity floors (threats), and book weight vs a 0.3 unheld floor (events/alerts) all occupy the same impact slot. Concrete inversions on the live page: the informationless threat restatement (73) outranks the fully-simulated trim decision (62) for the same story; five passive scanner ideas outrank the engine's #1 decision; and every alert is a constant 42.4. Evidence: section 2.5; attention.ts:203, 232, 261, 295, 322.

**DU-03 (high) - The page's best decision content is ranked below its own restatement.** The trim-cash ACTION row carries the simulated before/after (68 -> 71.3), sizing ($526,942), risk delta, and the four-part why memo (actions.ts:53-88; attention-queue.tsx:266-316), but the spotlight slot, the one place that renders that content large, is occupied by the constant-scored THREAT version of the same fact, which has no memo and no simulation (decisionById join misses: the spotlight's item.id is `threat:threat-conc-holding-0`, not `action:...`, attention-queue.tsx:478-484,695). Fix: dedupe threat/action siblings onto one story key, keep the action's payload.

**DU-04 (high) - "Fit to your book" is half research score, structurally.** Scanner candidates enter fit scoring with `sector: null` and no geography (mission-control.ts:298-305), silencing 3 of 6 fit dimensions (confidence 0: fit-scorer.ts:196-199, 239-243, 396-399); shrinkage then pulls the effects composite halfway to 50 (:607-610). The rendered "GOOD FIT 79" is therefore ~45% research composite, ~27% neutral prior, ~28% sizing/objective, and the five rationale strings collide so hard the code appends score literals to tell them apart (:775-798). Either pipe the scanner's sector data through (it exists upstream in the snapshot), or stop labeling the number "fit". |

**DU-05 (high) - Held events rank below unheld events.** UNHELD_IMPACT = 0.3 exceeds real position weights (LLY 3.3% -> impact 0.033), so an unheld dividend (MA, 54.8) outranks a held ex-div (LLY, 10.3) by 5x. The floor for tracked-but-unheld must sit BELOW typical held weights, or held impact needs a different scale than raw weight. Evidence: attention.ts:111, 293-303; digest events. |

**DU-06 (medium) - A past macro event is the queue's top "upcoming" event.** US Employment Report dated 2026-08-07 renders at maximum urgency on 2026-08-08 because seedsFromEvents accepts events to now minus 1 day (attention.ts:290) and computeUrgency returns 1 for hours <= 0 (:147). Past events should either drop or render as "released, review the print", which is a different decision. |

**DU-07 (medium) - Five queue rows and five radar tiles ask the user the same question twice with two numbers.** Full duplication proof in 02 section 2. Decision consequence: the "one ranked stream, clear it and you're done" contract (attention-queue.tsx:630) is broken by rows that cannot be finished, only dismissed or re-encountered as tiles. MERGE signals into the Radar; the queue keeps kinds that need decisions. |

**DU-08 (medium) - The sentiment tile offers a mood, not a decision.** No threshold is bound to any action, its two largest components are visible beside it, its explain projection exists but is not wired (explain.ts:181-201 has no caller in market-intelligence.tsx), and "EXTREME GREED" beside "Normal volatility" narrates one input in two tones. Evidence: 02 RD-10; element #72. |

**DU-09 (medium) - Dead payload and dead components.** `timeline`, `intelligence`, `threats`, `upcomingEvents`, `attribution`, `calibration`, `portfolioPulse.radar`, `portfolioSummary` ship every load and render nowhere; `HealthRadar` (app/\_home/\_viz/radar.tsx) has zero importers. Bytes and build time with no decision output. Evidence: grep results cited in section 3; 02 RD-13. |

**DU-10 (medium) - The tape is portfolio-blind.** 2-3 of 8 tiles connect to any decision this book faces; BTC and Brent connect to none; the two tiles that DO connect (10Y vs the 33% cash, WTI vs the inflation threat) do not mention the connection. Element rows #69-82. |

**DU-11 (low) - Count-up animation displays false values for 760 ms per load** on the two most-read numbers. use-count-up.ts:24-63; todays-brief.tsx:186-187. |

**DU-12 (low) - Hero Dismiss is session-only** (`useState`, todays-brief.tsx:139), so the affordance does not do what it says across visits. Persist it (usePersistedState exists and is used by the long read, ai-investment-brief.tsx:286-290) or remove it. |

**DU-13 (low) - "2 min read" fails all three questions** (todays-brief.tsx:42-46). |

**DU-14 (low) - Directional tile captions verbalize the sign shown one line above** ("Yields lower on the day." under "-0.21"). market-intelligence.tsx:161-205. The VIX caption is the exception worth keeping (it adds banded interpretation). |

**DU-15 (low) - Recommendations in the long read have no click targets** (ai-investment-brief.tsx:425-444): the only checklist on the page cannot be acted on where it is read. |

**DU-16 (info) - The explain system is the page's best decision infrastructure** and is underexploited: explainHealth exposes the actual weakest dimensions (Income 5/100, Inflation 34/100) that never surface on any card face; explainDecision carries the full simulated case; explainSentiment is built but unwired. PROMOTE the pattern, not just the popover. explain.ts:133-269. |

---

## 5. Final ranked list

**PROMOTE**
1. The "If executed" simulation strip + why memo to the spotlight, always, when a decision-sourced item exists (DU-03).
2. The trim-cash ACTION row to spotlight via story-level dedupe with its threat sibling (DU-03).
3. Weakest health dimensions (Income 5, Inflation 34) from the explain popover onto the book card face (DU-16).
4. Cash 33% stat -> link it to the trim action (element #29).
5. 10Y yield tile -> bind to the cash-redeploy decision context (element #74).
6. Radar add-to-watchlist as the surviving intake verb after the queue/radar merge (element #67).
7. Regime chip: make it explainable/clickable (element #6).

**KEEP** (headliners)
Headline verdict + support prose (#14-15); Open Action Center CTA (#19); Resume chip (#20); queue mechanics: dismiss/undo, filters, keyboard, clear state, degraded footer (#41, #56-60); book Day P&L, health ring + popover, contributors, footer links (#25-27, #32, #34); change band delta chips + details (#35-38); VIX tile with bands (#73); coverage note (#31); AI provenance badges + disclaimer (#5, #84, #92); 90-day sparkline as a labeled direction-and-gap glyph (#30).

**MERGE**
1. Signal rows into the Radar; queue keeps threats/actions/alerts/events (DU-07).
2. Priority numbers into 3 buckets + rank; keep explain popovers as disclosure (DU-01/02).
3. Fit score into tier + rank until sector data flows (DU-04).
4. Hero KPIs Today and Grade into the book card; Actions count into the queue count (#11-13).
5. Threat + action rows for one story into one row (DU-03).
6. Two TSM alerts into one thesis row (#54).
7. Sentiment tile into the VIX tile (DU-08).
8. XIRR line and 90-day chart into one vs-SPY answer (#28-30).
9. Session note and updated-at stamps into the page header (#3, #16, #24).
10. "X entered queue/radar" change chips into one "N new ideas" chip (#36).
11. Long read sections that restate on-screen facts: cut from prompt scope; keep sectors-style novel claims (#85-91).
12. Top/Weakest hero movers into book contributors (#17-18).
13. DOW into the S&P/NASDAQ strip (#70).

**CUT**
1. Dead digest payload + unrendered HealthRadar component and `pulse.radar` (DU-09).
2. Brent tile (#79), BTC tile for this book (#78), FTSE/NIKKEI for this book (#71), or make the tape exposure-aware.
3. Count-up animation as default (DU-11).
4. "2 min read" (DU-13).
5. Directional tile captions except VIX (DU-14).
6. Session-only hero Dismiss (or persist it) (DU-12).
7. Past-dated events from the queue (fix, then the rows re-earn KEEP as genuinely upcoming items) (DU-06).
8. Monogram avatars if any density budget is needed; last on the list (#33).
