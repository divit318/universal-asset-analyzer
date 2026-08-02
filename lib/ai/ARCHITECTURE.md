# AI Platform

Single entry point for every AI request in UAA. Feature code never talks to a
backend and never names a model — it names a *task*, and the Router picks the
best model that can actually run it here, falling back automatically if that
model fails.

**Hosted-first, local-fallback.** The Router walks a chain of providers: Devin
CLI (hosted frontier models) first, Ollama (local) second. Set
`AI_PROVIDER_ORDER` to reorder or to run one only. The local path is not
vestigial — it is what keeps UAA working on a plane or logged out, which is the
product's premise.

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
  │  1. ELIGIBILITY  available ∧ enabled ∧ fits-in-memory ∧ has required caps
  │  2. SCORE        quality vs speed, weighted by the task's own requirements
  │  3. TIEBREAK     registry priority, then id  (fully deterministic)
  │  ← provider order lib/ai/config.ts  (AI_PROVIDER_ORDER)
  │  ← config pins   lib/ai/config.ts  (env / static overrides beat the scorer)
  │  ← task needs    lib/ai/task-registry.ts
  │  ← model facts   lib/ai/models.ts
  ▼
AIProvider                                lib/ai/provider.ts
  ├─ DevinProvider                        lib/ai/providers/devin-provider.ts
  │    └─ `devin -p` subprocess           lib/ai/devin-cli.ts — the only spawn site
  └─ OllamaProvider                       lib/ai/providers/ollama-provider.ts
       └─ Ollama (localhost:11434)        lib/ai/ollama.ts — the only HTTP layer
```

Provider enumeration is **lazy**: Ollama's model list is never fetched when
Devin answers, because that probe costs an HTTP round trip with a 4s timeout on
every single request.

## What each tier routes to

| Task complexity | Model | Measured | Cost |
|---|---|---|---|
| `deep` (thesis, filings, IC agents) | `claude-opus-5-medium` | 4-6s | $5/$25 per MTok |
| `standard` (research, comparison, portfolio) | `claude-sonnet-5-low` | ~5s | $2/$10 |
| `light` / `interactive` (nl-screener, summaries, chart-QA) | `swe-1-6-fast` | ~3s | $0.3/$1.5 |

For reference, the local models answered the same prompts in 28-115s, and
serialized: nine concurrent IC-agent calls take ~10s hosted against minutes
locally. There is a one-off ~5s cost on the first spawn in a server process.

Responses are normalized (`response.ts`) into `{ content, confidence,
reasoningSummary, executionTimeMs, model, provider, tokenUsage, errors,
metadata }`. No feature code branches on which model answered.

## Two rules that are not style preferences

**1. Memory is a hard gate, not a ranking penalty.**
A model whose weights exceed the memory budget does not return a worse answer —
it thrashes. Measured on a 17GB M4: `qwen3:30b-a3b` (18.6GB) ran at **0.9 tok/s,
302s for a single completion**, while 4.4GB mistral answered the same prompt at
10.5 tok/s. An MoE with 3.3B active params "should" have been the fast one;
fitting in RAM matters more than parameter count does. The budget is derived from
`os.totalmem()`, so the same registry is correct on a laptop and on a workstation.

**2. JSON mode and thinking are mutually exclusive.**
Qwen3 under `format: "json"` with thinking on returns the literal string `{}` —
two tokens, 0/3 valid across trials, versus 3/3 with thinking off. `{}` *parses*,
so this failed completely silently: ~14 tasks were receiving an empty object and
quietly rendering their fallback state. `router.ts:resolveThinking()` forces
`think: false` whenever `json` is set, and a test asserts that no task config can
combine the two.

Thinking is off everywhere by default: it measured **143s vs 28s (5x)** on
qwen3:14b for a comparable answer. It is a per-task knob (`thinking: true`), not
a default.

## Where to change what

| To do this... | Edit this | Not this |
|---|---|---|
| Change which model a task uses | `config.ts` (`TASK_MODEL_PINS`, or `AI_TASK_<NAME>` env) | any feature module |
| Add a task | `task-registry.ts` — declare complexity/latency/context/output | — |
| Add or re-tune a model | `models.ts` (`MODEL_REGISTRY`) | any feature module |
| Bench a model | `AI_DISABLED_MODELS`, or `enabled: false` | deleting its entry |
| Change the memory ceiling | `AI_MAX_MODEL_GB` | `router.ts` |
| Add a provider | new `AIProvider` in `providers/`, added to `PROVIDER_FACTORIES` + `KNOWN_PROVIDERS` | orchestrator, feature code |
| Reorder / disable a provider | `AI_PROVIDER_ORDER`, or `DEVIN_CLI_DISABLED=1` | `router.ts` |

A task declares what it *needs*; it never names a model. That indirection is the
whole point: the previous registry hand-maintained a `preferredModels` list per
task — 30 copies of one policy — and drifted so far that the top preference of
every reasoning-heavy task (`deepseek-r1`) was **not even installed**.

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
gets its model from the Router and streams through `runTaskChat`, like everything
else. It no longer calls Ollama directly.

## What this layer deliberately does not do

- **No token streaming on the hosted path.** `devin -p` buffers the whole
  answer, so `DevinProvider.stream()` yields exactly one chunk. It still beats
  Ollama's *first* token by a wide margin. `devin acp` (JSON-RPC over stdio) is
  the upgrade path if real deltas turn out to matter.
- **No sampling controls on the hosted path.** Print mode exposes no
  temperature, top-p or max-tokens. The Router still computes them; the Devin
  provider accepts and ignores them rather than pretending otherwise.
- **No chain-of-thought from hosted models.** Their reasoning never reaches
  stdout, so `reasoning` is `""` — not a summary fabricated from the answer.
- **No mass prompt migration.** `prompts/` centralizes the shared JSON
  directives. The ~20 hand-tuned feature prompts stay next to their features:
  they are schema-specific, not duplicated templates, and rewording them is a
  quality-sensitive change that needs per-model evaluation.
- **No two-phase reason-then-format.** Deep JSON tasks therefore cannot use
  thinking at all. Doing it properly means reasoning in prose then formatting in
  a second pass — roughly double the latency, and it needs its own evaluation.
- **No persisted health state.** `health.ts` is in-memory, per-process.
