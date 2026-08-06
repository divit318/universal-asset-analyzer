# CHANGE_MANIFEST.md — Universal Asset Analyzer

**Prepared:** 2026-08-06 (updated after Tranche 5 landed; kept in lockstep with MERGE_SUMMARY.md)
**Version audited:** local `main` (`2be6ba1` + uncommitted working tree) vs baseline `origin/main` (`6585052`).
**Scope:** every meaningful change introduced in this version — **6 unpushed commits** (29 files, +1,388/−124), **24 uncommitted modified files** (+869/−122), and **14 untracked files** across 13 git-status paths (including this document and MERGE_SUMMARY.md).
**Verification at audit time:** `npx tsc --noEmit` clean; all delta-covering test files pass (`amfi`, `materiality`, `yahoo`, `format`, `verdict-warmer`, `ai-analysis-facade`, `portfolio-thesis`, `ai-compare`, `simulator-generate` — 143/143).
**Companion document:** `MERGE_SUMMARY.md` — same repository state, structured as a merge audit; it cites these changes as M#1–M#24.

Legend — **Risk level**: regression/merge risk of the change itself. **Rank**: importance to the product (Critical / High / Medium / Low). **Coexists**: whether the change can live alongside another implementation of the same concern. **Replaces**: whether it retires an older implementation.

---

## Index

| # | Change | Rank | Risk | State |
|---|--------|------|------|-------|
| 1 | Verdict generation migrated onto the analysis provider seam | Critical | Medium | Committed |
| 2 | Investment Verdict schema v2 (wire/parse split) | High | Medium | Committed |
| 3 | Verdict cache warmer (new background job) | High | Low | Committed |
| 4 | Devin API client speaks both API generations (v1 `apk_` / v3 `cog_`) | High | Medium | Committed |
| 5 | Legacy-key spike harness + evidence | Low | Low | Committed |
| 6 | `AI_PROVIDER=devin` flip on this machine + policy doc amendment | Medium | Medium | Committed (flip itself is machine-local) |
| 7 | Analysis-seam plumbing for Tranche 4 (`ollamaJsonMode`, loose parse schema, Devin timeouts) | Medium | Low | Committed (`ffb6d77`) |
| 8 | Home brief migrated onto the analysis seam | High | Medium | Committed (`ffb6d77`) |
| 9 | Portfolio thesis migrated onto the analysis seam | High | Medium | Committed (`ffb6d77`) |
| 10 | AI parity harness extended to migrated call sites | Low | Low | Committed (`ffb6d77`, `2be6ba1`) |
| 11 | Fund profile mapping rewrite (zero-as-missing, live AUM, currency/rating/inception) | Critical | Medium | Uncommitted |
| 12 | AMFI TER provider (new official data source for Indian mutual funds) | High | Low | Uncommitted (untracked) |
| 13 | Category-baseline fabrication fix + honest fund scoring labels | High | Low | Uncommitted |
| 14 | INR crore/lakh formatting in `formatCompactCurrency` | Medium | Low | Uncommitted |
| 15 | Indian mutual funds no longer routed to screener.in (`isIndiaEquity`) | High | Low | Uncommitted |
| 16 | Fund-shaped research masthead and stat strip | Medium | Low | Uncommitted |
| 17 | Fund profile & performance card upgrades | Medium | Low | Uncommitted |
| 18 | Fund prompt honesty (missing TER, currency-correct figures) | Medium | Low | Uncommitted |
| 19 | Display-name resolution on watchlist/portfolio writes + backfill script | Medium | Low | Uncommitted (script untracked) |
| 20 | Materiality lens framework (pure judgment engine + shared UI) | High | Low | Uncommitted (untracked) |
| 21 | Materiality lens on /research | Medium | Medium | Uncommitted |
| 22 | Materiality lens on /portfolio + `page_fingerprint` table | Medium | Medium | Uncommitted |
| 23 | Documentation: AGENTS.md product rules, India plans, YC materials | Low | Low | Mixed (ai-migration/docs committed; AGENTS.md uncommitted; plans untracked) |
| 24 | Compare (equity + class) and simulator migrated onto the analysis seam (Tranche 5) | High | Medium | Committed (`2be6ba1`) |

---

## AI platform changes

### 1. Verdict generation migrated onto the analysis provider seam

- **Description:** `generateVerdict()` no longer calls `runPrompt()` directly; it goes through `runAnalysis()` (the structured analysis seam), so `AI_PROVIDER` decides the transport — Devin sessions API with server-enforced structured output, or the local Ollama path. Both providers return the loose field bag that `assembleVerdict → coerceFields` narrows with plan-specific defaults (one defaulting implementation, two transports). A deliberate asymmetry preserves each path's pre-migration semantics: unparseable Ollama output assembles plan defaults; a Devin failure produces the offline fallback, which `cacheVerdict` refuses to persist (a session error must not pin a defaults verdict into a 6h cache). `getVerdict` passes a stable subject key from the cache params (symbol, not display name).
- **Reason:** Tranche 3 of the documented Ollama→Devin migration (`ai-migration/07-tranche3-verdict.md`): the research verdict is the highest-traffic AI call site and needed to run on the hosted provider without changing local-path behavior byte-for-byte.
- **Files changed:** `lib/ai/verdict.ts`, `tests/ai-analysis-facade.test.ts`, `ai-migration/07-tranche3-verdict.md`.
- **Dependencies:** `lib/ai/analysis.ts` / `analysis-provider.ts` (existing seam), change #2 (schemas), `lib/platform/data-layer.ts` (`aiVerdict` policy), `OllamaAnalysisError` categories.
- **Risk level:** Medium — center of the ongoing migration; the asymmetric failure semantics are subtle and could be flattened by a careless merge.
- **Coexists:** Yes — the seam is provider-agnostic by design; both transports remain live and selectable per task/env.
- **Replaces:** Yes — the direct `runPrompt(plan.task, …, {json:true})` call path inside verdict generation (the `parseVerdictFields` raw-string parse is no longer the primary path).
- **Improves:** AI ✅ · Reliability ✅ (schema enforced server-side on Devin; error taxonomy) · Maintainability ✅ (one seam for all structured calls) · UX — · Performance — (enables #3) · Accuracy —
- **Rank:** **Critical**

### 2. Investment Verdict schema v2 (wire/parse split)

- **Description:** `lib/ai/schemas/verdict.ts` rewritten to the movement-schema convention: `VerdictWireSchema` (constraint-carrying Zod, compiled to JSON Schema Draft-7 for Devin's `structured_output_schema`; headline-first emission order matching the streaming route; bullish/bearish/neutral verdict, enum confidence, 3–8 keyMetrics with signals) and `VerdictParseSchema` (deliberate pass-through record so plan-dependent defaulting stays solely in `coerceFields`). `VERDICT_SCHEMA_VERSION` bumped 1→2; the version participates in every cache/idempotency key, so v1 rows miss instead of being served as v2.
- **Reason:** v1 was the Phase-4 spike's BUY/HOLD/SELL shape; the production verdict UI renders a richer shape, and duplicating the coercion logic in a "tolerant" Zod schema would create the exact two-implementations drift AGENTS.md forbids.
- **Files changed:** `lib/ai/schemas/verdict.ts` (v1 shape relocated into `scripts/devin-spike-v1compat.ts`).
- **Dependencies:** Zod (`z.toJSONSchema`), change #1, platform cache keying.
- **Risk level:** Medium — a merge that alters the shape without bumping the version would serve stale cached rows as current; flagged as never-auto-merge in MERGE_SUMMARY.md.
- **Coexists:** Yes — versioned side-by-side with old cached rows (they simply expire unused).
- **Replaces:** Yes — schema v1.
- **Improves:** AI ✅ · Reliability ✅ (cache-poisoning prevented by versioning) · Maintainability ✅ · Accuracy ✅ (constraints force dossier-cited catalysts/risks) · UX — · Performance —
- **Rank:** **High**

### 3. Verdict cache warmer (new background job)

- **Description:** `lib/ai/verdict-warmer.ts`, started from `instrumentation.ts`: on an interval (`UAA_VERDICT_WARM_INTERVAL_MS`, default 6h = the `aiVerdict` fresh TTL; floor 15m; `0` disables), sweeps watchlist ∪ portfolio symbols and read-throughs `getVerdict`, writing exactly the rows the research route reads (no parallel cache). Two coded restraints: **Devin-only** (warming through the serializing local daemon would starve interactive users) and **un-personalized** (generic variant only). Never-overlapping ticks, HMR-idempotent (`Symbol.for` guard), worker pool bounded by `DEVIN_API_CONCURRENCY` (default 4), first sweep 90s after boot to avoid competing with the scanner warmup.
- **Reason:** Make the next research-page visit for symbols the user demonstrably cares about a cache hit (~0.04s) instead of a generation the user watches (tens of seconds); Devin sessions parallelize, so warming is nearly free in wall-clock.
- **Files changed:** `lib/ai/verdict-warmer.ts` (new), `instrumentation.ts`, `tests/verdict-warmer.test.ts` (new).
- **Dependencies:** Changes #1/#2, `lib/db.ts` (`listWatchlist`/`listPortfolio`), `lib/ai/context.ts`, `resolveProvider`, `peekVerdict`, scanner-scheduler pattern.
- **Risk level:** Low for correctness (no-op under Ollama; failures counted, never fatal). Note: consumes Devin ACUs on a schedule — a cost-behavior change, not a code risk.
- **Coexists:** Yes — sits beside the monitor and scanner schedulers; on-demand generation is unchanged.
- **Replaces:** No — purely additive.
- **Improves:** Performance ✅✅ (headline win) · UX ✅ (no spinner on warmed symbols) · Reliability — · AI — · Maintainability — · Accuracy —
- **Rank:** **High**

### 4. Devin API client speaks both API generations

- **Description:** `lib/ai/providers/devin/client.ts` now keys off the credential prefix: `cog_…` → v3 org-scoped API (full feature set: `structured_output_required`, `devin_mode`, `resumable`, ACU reporting); `apk_…` → legacy v1 personal-key API. v1 responses are translated into the v3 status vocabulary at the client edge (`blocked`→`running/waiting_for_user`, `finished`, `expired`→`exit`), v3-only create fields are stripped for v1 (they 422), the message endpoint's singular/plural naming and offset-vs-cursor pagination are handled, and the health check substitutes the smallest authenticated read for v1's missing identity endpoint. `DEVIN_ORG_ID` becomes optional for `apk_` keys; `devinConfigured()` and the config error message updated accordingly. Degraded v1 session lists (missing tags) make the sweeper a safe no-op rather than a hazard.
- **Reason:** The two machines this repo is developed on hold different key types; without v1 support one machine could not run the hosted path at all.
- **Files changed:** `lib/ai/providers/devin/client.ts`, `tests/ai-analysis-facade.test.ts`, `docs/devin-integration.md`.
- **Dependencies:** Empirically verified v1 API contract (`ai-migration/04b-spike-results-v1-key.md`); env `DEVIN_API_KEY` / `DEVIN_ORG_ID`.
- **Risk level:** Medium — rests on reverse-engineered v1 behavior that Devin could change; contained to one module and evidence-documented.
- **Coexists:** Yes — both generations behind one interface; the provider has exactly one lifecycle to reason about.
- **Replaces:** No — extends the existing v3-only client (v3 path byte-identical).
- **Improves:** Reliability ✅ (hosted path works on both machines) · AI ✅ · Maintainability ✅ (translation isolated at the edge) · UX — · Performance — (v1 measured slower: p50 33s vs 22s, accepted) · Accuracy —
- **Rank:** **High**

### 5. Legacy-key spike harness + evidence

- **Description:** `scripts/devin-spike-sessions.ts` renamed/extended to `scripts/devin-spike-v1compat.ts` (carries the retired schema-v1 shape and runs the v1-key compatibility probes); results written up in `ai-migration/04b-spike-results-v1-key.md` (5/5 first-attempt schema-valid, p50 33s, no ACU field on v1 GET).
- **Reason:** The migration's discipline is measured evidence before adoption; #4 is justified by this spike.
- **Files changed:** `scripts/devin-spike-v1compat.ts` (renamed from `devin-spike-sessions.ts`), `ai-migration/04b-spike-results-v1-key.md` (new).
- **Dependencies:** Live Devin API access with an `apk_` key.
- **Risk level:** Low — dev tooling, not on any runtime path.
- **Coexists:** Yes. **Replaces:** Yes — the earlier sessions spike script.
- **Improves:** Maintainability ✅ (documented contract) · Reliability ✅ (indirect) · others —
- **Rank:** **Low**

### 6. `AI_PROVIDER=devin` flip on this machine + policy doc amendment

- **Description:** `.env.local` (untracked, machine-local) now sets `AI_PROVIDER=devin`, making the hosted provider the default analysis transport on this machine; `docs/devin-integration.md`'s remaining "local-only" policy text amended to match. Interactive-latency tasks still stay on Ollama under the global flag per the router guardrail.
- **Reason:** Tranches 1–3 proved parity (15/15 both providers) and acceptable latency; the flip is the point of the migration.
- **Files changed:** `docs/devin-integration.md` (committed); `.env.local` (machine-local, never committed).
- **Dependencies:** #1–#4; Devin API availability and ACU budget.
- **Risk level:** Medium — split-brain across machines: any machine still defaulting to Ollama silently lacks warmed verdicts and hosted-quality output; behavior differences won't show in code review.
- **Coexists:** Yes — that is the design: the chain and per-task pins remain.
- **Replaces:** No — changes the default, removes nothing.
- **Improves:** AI ✅ (frontier-model output on migrated tasks) · UX ✅ · Performance ✅ (with #3) · Reliability — (adds a network dependency; offline fallback intact) · others —
- **Rank:** **Medium**

### 7. Analysis-seam plumbing for Tranche 4

- **Description:** Three small seam extensions enabling #8/#9: (a) `AnalysisRequest.ollamaJsonMode` — Ollama-adapter-only flag to *not* request grammar-constrained JSON, preserving the home brief's historical unconstrained-generation quirk ("the Ollama path is byte-identical" is the migration discipline); (b) `lib/ai/schemas/loose.ts` — shared `LooseObjectSchema` pass-through parse view for call sites whose coercion deliberately stays in feature code; (c) `devinTimeoutMs: 240_000` on `daily-briefing` and `portfolio-intelligence` in the task registry (tail-based sizing; the thesis dossier is the largest prompt in its class).
- **Reason:** Migrating call sites without changing local-path behavior requires the seam to express their historical quirks rather than silently "fixing" them.
- **Files changed:** `lib/ai/analysis-provider.ts`, `lib/ai/providers/ollama-analysis.ts`, `lib/ai/task-registry.ts`, `lib/ai/schemas/loose.ts` (new).
- **Dependencies:** Existing analysis seam; consumed by #8/#9 (and the loose parse schema reused by #24).
- **Risk level:** Low — defaulted flags; no behavior change for existing callers.
- **Coexists:** Yes. **Replaces:** No.
- **Improves:** Maintainability ✅ (one shared passthrough instead of N copies) · Reliability ✅ (timeouts sized to measured tails) · AI ✅ · others —
- **Rank:** **Medium**

### 8. Home brief migrated onto the analysis seam

- **Description:** `lib/home/brief.ts#generateHomeBrief` now calls `runAnalysis` with a new `HomeBriefWireSchema` (v1: `{headline, note (nullable), portfolioSummary}`; nullable note because the pre-migration parser treated a missing note as "no long-form note today" — requiring it would force the model to pad) and the shared loose parse view; `ollamaJsonMode:false` preserves the call site's historical unconstrained local generation. All parse tolerance (`str()`/`readNote`/grounding gate) stays in feature code; an unparseable local response now throws into the same deterministic fallback it previously reached via empty-headline. Prompt builder exported for the parity harness.
- **Reason:** Tranche 4 — the homepage's daily brief is user-visible AI quality; the hosted path enforces the shape server-side while the local path remains behavior-identical.
- **Files changed:** `lib/home/brief.ts`, `lib/ai/schemas/home-brief.ts` (new), `lib/ai/task-registry.ts` (via #7), `ai-migration/08-tranche4-thesis-brief.md` (shared Tranche-4 report).
- **Dependencies:** #7; `verifyGrounding`; `scanner_cache` (existing brief caching unchanged).
- **Risk level:** Medium — the fallback-equivalence argument (throw vs empty-headline both → fallback) is correct but load-bearing.
- **Coexists:** Yes — deterministic fallback brief remains the offline path.
- **Replaces:** Yes — the `runPrompt` + `extractJsonObject` pair at this call site.
- **Improves:** AI ✅ · Reliability ✅ (server-side schema on Devin) · Maintainability ✅ · UX — (same surface) · Performance — · Accuracy —
- **Rank:** **High**

### 9. Portfolio thesis migrated onto the analysis seam

- **Description:** `lib/portfolio/thesis.ts#buildPortfolioThesis` now calls `runAnalysis` with `PortfolioThesisWireSchema` (v1: thesis, identity tags, strengths/risks that must cite a specific number or holding, `bearCase` explicitly allowing `""` so the wire schema cannot convert honesty into fabrication, mustBeTrue) and the loose parse view; all coercion stays in `cleanString`/`cleanList` + per-field fallbacks. No seam-level `maxAgeMs`: the existing content-hash `scanner_cache` short-circuit remains the feature's freshness policy (a second cache layer would fight it). Subject key = portfolio content hash. Prompt builder exported for the parity harness.
- **Reason:** Tranche 4 — the thesis card sits beside code-computed `ESTABLISHED CONCLUSIONS` and ground-truth verdict tagging; hosted-model quality materially improves the one job left to the model (synthesis).
- **Files changed:** `lib/portfolio/thesis.ts`, `lib/ai/schemas/portfolio-thesis.ts` (new), `lib/ai/task-registry.ts` (via #7), `ai-migration/08-tranche4-thesis-brief.md` (shared Tranche-4 report).
- **Dependencies:** #7; `groundTruthVerdicts`/`resolveSectionConflicts` (unchanged); `scanner_cache`.
- **Risk level:** Medium — same fallback-equivalence subtlety as #8; interacts with the content-hash cache-version rule documented in AGENTS.md.
- **Coexists:** Yes. **Replaces:** Yes — the `runPrompt` + `extractJsonObject` pair at this call site.
- **Improves:** AI ✅ · Reliability ✅ · Maintainability ✅ · Accuracy ✅ (schema demands number-citing bullets) · UX — · Performance —
- **Rank:** **High**

### 10. AI parity harness extended to migrated call sites

- **Description:** `scripts/ai-parity.ts` gained subjects that run the *exact production prompts* — Tranche 4: `buildThesisPrompt` over the real portfolio report and `buildHomeBriefPrompt` over real mission-control context (no synthetic portfolios, because "fabricating holdings would test a dossier no user can produce"); Tranche 5: equity compare, class compare, and the simulator's two structured stages — diffing both providers field-by-field under the new wire schemas.
- **Reason:** The migration's acceptance gate is measured provider parity per call site, not code review alone.
- **Files changed:** `scripts/ai-parity.ts` (Tranche-4 extension in `ffb6d77`, Tranche-5 extension in `2be6ba1`).
- **Dependencies:** #7–#9, #24; live providers.
- **Risk level:** Low — dev harness.
- **Coexists:** Yes. **Replaces:** No.
- **Improves:** Reliability ✅ (regression detection) · Maintainability ✅ · others —
- **Rank:** **Low**

### 24. Compare (equity + class) and simulator migrated onto the analysis seam (Tranche 5)

- **Description:** Three more call sites move from `runPrompt` to `runAnalysis()` (commit `2be6ba1`). **Equity compare** (`lib/ai-compare.ts`) reuses `flatFromStreamedFields` so the blocking, streamed, and seam paths converge on one shape. **Class compare** (`lib/compare/class-ai-compare.ts`) carries the per-class `keyQuestions` contract on the wire. The **simulator's** two structured stages (`lib/portfolio/simulator/generate.ts`) get wire schemas, and `parseSelectionResponse` splits into a bag-shaped worker so mandate enforcement exists exactly once. New wire schemas (`lib/ai/schemas/comparison.ts`, `lib/ai/schemas/simulator.ts`, both v1) constrain **shape, not policy** — deterministic guards (`normalizeAllocation`, symbol back-filling via `normalizeRankings`) stay downstream, `noClearWinner` accepts boolean *or* `"true"/"false"` strings (a stricter wire would forbid Devin a quirk the app already tolerates), and ranking symbols are deliberately not enum-constrained (one bad symbol must not cost the whole comparison). `classifyAiError` (`lib/ai/errors.ts`) now maps `DevinAnalysisError.category` onto `AiErrorCategory` — duck-typed to avoid an import cycle — so Compare's `aiStatus` copy stays truthful and cancellation still rethrows. `portfolio-construction` stays guardrailed to the local token stack (interactive latency) with the wire ready for pins; task registry declares `devinTimeoutMs` 300s for compare (largest dossiers in the standard tier) and 240s for the simulator when pinned. Notably, the parity gate ran **in reverse**: token-stack outputs tripped three wire caps stricter than observed legitimate behavior, so the *wire* was relaxed (strengths ≤6, `why` min 1) rather than the models constrained.
- **Reason:** Tranche 5 of the migration — Compare's verdict and the Simulator's book generation are among the most judgment-heavy AI surfaces; the hosted path materially improves them while local behavior stays byte-identical.
- **Files changed:** `lib/ai-compare.ts`, `lib/compare/class-ai-compare.ts`, `lib/portfolio/simulator/generate.ts`, `lib/ai/schemas/comparison.ts` (new), `lib/ai/schemas/simulator.ts` (new), `lib/ai/errors.ts`, `lib/ai/task-registry.ts`, `scripts/ai-parity.ts`, `ai-migration/09-tranche5-compare-simulator.md` (new).
- **Dependencies:** #7 (loose parse schema, seam surface); `flatFromStreamedFields`; existing deterministic normalizers; live providers for the parity evidence.
- **Risk level:** Medium — same fallback-equivalence discipline as #8/#9 across three call sites; the error-category duck-typing depends on `DevinAnalysisError`'s field names staying stable.
- **Coexists:** Yes — both providers remain live per task; streamed and blocking compare paths coexist by design (converged on one shape).
- **Replaces:** Yes — the `runPrompt` + manual-parse pairs at these three call sites.
- **Improves:** AI ✅ · Reliability ✅ (truthful error copy, server-side schema) · Maintainability ✅ (one shape across three compare paths; mandate enforcement in one place) · Accuracy ✅ (measured parity: identical ranking *and* confidence — NVDA>MSFT>AAPL at 82 — across providers; simulator allocations within ±5pp, both inside mandate) · UX — · Performance —
- **Rank:** **High**

---

## Data-accuracy changes (Indian mutual funds / fund research)

### 11. Fund profile mapping rewrite (zero-as-missing, live AUM, currency/rating/inception)

- **Description:** `buildFundProfile` split into a pure, exported `mapFundProfile()` plus a thin fetch wrapper; the quoteSummary request adds `defaultKeyStatistics`, `summaryDetail`, `price`. Semantics fixed: (a) `zeroAsMissing` — Yahoo encodes "not reported" as literal `0` for expense ratio/turnover/AUM (every Indian mutual fund; verified that genuinely-zero-fee Fidelity ZERO funds never report 0), so zeros become `null`; (b) AUM sourced from `summaryDetail.totalAssets` (raw currency units, live) instead of `fundProfile`'s millions figure (observed ~$300B stale for SPY), with layered fallbacks; (c) new fields `currency`, `morningstarRating`, `inceptionDate`, `expenseRatioSource`; (d) category fallback via `fundPerformance.fundCategoryName`. The `fundProfile` dataset cache key is bumped to `v: 3` so persisted rows carrying the old wrong numbers miss instead of being served. Same zero-as-missing rule applied to the fund screener universe so an unknown-fee fund can't rank as the cheapest in the universe. `Quote` gains optional `netAssets`/`ytdReturn` (backward-compatible deserialization).
- **Reason:** Taken at face value, Yahoo's zero-encoding rendered "0.00% expense ratio" as a *strength* and scored a perfect Cost factor — a scoring layer rewarding missing data is the most dangerous failure class in the product.
- **Files changed:** `lib/yahoo.ts`, `lib/types.ts`, `lib/screener/universes/fund-shared.ts`, `tests/yahoo.test.ts`.
- **Dependencies:** yahoo-finance2 quoteSummary modules; platform data layer (cache re-keying); consumed by #12, #13, #16–#18.
- **Risk level:** Medium — large rewrite of a shared mapping; mitigated by the pure-function extraction and 113 lines of new mapping tests; cache bump prevents stale-row bleed.
- **Coexists:** No — it *is* the fund mapping; two mappings for one dataset would reintroduce the drift.
- **Replaces:** Yes — the previous inline mapping (including its `×1e6` AUM conversion and face-value zero handling).
- **Improves:** Accuracy ✅✅ (headline win) · Reliability ✅ (null-honesty downstream) · Maintainability ✅ (pure + tested) · AI ✅ (honest prompt inputs) · UX ✅ (correct figures) · Performance —
- **Rank:** **Critical**

### 12. AMFI TER provider (new official data source)

- **Description:** New `lib/amfi.ts`: fetches AMFI's official monthly scheme-level Total Expense Ratio table per AMC (endpoints verified live), matches Yahoo fund names onto AMFI schemes via a curated 56-AMC regex map (word-boundary-safe) with Regular/Direct plan detection, dedupes to latest `TER_Date`. Every public function returns `null` on failure — an AMFI outage degrades to "expense ratio unavailable", never a broken profile. Wired into `buildFundProfile` for INR funds with no Yahoo TER; result badged with provenance (`expenseRatioSource: "amfi"`). New `amfiTer` dataset policy (3d TTL / 7d SWR, persisted, keyed per AMC so one ~1.5MB fetch covers a whole fund house; declared dependent of `fundProfile`) and new `"amfi"` `DataSourceId`.
- **Reason:** Yahoo/Morningstar carries no TER for Indian mutual funds at all; AMFI is the industry body and the only authoritative source, and expense ratio is a core input to the fund Cost factor.
- **Files changed:** `lib/amfi.ts` (new), `lib/platform/registry.ts`, `lib/platform/types.ts`, `lib/provenance.ts`, `lib/yahoo.ts` (enrichment hook), `tests/amfi.test.ts` (new).
- **Dependencies:** amfiindia.com API (unofficial-but-public endpoints); platform data layer; #11 (nulled zeros create the gap this fills).
- **Risk level:** Low — best-effort by construction; the AMC id map needs occasional curation (~1 new AMC/year).
- **Coexists:** Yes — a fallback source layered behind Yahoo, with explicit provenance.
- **Replaces:** No — additive.
- **Improves:** Accuracy ✅✅ · Reliability ✅ (graceful degradation) · UX ✅ (real TER + provenance badge) · AI ✅ (real fee in prompts) · Performance ✅ (per-AMC amortization) · Maintainability —
- **Rank:** **High**

### 13. Category-baseline fabrication fix + honest fund scoring labels

- **Description:** Yahoo pads missing Morningstar category baselines with zeros (`trailingReturnsCat` all-zero for every Indian mutual fund); diffing against that fabricated "+10.3pp vs category" from a fund's own absolute return. `mapFundProfile` now rejects all-zero baselines (`catAvailable` gate). `lib/fund-scoring.ts` labels every signal with its basis — "1-year return vs category" vs "1-year return … (absolute)" — extends the same fallback to the 3-year signal with absolute-appropriate bands (−5…18 vs relative −6…6), and the composite rationale states "absolute performance — no category baseline available" when applicable.
- **Reason:** An absolute number presented as a category edge is precisely the fabrication the scoring layer exists to prevent; unlabeled fallbacks are indistinguishable from claims.
- **Files changed:** `lib/yahoo.ts` (gate), `lib/fund-scoring.ts`, `app/research/fund/_components/fund-performance-card.tsx` (see #17).
- **Dependencies:** #11.
- **Risk level:** Low — but note fund composite scores shift for funds without baselines (screener ranks, cached verdicts citing the score regenerate under the new keys).
- **Coexists:** No — replaces the scoring behavior for the no-baseline case.
- **Replaces:** Yes — the silent absolute-as-relative fallback.
- **Improves:** Accuracy ✅✅ · UX ✅ (honest labels) · AI ✅ · Reliability — · Maintainability — · Performance —
- **Rank:** **High**

### 14. INR crore/lakh formatting in `formatCompactCurrency`

- **Description:** INR amounts now render in Indian units with Indian digit grouping — "₹3,626.2 Cr", "₹19,94,000 Cr", "₹2.5 L" — instead of "₹36.26B"; matches screener.in/AMFI/every Indian filing, and mirrors `lib/ic/format.ts`'s IC-scoped convention app-wide. Non-INR behavior unchanged; unit tests added.
- **Reason:** Western B/T units for INR figures read as foreign to the numbers' own ecosystem and invite misreading by ~an order of magnitude against local sources.
- **Files changed:** `lib/format.ts`, `tests/format.test.ts`.
- **Dependencies:** `toLocaleString("en-IN")`; consumed everywhere `formatCompactCurrency` renders INR.
- **Risk level:** Low.
- **Coexists:** Yes — coexists with `lib/ic/format.ts`'s branded IC formatter (documented as the app-wide counterpart, not a duplicate).
- **Replaces:** Yes — the K/M/B/T rendering for INR only.
- **Improves:** UX ✅ · Accuracy ✅ (matches sources of record) · others —
- **Rank:** **Medium**

### 15. Indian mutual funds no longer routed to screener.in (`isIndiaEquity`)

- **Description:** `app/research/page.tsx` introduces `isIndiaEquity = isIndia && isEquity` and re-keys every India-specific module (screener.in fetch, conviction source, valuation insight, financial overlays, shareholding, peer table, loading lines, verdict score/confidence overrides) off it instead of `isIndia`.
- **Reason:** screener.in covers listed Indian *companies* only; an Indian mutual fund's Morningstar `0P….BO` symbol fuzzy-matched a random company and rendered its equity snapshot on a fund page — silently wrong data on a research surface.
- **Files changed:** `app/research/page.tsx` (~15 call sites).
- **Dependencies:** `detectAssetClass` / `quote.assetType`.
- **Risk level:** Low — a narrowing guard; Indian equities unaffected.
- **Coexists:** N/A (guard). **Replaces:** Yes — the too-broad `isIndia` gating.
- **Improves:** Accuracy ✅✅ · Reliability ✅ · UX ✅ · others —
- **Rank:** **High**

### 16. Fund-shaped research masthead and stat strip

- **Description:** The research stat strip now describes what the instrument *is*: mutual funds show Net assets (plan) / YTD return / P/E (holdings) / 52-week range / Previous NAV / Exchange (NAV-priced pools have no market cap, intraday range, or volume — dashes read as broken data); ETFs lead with AUM but keep range/volume; equities format market cap in the **listing currency** (a hardcoded "$" mislabeled every Indian/Japanese/European name). The masthead leads with the fund **name** for mutual funds, demoting the opaque Morningstar ID to a small mono suffix; ticker-first is unchanged for everything with a real ticker.
- **Reason:** A fund page dominated by "—" and an unmemorable ID reads as broken; labels like "P/E (holdings)" and "Net assets (plan)" stop honest figures being misread (plan-level AUM is ~10x below scheme-level; verified HDFC Large Cap ₹3.6k Cr vs ₹38k Cr).
- **Files changed:** `app/research/page.tsx`.
- **Dependencies:** #11 (`netAssets`/`ytdReturn`/`currency`), #14.
- **Risk level:** Low — presentation branching.
- **Coexists:** Yes — three-way branch beside the equity strip. **Replaces:** Yes — the one-size-fits-all strip for funds.
- **Improves:** UX ✅✅ · Accuracy ✅ (labels carry the caveats) · others —
- **Rank:** **Medium**

### 17. Fund profile & performance card upgrades

- **Description:** Profile card: adds currency-correct Total net assets with a "(this plan)" label when per-share-class (`perShareClass` prop), AMFI provenance badge on the expense ratio ("1.62% · AMFI"), Morningstar star rating, inception date; row order re-ranked. Performance card: titles itself "Performance" (not "vs Category") when no baseline exists and explains why, instead of rendering two dashes under a false heading.
- **Reason:** Figures with different provenance or different denominators must say so on the card, or the honest number misleads.
- **Files changed:** `app/research/fund/_components/fund-profile-card.tsx`, `app/research/fund/_components/fund-performance-card.tsx`, `app/research/page.tsx` (prop threading).
- **Dependencies:** #11–#13.
- **Risk level:** Low.
- **Coexists:** Yes. **Replaces:** Yes — the previous card contents (hardcoded `$`, unlabeled figures).
- **Improves:** UX ✅ · Accuracy ✅ · others —
- **Rank:** **Medium**

### 18. Fund prompt honesty (missing TER, currency-correct figures)

- **Description:** Fund verdict and fund-research prompts replace "Expense ratio: n/a" with "not reported by our data source — do NOT assume it is zero or low" (an unqualified "n/a" reads as "free" to a model told the fund is an index-style pool), and format net assets with `formatCompactCurrency(value, fund.currency)` instead of a hardcoded `$…B`.
- **Reason:** Stops the model inventing fee claims and mislabeling INR figures by the FX rate — the AI layer must receive the same honesty the UI renders.
- **Files changed:** `lib/ai/verdict.ts` (`planFundVerdict`), `lib/ai-fund-research.ts`.
- **Dependencies:** #11, #14.
- **Risk level:** Low.
- **Coexists:** Yes. **Replaces:** Yes — the prior prompt lines.
- **Improves:** AI ✅ · Accuracy ✅ · Reliability ✅ (fewer fabrications) · others —
- **Rank:** **Medium**

### 19. Display-name resolution on watchlist/portfolio writes + backfill script

- **Description:** New `lib/yahoo.ts#resolveDisplayName(symbol, provided?)` — one cached quote lookup resolves a real display name; best-effort (offline degrades to the symbol). `/api/watchlist` and `/api/portfolio` POST use it when the caller has no name (command-palette quick-add POSTs `{symbol}` alone), so an Indian mutual fund no longer persists "0P0001BA9B.BO" as its *name* on every later read. `app/journal/page.tsx` drops a dead `shortName` preference (never returned by `/api/quote`; would have shown Morningstar IDs had it resolved). One-off `scripts/backfill-display-names.ts` repairs pre-fix rows (dry-run default, `--apply` to write; only touches rows whose name equals the symbol; never overwrites a user-typed name; idempotent).
- **Reason:** Names are read far more often than written; fixing the write path plus a safe backfill removes the ID-as-name class permanently.
- **Files changed:** `lib/yahoo.ts`, `app/api/watchlist/route.ts`, `app/api/portfolio/route.ts`, `app/journal/page.tsx`, `scripts/backfill-display-names.ts` (new).
- **Dependencies:** `getQuote` (platform-cached); DB write paths.
- **Risk level:** Low — adds one usually-cached lookup to two write endpoints; the script mutates the DB but is dry-run-first and idempotent (run once per machine, post-merge).
- **Coexists:** Yes. **Replaces:** Yes — the `body.name?.trim() || symbol` defaulting.
- **Improves:** UX ✅ · Accuracy ✅ · Reliability ✅ (offline-safe fallback) · others —
- **Rank:** **Medium**

---

## Materiality lens (new feature)

### 20. Materiality lens framework (pure judgment engine + shared UI)

- **Description:** New `lib/materiality.ts`: a single pure `isMaterial(item, context)` function behind every flag — item kinds: peer-group dimension percentiles (refuses to claim extremes off tiny peer groups), risk levels, data freshness, timeline changes since last visit, concentration breaches, holding-score tier crossings. Verdicts are **three-state**: material / not material / **not applicable** — a bank with a null P/E is unscoreable, not "boring", and fading it would present missing data as examined-and-fine. Client-safe, no I/O, callers pass `now`; imports only the canonical recommendation bands. New shared component `app/_components/materiality-lens.tsx`: `LensControl` ("N flagged" pill computed on load, advertising signal before any interaction), `MaterialFade` (opacity fade with hover reason), `useMaterialityLens` (`d` toggles, Esc clears; keyboard handler yields to typing surfaces and *visible* dialogs — the AI dock keeps a hidden `role="dialog"` permanently mounted, so visibility is checked, not presence). Per-page component state; not persisted.
- **Reason:** Pages accumulated dozens of panels; the user's question is "what here deserves my attention *now*?" Routing every judgment through one tested function keeps the header count, the fade state, and the hover reason from ever disagreeing.
- **Files changed:** `lib/materiality.ts` (new), `app/_components/materiality-lens.tsx` (new), `tests/materiality.test.ts` (new).
- **Dependencies:** `lib/recommendation.ts` (tier edges); consumed by #21/#22.
- **Risk level:** Low — pure and unit-tested; UI is additive.
- **Coexists:** Yes — deliberately coexists with the Home page's separate materiality filtering (`lib/home/changes.ts`), whose two-slot fingerprint design it borrows.
- **Replaces:** No — new capability.
- **Improves:** UX ✅✅ · Maintainability ✅ (one judgment function) · Accuracy ✅ (three-state honesty) · others —
- **Rank:** **High**

### 21. Materiality lens on /research

- **Description:** Lens control in the masthead action row. Flags computed once per symbol from data the page already fetches plus two async server inputs — `GET /api/materiality/research` (new route: peer-group percentiles for 7 headline metrics from the *same* Screener universe stats, honestly `null` when the symbol isn't in the cached equity universe; plus prior-visit timestamp) and the symbol timeline (now fetched at page load so the count can say "changed since your last visit" before any tab opens; `TimelinePreviewCard` gains `initialEvents` and reuses those events instead of re-fetching). `MaterialFade` wraps conviction breakdown, score card, earnings card, provenance rows, analyst card, risk heat map (per-tile fading via new `lensActive` prop, routed through the same `isMaterial` so a tile can never disagree with the header), SEC filings, timeline preview. `GET` handler added to `/api/home/activity` (`getActivityAt`), read before the visit's debounced POST lands so it reports the *previous* visit.
- **Reason:** The research page is the densest surface in the app; the lens answers "what changed / what's extreme / what's stale" without hiding anything or re-deriving judgments locally.
- **Files changed:** `app/research/page.tsx`, `app/research/_components/risk-heatmap.tsx`, `app/research/_components/timeline-preview-card.tsx`, `app/api/materiality/research/route.ts` (new), `app/api/home/activity/route.ts`, `lib/db.ts` (`getActivityAt`).
- **Dependencies:** #20; `lib/screener/universe-stats.ts`; `activity` table; `/api/timeline`.
- **Risk level:** Medium — threads through the app's largest page (a top merge-conflict file); logic itself is additive and fail-soft (fetch failures leave the lens at zero flags).
- **Coexists:** Yes. **Replaces:** No (the timeline card's self-fetch remains for callers without pre-fetched events).
- **Improves:** UX ✅✅ · Performance ✅ (timeline dedupe) · Accuracy ✅ (screener-consistent percentiles, no invented cutoffs) · others —
- **Rank:** **Medium**

### 22. Materiality lens on /portfolio + `page_fingerprint` table

- **Description:** Lens control in the header; fades stat tiles and dashboard panels (allocation inherits the concentration verdict so it stays crisp when a breach exists); holdings panel fades under the tier-crossing verdict; a "tier change" callout list renders while the lens is on; concentration rows carry hover reasons. Baseline exchange: the client POSTs the per-symbol holding scores it just rendered to new `POST /api/materiality/portfolio`, which returns the previous visit's scores and stores the new ones — nothing rebuilt server-side; one exchange per report build (keyed on `generatedAt`); **Main portfolio only** (a view-only portfolio must not overwrite Main's baseline). Storage: new SQLite `page_fingerprint` table (`page`,`slot∈{current,baseline}`,`data`,`taken_at`; PK (page,slot)) with the same two-slot visit-gap promotion semantics as `home_fingerprint` — reloading within one sitting keeps comparing against the previous *visit*. Created via `CREATE TABLE IF NOT EXISTS`; no migration needed. New `get/putPageFingerprint` in `lib/db.ts`.
- **Reason:** "Did any holding's score cross a tier since I last looked?" is the portfolio-page version of the lens question, and it needs a durable per-page baseline the client can't fake.
- **Files changed:** `app/portfolio/page.tsx`, `app/api/materiality/portfolio/route.ts` (new), `lib/db.ts` (DDL + accessors).
- **Dependencies:** #20; `VISIT_GAP_MS` from `lib/home/changes.ts`; portfolio report pipeline.
- **Risk level:** Medium — additive schema (safe) but threads through another high-churn page; DDL block in `lib/db.ts` is a standing conflict point.
- **Coexists:** Yes. **Replaces:** No.
- **Improves:** UX ✅✅ · Accuracy ✅ · Performance — (one small POST per report) · others —
- **Rank:** **Medium**

---

## Documentation

### 23. AGENTS.md product rules, India plans, YC materials

- **Description:** AGENTS.md gains a "Product Rules Learned The Hard Way" entry documenting the entire Yahoo fund-feed zero-encoding failure class and the verified unit/staleness conventions (§11–§13's institutional memory). New untracked planning docs: `INDIA_GAP_ANALYSIS.md` (52KB gap audit), `INDIA_IMPLEMENTATION_PLAN.md`, `YC_DEMO_SCRIPT.md`, `YC_MASTER_PROMPT.md`. Committed: `ai-migration/04b`, `ai-migration/07`, `ai-migration/08` and `ai-migration/09` phase reports; `docs/devin-integration.md` policy amendment.
- **Reason:** The repo's convention is that hard-won data-source behavior is written where the next agent reads first; the migration keeps a phase-by-phase decision log.
- **Files changed:** `AGENTS.md`, `ai-migration/04b-spike-results-v1-key.md`, `ai-migration/07-tranche3-verdict.md`, `ai-migration/08-tranche4-thesis-brief.md`, `ai-migration/09-tranche5-compare-simulator.md`, `docs/devin-integration.md`, `INDIA_GAP_ANALYSIS.md`, `INDIA_IMPLEMENTATION_PLAN.md`, `YC_DEMO_SCRIPT.md`, `YC_MASTER_PROMPT.md`.
- **Dependencies:** None.
- **Risk level:** Low (AGENTS.md is append-prone in merges — union-merge produces contradictory guidance; merge by reading).
- **Coexists:** Yes. **Replaces:** Partially — amends the local-only policy text.
- **Improves:** Maintainability ✅✅ · others —
- **Rank:** **Low**

---

## Cross-cutting observations

- **No new dependencies** were introduced by any change (`package.json`/`package-lock.json`/`requirements.txt` untouched); AMFI uses plain `fetch`, schemas use the existing Zod, the lens is dependency-free.
- **One DB schema change** (#22, additive `page_fingerprint`); several **cache-version bumps/introductions** that function as schema changes for cached data: `VERDICT_SCHEMA_VERSION` 2 (#2), `fundProfile` `v:3` (#11), and new versioned keys `HOME_BRIEF_SCHEMA_VERSION` 1 / `PORTFOLIO_THESIS_SCHEMA_VERSION` 1 (#8/#9) and `COMPARISON_SCHEMA_VERSION` 1 / `SIMULATOR_SCHEMA_VERSION` 1 (#24).
- **Environment surface changes:** new `UAA_VERDICT_WARM_INTERVAL_MS` (#3, not yet in `.env.example`); `DEVIN_API_KEY` accepts `apk_` keys with `DEVIN_ORG_ID` optional (#4); `AI_PROVIDER=devin` flipped machine-locally (#6); `DEVIN_API_CONCURRENCY` reused by the warmer (#3).
- **Atomicity requirement:** the uncommitted changes and untracked files are one unit — tracked, modified files (`app/research/page.tsx`, `app/portfolio/page.tsx`, `lib/db.ts`, `lib/yahoo.ts`) import untracked files (`lib/materiality.ts`, `lib/amfi.ts`, `app/_components/materiality-lens.tsx`, `app/api/materiality/*`). Committing the former without the latter breaks the build. (Tranche 4's schema files — `lib/ai/schemas/{loose,home-brief,portfolio-thesis}.ts` — were in the same position until `ffb6d77` committed them; the fund/lens work should follow the same path.)
- **Two changes carry real-world side effects beyond code:** #3 (scheduled Devin ACU consumption) and #19's backfill script (DB writes; dry-run first, once per machine).
