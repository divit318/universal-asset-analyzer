import { test, expect } from "@playwright/test";
import { collectPageErrors, filterAllowedErrors } from "./helpers";

/**
 * Milestone 1 — the marketing landing skeleton at /landing.
 *
 * This page is the future site root, built at a temporary route for now. Unlike
 * every app route (covered by pages.spec.ts via expectShellRendered), it ships
 * its OWN chrome and suppresses the authenticated SiteHeader — so it gets its
 * own assertions rather than the shared shell smoke test.
 *
 * The expected section order is asserted explicitly here (not imported) so a
 * reorder of the IA is a deliberate, reviewed change to this contract.
 */
const SECTION_ORDER = [
  "hero",
  "problem",
  "solution",
  "privacy",
  "features",
  "demo",
  "comparison",
  "pricing",
  "faq",
  "cta",
];

test.describe("landing skeleton", () => {
  test("renders every section in IA order with a single h1", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/landing");

    // Exactly one <h1> — the hero — and it names the product.
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();

    // Sections exist and appear in the exact registry order.
    const ids = await page.locator("main section[id]").evaluateAll((els) =>
      els.map((el) => el.id),
    );
    expect(ids).toEqual(SECTION_ORDER);

    expect(filterAllowedErrors(errors)).toEqual([]);
  });

  test("ships marketing chrome and suppresses the app nav", async ({ page }) => {
    await page.goto("/landing");

    // The authenticated app header (a `banner` landmark) must NOT be present.
    await expect(page.getByRole("banner")).toHaveCount(0);

    // The marketing header's primary CTA and anchor nav are present.
    await expect(page.getByRole("link", { name: "Experience UAA" }).first()).toBeVisible();
    await expect(page.locator('header a[href="#features"]')).toBeVisible();
  });

  test("stacks and exposes a working mobile menu on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/landing");

    // Desktop anchor nav is hidden; the menu toggle is the mobile affordance.
    const toggle = page.getByRole("button", { name: "Open menu" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator("#landing-mobile-nav")).toBeVisible();
    await expect(page.locator('#landing-mobile-nav a[href="#pricing"]')).toBeVisible();
  });
});

test.describe("landing hero (Milestone 2)", () => {
  test("shows the approved headline, subhead, CTAs and product placeholder", async ({ page }) => {
    await page.goto("/landing");

    // Exact approved headline copy (Creative Direction §9).
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Stop juggling a dozen investing tools.",
    );

    // Subhead names what actually ships.
    await expect(
      page.getByText("combines market data, filings, valuation models", { exact: false }),
    ).toBeVisible();

    // CTA hierarchy: primary into the app, secondary to the in-page demo.
    const hero = page.locator("section#hero");
    await expect(hero.getByRole("link", { name: "Experience UAA" })).toBeVisible();
    await expect(hero.locator('a[href="#demo"]')).toBeVisible();

    // The product-reveal placeholder frame exists (real screenshot lands in M7).
    await expect(hero.getByTestId("hero-product-reveal")).toBeVisible();
  });
});

test.describe("landing problem → solution → demo (Milestone 3)", () => {
  test("problem section states the inefficiency after the hero", async ({ page }) => {
    await page.goto("/landing");
    const problem = page.locator("section#problem");
    await expect(problem.getByRole("heading", { name: "Why does research feel so fragmented?" })).toBeVisible();
  });

  test("solution section reveals the workbench with feature bullets", async ({ page }) => {
    await page.goto("/landing");
    const solution = page.locator("section#solution");
    await expect(solution.getByRole("heading", { name: "Meet the Universal Asset Analyzer." })).toBeVisible();
    await expect(solution.getByText("Live market data")).toBeVisible();
  });

  test("demo runs a canned analysis with no network", async ({ page }) => {
    await page.goto("/landing");
    const demo = page.locator("section#demo");

    const input = demo.getByPlaceholder("Research any ticker…");
    await expect(input).toBeVisible();
    const analyze = demo.getByRole("button", { name: "Analyze" });
    await expect(analyze).toBeVisible();

    // No result before submitting.
    await expect(demo.getByText("Illustrative sample — not live data")).toHaveCount(0);

    await input.fill("NVDA");
    await analyze.click();

    // Canned result + honest disclaimer appear.
    await expect(demo.getByText("NVIDIA Corp.")).toBeVisible();
    await expect(demo.getByText("Drafted AI summary")).toBeVisible();
    await expect(demo.getByText("Illustrative sample — not live data")).toBeVisible();
  });
});

test.describe("landing feature showcase (Milestone 4)", () => {
  test("renders every feature story with an accessible preview placeholder", async ({ page }) => {
    await page.goto("/landing");
    const features = page.locator("section#features");

    await expect(features.getByRole("heading", { name: "Comprehensive company profiles" })).toBeVisible();
    await expect(features.getByRole("heading", { name: "Build any screener" })).toBeVisible();
    await expect(features.getByText("Research Hub").first()).toBeVisible();

    // Five feature rows → five preview placeholders, each an accessible image.
    await expect(features.getByTestId("feature-preview")).toHaveCount(5);
    await expect(
      features.getByRole("img", { name: /Research Hub — company profile/ }),
    ).toBeVisible();
  });
});

test.describe("landing motion (Milestone 5)", () => {
  test("scrolling the whole page triggers scroll-reveals with no JS errors", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/landing");

    // Step-scroll to the bottom so every IntersectionObserver fires.
    const height = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y <= height; y += 600) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(40);
    }

    // Below-the-fold content is revealed and reachable.
    await expect(
      page.locator("section#features").getByRole("heading", { name: "Everything serious research needs" }),
    ).toBeVisible();
    expect(filterAllowedErrors(errors)).toEqual([]);
  });

  test("respects prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = collectPageErrors(page);
    await page.goto("/landing");
    await expect(page.locator("section#demo")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(filterAllowedErrors(errors)).toEqual([]);
  });

  test.describe("without JavaScript (progressive enhancement)", () => {
    test.use({ javaScriptEnabled: false });

    test("all content is present and visible with no scripts", async ({ page }) => {
      await page.goto("/landing");
      // Nothing is trapped at opacity:0 — the reveal primitive is no-JS-safe.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page.locator("section#features").getByRole("heading", { name: "Comprehensive company profiles" }),
      ).toBeVisible();
      await expect(page.locator("section#demo").getByPlaceholder("Research any ticker…")).toBeVisible();
    });
  });
});

test.describe("landing performance & SEO (Milestone 6)", () => {
  test("exposes landing-specific title and social meta", async ({ page }) => {
    await page.goto("/landing");
    await expect(page).toHaveTitle("Universal Asset Analyzer — The AI Terminal for Investors");
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute("content", /local AI/);
    await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute("content", /Universal Asset Analyzer/);
  });

  test("has a clean heading hierarchy (one h1, section h2s, feature h3s)", async ({ page }) => {
    await page.goto("/landing");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    // Hero owns the single h1; the other 9 IA sections each contribute one h2.
    expect(await page.getByRole("heading", { level: 2 }).count()).toBe(9);
    // Exactly the five feature stories contribute h3s — no heading-level skips.
    expect(await page.getByRole("heading", { level: 3 }).count()).toBe(5);
  });

  test("controls are keyboard reachable and named", async ({ page }) => {
    await page.goto("/landing");
    // Tab from the top lands on a real interactive control (skip-link / nav).
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["A", "BUTTON", "INPUT"]).toContain(tag);

    // Primary and footer navigation are distinct, named landmarks.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeAttached();
    await expect(page.getByRole("navigation", { name: "Footer" })).toBeAttached();
  });
});

test.describe("landing content finalization (Milestone 7)", () => {
  test("privacy, pricing, comparison and final CTA carry approved copy", async ({ page }) => {
    await page.goto("/landing");

    await expect(
      page.locator("section#privacy").getByRole("heading", { name: "100% Local. 100% Private." }),
    ).toBeVisible();

    const pricing = page.locator("section#pricing");
    await expect(pricing.getByRole("heading", { name: /Get started in minutes/ })).toBeVisible();
    await expect(pricing.getByText("$0")).toBeVisible();

    // Comparison table has real table semantics and a highlighted UAA column.
    const comparison = page.locator("section#comparison");
    await expect(comparison.getByRole("columnheader", { name: "UAA" })).toBeVisible();
    await expect(comparison.getByRole("rowheader", { name: "Runs 100% locally" })).toBeVisible();

    await expect(
      page.locator("section#cta").getByRole("heading", { name: /Professional investing doesn.t require ten tools/ }),
    ).toBeVisible();
  });

  test("FAQ accordions expand and reflect what actually ships", async ({ page }) => {
    await page.goto("/landing");
    const faq = page.locator("section#faq");

    const answer = faq.getByText(/Local models via Ollama/);
    await expect(answer).toBeHidden(); // closed <details> by default
    await faq.getByText("What AI does it use?").click();
    await expect(answer).toBeVisible();
  });

  test("no placeholder text and no unshipped-capability claims remain", async ({ page }) => {
    await page.goto("/landing");
    // Every IA section now has a real component — the skeleton marker is gone.
    await expect(page.getByText("Section placeholder")).toHaveCount(0);
    // Copy was corrected to the local-Ollama reality (reconciliation §A3).
    await expect(page.getByText(/OpenAI/)).toHaveCount(0);
  });
});
