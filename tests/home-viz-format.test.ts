/**
 * Home-dashboard _viz formatters — currency-awareness regression guards.
 *
 * fmtMoney/fmtSignedMoney used to glue a hardcoded "$" onto portfolio-derived
 * values, which mislabels an INR book's P&L by the FX rate. They now delegate
 * to lib/format's formatCompactCurrency with a caller-threaded currency
 * (default USD, so existing US surfaces render identically).
 */
import { describe, expect, it } from "vitest";
import { fmtMoney, fmtSignedMoney } from "@/app/_home/_viz/format";

describe("fmtMoney", () => {
  it("keeps the historical USD rendering by default", () => {
    expect(fmtMoney(455_300)).toBe("$455.30K");
    expect(fmtMoney(455_300, "USD")).toBe("$455.30K");
  });
  it("renders INR values in ₹ with Indian units, never a blanket dollar", () => {
    expect(fmtMoney(455_300, "INR")).toBe("₹4.55 L");
    expect(fmtMoney(25_000_000, "INR")).toBe("₹2.5 Cr");
    expect(fmtMoney(455_300, "INR")).not.toContain("$");
  });
  it("handles null", () => {
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(undefined, "INR")).toBe("—");
  });
});

describe("fmtSignedMoney", () => {
  it("keeps the historical USD rendering by default (true minus sign)", () => {
    expect(fmtSignedMoney(2_300)).toBe("+$2.30K");
    expect(fmtSignedMoney(-1_500)).toBe("−$1.50K");
    expect(fmtSignedMoney(0)).toBe("$0");
  });
  it("renders the sign in front of the threaded currency's own symbol", () => {
    expect(fmtSignedMoney(125_000, "INR")).toBe("+₹1.25 L");
    expect(fmtSignedMoney(-125_000, "INR")).toBe("−₹1.25 L");
    expect(fmtSignedMoney(2_300, "JPY")).toBe("+¥2.30K");
  });
  it("handles null", () => {
    expect(fmtSignedMoney(null)).toBe("—");
  });
});
