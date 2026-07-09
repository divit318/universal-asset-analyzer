import { test, expect, request as playwrightRequest } from "@playwright/test";
import { collectPageErrors, filterAllowedErrors, expectShellRendered } from "./helpers";

/**
 * The full page matrix. Every route under app/ that has a page.tsx, per
 * PLAN-e2e-smoke-suite.md — with two adjustments verified against the
 * current codebase rather than the plan's original (stale) list:
 *
 *  - `/timeline` and `/knowledge-graph` no longer exist as routes (see
 *    project memory: both were merged into `/intelligence` behind
 *    `?view=timeline` / `?view=graph`). Testing those query variants below
 *    covers the same UI (GraphView / TimelineView) the plan intended.
 *  - `/analyze` still exists (PLAN-legacy-cleanup has not run), so it stays.
 *
 * Long-running pages (`/scanner`, `/ic-report`, `/thematic`) are asserted in
 * their initial/idle state only — see the "idle affordance" tests below.
 */
const ROUTES: string[] = [
  "/",
  "/research?symbol=AAPL",
  "/research?symbol=RELIANCE.NS", // India-market variant of the unified research page
  "/screener",
  "/scanner",
  "/compare",
  "/portfolio",
  "/watchlist",
  "/dcf",
  "/calendar",
  "/ic-report",
  "/engine",
  "/thematic",
  "/intelligence",
  "/intelligence?view=graph&scope=symbol&id=AAPL",
  "/intelligence?view=timeline&scope=symbol&id=AAPL",
  "/journal",
  "/backtest",
  "/analyze",
];

test.describe.configure({ mode: "serial" });

// Seed through the app's own API once the server is up — never write to
// lib/db.ts directly (fragile node:sqlite/path-alias coupling from a
// standalone script). Every page also has a designed empty state, so a
// failed seed call must not fail the suite.
test.beforeAll(async ({ baseURL }) => {
  const api = await playwrightRequest.newContext({ baseURL });
  try {
    for (const body of [
      { symbol: "AAPL", name: "Apple Inc." },
      { symbol: "MSFT", name: "Microsoft Corp." },
    ]) {
      const res = await api.post("/api/watchlist", { data: body });
      if (!res.ok()) console.warn(`[e2e seed] POST /api/watchlist ${body.symbol} -> ${res.status()}`);
    }

    const posRes = await api.post("/api/portfolio", {
      data: { symbol: "AAPL", name: "Apple Inc.", shares: 10, avgCost: 150 },
    });
    if (!posRes.ok()) console.warn(`[e2e seed] POST /api/portfolio AAPL -> ${posRes.status()}`);
  } catch (err) {
    console.warn("[e2e seed] setup call failed, continuing against empty DB:", err);
  } finally {
    await api.dispose();
  }
});

for (const path of ROUTES) {
  test(`renders cleanly: ${path}`, async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(path);
    await expectShellRendered(page);
    expect(filterAllowedErrors(errors), `unexpected console/page errors on ${path}`).toEqual([]);
  });
}

// Long-running pipelines: assert only the idle "start" affordance, per the
// plan — waiting for the pipeline itself (minutes, live Yahoo/Ollama) would
// make the suite flaky and slow for no additional coverage.
test("scanner: search form renders without waiting for the auto-triggered scan", async ({ page }) => {
  // Unlike ic-report/thematic, /scanner auto-starts a scan on mount (no
  // symbol/theme required) — there's no persistent pre-scan idle state, so
  // the equivalent smoke check is the always-present search/submit control,
  // which must render whether the button currently reads "Scan" or
  // "Scanning…". Either way, we must not block on the scan finishing.
  const errors = collectPageErrors(page);
  await page.goto("/scanner");
  await expectShellRendered(page);
  await expect(page.getByRole("button", { name: /^Scan(ning…)?$/ })).toBeVisible();
  expect(filterAllowedErrors(errors)).toEqual([]);
});

test("ic-report: idle state shows the generate affordance", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/ic-report");
  await expectShellRendered(page);
  await expect(page.getByRole("button", { name: "Generate Report" })).toBeVisible();
  expect(filterAllowedErrors(errors)).toEqual([]);
});

test("thematic: idle state shows the analyse affordance", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/thematic");
  await expectShellRendered(page);
  await expect(page.getByRole("button", { name: "Analyse" })).toBeVisible();
  expect(filterAllowedErrors(errors)).toEqual([]);
});

// Legacy India deep-link: /research/india must still redirect correctly.
test("research/india redirects to the unified research page", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/research/india?symbol=RELIANCE");
  await page.waitForURL(/\/research\?symbol=RELIANCE\.NS/);
  await expectShellRendered(page);
  expect(filterAllowedErrors(errors)).toEqual([]);
});
