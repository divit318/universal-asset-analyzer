# 13. Instrumentation: the Today dashboard (`/`)

Method: inventory every write path that records anything about dashboard usage, state plainly which product questions are unanswerable today, then specify the minimal local-first event schema, the analyses it enables, and a buildable implementation plan. Evidence: file:line cites; grep of `lib/` and `app/` for track/analytics/telemetry/instrument; `package.json` (no analytics dependency of any kind: no posthog, mixpanel, segment, amplitude, plausible, vercel/analytics, gtag).

The one-sentence verdict: the dashboard writes two narrow state tables (visits and dismissals) and nothing else; every question about whether the page WORKS - is the brief read, does priority rank predict action, where is the queue abandoned - is unanswerable, and the priority model (attention.ts SCORE_EXPONENTS) has no ground truth to be tuned against.

---

## 1. What is recorded today

| Store | What it captures | What it cannot tell you |
|---|---|---|
| `activity` table (`lib/db.ts:328-336`) | One row per (kind, ref): last visit to a place, upserted. Written by `useRecordActivity` (`app/_home/use-record-activity.ts:19-35`, 1.5s debounce, fire-and-forget) via `POST /api/home/activity` (`app/api/home/activity/route.ts:35-62`). | Frequency (upsert overwrites history), duration, path (which page led where), anything on the dashboard itself - the home page records that it was visited, nothing about what happened on it. |
| `attention_dismissal` (`lib/db.ts:342-347`) | Live suppression set: dedupe_key, dismissed_at, expires_at. | History: expired rows are DELETED inside `listActiveDismissals` (`db.ts:3097-3100`) and undo DELETEs the row (`db.ts:3088-3090`). You cannot count dismissals per kind over time, measure dismiss-and-return, or correlate dismissals with scores - the score is not stored. |
| `home_fingerprint` (`lib/db.ts:354-356`) | Change-detection state (current/baseline digest fingerprints). Product state, not usage. | Nothing about the user. |
| `ai_call` ledger (`lib/db.ts:3562-3608`, `lib/ai/telemetry.ts`) | Per-provider-attempt AI telemetry: task, model, latency, tokens, cost. 90-day retention. Read by /dev/ai. | AI infrastructure only; no user-behavior events. |
| Sentry (`instrumentation.ts:1-27`, `sentry.server.config.ts:12-16`) | Server-side errors only: `tracesSampleRate: 0`, no-op without SENTRY_DSN, nodejs runtime only. No client config file exists (find for `sentry*` returns only the server config), so client-side errors and any notion of session/interaction are not captured. | Everything except server exceptions. |

No telemetry route exists (`ls app/api/home/` -> activity, attention, brief, route.ts). No `useTelemetry` anywhere. The architecture map already recorded the conclusion (`00-architecture-map.md:151`): "No dashboard usage instrumentation found in app/_home/ beyond visit recording."

### Questions that CANNOT be answered today

1. **Is the brief read?** No render, expand, or dwell events. The AI Investment Brief ships `defaultCollapsed` (`00-architecture-map.md:24-25`); whether anyone ever expands it - the one fact that decides whether its hourly LLM spend is justified - is unrecorded.
2. **Which queue kinds get acted on vs dismissed?** Clicks on `primaryAction` are plain `<Link>`s (`attention-queue.tsx:319-331, 422-428`); nothing records them. Dismissals are stored without kind or score and are purged on expiry.
3. **Does priority rank predict action?** The entire premise of the queue is the geometric score (`attention.ts:46`). Zero ground truth exists: no (score, position, outcome) tuple has ever been written. The exponents are untunable in principle, not just in practice.
4. **Where is the queue abandoned?** MAX_VISIBLE is 8 with a "N more items" expander (`attention-queue.tsx:59, 722-737`); whether users expand, how deep they act, and whether the spotlight absorbs all attention are unknown.
5. **Dismiss-and-return rate**: does a dismissed story that resurfaces (TTL lapse or band change) get acted on, or re-dismissed? The dismissal row is gone by then.
6. **Does "Resume" resume anything?** The chip's click is an uninstrumented `<Link>` (`todays-brief.tsx:379-388`).

---

## 2. Minimal event schema

Constraints honored: local-first (SQLite via `lib/db.ts`, the only DB entry point per AGENTS.md), NO external analytics service, fire-and-forget writes that can never break the page (the `use-record-activity.ts` precedent), and events chosen strictly to answer section 1's questions - nothing speculative.

### Event names and properties

Common envelope on every event: `at` (ms), `sessionId` (random per page load, client-generated), `event`, plus a flat JSON `props` column.

| Event | Props | Emitted where |
|---|---|---|
| `home.view` | `digestGeneratedAt`, `openCount`, `queueStatus` | `HomeProvider` when the digest resolves (`app/_home/home-provider.tsx`), via the new `useTelemetry` hook |
| `brief.render` | `aiGenerated: boolean`, `cached: boolean` | `TodaysBriefModule` when headline first paints (`todays-brief.tsx:157-160`) |
| `brief.expand` | `section: "why" \| "long-read"` | AI Investment Brief expand toggle (`ai-investment-brief.tsx`, the ModuleShell collapse callback) and spotlight WHY toggle (`attention-queue.tsx:298-305`) |
| `queue.item.view` | `dedupeKey`, `kind`, `score`, `position`, `spotlight: boolean` | `AttentionQueueModule` once per item per session when the row first becomes visible (emit for the initial 8 on paint; for the rest on expand) |
| `queue.expand` | `hiddenCount` | the "N more items" button (`attention-queue.tsx:724-727`) |
| `queue.item.action` | `dedupeKey`, `kind`, `score`, `position`, `href` | onClick of `primaryAction` links and Enter in the keyboard handler (`attention-queue.tsx:319-331, 422-428, 583-588`) |
| `queue.item.dismiss` | `dedupeKey`, `kind`, `score`, `position`, `undone: boolean` (patched to true by the undo handler) | the `dismiss` callback (`attention-queue.tsx:498-563`) |
| `queue.filter` | `filter` | filter chips (`attention-queue.tsx:641`) |
| `resume.click` | `kind`, `ref` | the Resume chip (`todays-brief.tsx:380`) |

That is nine events. `queue.item.view` with `score` and `position` is the one that makes calibration possible; `dedupeKey` is the join key across view/action/dismiss and across sessions (dismiss-and-return).

### Storage

New table in `lib/db.ts` (CRUD in db.ts only, per repo rule):

```sql
CREATE TABLE IF NOT EXISTS home_event (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  session_id TEXT    NOT NULL,
  event      TEXT    NOT NULL,
  props      TEXT    NOT NULL DEFAULT '{}'   -- flat JSON
);
CREATE INDEX IF NOT EXISTS idx_home_event_at    ON home_event (at DESC);
CREATE INDEX IF NOT EXISTS idx_home_event_event ON home_event (event, at DESC);
```

Retention: 180 days, swept inline on insert exactly like the `ai_call` ledger does (`db.ts:3605-3607`) - one indexed DELETE per batch write, no scheduler. 180 not 90 because calibration needs sample size and a single local user generates little data; a year of a daily user is roughly 10-20k rows, negligible for SQLite.

Transport: batched `POST /api/home/telemetry` accepting `{ events: [...] }` (max 50 per call, validated event-name allowlist, same-origin same as the activity route's href check). The client hook buffers events and flushes on a 5s timer, at 20 events, and on `visibilitychange`/`pagehide` via `navigator.sendBeacon` so tab-close events are not lost. Response is always 204 (the activity route's "quiet 204" convention, `app/api/home/activity/route.ts:5-7, 61`).

### The 5 analyses this enables

1. **Action rate by kind**: `queue.item.action` / `queue.item.view` grouped by `kind`. Decides whether signal rows earn their queue slots or should be demoted to the Radar (03's open question).
2. **Action rate by score decile (calibration)**: group `queue.item.view` by `floor(score/10)`, join actions within the session on `dedupeKey`. If the action-rate curve is not monotonic in score, `SCORE_EXPONENTS` are wrong; this is the ground truth the priority model consumes (see the read view below).
3. **Dwell before first action**: first `queue.item.action.at` minus `home.view.at` per session. Measures whether the page achieves its "one decision fast" premise or forces re-reading.
4. **Dismiss-and-return rate**: `queue.item.dismiss` rows whose `dedupeKey` reappears in a later session's `queue.item.view`, split by what happened next (action vs re-dismiss vs nothing). Directly validates or refutes the per-kind TTLs (`attention.ts:60-66`) with data.
5. **Brief expand rate**: `brief.expand` / `brief.render`, split by `aiGenerated`. Decides whether the long read and its LLM call cadence are earning their cost, and whether the deterministic fallback is read any less than the AI prose.

---

## 3. Implementation plan (for the parent agent to build)

Order matters: table, route, hook, emitters, read view. Each step ships alone.

1. **`lib/db.ts`**: add the `home_event` DDL beside the other CREATE TABLE statements (near `attention_dismissal`, :342); add `insertHomeEvents(rows: HomeEventRecord[]): void` (single transaction, inline 180-day sweep) and `listHomeEvents(opts: { sinceMs?, event?, limit? })` following the `insertAiCall`/`listAiCalls` pattern (:3591-3641). No other file touches the table.
2. **`app/api/home/telemetry/route.ts`** (new): POST only, `runtime = "nodejs"`, `dynamic = "force-dynamic"`. Parse `{ events }`, cap at 50, allowlist the nine event names, coerce `props` through a per-event schema (drop unknown keys, cap string lengths at 120 like the activity route's MAX_LABEL), stamp server `at` when missing, call `insertHomeEvents`, return 204 unconditionally (malformed input is dropped silently, matching `activity/route.ts:57-59`).
3. **`app/_home/use-telemetry.ts`** (new): `useTelemetry()` returning a stable `track(event, props)`; module-level buffer + sessionId (crypto.randomUUID per load); flush on 5s interval, on 20-event buffer, and on `pagehide`/`visibilitychange: hidden` via `sendBeacon("/api/home/telemetry", blob)`; every path try/caught - telemetry can never throw into a component. Also export `trackOnce(key, event, props)` for per-session-deduped emissions (`queue.item.view`).
4. **Emitters** (smallest diffs): `home-provider.tsx` (home.view on digest resolve), `todays-brief.tsx` (brief.render :157-160, resume.click :380), `ai-investment-brief.tsx` (brief.expand on the collapse toggle), `attention-queue.tsx` (queue.item.view for visible items in a render effect keyed by dedupeKey; queue.item.action in the Link onClick handlers :319-331/:422-428 and the Enter branch :583-588; queue.item.dismiss inside `dismiss` :498; the undo onClick :547 patches `undone`; queue.expand :724; queue.filter :641). Dismiss events should ALSO be written server-side by extending the dismiss route's POST to log kind+score if sent - belt and braces so analysis 4 survives client loss - but the client event is the primary record because it carries position.
5. **Read view for calibration** (the piece the priority model consumes later): `lib/home/telemetry-read.ts` (new, pure aggregation over `listHomeEvents`, mirroring how `lib/ai/telemetry.ts` aggregates over `listAiCalls`): `computeQueueCalibration(sinceMs): { decile: number; views: number; actions: number; dismissals: number; actionRate: number }[]` joining view/action/dismiss on (sessionId, dedupeKey), plus `computeKindFunnel`, `computeDwell`, `computeDismissReturn`, `computeBriefEngagement`. Exposed at `GET /api/home/telemetry/calibration` and rendered on `/dev/ai`'s sibling or a small `/dev/home` panel. The contract deliberately outputs per-decile action rates so a future re-fit of `SCORE_EXPONENTS` (or the AG-08 preset toggle) can consume it directly as ground truth without re-reading raw events.
6. **Tests**: a pure test for the aggregations (fixture event rows -> expected deciles), a route test for allowlist/caps, and a hook test asserting no event is emitted twice per session per dedupeKey.

Explicitly out of scope: any external service, user identification beyond the per-load sessionId (single-user local app), scroll/heatmap tracking, and instrumenting non-dashboard pages (the schema generalizes, but earn that with this page first).

---

## 4. Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| IN-01 | High | The dashboard has no usage instrumentation: two state tables (visits, dismissals) that overwrite or purge themselves, no event log, no client error capture. None of section 1's six product questions is answerable. | db.ts:328-336, 342-347, 3097-3100; app/api/home has no telemetry route; package.json has no analytics dependency |
| IN-02 | High | The priority score - the queue's core product claim - has zero ground truth: no (score, position, action/dismiss) tuple is ever recorded, so `SCORE_EXPONENTS` cannot be validated or tuned, and 03's scale-compression finding cannot be tested. | attention.ts:46; attention-queue.tsx:319-331 (uninstrumented Links) |
| IN-03 | Medium | Dismissals are stored without kind, score, or history (rows purged at expiry, deleted on undo), making dismiss-rate, dismiss-and-return, and TTL validation impossible even from the one interaction that IS persisted. | db.ts:3077-3100; dismiss route stores only dedupeKey + timestamps (route.ts:31-33) |
| IN-04 | Medium | The AI brief's engagement is unmeasured while it carries the page's only LLM cost: `defaultCollapsed` long read with no expand event, no render/read split between AI and deterministic prose. | 00-architecture-map.md:24-25, 110-119; no emitter in ai-investment-brief.tsx |
| IN-05 | High (enabler) | The fix is small and local-first: nine events, one SQLite table with inline sweep (the `ai_call` pattern), a batched 204 route, a `useTelemetry` hook, and a pure calibration read view; five named analyses fall out directly. | Plan in section 3; patterns already in-repo at db.ts:3591-3608, use-record-activity.ts:19-35, activity/route.ts:35-62 |
| IN-06 | Low | Precedents to follow already exist and should be cited in the implementation PR: the quiet-204 route convention, the fire-and-forget hook, and the ledger-with-inline-retention pattern, so the new code introduces no novel infrastructure. | activity/route.ts:5-7; use-record-activity.ts:6-8; db.ts:3588-3607 |

Dependency note for the parent agent: 07's AG-09 (journal capture) and AG-10 (`via`/`ref` navigation params) share the `dedupeKey` join key with this schema; building IN-05 first makes both measurable from day one.
