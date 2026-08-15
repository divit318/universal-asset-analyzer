# ARCHITECTURE.md: UAA Module System

Complete reference for every major UAA module: what it does, what it needs, what it produces, and how modules talk to each other.

---

## Platform Data Layer (`lib/platform/`) — read this first

**Every fetch in UAA goes through one path.** Nothing bypasses it: not the
Screener, not the Scanner, not the AI context builder, not AI generation itself.

```
caller → getDataset()
           → cache read   (fresh?         serve — provider never contacted)
           → cache read   (stale-in-SWR?  serve NOW, refresh in background)
           → dedupe       (identical work already running? attach to it)
           → provider fetch → normalize → cache write → return
```

This is wired in at the **provider boundary** (`lib/yahoo.ts`, `lib/edgar.ts`,
`lib/ai/context.ts`), not at the ~48 call sites — so bypassing it is impossible
by construction, and every module observes the same normalized value for a given
asset without knowing the platform exists.

| File | Role |
|------|------|
| `registry.ts` | **The single source of truth for cache policy.** Per-dataset TTL/SWR/persist + the dependency graph. There is deliberately no universal TTL. |
| `cache.ts` | Smart Cache: L1 in-process LRU + L2 SQLite (`platform_cache`), stale-while-revalidate, dependency-aware invalidation. |
| `dedup.ts` | Request Deduplication Manager. Refcounted — one consumer cancelling never kills a request others still need. |
| `orchestrator.ts` | `runPlan()`: DAG execution, concurrency limits, per-step failure isolation, retries, cancellation. Plus `mapLimit()` for batch work. |
| `data-layer.ts` | The façade: `getDataset` / `peekDataset` / `invalidateAsset`. |
| `client/` | Browser half: subscription store (granular re-render), `useDataset` (cancellation + dedup + SWR), `useResearchBundle` (streams the bundle). |

**Cache policy is dataset-scoped, never page-scoped.** A live quote (15s TTL, no
SWR, never persisted) and a 10-K (6h TTL, persisted) have nothing in common
except being "data".

**Invalidation is dependency-aware.** `invalidateAsset("AAPL", "filings")`
cascades filings → statements → fundamentals → peers → companyContext →
aiVerdict, and stops. Apple's price history, Apple's profile, and every other
symbol are untouched. A price tick invalidates valuation and the verdict — not
the business overview.

**Observability:** `GET /api/platform` (cache hit rate, how much duplicate
provider work dedup eliminated, what's in flight, the registered policies).
`DELETE /api/platform?symbol=AAPL&dataset=filings` invalidates.

### Orchestrated research (`lib/research-bundle.ts`)

One declared plan; `/api/research` (JSON) and `/api/research/bundle` (NDJSON,
streamed per section) both execute it, so they cannot drift. Independent steps
run concurrently; only the two real dependency chains are ordered
(`profile → sectorHistory`, `fundamentals → peers/sectorRotation`).

This replaced a four-stage waterfall. Measured, cold cache: full research
2264ms → 1455ms; **time-to-first-paint 764ms → 163ms**; warm revisit 36ms.

### AI streaming (`lib/ai/streaming-json.ts` + `/api/ai/report`)

**The then-local backend serialized requests** (measured: 3 concurrent
generations ≈ 3 sequential). So per-section generation would have cost ~9x one
generation — it was built, measured at 138s vs 40s, and rejected. Instead: **one generation** (the
same `buildVerdictPrompt` the non-streamed `/api/ai/verdict` uses), parsed
incrementally, with each top-level JSON field emitted the instant it closes.

The assembled report is therefore *the same object* the non-streamed route
returns — not an approximation. Total generation time is unchanged; only
time-to-first-section improves (32s → 7s on MSFT, 42s → 4s on JPM). Complete
sections only — never tokens, never half-written sentences.

---

## Core Data Sources

These are not modules but foundational services that other modules depend on.
**All of them now route through the Platform Data Layer above** — the caching
notes in each section below describe the dataset policy, not a private cache.

### Yahoo Finance (`lib/yahoo.ts`)
**Purpose**: Real-time US market data from Yahoo Finance API.

**Exports:**
- `getQuote(symbol)` → Quote object (price, change, P/E, market cap, etc.)
- `getHistory(symbol, days)` → OHLCV history array
- `getQuoteSummary(symbol, modules)` → Detailed fundamentals (sector, employees, website, etc.)

**Error Handling**: Throws on network failure; caller decides retry/fallback strategy.

**Used By**: Research, Screener, Scanner, Compare, Portfolio, DCF, Calendar, IC Report, Engine.

**Caching**: None (always fresh). Fundamentals cached separately in SQLite by screener.

---

### SEC EDGAR (`lib/edgar.ts`)
**Purpose**: SEC filing data (10-K, 10-Q, 8-K) for fundamental research.

**Exports:**
- `getRecentFilings(symbol, limit)` → Array of Form + filedAt + description + CIK lookup

**Error Handling**: Non-fatal. Returns empty array + error message; UI still renders.

**Used By**: Research, IC Report, Compare (for historical validation).

**Caching**: CIK lookups cached internally; filing metadata not cached.

---

### screener.in API (`lib/screener-in.ts`)
**Purpose**: NSE (India) equity fundamentals, different field names than Yahoo.

**Exports:**
- `getScreenerInData(symbol)` → Indian company fundamentals (market cap, PE, dividend yield, etc.)

**Error Handling**: Non-fatal; returns null on failure.

**Used By**: Research India, IC Report (India variant).

**Note**: Different field names than Yahoo Finance; check `app/research/india/_components/` for shape mapping.

---

### Company News (`lib/news.ts`)
**Purpose**: Recent company news and press releases.

**Exports:**
- `getCompanyNews(symbol, count)` → Array of NewsItem (title, date, link)

**Error Handling**: Non-fatal; empty array on failure.

**Used By**: Research (latest intelligence section), Research Copilot.

---

## Scoring & Screening Engines

These compute analytical scores and filter stocks.

### Two purpose-built scorers (not one)

UAA runs **two** scoring engines, deliberately, for two different contexts. They
read different data and produce different numbers by design — do not try to merge
them into one (doing so either cripples the Screener's batch performance or strips
the decision engine's richness). What they DO share, as a single source of truth,
is the decision/label layer and the normalization primitive.

**`lib/composite.ts` — batch dimensional scorer (the Screener engine).**
- Pure sector-aware sub-scores (value / growth / quality / financialHealth /
  momentum) + weighted `overall`, all 0–100, via `computeScores(m)`.
- Input: `ScorableMetrics` (precomputed `StockMetrics` from the 24h dataset cache).
  Never fetches analyst consensus or statements — that is what makes it cheap
  enough to score 1000+ names.
- Used by: `lib/dataset.ts` (Screener), `lib/scanner/fundamental-gate.ts`.
- Tests: `tests/composite.test.ts`.

**`lib/scoring.ts` — single-name decision engine (research/compare/portfolio).**
- Multi-signal `ScoreResult`: fundamentals + analyst consensus + EPS revisions +
  price momentum + capital allocation + sector rotation, market-aware weights,
  a `composite`, a `recommendation`, `confidence`, and a `rationale`.
- Input: live `FundamentalsSnapshot` + `AnalystConsensus` + `FinancialStatements`
  + `MomentumSignal` via `computeScore(...)`.
- Used by: research/fundamentals, compare, report, portfolio, watchlist, copilot.
- Tests: `tests/scoring.test.ts`.

**Shared single-source-of-truth layer** (so a given score means the same thing
everywhere it appears):
- `lib/recommendation.ts` — canonical score→`Recommendation` bands (78/60/42/25),
  labels, and badge tones. Both engines and all UI route through this; never
  hardcode band cutoffs or a label/color map in a component.
- `lib/score-math.ts` — the shared clamp-lerp (`lerp`/`norm`) both engines normalize with.
- `lib/sector.ts` — the shared `sectorGroup()` both engines classify with.
- Consistency contract: `tests/scoring-consistency.test.ts`.

---

### Fundamental Screener (`lib/fundamental-screener.ts`)
**Purpose**: Multi-filter stock screening with cached fundamentals + live prices.

**Workflow:**
1. Cache fundamentals in SQLite (24h TTL, refreshed on load)
2. Fetch live prices from Yahoo
3. Merge cached fundamentals + live prices
4. Apply filters (sector, P/E range, market cap, etc.)
5. Score with `lib/composite.ts`
6. Sort and return

**Inputs:**
- `ScreenerCriteria`: sector, price range, P/E range, market cap range, sort field

**Outputs:**
- Array of `ScreenerRow` (symbol, name, price, score, metrics)

**Caching Strategy**:
- Fundamentals: 24h TTL in `fundamentals_cache` table
- Live prices: always fresh, fetched per request
- Scorer results: computed on the fly (not cached)

**Used By**: `/screener` page, Thematic engine, comparison workflows.

**Related**: `lib/dataset.ts` (merges fundamentals + prices), `lib/yahoo-screener.ts` (Yahoo Finance API adapter).

---

### Event Screener (`lib/event-screener.ts`)
**Purpose**: Detect event-driven signals (earnings surprises, insider trades, breaks).

**Signal Types:**
- **Earnings surprises**: Actual vs. estimate mismatch
- **Insider transactions**: Buy/sell imbalance, insider confidence
- **Technical breaks**: Stock breaks relative strength patterns
- **Sector rotations**: Factor underperformance switches

**Inputs:**
- Symbol, recent quote, historical prices, insider data

**Outputs:**
- `DetectedSignal` array (signal type, severity, data points, source)

**Caching**: Results cached in `scanner_cache` table (prevent redundant runs).

**Used By**: Scanner (`/scanner`), IC Report (signals agent), Event-driven alerts.

**Note**: "Sector rotations" here is a one-off *signal type* (factor underperformance switches). For continuous, cross-sector relative-strength tracking, see the Sector Rotation Engine below — a distinct capability.

---

### Sector Rotation Engine (`lib/sector-rotation.ts`)
**Purpose**: Continuously track relative strength, momentum, and capital rotation across the 11 GICS sector ETFs. Single source of truth for sector ETF tickers (`SECTOR_ETFS`, `SECTOR_ETF_MAP`) — `lib/scanner/signals.ts` and `lib/scanner/sector-impact.ts` import from here instead of keeping their own copies.

**Core Logic:**
- Fetches sector ETF price history via `lib/yahoo.ts getHistory`
- Computes % return across 4 windows (1w/1m/3m/6m) per sector
- Relative strength = primary-window (1m) return minus the equal-weight average across sectors
- Momentum = change in relative strength vs. the prior persisted snapshot (acceleration proxy)
- RRG-style quadrant classification: `leading` / `strengthening` / `weakening` / `lagging`

**Exports:**
- `computeSectorRotation()` → fetches live data, persists, returns `SectorRotationSnapshot`
- `getLatestSectorRotation()` → cheap read of the most recently persisted snapshot
- `findSectorRotationEntry(snapshot, sector)` → single-sector lookup
- `computeSectorReturns`, `buildSectorRotationSnapshot` — pure, tested (`tests/sector-rotation.test.ts`)

**Persistence**: `sector_rotation_snapshot` table (one row per day, 2-year retention).

**Used By**: `/api/sector-rotation`, Scanner (`SectorRotationPanel` alongside the existing event-driven `SectorRotationGrid`), Opportunity Scorer (blends into catalyst strength), Movement Explainer (sector context for symbol-level explanations).

---

### Movement Explainer (`lib/movement-explainer.ts`)
**Purpose**: "Explain Every Movement" — on-demand engine answering "why did this move?" for a symbol, sector, or portfolio. General-purpose entry point, distinct from `lib/scanner/causal-engine.ts` + `thesis-builder.ts` (which elaborate causal chains for a *batch* of already-detected news events inside the Scanner pipeline only).

**Core Logic:**
- Deterministic evidence first: price return over the window, volume anomaly vs. 3-week baseline, recent company news, sector rotation context — AI never invents these
- Single AI call synthesizes drivers (category, description, evidence, direction), confidence, and persistence classification
- Cached via `scanner_cache` (15-min TTL, keyed `movement:{kind}:{subject}:{window}`)

**Exports:**
- `explainMovement(input)` → `MovementExplanation`
- `windowReturn`, `volumeAnomaly` — pure, tested (`tests/movement-explainer.test.ts`)

**Used By**: `/api/movement`, Research page (`MovementExplainerCard`, lazy-loaded on click).

**Extension point**: Portfolio and Watchlist can call the same `explainMovement()` for holding-level and watchlist-item-level "why" — not yet wired (planned for Phase 2).

---

### Thematic Engine (`lib/thematic-engine.ts`)
**Purpose**: 10-stage thematic analysis framework (supply chains, commodities, geopolitics, company tiers, opportunity scoring).

**Stages:**
1. Future State Identification
2. Dependency Chain Mapping (6 tiers)
3. Bottleneck Analysis
4. Supply-Demand & Capital Cycle
5. Commodity Framework
6. Policy & Geopolitics
7. India Leapfrog Analysis
8. Company Tier Mapping
9. Company Quality (from screener DB)
10. Opportunity Score

**Exports:**
- `runThematicEngine(theme, context)` → ThematicReport

**Inputs:**
- Theme name, list of relevant symbols, market context

**Outputs:**
- Tiered company list with opportunity scores, dependency chains, bottleneck analysis

**Used By**: `/thematic` page (user selects theme, engine ranks stocks).

**Streaming**: Results streamed via `ReadableStream` to client (long-running analysis).

---

## Core Research & Analysis

These modules provide deep research and institutional-grade analysis.

### Research (`app/research/page.tsx` + `/research/india`)
**Purpose**: Deep single-stock research page with copilot chat.

**Data Assembled:**
- Current quote + 5-year price history
- Sector benchmarks (SPY + sector ETF)
- Recent SEC filings (10-K, 10-Q, 8-K)
- Company news (latest intelligence)
- Insider holdings + recent trades
- Analyst estimates + price targets
- AI analysis (via the AI platform)

**Components:**
- Symbol search typeahead
- Interactive price chart (vs. SPY + sector)
- Earnings/dividend card
- Insider activity table
- Copilot chat panel (multi-turn conversation)
- Research notes UI
- AI verdict card

**Copilot:**
- User questions persisted in `research_session` + `research_message` tables
- Multi-turn conversation context
- Uses `lib/ai-research.ts` for prompt generation

**India Variant** (`/research/india`):
- Uses `lib/screener-in.ts` instead of Yahoo Finance
- Different field names (check components for Shape mapping)
- Same overall workflow

**API Dependency**: `/api/research?symbol=AAPL` assembles all data in parallel.

**Used By**: Users directly; starting point for deep research workflows.

---

### Comparison (`app/compare/page.tsx`)
**Purpose**: Multi-stock side-by-side comparison across 14 metrics.

**Metrics Tracked:**
- Price (current, 52-week range)
- Growth (revenue, earnings, FCF growth rates)
- Profitability (gross margin, operating margin, net margin)
- Valuation (P/E, P/B, EV/EBITDA, P/S)
- Leverage (debt-to-equity, interest coverage)
- Multi-year history for all metrics

**Workflow:**
1. User inputs symbol list (add/remove symbols)
2. Fetch 5-year history + current quote + fundamentals for each symbol
3. Compute metrics for each symbol
4. Display synchronized chart showing side-by-side comparisons
5. Allow download (Excel export)

**Component**: `compare-chart.tsx` (Recharts multi-line chart with legend).

**API Dependency**: `/api/compare-history?symbols=AAPL,MSFT,GOOGL` merges multi-year data.

**Used By**: Users comparing peer companies, sector analysis, competitive analysis.

---

### IC Report (`app/ic-report/page.tsx`)
**Purpose**: Institutional research report via 9-domain multi-agent pipeline (business, industry, competition, management, capitalAllocation, accounting, valuation, governance, risk).

**Workflow:**
1. User inputs symbol
2. Fetch quote + fundamentals + filings + insider data
3. Run 9 agents in parallel (each sees same data, produces section)
4. Stream results to client as agents complete
5. Synthesize sections into cohesive report

**Agent Domains:**
- **business**: What does the company do? Competitive position?
- **industry**: Industry dynamics, growth, headwinds?
- **competition**: Competitive threats, moat strength?
- **management**: Management quality, track record, incentives?
- **capitalAllocation**: M&A strategy, capex discipline, shareholder returns?
- **accounting**: Quality of earnings, off-balance-sheet items, accounting conservatism?
- **valuation**: Fair value estimate, margin of safety, scenario analysis?
- **governance**: Board quality, insider ownership, voting structure?
- **risk**: Key downside risks, black swan scenarios, mitigation?

**Each agent receives:**
- Quote + fundamentals snapshot
- Historical financials + statements
- Analyst consensus
- Insider activity
- Detected signals (from event screener)
- Relevant filings

**Outputs:**
- Streaming responses (agent findings, key insights, confidence level, data limitations)
- Client reassembles into report sections

**API Dependency**: `/api/ic-report?symbol=AAPL` orchestrates agent network.

**Related**: `lib/ic-questions.ts` (question framework), `lib/ic-signals.ts` (signal detection), `lib/ic-thesis.ts` (thesis synthesis).

**Used By**: Institutional analysts, deep conviction research, risk assessment.

---

## Portfolio & Position Management

These modules track user holdings and provide position-level analysis.

### Simulator (`app/portfolio/_components/simulator/`, `lib/portfolio/simulator/`)
**Purpose**: AI-generated hypothetical portfolios — describe a mandate, interview via
AI follow-ups, generate a complete live-priced book, edit it, compare it, promote it
to real holdings.

**Key files**:
- `lib/portfolio/simulator/types.ts` — `Simulation` is a *specification* (profile +
  holdings); all analytics recompute live through the real engines, never persisted.
- `lib/portfolio/simulator/intake.ts` — Step B interview contract (prompt, response
  validation, loop guards, 8-question cap).
- `lib/portfolio/simulator/generate.ts` — allocate → select → size → evaluate →
  narrate. The AI proposes; validation disposes: every ticker must survive a live
  quote, sizing conserves the mandate to the cent, every AI stage has a
  deterministic fallback.
- `lib/portfolio/simulator/evaluate.ts` — `SimHolding[]` → the ledger's own
  `RawHolding` shape → `buildMarketContext → normalizeHoldings → evaluate →
  runAllScenarios`. Zero analytics code of its own, so sim and real portfolio
  produce identical numbers for identical holdings by construction.
- `lib/portfolio/simulator/edit.ts` — value-conserving edit transforms (cash sleeve
  funds buys / absorbs trims) + swap/rationale AI contracts.
- `lib/portfolio/simulator/universe.ts` — curated instrument menu (the hybrid
  ticker-selection backbone; AI free-form picks die at quote validation).

**Routes**: `/api/portfolio/simulator` (CRUD), `/intake` (one interview turn),
`/generate` (staged NDJSON stream), `/evaluate`, `/edit`, `/swap` (measured
before→after impact previews), `/refresh-narrative`, `/promote`.

**AI**: everything routes through the `portfolio-construction` task
(JSON mode, interactive latency). Thesis reuses `lib/portfolio/thesis.ts`.

**Multi-portfolio**: `portfolios` table + `portfolio_id` (DEFAULT 1 = seeded
"Main Portfolio") on `portfolio_lot` / `manual_asset` / `portfolio_snapshot`.
Un-parameterized db.ts calls read/write Main exactly as before. Promote writes
BUY lots at live prices via `executeTradeBatch(lots, [], portfolioId)`; merging
nets overlapping tickers through lot aggregation. Non-default portfolios are
view-only on the Portfolio page (Dashboard/Risk Lab/Simulator tabs) until the
write routes are portfolio-aware end to end.


### Portfolio (`app/portfolio/page.tsx`)
**Purpose**: Holdings management, P&L tracking, position fit analysis.

**Data Tracked** (per position):
- Symbol, share count, average cost
- Current price, current value, unrealized P&L
- Position weight in portfolio
- Beta, correlation with portfolio
- Sector

**Portfolio Metrics:**
- Total value, total P&L
- Portfolio beta
- Correlation matrix (pairwise stock correlations)
- Sector concentration (% in each sector)
- Diversification score

**Fit Analysis:**
- How does a new position affect portfolio beta, correlation, sector concentration?
- Simulates adding a position, shows before/after metrics
- Helps with rebalancing decisions

**State**: Positions stored in `portfolio` table (SQLite).

**Component**: `portfolio-fit-panel.tsx` (position impact simulator).

**API Dependency**: `/api/portfolio` returns positions + computed metrics.

**Related**: `lib/portfolio-analytics.ts` (beta, correlation, P&L calculations), `lib/db.ts` (position CRUD).

**Used By**: Portfolio managers, asset allocation decisions, rebalancing.

**Portfolio Alignment** (`lib/portfolio/alignment/`, Dashboard tab, `/api/portfolio/policy`): the evaluation layer that replaced the universal-weights Portfolio Health score (2026-08-14). **Stage 3 (2026-08-15, policy v2 — the personalization model):** the policy now distinguishes OBJECTIVE (goal/horizon + optional explicit `growthBandPct` RANGE) / PREFERENCES (theme priorities) / CONSTRAINTS (tolerances) / **EXCEPTIONS** (`PolicyException[]` — per-holding deliberate allowances, e.g. "QQQM ≤ 30%, conviction"; `effectiveCapPct()` is THE single per-holding cap source consumed by the concentration theme, the trim loop and `computeConcentration`'s KNOW-THIS flags; exceptions deliberately do NOT extend the cluster allowance) / STATEMENTS (free-text provenance). **Free text NEVER reaches the scorer**: `/api/portfolio/policy/interpret` has AI propose a whitelisted `PolicyPatch` + `unmappable` leftovers, the editor renders every effect line ("Here is the policy UAA believes you are describing — do you agree?"), `applyPolicyPatch` merges only on explicit approval, saving is a second explicit act. Output is **verdict-led** (`label` primary, score "supporting"; panel shows "Where the points went" = (100−theme)×share per theme), with `objectiveNotes` ("aligned with your 60% tolerance — and objectively volatile": accepting risk costs nothing AND hides nothing) and `policyConflicts` (`detectPolicyConflicts`: band-floor stress vs drawdown tolerance, income requirement vs band yield ceiling — warnings only, never scored). **The policy is part of the report's cache identity** (`policyVersion` in the `portfolioReport` dataset key) — the invalidate/in-flight race that served old-policy decisions for hours after a save is structurally impossible. Decisions: gap ADD sizing is a MEASURED size search (`candidateSizes`, up to 15% of book — deep mismatches earn structural proposals, not universal nibbles); trims are exception-aware; buy/recommendation route uses `constraintsFromPolicy(evaluation.policy)`. Acceptance-tested: the same book under conservative / high-conviction / income policies produces pairwise-different decision sets with policy-quoted rationales (`tests/portfolio-decisions-policy.test.ts`). Still universal (stage 4+): intelligence detector thresholds, IOS fit scorer, simulator generation's 2% cash floor, optimize() constraints, home pulse HHI bands. **Stage 2 (2026-08-15): Decisions is fully policy-aware** — `recommend.ts detectGaps()` gates every gap on its owning theme's priority (Off themes generate nothing) and triggers on the investor's own numbers (cash-band floor, required yield, the SAME `INFLATION_TARGET_S`/`EXPOSURE_TARGETS` tables the themes score, measured on the classified share); the trim loop triggers at `tolerances.maxPositionPct + hysteresis` and targets THE INVESTOR'S cap (a 10% cap trims at 15%; a 35% cap never over-trims to 20); every `Recommendation` carries `theme` + `policyBasis` ("your concentration cap — at most 20% in a single position") rendered on each DecisionCard; `ImpactEstimate.themeDeltas` decomposes each trade per theme and `DecisionCard.themeTradeoff` names opposing movements; `constraintsFromPolicy()` (optimize.ts) derives hard trade constraints (position cap / cash floor / illiquidity ceiling) for the cash-deployment routes, which now also `evaluate(…, loadInvestorPolicy())` instead of silently using defaults. The policy editor's Advanced mode re-scores the DRAFT policy live through `computeAlignment` on the report's own facts ("Score with this policy: 64 → 90") and prints the measured value beside every limit. Remaining stage-3+ consumers (documented, not yet wired): optimize() itself, position-size/buy routes, `computeConcentration` thresholds, Risk Lab tolerance lines, simulator profile seeding, home threat gating. Tests: `tests/portfolio-decisions-policy.test.ts`. Three-layer architecture: OBJECTIVE FACTS (allocation/risk engines, deterministic) × INVESTOR POLICY (`policy.ts` — the investor's own priorities 0-3 per theme and tolerances in real units: max position %, max drawdown %, liquidity floor, cash band, required yield; persisted per portfolio in `portfolio_policy`, validated only by `parseInvestorPolicy`, assumed defaults carry `confirmed: false` and every surface says so) → ALIGNMENT (`engine.ts` — seven themes: structure vs goal band, downside vs stated tolerance (worst of observed drawdown and factor-scenario stress), concentration (single-name cap + correlated clusters counted as ONE bet via `cluster.ts`, sharing risk.ts's `HIGH_CORRELATION_R`), liquidity vs stated need, and CONDITIONAL income/inflation/exposure that score only when the investor opts in — otherwise they render as facts). One documented ruler (`toleranceScore`: 100 inside, 75 at your limit, 20 at 2×, exponential tail so delta engines never hit a dead zone). Weights are the investor's priorities renormalized over measurable themes; unmeasurable themes are excluded BY NAME (`dataGaps`); under 50% measurable → `status: "insufficient"`, no number. No letter grades, no AI anywhere in the score — AI interprets (thesis, intelligence synthesis) and challenges (the panel's "Challenge my assumptions" hands policy + facts to the assistant), never computes. `AlignmentReport.scoreExact` is the substrate for every before/after delta (sizing, cash, decisions, optimizer preview) under ONE policy carried on `PortfolioEvaluation.policy`. UI: `alignment-panel.tsx` (mismatches lead, stated/actual/excess in real units) + `policy-editor.tsx` (8 recognition-over-composition questions, advanced mode exposes derived weights/limits directly). Tests: `tests/portfolio-alignment.test.ts`, `tests/investor-policy.test.ts`.

**Decision Memory & Investment Discovery** (2026-08-15, `lib/portfolio/engines/decision-memory.ts` + `discovery.ts`): the anti-repetition layer. Every recommendation has a THESIS KEY (`thesisKeyOf`: `reduce:SYM` for any trim of that position, `exit:SYM`, `gap:KIND` ticker-agnostic, `discover:SYM`) — the underlying action's identity, immune to regenerated ids/wording/sizes. Dismissals persist per `(portfolio, thesisKey)` in `decision_dismissal` WITH revival context (policy updatedAt, subject weight, owning theme's score); `applyDecisionMemory` filters the pipeline in report.ts BEFORE cards exist, so Decisions, Today's attention queue, home spotlight and digest share ONE memory (Today's action seeds carry `thesis`; the attention dismiss route writes the same store; snoozes stay presentation-only). Revival ONLY on material change (`revivalReason`: policy changed / subject grew ≥`REVIVE_WEIGHT_GAIN_PP` / theme fell ≥`REVIVE_THEME_DROP_PTS`) — no TTL; revived cards state why they're back; dismissal ≠ policy exception (the alignment mismatch/facts stay visible). Both `policyVersion` AND `memoryVersion` are part of the `portfolioReport` cache key — the invalidate/in-flight race cannot serve pre-dismissal or pre-policy-change decisions. When <3 corrective theses survive, `computeDiscovery` proposes ≤2 INVESTIGATE cards from the investor's own WATCHLIST + the curated exposure list only: no quote/history → no proposal; simulated against the policy (rejected if alignment falls or any theme drops >1.5pts); evidence visible (measured correlation vs the 5 largest positions, class-adapter score, watchlist notes, simulated theme gains); one proposal per role; never a symbol/asset-class an active OR suppressed ADD already covers; rendered with "Research X" as the only primary action ("an opportunity to investigate, not an instruction to buy" — resolveDecisionExecution hard-codes this before the change shape is read). Dismiss/restore: `/api/portfolio/decisions/dismiss` + the DecisionCenter's "Considered and set aside" strip. Tests: `tests/portfolio-decision-memory.test.ts`.

**AI Portfolio Manager** (`CIOPanel` + `/api/portfolio/audit` + `/api/ai/portfolio-brief`): the orchestration layer. Streams an institutional CIO memo (audit) and generates a daily headline brief. Both independently gather Sector Rotation (`lib/sector-rotation.ts`) and Watchlist Intelligence (`lib/ai-watchlist.ts computeWatchlistAlerts`) evidence server-side and weave it into the prompt — orchestration by richer prompt inputs, not by recomputing anything those engines already compute. Same `ReadableStream`/`runPrompt` patterns as every other AI feature; no new plumbing.

**Portfolio Intelligence** (`lib/portfolio/intelligence/`, Intelligence tab, `/api/portfolio/intelligence`): the portfolio critic — treats the portfolio as a SYSTEM rather than a list. A registry of pure detectors (`detectors.ts`) runs over the report the page already computed plus fund constituents from the screener's `getFundDetails` extractor (`lookthrough.ts`): look-through single-company concentration ("you own more NVDA than you think", exact arithmetic, presented as a lower bound because Yahoo reports only top-10 constituents), fund overlap/redundancy, single names re-creating a held fund, correlation clusters (false diversification), hidden sector bets vs the stated breakdown, hidden risk drivers from attribution, and hedged behavioural patterns (winner concentration, anchoring, home bias, passenger positions, internal hedges/factor tensions). Every evidence line is labelled observed/derived; detectors emit nothing rather than guess, so `allClear` is a reachable, honest state, and opaque funds are disclosed as unknown — never zero. The only AI call is the executive-summary synthesis (`synthesis.ts`, thesis-pattern: settled findings in, `portfolio-intelligence` task, findings-content-hash cache in `scanner_cache`, deterministic fallback, failures never cached). "What changed" diffs each run against the previous persisted baseline (`portfolio_intelligence_snapshot`, singleton row, no global prune — `engine.ts diffSnapshots`); an unchanged portfolio keeps its baseline so "since" always points at the last real change. Adding a detector = one function + one `DETECTORS` entry. Tests: `tests/portfolio-intelligence.test.ts`.

---

### Watchlist (`app/watchlist/page.tsx`)
**Purpose**: An attention-management surface, not just a table: every visit opens
with what changed since the last one and which names need attention *and why*,
above the ranked, sortable list of tracked names — the level you are waiting for
on each, whether it belongs in your book, and the thesis behind it.

**The Pulse / attention model** (`lib/watchlist-pulse.ts`, pure + client-safe,
tested in `tests/watchlist-pulse.test.ts`): the single place "where does my
attention belong?" is answered. `computeAttention()` fuses live-price signals
(target crossed/approaching, ≥5% day move) with server context (`/api/watchlist/
pulse`: alerts delivered since the visit baseline, material timeline events,
earnings proximity, thesis drift, price drift since last visit) into one verdict
per row — a level (`act`/`watch`/`quiet`) plus the reasons. **The reasons are the
product; the numeric score only ranks and is never displayed.** Rendered as the
`PulseBrief` triage ledger (top of page; clicking a line opens that row's
decision file via the DataTable's controlled `expandedKey`), an attention dot in
the symbol cell, and `watch`/`alert` row tones.

**"Since your last visit"** (`watchlist_visit` + `watchlist_price_snapshot`,
`touchWatchlistVisit` in `lib/db.ts`, tested in `tests/watchlist-visit-db.test.ts`):
reads within 45 minutes of each other are one *session*; the first read after a
longer absence promotes the previous session's closing prices to the new baseline.
So refreshing never destroys the diff, and Monday opens against Friday's read.
Alerts "since last visit" come from the existing notification table
(`listNotificationsSince`) — same rows the bell delivered, no second system.

**Thesis as an object** (`watchlist.buy_trigger/sell_trigger/conviction/horizon/
last_reviewed_at`): the free-form note stays the thesis text; the structured
fields capture what would change the user's mind and how sure they are.
`ThesisModal` edits all five; any thesis write stamps a review (`markWatchlistReviewed`,
also exposed as `PATCH {reviewed:true}` for "re-read, still stands"). **Thesis
drift** (`computeThesisSignal`) is a deterministic importance-weighted tally of
classified timeline events since the last review — strengthening/weakening/mixed/
quiet with the driving headlines, explicitly evidence-not-verdict, never
"invalidated". Rendered in the drawer's `WhatsNew` column alongside developments
(persisted timeline events with impact dots + source links + honest "checked Xh
ago" freshness) and fired alerts.

**List health**: `computeWatchlistHealth` counts no-thesis / no-target / not-
reviewed-in-90d; the line under the table renders each count as a click-to-filter,
so noticing is fixing.

**Columns** (all sortable, nulls sink in both directions): Attention (unlabeled
dot column — sortable, and the smart DEFAULT sort: what deserves a look reads
first, with the triage panel explaining why) · Symbol (ticker + name only) ·
Last · Today · My target (whole cell click-to-edit; states: Set / level+direction /
near / reached) · Upside · Consensus (level AND implied return in one cell,
sorted by the return — the only leg comparable across names) · From high ·
Portfolio fit · Stage · Sector · Next event (earnings proximity, links to
/calendar; replaced "Added", which is drawer material) · Thesis (conviction dot +
text). **One fact, one place**: ownership lives ONLY in Stage (rendered through
`effectiveStage`, so a held name always reads Owned), alert/attention state ONLY
in the attention column + row tone + target cell — the old symbol-cell badge
cluster (Owned/Alert/✎) said everything twice and is gone.

**Customize** (`watchlist-settings.tsx` + `lib/watchlist-settings.ts`, persisted
to `uaa.watchlist.settings`, sanitized on every read): which quick-filter chips
render and in what order (from a catalog incl. Not owned / Near target / High
conviction), the filter the page opens on (the active filter is session state,
so arrival is predictable), column visibility (Symbol/Last/Today fixed), the
default sort, and the two attention thresholds that are genuinely taste —
earnings horizon (7/14/30d) and big-move bar (3/5/8%), threaded into
`computeAttention` as overrides. Changes apply and persist instantly; a
brand dot on the trigger marks a personalised view; defaults need zero
configuration. Health-line filters (No thesis / No target / Stale review) stay
reachable regardless and appear as a chip only while active.

**Vocabulary** (deliberate, and load-bearing):
- **"My target"** — the *user's own* target (`watchlist.target_price`), never the
  analyst consensus, which Research labels "Mean target". An unqualified "Target"
  read as consensus.
- **"Upside"** — `(target − price) / price`, positive green, identical to the
  analyst card, `/dcf`, `/compare` and `/ic-report`. Replaced "To target", which
  computed `(price − target) / target` and coloured negatives green.

**Shared math** (`lib/watchlist-metrics.ts`, pure + client-safe, tested in
`tests/watchlist-metrics.test.ts`): `upsidePercent`, `isTargetReached`,
`resolveTargetDirection`, `distanceToTargetPercent`, `percentFrom52WeekHigh`,
`rangePosition52Week`, `daysSince`/`formatAge`, `isUsablePrice`. **The page, the
alert evaluator (`lib/alerts.ts`) and the CSV export all import it** — they
previously each implemented the target rule themselves, with two of the three
contradicting each other.

**Target direction** (`watchlist.target_direction`, `"above" | "below"`): `above`
is a valuation/exit level, `below` a buy limit. Stored, not inferred — once the
price crosses an `above` target it is indistinguishable from an un-hit `below`
one. `runMonitor` backfills NULL (pre-migration) rows because it is the only
caller holding both live prices and the database.

**Per-Ticker Data**: my target + its trigger direction, single-day drop alert
threshold, thesis note, idea stage, live price/change/52-week range, portfolio fit.

**Workflow**: add from Research/Screener → set a target (live upside preview and
quick-fills in the editor) → write a thesis with triggers → advance the idea
stage → Buy. Sort key, direction, density and quick filter persist to
localStorage. `/` focuses the filter, Escape clears it.

**Pulse route economics** (`/api/watchlist/pulse`): one request per page load for
the whole list. Reads are local (timeline events, notifications, snapshots — all
SQLite); network work is the batch quote (15s platform cache) plus a 30-minute-
cached earnings sweep. News/filings syncs for up to 6 stale symbols are kicked
off fire-and-forget and reported via `checking`; the client does exactly ONE
delayed follow-up read to collect them. `WatchlistDigest` v2 (the opt-in
"Watchlist Brief") feeds the same user context — targets with distance, thesis
excerpts, conviction, recent developments — into `buildDigestPrompt`, and returns
`topChanges` / `researchNext` / `portfolioImplication` alongside the v1 fields.

**Explaining Portfolio fit**: the fit column is a `<ScoreChip kind="fit">`
(confidence shown inline only below 70, where it should change the reading) and
the expanded row renders the shared `PortfolioFitPanel` — ring, six weighted
dimensions, reasons, trade-offs, suggested allocation. All pre-existing
`PortfolioFitAnalysis` output that the page simply never surfaced.

**Named lists** (`watchlist_group` + `watchlist_member`): lists are *views* over
tracked symbols, not containers. Membership lives in a join table while each
symbol's research state (target, thesis, stage) is stored once in `watchlist` — so
one symbol can appear in several lists with one target, and deleting a list moves
its orphans to a survivor rather than destroying months of notes. `listWatchlist()`
stays **unparameterized and returns everything**, because ten unrelated consumers
(alert monitor, timeline, knowledge graph, calendar, home digest, the board view,
CSV export, AI digest) mean "everything I track"; `listWatchlistByGroup(id)` is the
scoped read. Each list carries its own `benchmark`, which adds a "vs SPY" column
computed from the same batch quote request. Reorderable; the active list, sort,
direction, density and quick filter all persist per user.

**Live prices** (`lib/live-quotes.ts` + `app/watchlist/_components/use-live-quotes.ts`):
polling, because no streaming feed exists in this stack. The engineering is in
*when not to poll* — a hidden tab does not poll at all, closed markets drop from a
30s to a 300s cadence (`estimateMarketStatus` per listing region, so one Indian
name or any crypto keeps a list live), errors back off exponentially to a 10-minute
cap, one request is ever in flight, and returning to the tab refreshes immediately.
A failed poll never clears good prices; staleness is stated through an explicit
"as of" indicator. One batch request per refresh covers all holdings plus the
benchmark. Changed prices flash via `animate-tick-up/down`.

**Crossing-based alerts** (`lib/price-crossing.ts` + `price_alert_state`): the
notification bell fires on a *transition*, not a state — see the AGENTS.md rule.
The table's row badge remains state-based ("this is at/past your level right now")
while notifications are event-based ("it just crossed"); that split is deliberate.
Dedup keys carry the level, its direction and the UTC day, so re-targeting is a new
alert and a level crossed on two days reports twice.

**Analyst consensus**: `analystTargetMean/High/Low` + `analystOpinions` on
`StockFundamentals`, mapped in `lib/enrich.ts` from Yahoo's `financialData` module
which that call **already requests** — so consensus for all 57 names costs zero
extra round-trips. Surfaced as its own `Consensus` / `Cons. upside` columns beside
the user's own, and as an opt-in "Use consensus as my target" action in the editor.
Never auto-filled: "My target" means the user's number.

**Target history** (`watchlist_target_history`): append-only revisions written by
`updateWatchlistItem` when a target or its direction actually changes (a re-save of
the same value records nothing), with an optional rationale captured in the editor.
Loaded on demand in the expanded row; the list payload carries only a count.
`backfillTargetDirection` exists so the monitor can populate a never-set column
*without* fabricating a revision or re-arming crossing detection.

**Virtualization** (`lib/table-window.ts`): windowed rows past
`VIRTUALIZE_THRESHOLD` (120) inside a bounded scrollport. Spacer rows carry the
hidden scroll height; `aria-rowcount`/`aria-rowindex` announce the true size;
arrow/Home/End/PageUp/PageDown move by index and focus is applied from an effect
once React has mounted the target. The expanded row stays mounted when scrolled
away so the content height — and therefore the scrollbar — never jumps.

**State**: `watchlist` (research: target, thesis + triggers/conviction/horizon/
last-reviewed, stage), `watchlist_group` / `watchlist_member` (lists),
`watchlist_target_history` (revisions), `price_alert_state` (crossing baselines),
`watchlist_visit` + `watchlist_price_snapshot` (visit baseline). View preferences
in localStorage (`uaa.watchlist.*`).

**API Dependency**: `/api/watchlist` (GET list, POST add, **PATCH** target/
direction/alert/notes/triggers/conviction/horizon/`reviewed` — validating, not
coercing; a target of `0` or `-5` is rejected rather than stored, DELETE remove),
`/api/watchlist/pulse` (change context), `/api/watchlist/fit` (fit inputs),
`/api/quote` (live prices, non-fatal), `/api/watchlist/pass` (pass with a
journaled reason / reactivate), `/api/ai/watchlist`.

**Workflow model (2026-08 consolidation — replaced the Portfolio "Pipeline" tab)**:
the Watchlist is the one workspace for unowned ideas. Workflow state is DERIVED,
never hand-set: `lib/ideas/evidence.ts` reads observed evidence (Research Hub
recency via the durable `watchlist.last_researched_at` stamp + visit log, AI
research sessions, research notes, valuation cases, journal entries) and the
ledger, and derives `new → working → ready → waiting` with `owned/passed/exited`
as outcomes. Thesis is an artifact (the thesis-modal fields), not a stage —
writing it IS the transition. Passing requires a reason and writes a closed
journal decision (`passIdea`). Two views over the same rows (table + board), a
"Needs You" queue of open decisions (disjoint from the Pulse's market events),
and a per-row next action. `/portfolio?tab=pipeline` deep links redirect to
`/watchlist?view=board`.

**Related**: `lib/db.ts` (CRUD + `getIdeaEvidence`/`passIdea`), `lib/ideas/`
(evidence → workflow → next action; `rows.ts` adapts to the relevance engine),
`lib/portfolio/engines/idea-relevance.ts` (impact ranking, verdicts, five-question
rationale), `lib/watchlist-metrics.ts` (all arithmetic), `lib/watchlist-pulse.ts`
(attention model), `lib/timeline.ts` (developments), `lib/idea-stage.ts` (stored
stage vocabulary + ledger auto-transitions), `lib/ai-watchlist.ts` (digest +
Watchlist Intelligence structured alerts), `app/_components/ui/data-table.tsx`.

**Used By**: Opportunity tracking, portfolio scouting, watch list management.

**Watchlist Intelligence** (`lib/ai-watchlist.ts computeWatchlistAlerts()`): structured, deterministic per-asset alerts (new_opportunity, deteriorating, breakout, sector_leadership, valuation) computed from the same summaries `generateWatchlistDigest()` already fetches — no extra network round-trip. Exposed as `WatchlistDigest.alerts`, rendered by `app/watchlist/_components/watchlist-alerts.tsx`. Auto-promotion: `/api/portfolio/new-positions` reuses this to flag `autoQualified` candidates for the AI new-position recommender.

**Architecture constraint learned the hard way**: `lib/portfolio-analytics.ts` is imported by both server routes and client components (for its types/constants). It must never import anything that transitively reaches `lib/db.ts` (node:sqlite, server-only) — e.g. `lib/sector-rotation.ts` does reach `db.ts`, so `portfolio-analytics.ts` takes rotation data as a plain parameter instead of importing the module. Check the *whole* import chain, not just the direct import, before adding a dependency to a dual-use file.

**Background alert monitor** (`lib/monitor.ts`, `instrumentation.ts`): watchlist/portfolio alerts no longer depend on a browser tab being open or an external cron. `instrumentation.ts`'s `register()` (Next's server-start hook, node runtime only) calls `startMonitorScheduler()`, which runs `runMonitor()` — the same logic behind `POST /api/monitor/run` and `scripts/monitor.mjs` — on a timer (`UAA_MONITOR_INTERVAL_MS`, default 5 min, floored at 60s, `0` disables). A `Symbol.for` global guard keeps it idempotent across dev hot-reloads. The header bell's 90s poll and this timer both evaluate the same alerts safely because `createNotifications` dedupes per condition per 24h.

---

### Research Notes (`lib/db.ts` + components)
**Purpose**: Per-symbol free-form notes persisted across sessions.

**Storage**: `research_notes` table (symbol, content, created_at).

**Lifecycle:**
- User adds note while reading research page
- Note persisted to SQLite
- Notes retrieved when user views same symbol again
- Notes integrated into research copilot context

**Used By**: Research page, IC Report (context for agents), Copilot (conversation history).

---

## User State & Persistence

### SQLite Database (`lib/db.ts`)
**Purpose**: All persistent user state (watchlist, portfolio, notes, copilot sessions).

**Tables:**
- `watchlist` (symbol, name, target_price, `target_direction`, alert_pct_drop, notes, added_at, stage, stage_changed_at) — per-symbol research state, stored once
- `watchlist_group` (id, name, benchmark, sort_order, created_at) — named lists
- `watchlist_member` (group_id, symbol, added_at) — list membership; a symbol may be in several
- `watchlist_target_history` (symbol, previous/new target + direction, note, changed_at) — append-only revisions
- `price_alert_state` (symbol, last_price, last_change_percent, last_seen_at) — crossing-detection baseline
- `portfolio` (symbol, shares, avg_cost, added_at)
- `research_session` (id, symbol, created_at, updated_at) — copilot sessions
- `research_message` (session_id, role, content, created_at) — copilot messages
- `research_notes` (symbol, content, created_at)
- `fundamentals_cache` (symbol, data JSON, updated_at) — 24h TTL
- `scanner_cache` (cache_key, result JSON, created_at) — event screener results
- `intel_event` (fingerprint, symbol, status, created_at) — intel rail suppression ledger; statuses age out at different rates (shown 30m, opened 3d, dismissed 14d)

**Pattern**: All read/write operations via `lib/db.ts` CRUD functions. Never direct SQLite calls from pages/routes.

**Used By**: Every module that needs persistent state.

---

## Specialized Analysis

### Contextual Research Intelligence (`lib/intel/` + `app/_components/intel-rail.tsx`)
**Purpose**: the intel rail — at most three quiet, dismissible cards on the right edge of research surfaces (Research, Compare, Portfolio, Watchlist, Wire) surfacing the next question worth asking. Its resting state is nothing: candidates must clear an absolute relevance threshold (`lib/intel/score.ts`) or no UI renders at all.

**Pipeline** (`GET /api/intel?surface=&symbols=`):
1. `lib/intel/engine.ts` builds a snapshot through the platform data layer (`intelCards` dataset, 90s TTL) — every input (quote, news, calendar, peers, portfolio report) is an existing platform dataset, soft-deadlined at 8s each so one slow provider costs a candidate, never the set.
2. `lib/intel/candidates.ts` — pure, unit-tested builders: material news events (tier-gated, hard materiality gate on headlines), earnings proximity, day-move/valuation-vs-peers/52-week anomalies, portfolio weight & sector-impact arithmetic, concentration-driven compare suggestions (max one per set, stricter threshold), list movers. All directional conclusions computed in code.
3. `lib/intel/score.ts` — seven-dimension scoring (relevance/materiality dominate), thresholding, category-diverse selection of ≤3.
4. Optional AI pass (`contextual-intel` task, `intelAi` dataset 30m): fired in the background after the deterministic set is served — never awaited — and handed only SETTLED FACTS; it may return at most one extra observation (or `[]`), labeled "AI interpretation" in the UI. `aiPending` tells the rail to poll twice more (20s/65s), then stop.

**Suppression**: `intel_event` table via `POST /api/intel/event` — `shown` fires only after 8s on screen (30m replay guard), `opened` 3d, `dismissed` 14d; fingerprints are stable across runs so dismissals stick.

**Actions**: `navigate` (internal routes or article URLs) or `assistant` — dispatches `OPEN_ASSISTANT_EVENT` with `detail.question`, which the AppAssistant now auto-asks, so the user never re-explains context.

### Market Dashboard (`app/page.tsx` + `/api/dashboard`)
**Purpose**: daily command-center view synthesizing every intelligence engine — no new business logic, pure composition.

**Aggregates (parallel-fetched, each independently best-effort)**:
- Market regime (`assessMarketRegime`, exported from `lib/scanner/index.ts` — deterministic, live macro/sector price data only, no AI event pipeline, so the dashboard loads fast)
- Sector Rotation leaders/laggards (`lib/sector-rotation.ts`)
- Portfolio alerts + top opportunities (from the cached `/api/portfolio/report`)
- Watchlist Intelligence alerts (`computeWatchlistAlerts`, no AI call)
- Upcoming calendar events (`/api/calendar`)

**Component**: `app/_components/market-dashboard.tsx` (self-fetching, client). Rendered above the pre-existing `DailyPulse` widget on the home page — `DailyPulse` is now one panel among several rather than the whole "Today's Pulse" section.

**Related**: `MASTER_ARCHITECTURE_BLUEPRINT.md` §6.6.

---

### Investment Timeline (`app/timeline/page.tsx` + `lib/timeline.ts`)
**Purpose**: the historical memory of a symbol/ETF, portfolio, watchlist, or sector — a durable, growing feed of classified events with AI-generated narrative and thesis-evolution tracking, not another news list.

**Core engine (`lib/timeline.ts`)** — deterministic classification/scoring, AI only for narrative synthesis (same "AI explains, engines decide" split as `lib/scanner/*` and `lib/movement-explainer.ts`):
- `classifyTimelineCategory` / `scoreImportance` / `scoreConfidence` / `deriveImpact` / `deriveCatalystStatus` — pure functions, keyword/heuristic classification into 28 event categories (earnings, guidance, M&A, executive changes, analyst actions, insider activity, sector rotation, portfolio impact, etc.)
- `syncTimelineEvents(symbol)` — assembles events from `lib/news.ts`, `lib/edgar.ts` filings, sector-rotation leadership changes (`getLatestSectorRotationSnapshots`), a best-effort read of the last cached Scanner auto-scan (`v2::true:true` in `scanner_cache`), and `lib/ai-watchlist.ts`'s `gatherWatchlistAlerts` — then persists newly-seen events (content-hashed ids, idempotent). Rate-limited to once per 15 min per symbol via `scanner_cache`.
- `syncSectorTimeline(sector)` — sector-scope events sourced only from Sector Rotation + cached Scanner data (no per-company news dilution).
- `computeThesisEvolution` — pure bounded-walk over importance≥50 events, tracking whether the thesis strengthened/weakened/stayed unchanged over time.
- `explainTimelineEvent` / `computeWhatChanged` — on-demand, cached AI calls (`runPrompt`) for the rich detail panel and "What Changed Since Then?" respectively.

**Persistence**: new `timeline_event` table in `lib/db.ts` (`id, symbol, timestamp, data JSON`), same shape/retention pattern as `sector_rotation_snapshot` — events accumulate permanently as the app is used, forming the "historical memory."

**APIs**: `/api/timeline` (feed, GET, scope=symbol|portfolio|watchlist|sector), `/api/timeline/detail` (AI event detail), `/api/timeline/what-changed` (AI retrospective).

**Integrations** (composition, no duplicated logic): embeds `MovementExplainerCard` (Explain Every Movement) for symbol scope; reads Sector Rotation snapshot history directly; reads cached Scanner/Opportunity Engine output; portfolio/watchlist scope resolve holdings via `lib/db.ts`'s `listPortfolio`/`listWatchlist` and reuse `gatherWatchlistAlerts`. Outbound links from Research, Scanner (`SignalCard`, `InvestmentThesisPanel`), Watchlist, Portfolio (including `CIOPanel`), and Compare all deep-link into `/timeline`.

**Route**: `/timeline?scope=&id=&<filters>` (flagship page, filters/thesis/visual timeline/detail drawer); `/timeline/[symbol]` is a thin redirect into symbol scope.

---

### Investment Knowledge Graph (`app/knowledge-graph/page.tsx` + `lib/knowledge-graph/`)
**Purpose**: an investment reasoning graph connecting companies, sectors, timeline events, market events, opportunities, and theses into one traversable network — computed on demand, not a persisted graph database. "Reference these engines as graph evidence providers," per the module's own design goal — nothing here is a new source of truth.

**Engine (`lib/knowledge-graph/`)**:
- `types.ts` — `GraphNode`/`GraphEdge` (10 node types, 10 relationship types today; the union types are designed to grow without touching build logic).
- `build.ts` — deterministic node/edge assembly. Composes: `lib/db.ts` (`listPortfolio`/`listWatchlist`/`listTimelineEvents(ForSymbols)`/`getLatestSectorRotationSnapshots`), `lib/fundamentals.ts` (sector lookup), and a best-effort read of the last cached Scanner auto-scan (`scanner_cache` key `v2::true:true`) for `MarketEvent` causal chains and `ScannerOpportunity`/`InvestmentThesis` evidence. Sector-to-sector `ROTATES_TO` edges are derived from real rank deltas between the current sector-rotation snapshot's entries — not fabricated correlations.
- `traverse.ts` — pure BFS `findPath`/`describePath` (edges treated as undirected for connectivity), plus `explainConnection` which narrates an already-found path via `runPrompt` (AI never invents the path itself).
- `recommend.ts` — pure `computeGraphInsights`: sector concentration (2+ owned companies sharing a sector), hidden opportunities (opportunity nodes not yet owned), emerging risks (high-importance bearish timeline events touching owned/watched companies), correlation clusters (sectors sharing a rotation classification).
- `index.ts` — `getKnowledgeGraph(scope, id)` orchestrates build + insights, cached briefly in `scanner_cache` (graph construction does several fundamentals fetches per symbol).

**Persistence**: none — the graph is rebuilt from existing stores on each request (cache-fronted), so it can never drift out of sync with Portfolio/Watchlist/Timeline/Scanner.

**APIs**: `/api/knowledge-graph` (nodes/edges/insights for a scope), `/api/knowledge-graph/explain` ("Why is this connected?" — path + AI narrative between two node ids).

**UI**: `/knowledge-graph` — force-directed graph via `d3-force` (the only new dependency this feature added; physics simulation only, rendering is plain React/SVG, not d3-selection DOM manipulation) with pan/zoom/drag implemented as local React state (no `d3-zoom`/`d3-drag`, kept minimal). Node size = importance, color = node type, edge thickness = relationship strength. Click a node for its detail panel + related entities; "Why is this connected to…?" picks a second node and highlights the path with an AI explanation.

**Integrations**: outbound "Graph" links from Research, Timeline, Portfolio (`CIOPanel` included), Watchlist, and Scanner's `InvestmentThesisPanel`, mirroring Timeline's cross-linking pattern.

---

### Opportunity Map (`app/opportunity-map/page.tsx` + `lib/opportunity-map.ts`)
**Purpose**: a visual discovery layer over the Scanner Opportunity Engine — "an orchestration and visualization layer, not another scoring engine." Every field on `OpportunityMapNode` is read directly from `ScannerOpportunity.profile` (`lib/opportunity-engine.ts`'s `buildOpportunityProfile`, already computed by the Scanner pipeline) — this module never re-scores, re-classifies, or re-generates a thesis.

**Engine (`lib/opportunity-map.ts`, single file — thin reshaping, not a subsystem)**:
- `getOpportunityMapData()` reads the last cached Scanner auto-scan (`scanner_cache` key `v2::true:true`, same key Timeline and Knowledge Graph read) and maps each `ScannerOpportunity` with a non-null `.profile` into an `OpportunityMapNode`. Returns an empty map (never fabricated data) if no scan has run yet.
- `buildClusters()` — pure, groups nodes by `theme` (already assigned by the Scanner pipeline) and ranks clusters by average opportunity score.
- Portfolio/watchlist membership tags (`inPortfolio`/`inWatchlist`) come from `lib/db.ts`.

**API**: `/api/opportunity-map` — read-only; never triggers a live Scanner pipeline run (that stays Scanner's job, a heavy multi-minute workflow).

**UI**: `/opportunity-map` with two visualization modes (deliberately not all 8 modes from the original spec — one polished galaxy view + one polished quadrant view, matching the "avoid overengineering" mandate and the Knowledge Graph's precedent of one flagship visualization over many shallow ones):
- **Opportunity Galaxy** (`bubble-view.tsx`) — `d3-force` bubble chart with a custom cluster force (pulls same-theme nodes toward a shared centroid each tick) for automatic thematic clustering. Bubble size = opportunity score, fill color = category, border color = risk tier, halo = conviction, pulse animation = high momentum (`|changePercent| ≥ 3%`), portfolio/watchlist ring overlay.
- **Risk/Return Quadrant** (`quadrant-view.tsx`) — Recharts scatter plot, x = expected risk tier, y = opportunity score, quadrant reference lines. Renders points via a custom `shape` function (not `ZAxis` size-scaling, which produced zero-radius symbols in this setup — see Verification Results) and measures its own container via `ResizeObserver` (Recharts' `ResponsiveContainer` measured 0×0 inside this page's CSS grid layout on first paint).

**Detail panel**: reuses `MovementExplainerCard` (Explain Every Movement) and `PortfolioFitBadge` (lazily fetched from the existing `/api/ios/fit` route — Portfolio Fit is never precomputed for every node upfront) plus deep links into Timeline, Knowledge Graph, Compare, and Research.

**Filters**: theme, category, conviction, risk, min score, tier (`highConviction`/`developing`, reusing Scanner's own segmentation), portfolio-only, watchlist-only.

---

### DCF Valuation (`app/dcf/page.tsx`)
**Purpose**: Intrinsic value calculator with sensitivity analysis.

**Inputs:**
- Historical fundamentals (revenue, FCF, growth rates)
- User assumptions (terminal growth rate, discount rate, margin assumptions)
- Time horizon (explicit forecast period)

**Outputs:**
- Intrinsic value (NPV of future FCF)
- Upside/downside vs. current price
- Sensitivity table (value vs. discount rate × terminal growth)

**Related**: `lib/fundamentals.ts` (statement parsing), `lib/profile.ts` (company sector/industry).

**Used By**: Valuation-driven investment decisions.

---

### Earnings Calendar (`app/calendar/page.tsx`)
**Purpose**: Earnings calendar with event dates and pre/post-event performance.

**Data:**
- Earnings dates (ETFs, indices, calendars)
- Pre/post event returns (stock performance in N days before/after)
- Sector-level earnings seasonality

**API Dependency**: `/api/calendar` fetches earnings calendar data.

**Used By**: Event-driven traders, earnings surprise research.

---

### Quant Engine — the systematic desk (`app/engine/page.tsx`)
**Purpose**: answer *"what opportunities is the market creating today, and why?"* —
a market-wide, model-driven view, explicitly not another per-company workspace.
The module boundary against its neighbours is the whole point:

| Module | Question | Unit of analysis |
|--------|----------|------------------|
| Research Hub | What do we think about this company? | one name |
| Compare | Which of these is better? | 2–5 names |
| Screener | Which names pass my filters? | user-defined filters |
| **Quant Engine** | **What is the market creating today, and why?** | **the whole scored universe** |

Consequences of that boundary, all deliberate: the desk owns regime detection,
probability distributions, adaptive factor weights, and Kelly position sizing —
none of which exist elsewhere in UAA. It does **not** own company narrative,
filings, news, or AI theses; the conviction book links out to `/research` and
`/ic-report` for those instead of duplicating them. (The old page embedded a full
batch IC-report runner and viewer; that was a copy of `/ic-report` and was removed.)

**Page structure** (`app/engine/_components/`), ordered by cost so first paint never
waits on the slowest computation:

| Section | Component | Source |
|---------|-----------|--------|
| Market regime | `regime-hero.tsx` | brief |
| Changed today | `changed-today.tsx` | brief |
| Conviction book | `conviction-book.tsx` | brief |
| Factor lab | `factor-lab.tsx` | brief |
| Market breadth | `breadth-map.tsx` | brief |
| Full scorecard | `scorecard-table.tsx` (code-split) + `detail-panel.tsx` | Parquet |
| Model health | `model-health.tsx` | signal log |
| Model validation | `model-validation.tsx` | on demand only |

Shared visual grammar lives in `desk-primitives.tsx` (`ZBar`, `ProbMeter`,
`ProbBand`, `Sparkline`, `RegimeChip`); the long-page navigator is `desk-rail.tsx`;
shared types and vocabulary (signal tiers, regimes, factor definitions) are
`lib/engine-desk.ts`.

**Lifecycle:**
1. `python -m engine.daily_run` runs the pipeline (separate process, not integrated with `npm dev`)
2. At **each** export stage it publishes two artifacts, so the UI fills in progressively
   rather than waiting for the slowest stage:
   - `data/scorecard_snapshot.parquet` — per-name scores (atomic tmp+rename)
   - `data/engine_dashboard.json` — the market-wide brief (`engine/dashboard.py`)
   - `data/engine_progress.json` — current stage + names published
3. Next.js reads those files. Nothing on the read path opens `engine.duckdb`.

**Why file-first matters (the "engine appears to hang" fix)**: the brief's queries
against `engine.duckdb` are individually instant, but *opening* a multi-GB DuckDB on
a cold page cache measured over two minutes. So the brief is precomputed during the
run and served as a file (~1ms). `/api/engine/dashboard` falls back to
`python -m engine.dashboard` only when the file is absent, under a hard timeout, and
returns an explicit `degraded` brief rather than hanging. Every read route is
bounded via `runEnginePython()` (`lib/engine-python.ts`), and `/api/engine` memoises
the parsed Parquet on the file's mtime+size — which turned a repeated ~1.8s Python
spawn into a ~15ms response.

**Routes**:
- `GET /api/engine/dashboard` — the brief (file → memo → bounded rebuild → degraded)
- `GET /api/engine` — scorecard rows (memoised); `POST` streams a run's stdout
- `GET /api/engine/progress` — current stage of an in-flight run
- `GET /api/engine/detail?symbol=` — one name's full working (bounded)
- `GET /api/engine/oos-metrics` — continuous live-IC self-monitoring
- `GET|POST /api/engine/validation` — GET reads the cache, POST runs the study

**Model Validation absorbed the standalone `/backtest` page.** "Do these signals
work" is not a separate workflow from the desk that produces them. `lib/backtest.ts`
(pure, unit-tested) is unchanged and reused; only the trigger semantics moved — it is
now POST-only and never fires on page load, because it fetches price history for
every logged signal. `app/backtest/` and `app/api/backtest/` were deleted.

**Not Real-Time**: snapshot-driven, not live quotes. For live screening use `/screener`.

**Used By**: Systematic traders, factor-driven strategies, signal validation.

---

### AI Orchestration Layer (`lib/ai/*`)
**Purpose**: single entry point for every AI request in the app, routing each
task to the Claude effort tier best suited to it and falling back
automatically if that attempt fails. The backend is the Anthropic API
(claude-opus-5), reached with the user's own key (`lib/ai/anthropic-key.ts`).
Full design doc: `lib/ai/ARCHITECTURE.md`.

**Request flow**: feature code → `runPrompt(taskType, prompt, opts)` (or
`runTask`/`runTaskText` for the raw normalized response) → Orchestrator
(`lib/ai/orchestrator.ts`) → Router (`lib/ai/router.ts`) → `AIProvider`
(`lib/ai/providers/anthropic-provider.ts`) → api.anthropic.com. Nothing above
the Router names a model or talks HTTP.

**Layering**:
- `lib/ai/task-registry.ts` — the **Task Registry**: every `TaskType` in the
  app (company research, SEC filing analysis, portfolio intelligence, IC
  agent domains, etc.) mapped to its preferred model order, temperature,
  token cap, timeout, and required capabilities. This is the one place task
  → model routing policy lives.
- `lib/ai/models.ts` — the **Model Registry**: `MODEL_REGISTRY`, one
  `ModelSpec` per routable id (id, provider, context window, temperature,
  token cap, timeout, capabilities, priority, enabled). Today: the three
  effort tiers `claude-opus-5-low|-medium|-high`, matched exactly.
- `lib/ai/router.ts` — turns a `TaskType` into an ordered, installed,
  capability-matching, currently-healthy candidate list and runs the
  provider against it, retrying the next candidate silently on failure.
  Throws `AllModelsFailedError` only when every candidate failed.
- `lib/ai/health.ts` — lightweight in-memory per-model failure tracking that
  deprioritizes (not excludes) a model after repeated failures.
- `lib/ai/provider.ts` + `lib/ai/providers/anthropic-provider.ts` — the
  `AIProvider` interface and its only implementation today: the Anthropic
  SDK with an explicit `baseURL`, real token streaming, and effort-tier
  translation. Adding a future provider means one new class here — no other
  layer changes.
- `lib/ai/response.ts` — `AIResponse` normalizer: every provider's output
  becomes `{ content, confidence, reasoningSummary, executionTimeMs, model,
  provider, tokenUsage, errors, metadata }`. Nothing downstream branches on
  provider/model shape.
- `lib/ai/orchestrator.ts` — `runTask`/`runTaskText`, the single entry point.
- `lib/ai.ts` — thin façade over the orchestrator: `runPrompt(taskType,
  prompt, opts)` / `runPromptWithMeta()` / `analyzeAsset()`; 20+ engines call
  this, never fetch directly.
- `lib/ai/prompt-builder.ts` — reusable, versioned system/developer/user
  prompt templates (additive; the Research Copilot's own `lib/ai/prompt.ts`
  predates it and stays as-is).
- `lib/analysis-prompt.ts` — pure prompt builder for `analyzeAsset()`'s
  quote+filings analysis (`/api/ai`; no HTTP).
- `lib/json-extract.ts` — the single JSON-from-LLM-response parser. Never
  hand-roll fence stripping in routes or engines.
- Graceful degradation when no API key is configured (UI shows the recovery hint).

**Research Copilot** (`lib/ai/context.ts`, `retrieval.ts`, `prompt.ts`,
`memory.ts`, `actions.ts`, `grounding.ts`) is a richer pipeline layered on
top for multi-turn, evidence-grounded chat — context assembly, intent-based
retrieval, dossier prompting, session memory, and post-hoc grounding
verification. It asks the Router for its model (`pickModel("company-research",
...)`) but keeps its own context/retrieval/memory machinery, which is
specific to that one feature.

**Adding a task**: add a `TaskType` + `TaskConfig` in `task-registry.ts`,
call `runPrompt("your-task", prompt, opts)` from feature code. No other file
changes.

**Configuration:**
- `ANTHROPIC_API_KEY` env var (demo/CI), or the key file `~/.uaa/anthropic_api_key`
  saved from `/settings` (`UAA_CONFIG_DIR` overrides the directory)

**Used By**: Research, IC Report, Compare, Watchlist, Portfolio, Thematic,
Scanner, Timeline, Knowledge Graph, Calendar, Screener NL query, Copilot —
every AI-powered feature in the app.

---

## Module Interaction Map

```
                    Yahoo Finance / screener.in / EDGAR
                              ↑
                              │
                    ┌─────────┼──────────┐
                    │         │          │
              Research    Screener    Compare
                    │         │          │
                    └────┬────┴────┬─────┘
                         │        │
                    Composite Scorer
                    Event Screener
                         │        │
                    ┌────┴────────┴────┐
                    │                  │
                 Scanner          IC Report
                    │                  │
                 Signals            9 Agents
                    │                  │
               Thematic Engine    Portfolio
                    │                  │
               (themes)              Fit Analysis
                    │
               ┌─────┼──────┐
               │     │      │
          Research  Watchlist  Notes
          (copilot)           (persistent)
               │              │
               └──────┬───────┘
                      │
                  SQLite DB
                      │
                  Persistent
                   User State
```

---

## Design Principles

1. **Single Source of Truth**: If logic can be computed, compute it once and reuse.
   - Example: the score→recommendation bands, labels, and tones live only in
     `lib/recommendation.ts`; both scoring engines and all UI route through it.

2. **Graceful Degradation**: Non-fatal failures return partial data, not errors.
   - Example: EDGAR failures don't crash research page; they show as "n/a".

3. **Parallel Fetching**: Fetch all independent data in parallel, not serial.
   - Example: `/api/research` fetches quote, history, filings, news all at once.

4. **Streaming for Long-Running**: Use `ReadableStream` for operations that take 2+ seconds.
   - Example: IC Report streams agent results as they complete.

5. **Cache at Fundamentals Layer**: Cache slows fundamentals (24h TTL), not prices.
   - Prices always fresh. Fundamentals refreshed on demand or 24h TTL.

6. **Module Isolation**: Modules don't know about each other's internal state.
   - They communicate via APIs and shared engines.
   - No cross-module imports except for types and shared utilities.

---

## Adding a New Feature

1. **Identify category**: Does it fit research, screening, analysis, or portfolio management?
2. **Check existing modules**: Can you extend an existing module instead of creating new?
3. **Map dependencies**: What engines does it need (scoring, screening, AI, etc.)?
4. **Design API route**: How does the page fetch data? Parallel vs. serial fetching?
5. **Implement domain logic** in `lib/`, exposed via route handler.
6. **Build page + components**, following module patterns.
7. **Add to state** (SQLite) if user data needs to persist.
8. **Update ARCHITECTURE.md** when complete.

---

## Test Coverage

Unit tests in `tests/[module].test.ts` for:
- Scoring formulas (`composite.test.ts`)
- Signal detection (`event-screener.test.ts`)
- Data parsing (EDGAR, screener.in)
- Formatting utilities

External API calls mocked or skipped in tests (don't hit live APIs).

### E2E tests (Playwright)

`e2e/` holds a **smoke** suite, not a full behavioral one: every page renders,
with no unfiltered console/page errors, plus a few deeper journeys. Run with
`npm run test:e2e` (`npm run test:e2e:ui` for the interactive runner).

- `e2e/pages.spec.ts` — one test per route (≥17 routes) asserting the header
  and page `<h1>` render and console is clean. Long-running pipelines
  (`/scanner`, `/ic-report`, `/thematic`) only assert their idle "start"
  affordance, never the pipeline result.
- `e2e/journeys.spec.ts` — three deeper flows: command-palette search →
  research (with `/api/search` mocked via `page.route`), a watchlist
  add/remove round-trip against the real (isolated) DB, and theme-toggle
  persistence.
- `e2e/helpers.ts` — the console-error tripwire (the highest-value assertion
  in the suite — catches hydration mismatches and client crashes that `tsc`
  + eslint + unit tests miss) and its allowlist of expected offline noise
  (no AI key, sometimes no network).
- Runs against a **production** build (`next build && next start -p 3111`)
  against an **isolated** SQLite DB at `e2e/.tmp/e2e.db` — never the real
  `data/app.db`. Fully offline-tolerant: no AI key required, AI panels must
  show their fallback state, and pages that hard-depend on live Yahoo quotes
  accept either data or their designed empty/error state.
- Kept fully separate from `npm run test` (Vitest): e2e specs live under
  `e2e/*.spec.ts`, outside Vitest's `tests/**/*.test.ts` include glob.
