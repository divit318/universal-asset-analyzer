# Phase 3 — Architecture: Devin as a UAA Analysis Provider

Date: 2026-08-02. Depends on: `01-inventory.md` (call-site facts),
`02-devin-capabilities.md` (API facts, all doc-cited). Status: **awaiting
approval — no implementation yet.**

---

## 0. Design constraints recap

1. Devin has no completion endpoint, no streaming, no documented sub-minute
   path. Its unit of work is a **session** returning **schema-validated
   structured output**, retrieved by **polling**.
2. UAA's platform layer already routes everything through task types; its
   interactive tier (spinners measured in seconds) cannot move; its
   deep/background tier (99% of LLM wall-clock) is where Devin wins.
3. Repo policy: no heavy infra (SQLite + in-process is the house pattern),
   Ollama stays fully working behind a flag, keys only in `.env.local`.

## 1. The provider seam: analysis-level, not token-level

The existing `AIProvider` (lib/ai/provider.ts) is a **model-completion**
contract: `complete({model, messages, temperature, numCtx…})`. Every field is
meaningless for Devin (no models to list, no temperature, no context window),
and the Router's scoring/memory-gating machinery has nothing to score. Wedging
Devin in at that seam would technically satisfy "implements AIProvider" while
producing exactly the slow, semantically-wrong path we were told not to ship.

So the Ollama↔Devin interchange point sits one level up, where the unit of
work is *an analysis*, matching both what Devin sells and what all 35 call
sites actually want:

```ts
// lib/ai/analysis-provider.ts  (NEW — the seam AI_PROVIDER switches)
export interface AnalysisRequest<T> {
  taskType: TaskType;              // existing registry id — routing + budgets
  subjectKey: string;              // "AAPL", "portfolio:default", "theme:…"
  prompt: string;                  // the dossier (computed facts pushed in)
  schema: z.ZodType<T>;            // single source of truth for output shape
  schemaVersion: number;
  idempotencyKey?: string;         // defaults to hash(type, subject, inputHash, schemaVersion)
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AnalysisResult<T> {
  data: T;                         // schema-validated
  provider: "ollama" | "devin";
  meta: { model?: string; sessionId?: string; sessionUrl?: string;
          durationMs: number; acus?: number };
}

export interface AnalysisProvider {
  readonly id: "ollama" | "devin";
  run<T>(req: AnalysisRequest<T>): Promise<AnalysisResult<T>>;    // blocking
  enqueue<T>(req: AnalysisRequest<T>): Promise<JobHandle>;        // async-first
  healthCheck(): Promise<{ reachable: boolean; detail?: string }>;
}
```

- **`OllamaAnalysisProvider`** is a thin adapter over what exists today:
  `runTask(taskType, prompt, {json:true})` → `extractJson` → `schema.parse`.
  Zero change to the Router, models, gate, health, or streaming internals.
  The token-level `AIProvider` interface stays exactly as-is underneath it.
- **`DevinAnalysisProvider`** is new (§3).
- Free-text tasks (calendar brief, financial insight, audit memo) are just
  analyses with a trivial schema (`z.object({ text: z.string() })`) — one seam,
  no special cases.

Existing feature code migrates call-by-call from
`runPrompt(...)+extractJsonObject(...)` to
`runAnalysis(...)` / `enqueueAnalysis(...)` (a façade in `lib/ai/analysis.ts`
that resolves the provider and consults the cache). Unmigrated call sites keep
working untouched — migration is incremental by construction.

### Provider selection

```
resolveProvider(taskType):
  1. AI_TASK_<NAME>_PROVIDER env pin            (mirrors existing AI_TASK_<NAME> model pins)
  2. task-registry `provider` field, if set     (new optional TaskConfig field)
  3. AI_PROVIDER global default (ollama | devin)
  GUARDRAIL: if AI_PROVIDER=devin and the task declares latency:"interactive",
             resolve to ollama unless pinned devin explicitly (rule 1 or 2).
```

The guardrail encodes Phase 2's verdict as a tested invariant, exactly like
the existing "jsonMode forces think:false" rule. `AI_PROVIDER=ollama` (the
default) reproduces today's behavior bit-for-bit. **No silent cross-provider
fallback** in v1: a Devin failure surfaces through the existing error taxonomy
(`lib/ai/errors.ts` categories map 1:1), it does not quietly re-run on a 7B
model whose output would then be presented as Devin's.

### New dependency: `zod`

The only new runtime dependency. Zod v4 (stable for >1 year) includes native
`z.toJSONSchema()` — no converter package needed. Each analysis gets a module
in `lib/ai/schemas/<name>.ts` exporting `{ schema, SCHEMA_VERSION, type }`.
Existing defaults-coercion behavior (`extractJsonObject(raw, defaults)`) is
encoded once per schema with `.default()`/`.catch()`, so Ollama and Devin
share one shape and the Ollama path keeps its hard-won tolerance for dropped
fields.

## 2. File layout

```
lib/ai/analysis.ts                     runAnalysis / enqueueAnalysis façade (cache + jobs aware)
lib/ai/analysis-provider.ts            the interface above + resolveProvider
lib/ai/providers/ollama-analysis.ts    adapter over runTask (existing stack untouched below)
lib/ai/providers/devin/client.ts       typed HTTP client for the v3 endpoints we use
lib/ai/providers/devin/schema.ts       zod → JSON Schema Draft 7 (+64KB/self-containment checks)
lib/ai/providers/devin/provider.ts     session lifecycle: create/poll/validate/terminate
lib/ai/schemas/*.ts                    per-analysis zod schemas + versions
lib/ai/jobs.ts                         SQLite-backed async job driver (§4)
app/api/ai/jobs/[id]/route.ts          job status endpoint for pending→ready UIs
scripts/devin/prompts/analyst-playbook.md   house-style playbook (versioned here, synced up)
scripts/devin/sync-devin-assets.ts     idempotent playbook/knowledge sync via v3 API
scripts/devin-spike.ts                 Phase 4 spike
```

## 3. DevinAnalysisProvider — session lifecycle

### 3.1 Client (`client.ts`)

Endpoints used (all cited in 02): create session, get session, list messages,
send message, terminate, upload attachment. Base
`https://api.devin.ai/v3/organizations/${DEVIN_ORG_ID}`, auth
`Bearer ${DEVIN_API_KEY}` from env only. The client never logs headers or key
material; errors are surfaced as the RFC 9457 `detail` string.

**Transient-failure retry**: network errors, 429, and 5xx retry with jittered
exponential backoff (base 500ms, ×2, cap 8s, max 5 attempts) — but **only** on
GETs and on session creation *before* a session exists for the idempotency key
(§3.3). A create that times out ambiguously is resolved by listing sessions
filtered by our idempotency tag before retrying, so we never double-spawn.

### 3.2 Session creation

```jsonc
POST /sessions
{
  "prompt": "<task directive + dossier>",       // short: house style lives in the playbook
  "title": "UAA <taskType> <subjectKey>",
  "playbook_id": DEVIN_PLAYBOOK_ID,             // carries house style (§6)
  "knowledge_ids": [],                           // explicitly NONE — see §6
  "structured_output_schema": toJsonSchema(req.schema),   // checked ≤64KB, self-contained
  "structured_output_required": true,
  "devin_mode": DEVIN_MODE ?? "fast",           // latency is the constraint, cost is not
  "resumable": false,                            // disposable analysis VMs
  "max_acu_limit": task.devinMaxAcu ?? 4,       // runaway bound per analysis
  "tags": ["uaa", taskType, "idem:"+idempotencyKey]
}
```

### 3.3 Idempotency (v3 has no `idempotent` flag — v1 did)

The idempotency key is `fnv1a(taskType, subjectKey, inputHash, schemaVersion)`
— the same fingerprint family the orchestrator's coalescer already uses.
Enforcement is layered:

1. **In-process**: `lib/platform/jobs.ts` single-flight — a second enqueue
   attaches to the running job (existing, proven).
2. **Across restarts**: the `ai_job` row (§4) persists `session_id`; recovery
   re-polls the existing session instead of creating a new one.
3. **Across ambiguity**: sessions are tagged `idem:<key>`; before any retry of
   an ambiguous create, `GET /sessions?tags=…` (list endpoint) is consulted.

### 3.4 Polling, timeout, termination

- Poll `GET /sessions/{id}` with backoff 3s → 5s → 8s → 13s → cap 15s
  (background tasks; interactive-pinned tasks would cap at 5s).
- Success condition: `structured_output != null` AND (`status_detail ==
  "finished"` OR `status == "exit"`). `waiting_for_user` is treated as a
  failure of the playbook contract (the playbook forbids asking questions) —
  one corrective `POST /messages` ("do not ask; produce output with stated
  assumptions"), then fail if it recurs.
- Total budget: new optional `TaskConfig.devinTimeoutMs` (default: 15 min for
  `latency:"background"`, 8 min otherwise — Phase 4 spike calibrates these).
  On expiry: `POST /sessions/{id}/terminate`? — v3 uses `DELETE
  …/sessions/{devin_id}` (Terminate Session) — then mark `timeout`, which maps
  onto the existing `AiLogCategory "timeout"`.
- `AbortSignal` (user cancelled): terminate the session too — a cancelled scan
  must not keep billing/working, same principle as the Ollama abort threading.

### 3.5 Validation and the one corrective turn

`structured_output` is platform-validated against the JSON Schema, then
re-validated with `schema.safeParse` on our side (semantic guards live in Zod:
enum coercions, ranges, min lengths — the anti-"silent `{}`" checks). On parse
failure: one `POST /messages` turn quoting the Zod issues and requesting a
corrected `provide_structured_output`, re-poll; second failure →
`invalid_response` error category. (Whether `structured_output` updates on a
second provide call is a Phase 4 spike item; if it does not, the fallback is
recreating the session once.)

## 4. Async job model — enqueue → poll → persist → pending/ready UI

**Storage: SQLite, in `lib/db.ts`, like the other 31 tables. No new queue
infra** — an external broker would be strictly worse here: single-user desktop
app, one Node process, and `lib/platform/jobs.ts` already provides in-process
single-flight/attach semantics. What's missing today is only *durability*
(Devin jobs outlive a dev-server restart), which is one table:

```sql
CREATE TABLE IF NOT EXISTS ai_job (
  id             TEXT PRIMARY KEY,      -- idempotency key (§3.3)
  task_type      TEXT NOT NULL,
  subject_key    TEXT NOT NULL,
  input_hash     TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  provider       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN
                 ('pending','running','succeeded','failed','timeout','cancelled')),
  session_id     TEXT,                  -- devin-… ; enables restart recovery
  session_url    TEXT,                  -- audit link, shown in dev UIs
  error          TEXT,
  acus           REAL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  finished_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_job_status ON ai_job (status, updated_at DESC);
```

Flow:

```
enqueueAnalysis(req)
  ├─ cache hit (fresh)        → return result immediately (no job)
  ├─ cache hit (stale, SWR)   → return stale + start refresh job (below)
  └─ miss                     → upsert ai_job(pending) → startOrAttachJob(key, run)
                                 → row(running, session_id) → poll (§3.4)
                                 → schema-validate → INSERT ai_result (§5)
                                 → row(succeeded) → in-memory subscribers resolve

GET /api/ai/jobs/[id]  → { status, result?, error?, sessionUrl? }   (UI polls)
```

- **Restart recovery** is lazy: on the first enqueue/status-check after boot,
  a `running` row with no in-memory job re-attaches by polling its persisted
  `session_id`. No daemon, no startup hook — consistent with the app's
  in-process, on-demand style.
- **UI contract**: routes that migrate gain the tri-state the app already has
  everywhere (deterministic fallback / pending / ready). E.g. the watchlist
  digest button becomes enqueue + poll instead of a 180s blocking fetch; the
  existing `TaskProgress` component renders job state.
- The scanner's hourly scheduler keeps its existing timer; only its inner
  LLM calls change provider. Devin-native cron Schedules are deliberately not
  used (the session can't call back into localhost; our scheduler already
  handles freshness/conflict logic).

## 5. Result cache

Exactly the requested key, as a dedicated table (queryable, not stuffed into a
generic cache_key string):

```sql
CREATE TABLE IF NOT EXISTS ai_result (
  analysis_type  TEXT NOT NULL,          -- TaskType or finer (e.g. "verdict:equity")
  subject_key    TEXT NOT NULL,
  input_hash     TEXT NOT NULL,          -- fnv1a of the dossier the prompt was built from
  schema_version INTEGER NOT NULL,
  provider       TEXT NOT NULL,
  meta_json      TEXT,                   -- model/sessionId/acus/durationMs
  result_json    TEXT NOT NULL,          -- schema-validated payload
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (analysis_type, subject_key, input_hash, schema_version)
);
```

- **Freshness policy stays in `lib/platform/registry.ts`** (single source of
  truth rule): lookups consult the dataset policy (`aiVerdict` 6h/24h SWR
  already exists; new analysis types get entries). `input_hash` is the primary
  invalidator — the proven content-hash pattern from portfolio thesis.
- A `schema_version` bump orphans old rows naturally (different PK); a
  periodic sweep deletes rows older than the longest SWR window.
- The existing per-feature caches (scanner 60-min prompt cache, verdict
  platform cache) migrate onto this table as their call sites migrate — one
  cache, not a fourth cache family. Precompute (pattern P1) is then just
  "enqueue jobs for the watchlist/portfolio universe on a timer".

## 6. Devin-side assets: playbook + knowledge

Versioned in-repo, synced by `scripts/devin/sync-devin-assets.ts` (idempotent:
create-or-update by title, writes ids to `.env.local`-adjacent
`.devin-assets.json`).

**Playbook `UAA Analyst`** (`playbook_id` on every session; carries the schema
discipline so per-session prompts are just task directive + dossier):

- Role: buy-side analyst producing one structured analysis; **no repo work, no
  PRs, no questions** — if information is missing, state the assumption in the
  designated field and proceed.
- **Data discipline** (lifted verbatim from AGENTS.md product rules): use ONLY
  the data in the dossier; every number in the output must be traceable to it;
  the `ESTABLISHED CONCLUSIONS` block is settled fact — never contradict it,
  never re-derive directional verdicts; label interpretation as interpretation.
- Formatting: pp vs %, INR lakh/crore conventions, concise institutional tone,
  severity-ordered lists (weakest first).
- Output: **only** via `provide_structured_output` (`is_final=true`);
  no summary prose in chat; finish and end the turn.
- Browsing: forbidden by default; permitted only when the prompt contains an
  explicit `SUPPLEMENTARY SOURCES:` block (used later by filing-analysis call
  sites), and then only those URLs.

**Knowledge notes** (org-level): deliberately **not** auto-included —
sessions pass `knowledge_ids: []` and rely on the playbook. Rationale: `null`
(= all knowledge) would pull the engineering-automation notes and any future
repo knowledge into analysis context, which is nondeterministic and
prompt-injectable. If shared house-style facts outgrow the playbook, they
become explicit notes whose ids the provider passes deliberately. (Notes
pinned for the *engineering* workflows are unaffected.)

## 7. Config & secrets

`.env.local` / `.env.example` only (never committed, never printed — the
client redacts):

```
AI_PROVIDER=ollama|devin          # global default; ollama = today's behavior exactly
DEVIN_API_KEY=                    # cog_…  (service user: ManageOrgSessions + attachments)
DEVIN_ORG_ID=                     # org-…  (both already stubbed in .env.example)
DEVIN_MODE=fast                   # normal|fast|lite|ultra|fusion
DEVIN_MAX_ACU=4                   # per-session cap default; per-task override in registry
DEVIN_PLAYBOOK_ID=                # from sync-devin-assets
AI_TASK_<NAME>_PROVIDER=          # per-task pin, e.g. AI_TASK_IC_AGENT_ANALYSIS_PROVIDER=devin
```

Policy-text amendments shipped in the same PR that first enables the provider
(they currently *mandate* local-only): `lib/ai/ARCHITECTURE.md`, `AGENTS.md`
("Never external APIs"), `docs/devin-integration.md` ("nothing under `app/` or
`lib/` ever calls the Devin API").

## 8. Observability & parity

- Every Devin attempt logs through the existing `logAiEvent` taxonomy
  (`start/success/timeout/network/invalid_response/…`) with
  `provider:"devin"`, `sessionId`, `acus`, `durationMs` — one log stream for
  both providers.
- `app/_components/ollama-status.tsx` generalizes to provider health
  (Devin: `GET /v3/self` reachability + last-N job failure rate).
- **Golden-output harness** (Phase 5 deliverable, designed now):
  `scripts/ai-parity.ts` — takes `(taskType, subjectKey)`, builds the dossier
  once, runs it through BOTH providers, diffs the structured fields
  (field-presence, enum agreement, numeric deltas, verdict-band agreement via
  `lib/recommendation.ts`), writes `bench-out/parity/*.json`. Migration of a
  call site requires N green parity runs before flipping its default.

## 9. Migration order (lowest risk first)

Risk = blast radius × stakes × UX-contract change. Every step keeps Ollama
behind the flag; a step ships only after parity runs + its feature's existing
tests pass under both providers.

| # | Call site | Why this position |
|---|---|---|
| 0 | **Phase 4 spike** (`scripts/devin-spike.ts`, movement-explainer analysis, standalone) | No app wiring; calibrates latency/ACU/backoff constants |
| 1 | **Movement explainer** | Small JSON schema, 15-min cache, deterministic fallback, low stakes |
| 2 | **Financial insight** | Trivial `{text}` schema, same cache/fallback pattern |
| 3 | **Calendar brief** | Free text, user already waits ~20–50s behind a button |
| 4 | **Watchlist digest** | Button-triggered → natural pending→ready conversion; first async-job UI |
| 5 | **Research verdict (blocking `getVerdict`) + nightly cache warming** | Highest-value single output; 6h/24h cache already; stream route untouched (still Ollama) |
| 6 | **Portfolio thesis + holding-explain** | Content-hash cache already; ESTABLISHED-CONCLUSIONS prompt maps perfectly to playbook |
| 7 | **Home brief** | Hourly cache; grounding check retained |
| 8 | **Compare (blocking) + class compare** | Larger prompts; pending→ready |
| 9 | **Simulator swap / refresh-narrative / generate** | 300s budgets + progress stream already |
| 10 | **Scanner pipeline** | Batched sessions (pattern P5); hourly scheduler unchanged |
| 11 | **IC report** | Fan-out: 9 agent sessions in parallel + synthesis + thesis (pattern P3); biggest wall-clock win (852s → ~max(agent)+2 stages) |
| 12 | **Thematic engine** | Same shape as 11 |
| 13 | **Streaming redesigns**: verdict/compare streams + audit memo become cached/pending→ready when provider=devin | Deliberate UX-contract change, last |
| — | **Stays on Ollama** (pinned): research copilot chat, nl-screener, chart-qa, app-assistant, kg-explain, quick-summary, simulator intake | Interactive tier — Phase 2 verdict; guardrail enforces it |

---

**Approval checklist** (what saying "go" commits us to):
1. Add `zod` (v4) as the single new dependency.
2. New seam `AnalysisProvider` + façade; existing token-level stack untouched.
3. Two new SQLite tables (`ai_job`, `ai_result`) in `lib/db.ts`.
4. Devin service-user key with `ManageOrgSessions` (+ `UseDevinSessions` for
   attachments) in `.env.local`.
5. One org playbook + sync script; sessions run `knowledge_ids: []`.
6. Phase 4 spike next: standalone script, one real analysis, 5 runs, real
   numbers reported before any call site migrates.
