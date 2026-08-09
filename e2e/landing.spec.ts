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

    // The pill header's auth pair (login rework) and the anchor nav are present.
    await expect(page.locator("header").getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("header").getByRole("button", { name: "Get started" })).toBeVisible();
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
  test("shows the approved headline, subhead, CTAs and hero art", async ({ page }) => {
    await page.goto("/landing");

    // Exact shipped headline copy (auth session's hero rewrite — two stacked
    // spans render with no space between them in textContent).
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Every figure computed.Every claim traced.",
    );

    // Subhead names what actually ships: deterministic engines + owned data.
    await expect(
      page.getByText("deterministic engines compute every metric", { exact: false }),
    ).toBeVisible();

    // CTA hierarchy: primary opens the auth modal, secondary jumps to the demo.
    const hero = page.locator("section#hero");
    await expect(hero.getByRole("button", { name: /Get started/ })).toBeVisible();
    await expect(hero.locator('a[href="#demo"]')).toBeVisible();

    // The particle thesis wave renders with its waypoints.
    await expect(hero.getByText("Ingest", { exact: true })).toBeVisible();
    await expect(hero.getByText("Trace", { exact: true })).toBeVisible();
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
    await expect(solution.getByText("Market data", { exact: true })).toBeVisible();
  });

  test("demo runs a canned analysis with no network", async ({ page }) => {
    await page.goto("/landing");
    const demo = page.locator("section#demo");

    const input = demo.getByPlaceholder("Search any ticker…");
    await expect(input).toBeVisible();
    const analyze = demo.getByRole("button", { name: "Analyze" });
    await expect(analyze).toBeVisible();

    // No result before submitting.
    await expect(demo.getByText("Sample output, not live data")).toHaveCount(0);

    await input.fill("NVDA");
    await analyze.click();

    // Canned result (after the skeleton beat) + honest disclaimer appear.
    await expect(demo.getByText("NVIDIA Corp.")).toBeVisible();
    await expect(demo.getByText("Composite", { exact: false })).toBeVisible();
    await expect(demo.getByText("Sample output, not live data")).toBeVisible();
  });
});

test.describe("landing feature showcase (Milestone 4)", () => {
  test("renders every feature story with an accessible preview placeholder", async ({ page }) => {
    await page.goto("/landing");
    const features = page.locator("section#features");

    await expect(features.getByRole("heading", { name: "Comprehensive company profiles" })).toBeVisible();
    await expect(features.getByRole("heading", { name: "Build any screener" })).toBeVisible();
    await expect(features.getByText("Research Hub").first()).toBeVisible();

    // Five feature rows → five illustrative mockups, each an accessible image.
    await expect(features.getByRole("img", { name: /Illustrative/ })).toHaveCount(5);
    await expect(
      features.getByRole("img", { name: /Illustrative Research Hub screen/ }),
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
      await expect(page.locator("section#demo").getByPlaceholder("Search any ticker…")).toBeVisible();
    });
  });
});

test.describe("landing performance & SEO (Milestone 6)", () => {
  test("exposes landing-specific title and social meta", async ({ page }) => {
    await page.goto("/landing");
    await expect(page).toHaveTitle("Universal Asset Analyzer: The AI Terminal for Investors");
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute("content", /local database you own/);
    await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute("content", /Universal Asset Analyzer/);
  });

  test("has a clean heading hierarchy (one h1, section h2s, feature h3s)", async ({ page }) => {
    await page.goto("/landing");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    // Hero owns the single h1; the other 9 IA sections each contribute one h2.
    expect(await page.getByRole("heading", { level: 2 }).count()).toBe(9);
    // Problem cards, capability rows, and FAQ questions contribute h3s.
    expect(await page.getByRole("heading", { level: 3 }).count()).toBe(15);
  });

  test("controls are keyboard reachable and named", async ({ page }) => {
    await page.goto("/landing");
    // Tab from the top lands on a real interactive control (skip-link / nav).
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["A", "BUTTON", "INPUT"]).toContain(tag);

    // Primary and footer navigation are distinct, named landmarks.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeAttached();
    await expect(page.getByRole("navigation", { name: "Footer", exact: true })).toBeAttached();
  });
});

test.describe("landing content finalization (Milestone 7)", () => {
  test("privacy, pricing, comparison and final CTA carry approved copy", async ({ page }) => {
    await page.goto("/landing");

    await expect(
      page.locator("section#privacy").getByRole("heading", { name: "Local-first. Your data stays yours." }),
    ).toBeVisible();

    const pricing = page.locator("section#pricing");
    await expect(pricing.getByRole("heading", { name: /Free to run\. Pro when you want us to run it\./ })).toBeVisible();
    await expect(pricing.getByText("$0")).toBeVisible();

    // Comparison table has real table semantics and a highlighted UAA column.
    const comparison = page.locator("section#comparison");
    await expect(comparison.getByRole("columnheader", { name: "UAA" })).toBeVisible();
    await expect(
      comparison.getByRole("rowheader", { name: "Local-first: your data on your device" }),
    ).toBeVisible();

    await expect(
      page.locator("section#cta").getByRole("heading", { name: /Professional investing doesn.t require ten tools/ }),
    ).toBeVisible();
  });

  test("FAQ accordions expand and reflect what actually ships", async ({ page }) => {
    await page.goto("/landing");
    const faq = page.locator("section#faq");

    // First row open by default; the rest closed, one-open-at-a-time.
    const firstButton = faq.getByRole("button", { name: "Do I need an account?" });
    await expect(firstButton).toHaveAttribute("aria-expanded", "true");

    const aiButton = faq.getByRole("button", { name: "What AI does it use?" });
    const answer = faq.getByText(/Claude \(Anthropic\) via your own API key/);
    await expect(aiButton).toHaveAttribute("aria-expanded", "false");
    await expect(answer).not.toBeInViewport();
    await aiButton.click();
    await expect(aiButton).toHaveAttribute("aria-expanded", "true");
    await expect(firstButton).toHaveAttribute("aria-expanded", "false");
    await expect(answer).toBeVisible();
  });

  test("no placeholder text and no unshipped-capability claims remain", async ({ page }) => {
    await page.goto("/landing");
    // Every IA section now has a real component — the skeleton marker is gone.
    await expect(page.getByText("Section placeholder")).toHaveCount(0);
    // Banned hosted-SaaS claims (design-rebuild brief) never render.
    const html = await page.content();
    for (const banned of [
      /institutional.grade/i,
      /always encrypted/i,
      /encrypted and secure/i,
      /end-to-end encrypted/i,
      /real-?time infrastructure/i,
      /instant results/i,
      /bank-level security/i,
      /enterprise grade/i,
      /trusted by investors/i,
      /professional.grade research/i,
      /all rights reserved/i,
    ]) {
      expect(html, `banned claim rendered: ${banned}`).not.toMatch(banned);
    }
  });

  test("F-01 guard: every retired false-locality claim stays retired", async ({ page }) => {
    // Each of these phrases shipped once (pre-demo audit F-01/F-03, plus the
    // post-auth sweep) while being false: the first block claimed zero egress
    // while the app verifiably sent prompts to a hosted model; the second
    // block claimed "no accounts / no sign-up" after local auth shipped.
    // Replaced with claims that are true — "local-first data, hosted AI on
    // your own key, optional local account" — and none may regress on any
    // landing surface.
    await page.goto("/landing");
    const html = await page.content();
    const RETIRED: RegExp[] = [
      /never leaves your computer/i,
      /never leaves the device/i,
      /never leaves this machine/i,
      /never uploads your data/i,
      /Runs 100% on your computer/i,
      /Runs 100% locally/i,
      /100% Local\. 100% Private\./i,
      /runs entirely on your machine/i,
      /running entirely on your computer/i,
      /all running locally/i,
      /running entirely on your own machine/i,
      /powered by local AI/i,
      /\ball on your computer\b/i,
      /no cloud/i,
      /no API keys? (required|to leak)/i,
      /no cloud keys, no metering/i,
      /local models? via Ollama/i,
      /\bOllama\b/,
      /\blocal AI analysis\b/i,
      /offline AI/i,
      /zero egress/i,
      // Auth shipped (login workstream): account-denial claims are now false.
      /no sign-?up/i,
      /no login/i,
      /\bno accounts\b/i,
      /no account required/i,
      // Pricing rebuild: the open-ended lifetime claim is retired for good.
      /\/ forever/,
    ];
    for (const re of RETIRED) {
      expect(html, `retired claim resurfaced: ${re}`).not.toMatch(re);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Pricing — two tiers, one of which exists (migration workstream, Part 2)     */
/* -------------------------------------------------------------------------- */

test.describe("pricing: two tiers, one of which exists", () => {
  test("both cards render: Free available, Pro unmistakably not yet available", async ({ page }) => {
    await page.goto("/landing");
    const pricing = page.locator("section#pricing");

    const free = pricing.getByTestId("pricing-free");
    await expect(free).toBeVisible();
    await expect(free.getByText("Available now")).toBeVisible();
    await expect(free.getByText("$0")).toBeVisible();
    await expect(free.getByText("The full local product. Nothing held back.")).toBeVisible();

    const pro = pricing.getByTestId("pricing-pro");
    await expect(pro).toBeVisible();
    await expect(pro.getByText("Planned, not yet available")).toBeVisible();
    await expect(pro.getByText("Nothing is purchasable today", { exact: false })).toBeVisible();
    // Planned features are marked planned, per item.
    await expect(pro.getByText("(planned)").first()).toBeVisible();

    // The BYOK cost line is present and names the model + published rate.
    await expect(pricing.getByText(/Claude Opus 5's published rate/)).toBeVisible();
    await expect(pricing.getByText(/\$5 per million input/)).toBeVisible();
  });

  test("no purchase affordance exists anywhere in the pricing section", async ({ page }) => {
    await page.goto("/landing");
    const pricing = page.locator("section#pricing");
    const PURCHASE = /buy|upgrade|subscribe|checkout|purchase|pay now/i;
    await expect(pricing.getByRole("button", { name: PURCHASE })).toHaveCount(0);
    await expect(pricing.getByRole("link", { name: PURCHASE })).toHaveCount(0);
    // And no form field asks for payment details.
    await expect(pricing.locator('input[autocomplete*="cc-"]')).toHaveCount(0);
  });

  test('"/ forever" appears nowhere on the landing page', async ({ page }) => {
    await page.goto("/landing");
    expect(await page.content()).not.toMatch(/\/ forever/);
  });

  test("free CTA opens the auth modal on Create account", async ({ page }) => {
    await page.goto("/landing");
    await page.locator("section#pricing").getByRole("button", { name: "Get started" }).click();
    const dialog = page.getByRole("dialog", { name: "Create account" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("currency toggle switches both cards and persists across reload", async ({ page }) => {
    await page.goto("/landing");
    const pricing = page.locator("section#pricing");

    // Default in this (non-IN locale) environment: USD on both cards.
    await expect(pricing.getByTestId("pricing-free").getByText("$0")).toBeVisible();
    await expect(pricing.getByTestId("pricing-pro").getByText("$180", { exact: true })).toBeVisible();

    await pricing.getByRole("button", { name: "₹ INR" }).click();
    await expect(pricing.getByTestId("pricing-free").getByText("₹0")).toBeVisible();
    await expect(pricing.getByTestId("pricing-pro").getByText("₹4,999", { exact: true })).toBeVisible();
    await expect(pricing.getByTestId("pricing-pro").getByText("/ year")).toBeVisible();

    // Persisted the same way the theme toggle is (localStorage).
    await page.reload();
    await expect(pricing.getByTestId("pricing-pro").getByText("₹4,999", { exact: true })).toBeVisible();
    await expect(pricing.getByRole("button", { name: "₹ INR" })).toHaveAttribute("aria-pressed", "true");
  });

  test("interest form: empty and malformed submits error accessibly; valid submit persists", async ({ page }) => {
    await page.goto("/landing");
    const pro = page.getByTestId("pricing-pro");
    const email = pro.getByLabel("Email me when Pro exists");
    const submit = pro.getByRole("button", { name: "Notify me" });

    // Empty submit: error rendered in the aria-live region the input points at.
    await submit.click();
    await expect(pro.locator("#pricing-interest-error")).toHaveText("Enter an email address.");
    await expect(email).toHaveAttribute("aria-describedby", "pricing-interest-error");
    await expect(email).toHaveAttribute("aria-invalid", "true");

    // Malformed email.
    await email.fill("not-an-email");
    await submit.click();
    await expect(pro.locator("#pricing-interest-error")).toHaveText(/doesn't look like an email/);

    // Valid submit reaches the API (which persists into the isolated e2e
    // SQLite — row-level persistence is pinned by tests/pricing-interest.test.ts)
    // and swaps the form for the aria-live success state.
    await email.fill("wtp-probe@example.com");
    await pro.getByRole("radio", { name: /Annual/ }).check();
    const done = page.waitForResponse((r) => r.url().includes("/api/pricing-interest") && r.ok());
    await submit.click();
    await done;
    await expect(pro.getByText("on the list", { exact: false })).toBeVisible();
    await expect(pro.getByRole("button", { name: "Notify me" })).toHaveCount(0);
  });

  test("responsive: no horizontal overflow at 375/768/1440; cards stack narrow, sit side-by-side wide", async ({ page }) => {
    // Reveal's fade-rise animates transforms mid-measurement; the section
    // honors prefers-reduced-motion, so ask for it and measure a still page.
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/landing#pricing");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(250);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);

      const free = await page.getByTestId("pricing-free").boundingBox();
      const pro = await page.getByTestId("pricing-pro").boundingBox();
      expect(free && pro).toBeTruthy();
      if (width === 375) {
        // Stacked ⇒ Pro starts well past Free's vertical midpoint (robust to
        // sub-pixel rounding); side-by-side would put both tops equal.
        expect(pro!.y, "cards should stack at 375px").toBeGreaterThan(free!.y + free!.height / 2);
      } else if (width === 1440) {
        expect(Math.abs(pro!.y - free!.y), "cards should sit side-by-side at 1440px").toBeLessThan(4);
      }
    }
  });
});
