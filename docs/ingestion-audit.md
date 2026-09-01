# Data Ingestion Audit

**Date:** 2026-08-17
**Method:** Direct code reading (`lib/db.ts` schema read in full; every claim below is grounded
in a file/line citation). Claims that could not be verified end-to-end are marked **uncertain**.

**Scope note on stale docs:** `CLAUDE.md` references `lib/fundamental-screener.ts` and a "24h"
fundamentals TTL. That file no longer exists (screening lives in `lib/screener/` +
`lib/dataset.ts`), and the actual TTL is 12h (`lib/dataset.ts:28`). Treat `CLAUDE.md`'s module
table as directional, not authoritative.

---

## 1. External data entry points

Two ingestion regimes exist:

- **Machine data** (market APIs, scrapes) → almost all flows through the Platform Data Layer
  (`lib/platform/data-layer.ts:85` `getDataset()`): L1 in-memory LRU → L2 SQLite
  `platform_cache` (`lib/db.ts:137-148`), with SWR revalidation and request dedup.
- **User data** (forms, screenshot imports) → written through `lib/db.ts` CRUD into
  product-state tables (`portfolio_lot`, `watchlist`, `manual_asset`, …).

### 1.1 Market data providers

| # | Entry point | Input format / source | Writes to SQLite | Tests |
|---|---|---|---|---|
| 1 | `lib/yahoo.ts` — `getQuote` (:298), `getQuoteSummary` (:192), `getFundamentalsTimeSeries` (:211), `getRichQuotes` (:278), `getHistory` (:366), `getIntradayHistory` (:488), `getCorporateActions` (:411) | JSON via `yahoo-finance2` npm lib; **`validateResult: false` on all calls** (:184, :287, :307) | `platform_cache` via `getDataset()` (datasets: `quote`, `quoteSummary`, `fundamentalsTimeSeries`, `quotes.batch`, `history`, `corporateActions`) | `tests/yahoo.test.ts` — mapper unit tests (`mapQuote`, `mapHistory`, `mapSuggestion`), network mocked |
| 2 | `lib/yahoo-screener.ts` — `getAuth` (:30), `postScreener` (:92), `runRawScreener` (:156) | JSON from Yahoo screener API (cookie+crumb auth) | No direct SQLite write; consumed by `lib/screener/universes/*`. **Uncertain** whether results are persisted downstream | No dedicated test found |
| 3 | `lib/screener-in.ts` — `resolveCompany` (:232) + ratio/statement scrapers (:287-:465) | JSON search API + **HTML scraping** of screener.in company pages (regex/string parsing, `stripTags`/`decodeEntities`) | `platform_cache` (dataset `screenerIn`, TTL 6h / SWR 1d, persisted — `lib/platform/registry.ts:120`) | `tests/screener-in.test.ts` — parser unit tests |
| 4 | `lib/edgar.ts` — `loadTickerMap` (:59), `getRecentFilings` (:196), `searchFormD` (:287), `getFormDDetails` (:351) | JSON from SEC EDGAR; Form D details via **regex-based XML extraction** (:341) | `platform_cache` (datasets `cikMap` TTL 7d, `filings` TTL 6h). Also a JSON-file cache in `data/edgar_cache/` per the uaa-data skill doc — **uncertain**, not re-verified in this pass | `tests/edgar.test.ts` — parser unit tests |
| 5 | `lib/news.ts` — `getCompanyNews` (:107), `fetchMarketNews` (:311) + per-source fetchers (:146-:293) | Yahoo JSON, Google News / Economic Times / Moneycontrol RSS-XML, NSE JSON, NewsAPI JSON (optional `NEWSAPI_KEY`) | **No SQLite write observed** — served to callers directly | No dedicated test found |
| 6 | `lib/india-news.ts` — `fetchNseCorporateAnnouncements` (:428) | NSE announcements JSON + Google News India RSS | `platform_cache` (datasets `indiaAnnouncements` TTL 30m, `indiaNews` TTL 15m) | No dedicated test found (`feed-text.test.ts` covers shared text cleaning — partial) |
| 7 | `lib/india-ownership.ts` — `readIndiaOwnership` (:159), `trickleEnrichIndiaOwnership` (:191) | Derives from cached `screenerIn` pages (no new network) | `platform_cache` (dataset `indiaOwnership`, TTL 7d) via direct `writeCache()` (:171) | No dedicated test found |
| 8 | `lib/amfi.ts` — `getAmfiTerTable` (:278) | JSON from AMFI India API; fund matched by **Jaccard-similarity fuzzy name matching** (:164-191) | `platform_cache` (dataset `amfiTer`, TTL 3d) | `tests/amfi.test.ts` |
| 9 | `lib/rentcast.ts` — `searchRealEstate` (:81) | JSON from RentCast API (`RENTCAST_API_KEY`); fields picked by loose `firstNumber`/`firstString` helpers | Dedicated table `real_estate_lookup_cache` via `putRealEstateLookup()` (`lib/db.ts` ~:1965) | No dedicated test found |
| 10 | `lib/statements.ts` — EDGAR XBRL companyconcept fetch (:170), `extractAnnual` (:61) | SEC XBRL JSON, tag-candidate mapping (:10-41) | No direct write; feeds `lib/fundamentals-data.ts` assembly | No dedicated test found (mappers in `tests/fundamentals-mappers.test.ts` cover the Yahoo side) |
| 11 | `lib/fundamentals.ts` (:385) + `lib/fundamentals-data.ts` (:116) | Yahoo quoteSummary modules, unwrapped `{raw,fmt}` fields | No direct write; underlying fetches go through the platform layer | `tests/fundamentals-mappers.test.ts` |
| 12 | `lib/scanner/signals.ts` — `fetchMacroSignals` (:72), `fetchSectorPerformance` (:97) | Yahoo batch quotes | No direct write; scanner results land in `scanner_cache`/`scanner_snapshot` via callers | No dedicated test found for the fetch layer (`event-screener.test.ts` covers signal logic) |
| 13 | `lib/dataset.ts` — screener dataset factory (`enrichSymbol` per company, `getRichQuotes` price layer) | Yahoo (two calls per company) | **`fundamentals_cache`** via `putFundamentals()` (`lib/db.ts:1891`), TTL 12h (`lib/dataset.ts:28`), persisted every 25 symbols | `tests/enrich.test.ts` covers enrichment; dataset assembly itself **uncertain** |

### 1.2 User-supplied data

| # | Entry point | Input format | Writes to SQLite | Tests |
|---|---|---|---|---|
| 14 | `POST /api/portfolio` (`app/api/portfolio/route.ts:58`) | JSON body (symbol, quantity, avgCost, assetClass, currency) | `portfolio_lot` via `upsertHolding()` → `upsertUniversalPosition()` | `tests/portfolio-universal.test.ts`, `tests/multi-portfolio-db.test.ts` exercise the CRUD; the route handler itself has no test |
| 15 | `POST /api/portfolio/buy` (`app/api/portfolio/buy/route.ts:55`) | JSON body (quantity **or** amount, sellFirst funding, fees, tradeDate) | `portfolio_lot` via `addUniversalLot`/`executeTrades`; `portfolio_snapshot` via `snapshotPortfolio` | `tests/portfolio-buy-asset-classes.test.ts`, `tests/portfolio-transaction*.test.ts` |
| 16 | **Screenshot import** — `POST /api/portfolio/import/extract` + `/apply` (`app/api/portfolio/import/apply/route.ts`) | **Brokerage screenshots → vision LLM** (`lib/portfolio/import/extract.ts:214`, task `portfolio-import`) → sanitize (:73-122) → merge (:144) → deterministic validation vs live quotes (`lib/portfolio/import/validate.ts`) → user review → apply | `portfolio_lot` via `applyPortfolioImport()` (`lib/db.ts`, atomic batch). Lots carry provenance meta: `source: "screenshot-import"`, `costBasisAssumed`, `synthetic` (apply route :50-121) | `tests/portfolio-import.test.ts`, `tests/portfolio-import-db.test.ts` |
| 17 | `POST /api/manual-assets` (`app/api/manual-assets/route.ts:35`) | JSON body (category, acquisitionCost, currentValue, opaque `details` JSON) | `manual_asset` via `createManualAsset()` (`lib/db.ts` ~:3027). `details` is stored **unvalidated** ("opaque JSON, same boundary as fundamentals_cache" — route comment :33) | `tests/portfolio-manual-asset-disposal.test.ts` (partial) |
| 18 | `POST/PATCH/DELETE /api/watchlist` (`app/api/watchlist/route.ts:90-269`) | JSON body; symbol validated, name enriched from Yahoo | `watchlist`, `watchlist_member`, `watchlist_target_history` | `tests/watchlist-groups-db.test.ts`, `tests/watchlist-visit-db.test.ts` (DB layer) |
| 19 | `POST /api/notes` (`app/api/notes/route.ts:20`) | JSON body | `research_notes` via `addNote()` | No dedicated test found |
| 20 | `PUT /api/portfolio/policy` (`app/api/portfolio/policy/route.ts:25`) | JSON policy, validated by `parseInvestorPolicy()` at the boundary | `portfolio_policy` | `tests/portfolio-decisions-policy.test.ts` (**uncertain** whether it covers the parser directly) |
| 21 | `PATCH /api/account` (`app/api/account/route.ts:9`) | JSON (email, displayName) | `user` via `auth().updateProfile()` | `tests/auth.test.ts` |
| 22 | Research copilot chat (`/api/research/*`) | User messages + LLM replies | `research_session`, `research_message` | `tests/ai-research.test.ts` (prompt layer; session persistence **uncertain**) |

### 1.3 Python quant engine (separate process)

| Entry point | Input | Writes | Tests |
|---|---|---|---|
| `engine/data/loader.py` — `fetch_ohlcv` (:368), `_fetch_one_fundamental` (:569) | `yfinance` (`yf.download`, `Ticker.info/fast_info/balance_sheet`) | DuckDB `data/engine.duckdb` (`price_daily`, `fundamentals`); reads `app.db` only to migrate `fundamentals_cache` (loader.py:17) | **None found** |
| `engine/universe.py` — universe getters (:213-:366) | yfinance screener JSON, with hardcoded fallback lists on error (:164) | Nothing (symbol lists) | **None found** |
| `engine/daily_run.py` — `run_daily` (:460) | The above | `data/scorecard_snapshot.parquet`, `data/valuation_priors.json`, `data/detail_snapshots/` | **None found** (Python side); TS readback via `app/api/engine/route.ts:57` (spawns polars to read the parquet) has `tests/engine-desk.test.ts` — **uncertain** how much of the readback it covers |

The engine writes never touch `app.db`; Next.js reads the parquet read-only. The two worlds
meet only at `fundamentals_cache` (one-way migration into DuckDB) and `valuation_priors.json`
(read by `lib/valuation/engine-prior.ts`).

---

## 2. SQLite schema (`data/app.db`)

All 44 tables are created/migrated in `lib/db.ts:50-770` (42 `CREATE TABLE` statements plus
column migrations via guarded `ALTER TABLE`). Classification:

**SOT** = source of truth (user state, unrecoverable if lost).
**Derived/cache** = rebuildable from providers or from SOT tables.

| Table (db.ts line) | Purpose | Class |
|---|---|---|
| `watchlist` (:51) | Tracked symbols + thesis fields (target_price, stage, conviction, buy/sell triggers, source, last_researched_at — added by migrations :631-678) | **SOT** |
| `watchlist_group` (:68), `watchlist_member` (:76) | Named lists + membership join | **SOT** |
| `watchlist_target_history` (:85) | Append-only target revisions | **SOT** (append-only ledger) |
| `watchlist_visit` (:104), `watchlist_price_snapshot` (:109) | "Since last visit" baseline clock + price snapshots | Derived (baseline semantics lost if dropped, but data is provider-sourced) |
| `price_alert_state` (:124) | Last observed price per symbol (turns state tests into crossing tests) | Derived-ish: rebuildable, but losing it drops in-flight crossing detection |
| `fundamentals_cache` (:132) | **Opaque JSON blob** per symbol (`StockFundamentals`), 12h TTL | Cache |
| `platform_cache` (:137) | L2 of the Platform Data Layer — every persisted market dataset | Cache |
| `real_estate_lookup_cache` (:149) | RentCast responses | Cache |
| `portfolios` (:160) | Named portfolios (id 1 = seeded "Main Portfolio") | **SOT** |
| `portfolio` (:165) | **Legacy** aggregate holdings (symbol PK). Read only by the one-time seed migration into `portfolio_lot` (:758-770). No runtime reader found — `listPortfolio()` aggregates lots (:2063) | Legacy/dormant |
| `portfolio_lot` (:172) | **The holdings ledger** — one row per buy/sell. Migrated columns: `asset_class`, `currency`, `unit`, `meta` (:727), `portfolio_id` (:739) | **SOT (the most important table in the DB)** |
| `research_session` (:185), `research_message` (:191), `research_notes` (:201) | Copilot sessions/messages, notes | **SOT** |
| `scanner_cache` (:209) | Generic key→JSON cache, 15-min TTL (:3161). Also used by market summary and some AI insight caches | Cache |
| `scanner_snapshot` (:214), `sector_rotation_snapshot` (:219), `portfolio_intelligence_snapshot` (:227) | Last-run snapshots for diffing "what changed" | Derived (but the *previous-run* baseline is unrecoverable) |
| `timeline_event` (:232) | Per-symbol event log | Mixed — **uncertain**; appears rebuildable from providers but stores computed context |
| `intel_event` (:245), `attention_dismissal` (:385), `decision_dismissal` (:401) | Suppression ledgers (what the user dismissed, with context) | **SOT** (user judgment, unrecoverable) |
| `notification` (:251) | Alert inbox (+ `meta` facts column :614) | **SOT**-ish (historical record) |
| `decision` (:266) | Judgment ledger — action, conviction, price_at, `case_version` (:609, deliberately not backfilled) | **SOT** |
| `chart_drawing` (:286) | User chart annotations | **SOT** |
| `manual_asset` (:297) | Off-market assets; `details` is opaque JSON | **SOT** |
| `portfolio_snapshot` (:312) | Undo snapshots: raw ledger rows as JSON | **SOT** (undo history) |
| `portfolio_policy` (:326) | Investor policy JSON (validated on read by `parseInvestorPolicy`) | **SOT** |
| `simulation` (:337) | Hypothetical portfolios — a *specification*, analytics always recomputed; `headline` is the one denormalization | **SOT** (spec) / headline derived |
| `saved_screen` (:350) | Saved screens + `last_symbols`/`last_run_at` (:626) for change detection | **SOT** (definition) / last_symbols derived |
| `activity` (:371) | "Continue where you left off" (upsert per place, pruned to ~50) | Derived-ish |
| `home_event` (:418) | Append-only dashboard interaction ledger (180-day sweep) | **SOT** (ground truth for tuning) |
| `home_fingerprint` (:432) | current/baseline digest states for diffing | Derived |
| `valuation_case` (:459) | **Materialized projection** of the newest valuation event — "the log is authoritative; if they ever disagree, the projection is wrong" (comment :445-449) | Derived (projection) |
| `valuation_event` (:482) | Append-only valuation log, full assumption snapshot per version + `price_at` | **SOT** |
| `ai_job` (:504), `ai_result` (:527), `ai_call` (:547) | AI job records, result cache (keyed on input hash + schema version), per-attempt telemetry ledger | `ai_result` cache; `ai_call`/`ai_job` observability ledgers |
| `user` (:575), `auth_session` (:586) | Local account (scrypt hash), hashed session tokens | **SOT** |

Structural observations:

- Migrations are all guarded `ALTER TABLE ... catch {}` — idempotent, but a *failed* migration
  is indistinguishable from an already-applied one; there is no schema version table.
- Several SOT tables carry **opaque JSON columns** (`fundamentals_cache.data`,
  `platform_cache.value`, `manual_asset.details`, `portfolio_lot.meta`,
  `portfolio_snapshot.holdings`, `simulation.holdings`). Only some have a validating parser at
  the read boundary (`portfolio_policy` → `parseInvestorPolicy`; `saved_screen.filters` →
  `parseFilters`). `fundamentals_cache` does **not** — see §5.
- Every raw read is cast `as unknown as SomeRow[]` (e.g. :842, :2053, :2163) — schema drift
  produces wrong values, not type errors.

---

## 3. Where numbers are computed

### 3.1 The deterministic arithmetic layer (as designed)

| Domain | Module(s) | Tests |
|---|---|---|
| Batch dimensional scoring (Screener) | `lib/composite.ts` (`valueScore`, `growthScore`, `qualityScore`, `financialHealthScore`, `momentumScore`, `computeScores`) | `tests/composite.test.ts` |
| Single-name decision engine | `lib/scoring.ts` (`scoreValuation`, `scoreQuality`, `scoreGrowth`, `scoreHealth`, `scoreCapitalAllocation`, `computeScore`) | `tests/scoring.test.ts`, `tests/scoring-consistency.test.ts` |
| Score→recommendation bands | `lib/recommendation.ts` (`TIER_EDGES = [25, 42, 60, 78]`) — the only place bands live | `tests/unified-recommendation.test.ts` |
| DCF / valuation workspace | `lib/valuation/` — `dcf.ts` (`runDcf`, `buildScenarios`, `buildSensitivity`, `marginOfSafety`), `wacc.ts` (`computeWacc`), `reverse.ts` (`solveImpliedGrowth`), `calibration.ts`, `revaluation.ts` | `tests/valuation*.test.ts` |
| IC valuation (institutional) | `lib/ic/valuation-engine.ts` (DCF + relative methods + blend), `valuation-suite.ts`; LLM proposals gated by `lib/ic/valuation-inputs.ts` | `tests/ic-valuation*.test.ts` |
| Portfolio math | `lib/portfolio-analytics.ts` (Sharpe/Sortino, correlation, drawdown), `lib/portfolio-lots.ts` (average-cost aggregation, realized P&L), `lib/portfolio-performance.ts` (XIRR, attribution) | `tests/portfolio-*.test.ts` (30+ files), `tests/risk-ratios.test.ts`, `tests/portfolio-lots.test.ts` |
| Technical indicators | `lib/indicators.ts` (EMA/SMA/RSI/MACD/Bollinger/ATR) | `tests/indicators.test.ts` |
| Score primitives | `lib/score-math.ts` (`lerp`, `norm`, `bucket`) | Covered via composite/scoring tests |
| Options | `lib/black-scholes.ts` (Greeks) | **No test found** |
| Asset-class scoring | `lib/fund-scoring.ts`, `lib/crypto-scoring.ts`, `lib/forex-scoring.ts`, `lib/commodity-scoring.ts` | **No dedicated test files found** — uncertain whether covered indirectly |
| India-specific derivation | `lib/india-snapshot.ts` (`deriveIndiaFundamentals` + its own `scoreQuality`/`scoreValuation`/… :331-389 — note: a **third** scoring implementation, separate from both `composite.ts` and `scoring.ts`), `lib/india-ownership-trends.ts`, `lib/india-results.ts` (`pctChange`) | No dedicated tests found |
| Import validation math | `lib/portfolio/import/validate.ts` (qty×price≈marketValue reconciliation, tolerances :32-38) | `tests/portfolio-import.test.ts` |
| Quant engine | `engine/` (factors, HMM regime, Monte Carlo, Kelly) | **No Python tests found** |

### 3.2 Computations that have leaked into LLM-adjacent code paths

Two distinct leak types, ordered by severity. (Formatting numbers *into* a prompt is acceptable
per the project's own contract; the concern is arithmetic living in prompt builders, and numbers
flowing *out* of LLM responses.)

**Type A — numbers flowing OUT of LLM responses into UI/storage:**

1. `lib/ai-compare.ts:580-582` — `confidenceScore` is taken from the model's JSON response,
   clamped inline (`Math.max(0, Math.min(100, Math.round(...)))`), stored in the
   `ComparisonResult` (cached in `ai_result`) and displayed. This is an LLM-emitted number
   presented as a score, validated by nothing but a range clamp — it does not go through the
   `lib/ic/valuation-inputs.ts`-style resolve-and-reject pattern.
2. Screenshot import (`lib/portfolio/import/extract.ts`) — vision-LLM-transcribed quantities and
   cost bases become **source-of-truth ledger rows**. This path is unusually well-defended
   (sanitizer :73-122, cross-screenshot disagreement → nulled + flagged :179-188, deterministic
   reconciliation in `validate.ts`, mandatory user review, provenance meta on every lot) — but
   the numbers still originate from a model. See §5.1.
3. Contrast (done right): `lib/valuation/ai.ts` — AI proposes assumptions only, out-of-bounds
   proposals are **discarded, not clamped** (:34-51), fair value is always recomputed by
   `dcf.ts`. `lib/ic/valuation-inputs.ts` follows the same pattern.

**Type B — arithmetic inlined in prompt-builder files (should live in the deterministic layer):**

4. `lib/ai-financial-insight.ts:40-53` — YoY revenue change and operating-margin delta (pp)
   computed inline in the prompt builder.
5. `lib/ai-research.ts:285-288` — promoter-holding change computed by `parseFloat` on raw
   scraped strings, inline in prompt assembly.
6. `lib/assistant-portfolio.ts:54,73` — position weight % (`valueBase / total * 100`) and
   concentration figures computed inline for the assistant's portfolio block.
7. `lib/ai-compare.ts:374-419` — decimal→percent unit conversions (×100) inlined in the metric
   table getters.
8. Low-severity formatting drift: inline `toFixed()` in `lib/ai-watchlist.ts` (:166, :347, :372,
   :397), `lib/ai-calendar-brief.ts:33`, `lib/ai-derivatives-research.ts:28-36`,
   `lib/ai-crypto-research.ts:25,29` — violates the "format only through `lib/format.ts`" rule
   but the numbers only flow into prompts, not out.

Verified clean: `lib/analysis-prompt.ts`, `lib/ai-portfolio-manager.ts`, `lib/ic-agents.ts`
(formats via `lib/ic/format.ts`), `lib/opportunity-engine.ts`, `lib/thematic-engine.ts` (scores
come from the deterministic layer). Items 1, 4 were re-verified by direct read; items 5-8 are
from a code-reading pass and spot-checks — line numbers may drift a few lines.

---

## 4. Holdings dependency graph — what breaks if `portfolio_lot` changes

**Correction to folklore:** `calendar.ts`, `monitor.ts`, `timeline.ts` and the portfolio export
do *not* read the legacy `portfolio` table. They call `listPortfolio()` (`lib/db.ts:2063`),
which aggregates `portfolio_lot` via `aggregateOpenPositions()`. The legacy table's only reader
is the one-time seed migration (`lib/db.ts:758-770`).

```
Layer 0  portfolio_lot (lib/db.ts:172 + migrated cols :727-744)
         │
Layer 1  lib/db.ts CRUD — the ONLY sanctioned SQL:
         │  listLots (:2047)              addLot (:2074)         removeLot (:2100)
         │  listPortfolio (:2063)         upsertPosition (:2111) removePosition (:2130)
         │  listUniversalLots / addUniversalLot / upsertUniversalPosition (:2160-2257)
         │  executeTradeBatch / applyPortfolioImport (:2280-2423)
         │  snapshotPortfolio / restoreSnapshot (:2471-2586)
         │  reconcileOwnedStages / reconcileStageForLedgerWrite (:1336-1369)
         │
         │  RAW SQL BYPASSES (break on any column rename):
         │    scripts/demo-seed.ts:179          (SELECT * FROM portfolio_lot)
         │    scripts/backfill-display-names.ts:37
         │    scripts/landing-panel-data.ts:361
         │    app/api/portfolio/buy/route.ts:51 (reference in comment/SQL — uncertain if live SQL)
         │
Layer 2  Domain engines:
         │  lib/portfolio-lots.ts   aggregateLots/aggregateOpenPositions (PositionAggregate shape)
         │  lib/portfolio/store.ts  listRawHoldings — "THE portfolio" (14 importers)
         │  lib/portfolio/engines/transaction.ts  executeTrades/buildLotWrites/undoTransaction
         │  lib/portfolio-performance.ts  positionPerformance/portfolioPerformance (XIRR)
         │  lib/portfolio/report.ts  buildEvaluation/getPortfolioReport (composition root)
         │
Layer 3  Features that break transitively:
         │  via getPortfolioReport:  lib/exposure/ (exposure model), lib/ios/server.ts (+ fit
         │    scorer via lib/ios/profile.ts), lib/home/digest.ts (home dashboard),
         │    lib/assistant-portfolio.ts (AI assistant context), app/api/portfolio/* (page)
         │  via listPortfolio:       lib/calendar.ts, lib/monitor.ts (alerts), lib/timeline.ts,
         │    app/api/export/portfolio (CSV/Excel)
         │  via transaction engine:  buy / allocate-cash / optimize-execute / simulator-promote
         │    routes; snapshot-undo routes
         │  via applyPortfolioImport: screenshot import apply route
         │  via listRawHoldings:     watchlist route + export, notifications routing,
         │    policy interpret, scenario route
```

**Not affected:** the Python engine. `engine/data/loader.py:17` opens `app.db` only to migrate
`fundamentals_cache`; nothing under `engine/` reads holdings.

**Silent vs loud breakage:** the TS interfaces (`PortfolioLot`, `PositionAggregate`,
`UniversalLotRow`, `RawHolding`, `UniversalPortfolioReport`) break loudly at compile time. The
DB boundary itself breaks **silently**: every read is `as unknown as Row[]`
(`lib/db.ts:2053, :2163, :2479`), so a column rename yields `undefined` → `NaN` arithmetic in
`aggregateLots`, not an error. The three scripts with raw `SELECT *` break silently too.
Snapshot restore (`restoreSnapshot`, :2557-2586) re-inserts rows captured under the *old*
schema — a schema change invalidates every stored undo snapshot's JSON, with no version check
(**uncertain** whether any guard exists; none was found).

---

## 5. The five weakest points, ranked by silent-wrong-number damage to an advisor

**1. Screenshot import writes model-transcribed numbers into the source-of-truth ledger — and
"assumed" cost bases become real P&L.**
`lib/portfolio/import/` is the best-defended LLM path in the codebase, but it is still the only
place where a vision model's reading of a JPEG becomes a permanent `portfolio_lot` row. The
tolerances that make it usable also define its blind spot: a misread that stays internally
consistent (qty and avgCost both wrong in the same ratio) passes the `qty×price≈value` checks
(`validate.ts:32-38`, live-price gap tolerated up to **40%**). Worse, `costBasisAssumed` and
`synthetic` lots (apply route :54, :116-119 — price *solved* to land on the screenshot) are
flagged in `meta`, but `aggregateLots` (`lib/portfolio-lots.ts:73`) ignores `meta` entirely:
assumed bases flow into avg cost, realized P&L, XIRR and the tax-adjacent "realized" figures
with no downstream asterisk. An advisor reading position P&L cannot tell measured from assumed.
**Uncertain** whether any UI surface re-reads the provenance meta to caveat these numbers; no
consumer of `meta.costBasisAssumed` outside the import flow was found.

**2. `fundamentals_cache` and `platform_cache` are unvalidated JSON trust boundaries feeding
the entire scoring layer.**
`getFreshFundamentals` does `JSON.parse(r.data) as StockFundamentals` (`lib/db.ts:1926`) — no
shape validation, no schema version (unlike `ai_result`, which keys on `schema_version`). If
`StockFundamentals` gains/renames a field, every cached row silently serves `undefined` into
`computeScores()` for up to 12h, and `lib/score-math.ts` normalization quietly re-weights around
missing inputs. The same pattern covers every persisted platform dataset (`platform_cache.value`
has a `version` column — **uncertain** whether any reader actually checks it against a current
schema). This is the widest single funnel in the app: Screener ranks, watchlist metrics, compare
tables and AI grounding context all drink from it.

**3. Yahoo ingestion runs with `validateResult: false`, and failures are non-fatal by design.**
Every yahoo-finance2 call disables the library's own schema validation (`lib/yahoo.ts:184, :287,
:307`) — a deliberate trade (Yahoo drifts constantly) that means an upstream unit change
(percent vs fraction, pence vs pounds, splits in `fundamentalsTimeSeries`) arrives as a *number*
and propagates. The mappers normalize field names, not semantics, and the tests
(`tests/yahoo.test.ts`) assert mapping of fixtures, not plausibility of live values. Combined
with the app-wide "partial data + render anyway" contract, a wrong-but-plausible number from
Yahoo has no tripwire anywhere between the wire and a DCF input prefill. There is no
sanity-check layer (e.g. price vs yesterday's cache, margin ∈ [-1, 1]) at ingestion.
`lib/prices.ts:36` `detectUnexplainedGaps` exists but is a chart-level helper, not a gate.

**4. Currency and trade-date semantics in the lot ledger are convention, not enforcement.**
`aggregateLots` sums `price`, `fees`, and realized P&L as bare numbers; per-lot `currency`
exists on the row but nothing prevents a symbol's ledger from mixing currencies (import path
defaults unparseable currency to `"USD"`, apply route :48), in which case avg cost and realized
P&L are silently meaningless. The module's own doc (`lib/portfolio-lots.ts:33-44`) concedes a
cumulative realized-P&L scalar cannot be FX-converted correctly. Separately, the ledger already
shipped one silent-wrong-number bug from date semantics: UTC-vs-local `trade_date` re-ordered a
same-day sell before its buy, selling 0 shares while still crediting proceeds — documented at
`lib/db.ts:25-39`. The fix is a convention ("every ledger write must use the same calendar")
enforced only by comment; any new write path that stamps `toISOString().slice(0,10)` reintroduces
it.

**5. A third, untested scoring engine and untested asset-class scorers sit beside the two
sanctioned ones.**
The project's own rules say exactly two scoring engines exist (`composite.ts`, `scoring.ts`) and
bands live only in `recommendation.ts`. In practice `lib/india-snapshot.ts:331-397` implements
its own `scoreQuality`/`scoreValuation`/`scoreGrowth`/`overallVerdict` over scraped screener.in
strings — parsed from HTML by regex (`lib/screener-in.ts`) — with **no test file found**. The
same coverage hole applies to `fund-scoring.ts`, `crypto-scoring.ts`, `forex-scoring.ts`,
`commodity-scoring.ts` and `black-scholes.ts` (no dedicated tests found), and to the entire
Python engine (zero tests, feeds the `/engine` scorecard). For India names specifically, an
advisor is reading verdicts computed by an unaudited engine from a scrape that breaks the day
screener.in changes its markup — and the failure mode is a wrong ratio, not a blank page.

**Honorable mentions (real, but less damaging):** the LLM-emitted `confidenceScore` in
`lib/ai-compare.ts:580` (a made-up number displayed as if measured); no schema-version table for
`app.db` (failed migrations are invisible); `portfolio_snapshot` undo blobs with no schema
version (restore after a schema change is undefined behavior); prompt-builder arithmetic drift
(§3.2 Type B) which today only mis-informs prompts but is one copy-paste away from mis-informing
the UI.
