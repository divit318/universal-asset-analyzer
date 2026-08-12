import { describe, it, expect } from "vitest";
import { extractOwnership } from "@/lib/india-ownership";
import type { ScreenerInCompany } from "@/lib/screener-in";

function company(over: Partial<ScreenerInCompany> = {}): ScreenerInCompany {
  return {
    name: "Test Co", symbol: "TESTCO", bseCode: null, sector: "Technology", industry: null,
    marketCap: 1e5, currentPrice: 100, high52w: null, low52w: null, stockPE: null, bookValue: null,
    dividendYield: null, roce: 24.5, roe: 18.2, faceValue: null, website: null, about: null,
    promoterHolding: 50.11,
    ratios: [], kpis: [], peersHtml: null,
    shareholding: [
      { holding: "promoter", name: "Promoters", values: ["52.00%", "51.50%", "50.11%"] },
      { holding: "fii", name: "FIIs", values: ["17.00%", "17.50%", "18.20%"] },
      { holding: "dii", name: "DIIs", values: ["20.00%", "20.10%", "20.90%"] },
    ],
    shareholdingPeriods: ["Dec 2025", "Mar 2026", "Jun 2026"],
    annualPL: null, quarterlyPL: null, balanceSheet: null, cashFlow: null,
    basis: "consolidated", statementKind: "industrial", documents: null,
    ...over,
  } as ScreenerInCompany;
}

describe("extractOwnership", () => {
  it("captures latest + previous quarter with explicit periods", () => {
    const o = extractOwnership(company());
    expect(o.period).toBe("Jun 2026");
    expect(o.prevPeriod).toBe("Mar 2026");
    expect(o.promoterHolding).toBe(50.11);
    expect(o.promoterPrev).toBe(51.5);
    expect(o.fiiHolding).toBe(18.2);
    expect(o.diiHolding).toBe(20.9);
  });

  it("carries screener.in ROE/ROCE and the reporting basis", () => {
    const o = extractOwnership(company());
    expect(o.roe).toBe(18.2);
    expect(o.roce).toBe(24.5);
    expect(o.basis).toBe("consolidated");
  });

  it("returns nulls, never zeros, when shareholding is absent", () => {
    const o = extractOwnership(
      company({ shareholding: [], shareholdingPeriods: [], promoterHolding: null } as Partial<ScreenerInCompany>),
    );
    expect(o.promoterHolding).toBeNull();
    expect(o.promoterPrev).toBeNull();
    expect(o.period).toBeNull();
  });
});

import { ownershipQoQ, type IndiaOwnership } from "@/lib/india-ownership";

describe("ownershipQoQ", () => {
  const base: IndiaOwnership = {
    symbol: "X", period: "Jun 2026", prevPeriod: "Mar 2026",
    promoterHolding: 51.5, promoterPrev: 50.1,
    fiiHolding: 17.0, fiiPrev: 19.1,
    diiHolding: 20.9, diiPrev: 20.9,
    roe: null, roce: null, basis: null, fetchedAt: 0,
  };

  it("computes percentage-POINT changes, not growth percentages", () => {
    const q = ownershipQoQ(base);
    expect(q.promoterChangeQoQ).toBe(1.4);   // 50.1 → 51.5 is +1.4pp (not +2.8%)
    expect(q.fiiChangeQoQ).toBe(-2.1);
    expect(q.diiChangeQoQ).toBe(0);
  });

  it("returns null when either side is undisclosed (no promoter, missing quarter)", () => {
    const q = ownershipQoQ({ ...base, promoterHolding: null });
    expect(q.promoterChangeQoQ).toBeNull();
    expect(ownershipQoQ(null).fiiChangeQoQ).toBeNull();
  });
});

import { ownershipTrends } from "@/lib/india-ownership";
import type { OwnershipObservation } from "@/lib/india-ownership";

function ownWithHistory(history: OwnershipObservation[]): IndiaOwnership {
  return {
    symbol: "X", period: history.at(-1)?.period ?? null, prevPeriod: null,
    promoterHolding: history.at(-1)?.promoter ?? null, promoterPrev: null,
    fiiHolding: history.at(-1)?.fii ?? null, fiiPrev: null,
    diiHolding: history.at(-1)?.dii ?? null, diiPrev: null,
    history, roe: null, roce: null, basis: null, fetchedAt: 0,
  };
}

const obs = (period: string, fii: number | null, promoter: number | null = 50, dii: number | null = 20): OwnershipObservation =>
  ({ period, promoter, fii, dii });

describe("ownershipTrends", () => {
  it("counts exactly 3 consecutive FII increases as +3", () => {
    const t = ownershipTrends(ownWithHistory([
      obs("Sep 2025", 16.0), obs("Dec 2025", 15.5), obs("Mar 2026", 16.2), obs("Jun 2026", 17.0), obs("Sep 2026", 17.4),
    ]));
    expect(t.fiiStreak).toBe(3); // Dec→Mar→Jun→Sep up; Sep25→Dec25 was down, breaking at 3
  });

  it("reports selling streaks as negative", () => {
    const t = ownershipTrends(ownWithHistory([
      obs("Mar 2026", 19.1), obs("Jun 2026", 18.0), obs("Sep 2026", 17.2),
    ]));
    expect(t.fiiStreak).toBe(-2);
  });

  it("treats a flat latest quarter (<0.05pp) as streak 0", () => {
    const t = ownershipTrends(ownWithHistory([
      obs("Mar 2026", 17.0), obs("Jun 2026", 18.0), obs("Sep 2026", 18.02),
    ]));
    expect(t.fiiStreak).toBe(0);
  });

  it("computes 4-quarter pp changes only with five real disclosures", () => {
    const five = ownershipTrends(ownWithHistory([
      obs("Sep 2025", 15.0), obs("Dec 2025", 15.5), obs("Mar 2026", 16.2), obs("Jun 2026", 17.0), obs("Sep 2026", 17.4),
    ]));
    expect(five.fiiChange4Q).toBe(2.4);
    const four = ownershipTrends(ownWithHistory([
      obs("Dec 2025", 15.5), obs("Mar 2026", 16.2), obs("Jun 2026", 17.0), obs("Sep 2026", 17.4),
    ]));
    expect(four.fiiChange4Q).toBeNull(); // never bridges a missing endpoint
  });

  it("breaks the series at a null observation instead of skipping it", () => {
    const t = ownershipTrends(ownWithHistory([
      obs("Sep 2025", 14.0), obs("Dec 2025", null), obs("Mar 2026", 16.2), obs("Jun 2026", 17.0), obs("Sep 2026", 17.4),
    ]));
    expect(t.fiiStreak).toBe(2);        // only the contiguous tail counts
    expect(t.fiiChange4Q).toBeNull();   // the 4Q window would cross the gap
  });

  it("returns all-null for no-promoter companies and missing history", () => {
    const noPromoter = ownershipTrends(ownWithHistory([
      obs("Jun 2026", 41.0, null), obs("Sep 2026", 41.5, null),
    ]));
    expect(noPromoter.promoterStreak).toBeNull();
    expect(noPromoter.fiiStreak).toBe(1);
    const noHistory = ownershipTrends({ ...ownWithHistory([]), history: undefined });
    expect(noHistory.fiiStreak).toBeNull();
    expect(ownershipTrends(null).promoterChange4Q).toBeNull();
  });
});

describe("extractOwnership history", () => {
  it("stores the full disclosed series with exact values and periods", () => {
    const o = extractOwnership(company());
    expect(o.history).toHaveLength(3);
    expect(o.history![0]).toEqual({ period: "Dec 2025", promoter: 52, fii: 17, dii: 20 });
    expect(o.history![2]).toEqual({ period: "Jun 2026", promoter: 50.11, fii: 18.2, dii: 20.9 });
  });
});
