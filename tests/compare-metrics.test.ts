import { describe, expect, it } from "vitest";
import { metricApplicability, resolveRowHighlights, zeroAsMissing } from "@/lib/compare/metrics";
import { detectUnexplainedGaps, totalReturnClose } from "@/lib/prices";
import { formatPercent, ordinal } from "@/lib/format";

const xRatio = (v: number) => `${v.toFixed(1)}x`;
const int = (v: number) => Math.round(v).toString();

describe("resolveRowHighlights", () => {
  it("all distinct: single best and single worst (higher is better)", () => {
    const r = resolveRowHighlights([10, 30, 20], "higher_is_better", int);
    expect(r).toEqual({ best: [1], worst: [0] });
  });

  it("all distinct: direction flips for lower_is_better", () => {
    const r = resolveRowHighlights([10, 30, 20], "lower_is_better", int);
    expect(r).toEqual({ best: [0], worst: [1] });
  });

  it("two-way tie at max: BOTH tied cells get best, not neither", () => {
    const r = resolveRowHighlights([100, 100, 60, 80], "higher_is_better", int);
    expect(r!.best.sort()).toEqual([0, 1]);
    expect(r!.worst).toEqual([2]);
  });

  it("two-way tie at min: BOTH tied cells get worst", () => {
    const r = resolveRowHighlights([0.6, 0.6, 0.9, 1.3], "lower_is_better", xRatio);
    expect(r!.best.sort()).toEqual([0, 1]);
    expect(r!.worst).toEqual([3]);
  });

  it("ties are judged at display precision: 0.59x and 0.62x both render 0.6x and are both best", () => {
    const r = resolveRowHighlights([0.93, 0.59, 0.62, 1.28, 1.44], "lower_is_better", xRatio);
    expect(r!.best.sort()).toEqual([1, 2]);
    expect(r!.worst).toEqual([4]);
  });

  it("a clear non-tie max is never suppressed (80 vs 78 vs 59)", () => {
    const r = resolveRowHighlights([78, 80, 59], "higher_is_better", int);
    expect(r).toEqual({ best: [1], worst: [2] });
  });

  it("all identical: row is skipped", () => {
    expect(resolveRowHighlights([100, 100, 100, 100], "higher_is_better", int)).toBeNull();
  });

  it("single non-null value: no highlight", () => {
    expect(resolveRowHighlights([null, 42, null], "higher_is_better", int)).toBeNull();
  });

  it("all null: no highlight", () => {
    expect(resolveRowHighlights([null, null, null], "higher_is_better", int)).toBeNull();
  });

  it("neutral metric: no highlight regardless of spread", () => {
    expect(resolveRowHighlights([5, 40, 12], "neutral", int)).toBeNull();
  });

  it("null cells are never eligible even when they'd be the extreme", () => {
    const r = resolveRowHighlights([null, 10, 20], "lower_is_better", int);
    expect(r).toEqual({ best: [1], worst: [2] });
  });
});

describe("ordinal", () => {
  it("handles 1 through 120 correctly", () => {
    const expected: Record<number, string> = {
      1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 10: "10th",
      11: "11th", 12: "12th", 13: "13th", 14: "14th",
      21: "21st", 22: "22nd", 23: "23rd", 24: "24th",
      31: "31st", 42: "42nd", 53: "53rd", 100: "100th",
      101: "101st", 102: "102nd", 103: "103rd",
      111: "111th", 112: "112th", 113: "113th", 120: "120th",
    };
    for (let n = 1; n <= 120; n++) {
      const suffix = ordinal(n).slice(String(n).length);
      const mod100 = n % 100;
      const want =
        mod100 >= 11 && mod100 <= 13 ? "th"
        : n % 10 === 1 ? "st"
        : n % 10 === 2 ? "nd"
        : n % 10 === 3 ? "rd"
        : "th";
      expect(`${n}${suffix}`).toBe(`${n}${want}`);
    }
    for (const [n, want] of Object.entries(expected)) {
      expect(ordinal(Number(n))).toBe(want);
    }
  });
});

describe("signed zero normalization", () => {
  it("a tiny negative that rounds to zero renders 0, not -0", () => {
    expect(formatPercent(-0.004, 2)).toBe("0.00%");
    expect(formatPercent(-0.04, 1)).toBe("0.0%");
  });

  it("genuinely negative values keep their sign", () => {
    expect(formatPercent(-0.06, 1)).toBe("-0.1%");
  });

  it("positive values keep the + prefix", () => {
    expect(formatPercent(0.06, 1)).toBe("+0.1%");
  });
});

describe("metricApplicability", () => {
  const NOT_FOR_BANKS = ["grossMargin", "ebitdaMargin", "netDebtToEbitda", "currentRatio", "quickRatio", "fcfYield", "fcfCagr3y"];

  it("marks margin/liquidity/FCF metrics not applicable for Financial Services", () => {
    for (const id of NOT_FOR_BANKS) {
      const a = metricApplicability(id, "Financial Services");
      expect(a.applicable, id).toBe(false);
      if (!a.applicable) expect(a.reason.length).toBeGreaterThan(10);
    }
  });

  it("keeps meaningful bank metrics applicable", () => {
    for (const id of ["roe", "roa", "netProfitMargin", "debtToEquity", "forwardPE", "dividendYield"]) {
      expect(metricApplicability(id, "Financial Services").applicable, id).toBe(true);
    }
  });

  it("everything applies for a non-financial sector", () => {
    for (const id of NOT_FOR_BANKS) {
      expect(metricApplicability(id, "Technology").applicable, id).toBe(true);
    }
  });

  it("unknown/missing sector defaults to applicable", () => {
    expect(metricApplicability("grossMargin", null).applicable).toBe(true);
  });
});

describe("zeroAsMissing", () => {
  it("treats provider zero as missing", () => {
    expect(zeroAsMissing(0)).toBeNull();
    expect(zeroAsMissing(null)).toBeNull();
    expect(zeroAsMissing(undefined)).toBeNull();
  });

  it("passes real values through", () => {
    expect(zeroAsMissing(0.41)).toBe(0.41);
    expect(zeroAsMissing(-0.05)).toBe(-0.05);
  });
});

describe("prices: totalReturnClose + detectUnexplainedGaps", () => {
  it("prefers adjClose, falls back to close", () => {
    expect(totalReturnClose({ date: "2025-01-01", close: 100, adjClose: 98 })).toBe(98);
    expect(totalReturnClose({ date: "2025-01-01", close: 100 })).toBe(100);
  });

  it("flags a single-day gap above the threshold on the adjusted series", () => {
    const history = [
      { date: "2025-01-01", close: 100, adjClose: 100 },
      { date: "2025-01-02", close: 101, adjClose: 101 },
      { date: "2025-01-03", close: 50, adjClose: 50 }, // -50.5% — unadjusted split signature
      { date: "2025-01-04", close: 51, adjClose: 51 },
    ];
    const gaps = detectUnexplainedGaps(history, 25);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].date).toBe("2025-01-03");
    expect(gaps[0].changePct).toBeLessThan(-25);
  });

  it("a provider-adjusted split leaves no gap", () => {
    const history = [
      { date: "2025-01-01", close: 200, adjClose: 100 },
      { date: "2025-01-02", close: 202, adjClose: 101 },
      { date: "2025-01-03", close: 101, adjClose: 100.5 }, // 2:1 split, adjusted series smooth
    ];
    expect(detectUnexplainedGaps(history, 25)).toHaveLength(0);
  });
});
