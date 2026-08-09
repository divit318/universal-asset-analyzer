# 01. Numerical Integrity and Reconciliation: the Today dashboard (`/`)

Audit date 2026-08-08, branch `f22/day-change`. Method: static trace of every number each of the seven modules renders, from render call site back to its engine, cross-checked against the live digest sample captured at 2026-08-07T21:39:48Z (`/tmp/home-digest.json`, `GET /api/home`). No code was modified. All arithmetic below was recomputed by hand from the live payload.

Formatter layers referenced throughout:

- `lib/format.ts` `formatPercent(v, digits=2)` (lib/format.ts:90-95), `roundForDisplay` (22-25), `formatCompact` (108-123, always 2 decimals on the mantissa), `toneClass` (45-48).
- `app/_home/_viz/format.ts` `fmtSignedPct(v, digits=1)` (21-24, delegates to formatPercent at 1 decimal, true minus), `fmtSignedMoney`/`fmtMoney` (27-37), `fmtTodayDate` (58-65, browser-local).
- `app/_home/_viz/stamped.tsx` `MetricDelta` (45-91), internal `signedPct` = formatPercent at `digits` (default 1), `shortSessionDate` (29-33), `shortTime` (36-38).
- Inline formatters: `fmtBps` (app/_home/modules/book.tsx:39-42, toFixed(1)), `Math.round(cashPct)` (book.tsx:282), `Math.round(item.score)` (attention-queue.tsx:243, 410), engine prose `toFixed(0)`/`toFixed(1)` (lib/portfolio/engines/recommend.ts:386, 390; lib/portfolio/engines/allocation.ts:229).

---

## Part 1. Findings

### NI-01 (critical) Top contributors do not reconcile to day P&L, and the gap has TWO causes, only one of which is display truncation

Live values: headline day P&L +1.1612% = 116.1 bps (`portfolioPulse.todayChangePct`); contributors ABNB +64.1, VOO +4.9, GOOGL -4.0 bps, visible sum 65.0 bps.

Cause 1, a real denominator mismatch (the leak):
- The headline percent is computed over the LIVE-QUOTED book only: `todayChange()` divides the day dollar move by `liveValue`, which sums only holdings with `valuation.mode === "market"` and a quote (lib/portfolio/report.ts:225-238). With cash at 32.9% and `todayChangeDollar` = $31,682.06, the implied live denominator is about $2.73M, roughly 67% of the $4.069M book.
- The contributor bps are computed over the WHOLE book's previous-close value: `prevCloseValue = totalValue - todayChangeDollar` = $4,037,506.92 (lib/home/pulse.ts:63, 71). Cash and manual assets are in this denominator.
- Consequence: even the COMPLETE contributor list can only sum to 31,682.06 / 4,037,506.92 = 78.5 bps, never to the headline 116.1 bps. 37.6 bps of the 51 bps gap is structural and would survive any number of rows.

Cause 2, truncation with no residual: `buildTopContributors` picks the top two positive plus the single largest negative (pulse.ts:78-83) and discards the rest. The discarded rows sum to 78.5 - 65.0 = 13.5 bps, which is larger than two of the three rows actually shown. There is no "others" residual row anywhere in `DayContributor` (lib/home/contracts.ts:110-118) or in the Book render (book.tsx:326-334).

Fix direction: (a) make the two computations share one denominator, either compute contributor bps over the same live-quoted previous-close value the headline uses, or label the headline as "priced book only" with its coverage; (b) emit an explicit residual row ("14 others +13.5 bps") from pulse.ts so the column visibly sums to the headline; (c) add a unit test asserting sum(contributors) + residual == todayChangePct in bps.

### NI-02 (high) Cash renders as 33% and 32.9% on the same screen, including inside a single queue row

Confirmed, four render paths, three precisions of one number (`weight` = 32.94954834440771):

| Surface | Text | Formatter | Evidence |
|---|---|---|---|
| Book card CASH stat | "33%" | `Math.round(d.cashPct)` | book.tsx:282; value from pulse.ts:277 (allocation cash slice weight, lib/portfolio/engines/allocation.ts:115) |
| Queue action headline | "Trim USD Cash from 33% to 20%" | `h.weight.toFixed(0)` | lib/portfolio/engines/recommend.ts:386 |
| Same queue row's rationale | "USD Cash is 32.9% of the portfolio..." | `h.weight.toFixed(1)` | recommend.ts:390 |
| Threat rationale / largestRisk / brief prose | "32.9%" | `h.weight.toFixed(1)` | lib/portfolio/engines/allocation.ts:229, surfaced via threats.ts:156-170, pulse.ts:275, and the brief's topRecommendation string (lib/home/brief.ts:75) which the model may quote |

The digest sample shows the headline/rationale disagreement inside ONE attention item (`action:trim:lot:CASH-USD`, /tmp/home-digest.json lines 119-120). All four trace to the same underlying number; the disagreement is purely formatting, so it is fixable purely in formatting.

Fix direction: one weight formatter (1 decimal below 10%, integer at or above 10%, or simply always 1 decimal) exported from lib/format.ts and used by recommend.ts titles, book.tsx, and allocation.ts messages. AGENTS.md already mandates lib/format.ts as the single formatter home.

### NI-03 (high) Annualized XIRR pair (+68.6% vs SPY +29.6%) sits directly above a 90-day chart (+9.7% vs +4.9%) and the annualization label disappears exactly when it is most needed

- The chart IS window-labelled: "90-day vs SPY" (book.tsx:305-306, EQUITY_CURVE_DAYS = 90, lib/home/equity-curve.ts:38).
- The XIRR block is labelled "Return (XIRR)" (book.tsx:264) but the qualifier "annualized, money-weighted" renders ONLY in the no-benchmark branch (book.tsx:295). When a benchmark exists, the line reads "vs SPY +29.6%, excess +39.0%" (book.tsx:288-293) with no "/yr", no "annualized", and no holding-period disclosure.
- So SPY appears twice on one card, +29.6% and +4.9%, six times apart, with nothing visible explaining that one is an annualized money-weighted replication since inception and the other is a 90-day cumulative index. (The product owner's "68.7%" is actually rendered "+68.6%": 68.63 at fmtSignedPct's 1 decimal.)
- The annualization itself is fragile: `holdingDays` = 95, only 5 days above `MIN_DAYS_TO_ANNUALIZE` = 90 (lib/portfolio-performance.ts:36, re-exported at lib/home/contracts.ts:537; gate applied at lib/home/digest.ts:129-130 and 144-145). A 95-day +14.5% cumulative move is being extrapolated by ~3.8x to +68.6%/yr with no on-card indication that the portfolio is one quarter old.

Fix direction: always render the qualifier ("annualized, since May 4" or "/yr, 95 days held") including in the benchmark branch; consider suppressing the vs-SPY XIRR line while holdingDays is within, say, 1.5x of the gate, or footnoting the holding period next to the number.

### NI-04 (high) Brief says "Actions 1", the queue says "19 open", the prose says "3 unread"; three different collections narrated as one concept, and the CTA wiring makes it worse

- KPI "Actions" = `recommendedActions.actions.length` (todays-brief.tsx:170: `actions.data?.actions.length ?? 0`; rendered at 294-299). Live: 1 (the single decision-engine card, digest `recommendedActions.actions`).
- Queue "19 open" = attention items after dedupe/dismissals (attention.ts:438 `openCount: items.length`; re-derived client-side as `liveItems.length` at attention-queue.tsx:472, rendered at 616-618). Live: 19, of which exactly ONE is kind "action" (the same trim-cash decision, seeded via seedsFromActions, attention.ts:201-225).
- Prose "3 unread": `notifications.filter((n) => !n.read).length` (digest.ts:318), rendered by `deterministicBriefing` as "3 unread notifications" (brief.ts:108-110). The AI variant plausibly says "three unread alerts" because the prompt labels this count "UNREAD ALERTS: 3" (brief.ts:151) even though it counts notifications, a vocabulary bug baked into the prompt itself.
- The wiring problem: the hero's primary button "Open Action Center" (todays-brief.tsx:372-378) scrolls to `id="action-center"`, which is the ATTENTION QUEUE's root div (attention-queue.tsx:610). So the user reads "Actions 1", clicks the button named Action Center, and lands on a surface headed "Attention, 19 open".

Verdict: not a correctness bug in any single counter (each is right for its own collection), but the labelling is not defensible as shipped: the KPI named "Actions" and the anchor named "action-center" point at different collections. Fix direction: rename the KPI to "Recommended actions" or count the queue's action-kind items; rename the CTA to "Open Attention Queue" or re-anchor it; fix the prompt label at brief.ts:151 from "UNREAD ALERTS" to "UNREAD NOTIFICATIONS".

### NI-05 (high) "Extreme Greed" beside "Normal volatility (fear index)": two hardcoded interpretations of the same VIX level, plus a self-contradictory caption on the sentiment tile itself

Confirmed real, and it is one input read through two different anchor sets:

- Sentiment gauge: `scoreVolatility` maps VIX linearly with anchors LOW=12 (score 100) and HIGH=35 (score 0) (lib/home/sentiment.ts:59-64). VIX 14.9 scores 87.4/100 greed, weighted 0.5, contributing 44 of the 81 total (sentiment.ts:105-107, 121; digest components line: value 14.9, contribution 44). Score 81 > 75 labels "Extreme Greed" (sentiment.ts:85).
- VIX tile caption: hardcoded bands <14 low, <20 normal, <30 elevated (app/_home/modules/market-intelligence.tsx:151-160). VIX 14.9 lands in "Normal volatility (fear index)."
- The sentiment tile's own caption blends both: `sentimentCaption("Extreme Greed", 14.9)` returns "Markets are euphoric with normal volatility." (market-intelligence.tsx:275-297), a single sentence asserting euphoria and normality from the same number.
- The tile also shows VIX down -1.65% on the day (MetricDelta, digits 2), which reads as "fear falling" next to a caption that refuses to say fear is low.

So the contradiction is not an accident of two data sources; it is two threshold tables (12/35 linear vs 14/20/30 banded) for one number, in two files, with no shared constant. Fix direction: define one VIX interpretation module (bands AND the greed mapping derived from the same anchors) in lib/home/sentiment.ts or a sibling, and have the tile caption consume it; make the caption for a sub-15 VIX say "low" whenever the gauge is scoring it above ~80 greed, or soften the gauge label bands. Single-clock note: both readings do use the same quote (one `getQuotes` batch, market-intel.ts:143, 178-186), so only the interpretation needs unifying, not the data path.

### NI-06 (high) Contributor sum can NEVER be checked by a user because no total, residual, or denominator statement is rendered

Follow-on from NI-01 but a distinct UI defect: the Book card renders "Top contributors (today)" (book.tsx:326) with three bps rows and no total row, no "of the priced book" note, and no link between the +1.2% two bands up and the 65 bps here. 116 bps vs 65 bps is a 44% visible shortfall with zero on-screen explanation. The docstring in contracts.ts:104-109 correctly defines bps as "contribution to the book's day move in bps of previous-close value", but that definition never reaches the screen. Fix direction: residual row plus a footer "sums to +78 bps of the whole book; headline +116 bps is over the live-priced 67%", or unify per NI-01.

### NI-07 (medium) Health factor decomposition does not sum to the number it explains, while the code comments claim it "genuinely adds up"

Live `healthFactors.contributionPts`: 16.8 + 9.9 + 9.1 + 6.2 + 6.2 + 5.1 + 4.6 + 3.3 + 3.0 + 3.0 + 0.4 = 67.6 vs `healthScore` 68 (both from lib/home/pulse.ts:176 and :260). Each row is rounded to 0.1 (`Math.round(x*10)/10`, pulse.ts:176) and the total is the engine's separately rounded integer `health.total`. The explain popover renders "Contributes 16.8 of the total" per row (lib/home/explain.ts:149-154) under a headline "68/100" and a docstring asserting the rows "genuinely add to the number on screen" (explain.ts:130-132, echoed at pulse.ts:164-167). They add to 67.6. The 0.4 gap is rounding, not arithmetic error, but the surface promises exactness.

Fix direction: either render one decimal on the headline inside the popover ("67.6 rounded to 68"), or add a footer line "rows sum to 67.6; the headline rounds the exact total", or carry `totalExact` into the pulse contract and show it in the popover.

### NI-08 (medium) Sentiment components sum to 82, the score says 81, and the popover renders a 0.618% momentum reading as "1"

- Components are independently rounded (`Math.round(score * weightShare)`, sentiment.ts:121): 44 + 25 + 13 = 82; the score rounds the unrounded sum 43.7 + 24.6 + 13.1 = 81.4 to 81 (sentiment.ts:105-107). The gauge's stated purpose is auditability ("so the number is auditable rather than magic", contracts.ts:65) and the audit fails by 1.
- `explainSentiment` displays each component's raw value as `Math.round(c.value)` (explain.ts:192): the S&P momentum input 0.6184 (a percent change) renders as "1", and VIX 14.9 renders as "15". A "1" with no unit explaining a +13 contribution is unreadable.

Fix direction: round components off the running remainder (largest-remainder method) so they sum to the score; format component values with unit-appropriate precision (VIX 14.9, breadth 82%, momentum +0.62%).

### NI-09 (medium) The decision impact triple "Health 68 -> 71.1 (+3.3)" is internally inconsistent by 0.2 points

`healthBefore` is the rounded integer total 68 (lib/home/actions.ts:50), `healthAfter` is computed from the UNROUNDED exact total: `round((healthExact + delta) * 10) / 10` = 71.1 (actions.ts:51, 81), and the displayed delta is the engine's exact 3.278 shown as +3.3 (attention-queue.tsx:271-277). On screen: 68 + 3.3 = 71.3, but the card says 71.1, because the true base is 67.8. Live values from the digest: healthBefore 68, healthAfter 71.1, healthDelta 3.2780. The same rounded/exact mix also feeds explainDecision's "Portfolio health 68 -> 71.1" line (explain.ts:218).

Fix direction: display before at the same 0.1 precision as after (67.8 -> 71.1), or compute after as displayed-before + rounded-delta for display purposes only. Any one consistent choice removes the visible 0.2 discrepancy.

### NI-10 (medium) Five different definitions of "today" coexist; a US-evening build makes them disagree

Enumerated clocks, with the disagreement window (any time local date != UTC date, i.e. every evening in the Americas after 5-8pm ET, and every morning east of UTC):

1. Digest calendar window: `new Date().toISOString().slice(0, 10)`, UTC (lib/home/digest.ts:207). At 20:01 ET on Aug 7, "today" is 2026-08-08, so Aug 7's events (live sample: the US Employment Report and the MA dividend, both dated 2026-08-07 and currently ranked in the queue at score 54.8) fall out of the `e.date >= today` filter (digest.ts:213) and silently vanish from Upcoming Events, the timeline, AND the attention queue while the user's wall clock still says Aug 7.
2. Brief grounding facts: LOCAL server date via getFullYear/getMonth/getDate (lib/home/brief.ts:182-184). "Today" claims in AI prose are verified against the server's local day while the digest's windows use UTC.
3. Metric session state: LOCAL runtime date (lib/metric.ts:94-98). Server-local during pulse/sessionNote construction (pulse.ts:209, 225-230), BROWSER-local when MetricDelta re-evaluates at render (stamped.tsx:67). A digest built server-side at 19:59 and rendered in a browser after midnight local flips "current" to "previous" between two consumers of the same Metric.
4. Exchange-timezone session date: `dateInZone(asOf, exchangeTimezone)` (lib/day-change.ts:64-76, 94). This is the correct clock, and it is the one the other four should be compared against.
5. Page chrome: `fmtTodayDate` uses the browser's local date (app/_home/_viz/format.ts:58-65; consumed by home-header.tsx:34 and market-intelligence.tsx:363-365).

Fix direction: a single `todayFor(context)` helper: exchange-TZ for session claims (already exists in day-change.ts), viewer-local for chrome, and pick ONE (documented) for server-side windows; the calendar filter should use the US-Eastern trading date, not UTC, so events do not expire at 8pm ET.

### NI-11 (medium) Event urgency treats a date-only catalyst as occurring at midnight UTC

`computeUrgency` does `Date.parse(occursAt)` on strings like "2026-08-13" (attention.ts:143), which is midnight UTC, i.e. 8pm ET the previous evening. Verified against the live payload: the CPI event's urgency 0.3171 back-solves exactly to hours = (Aug 13 00:00 UTC - Aug 7 21:39 UTC) = 122.4h through the ramp formula at attention.ts:150. Consequences: every dated event hits maximum urgency (<= 24h ramp, attention.ts:147) a full US-evening early, and the `at >= now - DAY` feeder filter (attention.ts:288-291) keeps events for ~24h after UTC midnight, i.e. drops them at 8pm ET on their own calendar day. The timeline's synthetic "T12:00:00.000Z" timestamps (digest timeline items) use a different convention (noon UTC) for the same dates, so the queue and the timeline age the same event on two clocks.

Fix direction: normalize date-only catalysts to a canonical instant (exchange close, or noon exchange-TZ, matching the timeline's convention) in one place before parsing.

### NI-12 (medium) Two independent rebuilds of the same total-return figure ship in one payload

`portfolioPulse.totalReturnOnCostPct` = 3.0763621316651557 comes from the report step (`report.totalReturn` <- `performance.total.pct`, lib/portfolio/report.ts:341, pulse.ts:283). `performance.totalReturnPct` = 3.076362131665155 comes from the digest's separate `buildPerformance()` step with its OWN quote fetches (digest.ts:76-154, value at :140, also `perf.total.pct`). They differ in the last float digit already, proving they are independently computed, and they are only equal because the two quote fetches hit the same 15s cache window. contracts.ts:180-192 documents the historical population divergence this caused ("-7.3%" vs "-0.1%" on one screen). The current Book card renders only one of them at a time (XIRR non-null hides the fallback, book.tsx:264-277), so there is no live on-screen conflict today, but the payload carries a latent one: a quote moving between the two plan steps re-opens the exact bug the contract note describes.

Fix direction: have the digest's performance summary read `report.performance` (the report step already built the full block, report.ts:288, 374) instead of rebuilding it; delete `buildPerformance` from digest.ts or reduce it to a projection.

### NI-13 (medium) The page has no single percent-precision policy; three formatter layers plus engine prose produce four precisions

Observed precisions for percentages on one screen: 0 decimals (cash 33%, trim title 33%, coverage "prices 95% of book", breadth 82%), 1 decimal (all portfolio deltas via fmtSignedPct/MetricDelta default, cash 32.9% in engine prose, held-weight chips 3.3%), 2 decimals (entire market tape, `digits={2}` at market-intelligence.tsx:117, 257). The 1-vs-2 split between portfolio and market numbers may be a deliberate convention, but it is written down nowhere, and the 0-vs-1 split on cash is demonstrably accidental (NI-02). `fmtSignedPct`'s own docstring restricts it to non-session quantities (viz/format.ts:14-19) and that restriction IS honored (session figures go through MetricDelta), which shows a policy can be enforced here when stated.

Fix direction: write the precision table into app/_home/_viz/format.ts as the enforced default set (portfolio pp: 1dp; market tape: 2dp; weights: one rule per NI-02; counts: integers) and grep-gate new `toFixed(` in app/_home/modules.

### NI-14 (medium) The prompt hands the model a pre-rounded "+1.2%" but grounds it against the unrounded value, and day P&L reaches the screen through three different code paths

The same `todayChangePct` renders as: (1) hero KPI via `fmtSignedPct(useCountUp(p.todayChangePct))` (todays-brief.tsx:187, 278), (2) Book card via `MetricDelta` on a reconstructed Metric (book.tsx:236-240), (3) AI prose via the prompt's `toFixed(1)` (brief.ts:136) transcribed by the model. All three come from the one field (pulse.ts:263 <- report.ts:344), so today they agree at "+1.2%"; this is a same-expression duplicate, not a re-derivation, PROVEN by: pulse is the only writer, and both client renders read `portfolioPulse.todayChangePct` from the same context (home-provider slices). Residual risks: the count-up animation renders transient in-between values for ~1s (use-count-up.ts), and path (3) depends on model transcription, defended only by the grounding gate (brief.ts:332-333). The hero KPI also drops the Metric stamp entirely (bare number through fmtSignedPct while the Book card stamps the identical figure), which is exactly the "new bare-number day-change call site" viz/format.ts:17-19 calls a regression.

Fix direction: render the hero "Today" KPI through MetricDelta (or at minimum pass the pulse sessionDate), and keep prompt precision equal to display precision (it already is; assert it in a test).

### NI-15 (low) Excess return is a difference of two independently rounded rates, and 1-decimal display can make the visible arithmetic fail

`outperformancePct = round4(portfolioXirr - benchXirr)` on ratios (lib/portfolio-performance.ts:548), where each XIRR was itself already round4'ed by the solver (portfolio-performance.ts:313, 317, 342-344). Live: 0.6863 - 0.2963 = 0.3900 exactly, so "excess +39.0%" is not an integer anomaly; fmtSignedPct renders it with the same 1 decimal as its neighbours (book.tsx:292). The claim that excessPct is integer-styled while others carry decimals is REFUTED; 39 is the true rounded value and displays as "+39.0%". Two residual nits: (a) at 1dp the displayed identity can break by 0.1 (e.g. 68.64 - 29.58 = 39.06 displays +68.6, +29.6, +39.1); (b) `benchmarkPct` arrives as 29.630000000000003 (float artifact of ratio x 100 at digest.ts:125), harmless after formatting but visible to any API consumer.

Fix direction: compute excess for display from the display-rounded operands, or display all three at 2dp; round percents once at the digest boundary (`Math.round(x*100)/100`) to clean the wire values.

### NI-16 (low) "+1.0pp volatility" is listed under "expectedImprovement" and rendered untoned, leaving the sign's meaning ambiguous

The live decision card's `expectedImprovement` reads "+3.3 health points, +1.0pp volatility, better diversified" and `impact.riskDeltaPp` = 1 (positive = MORE volatility, per contracts.ts:427 "Negative = less risky"). The spotlight renders "vol +1.0pp" with no tone (attention-queue.tsx:279-283), while explainDecision correctly treats positive as adverse (`direction: im.riskDeltaPp < 0 ? 1 : -1`, explain.ts:227). So one surface knows +1.0pp is bad and the adjacent string sells it inside an "improvement" list. This is an engine-prose labelling issue surfaced verbatim (lib/home/actions.ts:69 passes `expectedBenefit` through).

Fix direction: the engine's benefit string should sign-qualify ("accepts +1.0pp volatility"), or the spotlight should tone the vol chip with the same rule explain.ts uses.

### NI-17 (low) Baseline-vs-live counts sit adjacent without a bridge: "3 of the 20 attention items" next to "19 open"

The change feed's resolved entry says 3 of the 20 items from the last visit cleared (digest changes, id `attn-resolved`), while the queue header says 19 open. 20 - 3 = 17, not 19, because 2 new items also arrived (the two `attn-new` entries). All three numbers are individually correct against their own snapshots (lib/home/changes.ts fingerprint diff; attention.ts:438), but no surface states the reconciliation 20 - 3 + 2 = 19. A user checking the arithmetic fails.

Fix direction: have the resolved-items detail include the net ("3 cleared, 2 new, 19 now open"), which the diff engine already has the terms for.

### NI-18 (low) Queue priority scores are server-rounded to 0.1 then client-rounded to integers, colliding distinct scores

`scoreSeed` rounds to 0.1 (attention.ts:129: 73.4, 66.8, 66.4, 64.7...), then every render does `Math.round(item.score)` (attention-queue.tsx:243, 410): SYF 66.8 shows 67, ALL and TSM 66.4 show 66, BAC and SCHW 64.7 both show 65. Meanwhile the change feed's prose fixes a third precision ("A signal scoring 66 entered the Attention Queue", changes detail) computed at diff time. Ranking is done on the unrounded-to-integer values so order is right; only the displayed ties are false ties. Cosmetic, but the explain popover then shows a formula whose inputs reproduce 66.4, not the on-screen 66.

Fix direction: display one decimal in the rail, or round once server-side to integers everywhere including the change feed.

### NI-19 (low) The 90-day equity-curve window is measured in UTC calendar days and can be 88-90 trading-calendar days depending on build hour

`computeEquityCurve` derives the window start as `today(UTC) - 90 * 86_400_000` (equity-curve.ts:76-79) and the first point is the first BENCHMARK trading day at/after that instant (live: 2026-05-11 to 2026-08-07, 88 calendar days). `portfolioPct = last.portfolio - 100` (equity-curve.ts:195) is correct for the plotted window, and the card label "90-day" (book.tsx:306) is the requested, not the delivered, window. Off-by-a-couple-days is immaterial to the number but the label overstates precision, and the UTC "today" inherits NI-10's evening shift (an evening-ET build ends the curve on a day the viewer's calendar has not reached).

Fix direction: label from the actual endpoints ("May 11 - Aug 7") or accept as-is with a documented tolerance.

### NI-20 (low) Market Overview's header date is browser-local while every figure below is a stamped prior-session close

Subtitle composes `fmtTodayDate("short")` (viewer-local calendar day) + digest `generatedAt` time + a shared session note (market-intelligence.tsx:360-370). After a UTC/local rollover the header can read "Sat, Aug 8" above figures whose one session note says "Showing Fri, Aug 7 close"; correct but momentarily confusing, and dependent on `sharedSessionNote` finding EVERY previous-session ticker on the same date (market-intelligence.tsx:74-84), which mixed-region tapes (Nikkei asOf 06:45 UTC vs BTC 21:39 UTC in the live sample) satisfy today only because sessionDate, not asOf, is compared.

Fix direction: none urgent; consider rendering the session date, not the wall date, as the card's primary date when markets are closed.

### NI-21 (low) `worstPerformer` ranks by percent while contributors rank by dollars, so "Weakest" (AMD -1.21%) and the largest drag (GOOGL -$1,605) are different names two cards apart

Movers sort on `dayChange.value` percent (pulse.ts:217): AMD -1.21% is "Weakest" in the hero (todays-brief.tsx:356-364) while the Book card's only negative contributor row is GOOGL -4.0 bps = -$1,605 (GOOGL's dollar drag exceeds AMD's -$1,416). Both are correct measurements with different bases; neither label states its basis. Fix direction: caption the hero mover with its basis ("worst % move") or align both on contribution.

---

## Part 2. Product-owner claims: verdicts

| Claim | Verdict | Evidence |
|---|---|---|
| (a) Cash renders as both 33% and 32.9% | CONFIRMED, and worse: both precisions appear inside one queue row | NI-02; book.tsx:282 vs recommend.ts:386/390, allocation.ts:229; digest lines 119-120 |
| (b) Top contributors ~65 bps do not reconcile to day P&L ~120 bps | CONFIRMED (116.1 bps vs 65.0 shown); truncation explains only 13.5 bps; a real denominator mismatch explains 37.6 bps; no residual row exists | NI-01, NI-06; report.ts:225-238 vs pulse.ts:63,71,78-83 |
| (c) 68.7% vs SPY 29.6% above a 90-day chart labelled 9.7%/4.9% with no window labels | LARGELY CONFIRMED: displayed value is +68.6% not 68.7; the CHART is window-labelled ("90-day vs SPY", book.tsx:306) but the XIRR pair loses its "annualized" qualifier exactly when the benchmark renders (book.tsx:288-295), and the 95-day holding period is disclosed nowhere | NI-03 |
| (d) Brief says Actions 1 while queue says 19 open and prose says three unread alerts | CONFIRMED; three distinct collections (1 engine decision, 19 attention items, 3 unread notifications mislabelled "ALERTS" in the prompt), and the "Open Action Center" CTA anchors to the 19-item queue | NI-04; todays-brief.tsx:170,296,372-378; attention-queue.tsx:610,616; brief.ts:151; digest.ts:318 |
| (e) Extreme Greed beside Normal volatility | CONFIRMED; same VIX quote, two unshared threshold tables (12/35 linear vs 14/20/30 bands), and the sentiment tile's own caption says "euphoric with normal volatility" | NI-05; sentiment.ts:59-64,85 vs market-intelligence.tsx:151-160,275-297 |

---

## Part 3. Number inventory

Columns: source chain is engine -> digest slice -> render site. "Window" is the time basis the number describes. Pass = value, formatting, labelling and reconciliation all defensible; flags reference findings.

### Module 1: Today's Brief (hero), app/_home/modules/todays-brief.tsx

| # | Display (live) | Source chain | Formatter / precision | Window | Verdict |
|---|---|---|---|---|---|
| 1 | Portfolio Value "$4.07M" | report.ts:283 totalValue -> pulse.ts:262 -> todays-brief.tsx:275 | fmtMoney -> formatCompact, 2dp mantissa; useCountUp animated | snapshot 21:39:48Z | PASS (transient count-up values, NI-14) |
| 2 | Today "+1.2%" | report.ts:225-238 todayChange (live-priced book) -> pulse.ts:263 -> todays-brief.tsx:278 | fmtSignedPct 1dp over useCountUp | session 2026-08-07 | FAIL: denominator excludes 33% of book, unstated; bare number, no Metric stamp (NI-01, NI-14) |
| 3 | Today caption "+$31.68K" | report todayChangeDollar -> pulse -> todays-brief.tsx:280 | fmtSignedMoney, compact 2dp | session 2026-08-07 | PASS |
| 4 | Grade "C 68" | health engine total/grade -> pulse.ts:260-261 -> todays-brief.tsx:289 | raw int + string | snapshot | PASS (same field as Book ring: same expression, pulse is sole writer) |
| 5 | Actions "1" | actions.ts buildRecommendedActions -> todays-brief.tsx:170, 296 | String(int) | live | FAIL labelling (NI-04) |
| 6 | Chip "6 changes, 4 new" | changes.ts diff -> todays-brief.tsx:143-151, 242-251 | ints; fresh = tone==="new" count | since baseline 19:23Z | PASS (verified: 6 entries, 4 with tone new) |
| 7 | "Ns read" | readingTime, todays-brief.tsx:42-46 | words/200wpm, floored 15s | n/a | PASS |
| 8 | Brief time "2:39 PM" style | brief.generatedAt -> todays-brief.tsx:259-266 | Intl local time | generation time | PASS |
| 9 | Regime "neutral" | ctx regime -> marketIntelligence.regime.trend -> todays-brief.tsx:171, 223 | string | scanner snapshot | PASS |
| 10 | Session note "Markets closed, Fri, Aug 7 close" | pulse.ts:225-230 | Intl UTC-formatted session date | prior session | PASS |
| 11 | Top "ABNB +17.4%" | report dayMoves -> pulse bestPerformer (sorted by pct, pulse.ts:217) -> todays-brief.tsx:346-353 | MetricDelta 1dp, stamped | session 2026-08-07 | PASS |
| 12 | Weakest "AMD −1.2%" | same, tail of sort -> todays-brief.tsx:356-364 | MetricDelta 1dp | session | PASS value; basis unlabelled vs dollar-based contributors (NI-21) |
| 13 | Prose numbers: "82% of sectors", "grade C (68/100)", "3 unread notifications" (fallback) / model transcriptions (AI) | deterministicBriefing brief.ts:94-111 or model output gated by verifyGroundingWithFacts brief.ts:332 | prose; prompt pre-rounds today to 1dp (brief.ts:136) | mixed | PARTIAL: fallback exact; AI path transcription-dependent; "UNREAD ALERTS" prompt mislabel (NI-04) |

### Module 2: Portfolio Health / Book, app/_home/modules/book.tsx

| # | Display (live) | Source chain | Formatter / precision | Window | Verdict |
|---|---|---|---|---|---|
| 14 | Ring "C" + "68 / 100" | health.total/grade -> pulse -> HealthRing book.tsx:46-72, 221 | raw ints; arc = score/100 | snapshot | PASS (dupe of #4, same expression) |
| 15 | Day P&L "+1.2%" | pulse.todayChangePct -> book.tsx:236-240 | MetricDelta 1dp, stamped, sessionDate carried | session 2026-08-07 | PASS as dupe of #2 (same field, MetricDelta path); inherits #2's denominator flag |
| 16 | "+$31.68K" | pulse.todayChangeDollar -> book.tsx:241-243 | fmtSignedMoney | session | PASS (dupe of #3) |
| 17 | "Fri, Aug 7" | pulse.sessionDate -> book.tsx:245-247 | shortSessionDate (UTC-safe noon parse) | session | PASS |
| 18 | Header "Updated 2:39 PM" | pulse.asOf -> book.tsx:201-206 | shortTime local | build time | PASS |
| 19 | "Return (XIRR) +68.6%" | portfolio-performance.ts:698 xirr (round4 ratio) -> digest.ts:125-130 x100, gate holdingDays>=90 -> book.tsx:264-268 | fmtSignedPct 1dp | since first lot, 95d, ANNUALIZED | FAIL labelling: annualized qualifier absent in benchmark branch; 95d barely clears MIN_DAYS_TO_ANNUALIZE=90 (NI-03, NI-06 gate at portfolio-performance.ts:36) |
| 20 | "vs SPY +29.6%" | benchmarkComparison portfolio-performance.ts:505-550 -> digest.ts:144-152 -> book.tsx:291 | fmtSignedPct 1dp | same flows replicated in SPY, annualized | FAIL labelling (NI-03); wire value 29.630000000000003 (NI-15) |
| 21 | "excess +39.0%" | round4(portXirr - benchXirr) portfolio-performance.ts:548 -> digest.ts:150 -> book.tsx:292 | fmtSignedPct 1dp | annualized gap | PASS arithmetic (0.6863-0.2963=0.3900 exact); display-identity nit NI-15 |
| 22 | Cash "33%" | allocation.ts:115 cash slice weight -> pulse.ts:277 -> book.tsx:282 | Math.round, 0dp | snapshot | FAIL precision conflict (NI-02) |
| 23 | Label "90-day vs SPY" | EQUITY_CURVE_DAYS equity-curve.ts:38 -> book.tsx:305-306 | constant | 90 requested / 88 delivered calendar days | PASS with NI-19 nit |
| 24 | Curve endpoint "+9.7%" | computeEquityCurve flow-adjusted index, portfolioPct = last-100 (equity-curve.ts:157-176, 195) -> book.tsx:164-167 | fmtSignedPct 1dp | 90d window, UTC boundaries | PASS (NI-19 clock nit) |
| 25 | Curve endpoint "+4.9%" | benchmark index equity-curve.ts:174, 196 -> book.tsx:169-172 | fmtSignedPct 1dp | 90d | PASS; SPY double-appearance flagged NI-03 |
| 26 | Coverage caption (suppressed, coveragePct=100) | equity-curve.ts:198 -> book.tsx:307-311 | int %, renders only <95 | window end | PASS |
| 27 | "ABNB +64.1 bps" | pulse.ts:57-84 buildTopContributors, bps = dayDollar/prevCloseValue x 10000 -> book.tsx:326-334 | fmtBps toFixed(1) (book.tsx:39-42) | session, WHOLE-book denominator | FAIL reconciliation (NI-01, NI-06) |
| 28 | "VOO +4.9 bps" | same | same | same | FAIL (same) |
| 29 | "GOOGL −4.0 bps" | same | same | same | FAIL (same); sum 65.0 vs headline 116.1 |

### Module 3: What Changed, app/_home/modules/whats-changed.tsx

| # | Display (live) | Source chain | Formatter / precision | Window | Verdict |
|---|---|---|---|---|---|
| 30 | Baseline "today 12:23 PM" style | changes.baselineAt -> whats-changed.tsx:43-49, 108 | local time; local day-diff | since 19:23Z | PASS (local clock, NI-10 family) |
| 31 | Chip/detail "A signal scoring 66 entered..." (x2) | changes.ts diff of attention snapshot | int score in prose | baseline vs build | PASS; third precision of queue score (NI-18) |
| 32 | "New idea: ... (79)" (x2) | opportunity combinedScore in prose | int | scanner snapshot | PASS |
| 33 | "3 queue items cleared" / "3 of the 20 attention items" | fingerprint diff | ints | baseline 20 vs live 19 | PARTIAL: no bridge to "19 open" (NI-17) |
| 34 | Overflow "Details (+1)" | changes.length - 5 (whats-changed.tsx:27, 130-131) | int | n/a | PASS |

### Module 4: Attention Queue, app/_home/modules/attention-queue.tsx

| # | Display (live) | Source chain | Formatter / precision | Window | Verdict |
|---|---|---|---|---|---|
| 35 | "19 open" | attention.ts:426-438 items -> client liveItems.length attention-queue.tsx:472, 616-618 | int; client recomputes minus optimistic dismissals | build time | PASS (client and server agree at paint; 19 = 19 items verified) |
| 36 | Spotlight Priority "73" | scoreSeed attention.ts:120-130 (73.4) -> Math.round attention-queue.tsx:243 | 0.1 server, int client | live | PASS with NI-18 |
| 37 | Row scores 67, 66, 66, 65, 65, 62, 55, 55 | same -> attention-queue.tsx:410 | int | live | PASS; false ties at 66 and 65 (NI-18) |
| 38 | "Health 68 -> 71.1 (+3.3)" | actions.ts:50-51, 81 -> attention-queue.tsx:271-277 | before int, after 0.1, delta toFixed(1) | simulated | FAIL internal consistency by 0.2 (NI-09) |
| 39 | "vol +1.0pp" | impact.riskDeltaPp -> attention-queue.tsx:279-283 | toFixed(1), sign glyph manual | simulated | PARTIAL: sign semantics untoned (NI-16) |
| 40 | "6 alternatives simulated" | decision.alternativesEvaluated -> attention-queue.tsx:289-291 | int | engine run | PASS |
| 41 | "11 more items" | filtered.length - MAX_VISIBLE(8), attention-queue.tsx:59, 607, 732 | int | live | PASS (19-8=11) |
| 42 | Rationale figures: "32.9%", "+11.4% today", "81/100", "29% below", "-2.6% per 1pp", "1.0 yrs", "0.7%/0.8%" | engine prose passed verbatim (recommend.ts, allocation.ts:229, threats.ts:54,70,131, alert engine) | engine toFixed, mixed 0-1dp | mixed | PARTIAL: precisions inherited from engines (NI-02, NI-13); "today" inside a stored alert string is not session-stamped |
| 43 | Context chip "3.3% of book" (LLY event row) | symbolContext heldWeightPct -> attention-queue.tsx:179 | toFixed(1) | snapshot | PASS |
| 44 | Score popover "50% -> x0.87" terms | explainAttentionScore explain.ts:66-90 | pct int + multiplier 2dp | live | PASS (reproduces 66.4 not the displayed 66; NI-18) |

### Module 5: Radar, app/_home/modules/radar.tsx

| # | Display (live) | Source chain | Formatter / precision | Window | Verdict |
|---|---|---|---|---|---|
| 45 | Fit "80" (SYF), 79, 79, 75, 75 | rankByFit combinedScore -> opportunityFeed -> radar.tsx:137 | Math.round int | scanner snapshot (freshness "1h ago" shipped) | PASS; staleness only surfaces at level "stale" (radar.tsx:245-247), "aging" is silent |
| 46 | Reason "fit 72/100", "10.0% allocation", "quality N/100" | fitSummary/fitDetail/absoluteScore (radar.tsx:57-61) | engine ints/1dp | scanner | PASS |
| 47 | Footer "1 buys, 1 near-buys" | watchlistIntelligence buckets -> radar.tsx:184-187, 259-262 | ints | build | PASS (grammar nit: "1 buys" avoided by conditional, verified radar.tsx:260) |
| 48 | Fit popover "83 x 0.6 / 76 x 0.4" | explainOpportunityScore explain.ts:98-126 | ints x weights | scanner | PASS (0.6 x 83 + 0.4 x 76 = 80.2 -> 80 matches) |

### Module 6: Market Overview, app/_home/modules/market-intelligence.tsx

| # | Display (live) | Source chain | Formatter / precision | Window | Verdict |
|---|---|---|---|---|---|
| 49 | Index strip: S&P 7,757.64 +0.62%, Nasdaq 26,690.62 +1.30%, Dow 54,036.93 +0.28%, FTSE 10,901.09 +0.31%, Nikkei 65,606.71 −0.12% | getQuotes batch -> market-intel.ts:160-176 -> IndexStrip market-intelligence.tsx:99-129 | fmtLevel 2dp; MetricDelta digits=2 | each ticker's own session 2026-08-07, asOf spans 06:45Z-21:39Z | PASS; per-figure stamps suppressed under one session note (correct per sharedSessionNote:74-84) |
| 50 | VIX "14.90", "−1.65%", caption "Normal volatility (fear index)." | quote -> tile spec market-intelligence.tsx:145-161 | fmtLevel 2dp; delta 2dp; hardcoded bands 14/20/30 | session | FAIL adjacency/interpretation (NI-05) |
| 51 | Sentiment "EXTREME GREED", thumb at 81, caption "Markets are euphoric with normal volatility." | computeSentiment sentiment.ts:92-124 (VIX 14.9 -> 87.4, breadth 82, momentum 0.62 -> 65.5; weighted 81.4 -> 81) -> SentimentTile market-intelligence.tsx:299-330 | label + score-positioned thumb; caption blends two threshold tables | build | FAIL (NI-05); components 44+25+13=82 vs 81 (NI-08) |
| 52 | 10Y "4.66%", −0.21% | ^TNX quote (provider pre-scaled, market-intelligence.tsx:163-169) | fmtLevel 2dp + % | session | PASS |
| 53 | Gold "4,401.30" +2.37%; WTI 77.08 −0.27%; Brent 82.27 −0.27%; DXY 99.60 −0.33%; BTC 64,982.60 +0.92% | quotes -> tiles | fmtLevel 2dp; deltas 2dp | session | PASS |
| 54 | Sparklines (7 tiles, ~23 points) | getHistory 30d market-intel.ts:100-122 | unlabelled minirange | trailing 30 calendar days | PASS (no axis claim made) |
| 55 | Subtitle "Global markets at a glance, Fri, Aug 7, 2:39 PM" | fmtTodayDate(browser-local) + digest generatedAt market-intelligence.tsx:360-370 | local date + local time | wall clock vs build | PASS with NI-20 |
| 56 | Breadth "82% of sectors advancing" (regime summary prose, also participation pill "Broad participation" in Module 7) | ctx.regime.breadthPct -> regime.summary; pill threshold >=55 ai-investment-brief.tsx:145-150 | int | scanner snapshot | PASS (thresholds documented to match Market Pulse) |

### Module 7: AI Investment Brief, app/_home/modules/ai-investment-brief.tsx

| # | Display (live) | Source chain | Formatter / precision | Window | Verdict |
|---|---|---|---|---|---|
| 57 | Regime word "Neutral" + participation pill | market.regime.trend / breadthPct -> ai-investment-brief.tsx:128-150, 324-325 | mapped strings | scanner | PASS |
| 58 | Note prose numbers (all sections) | model output from prompt facts (brief.ts:119-169), grounding-gated; renderProse mono-wraps tokens (ai-investment-brief.tsx:75-96) | model transcription of pre-rounded facts | mixed | PARTIAL: any number here is at best a copy of a fact already shown elsewhere; grounding gate discards "low" only (brief.ts:333) |
| 59 | Recommendations bullets (3-5) | model note.recommendations, readNote brief.ts:222-238 caps at 5 | prose | n/a | PASS structurally |

### Cross-module reconciliations checked

| Check | Result |
|---|---|
| (3a) contributors bps vs day P&L bps | FAIL: 65.0 shown, 78.5 full-list max, 116.1 headline; 13.5 bps truncation + 37.6 bps denominator mismatch; NO residual row exists (pulse.ts:78-83). See NI-01 |
| (3b) weights sum to 100 | PASS by construction: holding weight = valueBase/totalValue x 100 (lib/portfolio/model/holding.ts:182); asset-class slice weight identically (allocation.ts:115); cash 32.95 + live sample held weights consistent; note DISPLAYED weights (33% + rounded others) need not sum to 100, and no surface sums them |
| (3c) healthScore vs healthFactors | ARITHMETIC PASS / DISPLAY FAIL: exact terms sum to the exact total by construction (pulse.ts:168-184 reads scoreExact x effectiveWeight); rounded rows sum 67.6 vs displayed 68 (NI-07); weightShares sum to 1.000 (verified: 0.99999) |
| (3d) benchmark window/methodology symmetry | XIRR-vs-XIRR is symmetric (same flows, digest.ts:144-152, portfolio-performance.ts:505-550) and gated together: PASS. XIRR pair vs 90-day curve pair: different windows, insufficient labelling: FAIL (NI-03). totalReturnOnCostPct 3.0763621316651557 vs performance.totalReturnPct 3.076362131665155: same formula (perf.total.pct) computed TWICE independently; equal today by cache coincidence; population caveat contracts.ts:181-192; latent divergence (NI-12) |
| Sentiment decomposition | components 44+25+13 = 82 vs score 81 (NI-08) |
| Queue counters | 19 items = 19 openCount = client 19: PASS; vs baseline arithmetic 20-3+2=19 unstated (NI-17) |
| Change chip counts | 6 changes, 4 new: verified against feed: PASS |
| Trim sizing prose | "$526,942 (39% of this holding's value)": 12.95pp of $4.069M = $526.9K; 526,942/1,340,776 = 39.3%: PASS |

---

## Part 4. Summary for prioritization

Ship-blockers for a numbers-credibility bar: NI-01/NI-06 (contributor reconciliation), NI-02 (cash precision), NI-03 (XIRR window labelling), NI-04 (Actions/Attention labelling), NI-05 (VIX double interpretation). Each is fixable without touching any engine: NI-02/03/04 are formatter and copy changes; NI-01 needs one denominator decision plus a residual row in pulse.ts; NI-05 needs one shared VIX threshold table.

Systemic items to schedule: NI-10/NI-11 (five clocks; date-only events on UTC midnight), NI-12 (delete the duplicate performance build), NI-13 (write the precision policy down and enforce it in _viz/format.ts).

Everything else (NI-07, NI-08, NI-09, NI-14 through NI-21) is sub-point rounding or labelling polish, individually small, but collectively they are why a careful reader cannot make any two numbers on this page tie out to the last digit.
