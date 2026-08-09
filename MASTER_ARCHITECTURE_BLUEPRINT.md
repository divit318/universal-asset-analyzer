# MASTER_ARCHITECTURE_BLUEPRINT.md

**Phase 0 deliverable.** Master implementation reference for seven institutional-intelligence systems: Explain Every Movement, Sector Rotation Engine, Portfolio Decision Engine, Watchlist Intelligence, Portfolio Stress Testing, Market Dashboard, AI Portfolio Manager.

**Method**: Serena symbol-level audit of `lib/`, `app/portfolio/_components/`, `app/scanner/_components/`, `app/api/`. `graphify-out/` had no built graph (only a stale `cache/` dir) — dependency claims below come from `find_referencing_symbols`, not a graph query. Design only; no code changes in this document.

**Headline finding**: this is not a 7-system greenfield build. Three of the seven systems already exist in production. Two more exist as narrower, single-purpose versions that need generalizing. Only one system — Sector Rotation — is genuinely net-new. Building all seven from scratch as literally requested would duplicate live, working business logic and violate the project's own single-source-of-truth rule (AGENTS.md §4, CLAUDE.md "Avoid Duplication").

---

## 1. Repository Audit

| System requested | Status | Evidence |
|---|---|---|
| Portfolio Decision Engine | **Exists** | `lib/portfolio-analytics.ts`: `classifyAction`, `computeRecommendations`, `PortfolioAction` (Buy More/Hold/Reduce/Exit/Monitor/Replace), `buildReasoningText`, `buildRisks`, `buildCatalysts`, `buildKeyMetrics`. UI: `app/portfolio/_components/position-recommendations.tsx` (`ACTION_STYLE`, `ConfidenceBar`, `AllocationBar`, `RecommendationDrawer`). |
| Portfolio Stress Testing | **Exists** | `lib/portfolio-analytics.ts`: `computeScenarios`, `SCENARIOS`, `ScenarioImpact`. UI: `app/portfolio/_components/risk-panel.tsx` (`ScenarioAnalysis`, `ScenarioBar`). Confirmed live in Intelligence tab ("What's my worst case?", accordion default-open per prior session). |
| AI Portfolio Manager | **Exists (partial)** | `app/portfolio/_components/cio-panel.tsx` (`CIOPanel`, streaming `AuditState`) + `/api/portfolio/audit` + `/api/portfolio/invest` + `/api/ai/portfolio-brief` (health/grade/action-aware daily brief) + `/api/ai/deep`. Missing: orchestration across Sector Rotation and a generalized Movement Explainer (neither exists yet to orchestrate). |
| Explain Every Movement | **Exists, scoped narrowly** | `lib/scanner/causal-engine.ts` (`buildCausalChains`), `lib/scanner/thesis-builder.ts` (`buildTheses`), `lib/scanner/company-impact.ts`, `lib/scanner/sector-impact.ts` (`analyzeSectorImpacts`), orchestrated by `lib/scanner/index.ts` (`runScannerPipeline`, `assessMarketRegime`, `detectEmergingThemes`, `extractRiskAlerts`). This is a real, AI-driven "why is this happening" pipeline — but it is private to Scanner's event-detection flow. It cannot currently be called on-demand for an arbitrary symbol from Research, a holding from Portfolio, or a ticker from Watchlist. |
| Sector Rotation Engine | **Does not exist** | `lib/sector.ts` is an 11-line static classifier (`sectorGroup()` → financials/utilities/reits/default, used for UI color-coding only). `sector-impact.ts` analyzes sector impact of one already-detected news event, ad hoc — no time-series, no rolling relative strength, no leadership tracking, no persistence. `app/scanner/_components/sector-rotation-grid.tsx` renders `result.sectorImpacts` from a single scan run, not a tracked-over-time rotation. |
| Watchlist Intelligence | **Exists, narrower than spec** | `lib/ai-watchlist.ts`: `generateWatchlistDigest(items, portfolioContext)` produces one narrative digest, marks `[IN PORTFOLIO]` items, is portfolio-context-aware. Missing: structured per-asset alerts (severity/type, like `SmartAlerts` has for portfolio), and no auto-promotion pipeline into Opportunity Engine. |
| Market Dashboard | **Exists, thin** | `app/page.tsx` + `app/_components/daily-pulse.tsx`. `PulseData` = `{ portfolio, watchlist, nextEvent }` only. No sector leadership, no capital flows, no market regime synthesis, no top-opportunities roll-up. |

**Adjacent infrastructure already in place and directly reusable**:
- `lib/opportunity-engine.ts` (bull/bear case, conviction, category derivation, `buildOpportunityProfile`) + `lib/scanner/opportunity-scorer.ts` (`scoreOpportunities`, `scoreToVerdict`, `segmentOpportunities`, `computeMomentumScore`) + `computeOpportunities`/`OpportunityRank` in `portfolio-analytics.ts` + `opportunity-ranking.tsx` UI — one opportunity-scoring pipeline, already fed from Scanner and Portfolio.
- `lib/ios/` (`types.ts`, `profile.ts`, `fit-scorer.ts`, `server.ts`) + `ios-context.tsx` — the cross-cutting personalization layer (`PortfolioFitScore`, 6 weighted dimensions) already wired into Research, Compare, Scanner, Screener, Watchlist, DCF, new-positions. This is the "is this right for THIS user" layer the new systems must plug into, not duplicate.
- `lib/portfolio-analytics.ts` is already the single source of truth for portfolio math: health score, HHI, correlation, factor exposure, gap analysis, rebalance proposals, alerts, cash allocation. 40+ exported functions in one file.
- `lib/scanner/` (9 files: `causal-engine`, `classifier`, `company-impact`, `dedup`, `fundamental-gate`, `index`, `opportunity-scorer`, `sector-impact`, `signals`, `thesis-builder`) is already a well-decomposed multi-stage AI pipeline — the template to extend, not a reason to build a parallel one.

---

## 2. Architecture Assessment

The existing architecture (per `ARCHITECTURE.md`, `CLAUDE.md`) is sound and the new systems fit its grain without modification:

- **Layering holds**: `lib/*.ts` pure domain logic → `app/api/*/route.ts` validation/orchestration → `app/*/page.tsx` fetch/render → `_components/` presentation. Every existing engine (`portfolio-analytics.ts`, `scanner/`, `ios/`) already follows this. New work should slot into the same layers, not introduce a new one.
- **Single-source-of-truth is already partially enforced** for scoring (`composite.ts`), portfolio math (`portfolio-analytics.ts`), and personalization (`ios/fit-scorer.ts`). The one place this principle is currently at risk: if Sector Rotation and Movement Explainer are built as bolt-ons instead of shared engines, every consumer (Research, Portfolio, Watchlist, Compare, Dashboard) will reimplement "why did this move" logic independently — exactly the anti-pattern AGENTS.md §4 warns against.
- **AI usage pattern is consistent**: one platform entry point (`runPrompt` via `lib/ai/`, Anthropic API on the user's key), feature-specific prompt builders (`ai-research.ts`, `ai-compare.ts`, `ai-watchlist.ts`, scanner's `buildCausalPrompt`/`buildThesisPrompt`/`buildSectorImpactPrompt`/`buildScanPrompt`), streaming via `ReadableStream` for long-running work, non-fatal degradation when the AI is unavailable. New AI responsibilities must follow this exact pattern — no new AI plumbing needed, only new prompt builders.
- **Persistence gap**: `lib/db.ts`'s SQLite schema has no tables for sector-rotation history, movement-explanation cache, or watchlist alert state. All three need schema additions (see §6).

---

## 3. Existing Reusable Components

| Component | Location | Reusable for |
|---|---|---|
| `classifyAction`, `computeRecommendations`, `PortfolioAction` | `lib/portfolio-analytics.ts` | Portfolio Decision Engine (already the engine — extend inputs, don't replace) |
| `computeScenarios`, `SCENARIOS` | `lib/portfolio-analytics.ts` | Stress Testing (already the engine — add user-defined scenarios + sector-rotation-aware assumptions) |
| `computeAlerts`, `PortfolioAlert` | `lib/portfolio-analytics.ts` | Pattern to mirror for Watchlist Intelligence's structured alerts |
| `SmartAlerts` component | `app/portfolio/_components/smart-alerts.tsx` | Reuse directly (or lightly parameterize) for Watchlist alert rendering — same severity/type taxonomy |
| `buildCausalChains`, `buildTheses`, `analyzeSectorImpacts`, `buildCompanyOpportunities` | `lib/scanner/*.ts` | Core of Explain Every Movement — generalize call signature to accept an arbitrary symbol/portfolio/sector instead of only scanner-detected events |
| `runScannerPipeline`, `assessMarketRegime`, `detectEmergingThemes` | `lib/scanner/index.ts` | Market regime detection for Market Dashboard — call directly, don't reimplement |
| `scoreOpportunities`, `segmentOpportunities`, `computeMomentumScore` | `lib/scanner/opportunity-scorer.ts` | Feed both Sector Rotation (sector-level momentum) and Watchlist promotion pipeline |
| `buildOpportunityProfile` | `lib/opportunity-engine.ts` | Single opportunity-profile builder — Sector Rotation and Watchlist Intelligence both emit into this, not their own opportunity shapes |
| `computePortfolioFit`, `rankByFit`, `useIOS()`/`useIOSSafe()` | `lib/ios/*`, `ios-context.tsx` | Every new system's recommendations must be run through this before display — "right stock" vs "right for this portfolio" |
| `sectorGroup()` | `lib/sector.ts` | Reusable as the UI color-coding utility it is; NOT sufficient as Sector Rotation's classification layer (see §5) |
| `generateWatchlistDigest`, `WatchlistPortfolioContext` | `lib/ai-watchlist.ts` | Base to extend into structured alerts, not replace |
| `CIOPanel`, `/api/portfolio/audit`, `/api/portfolio/invest`, `/api/ai/portfolio-brief` | `app/portfolio/_components/cio-panel.tsx`, `app/api/portfolio/*`, `app/api/ai/portfolio-brief` | Base to extend into the AI Portfolio Manager orchestrator |
| `getQuote`, `getHistory`, `getQuoteSummary` | `lib/yahoo.ts` | Sector ETF price history (sector rotation's core data need — no new data source required, sector ETFs are already tickers) |
| `lib/db.ts` CRUD pattern | `lib/db.ts` | Template for the 3 new tables needed (§6) |

---

## 4. Shared Engines (current single-source-of-truth map)

```
Scoring          → lib/composite.ts               (value/quality/momentum, 0-100)
Screening        → lib/fundamental-screener.ts      (filter + cache + score)
Signals          → lib/event-screener.ts            (earnings/insider/technical/rotation signals — NOTE: name is legacy, this predates and is distinct from the new Sector Rotation Engine)
Thematic          → lib/thematic-engine.ts           (10-stage framework)
Portfolio math    → lib/portfolio-analytics.ts       (health, risk, scenarios, actions, alerts, rebalance)
Opportunity       → lib/opportunity-engine.ts + lib/scanner/opportunity-scorer.ts
Personalization   → lib/ios/fit-scorer.ts            (PortfolioFitScore)
Movement/causal   → lib/scanner/causal-engine.ts + thesis-builder.ts + company-impact.ts + sector-impact.ts  (scanner-scoped today)
AI inference      → lib/ai/ (+ feature prompt builders per module)
Persistence       → lib/db.ts (all SQLite CRUD)
```

**Naming collision to resolve before implementation**: `lib/event-screener.ts` already detects "sector rotations" as one of its signal types (factor underperformance switches — see ARCHITECTURE.md §"Event Screener"). The new Sector Rotation Engine is a different, broader capability (continuous capital-flow/momentum tracking across all sectors, not a single detected signal). Phase 1 must either (a) rename the new engine to avoid confusion (e.g. "Sector Flow Engine" internally) or (b) fold rotation-signal detection from `event-screener.ts` into the new engine as one of its inputs, retiring the duplicate concept. Recommend (b): the new engine subsumes and formalizes what `event-screener.ts` currently does ad hoc.

---

## 5. Architecture Gaps

Only two gaps require new engine code; everything else is extension or orchestration:

1. **Sector Rotation Engine — net new.** No component computes rolling relative sector strength, tracks leadership changes over time, or persists rotation history. Needs: sector ETF price-history ingestion (via existing `lib/yahoo.ts`), relative-strength computation (pure function, testable like `composite.ts`), a persistence table for rotation history/leadership-change events, and an explanation layer (reuses Movement Explainer, §6).

2. **Movement Explainer — generalization, not creation.** `lib/scanner/causal-engine.ts` + `thesis-builder.ts` + `company-impact.ts` + `sector-impact.ts` need to be extracted from their current scanner-only call path into a standalone callable engine (`explainMovement(subject, context)` where subject is a symbol, portfolio, or sector) that Research, Portfolio, Watchlist, and the new Market Dashboard can call directly, with Scanner becoming one caller among several instead of the only one.

Everything else is wiring:
- Portfolio Decision Engine: extend `buildRisks`/`buildCatalysts` inputs to include Movement Explainer output and Sector Rotation context — no new scoring logic.
- Watchlist Intelligence: extend `generateWatchlistDigest` to emit structured `WatchlistAlert[]` (mirroring `PortfolioAlert`), add an auto-promotion check into `computeOpportunities`.
- Portfolio Stress Testing: extend `SCENARIOS` with user-defined scenario support and feed sector-rotation state into scenario assumptions (e.g. "tech correction" scenario should reflect current tech sector momentum, not a static assumption).
- Market Dashboard: new page-level composition (`app/page.tsx`) synthesizing existing `runScannerPipeline` output, Sector Rotation, `computeAlerts`, Watchlist alerts, and `scoreOpportunities` — no new business logic, an aggregation API route.
- AI Portfolio Manager: extend `CIOPanel`/`/api/portfolio/audit`/`/api/ai/portfolio-brief` to ingest Sector Rotation and Movement Explainer as additional evidence sources in the prompt context — same streaming pattern, richer inputs.

---

## 6. Master System Architecture

### 6.1 New shared engine: Sector Rotation (`lib/sector-rotation.ts`)
- **Purpose**: continuously track relative strength, momentum, and capital flow across sectors/industries/themes; identify leadership changes.
- **Inputs**: sector ETF price histories (via `lib/yahoo.ts getHistory`), sector membership (via `lib/sector.ts` + `lib/composite.ts`-scored constituents), lookback windows (1w/1m/3m/6m).
- **Outputs**: `SectorRotationSnapshot` (per-sector relative strength score, momentum direction, rank change vs. prior snapshot, flow classification: strengthening/weakening/leading/lagging).
- **Deterministic core, AI-explained edges**: relative strength computation is pure/testable like `composite.ts`; the "why is this rotation happening" narrative is delegated to Movement Explainer (§6.2), not reimplemented.
- **Persistence**: new `sector_rotation_snapshot` table (daily snapshots) — needed because rotation is inherently about change over time, unlike everything else in `db.ts` which is either live-fetched or 24h-cached fundamentals.
- **Consumers**: Opportunity Engine (sector momentum as a scoring input), Portfolio Decision Engine (sector context for Reduce/Exit calls), Stress Testing (sector-aware scenario assumptions), Market Dashboard (leadership panel), Research (sector context banner).

### 6.2 Generalized Movement Explainer (extracted from `lib/scanner/`)
- **Purpose**: given a subject (symbol / portfolio / sector) and an observed movement, return primary drivers, supporting evidence, confidence, expected persistence.
- **Refactor, not rewrite**: promote `buildCausalChains`, `buildTheses`, `company-impact.ts`, `sector-impact.ts` logic to be callable with an explicit subject+timeframe argument rather than only iterating over scanner-detected events. Scanner's pipeline becomes the first caller; Research/Portfolio/Watchlist/Dashboard become additional callers.
- **Caching**: results cached by `(subject, timeframe)` key, similar to `scanner_cache` — likely a new `movement_explanation_cache` table or an extension of `scanner_cache`'s existing key-value shape (prefer extending — same TTL semantics, avoids a redundant table).
- **Consumers**: Research (why did this stock move), Portfolio (why is this holding underperforming — feeds Decision Engine's `buildRisks`), Watchlist (why does this alert matter), Sector Rotation (why is this sector rotating), Market Dashboard (top-line "what happened today").

### 6.3 Portfolio Decision Engine — extension only
- No new engine. Extend `classifyAction`'s evidence inputs to pull from Movement Explainer (why this stock deserves Reduce/Exit) and Sector Rotation (is the holding's sector strengthening or weakening). `PositionRecommendations` UI gains a "why" expansion sourced from Movement Explainer instead of only `buildReasoningText`'s current internal logic.

### 6.4 Watchlist Intelligence — extension
- Add `computeWatchlistAlerts(items, portfolioContext, sectorRotation)` to `lib/ai-watchlist.ts` alongside the existing digest, returning structured `WatchlistAlert[]` (severity/type, mirroring `PortfolioAlert`). Reuse `SmartAlerts` component for rendering.
- Auto-promotion: a watchlist item whose `computeOpportunities`-equivalent score crosses a threshold surfaces in `new-positions-panel.tsx` (already reads `fromWatchlist: true` per prior IOS work) — this wiring is nearly done; add the threshold check.

### 6.5 Portfolio Stress Testing — extension
- Add `UserDefinedScenario` to the existing `SCENARIOS`/`ScenarioImpact` types. Feed `SectorRotationSnapshot` into `computeScenarios` so sector-specific scenarios (e.g. "energy rally") use live rotation state instead of static coefficients in `SECTOR_FACTOR_MAP`.

### 6.6 Market Dashboard — new composition layer
- New aggregation API (`app/api/dashboard/route.ts`) calling, in parallel (`Promise.all`, per existing convention): `runScannerPipeline` (regime + themes), `sector-rotation` snapshot, `computeAlerts` + Watchlist alerts, `scoreOpportunities` top-N, earnings calendar (existing `/api/calendar`).
- `app/page.tsx` replaces/absorbs `daily-pulse.tsx`'s narrow `PulseData` with this richer payload. `DailyPulse` becomes one panel among several rather than the whole page.

### 6.7 AI Portfolio Manager — orchestration extension
- `CIOPanel`/`/api/portfolio/audit`/`/api/ai/portfolio-brief` prompt context gains Sector Rotation + Movement Explainer + Watchlist Intelligence sections. No new streaming plumbing — same `ReadableStream` pattern, richer `buildX Prompt` inputs.

---

## 7. Cross-System Dependency Diagram

```
                         lib/yahoo.ts (prices) ── lib/db.ts (persistence)
                                  │
                    ┌─────────────┼──────────────────┐
                    │             │                  │
           lib/composite.ts  lib/sector-rotation.ts  lib/scanner/* (causal/thesis/impact)
           (scoring)          (NEW)                   (Movement Explainer, generalized)
                    │             │                  │
                    └──────┬──────┴─────────┬────────┘
                           │                 │
                lib/opportunity-engine.ts    lib/portfolio-analytics.ts
                lib/scanner/opportunity-     (health, actions, scenarios,
                  scorer.ts                   alerts, rebalance)
                           │                 │
                           └────────┬────────┘
                                    │
                            lib/ios/fit-scorer.ts
                            (personalization: is this right for THIS user)
                                    │
              ┌─────────────┬──────┴───────┬──────────────┬────────────┐
              │             │              │              │            │
         Research       Portfolio      Watchlist       Compare    Market Dashboard
        (movement       (Decision       (Intelligence   (fit +     (synthesizes
         context)        Engine +        + alerts +      movement)  everything)
                          Stress Test)    promotion)
                                    │
                          AI Portfolio Manager
                          (CIOPanel / audit / brief —
                           orchestrates all of the above
                           as evidence, doesn't recompute)
```

**Foundational (everything depends on these, nothing depends on them)**: `lib/yahoo.ts`, `lib/db.ts`, `lib/composite.ts`, `lib/ai/`.

**Second tier (depend only on foundational)**: `lib/sector-rotation.ts` (new), generalized Movement Explainer, `lib/opportunity-engine.ts`, `lib/portfolio-analytics.ts`.

**Third tier (compose second tier)**: `lib/ios/fit-scorer.ts` (personalizes anything second-tier produces).

**Top tier (page/orchestration, no other engine may import these)**: Research, Portfolio, Watchlist, Compare, Market Dashboard, AI Portfolio Manager. AI Portfolio Manager is top-tier-of-top-tier: it orchestrates by calling the same APIs the pages call, it does not get special engine access.

**No circular dependencies**: Sector Rotation and Movement Explainer are peers (second tier) — Sector Rotation calls Movement Explainer for narrative, Movement Explainer never calls Sector Rotation's snapshot logic directly (it receives rotation state as a passed argument, not an import), keeping the dependency one-directional.

---

## 8. Information Flow Diagram

```
Daily/on-demand:
  Yahoo prices ──▶ Sector Rotation snapshot ──▶ sector_rotation_snapshot table
                                │
                                ▼
User opens Research/Portfolio/Watchlist/Dashboard
                                │
                                ▼
  Page/API requests: portfolio report, sector rotation snapshot (cached),
  scanner pipeline (cached per scanner_cache TTL), IOS profile
                                │
                                ▼
  On "why did X move" trigger (explicit user question, or automatic on
  significant delta): Movement Explainer called with subject+timeframe
  ──▶ AI platform (causal/thesis prompts) ──▶ cached result
                                │
                                ▼
  Portfolio Decision Engine / Watchlist Intelligence / Stress Testing
  consume Movement Explainer + Sector Rotation as evidence inputs
                                │
                                ▼
  IOS fit-scorer personalizes every recommendation against user's
  actual holdings/objective/constraints
                                │
                                ▼
  AI Portfolio Manager (CIOPanel/brief) synthesizes top-priority items
  across all of the above into one daily narrative
                                │
                                ▼
  Market Dashboard renders the same synthesis as the always-visible
  home view (not copilot-triggered — always computed on page load,
  same as daily-pulse today)
```

Key rule carried over from existing architecture (ARCHITECTURE.md §"Design Principles"): **AI explains, engines decide.** Sector Rotation's relative-strength ranking is deterministic; only the "why" narrative touches the model. Same split for Movement Explainer (evidence gathering deterministic where possible — price/volume deltas, filing dates — narrative synthesis is AI). This matches the existing `composite.ts` (deterministic) + `ai-research.ts` (AI narrative) split exactly.

---

## 9. Recommended Folder Structure

No new top-level directories. Everything fits existing conventions:

```
lib/
  sector-rotation.ts          # NEW — relative strength, leadership, flow classification
  movement-explainer.ts       # NEW — thin public API wrapping generalized scanner engines
  scanner/
    causal-engine.ts          # MODIFIED — accept explicit subject, not only scanner events
    thesis-builder.ts         # MODIFIED — same
    company-impact.ts         # unchanged
    sector-impact.ts          # MODIFIED — called by both scanner and sector-rotation.ts
  portfolio-analytics.ts      # MODIFIED — classifyAction/buildRisks take movement+rotation context
  ai-watchlist.ts             # MODIFIED — add computeWatchlistAlerts()
  db.ts                       # MODIFIED — add sector_rotation_snapshot table, extend scanner_cache usage

app/
  api/
    sector-rotation/route.ts  # NEW — GET snapshot (cached)
    dashboard/route.ts        # NEW — aggregation endpoint for Market Dashboard
    movement/route.ts         # NEW — GET ?subject=&timeframe= explanation
  page.tsx                    # MODIFIED — becomes Market Dashboard composition
  _components/
    daily-pulse.tsx           # MODIFIED — becomes one panel, not the whole page
    sector-rotation-panel.tsx # NEW — shared component (Dashboard + Research use it)
  portfolio/_components/
    position-recommendations.tsx  # MODIFIED — "why" sourced from movement-explainer
    risk-panel.tsx                # MODIFIED — user-defined scenarios
    cio-panel.tsx                  # MODIFIED — richer prompt context
  watchlist/_components/
    watchlist-alerts.tsx      # NEW — reuses SmartAlerts pattern
  scanner/_components/
    sector-rotation-grid.tsx  # MODIFIED — reads from lib/sector-rotation.ts instead of single-scan sectorImpacts

tests/
  sector-rotation.test.ts     # NEW
  movement-explainer.test.ts  # NEW
  portfolio-analytics.test.ts # EXTENDED — new classifyAction inputs
```

---

## 10. Recommended Shared Engine Structure

```
Deterministic core (pure, tested, no I/O):
  lib/composite.ts            scoreAsset()
  lib/sector-rotation.ts      computeRelativeStrength(), classifyRotation()
  lib/portfolio-analytics.ts  classifyAction(), computeScenarios(), computeHealthScore()

Orchestration (I/O + composition, still lib/, still testable with mocks):
  lib/movement-explainer.ts   explainMovement(subject, timeframe) — calls scanner/* + lib/ai
  lib/scanner/index.ts        runScannerPipeline() — unchanged role, now one caller of movement-explainer's building blocks

Personalization (wraps any of the above):
  lib/ios/fit-scorer.ts       computePortfolioFit(), rankByFit()

AI prompt builders (one per feature, never shared logic — matches existing pattern):
  lib/ai-research.ts, ai-compare.ts, ai-watchlist.ts, scanner/*Prompt builders,
  + new: buildSectorRotationPrompt (in sector-rotation.ts, or a slim sector-rotation-ai.ts if it grows)

Persistence (single file, unchanged pattern):
  lib/db.ts — add 1 table (sector_rotation_snapshot), extend scanner_cache key namespace for movement explanations
```

No new "engine layer" abstraction is warranted — the existing flat `lib/*.ts` + `lib/scanner/*.ts` structure already scales to this addition. Introducing a `lib/engines/` umbrella now would be an unnecessary abstraction the codebase doesn't otherwise use.

---

## 11. Implementation Order

Matches the phase structure already specified, with the scope correction from this audit:

**Phase 1 — Explain Every Movement + Sector Rotation**
1. Build `lib/sector-rotation.ts` (net-new engine, deterministic core first, tested).
2. Extract `lib/movement-explainer.ts` as a thin public wrapper around generalized `lib/scanner/causal-engine.ts` + `thesis-builder.ts` (refactor those two to accept explicit subjects).
3. Add `sector_rotation_snapshot` table to `lib/db.ts`.
4. Wire Sector Rotation Grid (scanner) to read from the new engine instead of single-scan `sectorImpacts`.
5. Add Movement Explainer entry points to Research (symbol) and Portfolio (holding) pages.

**Phase 2 — Portfolio Decision Engine + Watchlist Intelligence**
1. Extend `classifyAction`/`buildRisks`/`buildCatalysts` to accept Movement Explainer + Sector Rotation context (both now exist from Phase 1).
2. Add `computeWatchlistAlerts()` to `lib/ai-watchlist.ts`; reuse `SmartAlerts` for rendering.
3. Wire watchlist auto-promotion threshold into `new-positions-panel.tsx` (mostly already plumbed per IOS work).

**Phase 3 — Portfolio Stress Testing + Market Dashboard**
1. Extend `SCENARIOS` with user-defined scenarios + sector-rotation-aware assumptions (Sector Rotation from Phase 1 is a prerequisite).
2. Build `/api/dashboard` aggregation route and redesign `app/page.tsx` (depends on Phase 1 + 2 outputs existing to aggregate).

**Phase 4 — AI Portfolio Manager**
1. Extend `CIOPanel`/`/api/portfolio/audit`/`/api/ai/portfolio-brief` prompt context with Sector Rotation + Movement Explainer + Watchlist Intelligence evidence (pure integration — depends on all prior phases).

This order is a hard dependency chain, not just a priority list: Phase 3 and 4 literally cannot be built correctly before Phase 1 exists, since both consume Sector Rotation and Movement Explainer as evidence.

---

## 12. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Rebuilding Portfolio Decision Engine / Stress Testing from scratch (as the original prompt literally requests) | **High** — would create a second, competing `PortfolioAction`-like concept and duplicate `computeScenarios`, directly violating AGENTS.md §4 | Extend `portfolio-analytics.ts` in place; do not create new files for these two systems |
| `event-screener.ts`'s existing "sector rotation" signal vs. new Sector Rotation Engine naming collision | Medium — confusing for future agents/devs searching "rotation" | Fold the signal into the new engine as one input (§4); document the rename in ARCHITECTURE.md |
| Movement Explainer extraction breaks Scanner's existing causal-chain behavior | Medium — `causal-engine.ts`/`thesis-builder.ts` are live in Scanner today | Generalize call signatures additively (new optional subject param, existing scanner call path unchanged); add regression test on scanner's current output shape before refactoring |
| Sector Rotation snapshot table grows unbounded (daily snapshots, no retention policy) | Low-Medium | Define retention (e.g. 2 years) at table-creation time, matching `fundamentals_cache`'s TTL-cleanup precedent |
| AI latency compounding — Movement Explainer + Sector Rotation narrative + CIO brief all calling the AI for one dashboard load | Medium — Market Dashboard could become slow | Cache aggressively (rotation snapshot daily, movement explanations by subject+timeframe key); Dashboard should render deterministic panels immediately and stream AI narrative sections in, matching IC Report's existing `ReadableStream` pattern |
| Scope creep back to "7 independent systems" during implementation, losing the shared-engine discipline this document establishes | Medium | Each phase's PR/commit should explicitly reference which existing `lib/` file it extended vs. which new file it created, and justify any new file against §5's gap list |

---

## 13. Architecture Decisions

1. **Reuse over rebuild, with evidence.** Every one of the 7 requested systems maps to an existing file (§1). Only `lib/sector-rotation.ts` is a genuinely new engine. This decision is the single biggest scope reduction in this document and should be treated as binding — a future session proposing a new `lib/portfolio-decision-engine.ts` or `lib/stress-test-engine.ts` should be redirected to `portfolio-analytics.ts`.
2. **Movement Explainer is extracted, not duplicated.** `lib/scanner/*` keeps its files; they gain a generalized entry point. No parallel "explain-movement-v2" module.
3. **AI explains, engines decide** (carried from existing architecture) applies to both new capabilities: Sector Rotation's ranking is deterministic math; Movement Explainer's evidence-gathering is deterministic where the data allows (price/volume/filing deltas) and AI only for narrative synthesis.
4. **No new engine abstraction layer.** Flat `lib/*.ts` + `lib/scanner/*.ts` continues; no `lib/engines/` umbrella introduced.
5. **Personalization is mandatory, not optional, for every new recommendation surface.** Sector Rotation, Movement Explainer output, Watchlist alerts, and Stress Testing scenarios must all be run through `lib/ios/fit-scorer.ts` before being presented as an "actionable" recommendation — matching the precedent already set across Research/Compare/Scanner/Screener/Watchlist.
6. **`event-screener.ts`'s rotation signal is subsumed**, not left as a competing implementation (§4, §12).
7. **One new persistence table** (`sector_rotation_snapshot`); movement-explanation caching extends `scanner_cache`'s existing shape rather than adding a second cache table, since the key-value-with-TTL pattern is identical.

---

## 14. Final Master Blueprint — Summary

The seven requested systems collapse into:
- **1 new deterministic engine**: Sector Rotation (`lib/sector-rotation.ts`)
- **1 generalization**: Movement Explainer (extracted from `lib/scanner/*`)
- **4 extensions** of existing engines: Portfolio Decision Engine, Watchlist Intelligence, Portfolio Stress Testing, AI Portfolio Manager (all extend `portfolio-analytics.ts`, `ai-watchlist.ts`, `cio-panel.tsx`/audit/brief routes respectively)
- **1 new composition layer**: Market Dashboard (`app/page.tsx` + `/api/dashboard`, no new business logic — pure aggregation of the above)

Dependency order is strict: Phase 1 (Sector Rotation + Movement Explainer) must complete before Phases 2-4, since every other system consumes their output as evidence. This is a smaller, lower-risk build than the original 7-independent-systems framing, and it is the version consistent with this repository's own stated architectural principles (single source of truth, reuse before creation, AI enhances deterministic engines rather than replacing them).

**This document is the implementation reference for Phases 1-4.** Each phase's own prompt (already provided) should be read against §11's corrected order and §1's reuse map before any file is created.
