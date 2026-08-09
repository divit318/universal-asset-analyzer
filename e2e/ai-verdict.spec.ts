import { expect, test } from "@playwright/test";
import { collectPageErrors, filterAllowedErrors } from "./helpers";

/**
 * The AI degrade contract, end to end, in the designed AI-off environment
 * (playwright.config.ts runs the server with NO Anthropic key and an empty
 * key-file directory):
 *
 *   1. The key API is presence-only — no route ever returns the key.
 *   2. The header badge tells the truth ("AI off · add key") and links to
 *      Settings; it never claims locality.
 *   3. /settings renders the no-key failure state with the entry form.
 *   4. AI-backed pages render their fallback — never a crash, never a blank
 *      panel, never a raw provider error.
 *
 * Deterministic engines rendering without a key is asserted at unit level in
 * tests/ai-no-key-boundary.test.ts; here we assert the pages built on them
 * still paint.
 */

/** A real key is sk-ant- followed by a long token; the UI may only ever show the "sk-ant-…" placeholder. */
const KEY_LIKE = /sk-ant-[A-Za-z0-9_-]{8,}/;

test("the key API reports presence only and never echoes a key", async ({ request }) => {
  const res = await request.get("/api/settings/ai-key");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["configured", "source"]);
  expect(body.configured).toBe(false);
  expect(body.source).toBeNull();
});

test("header badge says AI is off and links to Settings — and never claims locality", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/watchlist");
  const badge = page.getByRole("link", { name: /AI off · add key/ });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("href", "/settings");
  // F-01/F-03 guard, in-app: no surface may credit "Local AI" for hosted
  // generation, name the retired local runtime, claim zero egress, or make
  // the retired lifetime/locality claims.
  const html = await page.content();
  expect(html).not.toMatch(/Local AI/);
  expect(html).not.toMatch(/\bOllama\b/);
  expect(html).not.toMatch(/never leaves this machine/i);
  expect(html).not.toMatch(/all running locally/i);
  expect(html).not.toMatch(/\/ forever/);
  expect(filterAllowedErrors(errors)).toEqual([]);
});

test("app metadata makes no zero-locality claim (layout meta + manifest)", async ({ page, request }) => {
  // app/layout.tsx meta description said "all running locally"; the manifest
  // said "running entirely on your own machine". Both were false once
  // generation moved to the hosted API on the user's key — guard the fixes.
  await page.goto("/watchlist");
  const description = await page
    .locator('head meta[name="description"]')
    .first()
    .getAttribute("content");
  expect(description).not.toMatch(/all running locally/i);
  expect(description).toMatch(/computed locally, in a database you own/);

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const manifestText = await manifest.text();
  expect(manifestText).not.toMatch(/running entirely on your own machine/i);
  expect(manifestText).toMatch(/stay on your own machine/);
});

test("/settings renders the no-key failure state with the key form", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/settings");

  await expect(page.getByText("AI features are disabled — no API key is configured.")).toBeVisible();
  // The engines-keep-working promise is stated right on the failure card.
  await expect(page.getByText(/computed locally by the deterministic engines/)).toBeVisible();
  await expect(page.getByPlaceholder("sk-ant-…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save key" })).toBeVisible();

  // Never render anything that looks like a real key.
  const content = await page.content();
  expect(content).not.toMatch(KEY_LIKE);
  expect(filterAllowedErrors(errors)).toEqual([]);
});

test("research page degrades politely with no key: renders, no raw provider error", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/research?symbol=AAPL");

  // The shell and the deterministic surfaces paint; the page never crashes.
  await expect(page.locator("main")).toBeVisible();

  // Never a raw provider error on screen: no HTTP status jargon, no SDK
  // error names, no key material.
  const content = await page.content();
  expect(content).not.toMatch(/invalid x-api-key|authentication_error|APIError|AnthropicError/i);
  expect(content).not.toMatch(KEY_LIKE);

  expect(filterAllowedErrors(errors)).toEqual([]);
});
