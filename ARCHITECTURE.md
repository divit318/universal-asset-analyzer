# ARCHITECTURE.md: UAA Module System

Complete reference for every major UAA module: what it does, what it needs, what it produces, and how modules talk to each other.

## Core Data Sources

These are not modules but foundational services that other modules depend on.

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
- Single Ollama call synthesizes drivers (category, description, evidence, direction), confidence, and persistence classification
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
- AI analysis (via Ollama)

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

**AI Portfolio Manager** (`CIOPanel` + `/api/portfolio/audit` + `/api/ai/portfolio-brief`): the orchestration layer. Streams an institutional CIO memo (audit) and generates a daily headline brief. Both independently gather Sector Rotation (`lib/sector-rotation.ts`) and Watchlist Intelligence (`lib/ai-watchlist.ts computeWatchlistAlerts`) evidence server-side and weave it into the prompt — orchestration by richer prompt inputs, not by recomputing anything those engines already compute. Same `ReadableStream`/`runPrompt` patterns as every other AI feature; no new plumbing.

---

### Watchlist (`app/watchlist/page.tsx`)
**Purpose**: Tracked tickers with alerts, notes, bulk monitoring.

**Per-Ticker Data:**
- Target price (optional)
- Alert threshold (drop % at which to alert)
- User notes (free-form research notes)
- Current price, change, date added

**Workflow:**
- Add ticker (with optional target + alert)
- View list with latest prices
- Edit notes per ticker
- Remove ticker

**State**: Watchlist items stored in `watchlist` table (SQLite).

**API Dependency**: `/api/watchlist` (GET list, POST add, DELETE remove).

**Related**: `lib/db.ts` (CRUD), `lib/ai-watchlist.ts` (AI monitoring suggestions + Watchlist Intelligence structured alerts).

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
- `watchlist` (symbol, name, target_price, alert_pct_drop, notes, added_at)
- `portfolio` (symbol, shares, avg_cost, added_at)
- `research_session` (id, symbol, created_at, updated_at) — copilot sessions
- `research_message` (session_id, role, content, created_at) — copilot messages
- `research_notes` (symbol, content, created_at)
- `fundamentals_cache` (symbol, data JSON, updated_at) — 24h TTL
- `scanner_cache` (cache_key, result JSON, created_at) — event screener results

**Pattern**: All read/write operations via `lib/db.ts` CRUD functions. Never direct SQLite calls from pages/routes.

**Used By**: Every module that needs persistent state.

---

## Specialized Analysis

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

### Quant Engine (`app/engine/page.tsx`)
**Purpose**: Daily quant screening powered by Python DuckDB pipeline.

**Lifecycle:**
1. `python engine/daily_run.py` runs daily (separate process, not integrated with Next.js)
2. Outputs `data/scorecard_snapshot.parquet` (daily stocks + scores + signals)
3. Next.js reads Parquet via `/api/engine` (read-only)

**Output Structure:**
- Symbol, company name, sector
- Quant scores (momentum, mean reversion, value, quality, growth factors)
- Signals (detected by quant model)
- Backtest performance (out-of-sample returns)

**Not Real-Time**: Daily snapshot, not live updates. For live screening use `/screener`.

**Used By**: Systematic traders, factor-driven strategies, signal validation.

---

### AI Orchestration Layer (`lib/ai/*`)
**Purpose**: single entry point for every AI request in the app, routing each
task to the local model best suited to it and falling back automatically if
that model isn't available. Local-only by policy — no code path to any
hosted/paid provider. Full design doc: `lib/ai/ARCHITECTURE.md`.

**Request flow**: feature code → `runPrompt(taskType, prompt, opts)` (or
`runTask`/`runTaskText` for the raw normalized response) → Orchestrator
(`lib/ai/orchestrator.ts`) → Router (`lib/ai/router.ts`) → `AIProvider`
(`lib/ai/providers/ollama-provider.ts`) → Ollama. Nothing above the Router
names a model or talks HTTP.

**Layering**:
- `lib/ai/task-registry.ts` — the **Task Registry**: every `TaskType` in the
  app (company research, SEC filing analysis, portfolio intelligence, IC
  agent domains, etc.) mapped to its preferred model order, temperature,
  token cap, timeout, and required capabilities. This is the one place task
  → model routing policy lives.
- `lib/ai/models.ts` — the **Model Registry**: `MODEL_REGISTRY`, one
  `ModelSpec` per model (id, provider, context window, temperature, token
  cap, timeout, capabilities, priority, enabled). Prefix-matched against
  whatever's actually installed, so a registry entry like `"qwen3"` resolves
  a pulled `qwen3:30b-a3b` without pinning the exact tag.
- `lib/ai/router.ts` — turns a `TaskType` into an ordered, installed,
  capability-matching, currently-healthy candidate list and runs the
  provider against it, retrying the next candidate silently on failure.
  Throws `AllModelsFailedError` only when every candidate failed.
- `lib/ai/health.ts` — lightweight in-memory per-model failure tracking that
  deprioritizes (not excludes) a model after repeated failures.
- `lib/ai/provider.ts` + `lib/ai/providers/ollama-provider.ts` — the
  `AIProvider` interface and its only implementation today, wrapping
  `lib/ai/ollama.ts`'s HTTP/retry/typed-errors/`<think>`-tag splitting.
  Adding a future provider means one new class here — no other layer changes.
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
- `lib/ollama.ts` — pure prompt builder for `analyzeAsset()`'s quote+filings
  analysis (`/api/ai`; no HTTP, despite the name).
- `lib/json-extract.ts` — the single JSON-from-LLM-response parser. Never
  hand-roll fence stripping in routes or engines.
- Graceful degradation if Ollama offline (UI shows fallback message).

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
- `OLLAMA_HOST` env var (default: `http://localhost:11434`)

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
  (no Ollama, sometimes no network).
- Runs against a **production** build (`next build && next start -p 3111`)
  against an **isolated** SQLite DB at `e2e/.tmp/e2e.db` — never the real
  `data/app.db`. Fully offline-tolerant: no Ollama required, AI panels must
  show their fallback state, and pages that hard-depend on live Yahoo quotes
  accept either data or their designed empty/error state.
- Kept fully separate from `npm run test` (Vitest): e2e specs live under
  `e2e/*.spec.ts`, outside Vitest's `tests/**/*.test.ts` include glob.
