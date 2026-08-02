# Phase 3 — Architecture: Devin Sessions API in UAA

Status: **awaiting approval**. Nothing here is implemented.

Design goal, per the brief and Phase 2's findings: all AI work runs on Devin.
The sessions API takes the deep/background work (server-validated structured
output, attachments, minutes-scale latency nobody watches); the already-shipped
Devin CLI transport keeps the interactive work (3–8s measured); Ollama survives
only behind a flag until parity is proven, then stays as the offline fallback.

---

## 1. Provider selection: `AI_PROVIDER` flag

The repo already has a provider *chain* (`AI_PROVIDER_ORDER`, Router walks it
lazily). The brief asks for a coarse `AI_PROVIDER=ollama|devin` switch. Both
are honored; the coarse flag expands to a chain:

```
AI_PROVIDER=devin   →  chain ["devin-api", "devin-cli"]          (all-Devin; no Ollama)
AI_PROVIDER=ollama  →  chain ["ollama"]                          (full rollback, one env var)
(unset)             →  AI_PROVIDER_ORDER if set, else ["devin-api", "devin-cli", "ollama"]
```

Implemented entirely in `lib/ai/config.ts:providerOrder()` — the Router doesn't
change. `devin-api` becomes a third `ProviderId` alongside `devin` (CLI) and
`ollama`. (Internally the CLI provider keeps its id `devin` for back-compat
with existing tests/health surfaces; the docs and env accept `devin-cli` as an
alias.)

**Task-level affinity.** A cold session cannot serve a search box, so the
Router gains one rule, not a rewrite: the `devin-api` provider only *offers*
models for tasks whose registry entry says `latency: "background"` (or that
opt in via a new optional `TaskConfig.deep: true`). For every other task its
`listModels()` returns `[]` and the chain falls through to the CLI provider.
This reuses the exact mechanism providers already use to say "nothing
available" — no new routing concepts.

---

## 2. `lib/ai/devin-api.ts` — the raw client (only file that speaks HTTP to api.devin.ai)

Mirrors the role `lib/ai/ollama.ts` and `lib/ai/devin-cli.ts` play for their
transports. Typed errors; no feature imports.

```ts
// Env (all read here and only here):
//   DEVIN_API_KEY        — service-user key (cog_…), from .env.local. NEVER logged.
//   DEVIN_ORG_ID         — org id (org-…)
//   DEVIN_API_BASE       — default "https://api.devin.ai/v3"
//   DEVIN_API_MODE       — default "normal"; "fast" per-call override allowed
//   DEVIN_API_MAX_ACU    — default 5; per-session runaway fuse
//   DEVIN_API_DISABLED   — "1" removes the provider from routing

export class DevinApiUnavailableError extends Error { code = "devin_api_unavailable" }   // no key, 401/403
export class DevinApiSessionError extends Error     { code = "devin_api_session_error" } // error status, usage_limit_exceeded
export class DevinApiTimeoutError extends Error     { code = "devin_api_timeout" }       // deadline hit; session terminated

export interface DevinSessionHandle { sessionId: string; url: string }

export function createSession(opts: {
  prompt: string;
  structuredOutputSchema?: object;      // JSON Schema Draft 7, produced from Zod
  playbookId?: string;
  attachmentUrls?: string[];
  tags: string[];                       // always ["uaa", `uaa:${idemKey}`, `uaa:v${schemaVersion}`]
  mode?: "normal" | "fast";
  maxAcuLimit?: number;                 // defaults DEVIN_API_MAX_ACU
  title?: string;
}): Promise<DevinSessionHandle>;

export function getSession(sessionId): Promise<{
  status: "new"|"claimed"|"running"|"exit"|"error"|"suspended"|"resuming";
  statusDetail: string | null;
  structuredOutput: unknown | null;
  acusConsumed: number;
}>;

export function sendMessage(sessionId, message, attachmentUrls?): Promise<void>;
export function terminateSession(sessionId): Promise<void>;
export function uploadAttachment(name: string, data: Buffer): Promise<{ url: string }>;
export function findSessionsByTag(tag: string): Promise<DevinSessionHandle[]>; // crash recovery

/** create → poll → validated output, with the full failure policy applied. */
export function runStructuredSession<T>(opts: {
  prompt: string;
  schema: ZodType<T>;                  // Zod is the source of truth
  schemaVersion: number;
  idemKey: string;                     // see §5 — also the result-cache key
  playbookId?: string;
  attachmentUrls?: string[];
  mode?: "normal" | "fast";
  deadlineMs?: number;                 // default 15 min normal / 8 min fast
  signal?: AbortSignal;
}): Promise<{ value: T; sessionId: string; acusConsumed: number; elapsedMs: number }>;
```

**Polling policy** (inside `runStructuredSession`):

- Backoff: 3s → 5s → 8s → 12s → cap 15s (jittered ±20%). The official example
  polls at 10s; we start tighter because Phase 4 may show small tasks finish
  fast, and cap higher to be polite on long ones.
- Done when `status_detail === "finished"` or `status === "exit"` **and**
  `structured_output` is non-null → parse with the Zod schema (belt over the
  server's braces; also rejects `{}`-style empty-but-valid results, the scar
  from the Ollama thinking bug).
- `status === "error"` or `status_detail === "usage_limit_exceeded"` →
  `DevinApiSessionError` (never retried with the same session).
- `status_detail === "waiting_for_user"` → the prompt underspecified the task.
  Send ONE corrective message ("Do not ask questions; produce the structured
  output with your best judgment, noting assumptions in the designated
  field"), then continue polling. A second `waiting_for_user` → terminate +
  `DevinApiSessionError`. Playbook rules (§7) make this rare.
- Deadline hit → `DELETE` the session (stop ACU burn), throw
  `DevinApiTimeoutError`.
- HTTP 429/5xx/network on any call → exponential retry (1s·2ⁿ, max 5
  attempts) — *request* retry, never a duplicate `createSession` (see §5).
- `AbortSignal` (thematic Cancel) → terminate session, rethrow AbortError.

---

## 3. `lib/ai/providers/devin-api-provider.ts` — the `AIProvider` implementation

Slots into the existing Router chain for **background-latency tasks that flow
through `runPrompt()` today** (scanner stages, IC agents, thematic). Feature
code stays untouched — same façade, same task types.

- `listModels()` → `[{ id: "devin-session-normal" }, { id: "devin-session-fast" }]`
  when `DEVIN_API_KEY` is configured, else `[]`. Registry entries mark them
  `provider: "devin-api"`, capabilities `["reasoning","long-context","structured-json"]`,
  `sizeGb: 0`. Their `tokensPerSecond` is set LOW (measured in Phase 4) so the
  scorer only reaches them where quality dominates — which is exactly the
  background/deep task class the affinity rule already gates on.
- `complete(request)` → flattens messages (reuse `flattenMessages` from
  devin-cli.ts), calls `runStructuredSession` when the request carries a
  schema, else a plain session whose playbook demands raw JSON, then
  `cleanDevinOutput`-equivalent normalization. Blocking for up to the task's
  `timeoutMs` — acceptable: these tasks already declare 300s timeouts.
- `stream()` → single-chunk emit (same contract as the CLI provider).
- **Interface extension (additive):** `ProviderCompleteRequest.outputSchema?: object`
  — Zod-derived JSON Schema. DevinApiProvider maps it to
  `structured_output_schema`; the CLI and Ollama providers ignore it (they
  keep the prompt-embedded schema text they use today). `RunTaskOptions`
  gains the same optional field so feature code can thread a schema through
  `runPrompt` without changing any signature.

---

## 4. Zod schemas: `lib/ai/schemas/`

New dependency: **`zod`** + **`zod-to-json-schema`** (draft-07 output — exactly
what the API requires; both mature, widely-used packages). One module per
analysis type, exporting the Zod schema, its inferred TS type, and a
`SCHEMA_VERSION` integer bumped on any shape change:

```
lib/ai/schemas/verdict.ts          — InvestmentVerdict (the spike + first migration)
lib/ai/schemas/scanner.ts          — classifier / causal / sector / company / dedupe / thesis stages
lib/ai/schemas/ic-agent.ts         — per-domain agent output + thesis
lib/ai/schemas/thematic.ts         — stage outputs
lib/ai/schemas/filing-analysis.ts  — new, attachment-based deep dive
```

These become the single source of truth for the types that today live as
hand-written `interface` + `extractJsonObject` defaults. The existing parsers
stay for the CLI/Ollama paths; Zod `.safeParse` guards the API path.

---

## 5. Result cache + idempotency

**One new SQLite table** (in `lib/db.ts`, same patterns as `scanner_cache`):

```sql
CREATE TABLE IF NOT EXISTS ai_result_cache (
  analysis_type  TEXT    NOT NULL,   -- "verdict" | "scanner-classify" | "ic-business" | ...
  symbol         TEXT    NOT NULL,   -- "" when not ticker-scoped
  input_hash     TEXT    NOT NULL,   -- sha256 of canonicalized inputs (sorted keys, rounded floats)
  schema_version INTEGER NOT NULL,
  result         TEXT    NOT NULL,   -- Zod-validated JSON
  session_id     TEXT,               -- provenance
  acus_consumed  REAL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (analysis_type, symbol, input_hash, schema_version)
);
```

- **Idempotency key** = `sha256(analysis_type:symbol:input_hash:v{schema_version})`.
  v3 removed the server-side `idempotent` flag, so this is enforced client-side:
  (1) cache hit → no session; (2) `ai_job` row in `pending|running` with the
  same key → attach, don't re-enqueue; (3) on process crash, recovery lists
  sessions by tag `uaa:{idemKey}` before ever creating a duplicate.
- **Never cache a failure** (house rule, `AGENTS.md`) — errors go on the job
  row, not in this table.
- TTL per analysis type (verdict 6h to match today's `aiVerdict` policy;
  scanner 1h; filing analysis 30d — filings don't change). Input-hash keying
  means a TTL is only a staleness bound, not a correctness mechanism.

## 6. Async job model

No new infrastructure — SQLite + the in-process scheduler pattern the scanner
already uses (`Symbol.for` singleton guard, `lib/scanner/scheduler.ts`).

```sql
CREATE TABLE IF NOT EXISTS ai_job (
  id             TEXT PRIMARY KEY,    -- the idempotency key
  analysis_type  TEXT NOT NULL,
  symbol         TEXT NOT NULL,
  payload        TEXT NOT NULL,       -- canonicalized inputs (what gets hashed)
  schema_version INTEGER NOT NULL,
  status         TEXT NOT NULL,       -- pending | running | succeeded | failed
  devin_session_id TEXT,
  error          TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
```

Flow: `enqueue(analysisType, symbol, payload)` → returns job id immediately →
worker loop (max `DEVIN_API_CONCURRENCY`, default 4 — "no concurrent session
limits" per the billing docs, but bounded politeness) creates the session,
polls, Zod-validates, writes `ai_result_cache`, marks `succeeded`. Transient
failure retries once with the *same* idempotency key after checking
`findSessionsByTag` for a survivor. UI reads `GET /api/ai/jobs/[id]` →
`{status, result?}` and renders the pending/ready states the streaming report
UI already has.

**Nightly precompute** is just an enqueue loop over watchlist + portfolio +
recently-researched symbols, triggered by the existing in-process scheduler.
Devin's cron (Schedules API) is deliberately NOT used for this: the inputs
(quotes, composites) live in UAA's SQLite, so the enqueue must run where the
data is. Sessions do the analysis; UAA does the scheduling.

## 7. Playbook + knowledge (house style lives server-side)

One org **playbook** (`POST /v3/organizations/{org}/playbooks`), id stored as
`DEVIN_PLAYBOOK_ANALYSIS` in `.env.local`, created/updated by a small
`scripts/devin-setup.ts` (idempotent by name). Contents, abridged:

> **UAA Analysis Sessions.** You are performing one self-contained financial
> analysis. Use ONLY the data provided in the prompt and attachments — do not
> browse the web, do not clone repos, do not ask questions. If data is missing,
> say so in the designated caveats field; never invent numbers. Work in USD
> unless told otherwise; percentages as numbers not strings. You MUST call
> provide_structured_output with is_final=true exactly once, conforming to the
> given schema. Style: institutional buy-side memo — direct, specific,
> numbers-first, no hedging boilerplate. Verdict bands: score ≥70 BUY-leaning,
> 45–70 HOLD, <45 SELL-leaning (mirror lib/recommendation.ts).

**Knowledge notes** (3, small, triggered): metric conventions (ROE as decimal
vs percent — the 1.41% bug class), UAA's composite-score semantics
(value/quality/momentum bands), and the caveats-field convention. Playbook =
per-session contract; knowledge = ambient house facts. Prompts then shrink to
data + question, exactly as the brief wants.

## 8. Secrets & env

`.env.local` (gitignored — verified) and `.env.example` (placeholders only):

```
DEVIN_API_KEY=cog_...        # service user, ManageOrgSessions + UseDevinSessions
DEVIN_ORG_ID=org-...
DEVIN_API_MODE=normal
DEVIN_API_MAX_ACU=5
DEVIN_API_CONCURRENCY=4
DEVIN_PLAYBOOK_ANALYSIS=     # filled by scripts/devin-setup.ts
AI_PROVIDER=                 # ollama | devin (coarse switch; unset = default chain)
```

Key handling: read once in `devin-api.ts`; never logged, never echoed in
errors (errors carry status codes and `detail` only after scrubbing the
Authorization header); never passed to sessions as prompt text.

## 9. Failure modes (summary table)

| Failure | Detection | Handling |
|---|---|---|
| No/invalid key | 401/403 | Provider lists no models → chain falls to CLI; health badge says which provider is down |
| Rate limited | 429 | Exponential retry per request; job stays `running` |
| Session errors | `status=error` | Job `failed`, error persisted, NOT cached; CLI fallback serves reads |
| Runaway session | `usage_limit_exceeded` via `max_acu_limit` | Job `failed`; fuse did its job |
| Deadline | poll timer | Terminate session, `failed` |
| Agent asks a question | `waiting_for_user` | One scripted nudge, then terminate |
| Invalid structured output | server validates; Zod re-validates | If server somehow returns nonconforming/empty: one corrective message, then fail |
| Process crash mid-job | jobs stuck `running` on boot | Recovery sweep: `findSessionsByTag`, re-attach or terminate |
| Devin outage | create fails repeatedly | Jobs `pending` (bounded queue age); interactive paths unaffected (CLI) |

## 10. Migration order (lowest risk first) — Phase 5

1. **Spike** (Phase 4): verdict schema end-to-end via `scripts/devin-spike.ts`.
2. **Golden harness** (`scripts/golden-compare.ts`): same inputs → Ollama vs
   CLI vs API; diff structured fields; store under `ai-migration/golden/`.
3. **Scanner classifier** (`lib/scanner/classifier.ts`) — background, cached,
   sanitized-array parsing, invisible on failure. First real call site.
4. **Remaining scanner stages** (causal, sector, company, dedupe, thesis).
5. **IC agents** (9 domains; per-session polling maps onto existing per-agent
   completion events), then IC thesis + valuation.
6. **Thematic engine** (8 stages, Cancel → terminate).
7. **Verdict precompute** (nightly enqueue + read-through on the existing
   `aiVerdict` cache; CLI stays the cold-ticker fallback).
8. **Filing deep-dive with attachments** — new capability, last because it has
   no incumbent to regress.

Interactive call sites (nl-screener, copilot, chart-qa, quick summaries,
asset-class Q&A) stay on the CLI transport — re-evaluated only if Phase 4's
wake-from-suspend measurement lands under ~10s.

**Rollback at every step:** `AI_PROVIDER=ollama` (everything local),
`DEVIN_API_DISABLED=1` (API off, CLI keeps serving), per-task pins
(`AI_TASK_<NAME>`) for surgical reversion. Ollama code untouched.
