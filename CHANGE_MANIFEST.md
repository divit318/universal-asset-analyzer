# CHANGE_MANIFEST.md — Universal Asset Analyzer

**Scope:** every meaningful change introduced in this version — the two-branch divergence from merge-base `98500e1` ("Merge origin/main: streaming AI verdicts, score reconciliation, data grid"): `divit-local` (16 commits) and `origin/prisha-work` (10 commits). This is the same change set audited in `MERGE_SUMMARY.md`. The combined result was hand-merged into `main` at `6585052`.
**Generated:** 2026-08-06. Read-only audit; no source code modified.

**Field definitions**
- **Risk level** — regression/merge risk of the change itself (not importance).
- **Coexists?** — whether this change can live alongside a competing implementation of the same concern.
- **Replaces?** — whether it retires an older implementation.
- **Improves** — which of UX / Performance / AI / Reliability / Maintainability / Accuracy the change advances.
- **Rank** — overall importance to the product: Critical / High / Medium / Low.

**Index by rank**

| Rank | Changes |
|---|---|
| Critical | 1 Watchlist rebuild · 2 Simulator · 4 Canonical performance engine · 12 AI timeout fix · 17 Hosted-first AI provider chain · 20 Screener legibility · 24 Engine performance overhaul · 25 Engine data-corruption fixes |
| High | 3 Multi-portfolio · 6 Classification authority · 7 Cash preview/executor parity · 8 Phantom-position fix · 9 Target-direction fix · 11 AI failure legibility · 18 Provider-agnostic AI recovery · 23 Brand identity system · 27 Dataset stale-while-revalidate |
| Medium | 5 Health triage & dashboard ordering · 10 Pipeline provenance/relevance · 13 Table primitive widening · 14 New-positions route removal · 19 AI migration records & verdict schema · 21 Universe metric expansion · 26 DuckDB compaction |
| Low | 15 Portfolio state propagation · 16 Inherited main features · 22 Saved-screen run snapshots · 28 Redesign & eye-ease records · 29 Performance baseline harness |

---

## Part A — Changes from `divit-local`

### 1. Watchlist rebuilt around "the level you are waiting for"

- **Description:** Complete rewrite of the Watchlist: named lists as views over tracked symbols (join-table architecture), target prices with explicit direction (above = valuation/exit, below = buy limit), append-only target revision history, live price polling with intelligent backoff (hidden tabs, closed markets, errors), analyst-consensus column, 52-week range bar with target plotted, pipeline stage badges, row-detail expansion, persisted view state, opt-in AI digest.
- **Reason:** The old watchlist was a flat symbol list that couldn't answer the question the surface exists for — "am I near the level I'm waiting for?" — and its alert semantics contradicted its display semantics (see change 9).
- **Files changed:** `app/watchlist/page.tsx` (rewritten, ~1,900 lines), 10 new files under `app/watchlist/_components/` (`target-modal`, `target-history`, `list-switcher`, `range-bar`, `row-detail`, `stage-badge`, `digest-panel`, `notes-modal`, `use-live-quotes`, `use-view-state`), `app/api/watchlist/{groups,membership,target-history}/route.ts` (new), `app/api/watchlist/route.ts`, `lib/live-quotes.ts` (new), `lib/watchlist-metrics.ts` (new), `lib/db.ts` (tables `watchlist_group`, `watchlist_member`, `watchlist_target_history`; columns `watchlist.stage/stage_changed_at/target_direction/source/source_detail`), tests (`watchlist-groups-db`, `watchlist-metrics`, `live-quotes`).
- **Dependencies:** SQLite via `lib/db.ts`; yahoo-finance2 (quotes, consensus); `lib/idea-stage.ts`; `app/_components/ui/data-table.tsx` (change 13); IOS fit (`/api/watchlist/fit`).
- **Risk level:** Medium — schema migration is additive and self-seeding (default "All Symbols" group), but the page rewrite touches alerting, export, and command-palette integration.
- **Coexists?** No — it is the only watchlist surface; a competing watchlist implementation would collide on the same tables and routes.
- **Replaces?** Yes — replaces the previous flat watchlist page and its single implicit target semantics.
- **Improves:** UX ✔ · Performance ✔ (polling backoff) · AI ✔ (digest) · Reliability ✔ · Maintainability ✔ (one metrics module) · Accuracy ✔ (direction-aware upside)
- **Rank:** **Critical**

### 2. Portfolio Simulator — describe a mandate, generate a book, promote it

- **Description:** New end-to-end surface: intake by form or AI interview (capped at 8 questions), profile summary, staged NDJSON generation (allocate → select → size → evaluate → narrate), simulation view with compare-against-real-book, edit mode with cash-sleeve value conservation, and promotion to a real portfolio via `executeTradeBatch`.
- **Reason:** Lets a user test a portfolio strategy without risking capital, and gives the product a path from "idea about a mandate" to "funded book" that previously required manual entry.
- **Files changed:** 11 new components in `app/portfolio/_components/simulator/`, 8 new routes under `app/api/portfolio/simulator/` (crud, intake, generate, evaluate, edit, swap, refresh-narrative, promote), new `lib/portfolio/simulator/` package (`generate.ts` 515 lines, `preferences.ts` 576, `profile.ts`, `intake.ts`, `edit.ts`, `evaluate.ts`, `universe.ts`, `types.ts`), `lib/db.ts` (`simulation` table), tests (`simulator-{db,edit,generate,intake,preferences}`).
- **Dependencies:** AI via `lib/ai` `runPrompt` (interview, narration, evaluation); `lib/portfolio/engines/*` (sizing, evaluation); `lib/portfolio/store.ts` (promotion); multi-portfolio (change 3); `TaskProgress` staged UI (change 13).
- **Risk level:** Low–Medium — almost entirely additive; the only shared surface it mutates is the real portfolio at promotion time, which goes through the existing trade batch executor.
- **Coexists?** Yes — self-contained tab; another portfolio-construction tool could coexist.
- **Replaces?** No — net-new capability.
- **Improves:** UX ✔ · AI ✔ · Maintainability ✔ (pure simulator package) · Accuracy ✔ (evaluation reuses real engines)
- **Rank:** **Critical**

### 3. Multi-portfolio support

- **Description:** Named portfolios (`portfolios` table) with a switcher on the Portfolio page; `portfolio_id` added to lots, snapshots, and manual assets; non-default portfolios render read-only holdings.
- **Reason:** Required by the Simulator's "promote" flow (a promoted book must not overwrite the main book) and by users tracking more than one mandate.
- **Files changed:** `lib/db.ts` (`portfolios` table; `portfolio_id` columns on `portfolio_lot`, `portfolio_snapshot`, `manual_asset`, defaulting to 1), `app/api/portfolio/portfolios/route.ts` (new), `app/portfolio/page.tsx` (switcher), `app/portfolio/_components/universal/read-only-holdings.tsx` (new), `tests/multi-portfolio-db.test.ts`.
- **Reason for default:** `portfolio_id = 1` keeps every pre-existing row attached to "Main Portfolio" — zero-touch backward compatibility.
- **Dependencies:** SQLite; consumed by Simulator promote, Home modules, IOS context.
- **Risk level:** Medium — every query touching lots/snapshots must now be portfolio-scoped; a missed scope silently mixes books.
- **Coexists?** No — it redefines the portfolio data model; a single-portfolio implementation cannot run beside it.
- **Replaces?** Yes — replaces the implicit single-portfolio model.
- **Improves:** UX ✔ · Reliability ✔ · Accuracy ✔ (books can't cross-contaminate)
- **Rank:** **High**

### 4. Canonical performance engine — one total return, dated series, historical FX

- **Description:** Consolidates three divergent total-return implementations into one function with an explicit balance-sheet denominator and a cost-weighted period; return series align by date (not array index); missing prices are never coerced to zero; realized P&L converts at the historical FX rate of each sale (`PositionAggregate.realizedEvents`); closed positions still get a row. `lib/portfolio-analytics.ts` shrinks 1,655 → 44 lines, its logic redistributed into dedicated engines.
- **Reason:** Three surfaces disagreed about the same number. `min(acquiredAt)` reported "+0.2% over 6.7y" for a book funded 17 days earlier because one 2019 collectible set the window; a CHF 20,000 realized gain displayed as $20,000.
- **Files changed:** `lib/portfolio-performance.ts` (+513, canonical), `lib/portfolio/engines/attribution.ts` (new, 243), `lib/portfolio/engines/confidence.ts` (new, 203), `lib/portfolio/engines/series.ts` (new, 154), `lib/portfolio-analytics.ts` (−1,655), `app/api/portfolio/performance/route.ts`, tests (`portfolio-performance` 782 lines, `portfolio-attribution`, `portfolio-confidence`, `portfolio-series-alignment`).
- **Dependencies:** yahoo-finance2 history; `portfolio_lot.currency` column (added here); consumed by Portfolio page, Home "Book" module, Journal.
- **Risk level:** Medium — every displayed return figure changes provenance; the risk is downstream consumers still holding the old numbers' assumptions.
- **Coexists?** No — the entire point is that there is exactly one implementation; a second would reintroduce the bug class.
- **Replaces?** Yes — retires three ad-hoc total-return computations and most of the old `portfolio-analytics.ts`.
- **Improves:** Accuracy ✔✔ · Reliability ✔ · Maintainability ✔ · UX ✔ (as-of stamps, honest periods)
- **Rank:** **Critical**

### 5. Health scorecard triaged by severity; dashboard ordered by question

- **Description:** The 12-dimension health panel now triages into needs-attention / adequate / strong (weakest first, strong collapsed to one line); the Portfolio dashboard reorders sections by the question they answer ("how is it doing?" → "what is it made of?" → "what moves it next?") instead of by data model; AI output is labeled as interpretation; percentages show denominators. New performance/attribution/trajectory panels give the reordered dashboard its content.
- **Reason:** The previous layout ordered panels by implementation history; the user's first glance landed on whatever was built first, not what needed attention.
- **Files changed:** `app/portfolio/_components/universal/health-panel.tsx`, `decision-center.tsx`, `holdings-panel.tsx` (574 lines changed), `impact-display.tsx`, `portfolio-thesis.tsx`, new `attribution-panel.tsx`, `performance-panel.tsx`, `trajectory-panel.tsx`, `trajectory-chart.tsx`, `as-of-stamp.tsx`, `app/portfolio/page.tsx` (326 lines changed), `tests/trajectory-chart-scale.test.ts`.
- **Dependencies:** Changes 4 (performance/attribution data) and 6 (classification); `lib/portfolio/engines/health.ts`.
- **Risk level:** Low — presentation-layer reordering over unchanged engine outputs.
- **Coexists?** Yes — layout decisions; an alternative ordering could ship behind config.
- **Replaces?** Yes — replaces the previous dashboard ordering and flat health list.
- **Improves:** UX ✔✔ · Accuracy ✔ (denominators shown, AI labeled)
- **Rank:** **Medium**

### 6. Classification authority — resolve an instrument's class once, on what it holds

- **Description:** Asset-class classification is resolved once at the data boundary and read by every engine, keyed off what the instrument *holds* rather than its wrapper (a bond ETF is bonds). Yahoo's `bondHoldings.duration/.maturity` is no longer misused as effective duration. Adds a shared `market-base.ts` class and a 1,465-line `risk-models.ts` reference.
- **Reason:** Each engine previously re-derived classification with slightly different rules, so the same holding could be equity in one panel and a fund in another — and risk math inherited whichever answer it got.
- **Files changed:** `lib/portfolio/classes/market-base.ts` (new), `lib/portfolio/classes/reference/risk-models.ts` (new), all 13 `lib/portfolio/classes/*.ts` adapters, `app/portfolio/_components/universal/risk-lab.tsx` (269 lines changed), `app/api/portfolio/buy/route.ts`, `buy/recommendation/route.ts`, `manage/route.ts`, tests (`portfolio-classification-authority` 328 lines, `portfolio-risk-models` 616, `portfolio-risk-coverage`).
- **Dependencies:** consumed by risk, allocation, optimize, health engines and buy routes.
- **Risk level:** Medium — a classification change reclassifies existing holdings' risk treatment; correct, but visibly different numbers.
- **Coexists?** No — an "authority" is definitionally singular.
- **Replaces?** Yes — retires per-engine classification heuristics.
- **Improves:** Accuracy ✔✔ · Reliability ✔ · Maintainability ✔ · Performance ✔ (resolved once)
- **Rank:** **High**

### 7. Cash preview/executor parity

- **Description:** The cash-deployment preview and the executor now share one computation path; dollar amounts remain display figures and never become execution quantities; the cap that silently absorbed overflow now surfaces it; a deploy guard blocks incoherent deployments; the optimize panel gains a funding summary.
- **Reason:** The preview computed its numbers differently from the executor, so the trade a user approved was not the trade that ran.
- **Files changed:** `lib/portfolio/engines/cash.ts` (+183), `lib/portfolio/engines/optimize.ts` (+204 predicate unification), `lib/portfolio/engines/transaction.ts` (+142), `app/portfolio/_components/universal/cash/*` (incl. new `deploy-guard.ts`), `app/portfolio/_components/universal/optimize/funding-summary.tsx` (new), tests (`portfolio-cash`, `portfolio-cash-deploy-guard`, `portfolio-optimize-funding` 380 lines).
- **Dependencies:** transaction engine (change 8 shares it); optimize engine.
- **Risk level:** Medium — execution-path change; mitigated by the shared-path design and heavy tests.
- **Coexists?** No — parity is the invariant; two paths is the bug.
- **Replaces?** Yes — replaces the divergent preview computation.
- **Improves:** Accuracy ✔✔ · Reliability ✔✔ · UX ✔ (what you preview is what runs)
- **Rank:** **High**

### 8. Phantom positions after rebalance — fixed

- **Description:** Full exits were expressed as dollar amounts rounded to the nearest dollar, then converted back to units at execution; the rounding error survived as a real holding (e.g. GLD 0.0005 shares worth $0.18). Now `dollarDelta` is never rounded (it is an execution instruction, not a display figure) and the executor snaps a sell to the whole position when the leftover is < $1 AND < 1% of the position. Also fixes a React key warning by keying trade rows on the fragment map.
- **Reason:** Every rebalance left dust positions that polluted allocation, health, and attribution forever after.
- **Files changed:** `lib/portfolio/engines/optimize.ts`, `lib/portfolio/engines/transaction.ts` (+32 snap logic), `app/portfolio/_components/universal/optimize-panel.tsx`, `tests/portfolio-transaction.test.ts` (+61).
- **Dependencies:** transaction engine (shared with change 7).
- **Risk level:** Low — narrow, well-tested behavioral fix.
- **Coexists?** No — it corrects the single execution path.
- **Replaces?** Yes — replaces round-then-convert exit math.
- **Improves:** Accuracy ✔✔ · Reliability ✔ · UX ✔
- **Rank:** **High**

### 9. Watchlist target-direction contradiction — fixed

- **Description:** `lib/alerts.ts` fired "target reached" on `price <= target` (buy-limit semantics) while the watchlist page and CSV export fired on `price >= target` (valuation-target semantics) — so for any target, exactly one surface fired permanently (INCY "buy at $20" trading at $118 exported as TARGET REACHED). Fix: a stored `target_direction` ("above" | "below") and one shared rule in `lib/watchlist-metrics.ts`; alerts gain price-crossing detection persisted in `price_alert_state`.
- **Reason:** Two surfaces disagreed on what a target means; both were plausibly right, so the fix stores the user's intent instead of guessing.
- **Files changed:** `lib/alerts.ts` (+132), `lib/watchlist-metrics.ts` (new, 213), `lib/price-crossing.ts` (new, 163), `lib/db.ts` (`watchlist.target_direction`, `price_alert_state` table), `app/watchlist/page.tsx`, `app/api/export/watchlist/route.ts` (137 lines changed), `app/api/watchlist/symbol-alerts/route.ts`, tests (`alerts` +252, `price-crossing`, `export`).
- **Dependencies:** part of the Watchlist rebuild (change 1); monitor scheduler consumes alerts.
- **Risk level:** Low — pre-existing rows keep NULL direction and are resolved at read time (honest, non-destructive migration).
- **Coexists?** No — one rule module is the fix.
- **Replaces?** Yes — retires both contradictory implicit rules.
- **Improves:** Accuracy ✔✔ · Reliability ✔✔ · UX ✔
- **Rank:** **High**

### 10. Pipeline board: idea provenance and relevance score

- **Description:** Every idea on the pipeline board carries provenance (where it came from — scanner, screener, manual, etc., stored as `watchlist.source`/`source_detail`) and a relevance score against the current book (`engines/idea-relevance.ts`, 666 lines); the board ranks by worth-acting-on instead of recency. Stage transitions move to the shared `lib/idea-stage.ts` (+190) now that Watchlist reads them too.
- **Reason:** A recency-ordered idea list buries the idea that actually fits the book; unattributed ideas can't be trusted or triaged.
- **Files changed:** `app/portfolio/_components/pipeline-board.tsx`, `app/portfolio/_components/pipeline/idea-card.tsx` (new, 320), `lib/portfolio/engines/idea-relevance.ts` (new), `lib/idea-source.ts` (new, 162), `lib/idea-stage.ts`, `app/api/pipeline/route.ts` (90 lines changed), `app/api/pipeline/fit/route.ts` (new), tests (`idea-relevance` 465, `pipeline-board` 201, `portfolio-stage-db`).
- **Dependencies:** IOS fit; watchlist source columns; consumed by Home Radar.
- **Risk level:** Low — additive scoring over existing pipeline data; NULL source on old rows reads as "origin not recorded".
- **Coexists?** Yes — the relevance ranking could coexist with an alternative ranking behind a toggle.
- **Replaces?** Partially — replaces recency ordering as the default.
- **Improves:** UX ✔ · Accuracy ✔ · AI ✔ (better-grounded idea context)
- **Rank:** **Medium**

### 11. AI failures made legible; compare verdict streams

- **Description:** New typed AI error taxonomy (`TaskStageError`, `TimeoutError`, `ModelNotFoundError` in `lib/ai/errors.ts`), structured logging (`lib/ai/log.ts`), expanded health tracking (`lib/ai/health.ts` +101, `AI_HEALTH_PATH` env). The Compare verdict streams instead of blocking; the router no longer discards a whole verdict on the blocking path; one rate-limited symbol no longer sinks a comparison (`droppedSymbols` travels through `ComparisonSetup`).
- **Reason:** AI failures previously surfaced as generic spinners-then-nothing; users couldn't distinguish "model missing" from "timed out" from "one symbol was rate-limited", and one bad symbol destroyed the entire compare output.
- **Files changed:** `lib/ai/errors.ts`, `lib/ai/log.ts` (new), `lib/ai/health.ts`, `lib/ai/router.ts`, `lib/ai-compare.ts` (+197), `app/api/compare/stream/route.ts` (new), `app/compare/page.tsx` (310 lines changed), compare radar/class views, `app/_components/ai-assistant.tsx`, tests (`ai-errors`, `ai-health`, `ai-compare` +55).
- **Dependencies:** router (change 12 shares it); collides with prisha's availability work (change 18) in `lib/ai-compare.ts` — the merge composed them: specific errors kept, advice routed through `AI_RECOVERY_HINT`.
- **Risk level:** Medium — router changes; conflicted with change 17 in the actual merge.
- **Coexists?** Yes — composed with change 18 in the resolution (typed errors + centralized recovery copy).
- **Replaces?** Yes — replaces generic string errors and the blocking compare path.
- **Improves:** UX ✔ · AI ✔ · Reliability ✔✔ · Maintainability ✔
- **Rank:** **High**

### 12. AI timeout as a bound, not a model failure (6m40s → 22s)

- **Description:** `withRetry` now recognizes `TimeoutError` (previously only `AbortError`, so a 45s timeout × 3 attempts × 3 fallback models = 405s of futile retries); `streamChat` accepts `timeoutMs`; the router treats a timeout as a fact about the host, not the model, and stops walking fallbacks; `keep_alive` holds the model resident (30m interactive / 10m background); fallback messages name the actual cause. App-assistant budget raised 45s → 150s. Measured: worst case 6m40s → 22s cold / 16.3s warm.
- **Reason:** Users saw multi-minute hangs that were pure retry arithmetic, and the blame landed on the provider ("Ollama is slow") rather than the router's semantics.
- **Files changed:** `lib/ai/router.ts` (+185 total with change 11), `lib/ai/ollama.ts` (+135), `lib/ai/provider.ts` (timeoutMs field), `lib/ai/providers/ollama-provider.ts`, `lib/ai/task-registry.ts`, `lib/ai-app-assistant.ts`, `tests/ai-timeout.test.ts` (new, 139), `tests/ai-router.test.ts` (+166).
- **Dependencies:** provider interface; conflicts head-on with change 17 (the merge conditioned all of this on `isHostedProvider() === false`, since hosted providers have no load phase).
- **Risk level:** High — the exact seam where the merge's one silently-wrong auto-merge occurred (`routeStream` applying local gating to hosted providers).
- **Coexists?** Yes, but only with explicit locality discrimination — proven by the merge resolution's `PROVIDER_LOCALITY` total Record.
- **Replaces?** Yes — replaces timeout-as-retryable-model-failure semantics.
- **Improves:** Performance ✔✔ · UX ✔✔ · AI ✔ · Reliability ✔ · Accuracy ✔ (honest failure attribution)
- **Rank:** **Critical**

### 13. Table primitive widened; density owned per surface

- **Description:** `DataTable` gains persisted view state (`defaultSortKey`), row windowing with size announcement (`lib/table-window.ts`), a density toggle that states which density is selected (active segment brand-tinted — previously an invisible 3% luminance step), extraction of `DensityToggle` as an exported component, and a `showDensityToggle` prop so a surface owns exactly one toggle. New `date-input.tsx`; `task-progress.tsx` enhanced for staged pipelines.
- **Reason:** The new surfaces (Watchlist, Simulator, register views) all sit on this primitive; without windowing and persistence the rebuilt Watchlist would regress on large lists, and the old density control gave no feedback about its own state.
- **Files changed:** `app/_components/ui/data-table.tsx` (528 lines changed), `app/_components/ui/date-input.tsx` (new), `app/_components/ui/task-progress.tsx` (108 changed), `app/_components/ui/index.ts`, `lib/table-window.ts` (new, 159), `lib/format.ts` (+76 NaN guards), `tests/table-window.test.ts` (206).
- **Dependencies:** consumed by Watchlist, Screener, Portfolio, register pages.
- **Risk level:** Low–Medium — shared primitive; a regression here is visible everywhere, but changes are additive props.
- **Coexists?** No — it is the single table primitive by design.
- **Replaces?** Yes — replaces the narrower DataTable and the per-grid always-on density toggle.
- **Improves:** UX ✔✔ · Performance ✔ (windowing) · Maintainability ✔ · Accuracy ✔ (NaN guards)
- **Rank:** **Medium**

### 14. Removal of `/api/portfolio/new-positions` route

- **Description:** Deleted the 267-line new-positions route (and its last test) as superseded by the recommendation route during the multi-portfolio refactor.
- **Reason:** Route considered dead after the recommendation flow absorbed its job.
- **Files changed:** `app/api/portfolio/new-positions/route.ts` (deleted), `tests/new-positions.test.ts` (deleted).
- **Dependencies:** **`lib/ai-watchlist.ts` still documented it as a live caller** — which is why the merge into `main` restored the route and moved its objective/constraint/recommendation vocabulary into `lib/ios/types.ts`.
- **Risk level:** High — this became the modify/delete conflict of the merge; the deletion was judged premature and reverted.
- **Coexists?** N/A — a deletion cannot coexist with the modification the other branch made to the same file.
- **Replaces?** Intended to (recommendation route as successor); resolution says not yet.
- **Improves:** Maintainability ✔ (intent) — but at a Reliability ✘ cost as shipped, corrected in the merge.
- **Rank:** **Medium** (as a lesson: verify the call graph before deleting; doc comments are intent, not fact)

### 15. Portfolio state propagated into Home, palette, Research, Screener

- **Description:** The new portfolio model (multi-portfolio, stages, fit) is carried into the Home modules, command palette (watchlist-group awareness), Research page fields, Screener held-badges, add-to-portfolio modal fit summary, and data-provenance component. IOS profile simplified; `lib/ios/server.ts`/`types.ts` extended.
- **Reason:** Without propagation, the new model exists but the rest of the app still renders the old world — the audit's core "shipped-but-unwired" failure mode.
- **Files changed:** `app/_components/command-palette.tsx`, `app/_components/data-provenance.tsx`, `app/_components/portfolio/add-to-portfolio-modal.tsx`, `app/research/page.tsx`, `app/screener/page.tsx`, `lib/ios/{profile,server,types}.ts`, `lib/home/{contracts,digest}.ts`, `lib/mission-control.ts` (+72), `tests/mission-control.test.ts`.
- **Dependencies:** changes 1, 3, 10.
- **Risk level:** Low — thin plumbing over already-tested engines.
- **Coexists?** Yes.
- **Replaces?** No — extends existing surfaces.
- **Improves:** UX ✔ · Reliability ✔ (one state everywhere)
- **Rank:** **Low**

### 16. Inherited from origin/main via merge `74ad42c` (Valuation module, Engine quant desk, icon system)

- **Description:** `divit-local` merged origin/main mid-stream, pulling in the Valuation case/register module, the Engine quant-desk page, and the icon system. Authored on main, not on this branch — listed because they are part of the divergence versus the merge-base.
- **Reason:** Keep the branch current; the Simulator and register views depend on primitives from main.
- **Files changed:** merge commit `74ad42c` (large; see main's history).
- **Dependencies:** upstream main.
- **Risk level:** Low (already stabilized on main).
- **Coexists?** / **Replaces?** N/A — inherited.
- **Improves:** (inherited features' own merits)
- **Rank:** **Low** (informational)

---

## Part B — Changes from `origin/prisha-work`

### 17. Hosted-first AI provider chain (Devin CLI provider)

- **Description:** New Devin CLI subprocess provider (`lib/ai/devin-cli.ts`, 466 lines: isolated scratch workspace so repo AGENTS.md/CLAUDE.md rules don't leak into prompts, tools denied for pure inference, `--prompt-file` because stdin panics and argv can't hold dossier prompts, concurrency cap), `providers/devin-provider.ts`, provider registry (`ProviderId`, per-model provider, `endpointForProvider()`, `LOCAL_PROVIDERS`), lazy `attemptOrder()` generator in the router so enumerating a provider costs nothing until reached, and a default chain of devin → ollama reorderable via `AI_PROVIDER_ORDER`. Measured: 3.9–8.3s hosted vs 28–115s local; nine concurrent IC-agent prompts in 5.3s.
- **Reason:** Local Ollama inference on a 16 GB host was the product's biggest latency and reliability bottleneck; hosted inference removes the load-phase and serialization constraints entirely.
- **Files changed:** `lib/ai/devin-cli.ts`, `lib/ai/providers/devin-provider.ts` (new), `lib/ai/config.ts` (+32), `lib/ai/models.ts` (+172), `lib/ai/router.ts` (+140), `lib/ai/platform-health.ts` (new), tests (`ai-devin-cli` 90, `ai-provider-chain` 201, `ai-models` +25).
- **Dependencies:** Devin CLI binary; env vars `DEVIN_CLI_*`, `AI_PROVIDER_ORDER`; collides directly with changes 11–12 in `lib/ai/router.ts`/`models.ts`.
- **Risk level:** **Critical** — (a) the router conflict produced the merge's one silently-wrong auto-merge; (b) the `devin,ollama` default smuggled a product decision gated on unresolved calibration/cost blockers and had to be reverted post-merge (`1e1a34b`).
- **Coexists?** Yes — explicitly designed to chain with the local provider; the merge made locality (`isHostedProvider()`) the discriminator.
- **Replaces?** No at merge time (chained, not replaced). **Superseded later:** the post-merge Anthropic consolidation (`0ce3c0c`) retired both the Devin CLI and Ollama tiers — on today's HEAD this machinery no longer exists.
- **Improves:** Performance ✔✔ · AI ✔✔ · UX ✔ · Reliability ✔ (fallback chain)
- **Rank:** **Critical** (for this version; historically superseded)

### 18. Provider-agnostic AI availability and recovery copy

- **Description:** New `lib/ai/availability.ts` with `AI_RECOVERY_HINT` and `aiUnavailableMessage()`, replacing ~15 call sites that hardcoded "run `ollama serve`" advice; `ollama-status.tsx` reworked into an honest provider-agnostic status badge.
- **Reason:** Every hardcoded recovery string became a lie the moment a second provider existed; centralizing the advice is the only way failure copy can track the provider chain.
- **Files changed:** `lib/ai/availability.ts` (new), `app/_components/ollama-status.tsx` (+34), and edits across `lib/ai-app-assistant.ts`, `lib/ai-compare.ts`, `lib/ai-financial-insight.ts`, `lib/ai-watchlist.ts`, `lib/compare/class-ai-compare.ts`, `lib/event-screener.ts`, `lib/portfolio/holding-explain.ts`, `lib/portfolio/thesis.ts`, `app/landing/_components/sections/hero.tsx`, `app/research/_components/copilot/use-copilot.ts`.
- **Dependencies:** touches the same files as change 11 — the merge kept divit's per-error-type messages and routed the *advice* through the hint.
- **Risk level:** Medium — wide but shallow; the risk is a missed call site keeping stale advice.
- **Coexists?** Yes — composed with change 11 in the resolution.
- **Replaces?** Yes — retires hand-written per-file recovery strings.
- **Improves:** UX ✔ · Maintainability ✔✔ · Reliability ✔ · Accuracy ✔ (copy can't drift from reality)
- **Rank:** **High**

### 19. AI migration records, verdict Zod schema, and sessions-API spikes

- **Description:** Phase records `ai-migration/01-inventory.md` (all ~45 AI call sites with latency class and parse brittleness), `02-devin-capabilities.md`, `03-architecture.md`; `lib/ai/schemas/verdict.ts` (Zod `InvestmentVerdict` with `VERDICT_SCHEMA_VERSION`, compiles to Draft-7 JSON Schema via `z.toJSONSchema()`); `scripts/devin-spike.ts` (362 lines: sessions-API end-to-end with latency/ACU/first-try-validity measurement, jittered backoff polling) later extended to accept legacy v1 `apk_` keys alongside v3 `cog_` service users, routing `/v1/sessions` vs `/v3/organizations/{org}/sessions` through one status classifier.
- **Reason:** The migration was executed as measured phases with written evidence rather than a leap; the schema makes AI output contractually validatable.
- **Files changed:** `ai-migration/0{1,2,3}-*.md` (new), `lib/ai/schemas/verdict.ts` (new), `scripts/devin-spike.ts` (new, +70 later), `tests/ai-verdict.test.ts` (+4).
- **Dependencies:** introduces **zod ^4.4.3** (change also listed under dependencies); schema mirrors `lib/ai/verdict.ts` for compatibility.
- **Risk level:** Low — docs, a schema, and a standalone script; the schema is additive.
- **Coexists?** Yes — the merge deliberately kept **both** authors' migration records side by side (`0{1,2,3}-*.prisha.md`).
- **Replaces?** No — records and scaffolding.
- **Improves:** AI ✔ (validated output) · Reliability ✔ · Maintainability ✔ · Accuracy ✔
- **Rank:** **Medium**

### 20. Screener legibility — show the universe's shape, explain empty results

- **Description:** Distribution-bar histograms under every filter (24 buckets, span highlight, coverage %); removable filter chips stating the applied screen in one line; frame cycling per filter (absolute # → class percentile % → peer percentile ≈) with per-filter missing-data policy; preference toggles (2× ranking weight); "why empty" diagnosis naming the binding filters and the slack that would fix them, with one-click relax; held/marginal badges and binding-constraint display in results; batch staging; `universe-stats.ts` computing class and peer-group percentiles cached per universe build; `filter-engine.ts` `diagnose()`/`parsePreferences()`/frame-based filtering.
- **Reason:** The screener was blind — users couldn't see the universe's shape, why a screen returned nothing, or how close a near-miss was; empty results looked like breakage.
- **Files changed:** new `app/screener/_components/{distribution-bar,filter-chips,why-empty,screen-diff}.tsx`, `filter-panel.tsx` (+215), `results-table.tsx` (+161), `filter-state.ts` (+39), `app/screener/page.tsx` (+302), `lib/screener/universe-stats.ts` (new, 225), `lib/screener/filter-engine.ts` (+298), `lib/screener/pipeline.ts` (+45), `tests/screener-engine.test.ts` (+222).
- **Dependencies:** `lib/assets/` registry (change 21 provides new metrics to filter on); universe cache.
- **Risk level:** Low–Medium — large but additive UI + pure-function engine additions with tests.
- **Coexists?** Yes — additive layers over the existing pipeline.
- **Replaces?** Partially — replaces the silent empty state and unexplained ranking.
- **Improves:** UX ✔✔ · Accuracy ✔ (percentile frames) · Maintainability ✔ · AI ✔ (explain gets better ground truth)
- **Rank:** **Critical**

### 21. Universe metric expansion and asset-type formalization

- **Description:** New computed metrics per class — crypto `supplyOverhang`; bond `yieldPerDuration`, `spreadPerDuration`, `netYield`, `cashWeight`, `fundAge`; commodity `returnPerVol`, `carryQuality`; equity risk-adjusted metrics; fund `family`/`effectiveSectors` (inverse-Herfindahl) and `structure` (leveraged/inverse/covered-call/…) + canonicalized `issuer`; ETF structure/issuer enums (+140). New `lib/assets/{bond,commodity,crypto,equity,reit}.ts`; `assets/types.ts` gains `peerGroupBy` so peer-percentile frames know their peer set.
- **Reason:** Peer-relative screening (change 20's frames) is meaningless without formal peer grouping, and the new risk-adjusted metrics are what practitioners actually screen bonds/commodities on.
- **Files changed:** `lib/screener/universes/{bond,commodity,crypto,equity,etf,fund-shared}.ts`, `lib/assets/*` (5 new files, `etf.ts` +217, `types.ts` +83), `tests/screener-universes.test.ts`.
- **Dependencies:** consumed by screener pipeline, filter panel, results columns.
- **Risk level:** Low — additive metric definitions.
- **Coexists?** Yes.
- **Replaces?** No.
- **Improves:** Accuracy ✔ · UX ✔ (more meaningful screens)
- **Rank:** **Medium**

### 22. Saved-screen run snapshots (entries/exits diff)

- **Description:** `saved_screen` gains `last_symbols` (JSON, capped at 500) and `last_run_at`; `recordScreenRun()` and a `PATCH /api/screener/saved` route that records a run without touching `updated_at`; loading a saved screen shows which symbols entered/exited since its last run.
- **Reason:** A saved screen's value is the delta — new names appearing and old names dropping out — which was previously invisible.
- **Files changed:** `lib/db.ts` (+54 on this side), `app/api/screener/saved/route.ts`, `app/screener/_components/{saved-screens,screen-diff}.tsx`.
- **Dependencies:** change 20's screen-diff component; SQLite.
- **Risk level:** Low — additive columns; auto-merged cleanly with divit's much larger `db.ts` change.
- **Coexists?** Yes.
- **Replaces?** No.
- **Improves:** UX ✔ · Accuracy ✔ (change detection)
- **Rank:** **Low**

### 23. Brand identity system ("Convergence Point")

- **Description:** A single source of truth for logo geometry (`lib/brand/mark.ts` — four bars converging to a diamond terminus), React brand components (`BrandMark`, `BrandLockup`, `BrandEmptyState`, animated `LoadingMark` that resolves pixel-exactly into the static mark), a generator script producing favicon.ico / icon.svg / apple-icon.png / PWA icons / `public/brand/*.svg` from the geometry, a PWA `manifest.ts`, PDF-export brand integration (`lib/brand/pdf.ts`), a site footer, and header/boot-splash/palette/assistant adoption. Full spec in `docs/LOGO-IMPLEMENTATION.md` and `docs/brand-guidelines.md`.
- **Reason:** The app shipped with the stock Next.js favicon and no visual identity; empty states and loading indicators were unbranded and inconsistent.
- **Files changed:** `lib/brand/{mark,pdf}.ts` (new), `app/_components/brand.tsx` (new, 278), `app/_components/{site-footer}.tsx` (new), `loading-mark.tsx`, `site-header.tsx`, `boot-splash.tsx`, `ai-assistant.tsx`, `command-palette.tsx`, `app/layout.tsx`, `app/globals.css` (+60), `app/manifest.ts` (new), `app/{favicon.ico,icon.svg,apple-icon.png}`, `public/brand/*` (7 assets), `scripts/generate-brand-assets.ts` (new), `package.json` (`brand:assets` script), `docs/LOGO-IMPLEMENTATION.md`, `docs/brand-guidelines.md`, `tests/brand.test.ts` (142).
- **Dependencies:** none at runtime; generated binaries must be regenerated (never merged) via `npm run brand:assets`.
- **Risk level:** Low — presentational; the only merge hazard is the binary assets.
- **Coexists?** No — a brand is singular; note the later Brand Phase 1 (post-merge, `5549b36`) re-tinted brass-in/sky-blue-out on top of this system, which is exactly what a geometry-as-code brand enables.
- **Replaces?** Yes — replaces placeholder branding.
- **Improves:** UX ✔✔ · Maintainability ✔ (assets generated from one geometry)
- **Rank:** **High**

### 24. Python engine performance overhaul (~200s → ~10s Fast Run)

- **Description:** Batched price loading (one ordered scan replacing ~2,000 per-symbol round-trips on a 250-name universe); one HMM regime fit per market instead of 12 per stock (−47s); stopped writing the `features_daily` full 5-year expansion nobody read (−28s/run; 15.4M rows / 1.1 GB reclaimed); same-day rerun compares against the market's last close to skip re-downloads; `fast_info` no longer refetched per symbol on top-ups (−49s); universe resolution no longer hits the Yahoo screener every run (−3–9s); fundamentals enrichment visits only rows with missing fields; `raise_fd_limit()` for macOS; vectorized `features/factory.py`, `models/regime.py`, `data/loader.py`; per-stage `StageTimer` profiling (`UAA_ENGINE_TIMING=0` to silence). `verify_engine_equivalence.py` pins vectorized-vs-loop equivalence (max |diff| 0 to 1e-13). Measured: Fast Run (`--no-forecast`) ~182–223s → **~9–13s** on full_us (248 names, warm).
- **Reason:** The engine re-did work on every run; a 3-minute daily job that should take seconds discourages running it at all.
- **Files changed:** `engine/daily_run.py` (+597), `engine/profiling.py` (new, 89), `engine/data/loader.py` (+328), `engine/data/{macro_loader,nse_enrichment}.py`, `engine/features/factory.py` (+311), `engine/models/regime.py` (+312), `engine/universe.py` (+110), `verify_engine_equivalence.py` (new, 347).
- **Dependencies:** DuckDB; yfinance; pure-Python — no npm impact.
- **Risk level:** Medium — heavy rewrite of numerical code, mitigated decisively by the equivalence verifier.
- **Coexists?** No — rewrites the single engine pipeline.
- **Replaces?** Yes — replaces loop implementations and per-symbol query patterns.
- **Improves:** Performance ✔✔✔ · Reliability ✔ (FD limits, recency guards) · Accuracy ✔ (equivalence pinned) · Maintainability ✔ (stage timing)
- **Rank:** **Critical**

### 25. Engine data-corruption fixes

- **Description:** Three correctness fixes in the Python engine: (a) `fetch_ohlcv`'s single-symbol branch read `row.get("Open")` against yfinance's MultiIndex columns and silently wrote **all-NULL prices**; (b) `_yf_close` returned an (n,1) array so macro augmentation never ran — swallowed by a bare `except`; (c) "NULL means retry" conditions lacked recency guards, causing infinite refetch loops.
- **Reason:** Silent NULL price writes and a silently-dead macro feature corrupt every downstream score; these are integrity bugs, not performance bugs.
- **Files changed:** `engine/data/loader.py`, `engine/daily_run.py` (within the change-24 commits `c399e40`/`4c10c1d`).
- **Dependencies:** none beyond the engine.
- **Risk level:** Low — strictly corrective.
- **Coexists?** No — fixes the single data path.
- **Replaces?** Yes — replaces the broken read/guard logic.
- **Improves:** Accuracy ✔✔✔ · Reliability ✔✔
- **Rank:** **Critical**

### 26. DuckDB compaction and derived-history pruning

- **Description:** `engine/compact_db.py` rewrites the DuckDB database into a fresh file (DuckDB frees blocks after DELETE but never shrinks the file), verifying per-table row counts before swapping and keeping a backup on mismatch; `prune_derived_history()` removes derived rows no reader consumes.
- **Reason:** The engine DB grew monotonically (1.1 GB of unread `features_daily` expansion alone) on a laptop where disk and RAM headroom are the operating constraint.
- **Files changed:** `engine/compact_db.py` (new, 99), `engine/daily_run.py` (prune integration).
- **Dependencies:** DuckDB; change 24 (pruning is only safe because the expansion write was removed).
- **Risk level:** Medium — it rewrites the database file; mitigated by row-count verification and backup-on-mismatch.
- **Coexists?** Yes — an operational tool.
- **Replaces?** No.
- **Improves:** Performance ✔ · Reliability ✔ (verified swap) · Maintainability ✔
- **Rank:** **Medium**

### 27. Dataset stale-while-revalidate on the screener price layer

- **Description:** `lib/dataset.ts` (+50) serves the cached price layer immediately and refreshes in the background when the 5-minute TTL expires; N concurrent screens trigger exactly one refresh.
- **Reason:** Screener interactions randomly hung ~3.7s whenever a user happened to be the one who tripped the TTL.
- **Files changed:** `lib/dataset.ts`.
- **Dependencies:** legacy `fundamentals_cache` path (predates the platform layer, which already had SWR — this brings the legacy path to parity).
- **Risk level:** Low — serving slightly stale prices for one refresh window on a screening (not trading) surface is an explicit, acceptable trade.
- **Coexists?** Yes.
- **Replaces?** Yes — replaces blocking-refresh semantics on this path.
- **Improves:** Performance ✔✔ · UX ✔✔ · Reliability ✔
- **Rank:** **High**

### 28. Redesign and eye-ease design records (docs-only; redesign later ABANDONED)

- **Description:** `docs/redesign/PLAN.md` (phased plan + decision log), `docs/brand-preview/**` HTML prototypes (terminal spec/demo, working, engines), `docs/concept/EYE-EASE.md` (876 lines) + interactive prototype and screenshots. No app code.
- **Reason:** Record the design exploration and the light-theme decision with prototypes rather than assertions.
- **Files changed:** `docs/redesign/`, `docs/brand-preview/`, `docs/concept/` (new, docs-only).
- **Dependencies:** none.
- **Risk level:** Low for code; **High for guidance** — the terminal redesign was abandoned by owner decision (2026-08-02, too close to Bloomberg's identity). AGENTS.md now marks these as historical records; nothing may reintroduce the `.tm-*` chrome.
- **Coexists?** Yes (inert documents).
- **Replaces?** No — and must not be treated as replacing the shipped UI direction.
- **Improves:** Maintainability ✔ (decision history)
- **Rank:** **Low**

### 29. Performance baseline harness

- **Description:** `scripts/perf-baseline.mjs` (142 lines) measures build time, per-route initial JS, LCP/TTI on the five heaviest pages, screener scroll FPS, and 30-minute heap; the recorded baseline (60.1 avg FPS at 50 rows; heap 11.3/15.4 MB) lives in `docs/redesign/PLAN.md` §6.
- **Reason:** "Record the performance baseline" before any redesign so regressions are measurable rather than argued.
- **Files changed:** `scripts/perf-baseline.mjs` (new).
- **Dependencies:** Playwright/Chrome for measurement; dev server running.
- **Risk level:** Low — standalone script.
- **Coexists?** Yes.
- **Replaces?** No.
- **Improves:** Performance ✔ (measurability) · Maintainability ✔
- **Rank:** **Low**

---

## Part C — Cross-cutting records

### New dependencies introduced in this version

| Dependency | Introduced by | Change # |
|---|---|---|
| `zod` `^4.4.3` | prisha-work | 19 |
| npm script `brand:assets` | prisha-work | 23 |
| *(divit-local added no dependencies)* | — | — |

### Database schema deltas (summary; details in the owning changes)

- **New tables:** `watchlist_group`, `watchlist_member`, `watchlist_target_history` (1) · `price_alert_state` (9) · `portfolios` (3) · `simulation` (2)
- **New columns:** `watchlist.stage/stage_changed_at/target_direction/source/source_detail` (1, 9, 10) · `portfolio_lot.currency/asset_class/portfolio_id` (3, 4) · `manual_asset.portfolio_id`, `portfolio_snapshot.portfolio_id` (3) · `saved_screen.last_symbols/last_run_at` (22) · `decision.case_version` (kept from both sides in the merge)
- All migrations are additive (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN` with safe defaults); there is no downgrade path.

### Environment variable deltas (summary)

- divit-local: `AI_HEALTH_PATH` (11).
- prisha-work: `AI_PROVIDER_ORDER`, `AI_DISABLED_MODELS`, `AI_MAX_MODEL_GB`, `DEVIN_CLI_{BIN,WORKSPACE,CONCURRENCY,DISABLED}`, `DEVIN_API_{KEY,BASE,MODE,MAX_ACU,CONCURRENCY}`, `DEVIN_ORG_ID`, `DEVIN_PLAYBOOK_ANALYSIS`, `AI_PROVIDER`, `OLLAMA_HOST`, `UAA_ENGINE_TIMING` (17, 19, 24).
- **Post-merge note:** the Anthropic consolidation on the current HEAD retired the Devin/Ollama variables; validate any env documentation against `lib/ai/config.ts` on the target branch.

### Changes that collide (must be composed, not picked)

| Collision | Changes | How the `main` resolution composed them |
|---|---|---|
| `lib/ai/router.ts` / `models.ts` | 11 + 12 vs 17 | prisha's lazy provider chain as the outer loop; divit's local-reliability work conditioned on `isHostedProvider() === false` via a compiler-total `PROVIDER_LOCALITY`; hosted timeouts fall through the chain |
| AI failure copy (~15 call sites) | 11 vs 18 | per-error-type messages kept; recovery *advice* routed through `AI_RECOVERY_HINT` |
| `app/api/portfolio/new-positions` | 14 vs prisha's modification | route restored; vocabulary moved to `lib/ios/types.ts` |
| `lib/db.ts` | 1/3/9 vs 22 | both sides' additive schema kept (`decision.case_version`, `saved_screen.last_*`) |
| `app/portfolio/page.tsx` | 2/5 vs 23 | empty book keeps tab bar + usable Simulator with `BrandEmptyState` as the card inside |
| `AGENTS.md` | both appended sections | both kept (product rules + quant-engine performance rules) |

---

*Generated from the same evidence base as `MERGE_SUMMARY.md`: `git diff 98500e1..{divit-local,origin/prisha-work}`, per-commit logs, `git merge-tree` conflict analysis, the `6585052` merge-resolution record, and direct source inspection. No source code was modified.*
