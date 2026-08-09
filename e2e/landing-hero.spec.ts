import { test, expect, type Page } from "@playwright/test";
import { collectPageErrors, filterAllowedErrors } from "./helpers";

/**
 * The reworked landing hero + pill navigation (login workstream).
 *
 * These are THIS workstream's landing assertions; e2e/landing.spec.ts belongs
 * to another session and still pins the previous hero contract — the overlap
 * is tracked in HANDOFF-LOGIN.md, not resolved by editing either file.
 *
 * Runs against the gated server (playwright.login.config.ts, :3121); the
 * landing page is public, so the gate must never interfere here.
 */

test.describe("landing hero (login rework)", () => {
  test("renders kicker, two-line serif headline, subhead, CTAs and the thesis wave", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/landing");

    // Exactly one h1, carrying both approved lines.
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText("Every figure computed.");
    await expect(h1).toContainText("Every claim traced.");

    // Kicker is the committed motto.
    await expect(page.getByText("Evidence in ink.")).toBeVisible();

    // The previously approved headline lives on as the problem-first opener.
    await expect(
      page.getByText("Stop juggling a dozen investing tools.", { exact: false }),
    ).toBeVisible();

    // CTA pair: primary opens the modal (asserted in auth.spec.ts), secondary
    // keeps the committed label and target.
    const hero = page.locator("section#hero");
    await expect(hero.getByRole("button", { name: /Get started/ })).toBeVisible();
    await expect(hero.locator('a[href="#demo"]')).toBeVisible();

    // The scroll-scrubbed thesis flow: a live canvas plus spine-derived
    // waypoint labels (real DOM text).
    const wave = hero.locator("canvas");
    await expect(wave).toBeVisible();
    await expect(wave).toHaveAttribute("aria-hidden", "true");
    await expect(hero.getByText("Deterministic Engines", { exact: true })).toBeVisible();

    expect(filterAllowedErrors(errors)).toEqual([]);
  });

  test("pill nav: centred links, ghost Sign in, filled Get started; shadow arrives past the hero", async ({ page }) => {
    await page.goto("/landing");
    const nav = page.getByRole("navigation", { name: "Primary" });

    await expect(nav.locator('a[href="#features"]')).toBeVisible();
    await expect(nav.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Get started" })).toBeVisible();

    // Un-scrolled: no elevated chrome. Past the hero: shadow + stronger blur.
    await expect(nav).not.toHaveClass(/shadow-popover/);
    await page.evaluate(() => {
      const hero = document.getElementById("hero");
      window.scrollTo(0, (hero?.getBoundingClientRect().height ?? 900) + 400);
    });
    await expect(nav).toHaveClass(/shadow-popover/);
  });

  test("theme toggle switches and persists across reload", async ({ page }) => {
    await page.goto("/landing");
    const initial = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
    const flipped = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(flipped).not.toBe(initial);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", flipped!);
    // NOTE (deferred, owner contract-b hold): honoring prefers-color-scheme on
    // a fresh visit is NOT asserted — the committed default is dark until the
    // owner approves the swatch review.
  });
});

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("landing responsive", () => {
  test("1440px: no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/landing");
    await expectNoHorizontalOverflow(page);
  });

  test("768px: no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/landing");
    await expectNoHorizontalOverflow(page);
  });

  test("375px: no horizontal overflow; sheet menu opens, traps focus, closes", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/landing");

    // The comparison table became stacked cards below 768px (design rebuild),
    // so the whole page is held to zero overflow with no exclusions.
    await expectNoHorizontalOverflow(page);

    // The thesis flow canvas stays on screen and centred.
    const waveBox = await page.locator("section#hero canvas").boundingBox();
    expect(waveBox).not.toBeNull();
    const centerX = waveBox!.x + waveBox!.width / 2;
    expect(centerX).toBeGreaterThan(0);
    expect(centerX).toBeLessThan(375);

    // The pill collapses to logo + hamburger; the sheet is a real dialog.
    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('a[href="#pricing"]')).toBeVisible();

    // Focus is trapped inside the sheet.
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    const inSheet = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog?.contains(document.activeElement) ?? false;
    });
    expect(inSheet).toBe(true);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });
});

test.describe("landing motion preferences", () => {
  test("renders completely under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = collectPageErrors(page);
    await page.goto("/landing");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("section#hero canvas")).toBeVisible();
    expect(filterAllowedErrors(errors)).toEqual([]);
  });
});
