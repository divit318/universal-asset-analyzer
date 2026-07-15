# PLAN-background-alerts-scheduler: Alerts that fire without a browser tab or external cron

**Rank: #3 of 5.**

**Status: ✅ Implemented (2026-07-10).** All 6 acceptance criteria verified: tsc/eslint/tests (9 new, 619 total) clean, `npm run build` succeeds, live dev-server run confirmed a notification created with no tab open (`[monitor] 1 new alert(s), 5 unread`), `UAA_MONITOR_INTERVAL_MS=0` produced zero monitor log lines over 45s, route JSON shape unchanged, hot-reload did not double-register the interval.

## Goal

Make alert monitoring self-contained. Today, watchlist/portfolio alerts are only
evaluated when (a) a browser tab is open (the header bell polls `/api/monitor/run` every
90s — `app/_components/notification-bell.tsx`) or (b) the user has manually wired
`scripts/monitor.mjs` into cron/launchd (`scripts/README.md`). Most users will do
neither, so the alert engine built in Phase 1 (2026-07-07: `lib/alerts.ts`, notification
store, header bell) silently under-delivers its core promise: "tell me when my stock
hits the target, even if I'm not looking."

Fix: run the monitor on a timer **inside the Next.js server process** using the
`instrumentation.ts` hook (stable in Next 16, runs `register()` once per server start).
The server is already long-running and local — it IS the daemon.

## Files to touch

- `lib/monitor.ts` — **new**: extract the monitor logic out of the route
- `app/api/monitor/run/route.ts` — becomes a thin wrapper around `lib/monitor.ts`
- `instrumentation.ts` — **new**, at the repo root (same level as `next.config.ts`)
- `scripts/monitor.mjs` — header comment update only (it still works; note it's now
  optional, useful when the server runs but you also want OS notifications)
- `scripts/README.md` — document the new built-in scheduler + env vars
- `tests/monitor.test.ts` — **new**: unit tests for the extracted pure parts
- `ARCHITECTURE.md` — one short paragraph under the alerts/notification section

## Step-by-step implementation order

### Step 1 — Extract `lib/monitor.ts`

Move the body of `run()` from `app/api/monitor/run/route.ts` (lines ~22–50) into a new
exported function, WITHOUT the `NextResponse` wrapper:

```ts
export interface MonitorRunResult { created: number; unread: number; checked: number }
export async function runMonitor(): Promise<MonitorRunResult> { ... }
```

It uses `listWatchlist`, `listPortfolio`, `createNotifications`,
`unreadNotificationCount` from `@/lib/db`, `getQuotes` from `@/lib/yahoo`, and
`evaluateAlerts` from `@/lib/alerts` — move those imports with it. The route then becomes:

```ts
import { runMonitor } from "@/lib/monitor";
async function run() { return NextResponse.json(await runMonitor()); }
```

Behavior of the route must be byte-identical (same JSON fields, same empty-symbols
short-circuit `{created: 0, unread, checked: 0}`).

### Step 2 — Add the scheduler to `lib/monitor.ts`

```ts
const TICK_KEY = Symbol.for("uaa.monitor.interval");

/** Start the in-process alert monitor. Idempotent across dev hot-reloads. */
export function startMonitorScheduler(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[TICK_KEY]) return; // already scheduled (hot reload / double register)

  const intervalMs = resolveIntervalMs(process.env.UAA_MONITOR_INTERVAL_MS);
  if (intervalMs === 0) return; // explicitly disabled

  const tick = async () => {
    try {
      const r = await runMonitor();
      if (r.created > 0) console.log(`[monitor] ${r.created} new alert(s), ${r.unread} unread`);
    } catch (err) {
      console.warn("[monitor] tick failed:", err instanceof Error ? err.message : err);
    }
  };

  const t = setInterval(() => void tick(), intervalMs);
  t.unref?.(); // never keep the process alive just for the timer
  g[TICK_KEY] = t;
  // First run after a short warm-up, not immediately — Yahoo at boot is wasteful
  // when the bell will also fire on first page load.
  setTimeout(() => void tick(), 30_000).unref?.();
}

/** exported for tests */
export function resolveIntervalMs(rawEnv: string | undefined): number {
  const DEFAULT = 5 * 60_000;
  if (rawEnv == null || rawEnv === "") return DEFAULT;
  const n = Number(rawEnv);
  if (!Number.isFinite(n) || n < 0) return DEFAULT;
  if (n === 0) return 0;               // 0 disables
  return Math.max(n, 60_000);          // floor 60s — protect Yahoo from misconfig
}
```

### Step 3 — `instrumentation.ts`

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Dynamic import AFTER the runtime check: lib/monitor.ts transitively reaches
  // lib/db.ts (node:sqlite), which must never be bundled for the edge runtime.
  const { startMonitorScheduler } = await import("@/lib/monitor");
  startMonitorScheduler();
}
```

No top-level imports of anything that touches `node:sqlite`, `fs`, or `lib/yahoo.ts` —
only the dynamic import inside `register()` after the runtime guard. This is the same
class of bug as the documented Phase-2 client-bundle break ("does not support external
modules: node:sqlite") — check the FULL import chain, not just direct imports.

### Step 4 — Tests (`tests/monitor.test.ts`)

Pure-logic tests only (repo convention: no live API calls in tests):
- `resolveIntervalMs`: undefined → 300000; `"0"` → 0; `"30000"` → 60000 (floored);
  `"abc"` → default; `"-5"` → default; `"120000"` → 120000.
- `startMonitorScheduler` idempotence: call twice, assert only one interval was created
  (stub `setInterval` via `vi.spyOn(globalThis, "setInterval")`), then clean up the
  `Symbol.for` global and restore timers so other test files are unaffected.
- Do NOT unit-test `runMonitor()` end-to-end (it hits Yahoo); its parts
  (`evaluateAlerts`) are already covered in `tests/alerts.test.ts`.

### Step 5 — Docs

- `scripts/README.md`: "The server now runs this monitor itself every
  `UAA_MONITOR_INTERVAL_MS` (default 5 min; `0` disables). `scripts/monitor.mjs` remains
  useful for native OS notifications and for headless setups."
- `ARCHITECTURE.md`: add 3–4 lines to the alerts section describing
  `instrumentation.ts` → `startMonitorScheduler` → `runMonitor` and the env var.

### Step 6 — Gate

`npx tsc --noEmit`, `npx eslint .`, `npm run test`, then `graphify update .`.

## Edge cases a weaker model will miss

- **Dev hot-reload double-registration.** In `next dev`, `register()` can run again on
  restarts while the old interval survives in the same process. The `Symbol.for` global
  guard is mandatory — a plain module-scoped `let started` resets on module reload and
  will leak intervals.
- **Edge runtime bundling.** A static `import { startMonitorScheduler } from "@/lib/monitor"`
  at the top of `instrumentation.ts` gets bundled for BOTH runtimes and breaks the build
  on `node:sqlite`. The dynamic import inside the `NEXT_RUNTIME === "nodejs"` branch is
  load-bearing, not style.
- **`next build` also loads instrumentation in some configurations** — keep
  `instrumentation.ts` free of top-level side effects; everything happens inside
  `register()`, and `startMonitorScheduler` must not throw if the DB file doesn't exist
  yet (`runMonitor` failures are caught per-tick, but `startMonitorScheduler` itself must
  not call `runMonitor` synchronously).
- **`.unref()`** on both timers, or `next build`-spawned workers / test runners that
  import the module could hang on exit. Note `setInterval` in Node returns a `Timeout`
  with `.unref`, but under some bundling it can be the browser-typed signature — hence
  the defensive `t.unref?.()`.
- **Don't double-alert.** The bell keeps polling every 90s while a tab is open; the
  server tick adds a second evaluator. This is safe ONLY because `createNotifications`
  dedupes per condition per 24h (documented in `app/api/monitor/run/route.ts` and
  `scripts/monitor.mjs`) — do not "optimize" the dedup away, and don't change `POLL_MS`.
- **Yahoo rate limits**: the 60s floor exists so a typo like `UAA_MONITOR_INTERVAL_MS=1`
  can't hammer Yahoo with a quote batch every millisecond. Keep the floor.
- **Empty watchlist+portfolio**: `runMonitor` already short-circuits before calling
  Yahoo — preserve that ordering when extracting (the short-circuit must stay BEFORE
  `getQuotes`).

## Acceptance criteria (verify each)

1. `npx tsc --noEmit` clean, `npx eslint .` 0/0, `npm run test` green with new
   `tests/monitor.test.ts` passing (≥7 new tests).
2. `npm run build` succeeds (proves no edge-runtime/node:sqlite bundling break).
3. Runtime proof: start `npm run dev` with `UAA_MONITOR_INTERVAL_MS=60000`, add a
   watchlist item with an alert threshold that will trigger (e.g. `alert_pct_drop`
   trivially satisfiable), **close all app tabs**, wait ~2 minutes, then
   `sqlite3 data/app.db "SELECT COUNT(*) FROM notification"` (or GET
   `/api/notifications`) shows a new row created while no tab was open. The server log
   shows `[monitor] ... new alert(s)`.
4. `UAA_MONITOR_INTERVAL_MS=0 npm run dev` → no `[monitor]` log lines ever appear;
   scheduler disabled.
5. `POST /api/monitor/run` still returns `{created, unread, checked}` exactly as before
   (compare against the pre-change response shape) and `scripts/monitor.mjs` still runs.
6. In dev, trigger several hot reloads (edit any page file 3–4 times) — the `[monitor]`
   tick still logs at most once per interval (no interval leak / duplicate log lines).
