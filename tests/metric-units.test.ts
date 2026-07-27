import { describe, expect, it } from "vitest";
import { formatMetric } from "@/app/portfolio/_components/universal/holdings-panel";

/**
 * The units contract for the Holdings table.
 *
 * These are regression tests for a shipped display bug: metric units were
 * inferred from magnitude (`Math.abs(value) <= 1 ? value * 100 : value`), which
 * is right for the common case and silently 100x wrong for every ratio above 1.
 * Observed live values that were rendered wrong:
 *
 *   returnOnEquity 1.4147 (AAPL) → "1.41%"  should be 141%
 *   revenueGrowth  1.693  (ORLA) → "1.69%"  should be 169%
 *
 * Magnitude cannot distinguish "0.85 = 85%" from "1.85 = 1.85%", so the fix was
 * to declare the unit per metric. These tests exist so nobody reintroduces the
 * heuristic.
 */

describe("formatMetric — ratio metrics (provider fractions)", () => {
  it("scales sub-1 ratios to percent", () => {
    // JNJ / CVX, the values the old heuristic happened to get right.
    expect(formatMetric("returnOnEquity", 0.25742)).toBe("25.74%");
    expect(formatMetric("returnOnEquity", 0.06638)).toBe("6.64%");
  });

  it("scales ratios ABOVE 1 to percent — the bug this replaced", () => {
    // AAPL's real ROE. The heuristic rendered this as "1.41%".
    expect(formatMetric("returnOnEquity", 1.4147099)).toBe("141%");
    // ORLA's real revenue growth. The heuristic rendered this as "1.69%".
    expect(formatMetric("revenueGrowth", 1.693)).toBe("169%");
  });

  it("has no discontinuity at the old 1.0 boundary", () => {
    // The heuristic's failure mode was a 100x cliff between 0.99 and 1.01.
    expect(formatMetric("returnOnEquity", 0.99)).toBe("99.00%");
    expect(formatMetric("returnOnEquity", 1.01)).toBe("101%");
  });

  it("handles negative ratios", () => {
    expect(formatMetric("revenueGrowth", -0.376)).toBe("-37.60%");
    expect(formatMetric("returnOnEquity", -1.25)).toBe("-125%");
  });

  it("covers every declared ratio metric", () => {
    expect(formatMetric("operatingMargins", 0.656)).toBe("65.60%");
    expect(formatMetric("dividendYield", 0.0432)).toBe("4.32%");
  });
});

describe("formatMetric — percent metrics (already in percent units)", () => {
  it("does not rescale values already in percent", () => {
    // Observed live: GLD volatility 27.2, SHY expenseRatio 0.15.
    expect(formatMetric("volatility", 27.215449)).toBe("27.22%");
    expect(formatMetric("expenseRatio", 0.15)).toBe("0.15%");
    expect(formatMetric("expenseRatio", 0.03)).toBe("0.03%");
  });

  it("treats a small percent as a small percent, not a fraction", () => {
    // The critical asymmetry: 0.15 here means 0.15%, not 15%.
    expect(formatMetric("expenseRatio", 0.15)).not.toBe("15.00%");
  });

  it("keeps user-entered ...Percent metrics untouched", () => {
    expect(formatMetric("capRate", 5.4)).toBe("5.40%");
    expect(formatMetric("cashOnCash", 8.1)).toBe("8.10%");
    expect(formatMetric("annualizedReturn", 12.5)).toBe("12.50%");
    expect(formatMetric("cagr", 22.4)).toBe("22.40%");
    expect(formatMetric("couponRate", 6.25)).toBe("6.25%");
  });

  it("renders yield in percent for both cash and bonds", () => {
    // bond.ts converts the provider fraction to percent at the boundary, so this
    // key carries ONE unit regardless of asset class.
    expect(formatMetric("yield", 4.32)).toBe("4.32%");
  });
});

describe("formatMetric — non-percent units", () => {
  it("formats multiples, years, and counts distinctly", () => {
    expect(formatMetric("peRatio", 40.3172)).toBe("40.3×");
    expect(formatMetric("priceToBook", 45.8705)).toBe("45.9×");
    // 3.05 is not exactly representable, so toFixed(1) floors it — asserting the
    // real behaviour rather than the arithmetically-ideal one.
    expect(formatMetric("duration", 3.05)).toBe("3.0y");
    expect(formatMetric("duration", 4.19)).toBe("4.2y");
    expect(formatMetric("maturity", 9.802)).toBe("9.8y");
    expect(formatMetric("debtToEquity", 0.7955)).toBe("1");
  });

  it("formats currency metrics as currency", () => {
    expect(formatMetric("marketCap", 4891182891008)).toContain("$");
  });
});

describe("formatMetric — missing data", () => {
  it("shows an em-dash rather than 0 or a fabricated midpoint", () => {
    expect(formatMetric("returnOnEquity", null)).toBe("—");
    expect(formatMetric("returnOnEquity", Number.NaN)).toBe("—");
    expect(formatMetric("returnOnEquity", Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("never emits a percent sign for an undeclared metric", () => {
    // A new metric with no declared unit must not be guessed into a percentage.
    expect(formatMetric("someBrandNewMetric", 0.42)).toBe("0.42");
    expect(formatMetric("someBrandNewMetric", 0.42)).not.toContain("%");
  });
});
