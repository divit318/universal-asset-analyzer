import { describe, it, expect } from "vitest";
import {
  ownershipContextLine,
  ownershipTrendChips,
  isOwnershipCurrent,
  trendsFromHistory,
  type OwnershipTrends,
} from "@/lib/india-ownership-trends";

const t = (over: Partial<OwnershipTrends>): OwnershipTrends => ({
  promoterStreak: null, fiiStreak: null, diiStreak: null,
  promoterChange4Q: null, fiiChange4Q: null, diiChange4Q: null,
  ...over,
});

describe("ownershipContextLine", () => {
  it("describes FII streaks first and never invents a trend", () => {
    expect(ownershipContextLine(t({ fiiStreak: -3 }))).toBe("FII selling for 3 consecutive quarters");
    expect(ownershipContextLine(t({ fiiStreak: 4 }))).toBe("FII accumulation for 4 consecutive quarters");
    expect(ownershipContextLine(t({}))).toBeNull();
    expect(ownershipContextLine(t({ fiiStreak: 1, diiStreak: 2 }))).toBeNull(); // below every bar
  });

  it("uses percentage points for promoter windows", () => {
    expect(ownershipContextLine(t({ promoterChange4Q: -2.3 }))).toBe(
      "promoter stake -2.3pp over the last 4 disclosed quarters",
    );
  });
});

describe("ownershipTrendChips", () => {
  it("renders compact signed chips, at most two", () => {
    const chips = ownershipTrendChips(t({ fiiStreak: -3, promoterChange4Q: 1.4, diiStreak: 4 }));
    expect(chips).toEqual(["FII ↓3Q", "Prom +1.4pp/4Q"]);
  });
  it("is empty when nothing clears the noise bar", () => {
    expect(ownershipTrendChips(t({ fiiStreak: 1, fiiChange4Q: 0.4 }))).toEqual([]);
  });
});

describe("isOwnershipCurrent", () => {
  it("accepts recent disclosure quarters and rejects stale/absent ones", () => {
    const now = Date.parse("2026-08-11T00:00:00Z");
    expect(isOwnershipCurrent("Jun 2026", now)).toBe(true);
    expect(isOwnershipCurrent("Mar 2026", now)).toBe(true);
    expect(isOwnershipCurrent("Sep 2025", now)).toBe(false);
    expect(isOwnershipCurrent(null, now)).toBe(false);
  });
});

describe("trendsFromHistory (shared with lib/india-ownership)", () => {
  it("matches the Phase-7 streak semantics", () => {
    const hist = [
      { period: "Sep 2025", promoter: 50, fii: 16.0, dii: 20 },
      { period: "Dec 2025", promoter: 50, fii: 15.5, dii: 20 },
      { period: "Mar 2026", promoter: 50, fii: 16.2, dii: 20 },
      { period: "Jun 2026", promoter: 50, fii: 17.0, dii: 20 },
    ];
    expect(trendsFromHistory(hist).fiiStreak).toBe(2);
    expect(trendsFromHistory(undefined).fiiStreak).toBeNull();
  });
});
