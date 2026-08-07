# 04. Provenance and Trust: can any figure on "Today" be interrogated?

As of 2026-08-08, branch `f22/day-change`. Method: static read of every module under `app/_home/`, the data layer (`lib/metric.ts`, `lib/provenance.ts`, `lib/home/contracts.ts`, `lib/home/explain.ts`), the live digest sample (`/tmp/home-digest.json`, generated 2026-08-08 03:11 local), and the 1440px baseline screenshot (`shots/baseline/1440.png`). No repo file was modified.

The question this audit answers per figure: if a user does not believe a number, what can they do about it without leaving the page? Four affordance classes:

- **(a) decomposition**: the click-to-explain popover (`app/_home/_atmosphere/explain-popover.tsx` rendering a `ScoreExplanation` from `lib/home/explain.ts`)
- **(b) as-of**: a visible timestamp or session date for the figure
- **(c) deep link**: a route into the owning tool where the figure can be re-derived
- **(d) dead end**: none of the above; the number must be taken on faith

## 1. What the explain layer actually covers

`lib/home/explain.ts` ships five builders. Only four are wired:

| Builder | Explains | Wired where | Verdict |
|---|---|---|---|
| `explainAttentionScore` (explain.ts:66) | queue priority score | attention-queue.tsx:242 (spotlight), :405 (every row) | wired, every instance |
| `explainOpportunityScore` (explain.ts:98) | radar fit score | radar.tsx:105,132 | wired, every tile |
| `explainHealth` (explain.ts:133) | health grade/total | book.tsx:220 (ring), todays-brief.tsx:287 (hero Grade KPI) | wired, both surfaces |
| `explainDecision` (explain.ts:208) | decision score + simulated impact | attention-queue.tsx:223,269 (spotlight "If executed") | wired |
| `explainSentiment` (explain.ts:181) | sentiment gauge | **nowhere** (grep over `app/`: zero imports) | built, never wired |

The sentiment gauge is the one score whose contract explicitly carries its components "so the number is auditable rather than magic" (contracts.ts:65-66) AND has a purpose-built explainer, and it is the one score with no popover. The Market Overview tile (market-intelligence.tsx:299-330) renders the label, a thumb on a gradient bar, and a static tooltip; the components, weights, and confidence never reach the user. This matters doubly because the page already exhibits the "Extreme Greed beside Normal volatility" tension (architecture map, item 5): the decomposition that would resolve it exists and is dropped.

## 2. Inventory: every figure on the 1440 baseline, classified

Legend: Y = present, P = partial, N = absent. "Verdict" is the worst honest description.

| # | Figure (live value) | Rendered by | (a) decomp | (b) as-of | (c) deep link | Verdict |
|---|---|---|---|---|---|---|
| 1 | Portfolio Value $4.07M | todays-brief.tsx:275 (`Kpi`, count-up) | N | P (page header "Updated 3:11 AM" only) | N | dead end |
| 2 | Today +1.2% / +$31.68K (hero KPI) | todays-brief.tsx:276-283 | N | P (session note in band 4a, see #8) | N | dead end; see finding PR-01 |
| 3 | Grade C 68 (hero KPI) | todays-brief.tsx:287-291 via `explainHealth` | **Y** | P (page-level) | N (popover has no "open health engine" link) | best-in-class, minus the link |
| 4 | Actions 1 (hero KPI) | todays-brief.tsx:294-299 (`actions.data.actions.length`) | N | N | P ("Open Action Center" scrolls to the queue, which shows 19 open, a different collection) | dead end + cross-figure contradiction (audit 01 item 2) |
| 5 | Brief headline numbers (82%, 1.2%, C 68/100, 32.9%) | todays-brief.tsx:325-332 (`MonoNumbers`, styling only) | N | Y (generation time 3:10 AM, todays-brief.tsx:259-266) | N | prose is server-grounded (headline only, see section 5) but user-side uninterrogable |
| 6 | "6 changes, 4 new" chip | todays-brief.tsx:231-252 | P (scrolls to the change band) | Y (band shows baseline "today 12:53 AM") | Y | good |
| 7 | MARKETS CLOSED - FRI, AUG 7 CLOSE | todays-brief.tsx:341-345 (`pulse.sessionNote`) | n/a | is itself an as-of | n/a | good; this is the honest pattern |
| 8 | Top ABNB +17.4% / Weakest AMD -1.2% | todays-brief.tsx:352,362 (`MetricDelta`, stamped) | N | Y (Metric carries asOf + sessionDate; label suppressed under the shared session note) | Y (`SymbolTag` hover context + link) | good |
| 9 | Health ring C 68/100 (Book) | book.tsx:220-222 via `explainHealth` | **Y** | Y (header "Updated 3:11 AM" = `pulse.asOf`, book.tsx:201-206) | P (footer "Open portfolio") | best on the page |
| 10 | Day P&L +1.2% +$31.68K + "Fri, Aug 7" | book.tsx:236-247 (`MetricDelta` over a real Metric built from `pulse.asOf`/`sessionDate`) | N | **Y** (explicit session date rendered, book.tsx:245-247) | P (footer) | as-of exemplary; no decomposition (contributors below are the implicit one) |
| 11 | Return (XIRR) +68.6% | book.tsx:264-277 | **N** | N | P (footer links only) | dead end; see PR-02 |
| 12 | vs SPY +29.6%, excess +39.0% | book.tsx:288-293 | **N** | N | N | dead end; see PR-02 |
| 13 | Cash 33% | book.tsx:279-284 | N | N | N | dead end, yet it is the page's single most narrated number (brief, spotlight, action row, radar rationale) |
| 14 | 90-day vs SPY curve, +9.7% / +4.9% | book.tsx:303-321 (`ComparisonSparkline`) | N | P (window named "90-day"; no date range, no point inspection) | N | see PR-03; `coveragePct` IS rendered but only when < 95 (book.tsx:307-311); live sample is 100 so nothing shows, which is correct behavior |
| 15 | Top contributors +64.1 / +4.9 / -4.0 bps | book.tsx:325-345 | N | P (inherits card's "Updated" + the Day P&L session date) | N (symbols are `Monogram` + plain text, not `SymbolTag`) | dead end; "bps of previous-close book value, a contribution not a return" lives only in a code comment (contracts.ts:103-109). See PR-04 |
| 16 | What's-changed chips + details | whats-changed.tsx:52-93 | **Y by design** (`detail` states before -> after, expandable rows) | Y (baseline stamp, whats-changed.tsx:108) | Y (per-chip `href` when present) | the model the rest of the page should copy |
| 17 | Queue priority scores (73, 67, 66...) | attention-queue.tsx:242, 405 via `explainAttentionScore` | **Y** | N per item (`observedAt` and `reviewedAt` ship in the contract, contracts.ts:370,402, and never render) | Y (`primaryAction.href` per row) | good, minus observation age; see PR-05 |
| 18 | Spotlight "If executed: Health 68 -> ..." deltas | attention-queue.tsx:266-293 via `explainDecision` | **Y** (incl. alternatives count + honesty caveats) | N | Y ("Review threat" / decision links) | good |
| 19 | Threat probability / impactPct / worstCasePct | **nowhere** | - | - | - | shipped and dropped entirely; see PR-06 |
| 20 | Radar fit scores (80, 79, 79, 75, 75) | radar.tsx:132-139 via `explainOpportunityScore` | **Y** | P (staleness line renders only when `scannerFreshness.level === "stale"`, radar.tsx:245; live level is "aging, 1h ago" and shows nothing) | Y ("Open research" per tile, The Wire header link) | good, minus the aging gap; see PR-07 |
| 21 | Market tape tiles (S&P 7,757.64 +0.62% ... BTC 65,004.35) | market-intelligence.tsx:99-129, 248-272 (`MetricDelta`) | N | P (ONE card-level note "Showing Fri, Aug 7 close" via `sharedSessionNote`; the per-ticker `asOf` epoch each `MarketTicker` carries, contracts.ts:37, is never displayed anywhere) | Y ("See all" -> /wire) | see PR-08 |
| 22 | Sentiment EXTREME GREED | market-intelligence.tsx:299-330 | **N** (explainSentiment exists, unwired) | P (card subtitle time) | N | see PR-09 |
| 23 | VIX/10Y/Oil/Gold/DXY/BTC captions ("Normal volatility...") | market-intelligence.tsx:145-206 (derived from live reading) | P (InfoTip explains what the instrument is, not where the number came from) | P (card level) | N | acceptable; captions are deterministic |
| 24 | AI Investment Brief note sections (regime/opportunities/risks/portfolio/sectors/macro/recommendations) | ai-investment-brief.tsx:359-447 | N | P (hero shows brief generation time; this card shows none) | N | unverified model prose under an unconditional "AI generated" badge (ai-investment-brief.tsx:480-482); see section 5 and PR-10 |
| 25 | Attention "19 open" | attention-queue.tsx:616-618 | N | N (`reviewedAt` unrendered) | n/a | count of a visible list; acceptable, but contradicts hero "Actions 1" |
| 26 | Watchlist "1 buy, 1 near-buy" (Radar footer) | radar.tsx:259-262 | N | N | Y (Open -> /watchlist) | acceptable |

Summary: 6 of ~26 figure families have real decomposition; roughly 8 are honest about time; roughly 9 are dead ends. The dead ends cluster on the Book card's money column (XIRR, excess, cash, contributors), which is exactly the column a skeptical user will attack first.

## 3. Provenance the data layer already carries and the UI drops

The gap is not a data-model gap. The plumbing exists end to end and is severed at the last hop:

1. **`Metric` carries value + basis + asOf + source + sessionDate** (lib/metric.ts:31-44), with a constructor that throws on non-finite values (metric.ts:54) and a session-state policy (metric.ts:100-111). The stamped renderers exist (`MetricDelta`, `AsOfLine` in app/_home/_viz/stamped.tsx). But:
   - `AsOfLine` (stamped.tsx:98) has **zero call sites** (grep over all `.tsx`): the "Data as of 10:33 PM - Yahoo" module-header pattern its doc comment describes is used by no module.
   - `MetricDelta` renders the session date, but never the `source` field: `Metric.source: DataSourceId` reaches the client on every day-change figure and no pixel ever says "Yahoo".
   - The hero "Today" KPI bypasses the stamped path entirely: todays-brief.tsx:187,278 feeds `p.todayChangePct` through `useCountUp` + `fmtSignedPct`, a bare number, while the Book card renders the same quantity as a stamped Metric (book.tsx:237). Same value, one stamped, one not, one page.
2. **`lib/provenance.ts` defines `DataSourceId`, `DATA_SOURCES` display names, and `Freshness`** (provenance.ts:14-42) precisely because "a figure with no as-of is a figure you can't trust" (provenance.ts:9). On this page `Freshness` reaches the client exactly once (`opportunityFeed.scannerFreshness`, contracts.ts:743) and is rendered only in its "stale" state (radar.tsx:245). The "aging" state (live sample: `{level: "aging", label: "1h ago"}`) renders nothing. `DATA_SOURCES` is imported by no home module.
3. **Per-ticker `asOf` on the tape** (contracts.ts:37, live sample `asOf: 1786135824000` per ticker) is dropped: `tickerMetric()` (market-intelligence.tsx:56-59) copies it into the Metric, and `MetricDelta` uses it only for the staleness computation, never for display.
4. **`PortfolioPulse.asOf` + `sessionDate`** (contracts.ts:170-173) ARE rendered (Book header caption + session date line), the strongest as-of story on the page, but the hero consuming the same slice renders neither next to its KPIs.
5. **`AttentionItem.observedAt`** (contracts.ts:370) exists so confidence can decay with observation age; the queue renders neither the timestamp nor the decayed-confidence explanation ("as of" absent from `explainAttentionScore`'s factor rows).
6. **`EquityCurve.coveragePct`** (contracts.ts:573) is wired with a sensible threshold. Credit where due. But `performance.holdingDays` (contracts.ts:519, live value 95) is shipped and unrendered, and it is the one number that would let a user contextualize "+68.6%/yr XIRR over a 95-day-old book".
7. **`attribution` and `threats` slices are built server-side on every digest and no module selects them** (grep `useHomeSlice(` over app/_home: attention, portfolioPulse, recommendedActions, symbolContext, opportunityFeed, watchlistIntelligence, changes, marketIntelligence, performance, equityCurve, activity, fallbackBriefing only). `PerformanceAttribution.byHolding/bySector/cashDrag` (contracts.ts:282-292) is exactly the decomposition figures #11-#13 lack, computed, serialized, ignored. `ThreatItem.probability/impactPct` and `ThreatCenter.worstCasePct` (contracts.ts:246-258, live: worstCase -20.2%, VaR probability 0.05/impact -0.67%) surface only as a one-sentence queue rationale with the quantities stripped.

## 4. Design: one provenance affordance for every figure

The page already has the right interaction twice: the explain popover (click a score, see its anatomy) and the stamped metric (a figure that cannot render without its time). The missing move is to unify them so that EVERY figure, scores and money alike, answers the same five questions on the same gesture.

**Contract** (extend `ScoreExplanation` or introduce a sibling `FigureProvenance`, lib/home/explain.ts):

```ts
interface FigureProvenance {
  value: string;              // as displayed, e.g. "+68.6%"
  unit: string;               // "% annualized", "bps of prev-close book value", "% of book"
  basis: MetricBasis | string; // day | sinceCost | window | level, or a named method
  window: string | null;      // "90d ending 2026-08-07", "since 2026-05-05 (95 days)"
  asOf: number;               // epoch ms of source data
  sessionDate?: string | null;
  source: DataSourceId;       // -> DATA_SOURCES[source].name for display
  engine: string;             // owning computation, e.g. "lib/portfolio-performance.ts (XIRR)"
  computationRef: string;     // one sentence of method, same register as ScoreExplanation.method
  href?: string | null;       // the owning tool, e.g. /portfolio?tab=performance
  factors?: ExplanationFactor[]; // optional decomposition when one exists
}
```

**Interaction**: the existing `ExplainableValue` trigger (dotted underline optional, cursor-help, portaled panel, Escape/outside-click, focus return) generalizes as-is; it needs only a second panel body variant that renders the provenance header block (value - unit - window - "as of {shortTime} - {source short}") above optional factors. `explain-popover.tsx` already solves the hard problems (clipping, collision, a11y); nothing new is needed at the interaction layer.

**Data**: no new engine work for most figures.
- XIRR/excess: `performance` slice already has xirrPct, holdingDays, benchmark triple; `computationRef` is a constant string; `window` derives from holdingDays.
- Day P&L, movers, tape: already `Metric`s; a `metricProvenance(m, engine, ref)` adapter is ten lines.
- Contributors bps: pulse has dayDollar and prev-close value; the popover simply states the division that contracts.ts:103-109 currently states to developers only.
- Cash %: allocation engine slice + href to /portfolio.
- Sentiment: wire the existing `explainSentiment`, done.
- Attribution rows become the `factors` of the Return-on-cost popover by finally reading the shipped `attribution` slice.

**Rule**: adopt the stamped-primitives discipline one level up: any `font-mono tabular-nums` figure rendered outside an `ExplainableValue`/`MetricDelta` wrapper fails review. The codebase has already proven this style of boundary works (stamped.tsx: "a figure without a timestamp is a compile error at the render boundary").

## 5. LLM prose provenance: which sentences are grounded, which are narration

The brief's grounding set (`buildBriefFacts`, lib/home/brief.ts:177-198) contains at most FOUR tagged facts:

1. breadth % (`regime.breadthPct`), period "day"
2. portfolio day change %, period "day"
3. health total, plain
4. concentration finding count, plain

That is the complete list; the function has no other pushes. Compare against the JSON shape the prompt demands (brief.ts:153-166): headline, portfolioSummary, and a note with **seven** sections (regime, opportunities, risks, portfolio, sectors, macro, recommendations[3-5]).

- **Grounded (fact-backed)**: sentences citing breadth, day change, health, alert count, i.e. the headline and portfolioSummary content, and parts of note.regime / note.portfolio.
- **Pure narration (zero fact backing)**: `opportunities`, `risks`, `sectors`, `macro`, and all 3-5 `recommendations`. The prompt supplies nothing about opportunities (the radar's five scored candidates are absent), nothing about risks (the threat engine's probability/impact numbers are absent), nothing about sectors beyond one regime line and one rotation line, and literally nothing about macro (the calendar slice never reaches the prompt). Whatever those sections say is either a restatement of the three portfolio facts or invention that the verifier does not check, because:
- **Only the headline is verified.** `generateHomeBrief` (brief.ts:332) calls `verifyGroundingWithFacts(headline, ...)`; the cache-revalidation path (brief.ts:291-292) also passes `parsedCache.headline` only. `parsed.note` flows through `readNote()` (type narrowing only, brief.ts:337) straight to the client. The note, the longest and least grounded output, ships unverified. Full treatment in audit 05.

On the page this manifests as an asymmetry the user cannot see: the hero headline has passed a numeric grounding gate; the AI Investment Brief tiles below it have passed none, yet both carry the same "AI generated" sparkle badge and neither carries a per-claim indicator.

## 6. Findings

**PR-01 (high). The hero's flagship numbers are the least interrogable on the page.** Portfolio Value and Today (todays-brief.tsx:275-283) render as animated bare numbers: no explain, no stamped Metric, no source, no link, while the identical day-change quantity one card to the right is fully stamped (book.tsx:236-247). Evidence: todays-brief.tsx:186-187 (`useCountUp` on raw floats), contracts.ts:170-173 (asOf/sessionDate shipped and unused here). Fix: render the Today KPI through `MetricDelta` (count-up can wrap the value while keeping the suffix) and give both KPIs the provenance popover of section 4.

**PR-02 (high). XIRR +68.6% and excess +39.0% have no explain path anywhere.** A money-weighted annualized figure computed from a 95-day lot ledger sits beside a 90-day curve showing +9.7% with nothing reconciling them; `holdingDays` ships (live: 95) and never renders; the one-line qualifier ("annualized, money-weighted", book.tsx:295) appears only when the benchmark line is absent, and the benchmark line replaces exactly that qualifier with more unexplained numbers. Evidence: book.tsx:262-300, contracts.ts:504-524 (the contract's own doc comment narrates the -99.98%/yr annualization artifact this figure class produces). Fix: provenance popover with window = "since {first lot date} (95 days)", method sentence, and the MIN_DAYS_TO_ANNUALIZE caveat; render holdingDays.

**PR-03 (medium). The 90-day curve is uninspectable.** No hover, no date range endpoints, no as-of; `coveragePct` discloses correctly but only below 95. Evidence: book.tsx:106-176 (SVG has no pointer handling), contracts.ts:562-574. Fix: date-range subtitle ("May 10 - Aug 7") from `points[0].date`/`points.at(-1).date` (already shipped), plus the popover.

**PR-04 (medium). Contributor bps are a term of art defined only in a code comment.** "+64.1 bps" is a contribution to the book's day move over previous-close value; a user will read it as ABNB's own return. Evidence: contracts.ts:103-109 vs book.tsx:325-345 (label "Top contributors (today)" with no unit explanation); symbols here are also the only ticker text on the page not wrapped in `SymbolTag`. Fix: InfoTip or popover stating the division; SymbolTag the symbols.

**PR-05 (medium). The queue hides its own time dimension.** `observedAt` (contract, confidence decays with it), `occursAt`, and `reviewedAt` all ship; none render; `explainAttentionScore`'s confidence row does not mention age. Evidence: contracts.ts:363-370, 402; attention-queue.tsx renders no timestamp in any row or in the clear state ("Nothing needs your attention" with no "as reviewed at 21:39"). Fix: age chip on observation-backed rows; reviewedAt under the clear state; an age line in the confidence factor detail.

**PR-06 (medium). The threat engine's quantities never reach the page.** `probability`, `impactPct`, `worstCasePct` (live: VaR p=0.05 / -0.67%, worst case -20.2%) are computed per digest and no module reads the `threats` slice; the only survivor is a de-quantified sentence inside a queue rationale. Same for the whole `attribution` slice (byHolding, bySector, cashDrag), which is precisely the missing decomposition for figures #11-13. Evidence: grep `useHomeSlice(` over app/_home (neither slice selected); contracts.ts:240-292. Fix: either render them (threat quantities into the spotlight threat card; attribution as the return popover's factors) or stop computing/serializing them per digest.

**PR-07 (low). Scanner freshness renders only at the "stale" extreme.** The live "aging - 1h ago" state shows nothing; the Freshness machinery has three levels for a reason. Evidence: radar.tsx:245; /tmp/home-digest.json `scannerFreshness: {level: "aging", label: "1h ago"}`. Fix: always render the compact age ("scan 1h ago") in the Radar header; tone by level.

**PR-08 (low). Per-ticker quote times are dropped on the tape.** Each `MarketTicker.asOf` ships (live sample carries a real epoch per symbol); only the shared session-date note renders. During a live session (no session note) the tiles show no time at all, and the never-used `AsOfLine` component was built for exactly this slot. Evidence: contracts.ts:33-37, market-intelligence.tsx:56-59, stamped.tsx:93-115 (zero call sites). Fix: `AsOfLine` in the Market Overview header (asOf = max ticker asOf, source = "Yahoo").

**PR-09 (medium). The sentiment gauge is the page's one intentionally auditable score with no audit affordance.** Components + confidence ship in the contract for this stated purpose; `explainSentiment` exists and is unimported. Evidence: contracts.ts:61-69, explain.ts:181-201, market-intelligence.tsx:299-330. Fix: wrap the gauge label in `ExplainableValue explanation={explainSentiment(gauge)}`; one-line change plus an import.

**PR-10 (high). Unverified model prose carries the same trust chrome as verified prose.** The note sections ship without any grounding check (brief.ts:332 verifies `headline` only) under an unconditional "AI generated" badge (ai-investment-brief.tsx:480-482), with no per-section as-of, no fact citations, and five of seven sections structurally unbacked by any supplied fact (section 5). Evidence: brief.ts:177-198 vs 153-166; ai-investment-brief.tsx. Fix directions in audit 05 (LQ-01, LQ-02).

**PR-11 (low). No source names anywhere.** `DATA_SOURCES` display names and `Metric.source` reach the client on every stamped figure; the string "Yahoo" appears nowhere on the rendered page. For a product whose stated philosophy is transparency over convenience (CLAUDE.md), the dashboard never says where a single price came from. Fix: the section 4 popover's source line, plus `AsOfLine` adoption.
