# Phase 2 — Devin API Capabilities & Integration Patterns

Date: 2026-08-02. Every claim below is backed by a doc page fetched live today
(URLs cited inline). Index discovered via https://docs.devin.ai/llms.txt.

---

## 1. Answers to the explicit questions

### (a) Is there any OpenAI-compatible / chat-completions endpoint?

**No — confirmed.** The complete API index (https://docs.devin.ai/llms.txt)
contains no completions, chat-completions, or raw-inference endpoint of any
kind, in v1, v2, or v3. The only inference-adjacent surfaces are: sessions
(agent runs in a VM), Devin Review (PR-specific), and the Devin/DeepWiki MCP
servers (repo Q&A for *other* agents). Devin is an agent platform, not a model
API. Every integration pattern below therefore rides on **sessions**.

### (b) Exact v3 session creation contract

Source: https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions.md
and https://docs.devin.ai/api-reference/authentication.md

- **Endpoint**: `POST https://api.devin.ai/v3/organizations/{org_id}/sessions`
- **Auth**: `Authorization: Bearer cog_...` — an **org-scoped service user API
  key**. Required permission: `ManageOrgSessions` (plus
  `ImpersonateOrgSessions` only if using `create_as_user_id`).
- **Request body** (`SessionCreateRequest`; only `prompt` is required):
  - `prompt` (string, required)
  - `structured_output_schema` (object) — "JSON Schema (Draft 7)… Max 64KB.
    Must be self-contained (no external $ref)."
  - `structured_output_required` (bool) — "When true (default), the agent MUST
    call provide_structured_output with is_final=true before its turn ends."
  - `devin_mode` — `normal` | `fast` (~2x faster, 4x cost, same intelligence) |
    `lite` | `ultra` | `fusion`
  - `playbook_id`, `knowledge_ids` (null = all knowledge, [] = none),
    `secret_ids`, `session_secrets` (per-session key/value, ≤64KB value)
  - `attachment_urls` (array of URLs from the attachments endpoint)
  - `repos` (attach repos), `tags`, `title`, `max_acu_limit`
  - `resumable` (default true) — "preserve the session's VM state after it
    stops so the session can be resumed. Set to false for disposable sessions."
  - `bypass_approval`, `child_playbook_id`, `session_links` (advanced/managed
    sessions), `platform` (VM platform / outpost pool), `create_as_user_id`
- **Response** (`SessionResponse`): `session_id` (`devin-…`), `url`, `status`
  (`new|claimed|running|exit|error|suspended|resuming`), `status_detail`
  (`working|waiting_for_user|waiting_for_approval|finished|…`),
  `structured_output` (object|null, "Only populated on get/list endpoints"),
  `acus_consumed`, `tags`, `created_at`/`updated_at` (epoch ints),
  `parent_session_id`/`child_session_ids`, `pull_requests`.
- Errors are RFC 9457 `problem+json` (`ProblemDetail`), incl. `429 Too Many
  Requests`.
- v1 (`POST /v1/sessions`, legacy `apk_` keys, deprecated) additionally has
  `idempotent: bool` and `snapshot_id`; v3 has neither field — dedup must be
  ours. Source: https://docs.devin.ai/api-reference/v1/sessions/create-a-new-devin-session.md

### (c) Structured output, end to end

Sources: create-session page above; https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session.md;
https://docs.devin.ai/api-reference/v3/playbooks/post-organizations-playbooks.md

1. Pass `structured_output_schema` (Draft 7, ≤64KB, self-contained) at session
   creation — or attach a **playbook that carries the schema** (playbooks have
   their own `structured_output_schema` field, so per-call payloads stay small).
2. With `structured_output_required: true` (the default), the agent **must**
   call its `provide_structured_output` tool with `is_final=true` before its
   turn ends; with `false` the tool is available but optional.
3. Retrieve via `GET /v3/organizations/{org_id}/sessions/{devin_id}` — the
   `structured_output` field is "**Validated** structured output from the
   session", populated only on get/list. There is no push/callback; you poll.
4. Open question for the Phase 4 spike: whether `structured_output` updates on
   every `provide_structured_output` call in a multi-message session or only
   holds the latest final value. The schema wording ("before its turn ends")
   implies per-turn re-provision is possible; must be verified empirically.

This is a genuine improvement over our Ollama JSON path: the platform validates
against the schema, so the "`{}` parses and silently renders fallback UI"
failure class disappears — but we still Zod-validate on our side (schema
validity ≠ semantic completeness).

### (d) Session lifecycle & realistic latency; warm starts; session reuse

- **Lifecycle**: `new → claimed → running (working | waiting_for_user |
  finished) → suspended | exit | error`. Idle sessions **sleep automatically
  after ~0.1 ACU of inactivity and consume nothing while sleeping**
  (https://docs.devin.ai/admin/billing/usage.md).
- **Wall-clock for a small analytical task**: **not documented anywhere**. The
  docs' own polling example polls at 10s intervals until `exit/error/suspended`
  (https://docs.devin.ai/api-reference/common-flows.md). Components: VM boot
  from the org snapshot + agent planning loop + the analysis itself + the
  structured-output call. Honest expectation: **minutes, not seconds**, even in
  `fast` mode; exact p50 is what the Phase 4 spike must measure. Nothing in the
  docs supports sub-30s round trips.
- **Warm start**: yes, via **snapshots**. Blueprints (YAML) build org snapshots
  ("frozen, bootable image every session starts from… Devin boots straight
  into productive work instead of setting up from scratch"); one active
  snapshot per org, rebuilt on blueprint save and ~every 24h
  (https://docs.devin.ai/onboard-devin/environment.md,
  https://docs.devin.ai/onboard-devin/environment/blueprints.md). This removes
  *setup* work, not VM boot or agent-loop overhead.
- **Session reuse**: yes. `POST /v3/organizations/{org_id}/sessions/{devin_id}/messages`
  — "Send a message to an active session. The session will be **automatically
  resumed if suspended**"
  (https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions-messages.md).
  Combined with sleep-costs-nothing, a long-lived session is a viable
  pseudo-chat channel: create once with schema + house-style playbook, then
  message per request and poll `structured_output`/messages. Resume latency
  from `suspended` is undocumented — spike must measure it.

### (e) Rate limits, concurrency, max_acu_limit

- **Concurrency**: "there are **no concurrent session limits**, so take
  advantage of it" (https://docs.devin.ai/admin/billing/usage.md). Enterprise
  has a queue-health endpoint (`GET /v3/enterprise/queue`, status
  normal/elevated/high), implying sessions queue under platform load
  (https://docs.devin.ai/api-reference/release-notes.md, Jan 2026).
- **Rate limits**: `429` is a documented response on every v3 endpoint, but
  **no numeric per-endpoint limits are published** in any page fetched. Design
  for 429 + exponential backoff; measure in the spike.
- **max_acu_limit**: per-session hard spend cap (positive int). When a session
  hits its cap it stops (observed behavior documented in this repo's own
  `docs/devin-integration.md`; the API reference defines the field but not the
  stop semantics). Use it as a runaway-cost/time bound per analysis.

### (f) Attachments (large SEC filings)

- Upload: `POST /v3/organizations/{org_id}/attachments` (multipart file,
  `UseDevinSessions` permission) → `{attachment_id, name, url}`; download via
  307-redirect to a presigned URL
  (https://docs.devin.ai/api-reference/v3/attachments/post-organizations-attachments.md,
  …/get-organizations-attachments.md).
- Reference the returned URL in `attachment_urls` at session creation, or
  inline in the prompt as `ATTACHMENT:"{file_url}"` (v1 doc convention).
- **No max file size is documented** — verify in the spike before relying on it
  for full 10-Ks. Sessions can also just be given the EDGAR URL (see g).

### (g) Can Devin pull data itself (vs. us pushing it in the prompt)?

Three mechanisms, all real:

1. **Sessions have full internet access** — shell + browser tools in the VM
   (https://docs.devin.ai/work-with-devin/devin-session-tools.md); the data-
   analysis use-case page shows sessions fetching public datasets from URLs
   (https://docs.devin.ai/use-cases/data-analysis.md). SEC EDGAR and Yahoo
   endpoints are plain HTTPS — a session can fetch them itself.
2. **MCP marketplace + custom MCP servers** (org-level, stdio/SSE/HTTP
   transports, admin-managed) let sessions use structured data tools
   (https://docs.devin.ai/work-with-devin/mcp.md). No Yahoo/EDGAR server is
   listed; we could register a custom one, but note UAA runs on localhost — a
   cloud Devin session **cannot reach UAA's own API routes**, so any custom MCP
   would have to be publicly hosted.
3. **Repos**: sessions can be created with this repo attached and use our
   actual `lib/` data-fetching code inside the VM (snapshot pre-built with
   `npm install` via blueprint).

Direction caveat: the **Devin MCP server** (https://mcp.devin.ai/) is the
*opposite* direction — it lets OUR tools drive Devin (create sessions, search
repos), not Devin pull our data (https://docs.devin.ai/work-with-devin/devin-mcp.md).

Product-rule caveat (AGENTS.md): UAA computes every directional conclusion in
code and hands the model settled facts. Letting Devin fetch raw data and derive
its own numbers reverses that hard-won rule — pushing our computed dossier
remains the right default; Devin-side fetching is for *supplementary* evidence
(filings text, news), not for the numbers.

### (h) Any streaming / partial-output mechanism?

**No token or field streaming exists.** Nothing SSE/WebSocket/streaming appears
anywhere in the API index. The closest primitives:

- `GET /v3/organizations/{org_id}/sessions/{devin_id}/messages` — chronological,
  cursor-paginated message list; polling it yields Devin's intermediate
  progress messages (coarse-grained, seconds-to-minutes cadence)
  (https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session-messages.md via index).
- Polling `GET session` for `status_detail` transitions (`working` →
  `finished`) — this maps cleanly onto UAA's existing **stage-progress** SSE
  pattern (scanner/IC/thematic already stream pipeline stages, not tokens).
- No outbound webhooks for session completion are documented — **polling only**.

Consequence: UAA's four true token/field-streaming surfaces (verdict stream,
copilot chat, compare stream, audit memo) cannot be reproduced 1:1 on Devin.
They either keep Ollama, degrade to whole-answer delivery, or move to a
pending→ready async UX.

---

## 2. Supporting platform facts

| Capability | Contract | Source |
|---|---|---|
| Playbooks | `POST /v3/organizations/{org_id}/playbooks` `{title, body, macro?, structured_output_schema?}` — a versioned "system prompt" attachable via `playbook_id`; can carry the output schema | api-reference/v3/playbooks/post-organizations-playbooks.md |
| Knowledge notes | `POST /v3/organizations/{org_id}/knowledge/notes` `{name, body, trigger, pinned_repo?}`; pinned-to-repo notes auto-apply; `knowledge_ids: null` = all knowledge | api-reference/v3/notes/post-organizations-knowledge-notes.md, onboard-devin/knowledge-onboarding.md |
| Secrets | `POST /v3/organizations/{org_id}/secrets` `{type: key-value/cookie/totp, key, value}`; or per-session `session_secrets` | api-reference/v3/secrets/post-organizations-secrets.md |
| Schedules | `POST /v3/organizations/{org_id}/schedules` `{name, prompt, schedule_type: recurring/one_time, frequency (cron), agent: devin/data_analyst, playbook_id?}` — native cron sessions; schema comes via the playbook (no direct schema field) | api-reference/v3/schedules/post-organizations-schedules.md |
| Fan-out (managed sessions) | Sessions can spawn child sessions (`child_session_ids`/`parent_session_id`/`child_playbook_id`/`session_links`); a coordinator Devin can "spin up managed Devins… monitor progress and wait for completion"; also `devin_session_create`/`devin_session_gather` via Devin MCP | work-with-devin/advanced-capabilities.md, api-reference/release-notes.md (Dec 8) |
| Dana (data analyst) | An **agent mode**, not a separate API: `agent: "data_analyst"` on schedules; UI/Slack picker otherwise. Requires an MCP data source. No distinct latency/streaming properties documented | work-with-devin/data-analyst.md via product guide, api-reference/v3/schedules/… |
| Session insights | `POST …/insights/generate` + GET — post-hoc analysis, useful for our golden-output harness metadata | api-reference/release-notes.md (Mar 11) |
| Consumption | `GET /v3/organizations/{org_id}/consumption/daily` — ACU per day/session for the migration's cost telemetry | llms.txt index (v3/consumption) |

---

## 3. Integration patterns, ranked

Ranked by fit for UAA given: latency is the constraint, cost is not; every UAA
surface already tolerates async + fallbacks; the app is localhost (no inbound
webhooks possible anyway).

### P1. Precompute/refresh: Devin sessions warm the SQLite cache; UI reads cache only — **best fit, migrate first**
Nightly/hourly (Devin native schedules, or our existing scheduler calling
session-per-analysis) sessions compute verdicts/theses/digests for the
portfolio + watchlist universe; results land in `scanner_cache` keyed
`(analysis_type, ticker, input_hash, schema_version)`; the UI only ever reads
cache, with "refresh" enqueuing a new job.
- **Latency profile**: UI reads are 0.04s (cache); freshness is the schedule
  interval. Cold-miss = pending state, minutes.
- **Determinism**: high — schema-validated output + our Zod + content-hash keys.
- **Failure modes**: stale-but-served (already UAA's SWR pattern); a failed
  session leaves the old entry.
- **Serves**: verdict (already 6h-cached!), portfolio thesis/holding-explain,
  home brief, watchlist digest, movement/financial-insight, scanner full run
  (already an hourly cron), calendar brief.

### P2. Session-per-analysis with JSON-schema output, async job UX — **the general workhorse**
`POST sessions` (schema + playbook + pushed dossier) → poll GET →
`structured_output` → validate → persist → UI pending→ready. Disposable
(`resumable: false`), `max_acu_limit` as the runaway bound, `fast` mode.
- **Latency**: minutes (spike to quantify). Fine wherever UAA already shows
  staged progress or a generate button; wrong for sub-10s interactive surfaces.
- **Determinism**: platform-validated schema; still our-side validation.
- **Failure modes**: session `error`, ACU cap hit, 429s, schema-valid-but-
  semantically-thin output; all map onto UAA's existing error taxonomy.
- **Serves**: IC report, thematic, simulator generate/swap/refresh, compare
  (as pending→ready), watchlist digest, one-off research reports.

### P3. Coordinator + child-session fan-out for multi-call pipelines
One session per IC report that spawns 9 agent children in parallel and gathers
(`advanced-capabilities.md`), or — simpler and more controllable — **our code**
creates 9+ concurrent sessions (no concurrency limit) and joins. Kills the
"Ollama serializes" constraint: IC's 852s sequential wall could approach
max(single agent) + synthesis + thesis ≈ 3 stages instead of 12.
- **Latency**: pipeline wall-clock potentially 3-4x better than today.
- **Determinism/failure**: per-child schema outputs; partial failure = the
  degrade path each stage already has.
- **Serves**: IC report, thematic, scanner sector fan-out.

### P4. Long-lived session + message endpoint as a pseudo-chat channel
Create once (playbook + schema), sleep costs ~nothing, `POST messages`
auto-resumes; poll messages/structured_output per turn.
- **Latency**: per-turn = resume + one agent turn; undocumented, likely
  30s–2min. No token streaming — the answer arrives whole.
- **Determinism**: context accumulates in the session (good for a research
  thread, bad for reproducibility); one `structured_output` object per session
  (per-turn update semantics unverified — spike item).
- **Failure modes**: session drift over long histories; suspension edge cases.
- **Serves**: research copilot / simulator intake *functionally*, but as a
  visibly slower, non-streaming chat. Honest call: degraded UX vs Ollama today.

### P5. Batched: one session analyses N tickers, returns an array
Amortizes boot + agent overhead across a watchlist/screener page.
- **Latency**: worse per-batch, far better per-ticker; a 10-ticker digest in
  one session beats 10 sessions for freshness sweeps.
- **Determinism**: array schema; per-item sanitizers we already have.
- **Failure modes**: one bad item vs whole batch — schema `items` + our loose
  salvage pattern applies.
- **Serves**: scanner company-impact, watchlist digest, screener annotations,
  nightly verdict warming (P1's engine).

### P6. Devin-with-MCP / repo-attached sessions pulling data itself
Attach this repo (snapshot pre-built via blueprint); Devin runs our own
fetchers/engines in the VM, or fetches EDGAR/news over the open internet, then
returns schema output.
- **Latency**: worst of all patterns (real work in-VM), but removes prompt-size
  limits entirely and lets Devin read full filings.
- **Determinism**: LOWER for numbers (violates the "established conclusions"
  product rule if misused) — restrict to textual evidence gathering.
- **Serves**: sec-filing-analysis, IC accounting/risk agents needing full 10-K
  text, thematic policy stage (live news).

### P7. Build-time: Devin writes/maintains deterministic analysis code; runtime uses no LLM
For surfaces whose "AI" is really templated composition (screener explain and
proactive-insights are ALREADY deterministic), Devin's job is authoring/
improving the deterministic engines via PRs — its existing role in this repo.
- **Serves**: any narrative that can be templated; quality-improvement loop for
  `lib/portfolio/thesis.ts`-style ESTABLISHED-CONCLUSIONS builders.

### P8. Devin native schedules replacing our in-process cron
`POST schedules` with cron + playbook replaces `UAA_SCANNER_INTERVAL_MS`'s
in-process timer for the scanner — but the session can't call localhost UAA, so
it must either run repo code in-VM (P6) or we keep our scheduler and just
create sessions (P1). **Keep our scheduler; use the sessions API** — schedules
only win when the whole job lives in the VM.

Rejected: anything requiring inbound webhooks (app is localhost-only), the
Devin MCP as a data plane (wrong direction), Dana (no API-distinct surface).

---

## 4. Verdict per UAA call site

### Moves to Devin fully (async/cached semantics already fit)
| Call site | Pattern |
|---|---|
| IC report (12 calls) | P3 fan-out (or P2 single session), stage-progress SSE unchanged |
| Thematic engine (8 calls) | P2/P3, stage-progress unchanged |
| Scanner/Wire pipeline (~6 sites) | P2 + P5 batching; hourly refresh via our scheduler (P1) |
| Research verdict `getVerdict` | P1 precompute + P2 on-demand refresh (already 6h/24h cached) |
| Portfolio thesis / holding-explain | P1/P2 (content-hash cached already) |
| Home brief | P1 (hourly cache already) |
| Watchlist digest | P2 (button → pending→ready) or P5 batch |
| Compare (blocking variant) & class compare | P2 pending→ready |
| Simulator generate / swap / refresh-narrative | P2 (already 300s budgets + progress stream) |
| Movement explainer / financial insight | P1 warm + P2 miss (15min TTL today) |
| Calendar brief | P2 with pending state (user already waits ~20-50s) |
| event-screener runScan | P2/P5 |

### Needs an async/precomputed redesign (works, but the UX contract changes)
| Call site | Why | Redesign |
|---|---|---|
| Verdict **stream** (`/api/ai/report`) | No token/field streaming on Devin | Serve cached (P1) instantly; on miss show staged pending, deliver whole; drop field-streaming when provider=devin |
| Compare **stream** | same | same |
| CIO audit memo (streamed prose) | same | whole-memo pending→ready |
| Simulator intake (live back-and-forth) | per-turn minutes vs 60s budget | P4 persistent session per simulation, or keep deterministic gap-checks as instant path + Devin only for the final synthesis |

### Genuinely poor fits — say so plainly
| Call site | Why Devin is wrong | Honest alternative |
|---|---|---|
| **Research copilot chat** (token streaming, multi-turn, seconds-matter) | No streaming; per-turn session latency is minutes-class; the retrieval/grounding pipeline lives in-app | Keep on Ollama behind the flag, or accept a visibly different "ask Devin (slower, deeper)" mode via P4 as an *addition*, not a replacement |
| **nl-screener** (spinner, ~seconds, trivial parse) | A VM-backed agent session to parse a search box is a category error | Keep Ollama; or replace with deterministic parsing (P7) |
| **chart-qa / app-assistant / knowledge-graph-explain / quick-summary** (interactive one-shots) | Same latency mismatch | Keep Ollama for interactive tier; optionally Devin for a "deep dive" affordance |
| Ollama status indicator / model picker | Provider-specific UI | Generalize to provider health in Phase 3 |

**Bottom line**: Devin cleanly absorbs UAA's *deep/background* tier — which is
where 99% of today's LLM wall-clock is spent (IC 852s, scanner 17min) and where
concurrency (banned under Ollama) buys real speedups. It cannot and should not
absorb the *interactive/streaming* tier; that tier stays on Ollama behind
`AI_PROVIDER` until/unless we deliberately redesign those UXs. The task
registry's existing `latency: interactive|standard|background` field is almost
exactly the routing key the hybrid needs.
