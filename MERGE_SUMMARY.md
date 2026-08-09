# MERGE_SUMMARY.md — Universal Asset Analyzer Codebase Audit

**Audit date:** 2026-08-06
**Auditor role:** Principal Software Architect / Staff Engineer (read-only audit; no source modified)
**Scope of the merge analysis:** the two-developer divergence between `divit-local` and `origin/prisha-work`, both forked from merge-base `98500e1` ("Merge origin/main: streaming AI verdicts, score reconciliation, data grid").

> **Critical context discovered during the audit:** this merge has already been performed once.
> `main` contains a hand-resolved merge of `prisha-work` at commit `6585052`
> ("Merge prisha-work: hosted-first provider chain over the local reliability work",
> 2026-08-02), followed by a fallout fix (`cac4ddb`), a product-decision revert of the
> hosted-first default (`1e1a34b`), and the final flip to hosted-primary (`4c67333`).
> The currently checked-out branch `f22/day-change` is 30 commits past that merge
> (F-22 day-change audit, Brand Phase 1, local auth, the Anthropic-only AI
> consolidation, landing/pricing work). Sections 1–2 describe the **current HEAD**;
> sections 3–14 describe the **branch divergence and its merge**, including how the
> existing resolution in `main` handled each hazard.

**Divergence at a glance**

| | `divit-local` | `origin/prisha-work` |
|---|---|---|
| Commits since merge-base | 16 | 10 |
| Files changed | 233 (95 added, 4 deleted, 134 modified) | 149 (60 added, 89 modified) |
| Diffstat | +35,417 / −4,538 | +16,161 / −798 |
| Theme | Portfolio platform: Simulator, Watchlist rebuild, performance/attribution engines, multi-portfolio, correctness fixes | AI platform: hosted-first provider chain, screener legibility, brand identity, Python-engine performance |
| Overlapping files | 18 | |
| Real conflicts (`git merge-tree`) | 7 (6 content + 1 modify/delete) | |

---

## 1. Architecture Overview

### 1.1 Folder structure

| Directory | Purpose |
|---|---|
| `app/` | Next.js App Router: pages, `_components/` (shared UI), `api/` (100+ route handlers), per-module `_components/` |
| `lib/` | Domain logic (~100+ TS modules). Pure functions where possible; pages and API routes call into here |
| `lib/ai/` | AI orchestration: `orchestrator.ts`, `router.ts`, `task-registry.ts` (56 task types), `models.ts`, `providers/`, `schemas/` (Zod), `streaming-json.ts`, `anthropic-key.ts`, `availability.ts`, `errors.ts`, `health.ts`, `gate.ts` |
| `lib/ic/` | IC Report platform: `canonical.ts` (validated, provenance-carrying data object), `valuation-engine.ts` / `valuation-suite.ts` (deterministic valuation), `valuation-inputs.ts`, `format.ts` (INR lakh/crore-aware; the ONLY formatter for IC surfaces), `store.ts`, `export-markdown.ts` / `export-pdf.ts` |
| `lib/platform/` | Platform Data Layer: `registry.ts` (cache policies + dependency graph), `cache.ts` (L1 LRU + L2 SQLite), `dedup.ts`, `orchestrator.ts` (`runPlan()` DAG execution), `data-layer.ts` façade, `client/` (browser half) |
| `lib/portfolio/` | Universal portfolio engine: `engines/` (allocation, attribution, risk, health, optimize, cash, transaction, idea-relevance, …), `classes/` (per-asset-class adapters + `reference/risk-models.ts`), `simulator/`, `model/`, `store.ts`, `thesis.ts`, `context.ts` |
| `lib/screener/` | Universal screener: `pipeline.ts`, `filter-engine.ts`, `ranking.ts`, `explain.ts`, `universe-stats.ts`, `universes/` (equity, etf, bond, crypto, commodity, forex, reit) |
| `lib/knowledge-graph/` | Investment knowledge graph: `build.ts`, `recommend.ts`, `diff.ts`, `traverse.ts`, `narrate.ts` |
| `lib/assets/` | Asset-class registry and per-class metric definitions (`registry.ts`, `types.ts` with `peerGroupBy`) |
| `engine/` | Python quant pipeline (separate process): `daily_run.py`, `data/` loaders, `features/factory.py`, `models/` (factors, forecast, regime, Kelly, Monte Carlo), `profiling.py`, `compact_db.py` |
| `data/` | Persistent state: `app.db` (SQLite), `engine.duckdb` (DuckDB), `scorecard_snapshot.parquet` (daily engine output) |
| `scripts/` | Utilities: `monitor.mjs` (external alert runner), `ops/uaa` (host-health dev-server wrapper), `perf-baseline.mjs`, `generate-brand-assets.ts`, spike/bench scripts, `ic-report-harness.ts` |
| `tests/` | Vitest unit tests (~2,600+ passing at merge time) |
| `e2e/` | Playwright end-to-end tests (incl. gated login suite on :3121) |
| `docs/` | Living docs, brand guidelines, IC-report map/decision log, **abandoned** terminal-redesign records (`docs/redesign/PLAN.md`, `docs/brand-preview/terminal/SPEC.md` — historical only) |
| `ai-migration/` | AI migration phase records (both authors' variants preserved: `0{1,2,3}-*.md` and `0{1,2,3}-*.prisha.md`) |

### 1.2 Major modules

- **`lib/composite.ts`** — batch dimensional scorer (Screener). Pure sector-aware sub-scores (value/growth/quality/financialHealth/momentum) + weighted overall, 0–100. Never fetches analyst consensus/statements — that is what makes 1000+ name scoring cheap.
- **`lib/scoring.ts`** — single-name decision engine (Research/Compare/Portfolio). Multi-signal: fundamentals + analyst consensus + EPS revisions + momentum + capital allocation + sector rotation.
- **`lib/recommendation.ts`** — the single source of truth for score→recommendation bands (78/60/42/25), labels, and badge tones. Both engines and all UI route through it.
- **`lib/screener/pipeline.ts`** — universal screener pipeline (replaces the old `lib/fundamental-screener.ts`, which no longer exists despite doc references). Ranking runs over the full universe before filtering so percentiles describe standing among all peers.
- **`lib/event-screener.ts`** — event-driven signal scanner (news → AI themes/signals → cross-referenced against quotes and fundamentals).
- **`lib/sector-rotation.ts`** — RRG-style rotation across 11 GICS sector ETFs; daily snapshots, 2-year retention.
- **`lib/movement-explainer.ts`** — "why did this move?" for symbol/sector/portfolio; deterministic evidence first, one AI synthesis call; 15-min `scanner_cache` TTL.
- **`lib/thematic-engine.ts`** — 10-stage thematic framework, streamed to the client.
- **`lib/ic-agents.ts` + `lib/ic/`** — 9-domain multi-agent IC pipeline; every valuation figure computed deterministically in `lib/ic/valuation-engine.ts` (the model proposes inputs only).
- **`lib/day-change.ts`** — the ONE canonical definition of daily change (audit F-22: four codepaths previously answered this differently). Pure, dependency-free, client-safe.
- **`lib/portfolio-performance.ts` / `lib/portfolio/engines/*`** — canonical total return (one function, explicit denominator and cost-weighted period), attribution, confidence, series alignment.
- **`lib/db.ts`** — all SQLite CRUD. Nothing else touches the database.
- **`lib/knowledge-graph/`** — deterministic node/edge assembly + insight surfacing + change detection, snapshotted daily.

### 1.3 Data flow

```
Page (RSC/client) → app/api/*/route.ts → lib/*.ts domain logic
   → lib/platform/data-layer.ts getDataset()
      → cache check (L1 LRU → L2 SQLite) → dedup (attach to in-flight identical work)
         → provider fetch (lib/yahoo.ts | lib/edgar.ts | lib/screener-in.ts)
   → normalized result → cache write → JSON/NDJSON/SSE back to the page
```

- **Yahoo Finance** (`lib/yahoo.ts` via `yahoo-finance2`): quotes (15s TTL), history (15m TTL/2h SWR), quoteSummary, fundamentals. Throws on network failure; callers decide fallback.
- **SEC EDGAR** (`lib/edgar.ts`): filings, non-fatal (empty array + message). CIK map cached 7d.
- **screener.in** (`lib/screener-in.ts`): Indian fundamentals, 6h TTL (rate-sensitive scrape).
- **Python quant engine**: `engine/daily_run.py` → `data/scorecard_snapshot.parquet`, read-only from Next.js.
- **Orchestrated research** (`lib/research-bundle.ts`): one DAG plan replaces a 4-stage serial waterfall (~2264ms → ~1455ms cold; time-to-first-paint 764ms → 163ms). `/api/research` (JSON) and `/api/research/bundle` (NDJSON) execute the same plan so they cannot drift.

### 1.4 State management

- **Server state**: SQLite at `data/app.db` (`DB_PATH` overridable), exclusively through `lib/db.ts` (~40 tables — enumerated in §1.7 and §10).
- **Client state**: page-local React state; contexts: `boot-context.tsx` (boot splash), `lib/focus-context.tsx` (focus spine: last 5 acted-on symbols in sessionStorage), toast provider, theme via `data-theme` + localStorage.
- **Persisted view state**: saved screens remember `last_symbols`/`last_run_at` for entry/exit diffs; `activity` table drives "continue where you left off"; DataTable density/sort persistence.
- Note: docs reference `lib/ios-context.tsx`; the file present is `lib/ios-context.tsx` at repo level but `app/_components/ios-context.tsx` does not exist — treat doc comments as intent, not fact (a recurring theme in this codebase, per AGENTS.md).

### 1.5 API architecture

- Convention per route: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, early symbol validation (`/^[A-Z0-9.\-]{1,12}$/`), try/catch → `{ error }` with status, partial data on optional-source failure.
- **Streaming routes**: `/api/ai/report` (NDJSON verdict sections), `/api/research/bundle` (NDJSON), `/api/ic-report` (SSE), `/api/compare/stream` (NDJSON), `/api/thematic` (SSE), simulator generate (staged NDJSON: allocate → select → size → evaluate → narrate).
- **Error doctrine**: EDGAR/news/analyst data are optional — UI renders without them. AI unavailable → fallback message via `AI_RECOVERY_HINT` from `lib/ai/availability.ts`, never a crash, never hand-written recovery advice.

### 1.6 AI architecture (current HEAD)

- **Single entry point**: `runPrompt(taskType, …)` / `runTaskChat` in `lib/ai.ts`. Feature code never calls a provider directly.
- **Backend**: Anthropic API only (`claude-opus-5`), with effort tiers `low|medium|high` as routable model-id suffixes mapping to `output_config.effort`. The Devin CLI, Devin sessions, and Ollama tiers built during the migration were **retired post-merge** (`0ce3c0c` "one backend, three effort tiers").
- **Provider**: `lib/ai/providers/anthropic-provider.ts` is the only code that talks to the API; explicit `baseURL` pins egress to `api.anthropic.com`; errors normalized (401/403 → key invalid, 429 → rate_limited).
- **Key resolution** (`lib/ai/anthropic-key.ts`): `ANTHROPIC_API_KEY` env → `~/.uaa/anthropic_api_key` (mode 600, `UAA_CONFIG_DIR` overridable). Never logged, never returned by any API route.
- **Router** (`lib/ai/router.ts`): task → model candidates, eligibility gates, quality/speed scoring weighted by task complexity (`deep|standard|light`) and latency class (`interactive|standard|background`); timeout is a host bound, not a model failure.
- **Structured output**: Zod schemas in `lib/ai/schemas/` (verdict, movement, watchlist-digest, text); `lib/ai/streaming-json.ts` emits each top-level field the moment it parses completely — final object byte-identical to the non-streamed path (only time-to-first-section improves: 32s → 7s on MSFT).
- **Availability/degrade**: `AI_RECOVERY_HINT` ("Add your Anthropic API key in Settings…") — one constant replacing ~15 formerly hand-written "start Ollama" messages.
- **Durability**: `ai_job` (idempotency, status, session linkage) and `ai_result` (keyed by analysis_type + subject + input_hash + schema_version) tables.

### 1.7 Database usage

SQLite tables created in `lib/db.ts`, by domain:

- **Auth**: `user`, `auth_session` (SHA-256 token hashes, 30-day TTL)
- **Watchlist**: `watchlist` (incl. `stage`, `source`, `source_detail`, `target_direction`), `watchlist_group`, `watchlist_member`, `watchlist_target_history`
- **Portfolio**: `portfolios` (multi-portfolio), `portfolio` (legacy holdings), `portfolio_lot` (transaction ledger, incl. `currency`, `asset_class`, `portfolio_id`), `portfolio_snapshot`, `manual_asset`, `simulation`
- **Research**: `research_session`, `research_message`, `research_notes`
- **Caching**: `fundamentals_cache` (legacy 24h), `platform_cache` (data-layer L2), `scanner_cache`, `scanner_snapshot`, `real_estate_lookup_cache`
- **Analytics**: `sector_rotation_snapshot`, `kg_snapshot`, `timeline_event`
- **Notifications**: `notification` (dedup_key, 24h dedup), `price_alert_state` (crossing detection)
- **Decisions/Valuation**: `decision` (with `case_version` linkage), `valuation_case` (materialized projection), `valuation_event` (append-only, authoritative)
- **AI**: `ai_job`, `ai_result`
- **Misc**: `chart_drawing`, `saved_screen` (incl. `last_symbols`, `last_run_at`), `activity`, `attention_dismissal`, `home_fingerprint`

Separate stores: `data/engine.duckdb` (Python engine intermediates, compactable via `engine/compact_db.py`), `data/scorecard_snapshot.parquet` (engine output, read-only from Next.js).

### 1.8 Caching

Policies live in `lib/platform/registry.ts` (dataset-scoped, dependency-aware invalidation, stale-while-revalidate, refcounted dedup):

| Dataset | TTL / SWR | Persisted |
|---|---|---|
| `quote`, `quotes.batch` | 15s / none | no (never paint a stale price) |
| `history` | 15m / 2h | yes |
| `profile` | 24h / 7d | yes |
| `statements` | 12h / 1d | yes (root of the analytical chain) |
| `fundamentals` | 4h / 12h | yes |
| `filings` | 6h / 1d | yes (a new 10-Q invalidates the chain) |
| `news` | 15m / 1h | no |
| `screenerIn` | 6h / 1d | yes |
| `cikMap` | 7d / 30d | yes |
| `aiVerdict` / `aiSection` | 6h / 24h | yes (115s → 0.04s on repeat) |
| `thematicReport` | 12h / 6d | yes |

`invalidateAsset("AAPL", "filings")` cascades filings → statements → fundamentals → peers → companyContext → aiVerdict. Legacy stores that predate the platform still exist: `fundamentals_cache` (screener 24h snapshot in `lib/dataset.ts`, now with stale-while-revalidate on the price layer) and `scanner_cache` (15-min AI output store).

### 1.9 Background jobs

- **Built-in monitor scheduler**: `instrumentation.ts` → `lib/monitor.ts`, timer inside the Next server (`UAA_MONITOR_INTERVAL_MS`, default 5 min, 0 disables; idempotent across dev hot-reloads via `Symbol.for` guard). Implemented and verified per `PLAN-background-alerts-scheduler.md`.
- **Scanner scheduler**: `lib/scanner/scheduler`, also started from `instrumentation.ts`.
- **External monitor**: `scripts/monitor.mjs` hits `/api/monitor/run` from cron/launchd (`scripts/com.uaa.monitor.plist`) for headless / native-notification setups; server dedups 24h.
- **Python engine**: `engine/daily_run.py` run manually or via cron; writes parquet + DuckDB; per-stage timing via `engine/profiling.py` (`UAA_ENGINE_TIMING=0` silences).
- No in-process cron; intervals use `.unref()` so they never keep the process alive.

---

## 2. Every Feature (grouped by page)

Format per feature: **what** · why · files · deps. (SQLite = via `lib/db.ts`; AI = via `lib/ai` `runPrompt`; Y! = yahoo-finance2.)

### 2.1 Home / Dashboard (`app/page.tsx`, `app/_home/**`)

Ten modules rendered from one `/api/home` request; the page itself has no business logic.

- **AI Executive Brief** (`_home/modules/todays-brief.tsx`) — streamed AI morning note (headline, regime badge, portfolio value count-up, day P&L, health grade w/ explanation popover, top/worst performer, action verbs, session note when market closed, resume chip, dismiss, reading-time estimate, AI-vs-computed badge). Why: answers "what should I know and do right now". Deps: AI (`/api/home/brief`), SQLite, Y!, `lib/home/explain.ts`. Deterministic fallback when AI is unavailable.
- **Book** (`book.tsx`) — health ring, XIRR vs benchmark, return-on-cost fallback, cash % w/ excess-vs-benchmark, stamped day P&L; links to Portfolio/Attribution. Why: "how is my book?" at a glance. Deps: SQLite, `lib/portfolio-analytics.ts`.
- **What's Changed** (`whats-changed.tsx`, `lib/home/changes.ts`) — ranked change chips since last visit (improved/worsened/new tones), expandable before/after sentences, first-visit and no-change states. Why: "deltas first" — show what moved while away.
- **Attention Queue** (`attention-queue.tsx`, `lib/home/attention.ts`) — one ranked, finishable stream merging actions/threats/alerts/events/signals: spotlight #1 with explainable score and measured before/after portfolio state, "why this, why now" memo, kind filters, keyboard nav (arrows/Enter/Delete/'f'), dismiss with 10s undo, degraded-feeder notice. Why: "what needs a decision now" with comparable scoring across item types. Deps: SQLite dismissals (`/api/home/attention/dismiss`), AI, portfolio analytics.
- **Radar** (`radar.tsx`) — scanner hits ranked by fit to book + buy/near-buy watchlist items, "new"/"researched Nd ago"/stage badges, add-to-watchlist, stale-scan warning. Why: top of funnel before the queue.
- **Market Intelligence** (`market-intelligence.tsx`, `lib/home/market-intel.ts`) — collapsed tape (SPX·NDX·VIX·10Y·WTI·DXY·BTC) with stamped moves; expanded cards for regime, breadth, UAA sentiment (explainable), VIX/10Y/DXY/oil/gold/BTC with sparklines + directional implications; "rotation you hold". Deps: Y!, sector rotation.
- **AI Investment Brief** (`ai-investment-brief.tsx`) — long-form note (regime, opportunities, risks, portfolio observations, sectors, macro, recommendations) with disclaimer; empty state names the AI dependency.

### 2.2 Screener (`app/screener/page.tsx`, `lib/screener/**`)

Universal, registry-driven across 7 asset classes (equities, ETFs, bonds, crypto, commodities, forex, REITs) — no per-class branching.

- **Asset-class tabs** — switching resets filters/template/sort; universe status per class. Files: `page.tsx`, `lib/assets/registry.ts`.
- **Universe build status** — `TaskProgress` with stage, %, elapsed, throughput-extrapolated ETA; polling while building; manual refresh. Why: cold builds take minutes; honest progress. Files: `lib/screener/universe-cache.ts`, `pipeline.ts`.
- **Templates** — curated filter+ranking presets per class; toggle to clear.
- **Filter panel** (`_components/filter-panel.tsx`) — grouped range/option filters with unit suffixes, **frame cycling** (absolute # → class-percentile % → peer-percentile ≈) with help text, **distribution bar** histograms under each filter (24 buckets, span highlight, coverage %), **preference toggles** (2× ranking weight), "not screenable yet" honesty section, removable **filter chips**, run button with pending indicator. Deps: `filter-engine.ts`, `universe-stats.ts`.
- **Results table** (`results-table.tsx`) — registry-driven columns, direction-aware sorting, match score color bands, expandable match detail (passed filters/strengths/warnings/binding constraint), watchlist/owned badges, "marginal" near-failure badges, staging checkboxes, pagination, keyboard (j/k/space/x/w/enter). Deps: `pipeline.ts`, `explain.ts`.
- **Saved screens + screen diff** — save/load/delete; on load shows entered/exited symbols since the last run and re-baselines. Files: `saved-screens.tsx`, `screen-diff.tsx`, `/api/screener/saved` (PATCH records runs without touching `updated_at`). Deps: SQLite `saved_screen.last_symbols/last_run_at`.
- **Why Empty** (`why-empty.tsx`) — diagnoses which filters bind and how much slack would fix it; one-click "relax". Deps: `filter-engine.ts` `diagnose()`.
- **AI explain-this-ranking** (`/api/screener/explain`) — server re-runs the screen and narrates it; model badge, error fallback.
- **Natural-language filters** (`/api/screener/nl`, `lib/screener/nl-filters.ts`) — prompt → structured filters + template; sessionStorage handoff from the AI Assistant.
- **Batch actions** — stage ≥2 → Compare; add staged to watchlist.
- **Excel export** (`/api/export/screener`, ExcelJS server-side).

### 2.3 Research (`app/research/page.tsx`)

Universal hub, auto-detects asset class (US/India/Japan/Europe equities, funds, crypto, commodities, forex, derivatives, macro).

- **Search + quick picks** across all classes.
- **Decision Hero** — streamed AI verdict (BUY/HOLD/SELL) with conviction + confidence meters, personality/fit badges, price/market badges, refresh. Files: `decision-hero.tsx`, `/api/ai/verdict`, `lib/ai/client/use-verdict-stream.ts`.
- **Valuation Strip** — forward P/E, EV/EBITDA, FCF yield, DCF fair value + upside; "cannot be valued" honesty for no-FCF names. Deps: `/api/dcf`.
- **Why-Now card** — composes top movement driver + sector rotation + nearest timeline event from data already on the page.
- **Macro Context Ladder** — collapsible market/sector/company regime.
- **Portfolio Fit panel** (`app/_components/portfolio-fit-panel.tsx`, `/api/ios/fit`) — fit score/tier/reasons, concentration warning, suggested allocation.
- **Position Action card** — buy/sell/hold with sizing and impact; opens buy modal.
- **Interactive chart** — candles, SPY/sector overlays, volume, SMAs, drawing tools (persisted via `chart_drawing`), pattern recognition, indicators (RSI/MACD/Bollinger), news/earnings markers, chart-QA "Ask AI".
- **Movement Explainer card** (`/api/movement`, `lib/movement-explainer.ts`) — grounded "why did this move" with driver categories and confidence.
- **Five tabs**: Conviction (per-class score cards: ConvictionBreakdown, India InvestmentSnapshot + RatioSparklines + RankedPeers, FundScoreCard, CryptoScoreCard, CommodityScoreCard, ForexScoreCard, YieldCurveCard) · Analysis (why own/avoid, watchlist intelligence, peer competitive position, financial insight, related opportunities) · Financials (score card, risk heatmap, analyst card, insider table, ownership, earnings, valuation-history/margin/revenue-FCF charts, peer radar; India: ownership timeline + quarterly charts; funds: sector allocation/holdings) · Ownership (institutional, insiders, timelines) · Details (SEC filings, news, timeline preview, KG preview, derivatives summary, research notes, chart QA, pattern analysis).
- **Research Copilot** (`copilot/research-copilot.tsx`, `/api/research/chat`) — multi-turn AI Q&A with research-bundle context, streaming, persisted sessions (`research_session`/`research_message`).
- **Research notes** (`/api/notes`) and **PDF report download**.

### 2.4 Research: India (`app/research/india/page.tsx`) and Stock detail (`app/stocks/[symbol]/page.tsx`)

Both are **redirect shims** preserving deep links into the universal `/research` page (India adds `.NS` resolution). Why: consolidation without breaking bookmarks.

### 2.5 Research: Manual assets (`app/research/manual/…`)

- **List page** — manual assets grouped by category (Real Estate, Private Markets, Alternatives, Structured Products) with cost/value/return; add form (`add-manual-asset-form.tsx`). Deps: SQLite `manual_asset`, `/api/manual-assets`.
- **Detail page** (`[id]/page.tsx`) — category-specific metric cards (cap rate/cash-on-cash/NOI; MOIC/DPI/RVPI/IRR; structured-product payoff scenarios), notes, delete w/ confirmation, **AI insight** (`/api/manual-assets/[id]/insight`) and **asset chat**.

### 2.6 Compare (`app/compare/page.tsx`)

- **Landing** with quick picks and capability cards; up to 5 symbols, color-coded.
- **Equities vs cross-class tabs** (`/api/compare/class`, `lib/compare/`).
- **Metric table** — valuation/growth/quality/financial-health/momentum/consensus/conviction sections with best/worst highlighting (5% tie tolerance), benchmark context.
- **Compare chart** (normalized multi-line) and **radar chart** (dimension polygons).
- **AI verdict, streamed** (`/api/compare/stream`, `lib/ai-compare.ts`) — best-overall + ranked reasoning, grounding badge, typed error display (stage/timeout/missing-model), retry; partial tolerance (one rate-limited symbol no longer sinks the verdict; `droppedSymbols` travels through `ComparisonSetup`).
- **Portfolio-fit badges** per symbol; **Excel export**.

### 2.7 Watchlist (`app/watchlist/page.tsx`)

Rebuilt (divit-local) "around the level you are waiting for".

- **Table** — symbol, price (live polling with backoff for hidden tabs/closed markets/errors; tick flash; as-of stamp), change, my target, upside, analyst consensus + consensus upside, from-52w-high, fit, stage, sector, added, notes; density toggle; persisted sort; keyboard (/, Escape). Files: `page.tsx`, `_components/use-live-quotes.ts`, `use-view-state.ts`, `app/_components/ui/data-table.tsx`.
- **Targets with direction** (`target-modal.tsx`) — above (valuation/exit) vs below (buy limit), auto-detected, revision count; **target history** (append-only audit trail, `watchlist_target_history`). Why: alerts and exports previously contradicted each other on what "target reached" meant.
- **Named lists** (`list-switcher.tsx`, `watchlist_group`/`watchlist_member`) — create/rename/delete, per-list **benchmark** with vs-benchmark column.
- **Alerts** (`/api/watchlist/symbol-alerts`) — % drop thresholds, firing display, crossing detection persisted in `price_alert_state`.
- **Quick filters** — all / alerts firing / owned / no target / has thesis (persisted).
- **Row detail** (`row-detail.tsx`) — firing alerts, consensus vs user target, fit score, stage, quick actions (research/compare/buy/delete); **range bar** plotting price/target/52w range; **stage badges** (`lib/idea-stage.ts` pipeline stages).
- **Portfolio fit column** (`/api/watchlist/fit`, `lib/watchlist-fit.ts`).
- **AI digest** (`digest-panel.tsx`, `/api/ai/watchlist`) — opt-in watchlist summary with portfolio context.
- **Notes modal**, **add-to-portfolio modal**, **delete**, **Excel export**, **text search**.

### 2.8 Wire (`app/wire/page.tsx`)

News/event scanner with staged streaming pipeline.

- **Command bar** — query + focus chips (Global/US/Europe/China/Asia/India), run/cancel, cache indicator.
- **Market regime banner**, **market summary card** (VIX/10Y/breadth + sparklines), **AI market summary**.
- **Opportunities** (`opportunity-card.tsx`, `lib/opportunity-engine.ts`) — AI-detected ideas with category badges, opportunity score, trigger headline, source count, fit ranking toggle (IOS), add-to-watchlist, persistent dismiss + restore.
- **Emerging themes**, **cause & effect causal chains** (`causal-chain.tsx`), **unified sector rotation** (with holdings overlay), **risk monitor**, **portfolio impact**, **watchlist impact**, **portfolio watch**.
- **The Tape** (`tape.tsx`, `lib/wire/tape.ts`) — raw feed with **evidence drawer** (`lib/wire/evidence.ts`) tracing every insight to sources.
- **Streaming progress** — stage name, %, units done/total, stall detection, per-stage failure reporting, partial results.
- **Client cache** — sessionStorage, 15-min TTL; manual refresh bypasses.

### 2.9 Calendar (`app/calendar/page.tsx`)

- **14-day grid** with event chips + overflow, today highlight; **summary strip** (this week, portfolio, watchlist, high impact, next earnings/ex-div/macro).
- **Filters** — type (earnings/ex-div/macro), impact, region.
- **Earnings rows** — estimates (EPS/revenue w/ currency), portfolio/watchlist badges, quick links (Research/DCF/IC Report/Compare); **dividend rows** — amount, yield, pay date; **macro rows** — impact dots, country, previous/forecast/actual.
- **Event drawer**, **time buckets** (Today → Later → Recently completed).
- **AI weekly brief** (`/api/calendar/ai-brief`) — generated summary with disclaimer.

### 2.10 Portfolio (`app/portfolio/page.tsx`)

Tabbed universal portfolio workbench.

- **Dashboard tab** — 6 headline tiles (value, total return w/ period label, today, cash w/ deployable status, income/yield, health grade); **trajectory panel** (health/concentration over time); **health panel** (12 dimensions triaged needs-attention → adequate → strong, weakest first, strong collapsed to one line); **allocation panel** (asset class/sector/geography/currency/liquidity); **attribution panel** (return decomposed by contribution — "what carried, what dragged"); **macro factor panel**; **data-quality disclosures** (unresolved FX, % market-priced, stale marks); **concentration warnings** (HHI-based). Files: `_components/universal/*`, `lib/portfolio/engines/*`.
- **Holdings tab** — holdings table w/ edit/delete, add-holding dialog, read-only view for non-default portfolios.
- **Performance tab** — money-weighted return (XIRR) vs benchmark, canonical total return (`lib/portfolio-performance.ts`), as-of stamp.
- **Risk Lab tab** — VaR, stress scenarios, factor exposure; classification authority (class resolved once, on what the instrument holds). Files: `risk-lab.tsx`, `engines/risk.ts`, `engines/scenario.ts`, `classes/reference/risk-models.ts`.
- **Decisions tab** — decision center ordered by the question answered; **cash panel** (deploy-new-cash engine with objective picker, marginal-benefit chart, deploy guard, preview/executor parity).
- **Pipeline tab** — kanban of ideas by stage with **provenance** (where the idea came from) and **relevance score** vs the current book (`engines/idea-relevance.ts`, `/api/pipeline`, `/api/pipeline/fit`).
- **Optimize tab** — two-stage optimization (allocation + within-class sizing), objective picker, trade selection toolbar, live preview diff, warnings panel, confirmation modal w/ trade drawer, funding summary, snapshot history w/ undo.
- **Simulator tab** — describe a mandate → generate a book → promote it: form + AI interview intake (≤8 questions), profile summary, staged NDJSON generation (allocate → select → size → evaluate → narrate), sim view, compare vs real book, edit with cash-sleeve value conservation, promote via `executeTradeBatch`. Files: `_components/simulator/*`, `lib/portfolio/simulator/*`, 8 `/api/portfolio/simulator/*` routes, `simulation` table.
- **Portfolio-wide**: AI thesis banner with settled conclusions computed in code (`lib/portfolio/thesis.ts` `ESTABLISHED CONCLUSIONS` — the model never derives directional verdicts), portfolio switcher (multi-portfolio), as-of stamp.

### 2.11 Journal (`app/journal/page.tsx`, `lib/decision-journal.ts`)

- **Track record** — hit rate, avg return/call, best/worst call tiles; **calibration tables** by conviction and by fit tier ("does my high conviction actually earn more?"); withheld until 5 scored decisions (honest small-sample handling).
- **Log decision form** — symbol search w/ price prefill, action picker (buy/watch/hold/avoid/sell), conviction slider, target price, thesis textarea.
- **Decision list** — cards with price-at-mark, current mark, return, close (records close price) and delete.
- **Thesis evolution panel** — per-symbol thesis timeline (migrated from the retired timeline page).

### 2.12 Thematic (`app/thematic/page.tsx`, `lib/thematic-engine.ts`)

- Theme input + analyze/cancel; recent-theme chips (sessionStorage); 10 preset theme cards + "how it works" onboarding.
- **Progress panel** over SSE through 10 stages; **report view** with tabs (future state, dependency chain, bottleneck, supply/demand, commodity, policy, structural advantage, company mapping/quality, opportunity score); refresh bypasses the 12h cache.

### 2.13 Valuation (`app/valuation/page.tsx`, register at `/valuation/register`)

- **Case page** — market-expectation panel (implied vs delivered vs assumed growth), editable 7-assumption DCF table with per-assumption **provenance** (who set it, when), "Review with AI" (AI proposes changes only to un-owned assumptions; shows applied/respected/weakest), case history, fair value + margin of safety + terminal-value share warning, bear/base/bull scenarios, sensitivity analysis, Excel export. Files: `lib/valuation/case.ts`, `dcf.ts`, `valuation_case`/`valuation_event` tables (event log is authoritative).
- **Register** — all cases with flags (unvaluable, negative margin, stale, untouched, engine divergence), quant-engine Monte Carlo p50 prior comparison, "check against reported" re-run with broke/weakened results and calibration summary.

### 2.14 Engine (`app/engine/page.tsx`, `engine/`, `lib/engine-desk.ts`)

- **Run console** — universe selector, skip-fetch toggle, run/cancel with live log (SSE), Excel export.
- **Regime hero** (Bull/Bear/Range/Crash/Recovery + probability), **changed today** (score movers since previous run), **conviction book** (highest-conviction longs/shorts with probability distributions), **factor lab** (factor weights + rotation), **breadth map** with signal filter, **scorecard table** (full universe, expandable factor breakdown), **model health** (out-of-sample IC/Sharpe/hit-rate), **model validation** (backtests the engine's own calls), **desk rail** navigation.
- Data: Python engine parquet/`dashboard.json`; the Fast Run path is the one prisha-work took from ~200s to ~10s (§6).

### 2.15 IC Report (`app/ic-report/page.tsx`, `lib/ic/**`, `lib/ic-agents.ts`)

- Symbol search w/ market detection badge (US/India), generate/stop, keyboard shortcuts (G/E/1-6).
- **Progress panel** (SSE), **header summary** with verdict/confidence + historical version selector.
- **Export cluster** — PDF (with brand mark on the cover), Markdown, JSON, copy-to-clipboard, all via `lib/ic/export-*`.
- **Tabs**: Valuation (deterministic suite + case/prior reconciliation), Thesis (bull/bear synthesis), Agents (9 domains w/ per-agent retry), Signals (+ investigative questions), Watch (monitorables, data gaps), Data (provenance table).
- Design rule: `lib/ic/canonical.ts` is the validated data object every stage reads; the model proposes valuation inputs only (`valuation-inputs.ts` validates); `lib/ic/format.ts` is the only formatter. Harness: `scripts/ic-report-harness.ts` (`--llm` for full runs).

### 2.16 Knowledge Graph (`app/knowledge-graph/page.tsx`, `lib/knowledge-graph/`)

- Scope switcher (symbol/sector/portfolio/watchlist); force/radial layouts; graph/table view toggle; node search; type + edge-strength filters; inspector; AI **connection explanation** and **graph narrative**; full view state in the URL (shareable); daily `kg_snapshot` for change detection.

### 2.17 Landing (`app/landing/page.tsx`)

- Section-registry-driven marketing page (hero w/ seeded stipple generator "The Traceable Figure", problem/solution, privacy/local-first, features, demo, comparison, **pricing — two tiers, only claims that are true of the shipped product**, FAQ, CTA); pill nav; auth modal (sign in/up); migration contract constants (`LANDING_HOME`, `APP_ENTRY`). Recent commits deliberately re-aligned all copy with shipped reality (retired claims about hosted generation/auth).

### 2.18 Settings (`app/settings/page.tsx`, `/settings/account`)

- **AI key card** — presence-only status (env vs file source), password input, save to `~/.uaa/anthropic_api_key` (mode 600), remove (file-source only), data-leaves-machine disclosure. `/api/settings/ai-key` never returns the key.
- **Account page** (auth-gated server component) — profile card (display name/email) and change-password card (current-password verification, scrypt). `lib/auth.ts` AuthAdapter (env-gated local auth, off by default via `UAA_AUTH_GATE`), `lib/auth-gate.ts`.

### 2.19 Dev tokens (`app/dev/tokens/page.tsx`)

- Design-token swatch page: surfaces/brand/semantic/chart colors in dark **and** light panels, applied UI samples, full type scale. Why: brand-phase review surface.

### 2.20 Global chrome / shared surfaces

- **Site header** — brand lockup, objective dropdowns, mobile menu, notification bell, theme toggle, account chip, AI assistant + ⌘K buttons; suppressed on landing. **Site footer** with brand.
- **Command palette** (⌘K) — debounced symbol search, focus-spine recents, symbol verbs (Research/Compare/Valuation/IC Report/Add to watchlist), tool search, keyboard nav, programmatic-open event.
- **AI assistant** (`app/_components/ai-assistant.tsx`, `lib/ai-app-assistant.ts`) — page-aware "how do I…" chat with starter questions, action chips (high-confidence auto-navigate after 650ms), screener NL handoff via sessionStorage, watchlist mutations, proactive insights.
- **Notification bell** — 90s polling of `/api/monitor/run`, unread badge, list, mark read (all/single), navigate-on-click, OS toasts. Backed by `lib/alerts.ts` (facts stored, prose rendered at read time; session-gated evaluation prevents weekend re-announcements; 24h dedup).
- **Account menu**, **toast system**, **theme toggle** (dark/light via `data-theme`), **focus spine** (`lib/focus-context.tsx` — last 5 symbols), **boot splash**, **brand components** (`app/_components/brand.tsx`: `BrandMark`, `BrandLockup`, `BrandEmptyState`, animated `LoadingMark` resolving pixel-exactly into the static mark).
- **DataTable primitive** (`app/_components/ui/data-table.tsx`) — density toggle w/ selected-state readout, persisted sort, row windowing (`lib/table-window.ts`), size announcement; `TaskProgress` staged progress reused across Screener/Wire/IC/Simulator.

---

## 3. UI Changes (divergence vs merge-base `98500e1`)

### From `divit-local`

- **Watchlist rebuild** — everything in §2.7 is new on this side: named lists, target direction + history, live-quote polling w/ backoff, consensus column, range bar, stage badges, row detail, digest panel, view-state persistence. (`app/watchlist/**`, page rewritten, ~1,900 lines changed.)
- **Simulator** — entire new surface (§2.10 Simulator tab; 11 new components under `app/portfolio/_components/simulator/`).
- **Health scorecard ranked by severity; dashboard ordered by question** — triage bands, strong dimensions collapsed, AI output labeled as interpretation, percentages show denominators (`health-panel.tsx`, `decision-center.tsx`, `holdings-panel.tsx`, `portfolio/page.tsx`).
- **Performance/attribution/trajectory panels** — new (`performance-panel.tsx`, `attribution-panel.tsx`, `trajectory-panel.tsx`, `trajectory-chart.tsx`, `as-of-stamp.tsx`).
- **Pipeline board provenance + relevance** — new `pipeline/idea-card.tsx`; ideas ranked by worth-acting-on, not recency.
- **Table primitive widening** — `data-table.tsx` (+528 lines): persisted view state, row windowing, density readout, extracted `DensityToggle`, brand-tinted active segment (was an invisible 3% step); new `date-input.tsx`; enhanced `task-progress.tsx`.
- **Compare streaming UI** — streamed verdict with typed, legible error states across `compare/page.tsx` and radar/class views.
- **Cash & Optimize panel hardening** — deploy guard, funding summary, confirmation flows (`universal/cash/*`, `universal/optimize/*`).
- Pulled in via the `74ad42c` merge of origin/main (authored on main, but part of the divergence): Valuation module UI, Engine quant desk UI, icon system.

### From `origin/prisha-work`

- **Screener legibility suite** — new `distribution-bar.tsx`, `filter-chips.tsx`, `why-empty.tsx`, `screen-diff.tsx`; filter panel gained frames + preference toggles (+215 lines); results table gained held/marginal badges, staging, binding-constraint display (+161 lines); `screener/page.tsx` +302 lines.
- **Brand identity ("Convergence Point")** — `lib/brand/mark.ts` (single source of geometry), `app/_components/brand.tsx`, real favicon/icon.svg/apple-icon/PWA manifest + `public/brand/*` assets, site footer, header lockup, boot splash/loading mark unification, globals.css brand styles.
- **Provider-agnostic status UI** — `ollama-status.tsx` reworked into an honest AI-status badge.
- **Redesign records (docs-only, ABANDONED)** — `docs/redesign/PLAN.md`, `docs/brand-preview/**`, `docs/concept/EYE-EASE.md` + prototype. Per AGENTS.md these are historical records; the terminal chrome must not be reintroduced.

---

## 4. Backend Changes

### From `divit-local`

- **New API routes** (14): 8× `/api/portfolio/simulator/*` (crud, intake, generate, evaluate, edit, swap, refresh-narrative, promote), 3× watchlist (`groups`, `membership`, `target-history`), `/api/pipeline/fit`, `/api/portfolio/portfolios`, `/api/compare/stream`.
- **Deleted route**: `app/api/portfolio/new-positions/route.ts` (−267 lines; superseded by the recommendation route) — this deletion is the modify/delete conflict in §13, and `main`'s resolution **restored** it because `ai-watchlist.ts` still documented it as a live caller.
- **Modified routes**: watchlist (group/provenance/direction support), watchlist CSV export, portfolio buy/manage (classification authority, indivisible-unit checks), optimize/execute (trade-vs-holdings fix, unfunded reporting), performance (new engine), thesis, pipeline (provenance/relevance/stage transitions), ios fit/rank (universal report).
- **New lib modules**: `idea-source.ts`, `live-quotes.ts`, `price-crossing.ts`, `watchlist-metrics.ts`, `table-window.ts`, `portfolio/history.ts`, `portfolio/performance.ts`, `portfolio/engines/{attribution,confidence,idea-relevance,series,transaction}.ts`, `portfolio/classes/market-base.ts`, `portfolio/classes/reference/risk-models.ts` (1,465 lines), full `portfolio/simulator/` package.
- **Major reworks**: `lib/db.ts` +943, `lib/portfolio-analytics.ts` −1,655 (consolidated into engines), `lib/portfolio/thesis.ts` +516, `lib/alerts.ts` +132 (direction + crossing), `lib/idea-stage.ts` +190, `lib/types.ts` +107. Deleted: `lib/portfolio-context.tsx` (superseded by `lib/portfolio/context.ts`).

### From `origin/prisha-work`

- **Python engine overhaul** (`c399e40`, `4c10c1d`): `daily_run.py` +597 (batched single-scan price loading replacing ~2,000 round-trips, same-day rerun close-comparison, missing-field-only enrichment, `prune_derived_history()`, `raise_fd_limit()`); new `engine/profiling.py` (StageTimer); vectorized `features/factory.py` (+311), `models/regime.py` (+312), `data/loader.py` (+328); new `engine/compact_db.py` (DuckDB never shrinks its file after DELETE — rewrite + row-count verification + backup-on-mismatch); `verify_engine_equivalence.py` (347 lines) pins vectorized vs loop equivalence (max |diff| 0 to 1e-13).
- **Screener backend**: `lib/screener/universe-stats.ts` (new, per-metric distributions + class/peer percentiles), `filter-engine.ts` +298 (`diagnose()`, `parsePreferences()`, frame-based filtering, binding-constraint detection), `pipeline.ts` +45; `PATCH /api/screener/saved`.
- **Universe metric additions**: crypto `supplyOverhang`; fund-shared `family`/`effectiveSectors`/`structure`/`issuer`; bond `yieldPerDuration`/`spreadPerDuration`/`netYield`/`cashWeight`/`fundAge`; commodity `returnPerVol`/`carryQuality`; equity risk-adjusted metrics; etf structure/issuer enums (+140); new `lib/assets/{bond,commodity,crypto,equity,reit}.ts`; `assets/types.ts` gained `peerGroupBy`.
- **Dataset layer**: stale-while-revalidate on the screener price layer (`lib/dataset.ts` +50) — kills random 3.7s hangs when the 5-min TTL expired; N concurrent screens trigger one refresh.

---

## 5. AI Changes

This is where the two branches **collided head-on**: both independently built a Devin migration with different seams, and neither was a superset (per the `6585052` merge message).

### From `divit-local` (local-reliability line)

- **Legible failures** (`ec93ede`): new `lib/ai/errors.ts` (typed TaskStageError/TimeoutError/ModelNotFoundError), `lib/ai/log.ts`, `lib/ai/health.ts` +101; compare verdict streams instead of blocking; router stops discarding a whole verdict on the blocking path.
- **Timeout as a bound, not a blame** (`fc683f2`): `withRetry` recognizes `TimeoutError` (previously only `AbortError`, so 45s × 3 attempts × 3 models = 405s of futile retries); `streamChat` accepts `timeoutMs`; `keep_alive` holds the model resident (30m interactive / 10m background); fallback messages name the actual cause. Measured: 6m40s → 22s cold / 16.3s warm.
- App-assistant budget 45s → 150s; router +185 lines (timeout handling, partial tolerance, abort checks in streaming).

### From `origin/prisha-work` (hosted-first line)

- **Devin CLI provider**: `lib/ai/devin-cli.ts` (466 lines — isolated scratch workspace so repo AGENTS.md rules don't leak into prompts, tools denied, `--prompt-file`, concurrency cap; measured 3.9–8.3s hosted vs 28–115s local; nine concurrent IC prompts in 5.3s), `providers/devin-provider.ts`.
- **Provider chain**: `config.ts` `providerOrder()` (default devin → ollama, `AI_PROVIDER_ORDER` reorders); `models.ts` +172 (`ProviderId`, per-model provider, `endpointForProvider()`, `LOCAL_PROVIDERS`); `router.ts` +140 (lazy `attemptOrder()` generator — enumerating a provider costs nothing until reached).
- **Provider-agnostic recovery**: new `lib/ai/availability.ts` (`AI_RECOVERY_HINT`, `aiUnavailableMessage()`) replacing ~15 hardcoded "run `ollama serve`" strings; `platform-health.ts`.
- **Migration records + schema**: `ai-migration/01–03` docs (inventory of ~45 AI call sites with parse-brittleness classification, capabilities research, sessions-API architecture), `lib/ai/schemas/verdict.ts` (Zod, `VERDICT_SCHEMA_VERSION`, compiles to Draft-7 JSON Schema), `scripts/devin-spike.ts` (sessions-API spike; later `b180d3d` accepts legacy v1 `apk_` keys alongside v3 `cog_` service users, routing `/v1/sessions` vs `/v3/organizations/{org}/sessions`).

### How the merge combined them (and what happened after)

`main`'s resolution made prisha's lazy provider chain the **outer loop** and conditioned every piece of divit's local-reliability work (generation gate, residency probe, widened cold-start budget, capped cold-timeout fallback) on `isHostedProvider()` being false — because a hosted provider has no load phase and runs parallel, applying local treatment there would be *wrong, not just redundant*. A hosted timeout now falls through to the next provider instead of stopping the chain. `PROVIDER_LOCALITY` is a total Record so a new `ProviderId` cannot compile unclassified; unrecognized ids get the conservative local treatment (which `FakeProvider` and the whole router test suite depend on).

**Post-merge, the entire question was mooted**: `1e1a34b` reverted the hosted-first default (gated on unresolved calibration/cost blockers), then `4c67333` flipped to Devin-primary with measured model pins, and finally the `f22/day-change`-era commits (`a819d51`, `0ce3c0c`) replaced the whole chain with a single **Anthropic** backend and three effort tiers. Anyone merging these branches today should know the destination state no longer contains Devin CLI or Ollama tiers.

---

## 6. Performance Improvements

| Improvement | Side | Measured effect |
|---|---|---|
| Engine Fast Run (`--no-forecast`) batching + vectorization | prisha | ~182–223s → **~9–13s** on full_us (248 names, warm). Root causes: 12 HMM fits/stock instead of 1/market (−47s), `features_daily` writing a full 5y expansion nobody read (−28s/run, 15.4M rows / 1.1 GB reclaimed), ~2,000 per-symbol price queries → one scan, `fast_info` refetch on same-day top-ups (−49s), Yahoo-screener universe resolution every run (−3–9s) |
| AI timeout multiplication fix + `keep_alive` | divit | 6m40s worst case → 22s cold / 16.3s warm |
| Screener price-layer stale-while-revalidate | prisha | eliminates random 3.7s hangs at 5-min TTL expiry; N concurrent screens → 1 refresh |
| DuckDB compaction + derived-history pruning | prisha | reclaims disk DuckDB never returns after DELETE |
| Classification resolved once at the boundary | divit | removes per-engine re-derivation of asset class |
| Performance baseline harness (`scripts/perf-baseline.mjs`) | prisha | recorded baseline: per-route JS, LCP/TTI on 5 heaviest pages, 60.1 avg FPS screener scroll, 30-min heap 11.3/15.4 MB |

---

## 7. Bug Fixes

### divit-local

1. **Phantom positions after rebalance** (`e099f73`) — full exits were rounded to the nearest dollar then converted back to units, leaving residue like GLD 0.0005 sh ($0.18). Fix: `dollarDelta` is an execution instruction and is never rounded; executor snaps a sell to the whole position when the leftover is < $1 AND < 1% of the position. (`engines/optimize.ts`, `engines/transaction.ts`.)
2. **Cash preview ≠ executor** (`f8f1a83`) — preview and executor computed numbers on different paths; now one shared path; the cap that silently absorbed overflow now surfaces it. (`engines/cash.ts`.)
3. **Total-return denominator** (`aa936e6`) — three surfaces computed total return three ways; `min(acquiredAt)` reported "+0.2% over 6.7y" for a book funded 17 days earlier because one 2019 collectible set the window. Fix: one function, balance-sheet denominator, cost-weighted period; return series align by **date**, not array index. Also: missing price never coerced to zero; realized P&L converted at **historical** FX rates (a CHF 20,000 gain no longer reports as $20,000).
4. **Watchlist target-direction contradiction** (`6f66f20`) — `lib/alerts.ts` fired on `price <= target` (buy limit) while the page/CSV fired on `price >= target` (valuation target), so exactly one surface fired permanently for any target (INCY "buy at $20" trading at $118 exported as TARGET REACHED). Fix: `target_direction` column + one rule in `lib/watchlist-metrics.ts`.
5. **Stale valuation masking** — `valuation.stale` now treated as unpriced instead of silently falling back to cost basis (unrealized P&L of exactly zero with no trace).
6. **AI timeout misattribution** (`fc683f2`) — timeouts were treated as model failures and retried across models (see §6).

### prisha-work

1. **All-NULL price writes** — `fetch_ohlcv` single-symbol branch read `row.get("Open")` against yfinance's MultiIndex columns.
2. **Macro augmentation never ran** — `_yf_close` returned an (n,1) array; a bare `except` swallowed the failure.
3. **Infinite refetch loops** — "NULL means retry" conditions lacked recency guards.
4. **Screener blindness** — no visibility into universe shape or why screens returned empty (fixed by the legibility suite, §3).

---

## 8. Refactors

- **Classification authority** (divit, `984308c`) — asset class resolved once at the boundary, keyed off what an instrument *holds*, read by every engine; Yahoo `bondHoldings.duration/.maturity` no longer misused as effective duration. New `classes/market-base.ts`, `classes/reference/risk-models.ts`.
- **Total return canonicalization** (divit, `aa936e6`) — `lib/portfolio-analytics.ts` shrank 1,655 → 44 lines; logic moved into `portfolio-performance.ts` + `engines/{attribution,confidence,series}.ts`.
- **Portfolio context migration** (divit) — React context `lib/portfolio-context.tsx` deleted in favor of domain context `lib/portfolio/context.ts`.
- **Idea stage as a shared module** (divit) — `lib/idea-stage.ts` +190 now that Watchlist reads stage transitions too.
- **AI platform provider abstraction** (prisha) — all calls through `runPrompt()`/`runTaskChat()`, `AIProvider` interface, chain-walking router, provider-agnostic health and recovery copy.
- **Screener filter engine** (prisha) — frame-based filtering (absolute vs class/peer percentile), per-filter missing-data policy, empty-screen diagnostics.
- **Engine vectorization with pinned equivalence** (prisha) — `verify_engine_equivalence.py` diffs vectorized primitives against the original loops.
- **format.ts NaN guards** (divit) — guards switched to `Number.isNaN` semantics awareness (+76 lines).

---

## 9. New Dependencies

| Dependency | Side | Purpose |
|---|---|---|
| `zod` `^4.4.3` | prisha-work | Runtime schema validation for AI structured output (verdict schema; compiles to JSON Schema) |
| npm script `brand:assets` (`scripts/generate-brand-assets.ts`) | prisha-work | Regenerates favicon/icons/PWA assets from `lib/brand/mark.ts` geometry |

`divit-local` added **no** dependencies (verified against the diff). No dependency version bumps on either side. `package-lock.json` therefore diverges only by the zod subtree.

---

## 10. Database Schema Changes

### divit-local (lib/db.ts +943 lines)

**New tables (6):**
- `watchlist_group` (id, name, benchmark, sort_order, created_at)
- `watchlist_member` (group_id, symbol PK; symbol index)
- `watchlist_target_history` (previous/new target + direction, note, changed_at; (symbol, changed_at DESC) index)
- `price_alert_state` (symbol PK, last_price, last_change_percent, last_seen_at)
- `portfolios` (id, name, created_at)
- `simulation` (id TEXT PK, name, status, profile, holdings, thesis, headline, promoted_at, timestamps; updated_at index)

**New columns:**
- `watchlist`: `stage` (default 'surfaced'), `stage_changed_at`, `target_direction`, `source`, `source_detail`
- `portfolio_lot`: `currency`, `asset_class`, `portfolio_id` (default 1)
- `manual_asset`, `portfolio_snapshot`: `portfolio_id` (default 1)

**Migration behavior:** default watchlist group "All Symbols" (benchmark SPY) seeded and existing symbols adopted; `portfolio_id` defaults to 1 for backward compatibility; direction/source left NULL on pre-existing rows (resolved at read time / honest "origin not recorded").

### prisha-work (lib/db.ts +54 lines)

- `saved_screen` + `last_symbols` (JSON, capped 500) and `last_run_at`; new `recordScreenRun(id, symbols)`.
- `decision.case_version` (valuation-case linkage) — kept alongside divit's changes in the resolution.
- DuckDB: no schema change, but compaction + `prune_derived_history()` capability.

**Merge note:** both sides' `lib/db.ts` changes auto-merged textually and the `main` resolution kept **both** (explicitly called out in the merge message). Schema changes are additive on both sides — no column collides — but see §14 on why this file still deserves manual review in any future merge.

---

## 11. Environment Variable Changes

### divit-local
- `AI_HEALTH_PATH` — AI health JSON location (defaults to `data/ai-health.json`)
- (test-only usage of `DB_PATH`, `VITEST`, `NODE_ENV`; `NEXT_PUBLIC_BASE_URL` referenced)

### prisha-work
- Devin sessions API: `DEVIN_API_KEY`, `DEVIN_ORG_ID`, `DEVIN_API_BASE`, `DEVIN_API_MODE`, `DEVIN_API_MAX_ACU`, `DEVIN_API_CONCURRENCY`, `DEVIN_PLAYBOOK_ANALYSIS`, `AI_PROVIDER`
- Devin CLI: `DEVIN_CLI_BIN`, `DEVIN_CLI_WORKSPACE`, `DEVIN_CLI_CONCURRENCY`, `DEVIN_CLI_DISABLED`
- Chain/config: `AI_PROVIDER_ORDER`, `AI_DISABLED_MODELS`, `AI_MAX_MODEL_GB`, `OLLAMA_HOST`
- Engine: `UAA_ENGINE_TIMING`

### Post-merge reality check (important)
The current HEAD's AI stack reads `ANTHROPIC_API_KEY` (+ `UAA_CONFIG_DIR`) and treats the retired `AI_PROVIDER` flag as ignored (legacy per-task values map to chain/sessions vocabulary). Most `DEVIN_*` and Ollama variables are **dead configuration** on HEAD. Any environment documentation produced from this merge should be validated against `lib/ai/config.ts` on the target branch, not against either side's diff.

---

## 12. Potential Merge Risks

1. **Semantically wrong auto-merges in the AI router (proven, not hypothetical).** During the actual merge, git cleanly auto-merged `routeStream` into applying Ollama's generation gate to *hosted* providers — it compiled and was silently wrong; it was caught only by human review. Any textual merge of `lib/ai/router.ts` / `lib/ai/models.ts` must be followed by a semantic review of provider-locality treatment.
2. **Product-decision entanglement.** prisha-work's `AI_PROVIDER_ORDER=devin,ollama` default made hosted inference primary *the moment it merged*, despite being explicitly gated on unresolved Blocker-1 (confidence calibration) and Blocker-2 (cost verification). It had to be reverted post-merge (`1e1a34b`). A merge can smuggle in a product decision; defaults deserve their own review line.
3. **Modify/delete on a route with a live documented caller.** divit deleted `/api/portfolio/new-positions` as part of the multi-portfolio refactor while prisha modified it and `ai-watchlist.ts` still documented it as a caller. Naive resolution (accepting the delete) breaks the watchlist AI flow; the resolution restored it and moved its vocabulary into `lib/ios/types.ts`.
4. **Two error-message philosophies for the same ~15 call sites.** divit made failure messages more specific per error type; prisha replaced hardcoded advice with `AI_RECOVERY_HINT`. The resolution kept per-error-type messages but routed all *advice* through the hint — a pattern any re-merge must preserve or AI failure UX will regress to naming a provider that no longer exists.
5. **Test-suite semantic coupling.** `tests/ai-router.test.ts` auto-merges, but every cold-start/gate/timeout assertion is written against the *local* provider path via `FakeProvider` (id "fake"). If provider locality defaults change, the suite green-ness becomes misleading rather than reassuring.
6. **Schema is additive but the data it governs is not.** Both sides migrate `data/app.db` at boot. Running one branch's binary against a DB already migrated by the other is generally safe here (all `ALTER TABLE ... ADD COLUMN` + `CREATE TABLE IF NOT EXISTS`), but downgrade paths do not exist. Back up `data/app.db` before switching branches (a `backup/pre-merge-20260728-020752` branch exists for the code; the DB has no equivalent).
7. **Binary/generated brand assets** (`app/favicon.ico`, `app/apple-icon.png`, `public/brand/*.png`) — git cannot content-merge these; they must be regenerated from `lib/brand/mark.ts` via `npm run brand:assets`, never merged.
8. **Docs that prescribe retired architectures.** Both sides wrote extensive AI-migration and redesign docs. The redesign is ABANDONED and the Devin/Ollama stack retired; merging docs verbatim resurrects dead guidance. The repo's own rule applies: treat doc comments as intent, not fact.
9. **Verification gap after merge.** The resolution's own bar was: `npm run build` passes, 2,647 tests pass, tsc/eslint deltas confirmed pre-existing. tsc passes on JSX Turbopack cannot parse, so a green typecheck is not proof pages render — run `npm run build` and a real page load (per AGENTS.md).

---

## 13. Files Most Likely To Conflict

`git merge-tree divit-local origin/prisha-work` produces exactly these conflicts:

| File | Conflict type | Nature |
|---|---|---|
| `lib/ai/router.ts` | content | Both rewrote routing: local reliability loop vs lazy provider-chain generator. The hardest, highest-stakes file in the merge |
| `lib/ai-app-assistant.ts` | content | divit's timeout budget + typed failures vs prisha's `AI_RECOVERY_HINT` rewiring of `failureAnswer` |
| `lib/ai-compare.ts` | content | divit's streaming + per-error messages vs prisha's recovery-hint + availability messaging |
| `lib/portfolio/thesis.ts` | content | divit's +516-line thesis engine (`ESTABLISHED CONCLUSIONS`) vs prisha's unavailable-message change |
| `app/portfolio/page.tsx` | content | divit's dashboard reordering/tabs/simulator vs prisha's `BrandEmptyState` empty-book treatment (resolution: keep tab bar + usable Simulator, brand card inside) |
| `AGENTS.md` | content | Both appended sections (product rules vs quant-engine performance rules); resolution kept both |
| `app/api/portfolio/new-positions/route.ts` | **modify/delete** | Deleted by divit, modified by prisha; resolution restored it (see §12.3) |

Auto-merged but overlapping (the remaining 11 of 18 shared files — clean textually, review semantically): `app/_components/ai-assistant.tsx`, `app/_components/command-palette.tsx`, `app/api/portfolio/audit/route.ts`, `app/globals.css`, `app/screener/page.tsx`, `lib/ai/models.ts`, `lib/db.ts`, `lib/screener/universes/crypto.ts`, `lib/screener/universes/fund-shared.ts`, `tests/ai-router.test.ts`, `tests/screener-universes.test.ts`.

---

## 14. Files That Should Never Be Automatically Merged

1. **`lib/ai/router.ts`** — the one file where a clean auto-merge already produced silently wrong behavior once (`routeStream` gating hosted providers). Always hand-merge; always re-derive which treatments are local-only.
2. **`lib/ai/models.ts`** — carries `PROVIDER_LOCALITY` / `isHostedProvider()`; a wrong classification silently changes timeout, gating, and fallback semantics across every AI feature.
3. **`lib/db.ts`** — auto-merges will interleave `CREATE TABLE`/migration blocks; ordering and idempotency of boot-time migrations must be verified by a human (both sides migrate the same live `data/app.db`).
4. **`app/api/portfolio/new-positions/route.ts`** — subject of the modify/delete conflict; its existence is coupled to `lib/ai-watchlist.ts` and `lib/ios/types.ts` vocabulary.
5. **`lib/ai-app-assistant.ts` / `lib/ai-compare.ts`** — user-facing failure copy where the two philosophies (specific errors vs centralized recovery hint) must be composed, not picked.
6. **`AGENTS.md` / `CLAUDE.md` / `lib/ai/ARCHITECTURE.md`** — prose does not interleave; both sides' sections must be kept deliberately (the resolution did), and stale prescriptions (Ollama-first, terminal redesign) must not resurrect.
7. **Binary brand assets** (`app/favicon.ico`, `app/apple-icon.png`, `public/brand/*.png`, `app/icon.svg`) — regenerate with `npm run brand:assets`; never merge.
8. **`package-lock.json`** — regenerate via `npm install` after `package.json` is resolved; never hand- or auto-merge the lockfile.
9. **`data/app.db`, `data/engine.duckdb`, `data/*.parquet`, `tsconfig.tsbuildinfo`, `*.log`** — runtime/build artifacts; must never enter a merge at all (a prior commit `f44f6df` purged tracked build artifacts for exactly this reason).
10. **`ai-migration/**` records** — the resolution deliberately kept both authors' documents side by side (`0{1,2,3}-*.prisha.md`); merging them into one file would destroy the historical record of two distinct architectures.

---

## 15. Overall Engineering Summary

This codebase is an unusually disciplined local-first "investment operating system": a Next.js App Router frontend over a pure-function domain layer (`lib/`), one SQLite choke point (`lib/db.ts`), a policy-driven data platform with dependency-aware cache invalidation, a single AI façade with schema-validated structured output, and a separate Python quant engine communicating via parquet. Its strongest engineering properties are the ones enforced culturally as much as structurally: directional conclusions are computed in code and handed to the model as settled fact, formatters and score-band definitions have single sources of truth, failure states are honest and specific, and doc claims are treated as intent to be verified against the call graph.

The audited divergence is a textbook two-developer split along orthogonal axes that nevertheless collided at the single hottest seam. `divit-local` built the *product*: the Simulator, the Watchlist rebuild, multi-portfolio, canonical performance/attribution, and a series of correctness fixes (phantom positions, preview/executor parity, FX-correct realized P&L, target-direction reconciliation) that are individually small but compound into trustworthiness. `origin/prisha-work` built the *platform*: a hosted-first AI provider chain, screener legibility, a real brand system, and a 20× Python-engine speedup with pinned numerical equivalence. Only 18 of 400 touched paths overlap and only 7 truly conflict — but those 7 include `lib/ai/router.ts`, where both sides rewrote the same control flow with incompatible assumptions, and where the one demonstrated failure mode of this merge lives: a compiling, test-passing, semantically wrong auto-merge.

The merge itself (already executed on `main` at `6585052`) is a model of how to do this: neither side picked, the local-reliability work was preserved *inside* the hosted chain but conditioned on provider locality with a compiler-enforced total classification, a smuggled product decision (hosted-by-default) was identified and reverted separately from the mechanical merge, and both sides' documents and spike scripts were kept as history. The main caution for anyone reconciling these branches afresh is temporal: the destination has kept moving. The Devin/Ollama machinery both sides fought over was retired weeks later in favor of a single Anthropic backend with effort tiers, the terminal redesign is abandoned by owner decision, and the F-22 day-change audit re-canonicalized daily-change semantics across the app. Merge toward where `main` is going, not toward where either branch was — and never trust a clean diff on `lib/ai/router.ts`.

---
*Generated by a read-only audit. Evidence: `git merge-tree --write-tree divit-local origin/prisha-work`, `git diff 98500e1..{divit-local,origin/prisha-work}`, commit `6585052` resolution record, and direct source inspection at HEAD (`f22/day-change`).*
