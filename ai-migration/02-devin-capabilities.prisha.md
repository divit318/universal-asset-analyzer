# Phase 2 — Devin API Capability Research

Date: 2026-08-02. Every claim below is backed by a doc page fetched live today;
URLs are cited inline. Where the docs are silent (wall-clock latency, ACU cost
of a small task), that is stated plainly and deferred to the Phase 4 spike
rather than guessed.

Pages fetched: `llms.txt` (index), `api-reference/overview`, `authentication`,
`common-flows`, `getting-started/migration-guide`, `v1/sessions/create`,
`v3/sessions/post-organizations-sessions`, `v3/sessions/get-organizations-session`,
`v3/sessions/post-organizations-sessions-messages`,
`v3/attachments/post-organizations-attachments`, `api-reference/release-notes`,
`admin/billing/usage`, `work-with-devin/data-analyst`, `work-with-devin/mcp`.

---

## A. The eight questions

### a) Is there any OpenAI-compatible / chat-completions endpoint?

**No — confirmed.** The complete page index (https://docs.devin.ai/llms.txt)
contains no completions, chat-completions, or generic inference endpoint of any
kind. The only inference-adjacent surface is the **sessions** API (create a
session → an autonomous agent works → poll for results). The API overview
(https://docs.devin.ai/api-reference/overview.md) describes exactly two scopes,
`/v3/organizations/*` and `/v3/enterprise/*`, both resource/session management.
Your belief is correct. (The indirect exception remains the **Devin CLI**,
which is already integrated in this repo and behaves like a slow-ish
chat-completions endpoint at ~3–8s per call.)

### b) Exact v3 session-creation contract

Source: https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions.md

- **Endpoint:** `POST https://api.devin.ai/v3/organizations/{org_id}/sessions`
  (`org_id` prefix `org-`)
- **Auth:** `Authorization: Bearer cog_…` — a **service user** API key created
  in Settings → Service users; shown once at creation
  (https://docs.devin.ai/api-reference/authentication.md). Personal Access
  Tokens exist but are closed beta and not for automation.
- **Required permission:** `ManageOrgSessions` on the service user's role;
  `ImpersonateOrgSessions` additionally for `create_as_user_id`.
- **Request body** (`SessionCreateRequest`; `prompt` is the only required field):

| Field | Type / notes |
|---|---|
| `prompt` | string, required |
| `structured_output_schema` | JSON Schema **Draft 7**, max **64KB**, self-contained (no external `$ref`) |
| `structured_output_required` | bool; **default true** — "the agent MUST call provide_structured_output with is_final=true before its turn ends" |
| `devin_mode` | `normal` \| `fast` \| `lite` \| `ultra` \| `fusion`. Fast = "~2x faster, 4x more expensive, same intelligence" |
| `max_acu_limit` | positive int; hard spend cap per session |
| `attachment_urls` | array of URIs (from the attachments upload endpoint) |
| `knowledge_ids` / `playbook_id` / `child_playbook_id` | attach org knowledge / playbook |
| `secret_ids` / `session_secrets` | org secrets / per-session secrets (`{key, value, sensitive}`) |
| `resumable` | bool, default **true** — preserve VM state after stop so the session can resume; `false` = disposable |
| `tags`, `title`, `repos`, `platform`, `session_links`, `bypass_approval`, `create_as_user_id` | ancillary |

- **Response** (`SessionResponse`): `session_id` (`devin-…`), `url`, `status`
  (`new | claimed | running | exit | error | suspended | resuming`),
  `status_detail` (`working | waiting_for_user | waiting_for_approval |
  finished | inactivity | …`), `structured_output` (populated on get/list),
  `acus_consumed`, `devin_mode`, `tags`, timestamps, `pull_requests`.
- Errors are RFC 9457 `application/problem+json`; `429 Too Many Requests` is a
  defined response on every endpoint.

**Notable v1→v3 regression for us:** v1 create has an `idempotent: bool` field
(and returns `is_new_session`) plus a per-session `snapshot_id`; **v3 has
neither** (https://docs.devin.ai/api-reference/v1/sessions/create-a-new-devin-session.md
vs the v3 schema). Idempotency in v3 must be client-side (our result cache /
input-hash keys), and warm-start comes from org-level blueprint snapshots, not
a per-call parameter.

### c) Structured output, end to end

Sources: v3 create + get session pages (above).

1. **On creation**, pass `structured_output_schema` (Draft 7, ≤64KB,
   self-contained). Keep `structured_output_required` at its default (`true`)
   so the agent is contractually required to call `provide_structured_output`
   with `is_final=true` before ending its turn.
2. **During the session**, the agent calls the internal
   `provide_structured_output` tool; the platform **validates the payload
   against the schema** ("Validated structured output from the session" — get
   session doc).
3. **Retrieval:** `GET /v3/organizations/{org_id}/sessions/{devin_id}` — the
   `structured_output` field, "only populated on get/list endpoints". There is
   no push; you poll the session until `status_detail: finished` (or terminal
   `exit`) and read the field.

This is genuinely better than what UAA has today: today the model *promises*
JSON and `lib/json-extract.ts` mops up; here the platform validates against a
schema server-side before we ever see it. The 64KB limit is far above any UAA
schema (~1–3KB each).

### d) Session lifecycle, latency, warm start, reuse

- **Lifecycle:** `new → claimed → running (working / waiting_for_user /
  finished) → suspended (inactivity/…) | exit | error`, with `resuming` on
  wake (get-session doc). Terminate: `DELETE .../sessions/{devin_id}`;
  archive-and-sleep: `POST .../archive`.
- **Wall-clock latency for a small analytical task: the docs do not state
  it, and I will not invent it.** Structurally it includes VM scheduling +
  agent boot + an agentic loop, and the official polling example samples every
  10s (https://docs.devin.ai/api-reference/common-flows.md). Realistic
  expectation is **minutes, not seconds** for a cold session; the Phase 4
  spike measures it (5 runs, cold and warm).
- **Warm start:** v3 has no per-session `snapshot_id`. Warm-boot state comes
  from org **blueprints → snapshots** that "every session boots from"
  (https://docs.devin.ai/onboard-devin/environment/blueprints.md, index
  description). For pure-analysis prompts with no repo work this matters
  little.
- **Session reuse — yes, and it's the interesting one:**
  `POST /v3/organizations/{org_id}/sessions/{devin_id}/messages` — "Send a
  message to an active session. **The session will be automatically resumed if
  suspended**"
  (https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions-messages.md).
  Combined with billing semantics — "When a session is idle, Devin goes to
  sleep. While sleeping, Devin does not consume usage… wake the session up at
  any time by sending another message"
  (https://docs.devin.ai/admin/billing/usage.md) — a long-lived
  analysis session can serve as a **pseudo-chat channel**: keep one warm
  "analyst" session, message it per request, poll `structured_output`.
  Wake-from-suspend latency is undocumented → spike measures it.

### e) Rate limits, concurrency, `max_acu_limit`

- **Concurrency:** "there are no concurrent session limits, so take advantage
  of it" — verbatim, https://docs.devin.ai/admin/billing/usage.md. (Enterprise
  admins get a queue-health endpoint, `GET /v3/enterprise/queue`, returning
  `normal | elevated | high` — release notes Jan 2026 — implying sessions can
  queue under load.)
- **Rate limits:** `429` is a documented response on every v3 endpoint, but
  **no numeric limits are published** anywhere in the docs I fetched. The
  provider must implement backoff-on-429 without assuming a budget.
- **`max_acu_limit`:** positive integer cap per session (v1 doc: "Maximum ACU
  limit, must be positive"). Suspension reasons include
  `usage_limit_exceeded`, giving a clean detectable state when a session hits
  its cap. Set it on every UAA session as a runaway-cost fuse (cost isn't a
  constraint, but a stuck agent burning ACUs on a malformed prompt is still a
  reliability bug).

### f) Attachments / large files (SEC filings)

Yes. `POST /v3/organizations/{org_id}/attachments` (multipart, permission
`UseDevinSessions`) → `{attachment_id, name, url}`; pass the `url` in
`attachment_urls` on session create or on a message
(https://docs.devin.ai/api-reference/v3/attachments/post-organizations-attachments.md).
Sessions also *produce* attachments retrievable via
`GET .../sessions/{id}/attachments` (common-flows doc). So full filings can be
attached instead of truncated into the prompt — an upgrade over today's
16k-token context ceiling on local models.

### g) MCP: can Devin pull data itself?

Yes, two distinct mechanisms, both organization-configured:

1. **MCP Marketplace / custom MCP servers** — Devin sessions can use org-enabled
   MCP servers (stdio, SSE, streamable HTTP; marketplace has Postgres, Snowflake,
   BigQuery, Datadog…, plus "Add a custom MCP")
   (https://docs.devin.ai/work-with-devin/mcp.md). A custom HTTP MCP exposing
   Yahoo/EDGAR fetchers is possible.
2. **Native web access** — Devin browses the web natively, so it can pull EDGAR
   filings or Yahoo pages without any MCP at all.

Caveats: MCP config is a **web-app admin action**, not fully API-driven; and
letting Devin fetch its own data trades determinism for autonomy — input hashes
stop pinning outputs, and grounding shifts from "we supplied the numbers" to
"the agent found some numbers". Important: UAA's data (SQLite/DuckDB) is
**local files on this Mac** — a cloud Devin session cannot reach them via any
database MCP without us exposing them. Push-data-in remains the default.

### h) Streaming / partial output

**There is no streaming API.** No SSE/websocket/webhook surface exists anywhere
in the v3 API index for session output. The closest mechanisms, both polling:

- `GET .../sessions/{devin_id}/messages` — chronological session messages,
  cursor-paginated ("Poll for events", common-flows doc). Gives *incremental
  transcript* visibility, not token streaming.
- `GET .../sessions/{devin_id}` — poll `status_detail` / `structured_output`.

Automations and Scheduled Sessions trigger sessions *in*; nothing calls back
*out* on completion. So: UF-stream surfaces cannot be served progressively by
the sessions API at all.

### Dana (Data Analyst agent)

Real, but UI/Slack-surfaced: agent picker or `/dana` in Slack
(https://docs.devin.ai/work-with-devin/data-analyst.md). It queries **connected
MCP data sources** (Redshift/Postgres/Snowflake/BigQuery…). The v3 sessions API
does not expose a `dana` value — `devin_mode` enumerates
`normal|fast|lite|ultra|fusion` only. And UAA's DuckDB/SQLite are local files a
cloud session can't reach. **Dana is not a viable UAA backend today.**

---

## B. Integration patterns, ranked

Ranking weights the user's stated priorities: latency and reliability, cost
explicitly not a constraint. "CLI" = the already-shipped `devin -p` transport.

| # | Pattern | Latency profile | Determinism / reliability | Serves |
|---|---|---|---|---|
| **1. Keep CLI for interactive, add API for heavy** (hybrid) | CLI: measured 3–8s. API: minutes, but nobody is watching | CLI: one shot, no tools, schema-checked client-side. API: schema-validated server-side | Everything, correctly partitioned |
| **2. Precompute via Schedules API → cache** | Zero user-facing latency (reads SQLite cache) | High — nightly batch, validated structured output, input-hash keyed | Verdicts for watchlist/portfolio names, scanner pipeline, screener rationales |
| **3. Session-per-analysis with JSON schema** | Cold session: unmeasured, expect minutes → **background only** | Highest per-call quality; server-validated output; `max_acu_limit` fuse | IC report agents, thematic stages, SEC filing deep-dives with attachments |
| **4. Batched: one session, N tickers → array** | Same cold cost amortized over N | Good; one schema `{results: [...]}`; partial-failure risk inside one session | Nightly watchlist/portfolio sweep, golden-output harness |
| **5. Long-lived session + messages as pseudo-chat** | Wake-from-suspend: undocumented → spike | Medium: context accumulates across turns, drift risk; sleep costs ~nothing | Possibly research copilot follow-ups; only if spike shows wake ≤ ~10s |
| **6. Devin-with-MCP / web pulls its own data (EDGAR)** | Slowest (agent browses) | Lower determinism, higher grounding ceiling | Quarterly deep filing analyses where freshness > repeatability |
| **7. Build-time: Devin maintains analysis code** | n/a at runtime | Perfect runtime determinism | Already how this repo works (Devin CLI wrote the quant/AI layers); keep |
| **8. Devin as orchestrator** (session spawns child sessions; `child_session_ids` exists) | Slowest | Hardest to reason about | Not needed — UAA's orchestrator already exists in-process |

Rejected: **API-only for everything** — with no streaming and cold-start in
minutes, serving `nl-screener` (a user staring at a search box) from a session
would be strictly worse than both current transports on the stated priorities.

---

## C. Verdict per UAA call-site class

Baseline reminder: interactive paths are *already* served by Devin (CLI
transport) at 3–8s. The sessions API's role is depth and reliability where
nobody is watching a spinner.

### Move fully to sessions API (async-by-nature already)

- **Scanner v2 pipeline** (6 AI stages, hourly, cached) — pattern 2/4. Replace
  the in-process cron with a Devin Schedule or keep local cron that creates
  sessions; either way results land in `scanner_cache` exactly as today.
- **IC Report** (9 agents + thesis + valuation) — pattern 3/4; the page already
  renders per-agent completion events, which maps 1:1 onto per-session polling.
  Server-validated JSON kills its biggest parse risk (`extractJsonObjectsLoose`
  exists because of this pipeline).
- **Thematic engine** (8 stages, minutes-long already, cancel = terminate
  session) — pattern 3, one session running the whole framework.
- **Golden-output comparison harness** (Phase 5) — pattern 4.

### Async/precompute redesign required (worth it)

- **AI verdict / report** (`investment-thesis`) — precompute via pattern 2 for
  watchlist + portfolio + recently-viewed names into the existing `aiVerdict`
  cache; CLI transport remains the on-demand fallback for cold tickers.
  UI already has pending/ready states from the streaming rewrite.
- **Deep SEC filing analysis** (`sec-filing-analysis`) — currently prompt-truncated;
  redesign around attachments (pattern 3 + f). This is the one place the
  sessions API is *better than any chat model*, not just acceptable.
- **Comparison, portfolio brief/new-positions** — precompute for held/watched
  universes; CLI for ad-hoc.

### Cannot move to sessions API — keep on Devin CLI transport (still Devin, not Ollama)

- **nl-screener, chart-qa, app-assistant, knowledge-graph-explain,
  calendar-brief, quick-summary** — interactive, sub-10s budgets. A
  cold-session API call is architecturally incapable of this; the CLI path
  already delivers ~3s.
- **Research copilot chat** — needs turn latency in seconds; pattern 5 is the
  only API shape and hinges entirely on unmeasured wake latency. Default: CLI.
  Revisit after the spike measures wake-from-suspend.
- **Explain-movement, market-summary, daily-briefing, asset-class Q&A** —
  same class: user-facing, short budgets → CLI.

Nothing lands in "genuinely cannot be served by Devin at all": between the two
transports every call site has a Devin home. What genuinely cannot work:
**Dana against local DuckDB** (unreachable data) and **token streaming of any
kind from the sessions API** (no such surface exists).

---

## D. Facts the Phase 4 spike must establish (docs are silent)

1. Cold `create → structured_output available` wall-clock, small analytical
   prompt, `devin_mode: normal` vs `fast` — 5 runs each, variance.
2. Wake-from-suspend latency via the messages endpoint (pattern 5 viability).
3. `acus_consumed` for a small task (informational; cost unconstrained).
4. Whether `structured_output` validates on first attempt against a real UAA
   schema (the verdict schema), and what happens on validation failure
   (does the agent retry? does the session error?).
5. Whether a second message to a `finished` session updates
   `structured_output` (multi-prompt reuse).
