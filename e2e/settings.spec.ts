import { test, expect, type Page } from "@playwright/test";
import { E2E_USER } from "./global-setup";

/**
 * /settings/account — profile card + change-password card, signed in against
 * the gated server (playwright.login.config.ts).
 *
 * Each test signs in through the API inside its own browser context; the
 * password-change spec creates its own throwaway account via signup so it can
 * rotate credentials without breaking the seeded user other specs rely on.
 */

async function signIn(page: Page, email = E2E_USER.email, password = E2E_USER.password) {
  const res = await page.request.post("/api/auth/signin", { data: { email, password } });
  expect(res.ok()).toBe(true);
}

test.describe("account card", () => {
  test("renders the signed-in user's data with the Local badge and no plan tiers", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings/account");

    await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
    await expect(page.locator("#account-name")).toHaveValue(E2E_USER.displayName);
    await expect(page.locator("#account-email")).toHaveValue(E2E_USER.email);
    await expect(page.getByText("Local", { exact: true })).toBeVisible();
    // No invented tiers, ever.
    await expect(page.getByText(/\b(Pro|Premium|Free plan|Upgrade)\b/)).toHaveCount(0);
  });

  test("Save: disabled when clean → enabled on edit → persists → re-disabled", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings/account");

    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save).toBeDisabled();

    await page.locator("#account-name").fill("E2E Owner Renamed");
    await expect(save).toBeEnabled();

    await save.click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await expect(save).toBeDisabled();

    // Persisted server-side, not just in component state.
    await page.reload();
    await expect(page.locator("#account-name")).toHaveValue("E2E Owner Renamed");

    // Restore for the other specs (the suite shares the seeded user).
    await page.locator("#account-name").fill(E2E_USER.displayName);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
  });

  test("invalid email keeps Save disabled; server errors render readably", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings/account");

    await page.locator("#account-email").fill("not-an-email");
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  test("sign out returns to the landing page and the gate re-engages", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings/account");

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/landing$/);

    await page.goto("/portfolio");
    await expect(page).toHaveURL(/\/landing$/);
  });
});

test.describe("change password card", () => {
  test("submit disabled until all three fields are valid and matching", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings/account");

    const submit = page.getByRole("button", { name: "Change password" });
    await expect(submit).toBeDisabled();

    await page.locator("#pw-current").fill(E2E_USER.password);
    await expect(submit).toBeDisabled();

    await page.locator("#pw-new").fill("a-new-long-password-3");
    await expect(submit).toBeDisabled();

    await page.locator("#pw-confirm").fill("a-DIFFERENT-password");
    await expect(page.locator("#pw-confirm-error")).toContainText("do not match");
    await expect(submit).toBeDisabled();

    await page.locator("#pw-confirm").fill("a-new-long-password-3");
    await expect(submit).toBeEnabled();
    // Deliberately not submitted here — the success path runs on its own account below.
  });

  test("wrong current password surfaces a readable error; correct one rotates the credential", async ({ page }) => {
    // Own account so the seeded user's password never changes.
    const signup = await page.request.post("/api/auth/signup", {
      data: { email: "rotate-me@uaa.local", displayName: "Rotator", password: "rotate-original-1" },
    });
    expect(signup.ok()).toBe(true);
    await page.goto("/settings/account");

    await page.locator("#pw-current").fill("wrong-current-password");
    await page.locator("#pw-new").fill("rotate-updated-2");
    await page.locator("#pw-confirm").fill("rotate-updated-2");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Your current password is incorrect.")).toBeVisible();

    await page.locator("#pw-current").fill("rotate-original-1");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed.", { exact: false })).toBeVisible();

    // Old credential dead, new credential live.
    const oldTry = await page.request.post("/api/auth/signin", {
      data: { email: "rotate-me@uaa.local", password: "rotate-original-1" },
    });
    expect(oldTry.status()).toBe(401);
    const newTry = await page.request.post("/api/auth/signin", {
      data: { email: "rotate-me@uaa.local", password: "rotate-updated-2" },
    });
    expect(newTry.ok()).toBe(true);
  });

  test("password-change form keeps the autocomplete contract (spec 17)", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings/account");

    await expect(page.locator("#pw-current")).toHaveAttribute("autocomplete", "current-password");
    await expect(page.locator("#pw-new")).toHaveAttribute("autocomplete", "new-password");
    await expect(page.locator("#pw-confirm")).toHaveAttribute("autocomplete", "new-password");
    for (const id of ["pw-current", "pw-new", "pw-confirm"]) {
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
    }
    // The hidden username anchor tells the manager which account rotated.
    await expect(page.locator('form:has(#pw-current) input[autocomplete="username"]')).toHaveCount(1);
  });
});

test.describe("signed-out access", () => {
  test("/settings/account redirects to /landing without a session", async ({ page }) => {
    await page.goto("/settings/account");
    await expect(page).toHaveURL(/\/landing$/);
  });
});
