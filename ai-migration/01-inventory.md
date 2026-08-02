# Phase 1 — Ollama Call Site Inventory

Date: 2026-08-02. Scope: every code path in UAA that results in an Ollama
inference. Bench latencies measured on this machine (Apple M4, 17GB, qwen3:14b
primary) from `bench-out/`.

---

## 1. Architecture: one funnel, not N call sites

Every LLM call in the app flows through a single platform layer. **No feature
code talks HTTP to Ollama directly** — the only module that does is
`lib/ai/ollama.ts`.

```
Feature code (~35 call sites)
  │  runPrompt / runPromptWithMeta            lib/ai.ts (façade)
  │  runTask / runTaskText / runTaskStream / runTaskChat
  ▼
Orchestrator   lib/ai/orchestrator.ts   — coalesces identical concurrent requests
  ▼
Router         lib/ai/router.ts         — model eligibility/scoring/fallback, health
  ▼
AIProvider     lib/ai/provider.ts       — **an interface already exists** (complete/stream/listModels/healthCheck)
  │  OllamaProvider                     lib/ai/providers/ollama-provider.ts (the only implementation)
  ▼
Ollama HTTP    lib/ai/ollama.ts         — /api/chat (streaming + one-shot), /api/tags, /api/ps
```

Consequences for the migration:

- **The provider seam already exists.** `AIProvider` (lib/ai/provider.ts) is a
  clean interface: `complete()`, `stream()`, `listModels()`, `healthCheck()`,
  optional `isModelWarm()`. The ARCHITECTURE.md explicitly says a second
  provider is "a new `AIProvider`, not an architecture change".
- **`AI_PROVIDER=ollama` already exists in `.env.example`** — currently
  documented as a "legacy/no-op provider flag".
- Call sites name a **task**, not a model: 30+ `TaskType`s in
  `lib/ai/task-registry.ts` declare complexity / latency sensitivity /
  jsonMode / maxTokens / timeoutMs. Task IDs are the natural unit of migration.
- **Devin is already integrated in this repo — but only for engineering
  automation**: `scripts/devin/create-session.mjs` posts to
  `POST https://api.devin.ai/v3/organizations/{org_id}/sessions` with
  `DEVIN_API_KEY`/`DEVIN_ORG_ID` (already in `.env.example`), used by GitHub
  Actions workflows. See `docs/devin-integration.md`. Nothing under `app/` or
  `lib/` calls it today.

Other shared infrastructure that matters later:

| Piece | File | Relevance |
|---|---|---|
| JSON extraction | `lib/json-extract.ts` | `extractJson` / `extractJsonObject` (defaults-coerced) / `extractJsonArray` / `extractJsonObjectsLoose` (truncation salvage). Used by ~every JSON call site. |
| Incremental JSON field streamer | `lib/ai/streaming-json.ts` (`JsonFieldStreamer`) | Emits complete top-level JSON fields as they close during one streamed generation. Powers verdict + compare streaming. |
| Request coalescing | `lib/ai/orchestrator.ts` (`dedupe`) | Identical concurrent prompts attach to one in-flight generation. |
| Job single-flight | `lib/platform/jobs.ts` | In-memory (globalThis) job registry; attach-instead-of-race; used by Scanner/Wire only. Not SQLite-backed. |
| Result cache | `scanner_cache` table (SQLite, via `lib/db.ts`) + `lib/platform/registry.ts` cache policies | Content-hash keyed caches: verdict 6h fresh/24h SWR, thesis/holding-explain content-hash, financial-insight & movement 15min, scanner prompts 60min, home brief hour+state. |
| Error taxonomy | `lib/ai/errors.ts`, `lib/ai/log.ts` | Typed categories (timeout/network/model_missing/all_models_failed/invalid_response) mapped 1:1 to UI messages and structured logs. |
| Health/status UI | `app/_components/ollama-status.tsx`, `lib/ai/health.ts`, `app/api/ai/route.ts` | Header indicator polls provider health. |

Legacy shims: `lib/ai.ts` (façade), `lib/ollama.ts` (prompt builder only, no
HTTP). Model registry: `lib/ai/models.ts`. Router policy pins:
`lib/ai/config.ts` (`AI_TASK_<NAME>`, `AI_DISABLED_MODELS`, `AI_MAX_MODEL_GB`,
`OLLAMA_MODEL`).

---

## 2. Master call-site table

"Path" = user-facing request path (U: user watches a spinner / page blocks) vs
background (B: cron/job/detached pipeline). "Parse" = how output is consumed.
Latency figures are measured (bench-out) where available, otherwise the
configured timeout is given as the bound.

### 2.1 Scanner / Wire (task IDs: `opportunity-engine`, `investment-thesis`)

One scan = ~15–25 sequential LLM calls (Ollama serializes). Measured
(`bench-out/wire/run1.json`): **7 chat calls, p50 110.4s/call, max 300s
(timeout hit), pipeline wall clock 1,019s (~17 min)**. All calls go through
`scannerPrompt()` (`lib/scanner/llm.ts:74-99`): 60-min content-hash cache,
per-scan model pinning, abort threading, `json: true` always.

| # | Call site | Purpose | Input | Output / parse | Path | Streamed? |
|---|---|---|---|---|---|---|
| S1 | `lib/scanner/classifier.ts:118` `classifyEvents` | Classify ≤10 news events into taxonomy (category/sectors/themes/tickers) | headlines+summaries (~0.5–1.5KB) | JSON `{classifications[]}` → `extractJsonObject` + per-item sanitizer; on fail: events unmodified + degrade flag | U (scan pipeline) | No |
| S2 | `lib/scanner/causal-engine.ts:96` `buildCausalChainForEvent` | 1st/2nd-order effects per macro/policy event (sequential, ~3–5 events) | single event (~0.5KB) | JSON `{effects[]}` → same pattern; fail → `[]` | U | No |
| S3 | `lib/scanner/index.ts:163` `detectEmergingThemes` | 3–5 emerging themes from ≤12 headlines | ~1KB | JSON `{themes[]}` → same; fail → `[]` | U | No |
| S4 | `lib/scanner/index.ts:242` `extractRiskAlerts` | Top-3 risk alerts from ≤8 bearish events | ~0.8KB | JSON `{alerts[]}` → same; fail → `[]` | U | No |
| S5 | `lib/scanner/company-impact.ts:198` `buildCompanyOpportunities` | Map sector signal → specific companies (≤40 candidates/sector, ≤6 sectors, sequential) | ~1.5–2.5KB/sector | JSON `{matches[]}` → same; fail → skip sector | U | No |
| S6 | `lib/scanner/thesis-builder.ts:110` `buildTheses` | Thesis per high-conviction opportunity (composite ≥70, sequential, ~3–8) | events+fundamentals+quote (~1KB) | JSON thesis object → `extractJsonObject`; fail → thesis stays null | U | No |

Delivery: `app/api/scanner/v2/route.ts` streams **pipeline stage progress** as
NDJSON (not model tokens). `lib/scanner/scheduler.ts` re-runs the scan hourly
detached (`UAA_SCANNER_INTERVAL_MS`) — this is the one true background/cron
consumer.

### 2.2 IC Report (task IDs: `ic-agent-analysis`, `accounting-red-flags`, `risk-review`, `scenario-analysis`, `investment-thesis`)

One IC report = **12 sequential LLM calls**. Measured
(`bench-out/ic/run1.json`, RELIANCE.NS, qwen3:14b): **p50 66.5s/call, min
34.2s, max 151.5s, total 850.8s of 852.2s wall (~14.2 min; LLM time is 99.8%
of the pipeline)**.

| # | Call site | Purpose | Input | Output / parse | Path | Streamed? |
|---|---|---|---|---|---|---|
| I1 | `lib/ic/valuation-inputs.ts:210-269` `proposeValuationInputs` | Model proposes numeric valuation inputs only (validated/clamped in code; engine computes figures) | financial summary (~0.5KB) | JSON (11 numeric fields) → `extractJsonObject`; fail → history-derived defaults | U (SSE pipeline) | No |
| I2–I10 | `lib/ic-agents.ts:265-345` `runAgent` ×9 domains | Business/industry/competition/management/capital-allocation/accounting/valuation/governance/risk agents | domain data slice + questions (~0.6–1.2KB each) | JSON `{findings,keyInsights[],confidence,dataLimitations}` → `extractAgentJson` (2-strategy: brace extraction, prose-stripping), 1 retry | U | No |
| I11 | `lib/ic-synthesis.ts:104-180` `synthesiseFindings` | Cross-agent dedup/disagreements | all findings ~2–3KB | JSON → `extractJsonObject`; fail → deterministic dedup only | U | No |
| I12 | `lib/ic-thesis.ts:115-171` `formThesis` | Bull/bear/base thesis + catalysts/risks | agent summary + engine-established conclusions (~1.5–2.5KB) | JSON → `parseThesis`, 1 retry on parse fail, `EMPTY_THESIS` fallback | U | No |

Delivery: `app/api/ic-report/route.ts` — SSE of **stage progress events**; run
owned server-side (`lib/ic/store.ts`), survives client disconnect. p50 per-call
figures per agent: ~54–83s; thesis ~152s (the longest single call in the app).

### 2.3 Thematic engine (task ID: `thematic-analysis`)

One thematic run = **8 sequential LLM calls** (stages 1–7 + 9; stages 8 and 10
are deterministic). No per-stage bench data; every stage has the task's 300s
timeout. Delivery: `app/api/thematic/route.ts` — SSE stage progress with 15s
heartbeat, in-flight run dedup, result cache.

| # | Call site | Purpose | Output / parse |
|---|---|---|---|
| T1 | `lib/thematic-engine.ts:928` `scoreFutureState` | Stage 1 inevitability score | JSON → `extractJsonObject`, score coerced 0–10; fail → neutral defaults |
| T2 | `:970` `buildDependencyChain` | Stage 2, 6-tier chain | JSON array → `extractJsonArray` + sanitizer; **retry with terse prompt variant** on fail |
| T3 | `:1042` `scoreBottleneck` | Stage 3 bottleneck | JSON → coerced enums/scores; neutral defaults |
| T4 | `:1093` `scoreSupplyDemand` | Stage 4 supply/demand + capital cycle (live commodity prices in prompt) | JSON, 4 enum coercions |
| T5 | `:1154` `scoreCommodityFramework` | Stage 5 commodity intensity | JSON, coerced |
| T6 | `:1198` `scorePolicy` | Stage 6 policy/geopolitics (live news in prompt, ~1KB) | JSON incl. object array → sanitizers |
| T7 | `:1270` `scoreGlobalStructuralAdvantage` | Stage 7 regional comparison | JSON → sanitizers |
| T8 | `:1349` `mapCompaniesToTiers` | Stage 9: map ≤53 screener companies to tiers | JSON array → `extractJsonArray`, **fallback `extractJsonObjectsLoose`** for truncation |

Failures are recorded per-stage in `ReportIntegrity.missingStages` /
`stageFailures`; the report renders with neutral 5/10 defaults rather than
crashing.

### 2.4 Research page (task IDs: `company/fund/crypto/commodity/forex/macro-research`, `explain-movement`, `quick-summary`)

| # | Call site | Purpose | Output / parse | Path | Streamed? | Cache |
|---|---|---|---|---|---|---|
| R1 | `lib/ai/verdict.ts:240-345` `generateVerdict`/`getVerdict` | Investment verdict (recommendation, conviction, theses) | JSON → `parseVerdictFields`→`extractJson`+coercion; grounding check (`lib/ai/grounding.ts`) | U | No (blocking variant, `/api/ai/verdict`) | **6h fresh / 24h SWR** (`aiVerdict` policy; 115.3s→0.04s on repeat per AGENTS.md) |
| R2 | `app/api/ai/report/route.ts:60-255` | Same verdict, **streamed by JSON field** | one generation → `JsonFieldStreamer` → NDJSON `manifest/section/done` events | U | **Yes** → `use-verdict-stream.ts` → verdict card. First content ~28s vs 103s all-at-once | same cache |
| R3 | `app/api/research/chat/route.ts:493-565` (equity copilot) | Multi-turn research chat with retrieval/grounding pipeline (`lib/ai/context/retrieval/prompt/memory`) | free text tokens; no JSON parse | U | **Yes — true token streaming** (`runTaskChat`, NDJSON `reasoning/delta/meta`) → `use-copilot.ts` → ResearchCopilot | session persisted (SQLite, `lib/ai/memory.ts`) |
| R4 | `app/api/research/chat/route.ts:45-343` `respondAsFund/Crypto/Commodity/Forex/Macro` | Class-specific research Q&A | free text; **pseudo-stream** (one complete answer wrapped as a single NDJSON delta) | U | Wire-level only | none |
| R5 | `lib/ai-financial-insight.ts:78-106` | Financial trend interpretation card | free text (no parse) | U | No | 15min TTL |
| R6 | `lib/movement-explainer.ts:188-262` `explainMovement` | "Why did this move" | JSON → `extractJsonObject` | U | No | 15min TTL |

### 2.5 Compare (task ID: `comparison`)

| # | Call site | Purpose | Output / parse | Streamed? |
|---|---|---|---|---|
| C1 | `lib/ai-compare.ts:591-626` `compareStocks` | 2–5 stock comparison (~5–10KB prompt — the largest routine prompt in the app) | JSON → `extractJsonObject` → `finalizeComparison`; ranking falls back to composite-score order if mangled | No (`/api/compare` POST) |
| C2 | `lib/ai-compare.ts:641-676` `streamComparisonFields` | Same, streamed | `JsonFieldStreamer` → NDJSON field events → `app/compare/page.tsx` progressive fill | **Yes** (`/api/compare/stream`) |
| C3 | `lib/compare/class-ai-compare.ts:247-309` `compareClassAssets` | Non-equity class comparison (ETF/REIT/crypto/bond/forex) | JSON → `extractJsonObject` + `sanitizeRanking` | No (`/api/compare/class`) |

### 2.6 Portfolio (task IDs: `portfolio-intelligence`, `portfolio-audit`, `portfolio-construction`)

| # | Call site | Purpose | Output / parse | Path | Streamed? | Cache |
|---|---|---|---|---|---|---|
| P1 | `lib/portfolio/thesis.ts:513-613` `buildPortfolioThesis` | Portfolio thesis + identity tags. **Prompt hands the model pre-computed `ESTABLISHED CONCLUSIONS`** — all directional judgments computed in code (hard product rule, AGENTS.md) | JSON → `extractJsonObject` + conflict resolution; deterministic fallback from health dims | U | No | content-hash (scanner_cache) |
| P2 | `lib/portfolio/holding-explain.ts:114-145` `explainHolding` | Per-holding "why do I own this" | JSON → `extractJsonObject`; deterministic fallback | U (click) | No | content-hash |
| P3 | `app/api/portfolio/audit/route.ts:10-134` | CIO audit memo (prose) | free text — **no parsing** | U | **Yes** — `runTaskChat` token stream | none |
| P4 | `app/api/ai/portfolio-brief/route.ts:23-137` | Portfolio brief (headline/narrative/opportunities/risks) | JSON → `extractJsonObject` | U | No | none (route maxDuration 60s) |
| P5 | `app/api/portfolio/simulator/intake/route.ts:29-90` | Simulator intake interview: next question (JSON), deterministic gap checks run first | JSON → `extractJson`; 60s explicit timeout | U (live back-and-forth) | No | none |
| P6 | `app/api/portfolio/simulator/generate/route.ts:21-81` | 5-stage portfolio generation | NDJSON **progress** stream; 300s budget | U | Stage progress only | none |
| P7 | `app/api/portfolio/simulator/swap/route.ts:37-142` | AI swap alternatives | JSON → `extractJson`; validated against live quotes | U | No | none |
| P8 | `app/api/portfolio/simulator/refresh-narrative/route.ts:27-92` | Refresh rationales after user edit | JSON → `extractJson` | Semi-B (edit already persisted) | No | none |

### 2.7 Home / Watchlist / Calendar / Assistant / Screener (task IDs: `daily-briefing`, `watchlist-intelligence`, `calendar-brief`, `app-assistant`, `nl-screener`, `chart-qa`, `knowledge-graph-explain`, `market-summary`, `timeline-analysis`)

| # | Call site | Purpose | Output / parse | Path | Streamed? | Cache |
|---|---|---|---|---|---|---|
| H1 | `lib/home/brief.ts:222-280` `generateHomeBrief` | Today's Brief + AI Investment Brief (one call, two modules) | JSON → `extractJsonObject` + `verifyGrounding` (rejects hallucinations); `deterministicBriefing()` fallback always available | U | Delivery streamed as NDJSON chunks (`/api/home/brief` → `home-provider.tsx`), generation is one-shot | hour + portfolio-state key |
| W1 | `lib/ai-watchlist.ts:145-199` `generateWatchlistDigest` | Watchlist digest (≤10 items + portfolio context, ~2KB) | JSON → `extractJsonObject`; deterministic `computeWatchlistAlerts` rendered alongside | U (button) | No | none |
| K1 | `app/api/calendar/ai-brief/route.ts:48-69` | Weekly calendar brief (≤200 events, ~5KB) | free text; 50s timeout; UI says "typically ~20s" | U (expand) | No | none |
| A1 | `lib/ai-app-assistant.ts:307-334` `runAppAssistant` | Global "how do I" helper + navigation actions | JSON → `extractJson` → `resolveAction`; 150s timeout (cold-load headroom) | U | No | none |
| N1 | `lib/screener/nl-filters.ts:90-121` `parseNlFilters` | NL → screener filters (~100 char input) | JSON → `extractJson` → schema-validated `parseFilters`; throws `NlFilterParseError` w/ raw text | U (spinner) | No | none |
| E1 | `lib/event-screener.ts:175-186` `runScan` | Event-driven signals from news+query | JSON → `parseAiResponse` | B-ish | No | none |
| — | `chart-qa`, `knowledge-graph-explain`, `market-summary`, `timeline-analysis`, `quick-summary` | Small interactive one-shots, same façade + `extractJson*` pattern | JSON or short text | U | No | varies |

Deterministic-only (no LLM despite living in "AI" modules):
`lib/screener/explain.ts`, `lib/ai-proactive-insights.ts`.

---

## 3. Streaming to the UI — the complete list

True **token/field streaming** (would need a Devin-side equivalent or a UX
redesign):

1. **Research verdict** — `/api/ai/report`: ONE generation, incrementally
   parsed by `JsonFieldStreamer`, fields emitted as NDJSON `section` events →
   `lib/ai/client/use-verdict-stream.ts` → verdict card. Key detail: **the JSON
   schema's key order IS the streaming order** (hero verdict first). Built
   specifically to cut time-to-first-content 103s → 28s.
2. **Research copilot (equity)** — `/api/research/chat`: true token streaming
   with a separated reasoning channel (`runTaskChat` + `onReasoning`) →
   `use-copilot.ts`.
3. **Equity comparison** — `/api/compare/stream`: same `JsonFieldStreamer`
   architecture as the verdict.
4. **Portfolio CIO audit memo** — `/api/portfolio/audit`: streamed prose.

**Stage-progress streaming only** (model output itself is not streamed; NDJSON/
SSE carries pipeline stage events — these ports cleanly to any async backend):
scanner v2, IC report, thematic, simulator generate, home brief delivery.

**Pseudo-streaming**: fund/crypto/commodity/forex/macro chat — one complete
answer wrapped in a single NDJSON delta for client protocol consistency.

---

## 4. Output parsing — where and how brittle

Uniform pattern across the codebase; brittleness is LOW by design because
every consumer was hardened against 7B-model output:

- **`extractJsonObject(raw, defaults)`** (most JSON sites): fence/preamble
  stripping, top-level key coercion against a defaults shape, array-ness
  preserved. Parse failure → defaults, never a crash.
- **Per-item sanitizers** (scanner, thematic, compare): enum coercion, range
  clamping, string filtering. One bad item is dropped, not the batch.
- **Truncation salvage**: `extractJsonObjectsLoose` (brace-depth walker)
  rescues complete objects from a truncated array (thematic stage 9).
- **Retries**: IC agents ×1, IC thesis ×1 on parse failure, thematic stage 2
  retries with a terse prompt variant. Everything else is single-shot +
  fallback.
- **Streaming parser**: `JsonFieldStreamer` is a state machine that only emits
  a field once its value closes — malformed tail = missing fields, assembled
  result then coerced by the same defaults machinery.
- **The dangerous failure mode is silent emptiness, not crashes**: documented
  incident where `format:"json"` + thinking returned literal `{}` — it parsed,
  so ~14 tasks silently rendered fallback states. Any new provider must be
  validated against *schema completeness*, not just parseability. (This is
  exactly what a structured-output-native backend should fix.)
- Grounding verification (`lib/ai/grounding.ts`) post-checks verdict/brief
  claims against source numbers and rejects low-confidence output.

---

## 5. Measured latency summary (Ollama today)

| Pipeline / call | LLM calls | Per-call | End-to-end |
|---|---|---|---|
| IC report (`bench-out/ic/run1.json`) | 12 sequential | p50 66.5s, min 34.2s, max 151.5s | **852s (~14.2 min)**, 99.8% of it LLM |
| Wire/scanner (`bench-out/wire/run1.json`) | 7+ sequential | p50 110.4s, max 300s (timeout) | **1,019s (~17 min)** |
| Research verdict (uncached) | 1 | ~103s blocking; streamed: first content ~28s | cache hit: 0.04s |
| Thematic | 8 sequential | ≤300s each (no bench) | tens of minutes worst case |
| Interactive one-shots (nl-screener, chart-qa, calendar, assistant) | 1 | seconds when warm; **69.6s cold model load** dominates | timeouts 30–150s |

Structural facts that shape the Devin design:

- **Ollama serializes generations** — every multi-call pipeline is sequential
  by necessity, and the orchestrator coalesces duplicates to protect the queue.
  A hosted backend with real concurrency removes the app's single biggest
  latency constraint (9 IC agents could run in parallel).
- **Cold model load (69.6s for 4.4GB) dominates interactive latency** — the
  entire keep-alive/cold-start machinery in router/ollama.ts exists to manage
  a problem a hosted API doesn't have (it has a different one: session spin-up).
- Timeout budgets already assume minutes, and every surface already has
  loading/pending states and deterministic fallbacks — the app is structurally
  tolerant of slow, async, occasionally-failing AI.

---

## 6. Call-site count by migration-relevant shape

| Shape | Count | Examples |
|---|---|---|
| One-shot JSON, cached, user-facing | ~14 | verdict, thesis, holding-explain, brief, digest, movement |
| One-shot JSON, uncached interactive | ~8 | nl-screener, chart-qa, assistant, simulator intake/swap, compare |
| Sequential multi-call pipeline (stage-progress UI) | 4 pipelines / ~26 calls | scanner (6 sites), IC (12), thematic (8), simulator generate |
| True token/field streaming | 4 | verdict stream, copilot chat, compare stream, audit memo |
| Free-text one-shot | ~6 | calendar brief, financial insight, class research chat ×5 |
| Background/cron | 1 | scanner scheduler (hourly, detached) |
