/**
 * The Pro-tier interest store: willingness-to-pay rows in the local SQLite.
 * Isolated DB_PATH — never the real data/app.db (which is gitignored; the
 * pricing form must never write anywhere that could be committed).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "uaa-pricing-test-"));
let savedDbPath: string | undefined;

beforeAll(() => {
  savedDbPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(dir, "test.db");
});

afterAll(() => {
  if (savedDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = savedDbPath;
  rmSync(dir, { recursive: true, force: true });
});

describe("pricing interest store", () => {
  it("persists email, price preference, currency and timestamp; email normalized", async () => {
    const { recordPricingInterest, listPricingInterest, resetPricingInterestDbForTests } =
      await import("@/lib/pricing-interest");
    resetPricingInterestDbForTests();

    recordPricingInterest("  WTP-Probe@Example.COM ", "annual", "INR");
    recordPricingInterest("second@example.com", null, "USD");

    const rows = listPricingInterest();
    expect(rows).toHaveLength(2);
    // Newest first.
    expect(rows[0].email).toBe("second@example.com");
    expect(rows[0].pricePreference).toBeNull();
    expect(rows[0].currency).toBe("USD");
    expect(rows[1].email).toBe("wtp-probe@example.com"); // trimmed + lowercased
    expect(rows[1].pricePreference).toBe("annual");
    expect(rows[1].currency).toBe("INR");
    // Timestamps are ISO and recent — this is the willingness-to-pay signal.
    expect(Date.now() - Date.parse(rows[1].createdAt)).toBeLessThan(60_000);
  });

  it("duplicate emails are allowed — a changed preference over time is signal", async () => {
    const { recordPricingInterest, listPricingInterest } = await import("@/lib/pricing-interest");
    recordPricingInterest("wtp-probe@example.com", "neither", "USD");
    const rows = listPricingInterest().filter((r) => r.email === "wtp-probe@example.com");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.pricePreference)).toEqual(["neither", "annual"]);
  });

  it("isPricePreference accepts exactly the three known values", async () => {
    const { isPricePreference } = await import("@/lib/pricing-interest");
    expect(isPricePreference("monthly")).toBe(true);
    expect(isPricePreference("annual")).toBe(true);
    expect(isPricePreference("neither")).toBe(true);
    expect(isPricePreference("lifetime")).toBe(false);
    expect(isPricePreference("")).toBe(false);
    expect(isPricePreference(null)).toBe(false);
  });
});
