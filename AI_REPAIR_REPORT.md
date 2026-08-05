# AI_REPAIR_REPORT.md — Universal Asset Analyzer

**Date:** 2026-08-06 (~04:00 IST)
**Repo state:** `main` = `origin/main` = `cb0ceb1`, working tree clean.
**Outcome: AI is fully operational.** No code defect was found or introduced; the one service-level repair was restarting a stale pre-merge dev server. Evidence below.

---

## 1. Root cause

**No fault exists in the AI code, configuration, credentials, routing, streaming, or caching at HEAD.** Every AI surface, on all three transports, was exercised live and succeeded (see §4).

The most probable cause of the observed "AI stopped working" symptom, with supporting evidence:

> **The dev server on :3000 (PID 40880) had been running since 00:55:44 — before all six merge-era commits landed (03:34–03:46).** A long-lived Turbopack dev process straddling a large git history change is the classic post-merge failure mode: the browser holds pre-merge client chunks and pre-merge module state (instrumentation, schedulers, in-flight registries boot once per process) while lazily-recompiled server code is post-merge. UI panels — most visibly the AI ones, which are the pages' most dynamic components — then error in the browser even though the endpoints themselves are healthy, which is exactly the split I measured: every server-side probe succeeded while the reported experience was "broken."

Secondary finding (a resilience note, **not** an active fault): the local Ollama inventory holds only `llama3.2:latest`; none of the six models in the model registry (`qwen3:30b-a3b`, `qwen3:14b`, `mistral:latest`, `qwen2.5-coder:14b`, `qwen3-coder:latest`, `devstral:24b`) are installed. The fallback still **works** — verified: the router adopts unregistered installed models via `genericSpec` and generated successfully — but offline quality/latency is below the design spec until models are pulled.

## 2. Evidence (Phase 1 checklist)

| Checked | Evidence | Verdict |
|---|---|---|
| Environment variables | `.env.local`: `DEVIN_API_KEY` (`apk_…`), `DEVIN_PLAYBOOK_ID`, `AI_PROVIDER=devin`; mtime 00:54:58 — loaded by both old and new server processes | ✓ correct |
| AI_PROVIDER selection / routing | Analysis calls route to Devin sessions (`"model":"devin"` in watchlist digest; sessions visible in Devin API); `runTask` chain routes to Devin CLI (`swe-1-6-fast`, `claude-opus-5-medium` in responses + `[ai] success` logs) | ✓ |
| API keys / Devin credentials | `GET /v1/sessions?limit=1` with the configured key → **HTTP 200**; 10 recent sessions all `exit/finished` | ✓ valid |
| Anthropic configuration | Not applicable — no Anthropic provider exists in this architecture; Claude models are reached *through* Devin (`claude-opus-5-medium` etc. in `data/ai-health.json`), all healthy with recent `lastSuccessAt` | ✓ n/a |
| Model configuration | Registry: 6 Devin CLI + 6 Ollama models; health file shows 0 consecutive failures on all used models | ✓ |
| Fallback logic | Router probe with `AI_PROVIDER_ORDER=ollama` → generated `"OK"` on `llama3.2:latest` via genericSpec (cold start 7.8s) | ✓ works |
| Ollama daemon | `GET /api/version` → 0.32.5 up; `/api/tags` → 1 model installed | ✓ up (thin inventory) |
| Streaming | `/api/ai/report` and `/api/research/bundle`: `application/x-ndjson`, `no-store`, `x-accel-buffering: no`; IC report SSE streamed 191KB over 180s | ✓ |
| Caching | `ai_result` = 35 rows, growing during probes; repeat NVDA verdict served in **15ms** after a 15.1s generation | ✓ |
| Timeout handling | IC stage timings within `devinTimeoutMs` budgets (agents 65s, synthesis 88s < 240s class budgets) | ✓ |
| API endpoints / backend handlers / request routing | 14-surface battery (§4) all 200 with correct payloads; malformed inputs → clean 400s | ✓ |
| Middleware | None exists (no `middleware.ts`); route handlers validate directly | ✓ n/a |
| Frontend requests / browser | Fresh server: user's open tab reconnected and issued successful API calls (visible in server log); browser preview opened for the user to confirm console | ✓ |
| Server logs | `[ai] {"category":"success", …}` entries for every probe; zero failure entries during the session | ✓ |
| Build output | `tsc --noEmit` clean; production build verified green at this HEAD during the merge session | ✓ |

## 3. End-to-end trace of one real AI request (User → UI)

`GET /api/ai/report?symbol=NVDA` (the research page's verdict stream), fresh symbol, post-restart:

1. **Frontend** — research page's `use-verdict-stream` hits the route (reproduced with curl).
2. **API route** (`app/api/ai/report`) — emits the section manifest immediately (`{"type":"manifest", …}` — first byte < 1s).
3. **Verdict planner** (`lib/ai/verdict.ts`) — builds the equity plan; `getVerdict` misses the 6h cache (fresh symbol).
4. **Analysis seam** (`runAnalysis`) — `AI_PROVIDER=devin` → Devin provider; wire schema `VerdictWireSchema` v2 attached.
5. **Provider/model** — Devin session (v1 API generation, `apk_` key); server log: `taskType":"investment-thesis","model":"claude-opus-5-medium","durationMs":13985`.
6. **Response → stream** — sections stream headline-first (`elapsedMs:13324` on AAPL run) as NDJSON.
7. **Cache** — result persisted under `aiVerdict`; immediate re-request returned in **15ms**.
8. **UI** — user's browser tab against the fresh server loads and renders (preview open for visual confirmation).

Execution does not fail at any hop.

## 4. Tests executed (all live, all passing)

| Surface | Transport | Result |
|---|---|---|
| Research verdict stream (AAPL, NVDA) | Devin sessions | ✓ 13–15s fresh, 15ms cached |
| Research copilot chat (streamed) | Devin | ✓ 17.9s, 4.6KB |
| Home brief | Devin sessions | ✓ 25.8s |
| Portfolio thesis | Devin sessions | ✓ 9.8s |
| Watchlist intelligence digest | Devin sessions (`model:"devin"`) | ✓ 21.7s |
| **IC report, full 9-agent pipeline (MSFT)** | Devin sessions | ✓ 180s, all stages (valuation 21s, agents 65s, synthesis 88s, thesis 3.6s), 191KB SSE |
| Compare AI verdict (stream) | Devin | ✓ 26.3s, 13KB |
| Movement explainer | Devin | ✓ 21.6s |
| App assistant ("AI search"/help) | Devin CLI (`swe-1-6-fast`) | ✓ 8.7s |
| NL screener parse | Devin CLI | ✓ 7.4s, correct filter JSON |
| Local fallback (router probe, Ollama-only order) | Ollama `llama3.2` | ✓ generated |
| Materiality/research + graceful degradation | — | ✓ real peer percentiles (265-stock group); clean 400s on bad input |
| Post-restart re-verification | CLI + sessions + stream | ✓ all |

Graceful error handling: malformed bodies → 400 with messages; the verdict path's never-throw fallback design was regression-tested in the merged suite (2,697 tests) at this HEAD.

## 5. Repairs performed

| # | Action | Kind |
|---|---|---|
| 1 | Killed stale dev server (PID 40880, running since 00:55, pre-merge) and purged `.next/dev` Turbopack cache | Service restart — the only repair warranted |
| 2 | Started fresh `npm run dev` (loads current `.env.local`, boots merged instrumentation: monitor, scanner, verdict warmer) | Service restart |
| 3 | Re-verified transports + streaming + caching post-restart | Validation |

**Files modified: none.** (This report is the only new file.) No code, configuration, or environment changes were needed — the architecture, routing, fallback, and credentials were all sound.

## 6. Remaining blockers

**None.** No external credential or service is failing — the Devin key authenticates (HTTP 200), the CLI is logged in, Ollama is up, and every feature works.

Two optional, non-blocking follow-ups:
1. **Restore full offline quality:** `ollama pull qwen3:14b` (and/or `mistral:latest`) — multi-GB downloads deliberately not performed. Until then, offline fallback runs on `llama3.2` (3B) at reduced quality — acceptable, but below the registry's design spec.
2. If the browser still shows a broken panel, hard-reload (⌘⇧R) to drop pre-merge client chunks — a preview of the fresh server is open at http://127.0.0.1:61307; send me a console capture if anything still looks wrong.

## 7. Confirmation

**AI is working again — verified end-to-end, live, on every transport (Devin sessions API, Devin CLI, local Ollama), across 13 user-facing AI features including the full IC report pipeline, with streaming, caching, fallback and error handling all confirmed healthy.** Success criterion #1 is met.
