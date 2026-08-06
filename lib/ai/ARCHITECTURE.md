# AI Platform

Single entry point for every AI request in UAA. Feature code never talks to a
backend and never names a model — it names a *task*, and the Router picks the
best routable model for it, falling back automatically if that attempt fails.

**Provider-agnostic, six backends, zero required keys (2026-08-06).** The
Router walks a configurable provider chain (`config.ts:providerOrder()`,
default `devin → anthropic → openai → gemini → openrouter → ollama`,
reorderable via `AI_PROVIDER_ORDER`) and uses the first provider that can
serve the routed model:

| Provider | Transport | Credential |
|---|---|---|
| `devin` | `devin -p` subprocess (`devin-cli.ts`) — Cognition-hosted models | the user's `devin login` — **no API key** |
| `anthropic` | `api.anthropic.com` (SDK, real token streaming, prompt caching, native structured outputs) | `ANTHROPIC_API_KEY` env, then `~/.uaa/anthropic_api_key` (`anthropic-key.ts`) |
| `openai` / `openrouter` | chat-completions over fetch (`openai-compatible-provider.ts`) | `OPENAI_API_KEY` / `OPENROUTER_API_KEY` env, then `~/.uaa/*` (`keys.ts`) |
| `gemini` | Generative Language API over fetch (`gemini-provider.ts`) | `GEMINI_API_KEY`/`GOOGLE_API_KEY` env, then `~/.uaa/gemini_api_key` |
| `ollama` | local daemon (`ollama.ts`) — memory-gated, serialized | none (local) |

The BYO-key providers are dormant until a key exists (health = key presence);
the Devin CLI is the out-of-the-box default because it needs no key at all.
Per-task reasoning depth is expressed as three routable ids —
`claude-opus-5-low|-medium|-high` — which BOTH the Devin catalogue and the
Anthropic API serve under the same ids (`models.ts:alsoServedBy`): the
Anthropic provider translates the suffix into `output_config.effort` on the
wire, the Devin provider passes the uid through.

Every number in the product is computed by the deterministic engines; the model
only narrates. No prompt asks the model to produce, transform, or round a
figure that reaches the UI, and the grounding layer (`grounding.ts`) verifies
generated figures against the evidence they were given.

## Request flow

```
User (page / feature UI)
  ▼
Feature code
  │  runPrompt(taskType, prompt)          lib/ai.ts — thin façade
  │  runTask / runTaskText / runTaskStream / runTaskChat
  ▼
Orchestrator                              lib/ai/orchestrator.ts  (dedup/coalescing)
  ▼
Router                                    lib/ai/router.ts
  │  for each provider, in chain order:
  │  1. ELIGIBILITY  available ∧ enabled ∧ has required caps
  │  2. SCORE        quality vs speed, weighted by the task's own requirements
  │  3. TIEBREAK     registry priority, then id  (fully deterministic)
  │  ← provider chain lib/ai/config.ts  (AI_PROVIDER_ORDER; default devin-first)
  │  ← config pins    lib/ai/config.ts  (env / static overrides beat the scorer)
  │  ← task needs     lib/ai/task-registry.ts
  │  ← model facts    lib/ai/models.ts  (incl. alsoServedBy cross-provider ids)
  ▼
AIProvider                                lib/ai/provider.ts
  ├─ DevinProvider                        providers/devin-provider.ts
  │    └─ `devin -p` subprocess           lib/ai/devin-cli.ts — isolated
  │         └─ Cognition-hosted model     workspace, tools denied, user's
  │                                       `devin login`, NO API key
  ├─ AnthropicProvider                    providers/anthropic-provider.ts
  │    └─ api.anthropic.com               explicit baseURL; the user's key;
  │                                       real token streaming
  ├─ OpenAIProvider / OpenRouterProvider  providers/openai-compatible-provider.ts
  ├─ GeminiProvider                       providers/gemini-provider.ts
  └─ OllamaProvider                       providers/ollama-provider.ts (local)
  ▼
Normalized AIResponse                     lib/ai/response.ts
  ▼
Feature parse (Zod schemas / tolerant JSON) → grounding verification → UI
```

## What each tier routes to

One model family, three effort depths. The pin per task complexity
(`config.ts:TASK_MODEL_PINS`):

| Task complexity | Pin (primary → fallback) |
|---|---|
| `deep` (thesis, filings, IC agents) | `claude-opus-5-high` → `-medium` |
| `standard` (research, comparison, portfolio) | `claude-opus-5-medium` → `-low` |
| `light` / `interactive` (nl-screener, summaries, chart-QA) | `claude-opus-5-low` |

Pins are model ids, not provider choices: each pinned id resolves against the
provider chain in order, so the same table serves Devin-first (no key) and
API-first (BYO key) setups without edits. A failing high-effort attempt
degrades to a shallower tier of the same model rather than to nothing, and a
provider whose credential is rejected is skipped for the rest of the chain
walk (same key ⇒ same rejection; the error survives classification as
`bad_api_key`, never a generic "try again"). The Devin catalogue also offers
`adaptive` (Devin's own per-prompt model router), `claude-sonnet-5-low`, and
`swe-1-6-fast` as routable/pinnable ids.

Responses are normalized (`response.ts`) into `{ content, confidence,
reasoningSummary, executionTimeMs, model, provider, tokenUsage, errors,
metadata }`. No feature code branches on which model answered.

## Instrumentation, caching, and output contracts (2026-08-06)

**Telemetry** (`telemetry.ts` → `ai_call` in SQLite, rendered at `/dev/ai`):
every Router attempt — success or failure — records task, provider, model,
fallback depth, duration, queue time, TTFT (streamed), token usage split by
prompt-cache creation/read, and estimated USD cost (registry pricing ×
reported usage; an estimate, never billing truth). Ledger writes never throw,
and are opt-in under vitest (`AI_TELEMETRY_IN_TESTS=1`). This is the
instrument every routing/caching/tiering decision is judged against.

**Prompt caching** (`anthropic-provider.ts:buildCachedPrompt`): up to two
`cache_control` breakpoints — the system block always (free below the API's
cacheable minimum, 0.1×-priced reads above it), and the last assistant turn
only in real multi-turn conversations (the Copilot layout pins system +
dossier + prior turns). One-shot prompts get no turn breakpoint: a cache
write with no reader is a pure +25% on the written tokens. Placement never
changes a prompt byte. `AI_PROMPT_CACHE=off` for A/B runs;
`scripts/ai-bench.ts --suite cache` verifies write→read on the wire.

**Native structured outputs**: a caller-supplied JSON Schema
(`RunTaskOptions.jsonSchema` → `output_config.format`) makes schema validity
a decoding guarantee. The analysis seam compiles each request's `wireSchema`
via `z.toJSONSchema` (best-effort — anything uncompilable degrades to the
prompt-directed JSON path unchanged), and the tolerant parse still runs: it
carries the semantic guards and legacy-row defaults.

**Evals** (`tests/ai-eval/golden.ts`): golden workflow cases built with the
production prompt builders and graded deterministically (schema, membership
guards, the grounding verifier). `scripts/ai-eval.ts` runs them live — the
gate a model swap or effort repin must pass (`--model` pins a candidate);
`--record` snapshots outputs that CI re-grades offline
(`tests/ai-eval/recorded-outputs.test.ts`).

## Notes that are not style preferences

**1. Health checks are cheap, not paid round trips.** The Router
health-checks providers on hot paths; the keyed providers answer from key
presence (`resolveApiKey()` / `keys.ts`), the Devin provider from a
ten-minute-cached `devin models list`, and the first real request surfaces
auth/network failures, which produce far better errors than a probe would.

**2. JSON mode and thinking are mutually exclusive** at the request level
(`router.ts:resolveThinking()`), a rule kept from the era of hybrid local
reasoning models where the combination silently returned `{}`. The Claude
effort tiers have no per-request thinking toggle — depth rides on the model id
— so the rule is dormant but still asserted by tests.

**3. The local-provider machinery (memory gate, generation gate, cold-start
budgets, warm probes) is live again for Ollama.** It keys off
`isHostedProvider()` and never runs for the hosted providers (including the
Devin CLI: a local subprocess, but the weights run on Cognition's hosts —
no local RAM, genuinely parallel). It was kept dormant through the
single-backend era precisely so the local tier could be restored as a
registry entry rather than a Router rewrite — which is what happened.

## Where to change what

| To do this... | Edit this | Not this |
|---|---|---|
| Change which effort tier a task uses | `config.ts` (`TASK_MODEL_PINS`, or `AI_TASK_<NAME>` env) | any feature module |
| Add a task | `task-registry.ts` — declare complexity/latency/context/output | — |
| Add or re-tune a model | `models.ts` (`MODEL_REGISTRY`) | any feature module |
| Bench a model | `AI_DISABLED_MODELS`, or `enabled: false` | deleting its entry |
| Reorder / restrict the provider chain | `AI_PROVIDER_ORDER` env (`config.ts`) | any feature module |
| Add a provider | new `AIProvider` in `providers/`, added to `PROVIDER_FACTORIES` (router.ts) + `DEFAULT_PROVIDER_ORDER`/`KNOWN_PROVIDERS` (config.ts) + `PROVIDER_LOCALITY` (models.ts) (+ `keys.ts` if BYO-key) | orchestrator, feature code |
| Manage API keys | `/settings` in-app, or the provider's env var | anything that would log them |

A task declares what it *needs*; it never names a model. That indirection is the
whole point: the previous registry hand-maintained a `preferredModels` list per
task — 30 copies of one policy — and drifted so far that the top preference of
every reasoning-heavy task was **not even installed**.

## Call shapes

```ts
import { runPrompt, runPromptWithMeta } from "@/lib/ai";
const raw             = await runPrompt("watchlist-intelligence", prompt, { json: true });
const { text, model } = await runPromptWithMeta("company-research", prompt);

import { runTask, runTaskStream, runTaskChat } from "@/lib/ai/orchestrator";
const res = await runTask("scenario-analysis", prompt);   // full normalized response
for await (const d of runTaskStream("market-summary", prompt)) { /* ... */ }

// Multi-turn + streamed reasoning (the Research Copilot, the CIO audit memo).
for await (const delta of runTaskChat("company-research", messages, {
  onReasoning: (t) => sendReasoningDelta(t),
})) { /* ... */ }
```

An explicit `opts.model` (a user-picked model in the UI) is honored strictly —
the Router will not silently substitute another one if it fails.

## The Research Copilot is a special case, not an exception

`context.ts`, `retrieval.ts`, `prompt.ts`, `memory.ts`, `actions.ts` and
`grounding.ts` implement a richer pipeline specific to multi-turn,
evidence-grounded chat: context assembly, intent classification, token-budgeted
retrieval, dossier prompting, session persistence, and post-hoc grounding
verification. None of that is task routing, so it stays its own layer — but it
gets its model from the Router and streams through `runTaskChat`, like
everything else. It never calls a provider directly.

## What this layer deliberately does not do

- **No temperature on the wire.** `claude-opus-5` does not accept the field,
  several current OpenAI reasoning models reject non-default values, and
  `devin -p` has no sampling controls at all; every hosted provider accepts
  the Router's computed value and deliberately ignores it rather than
  pretending otherwise.
- **No mass prompt migration.** `prompts/` centralizes the shared JSON
  directives. The ~20 hand-tuned feature prompts stay next to their features:
  they are schema-specific, not duplicated templates, and rewording them is a
  quality-sensitive change that needs per-model evaluation.
- **No persisted health state.** `health.ts` is in-memory, per-process.
- **No key exposure.** Keys are read by `anthropic-key.ts` / `keys.ts`, sent
  only to their own provider's pinned endpoint (the Anthropic client uses an
  explicit `baseURL` — a stray `ANTHROPIC_BASE_URL` env var cannot redirect
  it; the Gemini key rides in a header, never a query string), and appear in
  no log line, no error message, and no API response
  (`/api/settings/ai-key(s|-providers)` report presence only). The Devin CLI
  path involves no key at all; its prompt files are written to an isolated
  scratch workspace and deleted after every call, and the agent's tools are
  denied so it cannot read files or reach the network from a prompt.
