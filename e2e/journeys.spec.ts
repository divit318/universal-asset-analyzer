import { test, expect } from "@playwright/test";
import searchFixture from "./fixtures/search-aapl.json" with { type: "json" };
import { collectPageErrors, filterAllowedErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

test("journey: search palette -> research page", async ({ page }) => {
  const errors = collectPageErrors(page);

  // Mock the app's own /api/search so the palette result is deterministic —
  // this is a browser-origin call Playwright's page.route CAN intercept
  // (unlike the server-side Yahoo calls research/* makes).
  await page.route("**/api/search*", async (route) => {
    await route.fulfill({ json: searchFixture });
  });

  await page.goto("/");
  await page.locator("body").click();
  await page.keyboard.press("Control+k");

  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("textbox", { name: "Search" }).fill("AAPL");
  await expect(dialog.getByText("AAPL", { exact: true })).toBeVisible();

  await page.keyboard.press("Enter");
  await page.waitForURL(/\/research\?symbol=AAPL/);

  expect(filterAllowedErrors(errors)).toEqual([]);
});

test("journey: watchlist round-trip against the real (isolated) DB", async ({ page, baseURL }) => {
  const errors = collectPageErrors(page);
  const symbol = "NVDA";

  // The /watchlist page itself has no "add" form by design — symbols are
  // added from Research or Screener. To exercise a deterministic, real DB
  // round-trip without depending on live Yahoo quotes (which the Research
  // "add" button needs), add through the app's own API — the same
  // unmocked endpoint the UI calls — then verify + remove through the UI.
  const addRes = await page.request.post(`${baseURL}/api/watchlist`, {
    data: { symbol, name: "NVIDIA Corp." },
  });
  expect(addRes.ok()).toBeTruthy();

  await page.goto("/watchlist");
  const row = page.locator("li", { hasText: symbol });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: `Remove ${symbol} from watchlist` }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Remove from watchlist" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Remove", exact: true }).click();

  await expect(row).toHaveCount(0);

  // Confirm the deletion actually reached the server, not just optimistic UI.
  const listRes = await page.request.get(`${baseURL}/api/watchlist`);
  const { items } = (await listRes.json()) as { items: { symbol: string }[] };
  expect(items.some((i) => i.symbol === symbol)).toBe(false);

  expect(filterAllowedErrors(errors)).toEqual([]);
});

test("journey: theme toggle flips data-theme and persists across reload", async ({ page }) => {
  const errors = collectPageErrors(page);

  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");

  const toggle = page.getByRole("button", { name: "Switch to light theme" });
  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  const stored = await page.evaluate(() => localStorage.getItem("uaa-theme"));
  expect(stored).toBe("light");

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  expect(filterAllowedErrors(errors)).toEqual([]);
});
