# PLAN: AI Platform

Redesign of UAA's AI layer into a centralized, measurement-driven multi-model platform.

## TL;DR

The abstractions the brief asks for (Model Registry, Task Registry, Router, Provider, Orchestrator)
**already exist** and are well-factored. The problem is not the shape of the architecture — it is that
**every input to it is wrong**, and the errors are silent.

The audit found one severe production bug: **~14 of UAA's 30 AI tasks currently return `{}`.**

This plan fixes the inputs, adds the one abstraction genuinely missing (a hardware-feasibility filter),
replaces 30 hand-maintained model lists with declarative task requirements, and closes the two
streaming bypasses.

---

## Phase 1 — Audit

### 1.1 What already exists (and is good)

| Layer | File | Verdict |
|---|---|---|
| Model Registry | `lib/ai/models.ts` | Exists. Contents wrong. |
| Task Registry | `lib/ai/task-registry.ts` | Exists. 30 tasks. Routing policy wrong. |
| Router | `lib/ai/router.ts` | Exists. Fallback + health tracking are sound. |
| Provider abstraction | `lib/ai/provider.ts` + `providers/ollama-provider.ts` | Exists. Clean interface. |
| Orchestrator (entry point) | `lib/ai/orchestrator.ts`, façade `lib/ai.ts` | Exists. API too narrow (see 1.5). |
| Response normalizer | `lib/ai/response.ts` | Exists. Fine. |
| Health/circuit breaker | `lib/ai/health.ts` | Exists. Fine. |
| Prompt Builder | `lib/ai/prompt-builder.ts` | Exists but **unused** by feature code. |
| Config | — | **Missing.** Routing policy is hardcoded in the task registry. |

~38 feature modules already call `runPrompt`/`runTask`. The task-based indirection the brief asks for is
mostly in place. **This is a repair-and-extend job, not a rewrite.** Ripping it out to rebuild the same
five boxes would be churn.

### 1.2 Hardware ground truth (measured, not assumed)

Host: **Apple M4, 17 GB unified memory.** This is the single most important fact in this document, and
nothing in the current registry accounts for it.

```
$ ollama list
qwen3:14b            9.3 GB    14.8B dense
qwen3:30b-a3b       18.6 GB    30.5B MoE (3.3B active)
devstral:24b        14.3 GB    23.6B dense (coding)
qwen2.5-coder:14b    9.0 GB    14.8B dense (coding)
qwen3-coder:latest  18.6 GB    30.5B MoE (coding)
mistral:latest       4.4 GB     7.2B dense
```

Three of six models are **larger than or near the machine's entire RAM.**

### 1.3 Measured performance (identical equity-analysis prompt)

| Model | Speed | Wall | Answer | Note |
|---|---|---|---|---|
| `mistral:latest` | **10.5 tok/s** | 24s | 1055 chars | Fits easily |
| `qwen3:14b` | 5.0 tok/s | 28–37s | 828 chars | Fits |
| `qwen3:30b-a3b` | **0.9 tok/s** | **302s** | — | **Thrashes: 18.6 GB into 17 GB** |

The intuition "the 30B MoE has only 3.3B active params, so it will be the fast one" is **false on this
machine**. It cannot be resident, so it swaps, and it is **11× slower than mistral**. Prompt eval alone
took 19.8s. Any routing table that prefers it produces a 5-minute page load.

`qwen3-coder` is the same 18.6 GB and inherits the same fate. `devstral:24b` at 14.3 GB is at the edge.

### 1.4 The `{}` bug (severity: critical)

Ollama now returns reasoning in a **separate `thinking` response field**, not as inline `<think>` tags.
Two consequences, both silent:

1. `splitThinking()` (`lib/ai/ollama.ts`) scans the answer text for `<think>` tags. It never matches
   anymore. Dead code that *looks* like it is working.
2. **qwen3 + `format: json` returns literally `{}`** — 2 tokens, `done_reason: stop`:

```
$ generate(qwen3:14b, "Score AAPL... respond ONLY with JSON", format=json)
  response  : '{}'
  eval_count: 2
```

Measured reliability over 3 runs of a realistic scoring task:

| Config | Valid JSON | Avg wall |
|---|---|---|
| `mistral` | **3/3** | **7.4s** |
| `qwen3:14b`, `think: false` | **3/3** | 17.1s |
| `qwen3:14b`, thinking **on** (today's behavior) | **0/3** | 0.8s |

`{}` is *valid JSON*. It parses. `extractJson` returns it happily. Every downstream feature receives an
object with no fields and quietly renders its empty/fallback state. Nothing throws, nothing logs.

**14 of 30 tasks declare `jsonMode: true` and route to qwen3**: `investment-thesis`,
`sec-filing-analysis`, `risk-review`, `accounting-red-flags`, `scenario-analysis`, `stress-testing`,
`portfolio-intelligence`, `watchlist-intelligence`, `opportunity-engine`, `comparison`,
`ic-agent-analysis`, `thematic-analysis`, `timeline-analysis`, `nl-screener`.

All of them are returning `{}` today. This is the headline finding of the audit.

### 1.5 The thinking tax

qwen3 is a *hybrid* reasoning model: thinking is **on by default**, and nothing in UAA turns it off.
Same prompt, same model:

| | Wall | Tokens | Thinking | Answer |
|---|---|---|---|---|
| thinking **on** | **143.1s** | 718 | 2288 chars | 884 chars |
| thinking **off** | **28.4s** | 146 | 0 | 677 chars |

**5× the latency** to produce a comparable answer. UAA pays this tax on every non-JSON qwen3 call today
and gets little for it.

### 1.6 Registry vs. reality

`MODEL_REGISTRY` lists `qwen3`, `deepseek-r1`, `qwen2.5-coder`, `llama3.1`, `mistral`.

- **`deepseek-r1` and `llama3.1` are not installed.** They are the *first* preference for the
  reasoning-heavy tasks (`sec-filing-analysis`, `risk-review`, `scenario-analysis`,
  `accounting-red-flags`). Every one of those preferences silently resolves to nothing.
- **`devstral` and `qwen3-coder` are unknown to the registry.** They fall to `genericSpec()`, which
  infers capabilities from the *name*. `devstral` contains no known keyword → it is tagged
  `capabilities: ["fast"]`. A 23.6B dense coding model is labelled **fast**.
- **`qwen3:30b-a3b` and `qwen3:14b` both collapse to the same `"qwen3"` spec** — `specForInstalled`
  matches on the `:`-tag base. The registry is *structurally incapable* of distinguishing the 18.6 GB
  model that thrashes from the 9.3 GB one that works. Which one you get depends on the order
  `/api/tags` happens to return them in.

### 1.7 Other hardcoded / stale model references

- `lib/ai/ollama.ts:16` — `DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2"`. **`llama3.2` is not
  installed.** Sole use is `generate()`'s fallback when no model is passed.
- `.env.local` — `OLLAMA_MODEL=mistral`. Would pin *every* default to the weakest model. It currently
  misfires only by luck: `pickDefaultModel` does an exact-array match, and the installed id is
  `mistral:latest`, not `mistral`.

### 1.8 Bypasses of the platform

Only two, and both bypass for the *same legitimate reason* — the orchestrator's API cannot express what
they need:

| Route | Bypass | Why |
|---|---|---|
| `app/api/research/chat/route.ts` | calls `streamChat()` directly | needs multi-turn `messages[]`, streamed **reasoning deltas**, and `numCtx` |
| `app/api/portfolio/audit/route.ts` | calls `streamChat()` directly | needs `numCtx` + a system turn |

Both *do* call `pickModel()` first — so they respect routing — but they skip the router's fallback chain
and health tracking. `runTask`/`runTaskStream` only accept `(prompt: string, system?: string)` and
`routeStream` never forwards `onReasoning`. **Fix the API, and the bypasses delete themselves.**

Non-inference direct imports (acceptable, but should go through the provider):
`checkHealth` in `research/context` + `portfolio/audit`, `listInstalledModels` in `screener/nl`.

### 1.9 Prompt duplication

`prompt-builder.ts` exists and is used by nobody. The "Respond ONLY with valid JSON. No markdown, no
explanation." instruction is hand-written in **13 modules** plus twice inside `lib/ai/ollama.ts`.

---

## Phase 2 — Proposed architecture

Keep the five layers. Fix their inputs. Add one thing.

```
feature code ──> runTask / runTaskText / runTaskStream / runTaskChat   (orchestrator)
                          │  names a TaskType. Never a model.
                          ▼
                     Router  ──── config.ts (overrides, pins)   ← NEW
                          │  score(task requirements × model properties)
                          │  filter: installed ∧ enabled ∧ FITS IN MEMORY ∧ capable   ← NEW
                          ▼
                  AIProvider (OllamaProvider)
                          │  think / num_ctx / num_predict / native thinking field    ← NEW
                          ▼
                       Ollama
```

### 2.1 Model Registry (`lib/ai/models.ts`) — rebuilt on measurement

Each `ModelSpec` gains the properties the brief asks for, sourced from the benchmarks above rather than
from intuition:

- `quality: 1–10` — reasoning strength (judgment, documented)
- `tokensPerSecond` — **measured on this host**, not guessed
- `thinking: "hybrid" | "none"` — can the model's reasoning be toggled
- `sizeGb` — declared footprint; the provider also reports the **actual** size from `/api/tags`, which
  wins when available (so the number cannot drift from reality)
- `contextWindow`, `capabilities`, `priority`, `enabled` — retained

Entries become the **actually installed** models, keyed by exact tag so `qwen3:14b` and `qwen3:30b-a3b`
are finally distinguishable. `deepseek-r1` / `llama3.1` are removed (phantom preferences are worse than
no preference).

### 2.2 Memory feasibility — the one genuinely new abstraction

A model that does not fit in RAM is not a "slower option"; it is **unusable** (0.9 tok/s). This is a hard
filter, not a scoring penalty:

```
budgetGb = AI_MAX_MODEL_GB ?? 0.75 × totalSystemMemory
candidate is eligible ⟺ model.sizeGb ≤ budgetGb
```

On this 17 GB host → budget **12.75 GB**:

| Model | Size | Eligible |
|---|---|---|
| `mistral:latest` | 4.4 | ✅ |
| `qwen2.5-coder:14b` | 9.0 | ✅ |
| `qwen3:14b` | 9.3 | ✅ |
| `devstral:24b` | 14.3 | ❌ |
| `qwen3:30b-a3b` | 18.6 | ❌ |
| `qwen3-coder:latest` | 18.6 | ❌ |

This is *derived*, not hardcoded. Run UAA on a 64 GB Mac and `qwen3:30b-a3b` becomes eligible
automatically with no code change — which is exactly the portability the brief asks for.

### 2.3 Task Registry (`lib/ai/task-registry.ts`) — declarative requirements

The current registry hand-maintains a `preferredModels` array for each of 30 tasks. That is 30 copies of
the same policy, and it is how the registry drifted out of sync with reality in the first place. Adding a
model means editing 30 lines.

Replace with what the brief actually asks each task to declare:

```ts
interface TaskConfig {
  complexity: "deep" | "standard" | "light";      // reasoning requirement
  latency:    "interactive" | "standard" | "background";  // latency sensitivity
  contextTokens?: number;                          // context requirement
  jsonMode?: boolean;                              // output requirement
  thinking?: boolean;                              // opt-in; default false
  maxTokens?: number; temperature?: number; timeoutMs?: number;
}
```

The router derives the model. Adding a 7th model, or a 31st task, requires **zero** edits to the other 30.

### 2.4 Router (`lib/ai/router.ts`) — deterministic scoring

```
1. FILTER   installed ∧ enabled ∧ fitsMemory ∧ hasCapabilities(json → structured-json,
                                                                deep → reasoning,
                                                                ctx  → contextWindow ≥ required)
2. SCORE    score = wQuality·quality + wSpeed·normalizedSpeed
              latency=interactive → wSpeed  dominates
              complexity=deep     → wQuality dominates
3. TIEBREAK registry priority, then model id (lexicographic)
```

Fully deterministic — no randomness, same inputs always yield the same order. Fallback chain, health
cooldown, and `AllModelsFailedError` semantics are **retained unchanged** from the existing router.

### 2.5 Configuration (`lib/ai/config.ts`) — NEW

Routing must be changeable without touching code:

```ts
export const AI_CONFIG = {
  maxModelGb: envNum("AI_MAX_MODEL_GB") ?? 0.75 × totalmem,
  // Pin a task to an explicit ordered model list. Overrides scoring entirely.
  taskOverrides: { /* "ic-agent-analysis": ["qwen3:14b"] */ } as Partial<Record<TaskType, string[]>>,
  disabledModels: envList("AI_DISABLED_MODELS"),
};
```

An override wins over the scorer. This is the "changing the preferred model for a task should require
configuration changes rather than code changes" requirement, satisfied literally.

### 2.6 Provider layer — the correctness fixes

`ProviderCompleteRequest` gains `thinking?: boolean` and `numCtx?: number`. `lib/ai/ollama.ts`:

- **sends `think: <bool>`** — this is the `{}` fix
- **reads the native `thinking` field** from both `/api/generate` and `/api/chat` deltas, and keeps
  `splitThinking` only as a legacy fallback for models that still emit inline `<think>`
- forwards `num_ctx` and `num_predict`
- `DEFAULT_MODEL`'s `"llama3.2"` literal is deleted — the router supplies the model, always

**Hard invariant, enforced in the router: `jsonMode` ⇒ `thinking: false`.** Measured 0/3 vs 3/3. These two
settings are mutually exclusive and no config may combine them.

### 2.7 Orchestrator — close the bypasses

Add one call shape, which is the union of what the two bypassing routes need:

```ts
runTaskChat(taskType, messages: ChatTurn[], { onReasoning, numCtx, signal, ... })
```

Then `research/chat` and `portfolio/audit` stop importing `streamChat` and get the router's fallback +
health tracking for free.

### 2.8 Prompt Registry (`lib/ai/prompts/`)

Adopt the existing (unused) `prompt-builder.ts`. Scope deliberately limited, per the brief's "do not
rewrite prompts unnecessarily":

- **Do** centralize the JSON-only instruction duplicated across 13 modules into one constant.
- **Do** register the prompts for modules the refactor already touches.
- **Do not** reword the ~20 hand-tuned feature prompts. Prompt wording is a quality-sensitive change
  that needs per-model evaluation; a mechanical rewrite is how you regress research quality invisibly.

---

## Routing decisions (and why)

Models kept:

| Model | Role | Why |
|---|---|---|
| **`qwen3:14b`** | Analytical workhorse — default for `deep` + `standard` | Best reasoning that **fits in RAM** (9.3 GB). 5 tok/s, 3/3 valid JSON with `think:false`, institutional-grade prose. |
| **`mistral:latest`** | Fast lane — `light` / `interactive` tasks | **2× faster** (10.5 tok/s), **3/3 valid JSON**, 7.4s on the scoring task vs 17.1s. Where quality is equivalent, the brief says take the faster model. For short summaries and query parsing it is equivalent. |
| **`qwen2.5-coder:14b`** | `coding` task only | The only coding model that fits the memory budget. UAA has no shipping coding feature; the task is reserved. |

Models registered but **not routed to** on this host:

| Model | Why not |
|---|---|
| **`qwen3:30b-a3b`** | 18.6 GB > 12.75 GB budget. Measured **0.9 tok/s / 302s** — thrashing. Would be the best model here on a larger machine, and the registry will select it automatically there. |
| **`qwen3-coder:latest`** | Same 18.6 GB, same thrashing. Also redundant: no coding feature ships. |
| **`devstral:24b`** | 14.3 GB, over budget. It is an agentic *coding* model — **it adds nothing to an investment-research platform**. Even with RAM to spare, no UAA task would route to it. This is a model to `ollama rm`. |

Task → model. This table is **generated from the implemented router**, not hand-written:

| Tasks | Complexity / Latency | Routes to | Why |
|---|---|---|---|
| `investment-thesis`, `sec-filing-analysis`, `risk-review`, `accounting-red-flags`, `scenario-analysis`, `stress-testing`, `ic-agent-analysis`, `thematic-analysis` | deep / background | **qwen3:14b** → *mistral (degraded)* | Deepest reasoning inside the memory budget. Nobody is watching a spinner, so quality dominates. All are `jsonMode` ⇒ `think:false` — this is the `{}` fix. |
| `company-research` + the 7 other `*-research` tasks, `comparison`, `portfolio-intelligence`, `portfolio-audit`, `watchlist-intelligence`, `timeline-analysis`, `explain-movement`, `opportunity-engine` | standard / standard | **qwen3:14b** → mistral | Institutional research quality *is* the product. Worth ~2× the latency. |
| `market-summary`, `daily-briefing` | light / standard | **mistral** → qwen3:14b | Short narrative; no research quality to protect. |
| `nl-screener`, `quick-summary`, `knowledge-graph-explain`, `calendar-brief` | light / interactive | **mistral** → qwen3:14b | A human is watching a spinner. Measured 5.9s vs ~17s, and mistral is 3/3 on valid JSON. Where quality is equivalent, the brief says take the faster model. |
| `coding` | standard / standard | **qwen2.5-coder:14b** | Only eligible coding model. Reserved; no feature ships it. |

Note the degraded fallbacks: only qwen3:14b has the `reasoning` capability here, so a
capability-only candidate list would leave every deep task with exactly **one** model and no
recovery — a single timeout would hard-fail an IC report. Non-capable models are therefore kept as
ranked-last fallbacks, which changes nothing on the happy path.

**On thinking:** left **off for every task by default**, and made a per-task config knob. It is forbidden
outright for JSON tasks (0/3 valid). For prose tasks it costs a measured **5×** for a marginal gain on
the prompts tested. The deep tasks that might justify it are almost all JSON tasks, where it cannot be
used. Enabling it is now a one-line config change per task, with the cost documented — that is the honest
position given one machine and one benchmark set, rather than asserting equivalence I have not proven
across all 30 prompts.

---

## Phase 3 — Self-review

Applied *before* implementation:

1. **"Build a new AI platform."** Rejected — one exists and is well-layered. Rebuilding the same five
   boxes would be pure churn and would throw away working fallback/health logic. The brief's real ask is
   satisfied by fixing inputs + adding config + closing bypasses.
2. **Scoring vs. `preferredModels` lists.** First draft kept the 30 hand-written arrays. Rejected: that
   duplication *is* the root cause of the registry/reality drift. Declarative requirements + a scorer
   collapses 30 policies into 1. Config overrides preserve the ability to pin.
3. **Memory filter as a scoring penalty?** Rejected — a model at 0.9 tok/s is not "worse," it is broken.
   Soft-ranking it means a 5-minute request whenever the good models are in health cooldown. Hard filter.
4. **Hardcode the three big models to `enabled: false`?** Rejected — that bakes *this laptop* into the
   registry. Deriving a budget from `os.totalmem()` is the same number of lines and portable.
5. **Delete `prompt-builder.ts` as dead code?** No — it is the right primitive; adopt it incrementally.
6. **Scope discipline.** Not rewriting 20 feature prompts, not building a second provider, not persisting
   health state. All noted as future work rather than half-done.

---

## Phase 4 — Implementation order

1. `lib/ai/ollama.ts` — `think`, native `thinking` field, `num_ctx`, `num_predict` *(fixes `{}`)*
2. `lib/ai/models.ts` — registry rebuilt on measured data + `sizeGb`
3. `lib/ai/config.ts` — **new**; memory budget + task overrides
4. `lib/ai/task-registry.ts` — declarative requirements
5. `lib/ai/router.ts` — feasibility filter + deterministic scorer
6. `lib/ai/provider.ts`, `providers/ollama-provider.ts` — thread `thinking`/`numCtx`
7. `lib/ai/orchestrator.ts` — `runTaskChat`
8. `app/api/research/chat`, `app/api/portfolio/audit` — drop `streamChat`
9. `lib/ai/prompts/` — shared JSON instruction
10. `.env.local`, `lib/ai/ARCHITECTURE.md`

## Phase 5 — Validation

`tsc --noEmit`, `eslint`, `vitest run` (72 files), `next build`. Plus a **live** check against Ollama
that a JSON task now returns populated JSON rather than `{}` — the bug that started this.

## Known limitations

- Benchmarks are one host, one prompt set, n=3. Enough to rule out a 302s model; not enough to declare
  qwen3-vs-mistral quality equivalence across all 30 tasks. The config knobs exist precisely so this can
  be tuned without code changes.
- Deep JSON tasks cannot use thinking. The proper fix is a two-phase reason-then-format pass; deferred as
  it doubles latency and needs its own evaluation.
- Health state remains in-memory/per-process.
