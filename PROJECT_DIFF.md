# PROJECT_DIFF.md — Engineering Comparison of Two Independently Evolved Versions

**Repository A:** `divit-local` @ `74ad42c` (16 commits past merge-base) — "the product branch"
**Repository B:** `origin/prisha-work` @ `4c10c1d` (10 commits past merge-base) — "the platform branch"
**Common ancestor:** `98500e1` ("Merge origin/main: streaming AI verdicts, score reconciliation, data grid")
**Generated:** 2026-08-06 · Read-only analysis · No source modified
**Companions:** `MERGE_SUMMARY.md` (architecture + full feature inventory), `CHANGE_MANIFEST.md` (per-change manifest with ranks)

> **Temporal note.** A hand-resolved combination of these two versions already exists (`main` @ `6585052`, plus follow-ups `cac4ddb`, `1e1a34b`, `4c67333`). Where this document's recommendation matches that resolution, it is noted as *[matches main]*; where post-merge evolution (notably the Anthropic-only AI consolidation on `f22/day-change`) changes the calculus, that is noted too. Recommendations below are made on the merits of A vs B alone, then annotated.

**Scale of divergence**

| | A (`divit-local`) | B (`prisha-work`) |
|---|---|---|
| Files changed vs base | 233 (+35,417 / −4,538) | 149 (+16,161 / −798) |
| Overlapping files | 18 | |
| True conflicts (`git merge-tree`) | 7 (6 content + 1 modify/delete) | |
| Center of gravity | Portfolio, Watchlist, correctness | AI platform, Screener, Python engine, brand |

---

## 1. Feature comparison

### 1.1 Features unique to Repository A

| # | Feature | Files (representative) | Recommendation | Justification |
|---|---|---|---|---|
| A1 | **Portfolio Simulator** (mandate intake → AI interview → staged generation → compare → promote) | `app/portfolio/_components/simulator/**`, `lib/portfolio/simulator/**`, 8× `/api/portfolio/simulator/*`, `simulation` table | **Keep Repository A** | Net-new, self-contained, heavily tested (5 test suites); B has no counterpart. *[matches main]* |
| A2 | **Watchlist rebuild** (named lists, target direction + history, live quotes w/ backoff, consensus, range bar, stages, digest) | `app/watchlist/**`, `lib/{watchlist-metrics,live-quotes,price-crossing}.ts`, 3 new API routes, 3 new tables | **Keep Repository A** | B never touched the watchlist; A's version also fixes a real correctness bug (contradictory target semantics). *[matches main]* |
| A3 | **Multi-portfolio support** (`portfolios` table, `portfolio_id` scoping, read-only non-default books) | `lib/db.ts`, `/api/portfolio/portfolios`, portfolio page switcher | **Keep Repository A** | Required by A1's promote flow; additive migration with safe defaults. *[matches main]* |
| A4 | **Canonical performance engine** (one total return, dated series, historical-FX realized P&L, attribution/confidence) | `lib/portfolio-performance.ts`, `lib/portfolio/engines/{attribution,confidence,series}.ts`, `portfolio-analytics.ts` −1,655 | **Keep Repository A** | Pure correctness consolidation; B has no competing implementation. *[matches main]* |
| A5 | **Classification authority** (class resolved once, on holdings; risk-models reference) | `lib/portfolio/classes/market-base.ts`, `classes/reference/risk-models.ts`, all class adapters | **Keep Repository A** | Eliminates per-engine reclassification drift; 1,200+ lines of tests. *[matches main]* |
| A6 | **Cash preview/executor parity + phantom-position fix** | `lib/portfolio/engines/{cash,optimize,transaction}.ts`, cash/optimize components | **Keep Repository A** | Execution-integrity fixes; no B equivalent. *[matches main]* |
| A7 | **Pipeline provenance + idea relevance ranking** | `lib/portfolio/engines/idea-relevance.ts`, `lib/idea-source.ts`, pipeline board/card | **Keep Repository A** | Additive; makes the idea funnel trustworthy. *[matches main]* |
| A8 | **Table primitive widening** (windowing, persisted view state, density ownership, date input) | `app/_components/ui/data-table.tsx`, `lib/table-window.ts` | **Keep Repository A** | Foundation for A1/A2 surfaces; B's screener table edits do not overlap this primitive. *[matches main]* |
| A9 | **Compare verdict streaming + typed AI errors surfaced in UI** | `app/compare/**`, `/api/compare/stream`, `lib/ai-compare.ts` | **Combine both** | The streaming/typed-error UI is A's, but its failure *advice* strings must route through B's `AI_RECOVERY_HINT` (B6) or they hardcode a provider. *[matches main — resolution kept messages, rerouted advice]* |
| A10 | **Health triage + dashboard question-ordering + trajectory/attribution panels** | `app/portfolio/_components/universal/**`, `app/portfolio/page.tsx` | **Combine both** | Layout is A's; but B restyled the same page's empty state with `BrandEmptyState`. Compose: A's tab bar + usable Simulator with B's brand card inside the empty book. *[matches main]* |

### 1.2 Features unique to Repository B

| # | Feature | Files (representative) | Recommendation | Justification |
|---|---|---|---|---|
| B1 | **Screener legibility suite** (distribution bars, filter chips, why-empty diagnosis, frames #/%/≈, preference weighting, held/marginal badges, screen diff) | `app/screener/_components/{distribution-bar,filter-chips,why-empty,screen-diff}.tsx`, `lib/screener/{universe-stats,filter-engine,pipeline}.ts` | **Keep Repository B** | A only made minor field additions to the screener page; B's suite is additive over the shared pipeline and tested (+222 lines). *[matches main]* |
| B2 | **Python engine performance overhaul** (~200s → ~10s Fast Run; batching, vectorization, equivalence verifier) | `engine/daily_run.py`, `engine/{profiling,data/loader,features/factory,models/regime}.py`, `verify_engine_equivalence.py` | **Keep Repository B** | 20× measured speedup with numerical equivalence pinned to ≤1e-13; A never touched the engine. *[matches main]* |
| B3 | **Engine data-corruption fixes** (all-NULL price writes, dead macro augmentation, infinite refetch loops) | `engine/data/loader.py`, `engine/daily_run.py` | **Keep Repository B** | Strict integrity fixes; non-negotiable. *[matches main]* |
| B4 | **DuckDB compaction + derived-history pruning** | `engine/compact_db.py` | **Keep Repository B** | Verified-swap design (row counts + backup); no A counterpart. *[matches main]* |
| B5 | **Brand identity system** ("Convergence Point": mark geometry as code, brand components, generated assets, PWA manifest, footer) | `lib/brand/**`, `app/_components/brand.tsx`, `scripts/generate-brand-assets.ts`, `app/{favicon.ico,icon.svg,…}` | **Keep Repository B** | A has no brand work; geometry-as-code later enabled Brand Phase 1 retinting with minimal churn. Binary assets regenerate via `npm run brand:assets`, never merge. *[matches main]* |
| B6 | **Provider-agnostic AI availability** (`AI_RECOVERY_HINT`, `aiUnavailableMessage()`, honest status badge) | `lib/ai/availability.ts`, `app/_components/ollama-status.tsx`, ~15 call sites | **Keep Repository B** | Centralized recovery copy is the only design that survives provider changes — proven when the post-merge Anthropic switch changed the advice in exactly one place. *[matches main]* |
| B7 | **Dataset stale-while-revalidate** (screener price layer) | `lib/dataset.ts` | **Keep Repository B** | Kills measured 3.7s hangs; brings the legacy path to parity with the platform layer. *[matches main]* |
| B8 | **Universe metric expansion + asset-type formalization** (`peerGroupBy`, bond/commodity/crypto risk-adjusted metrics, ETF structure/issuer) | `lib/screener/universes/**`, `lib/assets/**` | **Combine both** | Mostly B's, but A also touched `crypto.ts`/`fund-shared.ts` with different additive fields — both sets are non-colliding and both are consumed downstream. *[matches main — auto-merged, kept both]* |
| B9 | **Saved-screen run snapshots** (`last_symbols`/`last_run_at`, entries/exits diff) | `lib/db.ts`, `PATCH /api/screener/saved`, screen-diff UI | **Keep Repository B** | Additive columns; pairs with B1's diff component. *[matches main]* |
| B10 | **AI migration records + verdict Zod schema + sessions spike** | `ai-migration/01–03`, `lib/ai/schemas/verdict.ts`, `scripts/devin-spike.ts` | **Combine both** | A wrote its own parallel migration records; prose does not interleave — keep both document sets side by side (B's as `*.prisha.md`). The Zod schema itself is B-only: keep. *[matches main]* |
| B11 | **Perf baseline harness + redesign/eye-ease records** | `scripts/perf-baseline.mjs`, `docs/redesign/**`, `docs/concept/**` | **Keep Repository B** (as historical record) | Harness is useful; the redesign docs must be kept *marked ABANDONED* — they are decision history, not guidance. *[matches main + owner decision 2026-08-02]* |

### 1.3 Features implemented differently (both versions built the same thing)

This is the heart of the merge problem: **both branches independently built a Devin AI migration with different seams, and neither is a superset** (the `main` resolution's own words).

| # | Concern | Repository A's implementation | Repository B's implementation | Recommendation | Justification |
|---|---|---|---|---|---|
| D1 | **AI routing reliability** | Local-reliability hardening: timeout as host bound (`TimeoutError` recognized by `withRetry`), `keep_alive` residency, cold-start budget widening, generation gate, capped cold-timeout fallback. Measured 6m40s → 22s | Lazy provider chain: `attemptOrder()` generator walks devin → ollama; hosted-first; provider enumeration costs nothing until reached | **Combine both** | Neither subsumes the other: B's chain is the correct *outer loop*; A's reliability work is correct *only for local providers* (a hosted provider has no load phase, runs parallel, and its timeout implies nothing about local memory). Combination requires an explicit locality discriminator (`isHostedProvider()`, total `PROVIDER_LOCALITY` record) so the compiler forces classification of any new provider. *[matches main — this was the merge's centerpiece]* |
| D2 | **AI failure messaging** | Per-error-type messages (stage, timeout, missing model) — *specific* | One centralized recovery hint naming all provider paths — *durable* | **Combine both** | Specificity and durability are orthogonal: keep A's error taxonomy for *what failed*, route *what to do about it* through B's `AI_RECOVERY_HINT`. Picking either alone regresses the other property. *[matches main]* |
| D3 | **AI call-site inventory / migration architecture docs** | `ai-migration/0*.md` (A's architecture: Devin **CLI** provider focus) | `ai-migration/0*.md` (B's architecture: Devin **sessions API** focus) | **Combine both** (side-by-side, never interleaved) | They document genuinely different architectures; both were later drawn on (`4c67333` uses the sessions/chain split from B's docs and the CLI measurements from A's line). *[matches main — B's renamed `*.prisha.md`]* |
| D4 | **`lib/db.ts` schema extension** | +943 lines: 6 new tables, 8 new columns (watchlist/portfolio/simulator) | +54 lines: `saved_screen` snapshot columns, `decision.case_version` | **Combine both** | Purely additive on both sides; zero column collisions. Only the migration-block *ordering* needs human eyes (see §4.2-H2). *[matches main]* |
| D5 | **`/api/portfolio/new-positions`** | **Deleted** (judged superseded by the recommendation route) | **Modified** (kept in service) | **Keep Repository B** (restore the route), then schedule a verified removal | A's deletion was premature: `lib/ai-watchlist.ts` still documented the route as a live caller. Restore B's version, move the shared vocabulary to `lib/ios/types.ts`, and only delete after the call graph proves it dead. *[matches main]* |
| D6 | **Screener universe files** (`crypto.ts`, `fund-shared.ts`) | Small additive fields serving the new portfolio state | Different additive metrics (supplyOverhang, structure/issuer/effectiveSectors) | **Combine both** | Non-overlapping additions to the same files; both have downstream consumers. *[matches main]* |
| D7 | **`tests/ai-router.test.ts`** | +166 lines: timeout/cold-start/gate assertions (written against the local path via FakeProvider) | +4 lines: provider-chain adjustments | **Combine both**, then **audit semantics** | Textually trivial to merge, semantically loaded: A's assertions only remain meaningful if FakeProvider keeps the local treatment (which the conservative locality default guarantees). Add an explicit test asserting hosted-path *bypass* of local gates — the one behavior the merge got wrong before human review. |
| D8 | **`AGENTS.md` guidance** | Appended product rules (never let the model derive directional verdicts, etc.) | Appended quant-engine performance rules + brand rules | **Combine both** | Both sections are true and non-competing; prose sections concatenate cleanly. *[matches main]* |
| D9 | **App-assistant behavior** (`lib/ai-app-assistant.ts`) | Timeout budget 45s → 150s; typed failures | `failureAnswer` routed through availability module | **Combine both** | Same file, different lines, both correct; compose per D2's rule. *[matches main]* |

---

## 2. Category-by-category differences

### 2.1 Architecture

| Difference | A | B | Action | Justification |
|---|---|---|---|---|
| Portfolio domain shape | Engine-per-question decomposition (`engines/{performance,attribution,confidence,series,transaction,idea-relevance}`), class adapters over a `market-base` | Untouched | **Keep A** | Strictly better factoring; B has no opinion here |
| AI provider abstraction | Single-provider (Ollama) hardened | Multi-provider chain with `AIProvider` seam | **Keep B** (the seam), fold A's hardening inside it | A seam that admits N providers is architecturally senior to a hardened singleton; A's work survives as the local-provider branch (D1) |
| Screener analysis layer | — | `universe-stats.ts` percentile layer + `diagnose()` in filter engine | **Keep B** | New capability, pure functions, cached per universe build |
| Python engine structure | — | Vectorized modules + `StageTimer` profiling + equivalence verifier | **Keep B** | The verifier is the architectural keystone: it converts a risky rewrite into a checked one |

### 2.2 UI

| Difference | Action | Justification |
|---|---|---|
| Watchlist page (A: full rebuild / B: untouched) | **Keep A** | See A2 |
| Portfolio dashboard (A: reorder + new panels / B: BrandEmptyState on same page) | **Combine both** | See A10; one file (`app/portfolio/page.tsx`) — a true conflict, compose by hand |
| Screener page (A: minor field plumbing / B: legibility suite) | **Combine both** | Same file (`app/screener/page.tsx`), auto-merges; B's suite dominates, A's fields ride along |
| Brand chrome (favicon, header lockup, footer, loading mark, empty states) | **Keep B** | A has no competing identity work |
| Density/table controls (A) vs screener table badges (B) | **Combine both** | Different components (`ui/data-table.tsx` vs `screener/_components/results-table.tsx`); no collision |
| Compare page streaming + typed errors (A) | **Keep A** (with D2 advice routing) | B didn't touch Compare |

### 2.3 Backend

| Difference | Action | Justification |
|---|---|---|
| 14 new API routes (A: simulator/watchlist/pipeline/compare-stream) | **Keep A** | Additive, tested |
| `PATCH /api/screener/saved` (B) | **Keep B** | Additive |
| `new-positions` route (A deletes / B modifies) | **Keep B** now, remove later with proof | See D5 |
| Engine batching/pruning/compaction (B) | **Keep B** | See B2–B4 |
| `lib/dataset.ts` SWR (B) | **Keep B** | See B7 |
| Alerts direction + crossing detection (A) | **Keep A** | Pairs with A2's schema |

### 2.4 AI

| Difference | Action | Justification |
|---|---|---|
| Router (D1) | **Combine both** | The merge's centerpiece; locality-conditioned composition |
| Failure copy (D2) | **Combine both** | Specific errors + centralized advice |
| Devin CLI provider (B) | **Keep B** *at this snapshot* | Measured 3.9–8.3s vs 28–115s local. **Post-merge annotation:** the Anthropic consolidation later retired both Devin and Ollama tiers — if merging toward today's `main`/`f22`, this code is transitional and its *seam* (not its provider) is what must survive |
| Hosted-first **default** (`AI_PROVIDER_ORDER=devin,ollama`) (B) | **Keep A's implicit default** (local-first) at merge time | B's default shipped a product decision explicitly gated on unresolved calibration (Blocker-1) and cost (Blocker-2) sign-offs. Merge mechanics and product defaults must be decided separately. *[matches main — `1e1a34b` reverted the default, `4c67333` later flipped it deliberately]* |
| Verdict Zod schema (B) | **Keep B** | Contractual AI output; A has none |
| Timeout semantics (A) | **Keep A**, scoped to local providers | See D1 |
| AI health file + `AI_HEALTH_PATH` (A) | **Keep A** | No B counterpart |

### 2.5 Database

| Difference | Action | Justification |
|---|---|---|
| A's 6 tables + 8 columns vs B's 2 columns + 1 column | **Combine both** (D4) | Fully additive; verify migration-block order manually |
| DuckDB compaction (B) | **Keep B** | Operational tool, verified swap |
| No downgrade path (both) | **Rewrite from scratch — no.** Accept, but **document** | Neither side built downgrades; consistent with repo practice. Mitigate with a pre-merge `data/app.db` backup (a `backup/pre-merge-*` branch exists for code; the DB has no equivalent — create one) |

### 2.6 API surface

Combined surface is the union minus the `new-positions` dispute (D5). No route is defined by both sides with different contracts — the only API-level conflict is existence vs deletion of one route. **Action per D5.**

### 2.7 Performance

| Improvement | Side | Action | Justification |
|---|---|---|---|
| Engine ~200s → ~10s | B | **Keep B** | Largest measured win in either branch |
| AI 6m40s → 22s | A | **Keep A** (locality-scoped) | Second-largest; survives inside B's chain |
| Dataset SWR (kills 3.7s hangs) | B | **Keep B** | Measured |
| Table windowing | A | **Keep A** | Required for large watchlists |
| Baseline harness | B | **Keep B** | Makes future claims falsifiable |

No performance regressions were identified in either branch relative to base.

### 2.8 Security

| Difference | A | B | Action | Justification |
|---|---|---|---|---|
| AI egress | Unchanged (local Ollama only — zero egress) | Adds hosted inference: prompts leave the machine to Devin's API; keys via `DEVIN_API_KEY`/CLI | **Combine both** — keep B's containment design, keep A's zero-egress mode reachable | B's provider is well-contained (isolated scratch workspace so repo agent-rules don't leak into prompts; tools denied; key never logged). But hosted-by-default silently changes the product's data-privacy posture — the same reason the default was reverted. Local-only must remain one env var away (`AI_PROVIDER_ORDER=ollama`) |
| Credential surface | None added | `apk_`/`cog_` key handling in spike script; env-only, never committed | **Keep B** | Spike-scoped; follows key-hygiene rules |
| Auth | Neither branch adds auth (local auth arrives post-merge) | — | n/a | — |

### 2.9 Testing

| Difference | A | B | Action | Justification |
|---|---|---|---|---|
| Volume | ~26 new + 14 modified test files (~7,000 lines): simulator, performance (782), risk models (616), classification (328), alerts (+252), timeout (139) | ~4 new + 6 modified: provider chain (201), screener engine (+222), brand (142), devin-cli (90) + `verify_engine_equivalence.py` (347, Python) | **Combine both** | Nearly disjoint by domain; union is strictly better |
| Semantic hazard | `ai-router.test.ts` assertions assume local path | +4-line chain edits to the same file | **Combine both + add hosted-bypass test** (D7) | The one place where green tests can mislead |
| Engine verification style | — | Equivalence-diffing against loop implementations | **Keep B** | A pattern worth adopting for any future numerical rewrite |

### 2.10 Documentation

| Difference | Action | Justification |
|---|---|---|
| Two parallel AI-migration record sets (D3) | **Combine both, side-by-side** | Different architectures; interleaving destroys both |
| `AGENTS.md` sections (D8) | **Combine both** | Non-competing guidance |
| B's brand guidelines + LOGO-IMPLEMENTATION | **Keep B** | Sole identity documentation |
| B's redesign/eye-ease records | **Keep B, marked ABANDONED** | Owner decision; history, not guidance |
| A's Simulator/Watchlist documentation (`637ee3a`) | **Keep A** | Documents A-only features |
| Both sides' doc claims vs reality | **Rewrite from scratch — the *claims audit* only** | Both branches wrote docs describing intended states; the repo's own audit doctrine ("treat doc comments as intent, not fact") demands a post-merge doc-truth pass. This is the only "rewrite" recommendation in this report, and it targets prose, not code |

---

## 3. Detection results

### 3.1 Duplicate implementations

| Duplicate | Instances | Resolution |
|---|---|---|
| AI reliability/migration work | A's local hardening vs B's provider chain (D1) | Combine with locality discriminator — the only real algorithmic duplicate |
| AI migration phase docs | A's `0{1,2,3}-*.md` vs B's | Keep both, rename B's (`*.prisha.md`) |
| Spike scripts | A-line's CLI spike vs B's `devin-spike.ts` (sessions) | Keep both — they measure different transports |
| Recovery-advice strings | A's per-file messages vs B's central hint | B's wins for *advice*; A's taxonomy wins for *diagnosis* (D2) |
| None found in: portfolio engines, screener stats, brand, engine vectorization | — | Genuinely disjoint work |

### 3.2 Hidden merge conflicts (auto-merge cleanly, wrong or risky semantically)

| ID | Location | Hazard | Evidence |
|---|---|---|---|
| H1 | `lib/ai/router.ts` `routeStream` | git auto-merged B's chain with A's generation gate applied to **hosted** providers — compiled, tests green, semantically wrong | **Actually happened** during the `main` merge; caught only by human review |
| H2 | `lib/db.ts` | Both sides' migration blocks interleave in one `getDb()`; order and idempotency are unverified by the merge tool | Auto-merged in `main`, deliberately hand-verified |
| H3 | `tests/ai-router.test.ts` | Merged suite passes while asserting only the local path; hosted path untested | See D7 |
| H4 | `app/screener/page.tsx` | A's field plumbing + B's +302-line legibility integration auto-merge; state-shape assumptions (filter-state) may drift | Verified compatible in `main`, but only by running the page |
| H5 | `lib/ai/models.ts` | A's +24 (health/timeouts) and B's +172 (providers) auto-merge; an unclassified provider id would silently get wrong treatment | Mitigated by B's total-record pattern — preserve it |

### 3.3 Semantic conflicts (same concept, different meaning)

| ID | Concept | A's meaning | B's meaning | Resolution |
|---|---|---|---|---|
| S1 | "AI timeout" | A fact about the local host (stop retrying, widen for cold starts) | A reason to fall through to the next provider | Both true — *for their provider class*. Locality discriminator resolves it |
| S2 | "AI is unavailable — what should the user do?" | Task-specific error strings | One product-wide recovery path | Compose (D2) |
| S3 | "Default provider" | Implicitly local (privacy-preserving, slow) | Hosted-first (fast, egress) | Product decision, not merge decision — decide explicitly, separately (§2.4) |
| S4 | "new-positions" | Dead code | Live route | Call-graph evidence sides with B today (D5) |

### 3.4 Behavioural conflicts (user-observable)

| ID | Behavior | A | B | Post-combination behavior to verify |
|---|---|---|---|---|
| BC1 | AI latency profile | 22s cold local | 3.9–8.3s hosted | Chain order determines which the user gets; verify the *badge* tells the truth either way |
| BC2 | AI failure UX | Specific cause, local advice | Generic-ish cause, correct advice | Combined: specific cause + correct advice — verify on every surface listed in B6 |
| BC3 | Screener empty results | Silent empty table (base behavior; A unchanged) | Diagnosed, actionable | B wins; verify A's new fields render inside B's layout |
| BC4 | Portfolio empty state | Tab bar + Simulator | Brand empty card | Composed per A10; verify Simulator remains reachable with zero holdings |
| BC5 | Watchlist "target reached" | Direction-aware (correct) | Base behavior (contradictory) | A wins; verify export + alerts + page agree post-merge |

### 3.5 Future maintenance risks

| Risk | Source | Severity | Mitigation |
|---|---|---|---|
| Provider-locality table forgotten when adding a provider | D1 combination | High | B's total `Record<ProviderId, Locality>` makes it a compile error — preserve the pattern verbatim |
| A's 1,465-line `risk-models.ts` reference data going stale | A5 | Medium | It is reference data with tests; schedule periodic review |
| Redesign docs resurrected as guidance | B11 | Medium | ABANDONED banners exist in AGENTS.md — keep them |
| Two migration doc sets confusing future readers | D3 | Low | Naming convention (`*.prisha.md`) + a pointer paragraph |
| `simulation.holdings` stored as JSON text | A1 | Low | Consistent with repo norms (several JSON columns); acceptable |
| Devin CLI/sessions code after provider retirement | B (post-merge context) | Medium | Already resolved on `f22` (retired); if merging A+B fresh, plan the same consolidation |

### 3.6 Technical debt introduced

| Debt item | Introduced by | Assessment |
|---|---|---|
| Route restored under doc-only evidence (`new-positions`) | Merge necessity (A deleted prematurely) | Debt is the *unverified caller*; pay down with a call-graph check then removal |
| `AI_PROVIDER_ORDER` string-env config for a critical path | B | Low — but defaults must be reviewed at every merge (S3 recurrence risk) |
| Legacy `fundamentals_cache` path kept (now with SWR) alongside platform cache | B (improved, didn't unify) | Pre-existing debt B made cheaper, not smaller; future unification candidate |
| −1,655-line analytics consolidation ripples through every return consumer | A | Not debt per se, but every downstream figure changed provenance — the 782-line test file is the offsetting asset |
| Binary brand assets in git | B | Unavoidable for favicons; the generator script is the mitigation (assets are derived artifacts) |

---

## 4. Merge-risk matrix

Likelihood × Impact of regression if merged naively; Detection = how hard a regression is to notice.

| Area | Likelihood | Impact | Detection difficulty | Risk | Primary mitigation |
|---|---|---|---|---|---|
| `lib/ai/router.ts` + `models.ts` (D1, H1, H5) | **High** (proven) | **High** (every AI feature) | **High** (compiles, tests green) | 🔴 **Critical** | Hand-merge; locality total-record; new hosted-bypass test |
| Provider default (S3) | High (it's one line) | High (privacy posture + cost) | Medium | 🔴 **Critical** | Separate product sign-off from merge |
| `new-positions` modify/delete (D5, S4) | Certain (git flags it) | Medium (watchlist AI flow) | Low (git flags it) | 🟠 High | Restore, verify call graph, then remove |
| `lib/db.ts` migrations (D4, H2) | Medium | High (user data) | Medium | 🟠 High | Hand-review block order; back up `data/app.db` first |
| AI failure copy (D2, BC2) | Medium | Medium (UX + truthfulness) | Medium (needs surface-by-surface check) | 🟠 High | Compose per rule; grep for residual hardcoded advice |
| `app/portfolio/page.tsx` (A10, BC4) | Certain (conflict) | Medium | Low | 🟡 Medium | Hand-compose; verify empty-book Simulator |
| `app/screener/page.tsx` (H4, BC3) | Low (auto-merges) | Medium | Medium | 🟡 Medium | Load the page; run screener tests |
| `tests/ai-router.test.ts` (D7, H3) | Medium | Medium (false confidence) | High | 🟡 Medium | Add hosted-path assertions |
| Universe files / assets registry (D6, B8) | Low | Low | Low | 🟢 Low | Auto-merge + `screener-universes` tests |
| Brand assets (B5) | Low | Low (cosmetic) | Low | 🟢 Low | Regenerate, never merge binaries |
| Docs (D3, D8, B11) | Low | Low (guidance drift) | Medium | 🟢 Low | Side-by-side records; ABANDONED banners; claims audit |
| Engine (B2–B4) | Low (disjoint) | High if wrong | Low (verifier exists) | 🟢 Low | Run `verify_engine_equivalence.py` post-merge |
| Simulator / Watchlist / engines (A1–A8) | Low (disjoint) | Medium | Low | 🟢 Low | Existing test suites |

---

## 5. Decision dependency graph

Decisions (Dn = §1.3, letters = feature groups). An arrow X → Y means **X must be decided/executed before Y**.

```
                         ┌────────────────────────────────────┐
                         │ G0. Product decision: default       │
                         │     provider order (S3)             │
                         └───────────────┬────────────────────┘
                                         │ (informs, does not block mechanics)
                                         ▼
 ┌──────────────┐   ┌─────────────────────────────┐
 │ G1. lib/db.ts │   │ G2. Provider locality model │
 │ schema union  │   │ (models.ts: ProviderId,     │
 │ (D4)          │   │ PROVIDER_LOCALITY,          │
 └──────┬───────┘   │ isHostedProvider)  (H5)     │
        │            └──────────┬──────────────────┘
        │                       ▼
        │            ┌─────────────────────────────┐
        │            │ G3. Router combination (D1) │
        │            │ chain outer loop + local-   │
        │            │ only hardening inside        │
        │            └──────────┬──────────────────┘
        │                       ▼
        │            ┌─────────────────────────────┐
        │            │ G4. Failure copy compose     │
        │            │ (D2/D9: errors + hint)       │
        │            └──────────┬──────────────────┘
        │                       ▼
        │            ┌─────────────────────────────┐
        │            │ G5. AI-consuming UI          │
        │            │ (A9 compare stream, B6      │
        │            │ status badge, assistant)     │
        │            └─────────────────────────────┘
        ▼
 ┌───────────────────────────────┐     ┌──────────────────────────────┐
 │ G6. new-positions restore (D5)│     │ G7. Table primitive (A8)     │
 │ + ios/types vocabulary move   │     └──────────┬───────────────────┘
 └──────┬────────────────────────┘                ▼
        ▼                              ┌──────────────────────────────┐
 ┌───────────────────────────────┐     │ G8. Watchlist rebuild (A2,   │
 │ G9. Watchlist AI digest        │◄────┤ needs G1 schema + G7 table) │
 │ (needs G6 route + G4 copy)    │     └──────────────────────────────┘
 └───────────────────────────────┘
 ┌───────────────────────────────┐     ┌──────────────────────────────┐
 │ G10. Simulator + multi-       │     │ G11. Screener: universes/    │
 │ portfolio (A1/A3, needs G1)   │     │ assets union (D6/B8) →       │
 └──────┬────────────────────────┘     │ stats/filter engine (B1) →   │
        ▼                              │ page integration (H4)        │
 ┌───────────────────────────────┐     └──────────────────────────────┘
 │ G12. portfolio/page.tsx        │
 │ compose (A10 + B5 empty state; │◄─── G13. Brand system (B5) ── regenerate assets
 │ needs G10 tabs + brand)        │
 └───────────────────────────────┘
 Independent roots (no inbound edges): G13 brand · G14 engine (B2–B4, run verifier)
 · G15 dataset SWR (B7) · G16 A's portfolio engines (A4–A7) · G17 docs (D3/D8/B11)
 Terminal: G18 test-suite union + hosted-bypass test (D7) — after G3
 · G19 doc-claims audit — after everything
```

Key orderings and why:

1. **G2 before G3** — the locality model is what makes the router combination expressible; merging the router first reproduces H1.
2. **G3 before G4 before G5** — error types flow router → copy → UI; composing UI first hardcodes strings that G4 then changes.
3. **G1 before G8/G10** — watchlist and simulator features read tables the schema union creates; feature-first ordering produces runtime "no such table" failures in dev DBs.
4. **G7 before G8** — the rebuilt watchlist sits on the widened DataTable.
5. **G6 before G9** — the AI watchlist digest references the restored route's vocabulary.
6. **D6/B8 before B1 before page** (inside G11) — metrics feed stats, stats feed the legibility UI.
7. **G13 before G12** — the portfolio empty-state composition needs `BrandEmptyState` to exist.
8. **G0 is a product gate, not an engineering gate** — mechanics proceed with A's local-first default; flipping it is a one-line, separately-signed decision (exactly how `main` handled it).

## 6. Implementation order (minimizes regressions)

Each phase ends at a green, shippable state (`npx tsc --noEmit` · `npx vitest run` · `npm run build` · load the touched pages — a green tsc alone is not proof pages render).

| Phase | Work | Contents | Regression logic |
|---|---|---|---|
| **0** | Safety net | Back up `data/app.db`; tag both tips; record baseline (`scripts/perf-baseline.mjs`) | Nothing to regress yet; creates the rollback and the measuring stick |
| **1** | Independent, disjoint wins | G14 engine (run `verify_engine_equivalence.py`), G15 dataset SWR, G16 A's portfolio engines + fixes (A4–A7), G13 brand (regenerate assets) | Zero-overlap changes first: they can't conflict, and their tests harden the base the risky work lands on |
| **2** | Schema union | G1 `lib/db.ts` (hand-review migration order) | Everything downstream reads these tables; do it once, verified, before any feature needs it |
| **3** | AI platform spine | G2 locality model → G3 router combination → G18 hosted-bypass test → G4 failure copy | The critical-risk zone, done in dependency order with the new test written *in the same phase* as the code it guards |
| **4** | AI-consuming surfaces | G5 (compare streaming, status badge, assistant), G6 new-positions restore, G9 watchlist digest | UI composed only after the copy/error contracts are final |
| **5** | Product surfaces | G7 table primitive → G8 watchlist rebuild → G10 simulator + multi-portfolio → G12 portfolio page compose | Large but low-conflict features, in their internal dependency order |
| **6** | Screener | G11: universe/asset union → stats/filter engine → page integration; load `/screener`, run screener suites | Isolated last because H4 is only detectable by rendering |
| **7** | Docs + truth pass | G17 doc merges (side-by-side records, ABANDONED banners) → G19 claims audit | Prose last, after the code it describes has stabilized |
| **8** | Product gate | G0: decide default provider order with calibration/cost sign-offs; one-line change + badge verification | Deliberately excluded from the mechanical merge — the one lesson `main`'s history teaches loudest |

**Rollback strategy per phase:** phases are cumulative but individually revertable (each is a small commit stack touching a disjoint area); the phase-0 DB backup covers the only non-git state.

---

## 7. Summary judgment

Repository A and Repository B are **complementary to a degree that is rare in divergent forks**: 382 of 400 touched paths are disjoint, and the recommendations above resolve to *Keep A* for the portfolio/watchlist/correctness axis, *Keep B* for the screener/engine/brand/AI-seam axis, *Combine* in exactly nine places, *Remove* nothing outright, and *Rewrite* nothing except a post-merge documentation-claims audit. The entire merge risk concentrates in one seam — AI routing — where both teams solved the same problem with mutually-invisible assumptions, and where the historical record proves the failure mode is a **clean, compiling, test-passing, wrong** auto-merge. The dependency graph and phase order above exist to make that seam the *most* scrutinized part of the merge instead of the least, and to keep the one genuine product decision (who runs inference by default) out of the diff and in front of a human.

---

*Evidence: `git diff 98500e1..{divit-local,origin/prisha-work}`, `git merge-tree --write-tree divit-local origin/prisha-work`, per-commit logs of both branches, the `6585052` merge-resolution record and its follow-ups (`cac4ddb`, `1e1a34b`, `4c67333`), and direct source inspection. See MERGE_SUMMARY.md §12–14 and CHANGE_MANIFEST.md Part C for the underlying per-file analysis. No source code was modified.*
