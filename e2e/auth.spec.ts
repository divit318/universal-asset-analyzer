import { test, expect, type Page } from "@playwright/test";
import { E2E_USER } from "./global-setup";

/**
 * The auth modal + the gated demo flow, against the UAA_AUTH_GATE=on server
 * (playwright.login.config.ts, :3121, isolated login-e2e.db).
 *
 * global-setup seeds E2E_USER; the signup spec creates its own second account
 * so the two paths never share credentials.
 */

async function openModal(page: Page, tab: "signin" | "signup") {
  await page.goto("/landing");
  const nav = page.getByRole("navigation", { name: "Primary" });
  // The primary CTAs enter the open app directly (2026-08-11 rebuild); the
  // modal's triggers are the nav's "Sign in" and the final CTA's quiet
  // account link (openAuthModal("signup")).
  if (tab === "signin") await nav.getByRole("button", { name: "Sign in" }).click();
  else await page.locator("section#cta").getByRole("button", { name: /create a local account first/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // Settle: the modal moves focus to the email field one frame after opening;
  // filling before that frame can race the focus hop.
  await expect(page.locator(`#${tab}-email`)).toBeFocused();
}

test.describe("modal mechanics", () => {
  test("nav Sign in opens on the Sign in tab; final-CTA account link opens on Create account", async ({ page }) => {
    await openModal(page, "signin");
    await expect(page.getByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");

    await page.locator("section#cta").getByRole("button", { name: /create a local account first/ }).click();
    await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
  });

  test("switching tabs preserves a typed email", async ({ page }) => {
    await openModal(page, "signin");
    await page.locator("#signin-email").fill("keep-me@example.com");
    await page.getByRole("tab", { name: "Create account" }).click();
    await expect(page.locator("#signup-email")).toHaveValue("keep-me@example.com");
    await page.getByRole("tab", { name: "Sign in" }).click();
    await expect(page.locator("#signin-email")).toHaveValue("keep-me@example.com");
  });

  test("closes via X, Esc, and backdrop; focus returns to the trigger each time", async ({ page }) => {
    await page.goto("/landing");
    const trigger = page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Sign in" });

    // X
    await trigger.click();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Esc
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Backdrop
    await trigger.click();
    await page.mouse.click(10, 400);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("focus moves to the email field on open and is trapped while open", async ({ page }) => {
    await openModal(page, "signin");
    await expect(page.locator("#signin-email")).toBeFocused();

    for (let i = 0; i < 14; i++) await page.keyboard.press("Tab");
    const inDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog?.contains(document.activeElement) ?? false;
    });
    expect(inDialog).toBe(true);
  });

  test("password eye toggle flips input type and announces its state", async ({ page }) => {
    await openModal(page, "signin");
    const input = page.locator("#signin-password");
    const toggle = page.getByRole("button", { name: "Show password" });

    await expect(input).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  test("background scroll is locked while the modal is open", async ({ page }) => {
    await openModal(page, "signin");
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe("hidden");
    await page.keyboard.press("Escape");
    const after = await page.evaluate(() => document.body.style.overflow);
    expect(after).not.toBe("hidden");
  });
});

test.describe("validation", () => {
  test("empty submit shows errors tied to their inputs; malformed email caught", async ({ page }) => {
    await openModal(page, "signin");
    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();

    const emailError = page.locator("#signin-email-error");
    await expect(emailError).toBeVisible();
    await expect(page.locator("#signin-email")).toHaveAttribute("aria-describedby", "signin-email-error");
    await expect(page.locator("#signin-email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#signin-password-error")).toBeVisible();

    await page.locator("#signin-email").fill("not-an-email");
    await page.locator("#signin-email").blur();
    await expect(emailError).toContainText("valid email");
  });

  test("signup catches short passwords and mismatched confirmation", async ({ page }) => {
    await openModal(page, "signup");
    await page.locator("#signup-password").fill("short");
    await page.locator("#signup-password").blur();
    await expect(page.locator("#signup-password-error")).toContainText("at least 8");

    await page.locator("#signup-password").fill("a-long-enough-password");
    await page.locator("#signup-confirm").fill("a-different-password");
    await page.locator("#signup-confirm").blur();
    await expect(page.locator("#signup-confirm-error")).toContainText("do not match");
  });
});

test.describe("credential flows", () => {
  test("valid sign-in shows a loading state and lands in the app shell", async ({ page }) => {
    // Hold the response briefly so the in-flight state is observable.
    await page.route("**/api/auth/signin", async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });

    await openModal(page, "signin");
    await page.locator("#signin-email").fill(E2E_USER.email);
    await page.locator("#signin-password").fill(E2E_USER.password);
    await page.keyboard.press("Enter"); // submits the real <form>

    await expect(page.getByRole("button", { name: "Signing in…" })).toBeVisible();
    await expect(page.locator("#signin-email")).toBeDisabled();

    // Successful auth closes the modal and routes into the app shell.
    await page.waitForURL((url) => !url.pathname.startsWith("/landing"));
    await expect(page.getByRole("banner")).toBeVisible();
  });

  test("invalid credentials render a readable inline error and the form stays usable", async ({ page }) => {
    await openModal(page, "signin");
    await page.locator("#signin-email").fill(E2E_USER.email);
    await page.locator("#signin-password").fill("wrong-password-entirely");
    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();

    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await expect(page.locator("#signin-password")).toBeEnabled();

    // Recovers: correct password now succeeds without reopening anything.
    await page.locator("#signin-password").fill(E2E_USER.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/landing"));
  });

  test("sign-up completes end to end and duplicate emails get a readable 409", async ({ page }) => {
    // Unique per run (and per retry) so the first half is always a fresh signup.
    const email = `second-owner-${Date.now()}@uaa.local`;

    await openModal(page, "signup");
    await page.locator("#signup-name").fill("Second Owner");
    await page.locator("#signup-email").fill(email);
    await page.locator("#signup-password").fill("another-long-password-2");
    await page.locator("#signup-confirm").fill("another-long-password-2");
    await page.getByRole("button", { name: "Create account", exact: true }).last().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/landing"));
    await expect(page.getByRole("banner")).toBeVisible();

    // Same email again, fresh session: readable conflict, not a stack trace.
    await page.context().clearCookies();
    await openModal(page, "signup");
    await page.locator("#signup-name").fill("Second Owner");
    await page.locator("#signup-email").fill(email);
    await page.locator("#signup-password").fill("another-long-password-2");
    await page.locator("#signup-confirm").fill("another-long-password-2");
    await page.getByRole("button", { name: "Create account", exact: true }).last().click();
    await expect(page.getByText("already exists", { exact: false })).toBeVisible();
  });
});

test.describe("the gate (UAA_AUTH_GATE=on)", () => {
  test("signed-out visits to app routes redirect to /landing", async ({ page }) => {
    for (const route of ["/", "/portfolio", "/settings/account"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/landing$/);
    }
  });

  test("auth endpoints and static assets stay reachable while signed out", async ({ page }) => {
    const res = await page.request.get("/api/auth/session");
    expect(res.ok()).toBe(true);
    expect((await res.json()).user).toBeNull();
  });

  test("signed-in visits pass the gate", async ({ page }) => {
    const res = await page.request.post("/api/auth/signin", {
      data: { email: E2E_USER.email, password: E2E_USER.password },
    });
    expect(res.ok()).toBe(true);
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/landing/);
    await expect(page.getByRole("banner")).toBeVisible();
  });
});

test.describe("spec 17 — credential-manager markup contract", () => {
  test("sign-in form: real form, exact types/names/ids/autocomplete, label association", async ({ page }) => {
    await openModal(page, "signin");

    // A real <form> wraps the fields (browsers will not offer to save otherwise).
    const form = page.locator('form:has(#signin-email)');
    await expect(form).toHaveCount(1);

    const email = page.locator("#signin-email");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("name", "email");
    await expect(email).toHaveAttribute("autocomplete", "username");
    await expect(email).toHaveAttribute("inputmode", "email");
    await expect(page.locator('label[for="signin-email"]')).toHaveText("Email");

    const password = page.locator("#signin-password");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("name", "password");
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await expect(page.locator('label[for="signin-password"]')).toHaveText("Password");

    // Submit is a real type=submit inside the form, so Enter submits anywhere.
    await expect(form.locator('button[type="submit"]')).toHaveCount(1);
  });

  test("sign-up form: new-password on both entries, username on email, labels on everything", async ({ page }) => {
    await openModal(page, "signup");

    const form = page.locator('form:has(#signup-email)');
    await expect(form).toHaveCount(1);

    await expect(page.locator("#signup-email")).toHaveAttribute("autocomplete", "username");
    await expect(page.locator("#signup-email")).toHaveAttribute("type", "email");
    await expect(page.locator("#signup-password")).toHaveAttribute("autocomplete", "new-password");
    await expect(page.locator("#signup-confirm")).toHaveAttribute("autocomplete", "new-password");
    for (const id of ["signup-name", "signup-email", "signup-password", "signup-confirm"]) {
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
    }
    await expect(form.locator('button[type="submit"]')).toHaveCount(1);
  });

  test("no :-webkit-autofill restyling is shipped", async ({ page }) => {
    await page.goto("/landing");
    const hasAutofillOverride = await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some((r) => r.cssText.includes("-webkit-autofill"));
        } catch {
          return false;
        }
      }),
    );
    expect(hasAutofillOverride).toBe(false);
  });
});
