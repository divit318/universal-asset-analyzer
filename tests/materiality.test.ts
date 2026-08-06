import { describe, expect, it } from "vitest";
import {
  isMaterial,
  materialCount,
  type MaterialityContext,
  type MaterialityItem,
} from "@/lib/materiality";

const NOW = Date.parse("2026-08-02T12:00:00Z");
const ctx = (overrides: Partial<MaterialityContext> = {}): MaterialityContext => ({ now: NOW, ...overrides });

describe("dimension items", () => {
  const dim = (percentile: number | null, peerGroupSize = 40): MaterialityItem => ({
    kind: "dimension",
    label: "FCF yield",
    percentile,
    peerGroup: "Financials",
    peerGroupSize,
  });

  it("flags a bottom-decile dimension", () => {
    const v = isMaterial(dim(4), ctx());
    expect(v).toMatchObject({ material: true, applicable: true });
    expect(v.reason).toContain("bottom");
    expect(v.reason).toContain("Financials");
  });

  it("flags a top-decile dimension", () => {
    const v = isMaterial(dim(96), ctx());
    expect(v.material).toBe(true);
    expect(v.reason).toContain("top");
  });

  it("does not flag mid-range dispersion", () => {
    const v = isMaterial(dim(55), ctx());
    expect(v).toMatchObject({ material: false, applicable: true });
    expect(v.reason).toContain("normal range");
  });

  it("band edges are inclusive", () => {
    expect(isMaterial(dim(10), ctx()).material).toBe(true);
    expect(isMaterial(dim(90), ctx()).material).toBe(true);
    expect(isMaterial(dim(10.1), ctx()).material).toBe(false);
    expect(isMaterial(dim(89.9), ctx()).material).toBe(false);
  });

  it("a null metric is NOT APPLICABLE, never faded as boring", () => {
    const v = isMaterial(dim(null), ctx());
    expect(v).toMatchObject({ material: false, applicable: false });
    expect(v.reason).toContain("not applicable");
  });

  it("refuses percentile claims off a tiny peer group", () => {
    const v = isMaterial(dim(2, 3), ctx());
    expect(v).toMatchObject({ material: false, applicable: false });
    expect(v.reason).toContain("too few");
  });

  it("respects a custom band from context, not hardcoded cutoffs", () => {
    const wide = ctx({ dimensionBand: { low: 25, high: 75 } });
    expect(isMaterial(dim(20), wide).material).toBe(true);
    expect(isMaterial(dim(20), ctx()).material).toBe(false);
  });
});

describe("risk items", () => {
  it("flags only high-severity risks", () => {
    const high: MaterialityItem = { kind: "risk", category: "Leverage", level: "high", detail: "D/E above 3x" };
    const med: MaterialityItem = { kind: "risk", category: "Valuation", level: "medium" };
    const low: MaterialityItem = { kind: "risk", category: "Liquidity", level: "low" };
    expect(isMaterial(high, ctx())).toMatchObject({ material: true, applicable: true });
    expect(isMaterial(high, ctx()).reason).toContain("Leverage");
    expect(isMaterial(med, ctx()).material).toBe(false);
    expect(isMaterial(low, ctx()).material).toBe(false);
  });
});

describe("freshness items", () => {
  const fresh = (asOf: number | string | null, ttlHours = 24): MaterialityItem => ({
    kind: "freshness",
    label: "Fundamentals",
    asOf,
    ttlHours,
  });

  it("flags data past its TTL", () => {
    const v = isMaterial(fresh(NOW - 30 * 3_600_000), ctx());
    expect(v.material).toBe(true);
    expect(v.reason).toContain("stale");
  });

  it("does not flag data within its TTL", () => {
    expect(isMaterial(fresh(NOW - 2 * 3_600_000), ctx()).material).toBe(false);
  });

  it("accepts ISO string as-of values", () => {
    expect(isMaterial(fresh("2026-07-25T00:00:00Z"), ctx()).material).toBe(true);
  });

  it("an unknown as-of is not applicable rather than stale", () => {
    expect(isMaterial(fresh(null), ctx())).toMatchObject({ material: false, applicable: false });
    expect(isMaterial(fresh("garbage"), ctx()).applicable).toBe(false);
  });
});

describe("change items", () => {
  const change = (at: string): MaterialityItem => ({ kind: "change", label: "Q2 earnings beat", at });

  it("flags events after the prior visit", () => {
    const v = isMaterial(change("2026-08-01T09:00:00Z"), ctx({ priorVisitAt: "2026-07-28T00:00:00Z" }));
    expect(v.material).toBe(true);
    expect(v.reason).toContain("since your last visit");
  });

  it("does not flag events already seen", () => {
    const v = isMaterial(change("2026-07-20T09:00:00Z"), ctx({ priorVisitAt: "2026-07-28T00:00:00Z" }));
    expect(v.material).toBe(false);
    expect(v.applicable).toBe(true);
  });

  it("first visit skips the check instead of flagging everything", () => {
    expect(isMaterial(change("2026-08-01T09:00:00Z"), ctx({ priorVisitAt: null }))).toMatchObject({
      material: false,
      applicable: false,
    });
    expect(isMaterial(change("2026-08-01T09:00:00Z"), ctx()).applicable).toBe(false);
  });
});

describe("concentration items", () => {
  it("a finding is material by existence — the engine only emits breaches", () => {
    const v = isMaterial(
      { kind: "concentration", label: "NVDA", pct: 18.4, severity: "high", message: "NVDA is 18.4% of the portfolio" },
      ctx(),
    );
    expect(v.material).toBe(true);
    expect(v.reason).toContain("High concentration");
  });
});

describe("tier crossing items", () => {
  const crossing = (currentScore: number | null, symbol = "NVDA"): MaterialityItem => ({
    kind: "tierCrossing",
    symbol,
    currentScore,
  });

  it("flags a score that crossed a TIER_EDGES boundary since last visit", () => {
    // 59 → 61 crosses the HOLD/BUY edge at 60.
    const v = isMaterial(crossing(61), ctx({ priorScores: { NVDA: 59 } }));
    expect(v.material).toBe(true);
    expect(v.reason).toContain("Hold");
    expect(v.reason).toContain("Buy");
  });

  it("does not flag movement within a tier", () => {
    expect(isMaterial(crossing(75), ctx({ priorScores: { NVDA: 62 } })).material).toBe(false);
  });

  it("no baseline at all → not applicable (first visit)", () => {
    expect(isMaterial(crossing(61), ctx({ priorScores: null }))).toMatchObject({ material: false, applicable: false });
    expect(isMaterial(crossing(61), ctx()).applicable).toBe(false);
  });

  it("a symbol missing from the baseline → not applicable", () => {
    expect(isMaterial(crossing(61, "TSM"), ctx({ priorScores: { NVDA: 59 } })).applicable).toBe(false);
  });

  it("a null current score (unscoreable class) → not applicable, never flagged", () => {
    const v = isMaterial(crossing(null), ctx({ priorScores: { NVDA: 59 } }));
    expect(v).toMatchObject({ material: false, applicable: false });
  });
});

describe("materialCount", () => {
  it("counts only material verdicts", () => {
    const verdicts = [
      isMaterial({ kind: "risk", category: "A", level: "high" }, ctx()),
      isMaterial({ kind: "risk", category: "B", level: "low" }, ctx()),
      isMaterial({ kind: "dimension", label: "ROE", percentile: null, peerGroup: null, peerGroupSize: null }, ctx()),
    ];
    expect(materialCount(verdicts)).toBe(1);
  });
});
