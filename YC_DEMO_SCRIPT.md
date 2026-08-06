# UAA — YC Product Demo (3:00)

**Not the founder video. This is the product demo.**
Written after a full pass over the codebase: 206k lines, 20 pages, 130 API routes, 41 lib domains, a Python quant stack, and the live contents of `data/app.db`.

---

## 1. Overall demo strategy

### The one idea the partner should leave with

> **Every investing product will confidently tell you anything. This one can only tell you things it can show its work for — and where it can't measure something, it says so instead of guessing.**

That is not a tagline. It is a structural property of the code, enforced in a dozen independent places, and it is the single hardest thing here to copy:

- `lib/portfolio/engines/health.ts` — dimensions **abstain** and redistribute weight rather than score a fabricated 50.
- `lib/portfolio/engines/risk.ts` — illiquid assets get **declared** proxy volatility, because their *observed* volatility is near zero and that is the most dangerous number in the report.
- `lib/portfolio/engines/recommend.ts` — a recommendation that doesn't survive simulation is **discarded**; the engine is allowed to conclude you're fine.
- `lib/valuation/case.ts` — a locked assumption can be **critiqued by AI but never overwritten**, enforced in the data layer, not the prompt.
- `lib/ic/valuation-engine.ts` — the LLM proposes *inputs only*; all arithmetic is TypeScript, unit-tested.
- `lib/ai/grounding.ts` — every figure an agent emits is traced back to the evidence it was handed; untraceable figures are confidence-downgraded.
- `lib/assets/types.ts` — a metric with no data provider **cannot become a filter**, because a screen returning zero rows is a data gap wearing the costume of a result.
- `engine/models/live_oos.py` — the quant engine logs its own signals and fires degradation alerts when its own edge decays.

A wrapper cannot abstain. That is the moat, and it is demonstrable in ninety seconds.

### Why this workflow

The demo follows one continuous decision — *should I keep owning Micron?* — from portfolio to research to valuation to execution. Nothing is toured. Every page is entered because the previous page produced a reason to enter it.

This matters for a specific reason: UAA's competitors are not other apps, they are **five browser tabs**. The demo has to make the seams that don't exist visible. So the camera never returns to a nav menu; each page hands off to the next.

### Why this order

| Beat | Page | Why here |
|---|---|---|
| 1 | Portfolio → Health | Establishes the honesty thesis in the first 30 seconds, on a number the viewer already understands |
| 2 | Risk Lab | Proves the thesis is *engineering*, not copy — the 2008 scenario is factor-modelled, so gold rises by construction |
| 3 | Decisions | The "so what": every impact is simulated, not asserted. Produces the name we research |
| 4 | Research Hub | Compression — 14 signals down to the 3 that change the decision |
| 5 | **Valuation** | The intellectual peak. The single most memorable number in the demo |
| 6 | IC Report | Depth ceiling — shows how far the product goes when you want it to |
| 7 | Montage | Breadth without slowing down: Screener, Wire, Quant Engine |
| 8 | Close | Loop closes on the original decision, then the vision |

### Why these pages get unequal time

**Valuation gets the most time (28s)** because it holds the strongest idea in the product: valuation as a *persisted, versioned, ownable object* rather than a calculator you re-run and throw away. "The number is worthless in twelve months; the reasoning is the entire asset" (`lib/valuation/case.ts`). Nothing else on the market does this.

**Compare gets no standalone beat — deliberately.** Its most striking output (two funds you own are 60% the same holdings, `lib/compare/holdings-overlap.ts`) is *more* powerful arriving unbidden inside a portfolio recommendation than as "here's our compare page." A tour of Compare would cost 20 seconds and land softer. It is demonstrated, just not announced.

**Screener and Wire get one sentence each** — they're excellent, but they are the two features a viewer can most easily imagine, so they cost the most seconds per unit of surprise.

**Quant Engine gets one sentence with a specific hook** — "it tells me when it stops working." That is the part nobody expects.

---

## 2. Timeline

> Pace target: ~145 wpm. Total narration ≈ 430 words. Silence where the product is doing something visible is deliberate — do not fill it.

---

### 0:00 – 0:14 · Cold open

**On screen:** `/portfolio`, Dashboard tab, already loaded. No cursor movement for the first 2 seconds. Total value, day change, and the Health ring all visible in one frame.

**Narration:**
> "This is my portfolio. Every app can show me what I own. What I want to know is whether it's any good."

**Viewer should notice:** This is a real book with real prices, not a mockup. The Health grade is already on screen before it's mentioned.

---

### 0:14 – 0:32 · The honest score

**On screen:** Cursor moves to the Health panel and expands it. The dimension list renders. Two dimensions read **"Not scored"** rather than a number.

**Narration:**
> "Health score, seventy-four. But Growth and Valuation aren't scored at all. Most of this book is bonds and real assets — those questions don't apply to it. So the engine abstains, and redistributes the weight to the questions that do apply, instead of quietly filling in 'average.'
>
> That sounds small. It's the whole product."

**Viewer should notice:** The gap where a number should be. The phrase *"instead of quietly filling in average"* is the thesis statement of the entire demo.

---

### 0:32 – 0:52 · Risk Lab — the factor model

**On screen:** Risk Lab tab. Scenario picker → **2008 Financial Crisis**. Let the per-holding impact table finish animating. Gold and long Treasuries must be visibly **green** while equities are red.

**Narration:**
> "Stress test. Two thousand eight. Most tools model this as 'everything falls twenty percent.' This one models it in factor space — rates, credit spreads, equity beta, inflation — so gold goes *up*, Treasuries rally, and my cash doesn't move.
>
> It also tells me it can only measure risk on seventy-one percent of this book, and exactly what it's assuming about the rest."

**Viewer should notice:** Green rows inside a crash scenario. Then the **Risk Coverage** figure — a product volunteering the limits of its own measurement.

---

### 0:52 – 1:16 · Decisions — simulated, not asserted

**On screen:** Decisions tab. Ranked recommendation cards. Expand the top card fully: Impact chips (health delta, risk delta), **Why now**, **Why not nothing**, **Opportunity cost**, **alternatives evaluated: N**.

**Narration:**
> "Now the part I actually came for. Every recommendation here was *simulated*, not asserted. It builds the portfolio as it would exist after the trade and re-runs the same engines — so 'plus six health points' is literally what the score will read if I do it.
>
> It ranks them, it prices what it costs me to do nothing, and it's allowed to conclude I'm fine.
>
> Top card: two funds I own are sixty percent the same holdings. I thought I was diversified. I owned the same bet twice."

**Viewer should notice:** `Alternatives evaluated: 7`. **Why not nothing.** And the overlap finding — which arrives as a *discovery*, not a feature.

---

### 1:16 – 1:38 · Research Hub — compression

**On screen:** Click through to `/research?symbol=MU` from the recommendation card. Page streams in (first paint is ~163ms — let the viewer see it land fast). Then click the **materiality lens** control in the header: `14 signals → 3 flagged`. Non-material sections fade; one renders as **"not applicable"** and stays at full contrast.

**Narration:**
> "It says trim Micron. Before I do that, I want to understand it. Filings, insider activity, ownership, peers, the news that actually moved the stock — one page.
>
> Fourteen signals. I turn on the materiality lens and it fades the eleven that don't change this decision. Not hidden — faded, with the reason on hover. And 'we can't score this' looks different from 'this is fine.'"

**Viewer should notice:** The speed of first paint. Then the three-state fade — the product distinguishing *unremarkable* from *unmeasurable*.

---

### 1:38 – 2:06 · Valuation — the peak

**On screen:** `/valuation?symbol=MU`. The reverse-DCF banner is the hero: **implied growth 49.9% vs delivered −18.8%**, side by side. Hold this frame for a full 3 seconds with no cursor movement.

Then: click into the `growthRate1` assumption, type a new value, hit the **lock** icon. Fair value updates instantly. An AI critique appears beside the locked field — as a *comment*, not a replacement.

**Narration:**
> "And then this. Micron trades at seven thirty-nine. Work backwards from that price and the market is paying for *fifty percent* annual free-cash-flow growth. Over the last three years, this business delivered *minus nineteen*.
>
> No model wrote that. It's arithmetic on the filings.
>
> I disagree with the market — memory is cyclical — so I set my own growth number, and I lock it. Now the AI can argue with me. It can't overwrite me. That rule lives in the data layer, not in a prompt.
>
> And when Micron reports next quarter, the facts update, my judgment stays put, and the app tells me which of the two just broke."

**Viewer should notice:** **49.9% vs −18.8%.** This is the number that survives until tomorrow. Then: the lock, and AI demoted from oracle to critic.

---

### 2:06 – 2:22 · IC Report — the depth ceiling

**On screen:** `/ic-report?symbol=MU`, mid-stream. Agent cards land one by one. Cursor rests on a **confidence-downgraded** badge so the tooltip reason shows. Then scroll to the **Disagreements** section — two named agents taking opposite positions on the same topic.

**Narration:**
> "If I want the full workup: nine agents, each handed a different slice of evidence and a different mandate. Every figure they cite is traced back to the data they were given — anything untraceable gets downgraded, not printed as fact.
>
> And where they disagree with each other, that's the output. Not a bug."

**Viewer should notice:** Agents arriving in parallel. The downgrade badge. Disagreement rendered as a first-class section.

---

### 2:22 – 2:38 · Breadth montage

**On screen:** Three cuts, ~5s each, no clicks — pre-loaded states only.
1. `/screener` — a natural-language query in the box, results below, asset-class tabs visible (equity / ETF / REIT / crypto / commodity / bond / FX).
2. `/wire` — an opportunity card with the **Evidence drawer** open, showing the source articles behind it.
3. `/engine` — regime banner + factor-weight drift chart + **Model Validation** panel.

**Narration:**
> "There's a screener I can just talk to, across seven asset classes. A newsfeed where every conclusion links back to the articles that produced it. And a quant engine — regime detection, walk-forward forecasts, fifty-thousand-path Monte Carlo — that logs its own signals and tells me when it stops working."

**Viewer should notice:** Seven asset classes. Evidence → source. And a model grading itself.

---

### 2:38 – 3:00 · Close + vision

**On screen:** Cut back to `/portfolio` Decisions. Execute the trim. The before/after diff chart animates — allocation bars shift, health delta lands on the number the card promised. Let that resolve completely. Hold the final frame.

**Narration:**
> "Back to the decision. Trim Micron — and here's exactly what my portfolio looks like after. The same number the card promised me.
>
> Right now an investor does this across five products, and none of them know each other, and none of them know *you*. This is one workspace that understands both the market and the person holding it.
>
> Next: brokers — so the decision and the trade stop being two separate steps. Indian mutual funds and SIPs. And the same engine watching the book while you're not looking."

**Viewer should notice:** The promised number and the delivered number are the same. That is the demo's closing argument.

---

## 3. Screen direction

### Global rules

- **1440×900 capture**, dark theme throughout. Light theme costs contrast on charts.
- **Cursor moves in arcs, not lines.** Never move and click in the same beat — arrive, pause ~200ms, then click.
- **No page ever loads on camera except Research** (whose 163ms first paint is itself a feature). Everything else: pre-warm the route in another tab, then cut.
- **Never scroll while narrating a number.** Numbers are read stationary.
- **Let every animation finish.** The Reveal/CountUp components are load-bearing here — a cut mid-count reads as a glitch.
- **Zero nav-menu appearances.** Every transition is a click on an in-page link. The absence of navigation *is* the argument.

---

#### 0:00–0:14 — Portfolio cold open
- **Page:** `/portfolio?tab=dashboard`
- **Mouse:** Off-frame for 0:00–0:02. Enters bottom-right, drifts to the Health ring.
- **Clicks:** None.
- **Scroll:** None. Total value / day change / Health ring must all fit above the fold.
- **Keep visible:** Total value, today's P&L, Health grade.
- **Animation:** Let `CountUp` on total value finish before speaking.

#### 0:14–0:32 — Health abstention
- **Mouse:** Health ring → expand chevron.
- **Clicks:** One, on the Health panel expander.
- **Scroll:** Slow, one notch, to bring the full dimension list into frame.
- **Hover:** Rest 1.5s on a **"Not scored"** dimension so its tooltip renders.
- **Keep visible:** Both abstaining dimensions, in the same frame, for at least 3s.
- **Expanded:** Health panel only. Everything else stays collapsed.

#### 0:32–0:52 — Risk Lab
- **Page:** `/portfolio?tab=risk`
- **Mouse:** Scenario dropdown → "2008 Financial Crisis".
- **Clicks:** Two (open dropdown, select).
- **Scroll:** After results render, one slow scroll to the per-holding impact table.
- **Hover:** Rest on the gold/Treasury row while saying "gold goes up."
- **Keep visible:** Portfolio-level impact %, **and** the green rows. Both in frame.
- **Animation:** The impact bars animate in — let all of them finish. This is the single most convincing 2 seconds in the first half.
- **Then:** Cursor to the **Risk Coverage** figure. Do not click. Just rest there.

#### 0:52–1:16 — Decisions
- **Page:** `/portfolio?tab=decisions`
- **Mouse:** Down the ranked card stack, then into card #1.
- **Clicks:** One, to expand card #1.
- **Scroll:** Inside the expanded card only.
- **Hover:** Rest on **"Why not nothing"** for 1s. This phrase should be legible on screen while it's spoken.
- **Keep visible:** Decision score, the Impact chips, `Alternatives evaluated: N`.
- **Expanded:** Card #1 fully. Cards #2 and #3 stay collapsed and visible beneath — the ranking must be apparent.
- **Overlap moment:** Cursor to the overlap figure in the rationale. Rest 2s. Do not open Compare — the number arriving *here* is the point.

#### 1:16–1:38 — Research Hub
- **Page:** `/research?symbol=MU`, entered by clicking the symbol link in the recommendation card.
- **Clicks:** Two (symbol link, then the lens control).
- **Scroll:** One long, smooth scroll through the assembled page *before* touching the lens — the viewer must see how much is there in order for the compression to mean anything.
- **Hover:** After the lens is on, rest on one faded section so its "why this isn't material" reason appears.
- **Keep visible:** The lens counter (`3 flagged`) in the header, at all times.
- **Animation:** `MaterialFade` transition must complete before the next line.
- **Critical:** Frame at least one **"not applicable"** item beside a **faded** item. The distinction only lands visually.

#### 1:38–2:06 — Valuation
- **Page:** `/valuation?symbol=MU`
- **Mouse:** Enters from the Research page's **Valuation strip** (not the nav).
- **Clicks:** Three — into the growth field, then the lock icon, then nothing.
- **Scroll:** None during the reverse-DCF line. The implied-vs-delivered comparison holds the frame alone.
- **Hold:** 3 full seconds on `49.9% implied / −18.8% delivered` with no cursor motion. This is the longest still frame in the demo and it should be.
- **Typing:** Type the new growth value at human speed. Do not paste. Watching fair value recompute *per keystroke* is the demonstration.
- **Keep visible:** Implied growth, delivered growth, fair value, current price — all four, throughout.
- **Then:** Lock icon click → the field's state visibly changes → AI critique appears **beside** it. Hold 2s so the viewer registers that the number did *not* change.

#### 2:06–2:22 — IC Report
- **Page:** `/ic-report?symbol=MU`, already streaming when the cut lands.
- **Mouse:** Minimal. One hover on a downgraded-confidence badge.
- **Clicks:** None.
- **Scroll:** One controlled scroll to the Disagreements section.
- **Keep visible:** The agent progress indicator (agents completing in parallel).
- **Animation:** At least two agent cards should land *on camera*. Do not cut to a finished report — the parallelism is the point.

#### 2:22–2:38 — Montage
- **Cut 1 — `/screener`:** Static. NL query text visible in the box, results populated below, asset-class tabs in frame. No cursor.
- **Cut 2 — `/wire`:** Evidence drawer already open. Cursor rests on the article-count link. No clicks.
- **Cut 3 — `/engine`:** Scroll position set so the regime banner and the factor-weight drift chart are both in frame. Then a hard cut to the Model Validation panel.
- **Each cut is a hard cut.** No transitions. The rhythm change signals "there is more here than we can show."

#### 2:38–3:00 — Close
- **Page:** back to `/portfolio?tab=decisions`
- **Clicks:** One — execute the trim.
- **Animation:** The allocation diff chart must animate **completely**. Do not talk over its final second.
- **Keep visible:** The health delta, matching the card's earlier promise. If possible, frame both.
- **Final frame:** Portfolio dashboard, post-trade, held for 2s after narration ends. No logo card, no URL slate. The product is the last thing on screen.

---

## 4. Complete narration

> Read at ~145 wpm. Bold marks the words that carry the beat. `[ ]` marks a hold — say nothing.

---

This is my portfolio. Every app can show me what I own. What I want to know is whether it's any **good**.

`[hold — health panel expands]`

Health score, seventy-four. But Growth and Valuation aren't scored at all. Most of this book is bonds and real assets — those questions don't apply to it. So the engine **abstains**, and redistributes the weight to the questions that do apply, instead of quietly filling in "average."

That sounds small. It's the whole product.

Stress test. Two thousand eight. Most tools model this as "everything falls twenty percent." This one models it in **factor space** — rates, credit spreads, equity beta, inflation — so gold goes **up**, Treasuries rally, and my cash doesn't move.

`[hold — impact bars finish]`

It also tells me it can only measure risk on seventy-one percent of this book, and exactly what it's assuming about the rest.

Now the part I actually came for. Every recommendation here was **simulated**, not asserted. It builds the portfolio as it would exist after the trade and re-runs the same engines — so "plus six health points" is literally what the score will read if I do it.

It ranks them, it prices what it costs me to do **nothing**, and it's allowed to conclude I'm fine.

Top card: two funds I own are sixty percent the same holdings. I thought I was diversified. I owned the same bet twice.

`[hold — research page lands]`

It says trim Micron. Before I do that, I want to understand it. Filings, insider activity, ownership, peers, the news that actually moved the stock — one page.

Fourteen signals. I turn on the materiality lens and it fades the eleven that don't change **this** decision. Not hidden — faded, with the reason on hover. And "we can't score this" looks different from "this is fine."

`[hold — valuation frame, 3 full seconds]`

And then this. Micron trades at seven thirty-nine. Work backwards from that price, and the market is paying for **fifty percent** annual free-cash-flow growth.

Over the last three years, this business delivered **minus nineteen**.

No model wrote that. It's arithmetic on the filings.

I disagree with the market — memory is cyclical — so I set my own growth number, and I **lock** it. Now the AI can argue with me. It can't overwrite me. That rule lives in the data layer, not in a prompt.

And when Micron reports next quarter, the facts update, my judgment stays put, and the app tells me which of the two just **broke**.

If I want the full workup: nine agents, each handed a different slice of evidence and a different mandate. Every figure they cite is traced back to the data they were given — anything untraceable gets downgraded, not printed as fact.

And where they disagree with each other, that's the **output**. Not a bug.

There's a screener I can just talk to, across seven asset classes. A newsfeed where every conclusion links back to the articles that produced it. And a quant engine — regime detection, walk-forward forecasts, fifty-thousand-path Monte Carlo — that logs its own signals and tells me when it **stops working**.

`[hold — cut back to portfolio]`

Back to the decision. Trim Micron — and here's exactly what my portfolio looks like after. The same number the card promised me.

Right now an investor does this across five products, and none of them know each other, and none of them know **you**. This is one workspace that understands both the market and the person holding it.

Next: brokers — so the decision and the trade stop being two separate steps. Indian mutual funds and SIPs. And the same engine watching the book while you're not looking.

`[hold 2s on final frame]`

**— 434 words —**

---

## 5. Features not shown

Each written as a single sentence, droppable into a transition if a beat runs short. Ranked by how much they'd add.

**Strong — use these first if you gain time:**

1. **Simulator** — "Describe a mandate in plain English, it interviews you with follow-up questions, then generates a complete live-priced portfolio you can edit, compare against your real book, and promote into it."
2. **Valuation Register** — "Every valuation case I've ever built, sorted by which ones have gone stale or broken since I wrote them."
3. **Decision Journal + calibration** — "It grades my track record, and separately grades whether my *high-conviction* calls actually beat my low-conviction ones."
4. **Allocate Cash** — "Give it new cash and an objective, and it water-fills across the entire investable universe in eighteen tranches, showing the marginal benefit of each dollar and why every rejected alternative lost."
5. **Knowledge Graph** — "It builds a live graph of how my holdings, sectors, and events connect, and can explain any path between two nodes."

**Worth one line if the moment fits:**

6. **Thematic engine** — "Pick a macro theme and it maps the whole dependency chain, from raw commodity to bottleneck to the companies at each tier."
7. **Watchlist** — "Targets with direction, thesis notes, idea stages, and alerts that fire on the *crossing*, not the state."
8. **Timeline** — "Every symbol accumulates a permanent, classified event history, so I can ask what's changed since I last looked."
9. **Compare (as a page)** — "Up to five names side by side, with a different framework for each asset class — expense ratios for ETFs, duration for bonds, roll yield for commodities."
10. **India** — "Full India research on screener.in data, the quant engine runs the Nifty universe with NSE expiry-week position sizing, and an India-native WACC."
11. **Calendar** — "Earnings and ex-dividend dates with pre- and post-event performance."
12. **Manual assets** — "Real estate, private company stakes, and anything else that doesn't have a ticker, plugged into the same risk and allocation engines."
13. **Exports** — "Every workspace exports to Excel or PDF with the working shown, not just the output."
14. **Offline** — "The whole thing runs on local models if you're on a plane or logged out."
15. **Platform data layer** — "One caching and deduplication layer under every fetch, with dependency-aware invalidation — a price tick invalidates the valuation, not the business overview."

---

## 6. Final critique

### Would a YC partner remember this tomorrow?

**Yes — one thing.** They will remember *"the market is paying for fifty percent growth; the company has been shrinking nineteen percent a year."* That number is specific, checkable, instantly legible, and it is a **judgment**, not a feature. Everything else in the demo is scaffolding for that sentence.

Second most likely to survive: **"the engine abstains."** It's the only sentence in the demo that no competitor could truthfully say.

If they remember a third thing, it's *"it tells me when it stops working."*

Three retained ideas from a 3-minute demo is a good outcome. Most demos leave zero.

### Where is the biggest wow?

**1:38–2:06, the reverse DCF.** It is the only moment where the product produces a conclusion the viewer could not have reached alone, from data they already believed they had access to, with no AI involved. That last clause is what makes it land in 2026 — everyone is numb to "AI said." Nobody is numb to arithmetic they hadn't done.

**Runner-up: 0:32–0:52, gold going green in a crash scenario.** Financially literate viewers will physically react to this, because they know every retail tool gets it wrong.

### Which sections are weak?

**The montage (2:22–2:38) is the weakest 16 seconds.** Three cuts, three claims, no proof for any of them. It exists for breadth, and breadth is the least persuasive thing in a demo. It survives because cutting it would leave the partner thinking this is a portfolio tool rather than a platform — but it should be the *first* thing sacrificed if the edit runs long.

**The IC Report beat (2:06–2:22) is second weakest.** "Nine agents" is now a 2026 cliché and the viewer's prior is that multi-agent means slop. The beat is rescued *only* by the confidence-downgrade badge and the disagreements section — those are the two frames that say "we know what you're thinking, and we built for it." **If those two frames aren't clearly visible on camera, cut the beat entirely** and give the seconds to Valuation.

**The Research Hub beat (1:16–1:38) is the most cuttable.** The materiality lens is genuinely good, but "we hide the unimportant stuff" is a claim viewers have heard. Its only defensible moment is the three-state distinction — faded vs. not-applicable. If that doesn't read clearly on screen in under 3 seconds, compress this beat to 12s and move on.

### What deserves more time?

**Valuation deserves 40 seconds, not 28.** The re-valuation loop — *facts move, judgments stay, the difference is a verdict on your case* — is the most defensible business idea in the codebase and it currently gets one sentence at the end of a beat. It is the feature that makes UAA a system of record rather than a tool, and systems of record are what become billion-dollar companies.

**Take those 12 seconds from the montage (cut to 8s, drop Screener) and IC Report (cut to 12s).**

### What still feels generic?

- **"Filings, insider activity, ownership, peers, news — one page."** Every research product says this. It survives only on the *speed* of the page landing. If the capture doesn't show it land near-instantly, the line is dead weight.
- **"There's a screener I can just talk to."** NL query is table stakes now. The genuinely uncopyable part — *a metric with no data provider cannot become a filter* — is too subtle for 5 seconds. Either find a way to show an empty-result trap being prevented, or accept this line is filler.
- **"Nine agents."** See above.

### What can be cut?

In priority order, if the edit runs long:
1. Screener from the montage (−5s)
2. IC Report down to the two rescuing frames (−4s)
3. Research Hub scroll-through (−4s)
4. The entire montage (−16s, last resort)

**Never cut:** the abstention frame, the green-gold frame, the implied-vs-delivered frame, the lock, or the closing diff that matches the promised number.

### What can be made simpler?

- **"Factor space — rates, credit spreads, equity beta, inflation"** → the four-item list is one item too many for spoken word. Consider: *"it models the crisis as a shock to rates and credit, not a blanket haircut — so gold goes up."*
- **"Redistributes the weight to the questions that do apply"** is the most complex clause in the script. It's load-bearing, so keep it, but slow down through it.
- **The closing vision has four items** (brokers, execution, Indian MF/SIP, continuous monitoring). Three is the maximum a viewer holds. Consider dropping SIPs, or dropping continuous monitoring — the broker line is the one that makes the business model obvious.

### What makes this impossible to confuse with another investing product?

Ranked by uniqueness:

1. **A score that refuses to score.** No consumer product abstains, because abstention looks like a bug in a demo and a lawsuit in a pitch. Doing it anyway is a positioning statement.
2. **Valuation as a persisted, versioned, ownable object** that gets re-checked against reality and grades *your* forecasting. Nobody sells this. It is also the strongest retention mechanic in the product — a user with twelve valuation cases with three years of revision history cannot leave.
3. **An AI that is structurally forbidden from overwriting the user's judgment** — enforced in the data layer, not the prompt. In a market where every product is racing to have the AI decide, this is contrarian in a way that ages well.
4. **A quant engine that publishes its own decay.** Live IC, hit rate, degradation alerts.
5. **Recommendations whose claimed impact is computed by the same function that will later report the result.** The promise and the measurement are literally the same code.

Items 2 and 3, together, are the actual company. Items 1, 4, 5 are the proof that you'd build it correctly.

---

## Before you film — practical blockers

These are real, and three of them will break the demo as scripted.

### 🔴 The demo portfolio must be rebuilt

`data/app.db` currently holds **7 lots, all US equity/ETF, ~$1,000 total** (QQQM, VOO, DRAM, META, MU, TSM, MSFT).

Consequences as scripted:
- **The health-abstention beat cannot happen.** Growth and Valuation *will* score, because it's an all-equity book. The line "most of this book is bonds and real assets" is false.
- **The 2008 scenario has no gold and no Treasuries.** Nothing goes green. The strongest visual in the first half does not exist.
- **Risk coverage will be ~100%.** The "I can only measure 71%" line requires illiquid holdings.
- **Dollar amounts will read as $0.16.** Not credible on camera.

**Fix:** seed a book of roughly $250k–$1M spanning equity, ETF, bond, REIT, commodity/gold, crypto, cash, and at least one manual asset (real estate or a private stake — this is what creates the risk-coverage gap and the declared-proxy-volatility story). Keep MU in it.

Fastest path: use the **Simulator** to generate it, then **promote** it to real holdings. That exercises a real feature rather than hand-inserting rows.

### 🔴 The Quant Engine's last run won't demo

`data/engine_dashboard.json` (2026-08-02): **50 symbols, all NSE India, every signal `HOLD`, conviction book empty, regime "Range"**. `data/engine_validation.json` shows `longShortSpread: −0.0123`, `monotonic: false`, hit rate 0.43 on 21 signals.

The Engine page will render an empty conviction book and a validation panel reporting that the model didn't work.

**Two options, and I'd take the first:**
- **(a)** Re-run `python -m engine.daily_run` on a US or blended universe with enough history to populate the conviction book, and film the validation panel only if the numbers hold up.
- **(b)** Keep the honest framing and *lean into it* — "it tells me when it stops working" over a panel showing exactly that. This is intellectually the strongest possible version of the beat and the riskiest one to put in front of a partner who is skimming. It works only if the narration owns it in the same breath.

Do **not** film option (b) accidentally.

### 🟡 Verify the QQQM/VOO overlap actually returns a number

The overlap moment is scripted as a discovery, and it's real — you own both. But `lib/compare/holdings-overlap.ts` depends on Yahoo's `topHoldings` module returning data for both funds. **Check this before building the beat around it.** If it comes back empty, the fallback is the sector-concentration finding from `lib/knowledge-graph/recommend.ts`, which is weaker but always present.

### 🟡 The MU fair value is an extreme output

The seeded case reads **fair value $35.41 against a price of $739** and a margin of safety of −1987%. Shown raw, a skeptical viewer concludes the model is broken.

**This is why the script leads with implied-vs-delivered growth and never says the fair value out loud.** The live edit — set your own growth rate, lock it, watch fair value move to something defensible — is what defuses it. Do not cut that interaction; it is doing structural work, not just demonstrating a feature.

### 🟢 Everything else checks out

Research first paint (163ms), the platform cache (6,980 entries warm), 2,092 cached fundamentals, 236 timeline events, 463 EDGAR filings cached, hosted AI via Devin CLI at 4–6s for deep tasks. The app will feel fast on camera, which matters more than any single feature.
