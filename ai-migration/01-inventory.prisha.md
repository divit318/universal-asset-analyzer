# Phase 1 — AI Call-Site Inventory

Date: 2026-08-02. Working tree at `250ad32` + uncommitted work (see §0).

## 0. A correction to the brief's premise — read this first

The brief says "UAA currently runs all AI analysis through local Ollama models."
**That is one session out of date.** The working tree already contains a
provider chain (built 2026-08-02, uncommitted): the Router walks
`devin (CLI transport) → ollama`, so today every AI call is *attempted against
Devin first* via `devin -p` subprocess calls (`lib/ai/devin-cli.ts`,
`lib/ai/providers/devin-provider.ts`), with Ollama as the offline fallback.

Consequences for this migration:

1. **The provider abstraction Phase 3 asks for already exists** —
   `AIProvider` in `lib/ai/provider.ts`, with two implementations and an
   ordered chain selected by `AI_PROVIDER_ORDER` (not the requested
   `AI_PROVIDER=ollama|devin` single-select; that's a small config change).
2. What does **not** exist is a Devin **API** (api.devin.ai sessions) provider —
   the current Devin transport is the local CLI in print mode. Phase 2 will
   determine whether the sessions API can beat or complement it. The CLI
   transport's measured numbers are the bar to beat: ~3s light / ~5s standard /
   4–8s deep, 9 parallel calls in ~10s, no token streaming.
3. Ollama code is intact and feature-flagged, as the rules require. Nothing
   was deleted.

The rest of this document is the inventory the brief asked for, written so it
serves either transport.

## 1. Where Ollama is actually touched

The single most important structural fact: **feature code never talks to
Ollama.** Every AI call in the app funnels through one façade:

```
feature code (~45 call sites)
  → runPrompt / runPromptWithMeta            lib/ai.ts
    or runTask / runTaskText / runTaskStream / runTaskChat   lib/ai/orchestrator.ts
      → route / routeStream                  lib/ai/router.ts   (task → provider+model)
        → AIProvider                         lib/ai/provider.ts
            ├─ DevinProvider → devin -p      lib/ai/devin-cli.ts        (primary)
            └─ OllamaProvider → HTTP         lib/ai/ollama.ts           (fallback)
```

So "migrate every Ollama call site" resolves to: **implement one new provider
behind an existing interface, plus decide per-task routing.** The ~45 feature
call sites below never change; they are inventoried because their latency
class, output shape, and parse brittleness drive which integration pattern
each can tolerate.

### 1.1 Raw Ollama surface (HTTP/env/model-name mentions)

| File | What touches Ollama | Notes |
|---|---|---|
| `lib/ai/ollama.ts` | The ONLY HTTP layer: `POST /api/chat` (streaming + blocking), `GET /api/tags`, `GET /api/version`; `OLLAMA_HOST` (default `localhost:11434`); 3-attempt linear-backoff retry; typed `OllamaUnavailableError`/`ModelMissingError`; `<think>` tag splitting | Keep as-is behind the flag |
| `lib/ai/providers/ollama-provider.ts` | Wraps the above behind `AIProvider` | Keep |
| `lib/ai/models.ts` | `MODEL_REGISTRY` local entries: `qwen3:30b-a3b`, `qwen3:14b`, `mistral:latest`, `qwen2.5-coder:14b`, `qwen3-coder:latest`, `devstral:24b`; `OLLAMA_MODEL` env honored in `pickDefaultModel()` | Model names live ONLY here + tests |
| `lib/ai/config.ts` | `AI_PROVIDER_ORDER`, `AI_DISABLED_MODELS`, `AI_MAX_MODEL_GB`, `AI_TASK_<NAME>` pins | The flag surface |
| `lib/ai/platform-health.ts` | Provider-agnostic readiness (replaces four routes' direct `checkHealth()` calls) | |
| `app/_components/ollama-status.tsx` | Header badge; reads provider-agnostic `/api/screener/nl` GET | Already migrated |
| `tests/ai-ollama.test.ts`, `tests/ollama.test.ts`, `tests/ai-platform-live.test.ts`, `tests/ai-models.test.ts`, `tests/ai-router.test.ts` | Unit tests pinned to local model ids / think-tag handling | Update when routing policy changes |
| `engine/**` (Python) | **No LLM calls.** `build_llm_context()` in `daily_run.py` only *assembles numbers* for the Next.js AI layer | Out of scope |

No other file in `app/` or `lib/` speaks to `11434`, `/api/generate`, or
`/api/chat`. Remaining grep hits are user-facing copy, doc comments, and the
error-code plumbing (`ai_unavailable`).

## 2. Feature call-site table

Legend — **Path**: `UF-sync` = user watches a spinner on a request/response;
`UF-stream` = user watches progressive output; `BG` = background/cron/batch or
fire-and-forget cache warm. **Parse**: how output is consumed
(`extractJsonObject`/`extractJsonArray` are the hardened never-throw parsers,
see §4). **p50** = Ollama-era observed/inferred → current CLI-transport
measured. All inputs are prompt-embedded text (numbers + headlines + filing
excerpts); none of these calls attach files.

### 2.1 Research (single asset)

| Call site | Task | Purpose | Input shape | Output shape / parse | Path | p50 |
|---|---|---|---|---|---|---|
| `lib/ai/verdict.ts:246` `generateVerdict` → `/api/ai/verdict` | `investment-thesis` | The AI investment verdict (BUY/HOLD/SELL + thesis + catalysts/risks) | Quote+fundamentals+composite dossier (~4-8KB) | JSON, `extractJsonObject` w/ full defaults; grounding pass after | UF-sync (blocking route) | 60–115s → 5–8s |
| `app/api/ai/report/route.ts:163` (streamed twin) | `investment-thesis` | Same verdict, streamed section-by-section | same | JSON fields streamed via `JsonFieldStreamer`; same assembler | UF-stream (NDJSON) | first content 28s → n/a (CLI emits once) |
| `lib/ai-research.ts:156` | `company-research` | India research report (screener.in data) | Fundamentals block | free text | UF-sync | 20–40s → ~5s |
| `lib/ai-research.ts:239` | `quick-summary` | One-paragraph summary | small | free text | UF-sync | 8–15s → ~3s |
| `lib/ai-research.ts:272` | `company-research` | Grounded Q&A answer | context+question | free text | UF-sync | 20–40s → ~5s |
| `app/api/ai/route.ts:33` `analyzeAsset` | `company-research` | Legacy quote+filings narrative | quote+filings | free text | UF-sync | 20–40s → ~5s |
| `app/api/research/chat/route.ts:495` | `company-research` | **Research Copilot** multi-turn chat | dossier + history (≤16k ctx) | token stream → NDJSON `delta`/`reasoning`/`meta`; persisted to `research_message` | UF-stream | first token 5–15s → one chunk ~5s |
| `lib/ai-financial-insight.ts:93` | `quick-summary` | Financial statement insight card | statement metrics | free text | UF-sync | 8–15s → ~3s |
| `lib/ai-pattern-insight.ts:64` | `quick-summary` | Chart pattern one-liner | pattern features | free text | UF-sync | 8–15s → ~3s |
| `lib/ai-chart-qa.ts:162` | `chart-qa` | Fullscreen-chart Q&A dock | chart context JSON + question | JSON, `extractJsonObject` | UF-sync (45s timeout) | 10–20s → ~4s |
| `lib/movement-explainer.ts:240` | `explain-movement` | "Why did this move" narrative | quote+news evidence | free text | UF-sync | 15–30s → ~5s |

### 2.2 Asset-class research (fund / crypto / commodity / forex / macro / derivatives / manual)

Seven structurally identical modules (`lib/ai-{fund,crypto,commodity,forex,macro,derivatives,manual-asset}-research.ts`),
each with two calls: a ~250-token summary and an ~800-token Q&A answer, both
free text, both `UF-sync`, called from `/api/{fund,crypto,commodity,forex,macro,derivatives}`
and `/api/manual-assets/[id]/{chat,insight}`. Ollama-era p50 10–25s → ~3–5s.
Fourteen call sites; one migration decision.

### 2.3 Screener & comparison

| Call site | Task | Purpose | Output / parse | Path | p50 |
|---|---|---|---|---|---|
| `lib/screener/nl-filters.ts:97` | `nl-screener` | NL → filter JSON (search box) | JSON, strict schema check, `NlFilterParseError` on 422 | UF-sync, latency-critical | 7–8s (mistral) → ~3s |
| `lib/screener/ai-summary.ts:95` | per-class task (`def.taskType`) | Screener result-set rationale | free text | UF-sync | 10–20s → ~4s |
| `lib/ai-compare.ts:450` | `comparison` | Equity comparison verdict | JSON (~1.8k tok), `extractJsonObject` | UF-sync | 30–60s → ~6s |
| `lib/compare/class-ai-compare.ts:262` | `comparison` | ETF/REIT/crypto/… class comparison | JSON, `extractJsonObject` | UF-sync | 30–60s → ~6s |

### 2.4 Portfolio

| Call site | Task | Purpose | Output / parse | Path | p50 |
|---|---|---|---|---|---|
| `app/api/ai/portfolio-brief/route.ts:111` | `portfolio-intelligence` | Daily portfolio brief | JSON, `extractJsonObject` w/ defaults | UF-sync | 20–40s → ~5s |
| `app/api/portfolio/new-positions/route.ts:236` | `portfolio-intelligence` | New-position recommendations | JSON array, sanitized per-item | UF-sync (180s timeout) | 90–180s → ~8s |
| `lib/portfolio/thesis.ts:124` | `portfolio-intelligence` | Per-holding thesis line | JSON; cached in `scanner_cache`, deterministic fallback | UF-sync, cached | 15–30s → ~4s |
| `lib/portfolio/holding-explain.ts:135` | `portfolio-intelligence` | "Why own this" per holding | JSON | UF-sync (click-triggered) | 15–30s → ~4s |
| `app/api/portfolio/audit/route.ts:110` | `portfolio-audit` | CIO audit memo | **prose token stream** | UF-stream | first token 5–15s → one chunk ~5s |

### 2.5 IC Report (institutional research — the heavy batch)

| Call site | Task | Purpose | Output / parse | Path | p50 |
|---|---|---|---|---|---|
| `lib/ic-agents.ts:240` ×9 domains | `ic-agent-analysis` / `accounting-red-flags` / `scenario-analysis` / `risk-review` | 9 parallel domain analyses | JSON each, `extractJsonObject` | UF-stream (per-agent completion events over `ReadableStream`) | Ollama serialized: 3–9 min total → **~10s total** (parallel) |
| `lib/ic-thesis.ts:85` | `investment-thesis` | IC thesis synthesis | JSON | UF-stream (same pipeline) | 30–60s → ~6s |
| `lib/ic-valuation.ts:465,604` | `scenario-analysis` | Valuation scenarios + divergence explanation | JSON / free text | UF-stream | 30–60s → ~6s |

### 2.6 Scanner / Wire (event pipeline — mostly background)

| Call site | Task | Purpose | Output / parse | Path | p50 |
|---|---|---|---|---|---|
| `lib/scanner/classifier.ts:117` | `opportunity-engine` | Classify raw events | JSON array, `extractJsonArray`+sanitize | BG (hourly scheduler) | 30–60s → ~6s |
| `lib/scanner/causal-engine.ts:95` | `opportunity-engine` | Causal chains per event | JSON | BG | 30–60s → ~6s |
| `lib/scanner/sector-impact.ts:132` | `opportunity-engine` | Sector impact map | JSON (2.5k tok) — **uses `extractJsonObjectsLoose` truncation salvage** | BG | 60–120s → ~8s |
| `lib/scanner/company-impact.ts:163` | `opportunity-engine` | Company match per sector | JSON | BG | 30–60s → ~6s |
| `lib/scanner/dedup.ts:122` | `opportunity-engine` | Cross-event dedupe | JSON | BG | 30–60s → ~6s |
| `lib/scanner/thesis-builder.ts:106` | `investment-thesis` | Opportunity theses | JSON | BG | 30–60s → ~6s |
| `lib/event-screener.ts:176` (v1) | `opportunity-engine` | Event signal summary | JSON; `scanner_cache` | UF-sync, cached | 30–60s → ~6s |

Scheduler: `lib/scanner/scheduler.ts` — auto-scan on boot + hourly
(`v2::true:true` cache key). This whole pipeline is the natural first candidate
for a precompute/async pattern: nothing here is watched by a spinner.

### 2.7 Thematic engine

`lib/thematic-engine.ts:741,785,835,892,941,991,1048,1144` — 8 sequential
stage calls, task `thematic-analysis`, all JSON (600–2000 maxTokens), all
carrying an `AbortSignal` (Cancel button). UF-stream (stage progress events).
Ollama era: 5–15 min full run → CLI ~1–2 min. Latency-tolerant but
user-watched.

### 2.8 Home / dashboard / misc

| Call site | Task | Purpose | Output / parse | Path | p50 |
|---|---|---|---|---|---|
| `lib/home/brief.ts:254` | `daily-briefing` | Today's Brief narration | free text (1.6k tok) | UF-sync (page load; brief route) | 18–40s → ~5s |
| `lib/market-summary.ts:64` | `market-summary` | Regime/macro narrative | free text | UF-sync | 10–20s → ~4s |
| `lib/ai-watchlist.ts:182` | `watchlist-intelligence` | Watchlist digest/alerts | JSON | UF-sync | 20–40s → ~5s |
| `lib/timeline.ts:604,696` | `timeline-analysis` | Event detail / what-changed | JSON (1.8k tok) | UF-sync | 20–40s → ~5s |
| `lib/knowledge-graph/traverse.ts:114` | `knowledge-graph-explain` | Edge explanation | JSON | UF-sync (interactive) | 8–15s → ~3s |
| `app/api/calendar/ai-brief/route.ts:63` | `calendar-brief` | Earnings-calendar brief | free text (50s timeout) | UF-sync | 10–20s → ~4s |
| `lib/ai-app-assistant.ts:315` | `app-assistant` | Global "how do I" helper | JSON (nav actions) | UF-sync (interactive) | 8–15s → ~3s |
| `lib/valuation/ai.ts:269` | `scenario-analysis` | Valuation scenario writeup | JSON | UF-sync | 30–60s → ~6s |
| `lib/ai-proactive-insights.ts` (via assistant insights route) | `quick-summary` | Proactive page insights | free text | UF-sync | 8–15s → ~3s |

`lib/home/digest.ts` is deliberately **AI-free** (doc comment: "The digest
must paint immediately") — do not add AI to it during migration.

## 3. Streaming surfaces (Q3 of the brief)

| Route | Mechanism | What streams | Client consumer |
|---|---|---|---|
| `/api/ai/report` | `runTaskStream` → `JsonFieldStreamer` → NDJSON `section` events | Report sections as their JSON fields close | `lib/ai/client/use-verdict-stream.ts` |
| `/api/research/chat` | `runTaskChat` → NDJSON `delta` / `reasoning` / `meta` / `error` | Copilot tokens + chain-of-thought | `app/research/_components/copilot/use-copilot.ts` |
| `/api/portfolio/audit` | `runTaskChat` → raw text stream | CIO memo prose | portfolio audit panel |
| `/api/ic-report` | `ReadableStream` of stage/agent events | **Not token streaming** — per-agent completion (agents run in parallel via blocking `runPrompt`) | IC report page |
| `/api/thematic` | `ReadableStream` stage progress | Per-stage completion | thematic page |

Only the first three are true token/field streams. **The current Devin CLI
provider batch-emits** (one chunk per generation), so these three degrade to
"everything at once, sooner" — acceptable at 5s totals, but the sessions API's
streaming story (Phase 2 item h) decides whether we can restore progressive
rendering.

## 4. Output parsing and brittleness (Q4)

**Central hardening — `lib/json-extract.ts`:**
- `extractJson<T>` — span-scan for outermost `{…}`/`[…]`, fence-strip fallback.
  **Throws** on garbage; returns a bare-cast `T` with **no schema validation**.
- `extractJsonObject(raw, defaults)` — never throws; per-key kind coercion
  against a defaults shape (arrays stay arrays). Shallow only — nested objects
  are not defaulted.
- `extractJsonArray(raw, sanitizeItem?)` — never throws; per-item sanitizers.
- `extractJsonObjectsLoose` — brace-depth salvage of complete objects from
  truncated arrays (built for scanner sector-impact under small-model output
  budgets).
- `lib/ai/streaming-json.ts` `JsonFieldStreamer` — incremental top-level-field
  parser for the streamed report; unknown keys dropped.

**Brittleness assessment:**
1. **No runtime schema validation anywhere.** `zod` is **not** a dependency
   (checked `package.json`). Types are asserted, not verified; enums like
   `verdict: "BUY"|"HOLD"|"SELL"` are trusted or hand-checked per caller.
   Phase 3's Zod plan is a new dependency decision, not a wiring change.
2. The `defaults`-coercion pattern means a malformed response **silently
   renders a fallback state** rather than erroring — good for UX, bad for
   noticing provider regressions. The golden-output harness (Phase 5) must
   compare structured fields, not just "did it render".
3. Free-text call sites (~15) have no parsing risk at all.
4. Historical failure worth carrying into schema design: Ollama's
   `format:"json"` + thinking returned literal `{}` — which *parses* — so every
   JSON task silently rendered fallbacks. Any Devin structured-output path must
   reject empty-but-valid objects (`structured_output_required` semantics —
   verify in Phase 2).
5. Prompt-side JSON discipline is centralized (`JSON_ONLY_INSTRUCTION`,
   `JSON_SCHEMA_LEAD_IN` in `lib/ai/prompts/index.ts`); schemas themselves are
   ~20 hand-written per-feature prompt blocks — the raw material for
   `structured_output_schema`.

## 5. Background / batch / cron surfaces

| Surface | Trigger | Cache |
|---|---|---|
| Scanner v2 pipeline (6 AI stages) | boot + hourly (`lib/scanner/scheduler.ts`, `UAA_SCANNER_INTERVAL_MS`) | `scanner_cache` (SQLite) via `persistScannerSnapshot` |
| Event screener v1 | on request, cached | `scanner_cache` |
| AI verdict | on request | `aiVerdict` policy in `lib/platform/registry.ts` (persisted; **refuses to cache offline fallbacks**) |
| Portfolio thesis / holding-explain | click-triggered | `scanner_cache` keyed per holding |
| In-flight coalescing | all `runTask` calls | `lib/platform/dedup.ts` FNV-1a fingerprint (task, model, json, temp, messages) — note: exists *because Ollama serialized*; still correct, less critical now |

There is no external queue, no cron daemon, no worker process — all
"background" work is in-process on the Next.js server. Phase 3's async job
model should respect that (SQLite-backed job table before any new infra).

## 6. Latency reference points (measured, this machine)

- Ollama era: mistral 7B structured task 7.4s; qwen3:14b same task 17.1s;
  report route 103s blocking / 28s to first streamed content; verdict worst
  observed 115.3s; thinking-enabled 143s. Nine IC agents: serialized, 3–9 min.
- Current CLI transport: light ~2.6–3.5s, standard ~5s, deep 4–8s; nine IC
  agents in parallel ≈10s; one-off ~5s first-spawn penalty per server process;
  live end-to-end through the app: NL screener 3–4s, full verdict route 18s
  (incl. market-data fan-out).

These are the numbers any sessions-API design must beat or justify missing.

## 7. Env & flag surface (current)

`OLLAMA_HOST`, `OLLAMA_MODEL`, `AI_PROVIDER_ORDER` (`devin,ollama` default),
`AI_MAX_MODEL_GB`, `AI_DISABLED_MODELS`, `AI_TASK_<NAME>` pins,
`DEVIN_CLI_BIN`, `DEVIN_CLI_WORKSPACE`, `DEVIN_CLI_CONCURRENCY`,
`DEVIN_CLI_DISABLED`. No `DEVIN_API_KEY`/`DEVIN_ORG_ID` exist yet; `.env.local`
and `.env.example` are the designated homes per the rules.
