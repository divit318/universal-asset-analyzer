# PROJECT_ROADMAP.md: UAA Development Roadmap

Strategic overview of completed systems, active development, planned features, and architectural priorities for UAA.

**Current Branch**: `integration/best-of-both` (merging US + India variants)  
**Last Updated**: 2026-07-03  
**Main Reference**: ARCHITECTURE.md (module details)

---

## Completed Systems (Production-Ready)

### Phase 1: Core Research Platform (✅ Complete)
- **Research Page** (`/research`) — Deep single-stock analysis with copilot chat, historical data, filings, news
- **Research India** (`/research/india`) — NSE variant using screener.in API
- **Fundamental Screener** (`/screener`) — Multi-filter screening with composite scoring
- **Watchlist** (`/watchlist`) — Ticker tracking with alerts and notes
- **Comparison** (`/compare`) — Multi-stock side-by-side metrics (14 metrics across price/growth/valuation)
- **Portfolio Management** (`/portfolio`) — Holdings tracking, P&L, fit analysis, sector concentration
- **Research Notes** — Per-symbol persistent notes integrated into research workflow
- **Research Copilot** — Multi-turn conversation with context-aware retrieval (persisted sessions)

**Status**: Stable, no known bugs in research flows. Handles missing data gracefully.

---

### Phase 2: Advanced Analysis (✅ Complete)
- **Event Scanner** (`/scanner`) — Event-driven signals (earnings surprises, insider transactions, technical breaks)
- **IC Report** (`/ic-report`) — Institutional research via 9-domain parallel agent pipeline
  - Agents: business, industry, competition, management, capitalAllocation, accounting, valuation, governance, risk
  - Streaming results as agents complete
  - Confidence levels, data limitations per agent
- **DCF Valuation** (`/dcf`) — Intrinsic value calculator with sensitivity tables
- **Earnings Calendar** (`/calendar`) — Earnings dates and pre/post-event performance analysis
- **Thematic Analysis** (`/thematic`) — 10-stage thematic framework (supply chains, commodities, geopolitics, company tiers)

**Status**: Stable. IC Report multi-agent streaming pattern validated. Thematic engine framework complete.

---

### Phase 3: Quant Infrastructure (✅ Complete, Recently Audited)
- **Quant Engine** (`/engine`) — Daily DuckDB pipeline with factor scoring
  - Separate process: `python engine/daily_run.py` → `data/scorecard_snapshot.parquet`
  - Outputs: daily stocks, scores, signals, backtest performance
  - Read-only from Next.js (no live updates; daily snapshots)
- **Composite Scorer** (`lib/composite.ts`) — Value/quality/momentum scoring
- **Signal Detection** (`lib/event-screener.ts`) — Earnings, insider, technical, rotations
- **Universe Management** — S&P 500, Russell 2000, Nasdaq 100, sector filters
- **Feature Engineering** — Price returns, fundamental ratios, technical indicators
- **Regime Detection** — Hot/cold factor rotations via HMM
- **Out-of-Sample Validation** — Backtest OOS performance, quantile recalibration

**Recent Audits** (last 6 commits):
- Task G-I: PIT universe, quantile recalibration, live OOS validation
- Task A/B/E/F: Implemented, C/D empirically verified
- 6 confirmed bugs fixed (ratio dedup, timeout removal, DuckDB locks, regime caching, HMM convergence)

**Status**: Stable after comprehensive audit. Performance validated. Ready for production use.

---

### Phase 4: Data Integration & Enrichment (✅ Complete)
- **Yahoo Finance Integration** (`lib/yahoo.ts`) — Quote, history, summary (US equities)
- **screener.in Integration** (`lib/screener-in.ts`) — NSE fundamentals (India)
- **SEC EDGAR Integration** (`lib/edgar.ts`) — 10-K, 10-Q, 8-K filings with CIK caching
- **Company News** (`lib/news.ts`) — Recent news and press releases
- **Insider Data Enrichment** — Holdings, transactions, ownership structure
- **Analyst Consensus** — Earnings estimates, price targets, ratings
- **Currency Conversion** — INR ↔ USD for India-US comparisons
- **Data Fallback Strategy** — Yahoo fallback when screener.in missing fields

**Status**: Robust error handling. Non-fatal API failures. Parallel fetching for performance.

---

### Phase 5: UI/UX Foundation (✅ Complete)
- **Site Navigation** (`site-header.tsx`) — Module switcher, search bar
- **Daily Pulse** (`daily-pulse.tsx`) — Home page market summary
- **Toast Notifications** (`toast.tsx`) — User feedback
- **Dialog/Modal System** (`dialog.tsx`) — Reusable modals
- **Interactive Charts** — Recharts multi-line, candlestick, heatmap patterns
- **Responsive Design** — Tailwind CSS v4, mobile-friendly
- **Accessibility** — Semantic HTML, focus rings, skip-to-content

**Status**: Consistent design system. No component library (all utility classes). Dark mode support.

---

### Phase 6: Persistence & State (✅ Complete)
- **SQLite Schema** (`lib/db.ts`) — All tables and CRUD operations
  - Watchlist, portfolio, research sessions, notes, fundamentals cache, scanner cache
- **State Management Pattern** — Server components + API routes + React state hooks
- **Environment Configuration** — ANTHROPIC_API_KEY / UAA_CONFIG_DIR, DB_PATH env vars
- **iOS Environment Detection** (`lib/ios-context.tsx`) — Safe mode for iOS WebView

**Status**: Single source of truth. No direct SQLite calls from pages. Schema stable.

---

### Phase 7: AI Integration (✅ Complete; now Anthropic API, BYO key)
- **Inference** (`lib/ai/`) — graceful degradation when no key is configured
- **Feature-Specific Prompts** — Research, Compare, Watchlist, General Q&A
- **Streaming Responses** — `ReadableStream` for long-running operations
- **Multi-Turn Copilot** — Research copilot with conversation history
- **Agent Network** — 9 parallel agents for IC Report

**Status**: No external LLM APIs. All inference local. Tested with llama3.2.

---

## Investment Timeline (2026-07 — ✅ Complete)

Net-new feature: `/timeline`, the historical memory of every symbol/ETF, portfolio, watchlist, and sector — deterministic event classification (28 categories) + AI narrative/thesis-evolution on top of existing engines (Sector Rotation, Movement Explainer, Scanner cache, Watchlist Intelligence, Portfolio holdings). New `lib/timeline.ts` + `timeline_event` table + `/api/timeline*` routes. See `ARCHITECTURE.md` → "Investment Timeline" for the full design. Verified: typecheck clean, lint 0 errors, 263/263 tests passing (26 new), manually validated live (all 4 scopes, AI detail panel, What Changed Since Then, filters, cross-page integration links).

**Also fixed while building this**: `SymbolSearch` was duplicated via cross-module imports into `app/research/_components/` from 3 other pages (Compare, DCF, IC Report) despite being a shared component — moved to `app/_components/symbol-search.tsx` per this repo's own component-location convention.

---

## Investment Knowledge Graph (2026-07 — ✅ Complete)

Net-new feature: `/knowledge-graph`, a traversable reasoning graph over companies, sectors, timeline events, market events, opportunities, and theses. Computed on demand from existing stores (Portfolio, Watchlist, Sector Rotation, Timeline, Scanner cache) — no persisted graph database, no duplicated scoring logic. New `lib/knowledge-graph/` (types/build/traverse/recommend/index) + `/api/knowledge-graph*` routes + `d3-force`-powered visualization (the only new dependency added). See `ARCHITECTURE.md` → "Investment Knowledge Graph" for the full design. Verified: typecheck clean, lint 0 errors, 278/278 tests passing (15 new), manually validated live for all 4 scopes — including a real bug found and fixed during browser testing (a pan-drag race condition reading a stale ref inside a `setState` updater, `graph-canvas.tsx`) and a live end-to-end "Why is this connected?" AI explanation with path highlighting.

---

## Opportunity Map (2026-07 — ✅ Complete)

Net-new feature: `/opportunity-map`, a visual discovery layer over the Scanner Opportunity Engine — explicitly an orchestration/visualization layer, not a new scoring engine. Every node field is read from `ScannerOpportunity.profile` (already computed by `lib/opportunity-engine.ts` during the Scanner pipeline); the map only reshapes and clusters it. New `lib/opportunity-map.ts` + `/api/opportunity-map` + two visualization modes (Opportunity Galaxy via `d3-force` clustering, Risk/Return Quadrant via Recharts). See `ARCHITECTURE.md` → "Opportunity Map" for the full design. Verified: typecheck clean, lint 0 errors, 283/283 tests passing (5 new), manually validated live with seeded scanner-cache data across both view modes, filters, theme-cluster filtering, the detail panel's live Portfolio Fit + Movement Explainer calls, and all cross-page links.

**Two real bugs found and fixed via live browser testing** (neither caught by typecheck/lint/tests): (1) Recharts' `ResponsiveContainer` measured 0×0 on first paint inside this page's CSS grid layout — fixed by measuring the container explicitly via `ResizeObserver` and passing explicit pixel dimensions to `ScatterChart`, the same pattern already used for the two `d3-force` canvases. (2) `ZAxis` size-scaling produced zero-radius scatter symbols (`d="M0,0"`) — fixed by replacing it with a custom `shape` render function that draws each point's circle directly.

**Marks Investment Timeline + Investment Knowledge Graph + Opportunity Map (the full 3-feature mega-request) complete.**

---

## Institutional Intelligence Systems (2026-07 — see MASTER_ARCHITECTURE_BLUEPRINT.md)

Phase 0 audit found 3 of 7 requested "new" systems already existed (Portfolio Decision Engine, Portfolio Stress Testing, AI Portfolio Manager foundation) and 2 more existed narrower than spec (Explain Every Movement, Watchlist Intelligence). Only Sector Rotation was genuinely net-new. See `MASTER_ARCHITECTURE_BLUEPRINT.md` for the full audit, reuse map, and corrected implementation order.

### Phase 1: Explain Every Movement + Sector Rotation (✅ Complete)
- **Sector Rotation Engine** (`lib/sector-rotation.ts`) — net-new. Continuous relative-strength/momentum/leadership tracking across 11 GICS sector ETFs, RRG-style classification, daily persisted snapshots (`sector_rotation_snapshot` table, 2yr retention).
- **Movement Explainer** (`lib/movement-explainer.ts`) — new general-purpose "why did X move" engine (symbol/sector/portfolio), complementing (not replacing) Scanner's batch-oriented `causal-engine.ts`/`thesis-builder.ts`.
- **Dedup**: `lib/scanner/signals.ts` and `lib/scanner/sector-impact.ts` now import the canonical `SECTOR_ETFS`/`SECTOR_ETF_MAP` from `lib/sector-rotation.ts` instead of duplicating the list.
- **Integration**: Opportunity Scorer blends Sector Rotation's relative strength into catalyst strength; Scanner page shows both the new continuous `SectorRotationPanel` and the existing event-driven `SectorRotationGrid`; Research page has an on-demand `MovementExplainerCard`.
- **New APIs**: `/api/sector-rotation`, `/api/movement`.
- **Tests**: `tests/sector-rotation.test.ts`, `tests/movement-explainer.test.ts` (14 new tests, all pure/deterministic logic — no live API calls in tests).
- **Verified**: typecheck clean, lint 0 errors, 222/222 tests pass, manually validated live in browser (Research page's "Why did AAPL move?" and the `/api/sector-rotation` live data pull).

### Phase 2: Portfolio Decision Engine + Watchlist Intelligence (✅ Complete)
- **Decision Engine extension**: `buildRisks`/`buildCatalysts` (`lib/portfolio-analytics.ts`) now surface Sector Rotation context ("Technology sector lagging — rank 11/11 by relative strength") as evidence alongside existing concentration/PEG/momentum signals. Live-verified on NVDA/ARM reduce recommendations.
- **Critical fix**: initial wiring imported `lib/sector-rotation.ts` (which reaches `lib/db.ts`/`node:sqlite`) directly into `portfolio-analytics.ts`, which is imported by client components — broke the client bundle ("does not support external modules: node:sqlite"). Fixed by keeping `portfolio-analytics.ts` free of any db-reaching import; the rotation snapshot is now fetched server-side by `/api/portfolio/report` and threaded through `computePortfolioReport(..., rotationSnapshot)` → `computeRecommendations` → `buildRisks`/`buildCatalysts` as a plain data parameter. **Lesson**: any file imported by both server routes and client components must never import `lib/db.ts` transitively — check the full import chain, not just the direct import.
- **Movement Explainer relocated**: `movement-explainer-card.tsx` moved from `app/research/_components/` to `app/_components/` (now used by Research and Portfolio's `DecisionCard`).
- **Watchlist Intelligence**: `computeWatchlistAlerts()` (`lib/ai-watchlist.ts`) — structured, deterministic per-asset alerts (new_opportunity, deteriorating, breakout, sector_leadership, valuation), exposed via `WatchlistDigest.alerts`. Rendered by new `WatchlistAlerts` component, mirroring `SmartAlerts`' pattern. Live-verified: 8 real alerts generated from live watchlist data.
- **Auto-promotion**: `/api/portfolio/new-positions` now evaluates eligible watchlist items for "new opportunity" alerts and passes qualifying symbols to the AI as `autoQualified` candidates (stronger signal than the existing soft "prefer watchlist" prompt note); `NewPositionRecommendation.autoQualified` flag surfaces a "✦ Auto-qualified" badge in `new-positions-panel.tsx`.
- **Note**: `app/portfolio/_components/position-recommendations.tsx` (`PositionRecommendations`) was found to be dead code (defined, never imported) — the live "Decision Queue" UI is `actions-tab.tsx`'s `DecisionCard`. Both were updated for consistency, but only `DecisionCard` is reachable.
- **Tests**: `tests/ai-watchlist.test.ts` (8 new tests for `computeWatchlistAlerts`).
- **Verified**: typecheck clean, lint 0 errors, 230/230 tests pass, manually validated live (Portfolio Actions tab, Watchlist page, digest API).

### Phase 3: Portfolio Stress Testing + Market Dashboard (✅ Complete)
- **Stress Testing extension**: `computeScenarios` (`lib/portfolio-analytics.ts`) now takes a `rotationSnapshot` param — a sector's shock is amplified ×1.15 if lagging/weakening or dampened ×0.85 if leading/strengthening (negative shocks only; positive shocks/tailwinds are untouched). Refactored shared logic into `applyScenarioShocks()`.
- **User-defined scenarios**: new `computeCustomScenario()` export + `/api/portfolio/scenario` (POST `{sector, shockPct}`) + a "Custom Scenario — 'What if...'" builder in `risk-panel.tsx`'s `ScenarioAnalysis`. Live-verified: Technology -25% shock computed to -26.2% portfolio impact (amplified because Technology was ranked 11/11, lagging, at test time).
- **Market Dashboard**: new `/api/dashboard` aggregation route (regime, sector leadership, portfolio alerts + top opportunities, watchlist alerts, upcoming calendar events — all parallel-fetched, each best-effort/independent) + `MarketDashboard` component on the home page, above the existing `DailyPulse` (which becomes one panel among several, per the blueprint's plan — not replaced). `assessMarketRegime` exported from `lib/scanner/index.ts` for reuse without invoking the full multi-minute AI scanner pipeline (regime here is deterministic, live macro/sector price action only — no event-derived themes, by design, to keep dashboard load fast).
- **Tests**: `tests/portfolio-scenarios.test.ts` (7 new tests for `computeCustomScenario` + rotation-aware shock adjustment).
- **Verified**: typecheck clean, lint 0 errors, 237/237 tests pass, manually validated live (home page Market Dashboard rendering all 6 panels with real data; Portfolio Intelligence tab's rotation-aware scenario text and working Custom Scenario builder).

### Phase 4: AI Portfolio Manager orchestration (✅ Complete)
- **`/api/portfolio/audit`** (CIOPanel's streaming memo): now independently gathers Sector Rotation (leaders/laggards) and Watchlist Intelligence (top alert) server-side and weaves them into the CIO prompt's evidence sections + explicitly asks the PORTFOLIO THEMES and KEY OPPORTUNITIES sections to reference them.
- **`/api/ai/portfolio-brief`** (daily brief): same two evidence sources added to its prompt context.
- **No new orchestration plumbing** — same streaming (`ReadableStream`/`streamChat`) and JSON (`runPrompt`) patterns as before; only richer prompt inputs, per the blueprint's "AI explains, engines decide" principle. Client components (`cio-panel.tsx`) required zero changes — evidence gathering moved server-side.
- **Verified live**: a real CIO memo generated during testing explicitly cited "Sector Rotation data reveals that this portfolio is currently positioned in lagging sectors, including Technology and Energy, while underweight in leading sectors such as Healthcare, Financials, and Industrials" and recommended monitoring "Watchlist Intelligence alerts, specifically SBS (73/100) and SHG (74/100)" — confirming the model genuinely synthesizes the new evidence rather than ignoring it.
- **Verified**: typecheck clean, lint 0 errors, 237/237 tests pass, manually validated live via direct API calls (streaming audit + brief) reflecting the new evidence in generated output.

**All 4 phases of the Institutional Intelligence Systems initiative are now complete.** See `MASTER_ARCHITECTURE_BLUEPRINT.md` for the full design record and this section for the as-built summary.

---

## Systems In Active Development

### Quant Engine Refinements (In Progress)
**Branch**: `main` → `integration/best-of-both`

**Current Work**:
- Live OOS (out-of-sample) validation being integrated
- Quantile recalibration for regime detection accuracy
- Universe expansion (PIT universe under test)
- Performance under different market conditions

**Status**: Stable foundation; ongoing optimization for signal accuracy.

**Next Steps**:
- Validate new signals via the desk's Model Validation section
- Tune factor weights per regime
- Document signal performance per asset class

---

### Quant Engine → Systematic Desk (2026-07 — ✅ Complete)

Rebuilt `/engine` from first principles around a different question than its
neighbours: *"what opportunities is the market creating today, and why?"* rather than
Research Hub's "what about this company". See `ARCHITECTURE.md` → "Quant Engine — the
systematic desk" for the full design and module-boundary rationale.

**Surfaced what the engine already computed but never showed**: market regime with
confidence, the reason for it, and its implied annualised return; the five-state HMM
posterior with each state's μ; adaptive IC-derived factor weights plus their rotation
history; P10/P50/P90 probability bands and P(up) per name; Kelly position sizing;
upgrades/downgrades and signals opened/closed since the previous run; sector signal
tilt; and continuous live-IC self-monitoring that says "signal degraded" in plain
language when IC goes negative.

**Deduplicated against other modules**: the old page embedded a complete batch
IC-report runner *and* a full `ICReportView` — a copy of `/ic-report`. Removed in
favour of a link. The standalone `/backtest` page and `/api/backtest` were deleted and
folded in as the desk's on-demand **Model validation** section; `lib/backtest.ts` is
reused unchanged. Signal-tier tones/labels, previously duplicated across both pages,
now live once in `lib/engine-desk.ts`.

**Performance — the highest-priority item, and the root cause was not the UI.** Read
paths spawned Python with *no timeout*: `/api/engine` paid a fresh interpreter +
polars import (~1.8s) on every single load and on every 3s poll during a run, and a
cold `engine.duckdb` open was measured at **over two minutes** despite the queries
themselves running in ~0ms. That unbounded spawn is what made the page "appear to
hang". Fixed by (a) precomputing the market brief to `data/engine_dashboard.json`
during the run and serving it as a file, (b) memoising the parsed Parquet on
mtime+size (~1.8s → ~15ms), (c) routing every read spawn through a bounded
`runEnginePython()` that SIGKILLs at its deadline, and (d) returning an explicit
`degraded` state instead of a pending request. Measured after: first paint 718ms,
regime resolved 970ms.

**Progressive by section**: three independent `useDataset` datasets, each rendering
the moment it lands; the heavy 124-row scorecard is code-split; validation never runs
on load. A failed section renders its own error and retry and leaves its siblings
untouched. The engine publishes a partial snapshot at every run stage, so the desk
fills in *during* a run instead of after it.

**Also fixed**: `/engine` never called `useBootReady`, so the full-screen boot splash
sat over it until the 20s safety timeout fired — the page was unreachable for 20
seconds on first load. Now reports ready as soon as the brief lands, with its own
market-wide boot messages.

**Verified**: typecheck clean, lint clean on all touched files, 1377/1377 tests
passing (8 new in `tests/engine-desk.test.ts`), and manually validated live in a
browser — all 8 sections, the section rail's active tracking and jump behaviour, the
conviction book's side switch and factor attribution, scorecard filtering and the
detail panel, and a real Model Validation run (3.1s, cached, correctly reporting no
edge over the window).

**Two real bugs found only through live browser testing**: (1) the section rail's
`IntersectionObserver` was keyed on a fixed section list, so it never observed the
five sections that mount after the brief arrives and stayed pinned to "Regime" — the
rail now derives its list from the sections actually rendered. (2) An intersection
band cannot identify the current section on this page at all, because the scorecard is
tall enough to span the entire viewport and keeps intersecting while the reader is well
past it; replaced with a probe-line comparison against section tops, plus deep trailing
padding so the last sections can physically reach the top of the viewport.

---

### India-US Variant Consolidation (In Progress)
**Branch**: `integration/best-of-both` (merging `indian-markets-ai`)

**Current Work**:
- Merge India support (screener.in API) with US research
- Unified research page with yahoo/screener.in fallback
- Currency conversion for cross-market comparison
- Field mapping for different data shapes

**Status**: Most features merged; final bug fixes in audit commit 826983b.

**Next Steps**:
- Test India > US conversion edge cases
- Validate insider data for NSE vs. BSE
- Ensure analyst consensus retrieves correctly for India

---

## Planned Systems (Next Priorities)

### High Priority

**1. Real-Time Price Updates (WebSocket)**
- **Goal**: Live price streaming instead of polling every 5 minutes
- **Impact**: Faster alert delivery, smoother UX, reduced API calls
- **Architecture**: WebSocket server subscribes to Yahoo Finance changes, broadcasts to clients
- **Files to Add**: `lib/websocket.ts`, `app/api/subscribe/route.ts`
- **Integration**: Replace polling in Screener, Watchlist, Portfolio
- **Effort**: Medium (2-3 days)
- **Priority**: High (improves UX significantly)

**2. Offline-First Data Cache**
- **Goal**: App works without network (for local market data)
- **Impact**: Research accessible on flight/offline, better resilience
- **Architecture**: Seed SQLite with S&P 500 historical data, sync daily with Yahoo
- **Files to Add**: `engine/historical_download.py`, `lib/offline-mode.ts`
- **Integration**: Check offline flag in routes, degrade gracefully
- **Effort**: Medium (3-4 days)
- **Priority**: High (user experience, data ownership)

**3. Custom Factor Library**
- **Goal**: Users can define custom scoring factors without code changes
- **Impact**: Extensibility without forking codebase
- **Architecture**: JSON schema for factor definition, UI to create factors, scoring engine loads dynamically
- **Files to Add**: `app/api/factors/route.ts`, `lib/custom-factors.ts`, `app/factors/page.tsx`
- **Integration**: Composite scorer loads custom factors alongside built-in factors
- **Effort**: Medium (2-3 days)
- **Priority**: Medium (power-user feature)

### Medium Priority

**4. Multi-User Sharing**
- **Goal**: Share portfolios, watchlists, research notes with other users (optional)
- **Impact**: Team collaboration, shared conviction tracking
- **Architecture**: Add user table + sharing/permission tables, migrate from single-user DB
- **Files to Modify**: `lib/db.ts` (schema expansion), all CRUD functions (add user_id filters)
- **Files to Add**: `app/api/sharing/route.ts`, `app/api/users/route.ts`
- **Integration**: Auth layer (JWT tokens), workspace concept
- **Effort**: High (5-7 days, includes auth)
- **Priority**: Medium (nice-to-have for teams)

**5. ClickHouse Integration (Time-Series DB)**
- **Goal**: Real-time signal recalculation instead of daily batch
- **Impact**: Live factor scores, subsecond signal updates
- **Architecture**: ClickHouse for historical prices + factors, DuckDB for daily aggregations
- **Files to Add**: `lib/clickhouse.ts`, `engine/stream_prices.py`
- **Integration**: Replace Parquet snapshots with live queries
- **Effort**: High (5-7 days, DevOps complexity)
- **Priority**: Low (nice-to-have; current Parquet architecture sufficient)

**6. Research Export (PDF, HTML)**
- **Goal**: Export research pages as PDF/HTML for archival/sharing
- **Impact**: Better audit trail, easier sharing
- **Architecture**: Use PDFKit for PDF, template for HTML, server-side generation
- **Files to Add**: `app/api/export/research.ts`
- **Integration**: Export button in research page, streaming large PDFs
- **Effort**: Low-Medium (1-2 days)
- **Priority**: Medium (user-facing, minimal code)

### Low Priority

**7. Machine Learning Signal Optimization**
- **Goal**: Auto-tune factor weights using ML instead of manual tuning
- **Impact**: Potential signal accuracy improvement
- **Architecture**: Python scikit-learn to optimize weights on historical data
- **Files to Add**: `engine/optimize_factors.py`
- **Integration**: Run offline, output optimized weights to config
- **Effort**: High (3-4 days research + implementation)
- **Priority**: Low (current signals solid; optimization diminishing returns)

**8. Crypto & Commodities Support**
- **Goal**: Extend beyond equities (BTC, oil, gold, etc.)
- **Impact**: Broader asset class coverage
- **Architecture**: Add data source adapters for crypto (CoinGecko) + commodities (FRED)
- **Files to Add**: `lib/crypto.ts`, `lib/commodities.ts`
- **Integration**: Reuse Screener + Compare templates for new asset classes
- **Effort**: Medium (2-3 days)
- **Priority**: Low (niche feature; focus on equities)

---

## Architectural Priorities

### 1. Maintain Token Efficiency (In Progress)
- **Goal**: Minimize Claude Code session token usage for future work
- **Strategy**: 
  - Use Serena for file location (not grep)
  - Use Graphify for dependency visualization (not manual reading)
  - Document everything in ARCHITECTURE.md (not scattered in code)
  - Keep modules loosely coupled (reduces context needs)
- **Owner**: Future sessions (enforced via CLAUDE.md workflow)

### 2. Single Source of Truth for Every Algorithm (Completed)
- **Goal**: Never duplicate business logic across modules
- **Current State**: ✅ Scoring in `composite.ts`, signals in `event-screener.ts`, portfolio metrics in `portfolio-analytics.ts`
- **Policy**: New code must reuse or extend, never duplicate
- **Enforcement**: Code review checklist + git hooks

### 3. Non-Fatal Failures (Completed)
- **Goal**: Partial data > complete failure
- **Current State**: ✅ EDGAR, news, analyst data all non-fatal
- **Policy**: API failures return null + error message; UI renders with missing data
- **Enforcement**: Every data fetch wrapped in try/catch with fallback

### 4. Parallel Fetching (Completed)
- **Goal**: No serial API calls; use `Promise.all()` for everything independent
- **Current State**: ✅ `/api/research` fetches 6+ data sources in parallel
- **Policy**: Any fetch that takes >100ms should be parallelized
- **Enforcement**: Performance monitoring + git commit messages calling out parallelization

### 5. Loose Module Coupling (In Progress)
- **Goal**: Modules communicate via APIs + shared engines, not direct imports
- **Current State**: 90% complete (some legacy imports remain)
- **Refactor Candidates**: 
  - `lib/ic-thesis.ts` imports from `lib/composite.ts` directly (OK; shared engine)
  - Some components import from wrong modules (use Serena to audit)
- **Enforcement**: No cross-module imports except types + utilities

### 6. Graceful Degradation Under Load (Completed)
- **Goal**: App responsive even when Ollama offline, Yahoo slow, etc.
- **Current State**: ✅ Ollama offline shows fallback UI; slow APIs timeout gracefully
- **Policy**: 5s timeout on external APIs; move to cache or skip on timeout
- **Enforcement**: Every external fetch has timeout + fallback

---

## Implementation Order (Next 3 Months)

### Week 1-2: WebSocket Real-Time Updates
- Implement WebSocket server for price streaming
- Integrate with Screener, Watchlist, Portfolio
- Test under 1000+ concurrent clients
- **Expected**: 50% reduction in API calls, <100ms price latency

### Week 3-4: Offline-First Architecture
- Build historical data downloader
- Implement offline mode flag
- Cache S&P 500 + portfolio symbols locally
- **Expected**: App functional without network for <1 week stale data

### Week 5-6: Custom Factor Library
- Design JSON schema for factors
- Build UI to create/edit factors
- Integrate with composite scorer
- **Expected**: Power users can test strategies without code

### Week 7-8: Comprehensive Testing
- Unit test coverage for all new modules
- Load test WebSocket server
- Offline mode e2e test
- **Expected**: >90% unit test coverage

### Week 9-10: Documentation & Deployment
- Update ARCHITECTURE.md with new modules
- Deploy to staging
- User acceptance testing
- **Expected**: Production-ready, zero regressions

### Month 2-3: Multi-User Sharing (Optional)
- Add auth layer (JWT)
- Implement sharing/permissions
- Migrate to multi-user DB schema
- **Expected**: Support team collaboration, shared watchlists

---

## Success Metrics

### User Experience
- Page load time <2s for all modules
- Real-time price latency <500ms (with WebSocket)
- Works offline for 1 week of data
- 99.9% uptime (single-user, self-hosted)

### Code Quality
- >90% unit test coverage for domain logic
- Zero duplicate business logic
- All external failures non-fatal + logged
- Modules loosely coupled (Graphify shows clear boundaries)

### Performance
- <100ms for screener filtering (1000 stocks)
- <5s for IC Report (9 agents in parallel)
- <1s for comparison chart (5 stocks, 5 years)
- Parquet reads <500ms (daily snapshot)

### Developer Experience
- New module implementable in <1 day
- Bug fixes require reading <5 files
- Token usage <10k per session for typical work
- Clear dependencies documented (ARCHITECTURE.md)

---

## Technical Debt (To Address)

| Item | Severity | Impact | Effort |
|------|----------|--------|--------|
| DuckDB lock contention | Medium | Occasional timeout on engine runs | Low (already partially fixed) |
| Parquet snapshots → ClickHouse | Medium | Daily latency on signals | High |
| Test coverage <80% | Medium | Regressions slip through | Medium |
| No e2e tests | Medium | UI breaks go unnoticed | High |
| Hardcoded URLs in tests | Low | Tests brittle | Low |

---

## Success Criteria for Project

- ✅ Research platform (Phase 1) — Complete, stable
- ✅ Advanced analysis (Phase 2) — Complete, validated
- ✅ Quant engine (Phase 3) — Complete, audited
- ✅ Data integration (Phase 4) — Complete, robust
- ✅ UI/UX (Phase 5) — Complete, accessible
- ✅ Persistence (Phase 6) — Complete, documented
- ✅ AI (Phase 7) — Complete; degrades gracefully without a key
- ⏳ Real-time updates — In progress
- ⏳ Offline-first — Planned Q3 2026
- ⏳ Custom factors — Planned Q3 2026
- ⏳ Multi-user sharing — Planned Q4 2026

**Overall**: 7/7 core phases complete. Production-ready institutional research platform. Ready for public beta.
