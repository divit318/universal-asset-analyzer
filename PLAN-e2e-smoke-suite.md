# PLAN-e2e-smoke-suite: Playwright end-to-end smoke tests for every page

**Rank: #2 of 5.**

**Status: COMPLETE (2026-07-10).** 26 tests across `e2e/pages.spec.ts` (19-route
matrix + 4 dedicated idle/redirect checks) and `e2e/journeys.spec.ts` (3
journeys), all green with Ollama unreachable. Deviations from the assumptions
below (route list drift, no watchlist add-form, scanner auto-runs) are
documented inline in the spec files. See the implementation report in the
originating conversation for full detail.

## Goal

Close the "No e2e tests — UI breaks go unnoticed" debt (`PROJECT_ROADMAP.md`, Technical
Debt table). The project's own history proves the gap: at least four real bugs shipped
past `tsc` + eslint + 400+ unit tests and were only caught by *manual* browser passes —
a Recharts `ResponsiveContainer` measuring 0×0 (`/opportunity-map`), zero-radius `ZAxis`
scatter dots, a pan-drag stale-ref race (`graph-canvas.tsx`), and a client crash on a
missing LLM field (`/portfolio` Brief). A repeatable smoke suite makes every future
change (including the other four plans) verifiable without a human clicking 18 pages.

Scope: a **smoke** suite (every page renders, no console errors, key journeys work) —
not a full behavioral suite. Runs fully offline from Ollama (AI features must degrade
gracefully, which is an existing product guarantee worth asserting).

## Files to touch

- `package.json` — add devDependency `@playwright/test`, scripts `test:e2e`, `test:e2e:ui`
- `playwright.config.ts` — new
- `e2e/` — new directory:
  - `e2e/global-setup.ts` — seed an isolated SQLite DB
  - `e2e/helpers.ts` — console-error collector, shared assertions
  - `e2e/pages.spec.ts` — the all-pages smoke matrix
  - `e2e/journeys.spec.ts` — 3 deeper journeys with mocked app-API responses
  - `e2e/fixtures/` — JSON fixtures for mocked `/api/*` responses
- `.gitignore` — add `playwright-report/`, `test-results/`, `e2e/.tmp/`
- `vitest.config.ts` — **must not** pick up e2e specs: its `include` is already
  `tests/**/*.test.ts`, so name e2e files `*.spec.ts` under `e2e/` and verify
  `npm run test` count is unchanged.

## Critical design decisions (follow exactly)

1. **Isolated database.** The app reads `DB_PATH` (see `lib/db.ts` / CLAUDE.md env vars).
   The suite MUST NOT touch the user's real `data/app.db`. `playwright.config.ts`
   `webServer.env` sets `DB_PATH` to `e2e/.tmp/e2e.db` (delete the file in global-setup
   for a clean slate). Verify in global-setup that the resolved path is inside `e2e/.tmp/`.
2. **Production server, not dev.** `webServer.command: "npm run build && npm run start"`,
   `port: 3111` (pass `-p 3111` to `next start`; do NOT use 3000 — the user often has a
   dev server there), `reuseExistingServer: false`, `timeout: 300_000` (the build takes
   minutes). Dev-mode per-page compilation causes flaky timeouts (documented dev-nav
   freeze in `DESIGN_PROGRESS.md`).
3. **One worker.** `workers: 1` — SQLite + a single Next server; parallel workers cause
   write contention and cross-test state bleed.
4. **Ollama absent = pass.** Do not require Ollama. AI panels must show their fallback
   states. Never assert on AI-generated text.
5. **External network (Yahoo) tolerance.** Server-side Yahoo calls can't be intercepted
   by Playwright (they don't go through the browser). Pages that hard-depend on live
   quotes must be tested at the shell level: assert the page frame, header, and either
   data OR the page's documented empty/error state rendered — never assert on specific
   market data values.

## Step-by-step implementation order

### Step 1 — Install and scaffold

```
npm i -D @playwright/test
npx playwright install chromium
```
Only chromium. Add scripts: `"test:e2e": "playwright test"`, `"test:e2e:ui": "playwright test --ui"`.

### Step 2 — `playwright.config.ts`

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: 1,
  timeout: 45_000,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3111", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "npm run build && npm run start -- -p 3111",
    port: 3111,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { DB_PATH: "e2e/.tmp/e2e.db", NODE_ENV: "production" },
  },
});
```
(If `npm run start` doesn't forward args on this npm version, change the command to
`npm run build && npx next start -p 3111`.)

### Step 3 — `e2e/global-setup.ts` (seed data)

Seeding through `lib/db.ts` from a Playwright setup script is fragile (`node:sqlite`
version coupling, path aliases). Instead seed **through the app's own API** in a
`beforeAll`-style setup that runs after the server is up. Simplest robust approach:
make global-setup only clean `e2e/.tmp/`, and do seeding in `pages.spec.ts`'s
`test.beforeAll` via `request` fixtures:
- `POST /api/watchlist` — add 2 symbols (AAPL, MSFT) — read the route first to get the
  exact body shape (`app/api/watchlist/route.ts`)
- `POST /api/portfolio` — add 1 position — read `app/api/portfolio/route.ts` first

If a seed call fails (e.g. it validates against live Yahoo), log and continue — smoke
tests must still pass against an empty DB because every page has a designed empty state
(verified in `DESIGN_PROGRESS.md` audit).

### Step 4 — `e2e/helpers.ts`: console-error tripwire

The highest-value assertion in the suite. Attach on every page:

```ts
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}
```

Filter ALLOWED noise before asserting empty — build the allowlist empirically, but
expect at minimum: failed `fetch` to Ollama-backed endpoints (e.g. lines containing
`11434`, `ECONNREFUSED`), and 4xx/5xx resource loads for AI routes when Ollama is down.
Keep the allowlist as an exported array with a comment per entry. Everything else fails
the test — hydration mismatches and React crashes land here, which is the point.

### Step 5 — `e2e/pages.spec.ts`: the page matrix

One test per route. For each: `page.goto(route)`, wait for `networkidle` OR a
page-specific ready selector, assert (a) the shared header/nav rendered
(`header` element with the app nav — find the stable selector in
`app/_components/site-header.tsx`), (b) an `h1`/main content region exists, (c) console
errors (filtered) are empty.

Routes (all exist under `app/`): `/`, `/research?symbol=AAPL`, `/screener`, `/scanner`,
`/compare`, `/portfolio`, `/watchlist`, `/dcf`, `/calendar`, `/ic-report`, `/engine`,
`/thematic`, `/intelligence`, `/timeline`, `/knowledge-graph`, `/journal`, `/backtest`,
`/analyze` *(drop this one if PLAN-legacy-cleanup has run and deleted it)*.

Long-running pages (`/scanner`, `/ic-report`, `/thematic`) must NOT wait for their
pipelines — assert the initial/idle UI only (the "start scan" affordance renders).

### Step 6 — `e2e/journeys.spec.ts`: three deeper flows with mocked app APIs

Playwright `page.route()` CAN intercept the browser's calls to the app's own `/api/*`.
Use it to make three deterministic journeys:

1. **Search → research**: from `/`, open the command palette (`Meta+K` — it's mounted in
   `app/layout.tsx` via `command-palette.tsx`), mock `GET /api/search*` with a fixture,
   type "AAPL", pick the result, assert URL becomes `/research?symbol=AAPL`.
2. **Watchlist round-trip (real DB)**: `/watchlist` → add a symbol via the page's UI (no
   mocking; uses the seeded server) → row appears → delete it → row gone.
3. **Theme toggle**: on `/`, click the theme toggle (from `app/_components/theme.tsx`),
   assert `html[data-theme]` flips to `light`, reload, assert it PERSISTED (localStorage
   `uaa-theme`), toggle back. Guards the no-flash init script contract.

Fixture JSON shapes: copy from real route responses — run the route's handler types down
in `app/api/search/route.ts` etc. Never invent field names.

### Step 7 — Wire into docs and gate

- Add a short "E2E tests" section to `ARCHITECTURE.md` → Test Coverage.
- Run the full gate: `npm run test` (unit count unchanged), `npm run test:e2e` green.

## Edge cases a weaker model will miss

- **`networkidle` may never fire** on pages with the 90s notification-bell poll
  (`app/_components/notification-bell.tsx`, `POLL_MS = 90_000`) — the first tick fires at
  load. Prefer explicit ready selectors (`await page.getByRole("heading", ...)`) over
  `networkidle`; if you use `networkidle`, know that the bell's initial `/api/monitor/run`
  call can be slow (live Yahoo quotes) — bump per-page timeout instead of marking flaky.
- **`/research?symbol=AAPL` fires live Yahoo fetches server-side.** If offline, the page
  shows its error/empty state — the test must accept EITHER data or the designed error
  state, or it will be flaky on planes/rate-limits.
- **Next 16 async `searchParams`**: pages already handle this; do not "fix" anything in
  app code to make tests pass — the suite is read-only with respect to `app/` and `lib/`.
- **Do not assert exact text of AI panels** — content is model-dependent even when Ollama
  IS running; assert presence of the panel container or its fallback.
- **Command palette needs focus**: send `Meta+K` after clicking `body`; on Linux CI it's
  `Control+K` — the component binds both (check `command-palette.tsx` before assuming).
- **The build in `webServer.command` runs on every invocation** (~1–3 min). That's
  accepted for correctness; do NOT switch to the dev server to make it faster.
- **SQLite is per-process**: `next start` must be the ONLY process using
  `e2e/.tmp/e2e.db`. Never point tests at `data/app.db`; add an assertion in setup that
  `process.env.DB_PATH` contains `e2e/.tmp`.
- **Do not add e2e to `npm run test`** — vitest and Playwright must stay separate
  commands (CI time, and vitest would try to parse `.spec.ts` if include-glob changed).

## Acceptance criteria (verify each)

1. `npm run test:e2e` passes locally **with Ollama stopped** (run `pkill -f ollama` or
   just verify no Ollama process) and with the user's normal dev server left running on
   :3000 (proves port isolation).
2. `data/app.db` is byte-identical before/after the run
   (`shasum data/app.db` before and after).
3. `npm run test` (vitest) count is exactly unchanged.
4. The page matrix covers ≥17 routes; each test asserts header presence + filtered
   console-error emptiness.
5. All three journeys pass; journey 2 verifiably wrote to and cleaned up the e2e DB only.
6. Sabotage check (proves the tripwire works): temporarily throw inside any client
   component (e.g. add `throw new Error("boom")` in `app/watchlist/page.tsx` render),
   run the `/watchlist` smoke test, confirm it FAILS, then revert. Mention the result in
   the final report.
7. `playwright-report/`, `test-results/`, `e2e/.tmp/` are gitignored; `git status` clean
   of artifacts after a run.
