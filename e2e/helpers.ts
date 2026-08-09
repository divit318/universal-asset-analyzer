import { expect, type Page } from "@playwright/test";

/**
 * Console/page-error noise that's an expected part of running fully offline
 * (no AI key, and sometimes no network for live Yahoo quotes). Every entry
 * here is a documented degrade path — see lib/ai/ARCHITECTURE.md. Anything
 * NOT matched here fails the test; that includes hydration mismatches and
 * React render crashes, which is the point of this tripwire.
 */
export const ALLOWED_CONSOLE_PATTERNS: RegExp[] = [
  /ECONNREFUSED/,
  /Failed to fetch/i,
  // Chrome's generic network-error text for a failed fetch/XHR (offline Yahoo, unreachable AI).
  /net::ERR_/,
];

/** Attach console/pageerror listeners before navigating so nothing is missed. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

export function filterAllowedErrors(errors: string[]): string[] {
  return errors.filter((e) => !ALLOWED_CONSOLE_PATTERNS.some((p) => p.test(e)));
}

/**
 * Shared smoke assertion: the app shell (header nav) and the page's own
 * top-level heading rendered. Deliberately avoids `networkidle` — the
 * notification bell's 90s poll and long-running pipelines (scanner, IC
 * report, thematic) mean the network never truly goes idle.
 */
export async function expectShellRendered(page: Page): Promise<void> {
  // Scoped to the landmark role, not the `header` tag — several pages
  // (e.g. /ic-report) have their own in-content <header>, which would
  // otherwise make this locator ambiguous (strict-mode violation).
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
}
