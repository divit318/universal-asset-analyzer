# MERGE_SUMMARY.md — Universal Asset Analyzer Audit

**Prepared:** 2026-08-06 (refreshed after Tranche 5 landed)
**Repository:** `universal-asset-analyzer` (origin: `divit318/universal-asset-analyzer`)
**Merge baseline:** `origin/main` (`6585052` — "Merge prisha-work: hosted-first provider chain over the local reliability work")
**Merge candidate:** local `main` (`2be6ba1`, **6 unpushed commits**, 29 files, +1,388/−124) **plus uncommitted working-tree changes** (24 modified files, +869/−122) **plus 14 untracked files** across 13 git-status paths (2 new libraries, 1 shared component, 2 API routes, 1 script, 2 test files, 4 planning docs, and the 2 generated audit documents — this file and `CHANGE_MANIFEST.md`).

Companion document: **`CHANGE_MANIFEST.md`** enumerates the same delta as 24 individually ranked changes (referenced below as M#1–M#24). Both documents are maintained in lockstep and describe the same repository state.

Sections 3–14 describe **only the delta being merged** (committed + uncommitted + untracked vs `origin/main`). Sections 1–2 describe the whole application as it stands in this working tree.

Verification status of the working tree at refresh time: `npx tsc --noEmit` clean; all test files covering the delta pass (`amfi`, `materiality`, `yahoo`, `format`, `verdict-warmer`, `ai-analysis-facade`, `portfolio-thesis`, `ai-compare`, `simulator-generate` — **143/143**).

---

## 1. Architecture Overview

### 1.1 Folder structure

```
app/                    Next.js 16 App Router (pages + API routes)
  _components/          Shared UI (command palette, toasts, theme, notification bell,
                        symbol search, data tables, materiality lens*)
  _home/                Home-dashboard module implementations + module map
  api/                  ~48 route-handler families (see §1.6)
  <module>/             Page + _components per module (research, screener, portfolio,
                        watchlist, valuation, calendar, ic-report, engine, thematic,
                        knowledge-graph, journal, wire, compare, landing, stocks)
lib/                    Domain logic (~130 files)
  ai/                   AI platform: orchestrator, router, task/model registries,
                        providers (devin, ollama), analysis seam, schemas (verdict,
                        home-brief*, portfolio-thesis*, comparison*, simulator*,
                        loose*), verdict, verdict-warmer*, grounding
  platform/             Data layer: dataset registry, cache, dedup, invalidation
  assets/               Per-asset-class metric/filter/scoring definitions
  screener/             Universe providers, filter engine, universe stats, scheduler
  portfolio/            Universal portfolio engines (allocation, attribution, health,
                        thesis, simulator, transaction engine)
  compare/, valuation/, ic/, home/, knowledge-graph/, wire/, intelligence/,
  notifications/, scanner/, research-engines/
  ai-*.ts               Feature-specific prompt builders (17 files)
  amfi.ts*, materiality.ts*   New in this delta (see §4/§5)
engine/                 Python quant pipeline (DuckDB; separate process)
data/                   SQLite app.db, engine.duckdb, Parquet, JSON caches (gitignored)
tests/                  Vitest unit tests (~170 files)
e2e/                    Playwright smoke suite
scripts/                Spikes, parity harnesses, backfills
docs/, ai-migration/    Decision logs, phase reports for the AI migration
```
`*` = part of this merge delta.

### 1.2 Major modules

Home dashboard (module registry), Research (universal, all asset classes), Screener (7 asset classes), Wire (scanner/market intelligence), Compare, Portfolio (universal, multi-portfolio + simulator), Watchlist, Valuation, Calendar, IC Report (9-agent pipeline), Engine (Python quant desk), Thematic, Knowledge Graph, Decision Journal, Manual Assets, Landing. Details in §2.

### 1.3 Data flow

```
Page (client or server component)
  → app/api/*/route.ts        validate input, no business logic
    → lib/* domain function
      → lib/platform/data-layer.ts getDataset()
          fresh cache hit → serve
          stale-within-SWR → serve + background refresh
          in-flight dedupe → attach
          → provider fetch: lib/yahoo.ts | lib/edgar.ts | lib/screener-in.ts |
            lib/amfi.ts | lib/ai/* (AI generation is itself a dataset: aiVerdict)
      → lib/db.ts (SQLite CRUD — the only module that touches app.db)
  → JSON or ReadableStream (SSE) response
```

The Python engine (`engine/daily_run.py`) is a separate process: it writes `data/scorecard_snapshot.parquet` + `data/engine.duckdb`; Next.js only reads (via `/api/engine/*`).

### 1.4 State management

- **SQLite (`data/app.db`, via `lib/db.ts` only):** watchlist (+groups, members, target history), portfolios/portfolio/portfolio_lot, research sessions/messages/notes, fundamentals_cache, platform_cache, scanner cache/snapshot, sector-rotation snapshots, kg_snapshot, timeline_event, notification, decision journal, chart_drawing, manual_asset, portfolio_snapshot, simulation, saved_screen, activity, attention_dismissal, home_fingerprint, valuation_case/valuation_event (event-sourced), ai_job/ai_result, price_alert_state, real_estate_lookup_cache — and, new in this delta, `page_fingerprint` (§10).
- **Client contexts:** `lib/ios-context.tsx` (Investment Operating System — profile, portfolio-fit, behavioral signals; localStorage), `lib/focus-context.tsx` (focus-symbol spine, last-5 working set; sessionStorage), theme (localStorage `uaa-theme`, `data-theme` attribute), toast, boot-splash. The materiality lens state is deliberately per-page component state — not global, not persisted.
- **Derived, never persisted:** screener results, portfolio metrics, comparison metrics, sector concentration, knowledge graph.

### 1.5 API architecture

- Route handlers under `app/api/`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, manual validation (symbol regex etc.), non-fatal partial-data error handling.
- Streaming via `ReadableStream`/SSE: `/api/ai/report`, `/api/ai/verdict`, `/api/compare/stream`, `/api/research/bundle`, `/api/portfolio/audit`, IC report, thematic, scanner.
- Exports are server-only routes (ExcelJS/PDFKit never imported into client components).

### 1.6 AI architecture

- **Single entry:** all inference goes through `runPrompt`/`runTask*` (`lib/ai.ts`) or the structured `runAnalysis()` seam (`lib/ai/analysis*.ts`). Feature code names a **task**, never a model/provider.
- **Chain:** Router walks providers in `AI_PROVIDER_ORDER` (default Devin hosted → Ollama local), gating on availability, memory (`AI_MAX_MODEL_GB`), capabilities; scores model quality vs task latency class (35 task types: `deep`/`standard`/`light`, `interactive`/`standard`/`background`).
- **Two Devin transports:** `lib/ai/devin-cli.ts` (spawns `devin -p`, the only subprocess site) and `lib/ai/providers/devin/client.ts` (sessions API over HTTP — the only module talking to `api.devin.ai`). `lib/ai/ollama.ts` is the only HTTP client for the local daemon.
- **Analysis seam:** `runAnalysis({taskType, subjectKey, prompt, schema, wireSchema, schemaVersion, …})` — Devin path returns schema-validated structured output (wire schema enforced server-side); Ollama path uses JSON mode (or, where a call site historically ran unconstrained, `ollamaJsonMode:false`) + tolerant parse. Idempotency key = task + subject + input hash + schema version; jobs/results persisted in `ai_job`/`ai_result`. Migrated call sites so far: verdict (Tranche 3), portfolio thesis + home brief (Tranche 4), equity compare + class compare + simulator (Tranche 5), plus the earlier insight/calendar/watchlist tranche.
- **Verdicts:** plan-based (`lib/ai/verdict.ts`), grounded (`lib/ai/grounding.ts`), cached under the platform's `aiVerdict` policy (6h fresh / 24h SWR, dependency-invalidated), never-throwing (degrades to an offline verdict).
- **Guardrails:** interactive-latency tasks stay on Ollama under a global `AI_PROVIDER=devin` unless explicitly pinned; directional conclusions are computed in code, not by the model (see AGENTS.md "Product Rules").

### 1.7 Database usage

SQLite (`node:sqlite`) for all user/app state (§1.4); DuckDB (`data/engine.duckdb`) internal to the Python engine; Parquet (`data/scorecard_snapshot.parquet`) as the engine→app contract; ancillary on-disk caches under `data/` (edgar_cache, nse_cache, universe_cache, JSON health/status files). All of `data/` is gitignored.

### 1.8 Caching

- **Platform data layer** (`lib/platform/registry.ts`): per-dataset TTL/SWR/persist policies — e.g. quote 15s, history 15m/2h, fundamentals 4h/12h, statements 12h, filings 6h, screenerIn 6h, `aiVerdict` 6h/24h persisted, `thematicReport` 12h/6d — plus **dependency-aware invalidation** (new filings cascade → statements → fundamentals → companyContext → aiVerdict). New in this delta: `amfiTer` (3d/7d, dependent of `fundProfile`).
- **Legacy per-feature caches:** `fundamentals_cache` (24h, screener), `scanner_cache` (15m; also the home brief's hourly cache and the thesis's content-hash short-circuit).
- **Engine Parquet:** regenerated per engine run, read-only.
- No HTTP-level caching; everything is application-layer.

### 1.9 Background jobs

Registered in `instrumentation.ts` (server boot; HMR-idempotent via `Symbol.for` guards):
1. Sentry (if configured)
2. Alert monitor (`lib/monitor.ts`) — `UAA_MONITOR_INTERVAL_MS`, default 5m; writes notifications + price crossing state
3. Scanner scheduler (`lib/scanner/scheduler.ts`) — `UAA_SCANNER_INTERVAL_MS`, default 1h
4. **Verdict cache warmer (`lib/ai/verdict-warmer.ts`) — new in this delta** — `UAA_VERDICT_WARM_INTERVAL_MS`, default 6h; warms watchlist ∪ portfolio verdicts, Devin-only (§5)

Outside the Next.js process: Python engine daily run (manual/cron), `scripts/monitor.mjs` poller.

---

## 2. Every Feature (grouped by page)

### Cross-cutting (global chrome)

| Feature | What / why | Key files | Depends on |
|---|---|---|---|
| Command palette (⌘K) | Symbol-first search + verbs (Research/Compare/Valuation/IC) + tool nav; keyboard-driven use | `app/_components/command-palette.tsx`, `nav-config.tsx` | `/api/search`, focus spine |
| Theme (dark/light) | Persisted visual preference, SSR-safe, no flash | `app/_components/theme.tsx` | localStorage, `data-theme` attribute |
| Toasts | Non-blocking action feedback with undo actions | `app/_components/toast.tsx` | React portal |
| Notification bell | Unread badge + dropdown for monitor-generated alerts; OS notifications | `app/_components/notification-bell.tsx` | `notification` table, `/api/monitor/run`, `/api/notifications` |
| Symbol search | Shared debounced typeahead | `app/_components/symbol-search.tsx` | `/api/search` (Yahoo suggestions) |
| Focus spine | Last-5 acted-on symbols carried across tools | `lib/focus-context.tsx` | sessionStorage |
| IOS context | Investment profile + portfolio-fit + behavioral signals available to every module | `lib/ios-context.tsx`, `app/api/ios` | localStorage, portfolio |
| AI app assistant | Global "how do I…" helper + NL screening handoff | `app/_components/ai-assistant.tsx`, `lib/ai-app-assistant.ts` | `app-assistant` task |
| **Materiality lens** (new in delta) | "N flagged" toggle on /research and /portfolio; fades immaterial content, keeps flagged | `app/_components/materiality-lens.tsx`, `lib/materiality.ts`, `app/api/materiality/*` | `page_fingerprint` + `activity` tables, universe stats |

### `/` — Home dashboard
Composable module registry (`lib/home/registry.ts`, `app/_home/module-map.ts`) — adding a module never touches `app/page.tsx`.
- **Today's Brief / AI Investment Brief** — AI morning note (regime, opportunities, risks, actions) with deterministic fallback; now generated through the analysis seam (Tranche 4). `app/_home/modules/todays-brief.tsx`, `/api/home/brief`, `lib/home/brief.ts`; `daily-briefing` task.
- **Book** — portfolio health/P&L/cash card. `/api/portfolio/report`.
- **Since Last Visit** — materiality-filtered diff vs previous visit (two-slot `home_fingerprint`). `app/_home/modules/whats-changed.tsx`.
- **Attention Queue** — ranked, dismissible decision inbox (`attention_dismissal` table).
- **Radar** — ideas entering the pipeline (scanner fits, buy candidates).
- **Market Intelligence** — live tape: indices, VIX, breadth, rates, commodities, FX, crypto (60s poll).

### `/research` — Universal research workspace
One page for all asset classes; auto-detects equity / fund / crypto / commodity / forex / macro / derivatives (`lib/asset-class.ts`) and renders class-specific modules.
- **Decision hero + streaming AI verdict** — recommendation, confidence, key metrics, catalysts/risks; personalized; streamed section-by-section. `_components/decision-hero.tsx`, `/api/ai/report`, `lib/ai/verdict.ts`.
- **Conviction breakdown** — deterministic score decomposition (`lib/scoring.ts`) with risk drill-down.
- **Interactive chart** — 5y OHLCV, MAs, benchmarks, drawings (persisted in `chart_drawing`), fullscreen chart-QA ("Ask AI").
- **Movement explainer** — "why did this move" (returns + volume anomaly + news + sector context, AI synthesis). `lib/movement-explainer.ts`, `/api/movement`.
- **Research copilot** — multi-turn chat persisted per session (`research_session`/`research_message`).
- **Financials / Ownership / Details tabs** — statements charts, earnings, analyst consensus, insider + institutional ownership, SEC filings (EDGAR), news, peers, risk heat map, timeline / knowledge-graph / related-opportunity preview cards, research notes.
- **India equity modules** — screener.in snapshot, ratio sparklines, shareholding pattern, ranked peers, AI section insights. `lib/screener-in.ts`, `lib/india-snapshot.ts`.
- **Fund modules** — fund score, profile (family/category/TER/AUM/allocation), holdings, performance-vs-category, AI fund insight. `lib/fund-scoring.ts`, `lib/yahoo.ts#getFundProfile`, **`lib/amfi.ts` (new)**.
- **Crypto / commodity / forex / macro modules** — class-tailored score cards + AI insights (`lib/*-scoring.ts`, `lib/macro-analysis.ts`).
- **Derivatives summary** — options chain, IV, term structure (additive on equity/fund underlyings).
- **Materiality lens** (new in delta) — see §3.
- `/research/india` and `/stocks/[symbol]` are compatibility redirects. `/research/manual` + `/research/manual/[id]` — manual assets (real estate via RentCast, private markets, alternatives) with per-asset AI insight/chat (`manual_asset` table).

### `/screener`
Universal screener across 7 asset classes (equity incl. small-cap/REIT sub-universes, fund/ETF, crypto, commodity, bond, forex): registry-driven filters with histograms, templates, rank scoring, saved screens with entry/exit diffs (`saved_screen`), background universe builds with progress/ETA, "why empty" diagnostics, AI result summary + natural-language screen parsing (`nl-screener` task), Excel export, stage-to-watchlist/portfolio batch actions.

### `/wire`
Consolidated market intelligence: regime banner, AI market summary (streamed), ranked opportunity cards with portfolio fit, emerging themes, cause-and-effect chains with evidence, unified sector rotation (RRG quadrants), risk monitor, portfolio impact, live news tape, focus-region command bar, full scanner pipeline runs (15m cache, scheduler-refreshed).

### `/compare`
Equity comparison across 14 metric groups (valuation, growth, quality, health, momentum, analyst) with sector benchmarks, radar + multi-line charts, hover symbol tracking; parallel class-tailored frameworks for ETF/REIT/crypto/commodity/bond/forex (`lib/compare/`); streaming AI comparison verdict; Excel export.

### `/portfolio`
Universal multi-asset portfolio: dashboard (severity-ranked health scorecard, allocation, macro factor exposure, trajectory, additive attribution with residual assertion), holdings (lot-level, per-class adapters), performance (TWR/XIRR vs benchmark, drawdown), risk lab (concentration/HHI, beta, correlation, stress scenarios), decision center (reduce/add/new-position recommendations), pipeline board (idea stages with provenance), optimizer (objectives, previews, trade impacts, undo via `portfolio_snapshot`), **Simulator** (AI mandate intake → generated book → evaluate → promote; `simulation` table), AI thesis banner with code-computed `ESTABLISHED CONCLUSIONS` and ground-truth verdict tagging (`lib/portfolio/thesis.ts` — now generated through the analysis seam, Tranche 4), multi-portfolio support, **materiality lens** (new in delta).

### `/watchlist`
Level-oriented rebuild: groups with benchmarks, target prices with direction + revision history, alert thresholds with crossing detection (`price_alert_state`), stage column, notes, live quotes with tick flash, portfolio-fit and "why is this an 83" dimensions, consensus-vs-your-target comparison, AI watchlist intelligence digest, Excel export.

### `/valuation`
Persisted valuation case per symbol (event-sourced: `valuation_event` append-only truth, `valuation_case` projection): assumption editing with instant recompute, market-implied expectations, AI assumption refinement that respects user-owned inputs, case history, exports.

### `/calendar`
Earnings/ex-div/dividend/macro events; time buckets, region/impact/type filters, event drawer with pre/post-event performance, AI calendar brief.

### `/ic-report`
9-domain multi-agent institutional report (business, industry, competition, management, capital allocation, accounting, valuation, governance, risk) on the canonical, provenance-carrying data object (`lib/ic/canonical.ts`); deterministic valuation engine (model proposes inputs only); progressive streaming render; thesis/valuation/agents/signals/watch/data tabs; PDF/Markdown/JSON export with embedded Unicode fonts.

### `/engine`
Quant desk on the Python pipeline output: HMM regime hero, adaptive factor weights (IC-derived), conviction book with P10/P50/P90 bands + Kelly sizing, changed-today, breadth map, scorecard table, model health (live IC), on-demand OOS validation, run console with progress, Excel export.

### `/thematic`
10-stage thematic framework (future state → dependency chains → bottlenecks → supply/demand → commodities → geopolitics → India leapfrog → company tiers → quality → opportunity score); streamed; cached 12h/6d; exports.

### `/knowledge-graph`
Force-directed/radial/table entity graph over 4 scopes (symbol/sector/portfolio/watchlist) with look-through overlap engine, node/edge filtering, full view state in URL, inspector with AI "why connected" explanations.

### `/journal`
Decision journal: log buy/watch/hold/avoid/sell with conviction, thesis, price/target/horizon (live-price prefill); close with outcomes; calibration track record by conviction and fit tier; thesis-evolution panel; pipeline deep-links.

### `/landing`
Static, dependency-free marketing page with canned interactive demo.

### API route families (one-liners)
`/api/ai/*` (verdict, report, assistant, chart-qa, insights, jobs), `/api/research/*` (bundle stream, chat, context), `/api/screener/*` (+nl, saved, explain), `/api/scanner*`, `/api/compare*` (+stream, class), `/api/portfolio/*` (report, performance, scenario, audit, optimize/*, simulator/*, manage, buy, allocate-cash), `/api/watchlist*`, `/api/valuation/*`, `/api/calendar*`, `/api/ic-report*`, `/api/engine/*`, `/api/thematic*`, `/api/knowledge-graph*`, `/api/timeline*`, `/api/home/*`, `/api/notifications*`, `/api/monitor/run`, `/api/manual-assets/*`, `/api/export/*` (10 exporters), `/api/quote|search|fundamentals|peers|news|movement|market-summary|sector-rotation|macro|fund|crypto|commodity|forex|derivatives|dcf|decisions|notes|chart-drawings|chart-history|pipeline|platform|materiality/*`.

---

## 3. UI Changes (vs `origin/main`)

All UI changes are in the **uncommitted** working tree. (Manifest: M#14–M#17, M#20–M#22.)

1. **Materiality lens (new interaction pattern, /research + /portfolio).**
   - New shared control `LensControl` ("N flagged" pill; `d` toggles, Esc clears; keyboard handler carefully yields to inputs and *visible* dialogs) and `MaterialFade` wrapper (fades immaterial sections to 30% opacity, keeps flagged ones crisp, hover reason via `title`). `app/_components/materiality-lens.tsx` (untracked).
   - `/research`: lens control in the masthead action row; fades/keeps conviction breakdown, score card, earnings card, provenance rows, analyst card, risk heat map (per-tile fading via new `lensActive` prop on `RiskHeatmap`), SEC filings section, timeline preview. Flags derive from peer-group dimension percentiles, risk levels, data freshness, and "changed since your last visit".
   - `/portfolio`: lens control in header; fades stat tiles, trajectory/health/allocation/attribution/macro panels and the holdings panel; concentration rows get hover reasons; a new "tier change since last visit" callout list renders while the lens is on.
2. **Mutual-fund research masthead** (`app/research/page.tsx`): fund **name leads** and the opaque Morningstar symbol (`0P0001BA9B.BO`) demotes to a small mono suffix; ticker-first retained for everything with a real ticker.
3. **Fund-shaped stat strips**: mutual funds show Net assets (plan) / YTD return / P/E (holdings) / 52-week range / Previous NAV / Exchange instead of rendering market cap, day range and volume as "—"; ETFs lead with AUM but keep range/volume; equities now format market cap in the **listing currency** (₹/¥/€… — previously hardcoded `$`).
4. **Fund profile card**: adds Total net assets (currency-correct, "(this plan)" label for per-share-class Morningstar figures), AMFI-badged expense ratio provenance, Morningstar star rating, inception date.
5. **Fund performance card**: titles itself "Performance" (not "Performance vs Category") and explains the absence of a category benchmark instead of rendering dashes.
6. **INR formatting app-wide**: `formatCompactCurrency` now renders crore/lakh with Indian digit grouping ("₹3,626.2 Cr", "₹19,94,000 Cr") instead of "₹36.26B".
7. **Timeline preview card** accepts pre-fetched events (`initialEvents`) — no visual change, removes a duplicate loading state on the Details tab.

Tranches 4–5 (committed) have **no UI change**: the home brief, portfolio thesis, compare verdicts, and simulator render identically; only their generation path changed.

## 4. Backend Changes

(Manifest: M#11–M#12, M#19–M#22, M#3.)

1. **AMFI data source (new provider)** — `lib/amfi.ts` (untracked): fetches AMFI's official monthly scheme-level TER table per AMC, matches Yahoo fund names → AMFI schemes (curated 56-AMC regex map, Regular/Direct plan detection), returns null on any failure. Wired into `buildFundProfile` for INR funds with no Yahoo TER. New `amfiTer` dataset policy (3d TTL / 7d SWR, persisted, dependent of `fundProfile`) in `lib/platform/registry.ts`; new `"amfi"` `DataSourceId` in `lib/provenance.ts`.
2. **Fund profile pipeline rewrite** — `lib/yahoo.ts`: pure, exported `mapFundProfile()`; requests 3 additional quoteSummary modules (`defaultKeyStatistics`, `summaryDetail`, `price`); zero-as-missing handling for expense ratio/turnover/AUM; AUM sourced from `summaryDetail.totalAssets` (live, raw units) instead of the stale millions figure; all-zero category baselines rejected; new fields: `currency`, `morningstarRating`, `inceptionDate`, `expenseRatioSource`. **`fundProfile` dataset cache key bumped to `v: 3`** so stale persisted rows miss.
3. **Display-name resolution on write** — `lib/yahoo.ts#resolveDisplayName()`; `/api/watchlist` and `/api/portfolio` POST now resolve a real name when the caller supplies none (fixes Morningstar-ID-as-name); one-off repair script `scripts/backfill-display-names.ts` (dry-run by default, `--apply` to write).
4. **Materiality endpoints** — `GET /api/materiality/research` (peer-group percentiles from Screener universe stats + prior visit timestamp) and `POST /api/materiality/portfolio` (two-slot score-baseline exchange); `GET` added to `/api/home/activity` (`getActivityAt`).
5. **DB layer** — new `page_fingerprint` table + `get/putPageFingerprint`, new `getActivityAt` (§10).
6. **Fund screener honesty** — `lib/screener/universes/fund-shared.ts` treats a 0 expense ratio as missing so unknown-fee funds can't rank cheapest.
7. **Verdict warmer background job** (committed) — see §5.

## 5. AI Changes

All committed (the 6 unpushed commits), continuing the Ollama→Devin migration (`ai-migration/` decision log). (Manifest: M#1–M#10, M#18, M#24.)

1. **Devin API client speaks both API generations** (`lib/ai/providers/devin/client.ts`): keyed off credential prefix — `cog_…` → v3 org-scoped API (full feature set: `structured_output_required`, `devin_mode`, `resumable`, ACU reporting); `apk_…` → legacy v1 personal-key API. v1 responses are translated to the v3 status vocabulary at the edge (`blocked`→waiting_for_user, `finished`, `expired`→exit); v3-only create fields stripped for v1; list pagination (cursor vs offset) and health-check differences handled. `DEVIN_ORG_ID` is now optional when the key is `apk_`. Spike evidence: `ai-migration/04b-spike-results-v1-key.md` (5/5 first-attempt schema-valid, p50 33s), `scripts/devin-spike-v1compat.ts` (replaces `devin-spike-sessions.ts`).
2. **Verdict migrated onto the analysis seam** (Tranche 3, `lib/ai/verdict.ts`): `generateVerdict` now calls `runAnalysis()` (AI_PROVIDER decides Devin vs Ollama) instead of `runPrompt`. Deliberate asymmetry preserved: unparseable Ollama output → plan defaults (pre-migration behavior); Devin failure → offline verdict, which `cacheVerdict` refuses to persist.
3. **Verdict schema v2** (`lib/ai/schemas/verdict.ts`): two Zod views — constraint-carrying `VerdictWireSchema` (compiled to Draft-7 JSON Schema for Devin structured output; bullish/bearish/neutral verdict, keyMetrics with signals, enum confidence) and pass-through `VerdictParseSchema` (defaulting stays in `coerceFields`, one implementation). **`VERDICT_SCHEMA_VERSION` bumped 1→2** — participates in every cache/idempotency key.
4. **Verdict cache warmer** (`lib/ai/verdict-warmer.ts`, started from `instrumentation.ts`): sweeps watchlist ∪ portfolio symbols through `getVerdict` so research-page visits hit the 6h `aiVerdict` cache. Two restraints: **Devin-only** (warming through the serializing local daemon would starve interactive users) and **un-personalized** (generic variant only). Never-overlapping ticks, HMR-idempotent, worker concurrency = `DEVIN_API_CONCURRENCY` (default 4), first sweep 90s after boot.
5. **Tranche 4: portfolio thesis + home brief through the analysis seam** (`ffb6d77`):
   - `lib/home/brief.ts` and `lib/portfolio/thesis.ts` migrate from `runPrompt` + `extractJsonObject` to `runAnalysis()`. All coercion/defaulting stays in feature code (per-field fallbacks, `readNote`, `resolveSectionConflicts`, grounding gate) — the parse view is the new shared `LooseObjectSchema` (`lib/ai/schemas/loose.ts`), following the verdict precedent so no defaulting is ever duplicated.
   - New wire schemas with **honesty affordances**: `PortfolioThesisWireSchema` (v1) permits an *empty* `bearCase` (a min-length would convert "no substantive bear case" into forced fabrication at the validation layer); `HomeBriefWireSchema` (v1) makes `note` nullable ("no long-form note today" is a legal answer). Both versions participate in cache/idempotency keys (`PORTFOLIO_THESIS_SCHEMA_VERSION`, `HOME_BRIEF_SCHEMA_VERSION`).
   - New seam surface `ollamaJsonMode` (`lib/ai/analysis-provider.ts`, `providers/ollama-analysis.ts`): the home brief historically ran the local model *without* `format:"json"` and mopped up with `extractJson`; that quirk is preserved explicitly rather than silently "fixed" — the byte-identical-under-Ollama migration discipline.
   - Task registry: `devinTimeoutMs: 240_000` declared for `portfolio-intelligence` and `daily-briefing` (tail-based; the thesis dossier is the largest prompt in its class).
   - Measured parity: thesis 2/2, brief 4/4 (including the no-portfolio degenerate case — neither provider invented holdings); zero wire-incompleteness. Thesis tests reseated from a `runPrompt` mock to a `runAnalysis` mock; all pass unchanged. Report: `ai-migration/08-tranche4-thesis-brief.md`.
6. **Tranche 5: compare (equity + class) and simulator through the analysis seam** (`2be6ba1`):
   - Three more call sites migrate: `lib/ai-compare.ts` (equity compare reuses `flatFromStreamedFields` so the blocking, streamed, and seam paths converge on one shape), `lib/compare/class-ai-compare.ts` (per-class `keyQuestions` contract carried on the wire), and `lib/portfolio/simulator/generate.ts` (both structured stages get wire schemas; `parseSelectionResponse` splits into a bag-shaped worker so mandate enforcement exists once).
   - New wire schemas (`lib/ai/schemas/comparison.ts`, `lib/ai/schemas/simulator.ts`, both v1) constrain **shape, not policy**: deterministic guards (`normalizeAllocation`, `normalizeRankings` back-filling) stay downstream; `noClearWinner` accepts boolean or `"true"/"false"` strings; ranking symbols deliberately not enum-constrained (one bad symbol must not cost the whole comparison). Notably the parity gate ran in reverse — token-stack outputs tripped three wire caps stricter than observed legitimate behavior, so the *wire* was relaxed (strengths ≤6, `why` min 1) rather than the models constrained.
   - `classifyAiError` (`lib/ai/errors.ts`) maps `DevinAnalysisError.category` onto `AiErrorCategory` (duck-typed, no import cycle) so Compare's `aiStatus` copy stays truthful and cancellation still rethrows. `portfolio-construction` stays guardrailed to the local token stack (interactive); task registry declares `devinTimeoutMs` 300s for compare, 240s for the simulator when pinned.
   - Measured parity: identical ranking *and* confidence (NVDA>MSFT>AAPL, 82) across providers; simulator allocations within ±5pp of each other, both inside the mandate. Report: `ai-migration/09-tranche5-compare-simulator.md`.
7. **Provider flip on this machine**: `.env.local` sets `AI_PROVIDER=devin` (machine-local, not tracked); `docs/devin-integration.md` policy text amended accordingly.
8. Uncommitted AI prompt fixes: fund verdict/research prompts state "not reported by our data source — do NOT assume it is zero or low" for missing TER, and format net assets in the fund's own currency (stops fabricated fee claims and $-mislabeling).

## 6. Performance Improvements

- **Verdict cache warming** — measured motivation in the migration log: a repeat research view goes from a full generation (~115s local) to a cache hit (~0.04s); warming makes the *first* view a hit for symbols the user demonstrably cares about. Devin sessions parallelize (no ceiling found to 40), so warming is near-free in wall-clock.
- **AMFI fetch amortization** — TER table cached per AMC (one ~1.5MB fetch covers every scheme in the house; 3d TTL vs monthly publication cadence).
- **Timeline fetch dedupe on /research** — the lens fetches the timeline at page load; `TimelinePreviewCard` reuses those events instead of issuing a second `/api/timeline` call.
- **Materiality lens is pure presentation** — toggling never refetches or recomputes (verdicts memoized alongside the data they derive from); portfolio baseline exchange is keyed on `report.generatedAt` (one POST per report build).
- **No second cache layer on the thesis** — Tranche 4 deliberately passes no `maxAgeMs` to the seam: the existing content-hash `scanner_cache` short-circuit remains the feature's freshness policy rather than fighting a new one.
- Legacy-key spike measured p50 33s vs v3's p50 22s — accepted as a per-machine capability tradeoff, not a regression on the primary path.

## 7. Bug Fixes

All verified against live data per the working-tree comments/tests:

1. **"0.00% expense ratio" rendered as a strength** — Yahoo encodes "not reported" as literal 0 for every Indian mutual fund; taken at face value it scored a perfect Cost factor. Now zero-as-missing at every consumer (`mapFundProfile`, fund screener), with AMFI recovery of the real TER (0.5–2%).
2. **Fabricated "+10.3pp vs category"** — Yahoo pads missing category baselines with zeros; diffing against them converted a fund's absolute return into a fake category edge. All-zero baselines now rejected; score labels/rationale say "absolute" vs "vs category" explicitly (`lib/fund-scoring.ts`).
3. **Fund AUM wrong and mislabeled** — `fundProfile.totalNetAssets` is in *millions* and was observed ~$300B stale for SPY; now sourced from `summaryDetail.totalAssets` (raw units, current). Morningstar net assets are per **share class** — UI labels "(this plan)" so it doesn't read ~10x low vs scheme-level AUM.
4. **Currency mislabeling** — market cap/net assets/prompt figures used a hardcoded `$` regardless of listing currency (₹ funds off by the FX rate). Now `formatCompactCurrency(value, currency)` everywhere in the touched paths.
5. **Indian mutual funds hitting screener.in** — `isIndia` alone routed Morningstar `0P…` `.BO` symbols to the India *company* API, which fuzzy-matched a random company and rendered its equity snapshot on the fund page. New `isIndiaEquity` guard on every India-specific module.
6. **Morningstar ID shown as the "name"** — watchlist/portfolio quick-adds persisted the raw symbol as the name; now resolved via `resolveDisplayName` (+ backfill script for existing rows). Journal's dead `shortName` preference removed.
7. **Mutual-fund stat strip rendered as broken data** — market cap/day range/volume showed "—" (NAV-priced instruments don't have them); replaced by fund-shaped stats.
8. (Committed) **Devin config error message** no longer instructs setting `DEVIN_ORG_ID` for personal keys that don't need it; v1 "blocked" sessions are answered rather than treated as terminal.

## 8. Refactors

- `buildFundProfile` split into pure, exported `mapFundProfile()` + a thin fetch wrapper — mapping now unit-tested directly (`tests/yahoo.test.ts`, +113 lines).
- Verdict parsing consolidated: the Phase-4 spike schema moved into the spike script; runtime schema is single-sourced in `lib/ai/schemas/verdict.ts` with defaulting kept in exactly one place (`coerceFields`).
- **Shared pass-through parse schema** (`lib/ai/schemas/loose.ts`) extracted for all migrated call sites whose coercion lives in feature code — Tranche 4's thesis and brief and Tranche 5's compare/simulator all use it instead of duplicating the verdict's pattern.
- Equity compare's blocking, streamed, and seam paths converge on one shape via `flatFromStreamedFields`; the simulator's `parseSelectionResponse` split into a bag-shaped worker so mandate enforcement exists exactly once.
- `buildThesisPrompt` and `buildHomeBriefPrompt` exported so the parity harness runs the *exact* production prompts over real data (no synthetic portfolios).
- `credentials()` in the Devin client returns `{key, base, legacy}` — base-URL selection and generation branching in one function; v1→v3 translation isolated at the client edge so the provider has one lifecycle.
- `RiskHeatmap` risk judgment routed through `lib/materiality.ts#isMaterial` so a tile can never disagree with the page's flag count.
- `TimelinePreviewCard` gains an injected-data path instead of a second fetch.
- `scripts/devin-spike-sessions.ts` → `scripts/devin-spike-v1compat.ts`; `scripts/ai-parity.ts` extended (+250 lines across Tranches 4–5) to both providers/generations and the five newly migrated call sites.
- Thesis tests reseated from a `runPrompt` mock to a `runAnalysis` mock recording the same tuple (`tests/portfolio-thesis.test.ts`) — behavior assertions unchanged.

## 9. New Dependencies

**None.** No changes to `package.json` / `package-lock.json` / `requirements.txt` in this delta. `lib/amfi.ts` uses plain `fetch`; the materiality lens is dependency-free; all new schemas use the already-present Zod.

## 10. Database Schema Changes

One additive change (uncommitted, in `lib/db.ts`; created via `CREATE TABLE IF NOT EXISTS` at open — no migration needed):

```sql
CREATE TABLE IF NOT EXISTS page_fingerprint (
  page     TEXT NOT NULL,
  slot     TEXT NOT NULL CHECK (slot IN ('current', 'baseline')),
  data     TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  PRIMARY KEY (page, slot)
);
```
Two-slot per-page change baselines for the materiality lens (same design as `home_fingerprint`; e.g. `page = 'portfolio-scores'` stores symbol → holding score). New accessors: `getPageFingerprint`/`putPageFingerprint`, plus read-only `getActivityAt(kind, ref)` over the existing `activity` table.

**Semantic (not DDL) cache-shape changes:** `fundProfile` platform-cache rows re-keyed (`v: 3`); analysis cache/idempotency keys re-versioned via `VERDICT_SCHEMA_VERSION = 2` and newly introduced `PORTFOLIO_THESIS_SCHEMA_VERSION = 1` / `HOME_BRIEF_SCHEMA_VERSION = 1` / `COMPARISON_SCHEMA_VERSION = 1` / `SIMULATOR_SCHEMA_VERSION = 1`. Old rows become misses, not errors.

## 11. Environment Variable Changes

| Variable | Change |
|---|---|
| `UAA_VERDICT_WARM_INTERVAL_MS` | **New** (committed). Verdict-warmer interval; default 6h (= `aiVerdict` fresh TTL), floor 15m, `0` disables. Documented in `ai-migration/07-tranche3-verdict.md` but **not yet in `.env.example`** — worth adding before merge. |
| `DEVIN_API_KEY` | **Semantics extended**: now accepts legacy `apk_…` personal keys in addition to `cog_…` service-user keys; the prefix selects the API generation. |
| `DEVIN_ORG_ID` | Now **optional** when the key is `apk_…` (still required for `cog_…`). |
| `DEVIN_API_CONCURRENCY` | Reused (not new) as the warmer's worker count — the warmer and the job worker now share this budget. |
| `AI_PROVIDER=devin` | Flipped **in `.env.local` on this machine only** (untracked); repo default remains the documented chain. Behavior differs between machines until each opts in. Under the global flag, `daily-briefing`, `portfolio-intelligence`, and both compare tasks (standard latency) now route to Devin — Tranches 4–5 widened the flag's blast radius; `portfolio-construction` (interactive) stays local unless pinned. |

## 12. Potential Merge Risks

1. **The uncommitted layer depends on untracked files.** `app/portfolio/page.tsx`, `app/research/page.tsx`, `lib/db.ts`, `lib/yahoo.ts` (modified, tracked) import `lib/materiality.ts`, `lib/amfi.ts`, `app/_components/materiality-lens.tsx`, `app/api/materiality/*` (untracked). Committing/merging the modified files **without** the untracked ones breaks the build. They must land as one unit. (Tranche 4's schema files were in the same position until `ffb6d77` committed them — the fund/lens work should follow the same path.)
2. **Cache-version discipline is a semantic conflict surface.** `VERDICT_SCHEMA_VERSION` (2), `PORTFOLIO_THESIS_SCHEMA_VERSION` (1), `HOME_BRIEF_SCHEMA_VERSION` (1), `COMPARISON_SCHEMA_VERSION` (1), `SIMULATOR_SCHEMA_VERSION` (1) and the `fundProfile` `v:3` key were set for reasons documented in comments. If the other side of a merge also changed any of these shapes, a textual auto-merge can produce a shape that no longer matches its version number — cached rows would then be served as if valid. Any conflict touching these constants requires a human deciding the next version.
3. **`AI_PROVIDER` split-brain.** The warmer is a no-op under Ollama by design; on machines still defaulting to Ollama the "warmed verdict" behavior silently doesn't exist, and Tranche 4–5's brief/thesis/compare run on the local model. Also the warmer consumes Devin ACUs on a schedule — merging it into an environment with a shared/limited key changes cost behavior without any code review flagging it.
4. **Both API generations in one client** rests on the empirical v1 contract (endpoint singular/plural, `status_enum` vocabulary, no ACU field, offset pagination). If upstream refactors `client.ts` (it has been touched in nearly every migration tranche), re-verify against `ai-migration/04b` rather than trusting a clean textual merge.
5. **Migration-discipline flags are easy to "clean up" wrongly.** `ollamaJsonMode:false` on the home brief looks like a bug to a reviewer ("why is JSON mode off for a JSON task?") but is a deliberate byte-identical-behavior preservation; likewise the thesis's absent `maxAgeMs`. Both are comment-documented at the call site — a merge resolution that "fixes" them changes local-path behavior.
6. **Shared-registry append points** (`DatasetId` union, `DATASETS` record, `DataSourceId` union, `Quote`/`FundProfileData` interfaces, `lib/db.ts` DDL block, `instrumentation.ts` register list, task-registry entries, AGENTS.md "Product Rules") are where any two branches both add entries — trivial to resolve but near-certain to conflict textually (see §13).
7. **`resolveDisplayName` adds a network round-trip to watchlist/portfolio writes** (cached, best-effort) — benign, but any upstream change that batches or validates those POST bodies will interact with it.
8. **Backfill script writes to the DB** (`scripts/backfill-display-names.ts --apply`). It's idempotent and never overwrites user-typed names, but it should be run once per machine *after* the merge, not before.
9. **`.env.example` drift** — new/changed variables (§11) aren't reflected there yet; a merge that also edits `.env.example` won't conflict but will silently miss the warmer knob.
10. **Fund-scoring band changes** (3-year absolute fallback bands −5…18 vs relative −6…6) change composite fund scores for funds without category baselines — downstream consumers (screener ranks, cached verdicts citing "Fund score X/100") shift on merge. Verdict cache re-keying (schema v2) already forces regeneration, which mitigates this.
11. **Test-count expectations**: AGENTS.md cites a suite size; this delta adds/extends 9 test files (143 tests across them). CI configured to exact counts would need updating.
12. **Generated audit documents** (`MERGE_SUMMARY.md`, `CHANGE_MANIFEST.md`) are untracked snapshots of a moving tree — date-stamped, and already refreshed twice (Tranches 4 and 5 each landed between generations). Treat them as point-in-time records, not living docs, if committed.

## 13. Files Most Likely To Conflict

Ranked by (local churn) × (historical shared ownership — e.g. `lib/ai/verdict.ts`, `app/research/page.tsx`, `lib/db.ts` have 30 upstream commits by Divit vs 7 by Prisha):

1. `app/research/page.tsx` — largest, hottest page; ~150 changed lines threaded through it (lens, `isIndiaEquity`, stat strips, masthead).
2. `lib/ai/verdict.ts` — changed in *both* the committed and uncommitted layers; also the center of the ongoing migration tranches upstream.
3. `lib/ai/providers/devin/client.ts` — rewritten for dual-generation; every migration tranche touches it.
4. `lib/ai/schemas/verdict.ts` — schema + version constant (see risk #2).
5. `lib/db.ts` — DDL block + accessor sections; both sides of any merge add tables here.
6. `lib/yahoo.ts` — fund-profile section substantially rewritten.
7. `lib/ai/task-registry.ts` — every tranche annotates task entries (`devinTimeoutMs`, migration comments); upstream tranches do the same.
8. `lib/home/brief.ts` / `lib/portfolio/thesis.ts` — Tranche 4 rewrote their generation blocks; both are also product-logic hotspots upstream. Same pattern for Tranche 5's `lib/ai-compare.ts`, `lib/compare/class-ai-compare.ts`, `lib/portfolio/simulator/generate.ts`.
9. `lib/types.ts` — `Quote` and `FundProfileData` interface extensions.
10. `lib/platform/registry.ts` / `lib/platform/types.ts` — dataset record/union appends.
11. `instrumentation.ts` — scheduler registration list.
12. `app/portfolio/page.tsx` — lens threading through the dashboard/holdings render tree.
13. `AGENTS.md` — both collaborators append hard-won rules; appends land in the same section.
14. `lib/format.ts` — `formatCompactCurrency` INR branch.
15. `scripts/ai-parity.ts` — extended by every tranche (Tranches 3, 4, and 5 all append subjects).
16. `tests/yahoo.test.ts`, `tests/format.test.ts`, `tests/ai-analysis-facade.test.ts`, `tests/portfolio-thesis.test.ts` — shared test files extended/reseated.

## 14. Files That Should Never Be Automatically Merged

- **`data/**` (app.db, engine.duckdb, Parquet, caches)** — machine-local user state; gitignored today; never commit or merge.
- **`.env.local`** — machine-local secrets and the `AI_PROVIDER=devin` flip; gitignored; each machine opts in deliberately.
- **`package-lock.json`** — untouched by this delta; if a future merge conflicts here, regenerate via `npm install`, never hand-merge (per the 2026-07-15 shadcn incident in CLAUDE.md).
- **`app/globals.css`** — untouched by this delta, but under a standing repo rule: token blocks silently lose to source-order; any conflict must be resolved by a human who has read the theming section of CLAUDE.md.
- **`lib/ai/schemas/*.ts` and any file defining a cache/schema version constant** (`verdict.ts`, `portfolio-thesis.ts`, `home-brief.ts`, `comparison.ts`, `simulator.ts`; the `fundProfile` `v:` key in `lib/yahoo.ts`) — auto-merging a shape while keeping either side's version number can serve stale cached rows as current (risk #2). Human must bump.
- **`lib/db.ts` DDL block** — SQLite `CREATE TABLE IF NOT EXISTS` means a bad auto-merge fails silently (old shape persists on machines with existing DBs); column-level conflicts need a human and possibly an `ALTER`.
- **`AGENTS.md` / `CLAUDE.md` / `ai-migration/*.md`** — prose decision logs; a union-merge produces contradictory guidance. Merge by reading, not by hunk.
- **`MERGE_SUMMARY.md` / `CHANGE_MANIFEST.md`** — point-in-time generated audits; regenerate rather than merge.
- **`tsconfig.tsbuildinfo`, `.next/`, `bench-out/`** — generated; gitignored; discard on sight.

## 15. Overall Engineering Summary

This delta is two coherent workstreams sharing one working tree:

**(a) The committed work — AI migration Tranches 3–5 plus legacy-key support** — is disciplined infrastructure engineering. Six call sites (verdict, portfolio thesis, home brief, equity compare, class compare, simulator) moved onto the provider-agnostic analysis seam without changing the local path's observable semantics — a discipline enforced to the point of adding seam surface (`ollamaJsonMode`) solely to preserve one call site's historical quirk rather than silently "fixing" it. Schema versioning is treated as part of the cache key everywhere; wire schemas carry deliberate honesty affordances (an empty bear case, a null brief note, and lenient `noClearWinner` coercion are *legal answers*, because a stricter wire would convert honesty into fabrication — or forbid one provider a quirk the app already tolerates); every tranche lands with measured parity evidence (verdict 15/15, thesis 2/2, brief 4/4, compare identical-ranking-and-confidence, simulator ±5pp) rather than assertion — and in Tranche 5 the gate ran in reverse, relaxing over-strict wire caps instead of constraining the models. The new background warmer copies the proven scheduler pattern and encodes two well-reasoned restraints (Devin-only, un-personalized) directly in code. The dual-generation Devin client is the riskiest piece — it rests on empirically reverse-engineered v1 behavior — but the translation is confined to one module, documented with spike evidence, and degrades safely.

**(b) The uncommitted work — Indian mutual-fund correctness + the materiality lens** — is data-honesty engineering of unusually high quality. The fund fixes attack a genuinely dangerous failure class (a data provider encoding "unknown" as 0, which the scoring layer then rewarded), fix it at the mapping boundary rather than in the UI, add a second official source (AMFI) with explicit provenance, bump the cache version so old wrong rows can't be served, and label every fallback ("absolute", "(this plan)", "· AMFI") so the UI never claims more than the data supports. The materiality lens is architecturally careful: one pure judgment function, three-state verdicts (material / immaterial / *not applicable* — refusing to fade missing data as "examined and fine"), server routes that only supply baselines, and presentation-only toggling.

The main engineering debts at merge time are process, not design: the fund/lens workstream is still uncommitted with load-bearing untracked files (must land atomically, as Tranches 4–5's schemas just did); `.env.example` lags the new configuration surface; and the AI_PROVIDER flip lives in machine-local state, so behavior differs across machines until each opts in. Typecheck is clean and all delta-covering tests pass (143/143). With the remaining work landed as a single commit (or two: fund-honesty + lens), risks concentrate in the well-known shared hotspots listed in §13 — all resolvable by a reviewer who reads the version-constant and migration-discipline comments before accepting either side.
