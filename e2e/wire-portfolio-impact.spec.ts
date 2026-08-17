import { test, expect, type Page } from "@playwright/test";

/**
 * For You explicit-state contract (app/wire/page.tsx + for-you.tsx) —
 * carried over from the old Portfolio Impact zone this section replaced.
 *
 * The zone was once gated on `symbols.length > 0`, and loadUserSymbols()
 * folded a failed /api/watchlist or /api/portfolio into empty arrays — so a
 * fetch failure silently unmounted the whole section, indistinguishable from
 * the user simply tracking nothing. Same rule as Risk Monitor: a failure and
 * a genuine empty each say so in words, on the page.
 *
 * Route interception (not a live failure) so the states are forced
 * deterministically at mount time.
 */

/** Keep the auto-scan out of these tests: fulfil it with an instant error line. */
async function disableAutoScan(page: Page): Promise<void> {
  await page.route("**/api/scanner/v2", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "error", message: "e2e: scan disabled" }) + "\n",
    }),
  );
}

test("failed symbols fetch renders an explicit error state with Retry, never unmounts", async ({ page }) => {
  await disableAutoScan(page);
  await page.route("**/api/watchlist", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"forced"}' }),
  );
  await page.route("**/api/portfolio", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"forced"}' }),
  );

  await page.goto("/wire");

  const section = page.locator("#for-you");
  await expect(section).toBeVisible();
  await expect(
    section.getByText(/Couldn't load your watchlist and portfolio/),
  ).toBeVisible();
  await expect(section.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("genuinely empty watchlist + portfolio renders the explicit empty state", async ({ page }) => {
  await disableAutoScan(page);
  await page.route("**/api/watchlist", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"items":[],"groups":[]}' }),
  );
  await page.route("**/api/portfolio", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"holdings":[],"positions":[]}' }),
  );

  await page.goto("/wire");

  const section = page.locator("#for-you");
  await expect(section).toBeVisible();
  await expect(section.getByText(/Nothing tracked yet/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("one endpoint failing renders a partial notice, not a missing section", async ({ page }) => {
  await disableAutoScan(page);
  await page.route("**/api/watchlist", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"items":[{"symbol":"AAPL"}],"groups":[]}' }),
  );
  await page.route("**/api/portfolio", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"forced"}' }),
  );

  await page.goto("/wire");

  const section = page.locator("#for-you");
  await expect(section).toBeVisible();
  await expect(section.getByText(/Couldn't load your portfolio/)).toBeVisible();
  await expect(section.getByText(/is incomplete/)).toBeVisible();
});
