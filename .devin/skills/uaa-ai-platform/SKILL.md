---
name: uaa-ai-platform
description: Work on UAA's AI layer (provider chain, routing, prompts, models, Ollama) with the correct gates, eval harnesses, and host-memory rules
---

Rules and workflow for `lib/ai/`. Read `lib/ai/ARCHITECTURE.md` BEFORE changing anything here — it is the authoritative map.

## Non-negotiables

- All inference goes through `runPrompt(taskType, …)` / the orchestrator. NEVER call a provider SDK directly from feature code.
- The backend is a provider-agnostic CHAIN: `AI_PROVIDER_ORDER`, default `devin → anthropic → openai → gemini → openrouter → ollama`. The Devin CLI provider (`lib/ai/devin-cli.ts`) is the keyless default; BYO-key providers resolve keys via `lib/ai/anthropic-key.ts` / `lib/ai/keys.ts` (env var, then `~/.uaa/<provider>_api_key`) and are dormant without a key. Keys are never logged.
- Task→model pins live in `lib/ai/config.ts` + `lib/ai/task-registry.ts` (claude-opus-5 effort tiers served by both devin and anthropic). The chain decides who answers.
- Never hand-write AI-unavailable recovery copy — use `AI_RECOVERY_HINT` from `lib/ai/availability.ts`.
- `lib/ai/telemetry.ts` is the only writer of the `ai_call` ledger.

## Verification ladder (cheapest first)

1. Offline unit tests (free, always): `npx vitest run tests/ai-*.test.ts` — provider chain, router, task registry, schemas, telemetry, prompt cache are all covered offline, including recorded eval outputs (`tests/ai-eval/recorded-outputs.test.ts`).
2. Live end-to-end (small spend, needs user's plan/key): `LIVE_AI=1 npx vitest run tests/ai-platform-live.test.ts`
3. Golden workflow eval (live, ~$0.05/run): `npx tsx scripts/ai-eval.ts` — REQUIRED gate before any model swap or effort-tier repin; gate the candidate with `--model` BEFORE changing the pin.
4. Cache/latency bench: `npx tsx scripts/ai-bench.ts --suite cache` — prompt-cache write→read + TTFT.

Ask the user before running live steps (2–4); they spend real money/plan.

## Instrumentation — measure, don't guess

Routing/caching/tiering decisions are tuned from the `ai_call` ledger, rendered at `/dev/ai`:
```bash
sqlite3 "file:data/app.db?mode=ro" "SELECT task_type, provider, model, outcome, count(*) n, round(avg(ttft_ms)) ttft, sum(cost_usd) cost FROM ai_call GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 20;"
```
Fallback depth, cache-hit rate, and live spend all come from here. Structured routing logs: `lib/ai/log.ts` (one machine-parseable line per outcome).

## Ollama / local models — host-safety rules (16 GB M4)

- Never leave a local model resident; never `kill -9 ollama serve` (SIGKILL orphans the runner and strands wired Metal memory until reboot — measured on this host).
- Use `scripts/ops/uaa stop` (drains runners before the daemon) and `scripts/ops/uaa status` (wired RAM, swap, Ollama state).
- Diagnostic signature of a leaked runner: an IDLE GPU pinning multiple GB.
- Memory gate: `AI_MAX_MODEL_GB`; disable models with `AI_DISABLED_MODELS`; endpoint `OLLAMA_HOST` (default `http://localhost:11434`).

## Prompt/schema changes

Task declarations (complexity, latency budget, context, output schema) live in `lib/ai/task-registry.ts`; prompts under `lib/ai/prompts/`; structured outputs validated by zod schemas in `lib/ai/schemas/`. A schema change requires updating the offline tests AND rerunning `ai-eval` if it affects a golden workflow.
