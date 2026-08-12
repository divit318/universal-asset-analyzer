import { describe, it, expect } from "vitest";
import { describeResultsSnapshot, type ResultsDaySnapshot } from "@/lib/india-results";
import { formatMetricValue } from "@/lib/screener/format";
import { getMetric } from "@/lib/assets/registry";

const base: ResultsDaySnapshot = {
  symbol: "SBIN", quarterLabel: "Q1 FY27", periodEnded: "Jun 2026",
  reportedAt: "2026-08-10T12:00:00Z", revenueYoY: 5.2, netProfitYoY: 8.0,
  eps: 21.3, financingMarginPercent: null, dayMovePct: 2.1, dayMoveDate: "2026-08-10",
};

describe("describeResultsSnapshot", () => {
  it("composes the one-liner from verified facts only", () => {
    expect(describeResultsSnapshot(base)).toBe(
      "net profit +8% YoY; revenue +5.2% YoY; shares +2.1% on 2026-08-10",
    );
  });

  it("falls back to null when nothing resolved — never guesses", () => {
    expect(
      describeResultsSnapshot({ ...base, revenueYoY: null, netProfitYoY: null, financingMarginPercent: null, dayMovePct: null }),
    ).toBeNull();
  });

  it("includes bank financing margin when published", () => {
    const s = describeResultsSnapshot({ ...base, revenueYoY: null, netProfitYoY: null, dayMovePct: null, financingMarginPercent: 3.2 });
    expect(s).toBe("financing margin 3.2%");
  });
});

describe("pp unit formatting", () => {
  it("signs percentage-point deltas and never confuses them with %", () => {
    const m = getMetric("indiaEquity", "promoterChangeQoQ")!;
    expect(m.unit).toBe("pp");
    expect(formatMetricValue(m, 1.4)).toBe("+1.4pp");
    expect(formatMetricValue(m, -2.13)).toBe("-2.1pp");
    expect(formatMetricValue(m, null)).toBe("—");
  });
});
