# AI Platform

Single entry point for every AI request in UAA. Feature code never talks to a
backend and never names a model — it names a *task*, and the Router picks the
best routable model for it, falling back automatically if that attempt fails.

**One backend, bring your own key.** The provider is the Anthropic API
(`api.anthropic.com`), the model is `claude-opus-5`, and the credential is the
user's own key — `ANTHROPIC_API_KEY` env var first (demo/CI), then the local
key file `~/.uaa/anthropic_api_key` saved from `/settings` (see
`anthropic-key.ts` for the storage/egress guarantees). Per-task reasoning depth
is expressed as three routable ids — `claude-opus-5-low|-medium|-high` — that
the provider translates into `output_config.effort` on the wire.

Every number in the product is computed by the deterministic engines; the model
only narrates. No prompt asks the model to produce, transform, or round a
figure that reaches the UI, and the grounding layer (`grounding.ts`) verifies
generated figures against the evidence they were given.

## Request flow

```
Feature code
  │  runPrompt(taskType, prompt)          lib/ai.ts — thin façade
  │  runTask / runTaskText / runTaskStream / runTaskChat
  ▼
Orchestrator                              lib/ai/orchestrator.ts
  ▼
Router                                    lib/ai/router.ts
  │  for each provider, in order:
  │  1. ELIGIBILITY  available ∧ enabled ∧ has required caps
  │  2. SCORE        quality vs speed, weighted by the task's own requirements
  │  3. TIEBREAK     registry priority, then id  (fully deterministic)
  │  ← provider chain lib/ai/config.ts  (one entry: anthropic)
  │  ← config pins    lib/ai/config.ts  (env / static overrides beat the scorer)
  │  ← task needs     lib/ai/task-registry.ts
  │  ← model facts    lib/ai/models.ts
  ▼
AIProvider                                lib/ai/provider.ts
  └─ AnthropicProvider                    lib/ai/providers/anthropic-provider.ts
       └─ api.anthropic.com              explicit baseURL; the user's key;
                                          real token streaming
```

## What each tier routes to

One model, three effort depths. The pin per task complexity
(`config.ts:TASK_MODEL_PINS`):

| Task complexity | Pin (primary → fallback) |
|---|---|
| `deep` (thesis, filings, IC agents) | `claude-opus-5-high` → `-medium` |
| `standard` (research, comparison, portfolio) | `claude-opus-5-medium` → `-low` |
| `light` / `interactive` (nl-screener, summaries, chart-QA) | `claude-opus-5-low` |

A failing high-effort attempt degrades to a shallower tier of the same model
rather than to nothing.

Responses are normalized (`response.ts`) into `{ content, confidence,
reasoningSummary, executionTimeMs, model, provider, tokenUsage, errors,
metadata }`. No feature code branches on which model answered.

## Notes that are not style preferences

**1. Health checks are key-presence, not paid round trips.** The Router
health-checks providers on hot paths; the provider answers from
`resolveApiKey()` and lets the first real request surface auth/network
failures, which produce far better errors than a probe would.

**2. JSON mode and thinking are mutually exclusive** at the request level
(`router.ts:resolveThinking()`), a rule kept from the era of hybrid local
reasoning models where the combination silently returned `{}`. The Claude
effort tiers have no per-request thinking toggle — depth rides on the model id
— so the rule is dormant but still asserted by tests.

**3. The local-provider machinery (memory gate, generation gate, cold-start
budgets, warm probes) is dormant, not deleted.** It keys off
`isHostedProvider()` and never runs for the hosted chain. It is the
provider-agnostic contract a future local runtime would need
(`ProviderModelInfo.sizeGb`, `AIProvider.isModelWarm`), and the router tests
exercise it with fake local providers.

## Where to change what

| To do this... | Edit this | Not this |
|---|---|---|
| Change which effort tier a task uses | `config.ts` (`TASK_MODEL_PINS`, or `AI_TASK_<NAME>` env) | any feature module |
| Add a task | `task-registry.ts` — declare complexity/latency/context/output | — |
| Add or re-tune a model | `models.ts` (`MODEL_REGISTRY`) | any feature module |
| Bench a model | `AI_DISABLED_MODELS`, or `enabled: false` | deleting its entry |
| Add a provider | new `AIProvider` in `providers/`, added to `PROVIDER_FACTORIES` (router.ts) + `PROVIDER_CHAIN` (config.ts) + `PROVIDER_LOCALITY` (models.ts) | orchestrator, feature code |
| Manage the API key | `/settings` in-app, or `ANTHROPIC_API_KEY` | anything that would log it |

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

- **No temperature on the wire.** `claude-opus-5` does not accept the field;
  the provider accepts the Router's computed value and deliberately ignores it
  rather than pretending otherwise.
- **No mass prompt migration.** `prompts/` centralizes the shared JSON
  directives. The ~20 hand-tuned feature prompts stay next to their features:
  they are schema-specific, not duplicated templates, and rewording them is a
  quality-sensitive change that needs per-model evaluation.
- **No persisted health state.** `health.ts` is in-memory, per-process.
- **No key exposure.** The key is read by `anthropic-key.ts`, sent to
  `api.anthropic.com` (explicit `baseURL` — a stray `ANTHROPIC_BASE_URL` env
  var cannot redirect it), and appears in no log line, no error message, and
  no API response (`/api/settings/ai-key` reports presence only).
