# 02. Redundancy and Information Density: the Today dashboard (`/`)

Evidence base: live digest sample (`/tmp/home-digest.json`, generated 2026-08-08 03:11), live brief stream (`GET /api/home/brief`, generated 2026-08-07 21:50 cache), baseline screenshot `shots/baseline/1440.png` (1440 x 2942 px), and the module/engine sources cited per line. Companion to `00-architecture-map.md` (observations 2, 3, 4 are expanded here). All px figures are measured off the 1440 baseline and rounded to the nearest ~10 px.

Live values used throughout: cash 32.9% of book, day P&L +1.2% (+$31.68K), health C 68/100, regime neutral with breadth 82%, five signals SYF/ALL/TSM/BAC/SCHW, one decision "Trim USD Cash from 33% to 20%".

---

## 1. Fact-repetition table

Each row is one distinct FACT a reader can learn from the page. "Mentions" counts separate on-screen renderings of that fact (visible at default state, or one click away where noted). The long read is `defaultCollapsed` but persisted-expandable; its mentions are marked (LR). Rows are ordered by mention count.

| # | Fact | Mentions | Where each mention lives (component, file:line) |
|---|------|----------|--------------------------------------------------|
| F1 | Cash is ~33% of the book (32.9%), a single-asset concentration risk | 10 | 1. Brief support prose "held back by two concentration findings... the 32.9% USD Cash position" (TodaysBrief narrative, todays-brief.tsx:325-332; text from lib/home/brief.ts:136-141 prompt). 2. Brief "watch today" sentence, same headline block (prompt asks for "the single most important thing to watch today", brief.ts:155; the model answers with the cash position). 3. Next-best-step THREAT spotlight "USD Cash concentration ... 32.9% of the portfolio" (SpotlightCard, attention-queue.tsx:210-333; data threats.ts:156-170 concentrationThreats). 4. ACTION queue row "Trim USD Cash from 33% to 20%" with rationale repeating "USD Cash is 32.9% of the portfolio..." (QueueRow, attention-queue.tsx:350-433; data actions.ts:53-88). 5. Book card CASH stat "33%" (book.tsx:279-284, d.cashPct). 6. (LR) Risks tile "at 30.0% of the portfolio, USD Cash means..." (ai-investment-brief.tsx:163, note.risks). 7. (LR) Opportunities band "redeploying part of the 30.0% USD Cash position" (ai-investment-brief.tsx:383-399). 8. (LR) Portfolio observations "The top recommendation is to reduce the 30.0% USD Cash weight" (ai-investment-brief.tsx:164). 9. (LR) Recommendations[0] "Reduce the 30.0% USD Cash position" (ai-investment-brief.tsx:425-444). 10. Pulse `largestRisk` carries the same sentence in the digest (pulse slice; currently unrendered text but shipped). |
| F2 | TSM is a candidate/idea right now | 7 | 1. Queue signal row "TSM fits your book" 66 (attention-queue.tsx:350-433; seed attention.ts:314-329). 2. Radar tile "TSM GOOD FIT 79" (radar.tsx:107-167). 3. Change chip "New in your queue: TSM fits your book" (whats-changed.tsx:52-69; changes kind `attention-new`). 4. Change chip "New idea: TSM fits your book (79)" (kind `opportunity-new`). 5. Queue alert row "TSM scoring 81/100" (watchlist alert, digest watchlistIntelligence.alerts, surfaced via seedsFromAlerts attention.ts:255-277). 6. Queue alert row "TSM trading 29% below analyst targets" (same feeder). 7. Radar footer "Watchlist: 1 buy" (radar.tsx:258-262; the buy bucket IS [TSM]). |
| F3 | Day P&L +1.2% / +$31.68K | 6 | 1. Hero KPI "TODAY +1.2%" + "$31.68K" caption (todays-brief.tsx:276-283, count-up animated). 2. Hero top hairline accent color encodes the same sign (todays-brief.tsx:178-182). 3. Book card "Day P&L +1.2% +$31.68K" (book.tsx:234-244). 4. Brief prose "your portfolio is up 1.1%" (headline sentence 1; brief.ts:136). 5. (LR) Portfolio observations "Today's +1.1% is constructive" (note.portfolio). 6. `portfolioSummary` "it is up 1.1% today" ships on the stream (brief route:47) though no module renders it. |
| F4 | Health grade C 68/100 | 6 | 1. Hero KPI "GRADE C 68" (todays-brief.tsx:284-293, ExplainableValue). 2. Book health ring "C 68/100" (book.tsx:46-73 HealthRing, :221). 3. Brief prose "carries a health grade of C (68/100)" (headline; brief.ts:133). 4. (LR) Portfolio observations "Health grade C (69/100)" (note.portfolio). 5. (LR) Recommendations[1] "...lift the C (69/100) health grade". 6. `portfolioSummary` repeats it unrendered. Both explain popovers (hero and book) open the identical explainHealth decomposition (lib/home/explain.ts:133-178). |
| F5 | Market regime is neutral | 6 | 1. Hero header regime chip "NEUTRAL" (todays-brief.tsx:220-225). 2. Brief headline "the tape is still classified as mixed/neutral" (brief.ts:121,148). 3. Change chip "Market regime shifted to neutral" (whats-changed; changes kind `regime`). 4. (LR) Hero band regime word "Neutral" (ai-investment-brief.tsx:128-137, 372-380). 5. (LR) note.regime prose "The regime is neutral...". 6. (LR) Recommendations[2] "consistent with a neutral regime". |
| F6 | Breadth: 82% of sectors advancing | 5 | 1. Brief headline "Breadth is broad today with 82% of sectors advancing" (from regime line, brief.ts:121). 2. (LR) note.regime "82% of sectors advancing". 3. (LR) participation pill "Broad participation" (derived from the same breadthPct, ai-investment-brief.tsx:145-150, 379). 4. (LR) note.macro "broad 82% sector participation". 5. Sentiment gauge component "Market breadth 82" contributing 25 pts of the score (visible in the sentiment tile explain path, digest sentiment.components). |
| F7 | SYF fits your book (combined 80, "Well-rounded fundamentals") | 2 | 1. Queue signal row, priority 67 (attention-queue.tsx:350-433). 2. Radar tile "SYF GOOD FIT Fit 80" (radar.tsx:107-167). Same source array (see section 2). |
| F8 | ALL fits your book (79) | 4 | Queue row 66, radar tile 79, plus two change chips ("New in your queue: ALL...", "New idea: ALL... (79)"). |
| F9 | BAC fits your book (75) | 2 | Queue row 65 + radar tile 75. |
| F10 | SCHW fits your book (75) | 2 | Queue row 65 + radar tile 75. |
| F11 | "Trim cash to 20%" is the top decision | 4 | 1. ACTION queue row title (actions.ts:62, decision engine title). 2. (LR) Recommendations[0] restated as "Reduce the 30.0% USD Cash position". 3. (LR) note.opportunities restates it as the "clearest opportunity". 4. Brief headline "watch today" sentence is the same instruction in prose. (The threat spotlight, F1 mention 3, is the same story from the threats feeder; the queue carries the one story as TWO rows, threat 73 and action 62, because dedupeKeys differ: `threat:threat-conc-holding:high` vs `action:portfolio:50`, attention.ts:234-239 vs :204-208.) |
| F12 | 2 concentration findings | 4 | Brief prose "two concentration findings" (headline); (LR) note.risks "Two concentration findings are flagged"; (LR) recommendations[1] "Address both flagged concentration findings"; unrendered portfolioSummary. Source: brief.ts:73 alertCount = report.concentration.length. |
| F13 | Multi-week sector leaders: Healthcare, Financials, Industrials | 3 | Brief headline sentence 2 (brief.ts:127-129); (LR) note.sectors; fallbackBriefing carries it too when AI is down (brief.ts:102-104, same surface as 1). |
| F14 | Markets closed, showing Fri Aug 7 close | 4 | 1. Hero band 4a session note "MARKETS CLOSED - FRI, AUG 7 CLOSE" (todays-brief.tsx:341-345, pulse.sessionNote). 2. Book "Fri, Aug 7" under Day P&L (book.tsx:245-247, sessionDate). 3. Market Overview subtitle "Showing Fri, Aug 7 close" (market-intelligence.tsx:74-84, 369-370). 4. Page header date line (home-header.tsx:33-37, today's date rather than session, but part of the same when-is-this-from cluster). |
| F15 | Digest generated 3:11 AM | 3 | 1. Page header "Updated 3:11 AM" (home-header.tsx:22-25). 2. Book header caption "Updated 3:11 AM" (book.tsx:200-206). 3. Market Overview subtitle "Sat, Aug 8, 3:11 AM" (market-intelligence.tsx:360-365). |
| F16 | ABNB is today's top performer (+17.4% / +64.1 bps) | 2 | 1. Hero "Top ABNB +17.4%" (todays-brief.tsx:346-354). 2. Book contributors row "ABNB Airbnb, Inc. +64.1 bps" (book.tsx:327-335). Same event, two different units (position % vs book bps) with no visible link between them. |
| F17 | AMD is today's weakest (-1.2%) | 1 | Hero "Weakest AMD -1.2%" (todays-brief.tsx:356-364). |
| F18 | Portfolio value $4.07M | 1 | Hero KPI (todays-brief.tsx:275). |
| F19 | 1 recommended action exists | 1 (but 3 sibling counts) | Hero KPI "ACTIONS 1" (todays-brief.tsx:294-299, recommendedActions.actions.length). Sits on the same page as "19 open" (queue openCount, attention-queue.tsx:616-618), "6 changes, 4 new" (hero chip, todays-brief.tsx:231-255) and "3 unread notifications" ((LR)/fallback prose). Four counts, four collections, one concept-space; the architecture map already flagged this (obs 2). |
| F20 | XIRR +68.6% vs SPY +29.6%, excess +39.0 | 1 | Book return band (book.tsx:262-300). |
| F21 | 90-day return +9.7% vs SPY +4.9% | 1 | Book comparison sparkline endpoints (book.tsx:106-176). Note F20 and F21 are the SAME question (am I beating SPY?) answered twice with different windows and methods on one card; they read as a disagreement (+39.0 excess vs +4.9 spread) to anyone who does not parse the labels. |
| F22 | VOO +4.9 bps, GOOGL -4.0 bps contributions | 1 | Book contributors band (book.tsx:325-345). |
| F23 | Regime changed since last visit (was risk-on) | 2 | Change chip + its detail row (whats-changed.tsx:52-93). The delta is new information; the destination state duplicates F5. |
| F24 | 3 queue items cleared since last visit | 1 | Change detail (chips cap at MAX_CHIPS 5, whats-changed.tsx:27; this one is behind "Details (+1)"). |
| F25 | US Employment Report (Jul), dated 2026-08-07 | 1 | Queue EVENT row, priority 55 (seedsFromEvents attention.ts:280-311). Digest also ships it in `timeline` and `upcomingEvents` slices which no module renders. |
| F26 | MA dividend 2026-08-07 | 1 | Queue EVENT row, priority 55 (behind "11 more items" fold on the live shot). |
| F27 | CART breaking out +11.4% | 2 | Queue ALERT row 42 (fold) + radar footer "1 near-buy" (the near-buy bucket IS [CART]). |
| F28 | Sentiment: Extreme Greed (81) | 1 (+2 shadow) | Sentiment tile (market-intelligence.tsx:299-330). Shadow mentions: the VIX tile and the breadth figure ARE 44+25 of its 81 points (digest sentiment.components), so two adjacent tiles restate its two largest inputs. |
| F29 | VIX 14.90, normal volatility | 2 | VIX tile + caption (market-intelligence.tsx:145-161); the sentiment tile caption "...with normal volatility" re-derives the same VIX band one tile to the left (market-intelligence.tsx:275-297). |
| F30 | S&P 500 7,757.64 +0.62% | 1 | Index strip (market-intelligence.tsx:91-129). (Its momentum is also 13 pts of the sentiment score.) |
| F31 | Oil down ~0.3% | 2 | WTI tile "77.08 -0.27%" and Brent tile "82.27 -0.27%" (market-intelligence.tsx:171-206). Two tiles, same commodity story, captions differ only in wording ("Energy prices trending lower." / "Brent crude moving lower."). |
| F32 | NASDAQ / DOW / FTSE / NIKKEI levels | 1 each | Index strip. DOW is near-fully correlated with S&P for any decision this page supports. |
| F33 | 10Y 4.66%, gold 4,401, DXY 99.60, BTC 65,004 | 1 each | Tile grid. |
| F34 | ALL and TSM are NEW since last visit | 3 each | Radar "New" pill (radar.tsx:141-145, from changes kind `opportunity-new`), the two change chips per symbol (F2/F8), and TSM's "Surfaced" context chip on the queue row (attention-queue.tsx:176-197, symbolContext.watchlistStage). |
| F35 | 3 unread notifications | 2 | Fallback/AI prose (brief.ts:108-110); (LR) recommendations[3] "Review the 3 unread alerts". (Plus the global nav bell badge, outside this page's modules.) |
| F36 | Brief written at 3:10 AM, 2 min read | 1 each | Hero meta row (todays-brief.tsx:256-266). |

36 distinct facts; the top six facts account for roughly 37 of the ~75 total mentions on the page.

### The headline case, spelled out

The cash concentration story (F1) is one number from one engine (`report.concentration[0]`, surfaced via threats.ts:156-170 and the decision engine). On the live page a reader meets it in at least six visually separate places before scrolling past the fold (brief prose twice, threat spotlight, action row, book CASH stat, and the whats-changed regime chip sits between them), then four more times if they expand the long read. Every mention past the first two adds zero information; the only mention that adds DECISION content is the action row (target 20%, simulated +3.3 health, sizing $526,942), and it is ranked BELOW the informationless threat restatement of the same story (73 vs 62; see 03-decision-utility.md DU-03).

---

## 2. Proof: the five radar tiles duplicate the five signal queue rows

Same array, two renderings:

1. `buildOpportunitySnapshot()` produces ONE ranked list, already capped at five: `rankByFit(candidates, profile, DEFAULT_FIT_WEIGHT).slice(0, 5)` (lib/mission-control.ts:307-316).
2. The digest passes that exact object to BOTH consumers:
   - `seedsFromSignals(opportunity.opportunities)` feeds the Attention Queue (lib/home/digest.ts:264).
   - `opportunityFeed: { ...opportunities: opportunity.opportunities... }` ships the same reference to the client (lib/home/digest.ts:289-293).
3. The Radar renders `opportunityFeed.opportunities.slice(0, 5)` (radar.tsx:174, 249), a no-op slice of an already-five-item list.
4. The queue's signal seeds are 1:1 transforms of the same items: headline `"${o.symbol} fits your book"`, rationale `o.fitSummary`, impact `o.combinedScore / 100` (lib/home/attention.ts:314-329).

So for each of SYF, ALL, TSM, BAC, SCHW the page renders: the same symbol, the same fitSummary sentence (queue rationale) or its designated "second driver" (radar reason, radar.tsx:57-61, which exists PURELY to avoid repeating the queue's sentence verbatim, an in-code admission of the duplication), and the same underlying number twice through two transforms: combinedScore raw on the radar (80/79/79/75/75) and `74.7 x sqrt(combinedScore/100)` on the queue rail (67/66/66/65/65). Two "different scales" (the code comments at radar.tsx:16-19 and attention-queue.tsx:19-24 defend this deliberately) that are in fact one number, monotonically re-mapped, since urgency (0.6) and confidence (0.5) are per-kind constants for every signal (attention.ts:69-75, :87, :323-324). Ten of the thirteen visible rows/tiles in the attention band are five facts.

---

## 3. Vertical space per new fact (1440 px baseline)

Heights measured from `shots/baseline/1440.png` (full page 2942 px). "New facts" = facts from the table above making their FIRST on-screen appearance in that module, reading top-to-bottom, left column before right within a row. "Repeated" = renderings of facts already introduced above. Collapsed long read scored as rendered (its expanded body is scored separately).

| Module | approx px height | New facts introduced | Facts repeated | px per new fact |
|---|---|---|---|---|
| Page header (Today + date + updated) | ~75 | 2 (date, F15 generated-at) | 0 | ~38 |
| Today's Brief hero (8/12 col) | ~715 | 13 (F1, F3, F4, F5, F6, F12, F13, F14, F16, F17, F18, F19, F36) | 3 (F1 x2 more in prose, F3 accent line, changes chip previews F23) | ~55 |
| Portfolio Health book card (4/12 col, same row) | ~715 | 5 (F20, F21, F22, and the return-method labels; F15 caption is a repeat) | 5 (F4 ring, F3 Day P&L, F14 session date, F1 cash stat, F16 in bps) | ~143 |
| What Changed band | ~66 | 3 (F23 delta, F24, F34 newness flags) | 3 (chips restate F2/F8 queue+radar rows below, regime destination state F5) | ~22 (best on page) |
| Attention queue (7-8/12 col) | ~1008 | 9 (F7-F11 signal facts + action target detail, F25, F26 x2 events; F2 alerts behind fold) | 4+ (spotlight = F1 again; signal rows re-shown beside radar; rationale of action row = F1 sentence verbatim) | ~112 |
| Radar (4-5/12 col, same row) | ~680 | 2 (watchlist buy/near-buy counts; per-tile quality subscores, marginal) | 7 (all five tiles = F7-F11; New pills = F34; footer counts restate F2/F27) | ~340 (worst on page) |
| Market Overview | ~584 | 13 (F28-F33: 5 strip indices + 8 tiles, counting the WTI/Brent pair and the sentiment/VIX overlap as 2 internal near-dupes) | 2 (F14 session note, F15 stamp; sentiment tile shadows F6) | ~45 |
| AI Investment Brief (collapsed) | ~145 | 0 | 0 (a header and a promise) | infinite while collapsed |
| AI Investment Brief (expanded body, est. ~1100 from note length) | ~1100 | ~3 ("stage redeployment incrementally", "Technology is a leader today but multi-week laggard", macro = explicitly nothing) | ~12 (F1 x4, F3, F4 x2, F5 x3, F6 x3, F11 x2, F12 x3, F13, F35) | ~365 |

Aggregate: roughly 2,940 px of page for ~50 first mentions and ~36 repeats. The two structurally worst surfaces are the Radar (a full card whose five tiles are all repeats of the queue beside it) and the expanded long read (a screen of prose that is >80% restatement of facts the hero already stated in two sentences).

---

## 4. Single-mention map

Principle: each fact gets ONE owner surface at the altitude its half-life earns. Headline stats are for numbers that gate the day's first decision; cards are for numbers that support one named question; disclosures (popover, expander, linked page) are for derivations, history, and restatements. Everything else becomes a link or a chip pointing at the owner.

| Fact | One owner surface | Altitude argument | What replaces the other mentions |
|---|---|---|---|
| F1 cash 33% | The ACTION queue row (the trim decision), promoted to the spotlight slot | It is the page's only simulated, sized, executable decision; the number's job is to justify an action, so it should live where the action is. Card altitude, top of queue. | Book CASH stat stays (different question: composition, not decision) but loses the color of urgency; brief prose keeps ONE sentence with an inline link scrolling to the spotlight; the separate THREAT row is deduped into the action (one story, one row: give threats.ts concentration items and the decision engine's trim a shared story key so attention.ts dedupe collapses them); all four long read mentions are deleted from the prompt scope (tell the model the top recommendation is already displayed; ask only for what is NOT on screen). |
| F3 day P&L | Book card Day P&L | It is a state-of-the-book number, and the book card is the state-of-the-book card. | Hero KPI strip drops TODAY (the headline prose already says "up 1.2%"); accent line can stay (ambient, 0 px); long read banned from restating it. |
| F4 health C 68 | Book health ring | The ring + explain popover is the richest rendering; grade is a slow-moving state, card altitude. | Hero GRADE KPI becomes a plain link chip "Health C" scrolling to the book card, or is cut; prose mentions capped at one. |
| F5 regime + F6 breadth | Hero regime chip (word) with breadth in its explain popover | Regime is context for reading everything else, so it belongs in the header eyebrow at chip altitude; 82% is a derivation of the chip, disclosure altitude. | Long read regime band collapses to prose only (no repeated word, no participation pill: the pill is breadth restated); change chip keeps the DELTA only ("regime: risk-on -> neutral"). |
| F7-F11 signals | Radar tiles only | Signals are top-of-funnel ideas, not decisions; the Radar is by its own doc comment "what's worth a look next" (radar.tsx:8-9). The queue should hold only items needing a decision. | Delete the signals feeder from the queue (digest.ts:264) or gate it to fit >= a materiality threshold; the queue drops from 19 to 14 open, and the "same ticker, two numbers" problem disappears. New-since-last-visit stays as the radar New pill; change chips reference, not restate ("2 new ideas -> Radar"). |
| F11 trim target 20% | Spotlight action row | See F1. | Long read recommendations must exclude the on-screen top recommendation (prompt change in brief.ts:119-168). |
| F12 findings count 2 | Explain popover of the health ring (it is a health sub-fact) | Derivation, disclosure altitude. | Cut from prose. |
| F14 session note | Page header, once ("Sat Aug 8 - markets closed, showing Fri close") | It qualifies EVERY number on the page, so it belongs on the page, not per card. | Hero band 4a note and Market Overview subtitle drop theirs; per-metric stamps stay for mixed-session edge cases (stamped.tsx already handles that). |
| F15 generated-at | Page header only | Same argument as F14. | Book caption and market subtitle drop it. |
| F16/F17/F22 movers + contributors | Book contributors band, in bps, with day % in a tooltip | One unit, one place; bps answer "what moved MY book", the % is a per-position detail. | Hero Top/Weakest line cut (it is the contributors band's top and bottom row restated in a second unit). |
| F19-count cluster | One number: the queue's open count, in the hero ACTIONS slot, labeled "Queue" | The four counts (1 action, 19 open, 6 changes, 3 unread) should collapse to the one the CTA actually opens. | "6 changes" chip stays as a nav affordance but is the whats-changed band's own header, not a hero element; unread notifications stay in the nav bell only. |
| F20/F21 vs-SPY | One comparison: keep the 90-day sparkline with its endpoint labels; move XIRR/excess into the sparkline's explain popover or the Attribution page | Two windows of the same question on one card reads as a contradiction; the chart is the more legible one; the precise annualized figure is disclosure material. | Return band collapses to one line: "XIRR +68.6% ann." as caption under the chart. |
| F25/F26 events | Queue event rows (they are genuinely queue material) | Dated, expiring, decision-adjacent. | Delete the unrendered `timeline`/`upcomingEvents` digest slices from the wire (see RD-16). |
| F28/F29 sentiment + VIX | One tile: VIX with the sentiment word as its caption ("14.90, normal volatility, gauge: Extreme Greed 81") | The gauge is 54% VIX (44 of 81 pts); its remaining inputs (breadth, momentum) are both already on the card. A composite whose components are all visible beside it is a summary, disclosure altitude. | Sentiment tile cut or merged; explainSentiment popover (explain.ts:181-201) moves onto the merged tile. |
| F31 oil | WTI tile only | One benchmark answers the energy question this page can support. | Brent cut to The Wire ("See all" already links there). |
| F34 newness | Radar New pill | Newness is an attribute of the idea; render it on the idea. | Change chips summarize ("2 new ideas") and link; the "Surfaced" queue chip disappears with the signals feeder. |

Net effect if the map is applied: the page's ~75 mentions collapse to ~40 with zero facts lost; the radar and queue stop mirroring each other; the long read becomes the only surface allowed to say things that appear nowhere else.

---

## 5. Findings

**RD-01 (high) - One risk story is told ten times.** The 32.9% cash concentration appears in 10 renderings across 5 modules (F1 table row; six visible pre-fold). Two of them (threat row 73 and action row 62) are the same story ranked twice IN THE SAME LIST because their dedupe keys cannot collide (attention.ts:204-208 vs :234-239). Evidence: digest sample attention items 1 and 7; threats.ts:156-170; actions.ts:53-88; todays-brief.tsx:325-332; book.tsx:279-284; live brief note (risks, portfolio, opportunities, recommendations[0]).

**RD-02 (high) - The Radar module is a 680 px rendering of five facts already on screen.** Both surfaces render `buildOpportunitySnapshot().opportunities` (mission-control.ts:307-316) verbatim: digest.ts:264 (queue feeder) and digest.ts:289-293 -> radar.tsx:174/249 (tiles). The radar's own `radarReason()` (radar.tsx:49-61) exists solely to avoid repeating the queue's sentence, and rankByFit's uniquifier (fit-scorer.ts:775-798) exists to keep five near-identical fitSummary strings from being literally identical: two layers of code compensating for a duplication instead of removing it. Priority 67/66/66/65/65 and Fit 80/79/79/75/75 are one number through two transforms (see 03, DU-01/DU-04).

**RD-03 (high) - The long read is ~80% restatement.** Of the live note's seven sections, regime restates F5/F6, risks restates F1/F12, portfolio restates F3/F4/F1, opportunities restates F11, macro states it has nothing ("No specific macro data or events were provided", which the module's own isEmptySection filter at ai-investment-brief.tsx:109-114 catches for the tile, but the same admission also pads note.macro's second sentence with F5/F6 again), and 4 of 5 recommendations restate F1/F12/F35/F5. Only note.sectors adds a claim not present above (Technology leader-today vs laggard-multi-week). The prompt hands the model the same five facts the hero renders (brief.ts:119-151) and asks for seven sections; the repetition is structural, not a model failure.

**RD-04 (medium) - Day P&L and health each render 5-6 times, twice with interactive duplicates.** The hero GRADE KPI and the book ring open the identical explainHealth popover (todays-brief.tsx:287, book.tsx:220); two entry points to one decomposition 300 px apart. Evidence: F3/F4 rows.

**RD-05 (medium) - TSM is narrated seven times in four vocabularies** (fits your book / GOOD FIT 79 / scoring 81/100 / 29% below targets / New / Surfaced / 1 buy), and no surface joins them. A reader cannot tell whether these are one thesis or four. Evidence: F2 row; watchlistIntelligence.alerts in digest; symbolContext.TSM.watchlistStage = "surfaced".

**RD-06 (medium) - The change band restates rather than references.** 4 of its 6 changes are "X entered the queue/radar" for items visible 200 px below, already marked with their own New pills (radar.tsx:141-145). The genuinely new content (regime delta, 3 cleared) is 2 of 6 chips, and one of those is behind the Details fold. Evidence: digest changes[]; whats-changed.tsx:130-141.

**RD-07 (medium) - Four counts for four different collections read as one.** "ACTIONS 1" (hero), "19 open" (queue), "6 changes, 4 new" (hero chip), "3 unread" (prose). No shared vocabulary, no reconciliation anywhere on the page. Evidence: todays-brief.tsx:294-299 vs attention-queue.tsx:616-618 vs :231-255 vs brief prose; architecture map obs 2.

**RD-08 (medium) - Two vs-SPY comparisons on one card with different answers.** "+68.6% vs +29.6%, excess +39.0" (XIRR, since inception, annualized, money-weighted) sits 90 px above "+9.7% vs +4.9%" (90-day index). Both correct, both labeled, still a double-take on every read. Evidence: book.tsx:262-300 vs :106-176; the in-code comment at book.tsx:253-261 acknowledges the risk and mitigates with labels rather than by removing one. |

**RD-09 (low) - WTI and Brent tiles are one story twice** (both -0.27% on the day; captions differ only in phrasing). Evidence: market-intelligence.tsx:171-177 and :199-205; digest Commodities group.

**RD-10 (low) - The sentiment tile restates its own visible inputs.** VIX contributes 44 of its 81 points and has its own tile; breadth (25 pts) is in the brief headline; momentum (13 pts) is the S&P strip delta. Adjacent tiles narrate the same input in opposite tones ("EXTREME GREED" beside "Normal volatility"). Evidence: digest sentiment.components; market-intelligence.tsx:299-330; architecture map obs 5.

**RD-11 (low) - Three "updated at" stamps and two session notes for one dataset.** All five derive from the same digest generation and the same closed session. Evidence: F14/F15 rows.

**RD-12 (low) - Top performer stated twice in incommensurable units.** ABNB +17.4% (hero, position return) and +64.1 bps (book, book contribution); nothing on screen relates the two. Evidence: todays-brief.tsx:346-354; book.tsx:327-335.

**RD-13 (info) - Dead payload: the digest ships slices no module renders.** `timeline`, `intelligence`, `threats` (the full list), `upcomingEvents`, `attribution`, `calibration`, `portfolioPulse.radar`, and the brief's `portfolioSummary` are all delivered to the client (79.7 KB digest) and never selected: grep of `useHomeSlice(...)` across `app/_home/modules` matches only attention, portfolioPulse, recommendedActions, symbolContext, opportunityFeed, watchlistIntelligence, changes, marketIntelligence, performance, equityCurve, fallbackBriefing, activity. This is information density's mirror image: bytes per rendered fact. (The server-side feeders legitimately consume threats/upcomingEvents pre-serialization; shipping them again to the client is the redundancy.) Evidence: digest.ts:289-316; grep results; home-provider.tsx:84,113.

**RD-14 (info) - The five-tile/five-row duplication is defended in comments on both sides** (radar.tsx:16-19, attention-queue.tsx:19-24: "deliberately a different scale... labelled so the same ticker carrying two numbers reads as two measurements"). The label solves the wrong problem: the issue is not that two numbers might be confused for one metric, it is that one metric is being shown twice. Section 2 is the proof; the single-mention map (F7-F11) is the fix.
