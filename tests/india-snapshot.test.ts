import { describe, it, expect } from "vitest";
import {
  computeIndiaSnapshot,
  deriveIndiaFundamentals,
  overallVerdict,
} from "@/lib/india-snapshot";
import type { ScreenerInCompany, ScreenerInStatements } from "@/lib/screener-in";
import { indianFiscalLabel } from "@/lib/format";

/** Minimal ScreenerInCompany with sensible empty defaults; override per test. */
function company(overrides: Partial<ScreenerInCompany> = {}): ScreenerInCompany {
  return {
    name: "Test Ltd",
    symbol: "TEST",
    bseCode: null,
    sector: null,
    industry: null,
    marketCap: 10000,
    currentPrice: 100,
    high52w: 120,
    low52w: 80,
    pe: null,
    bookValue: null,
    dividendYield: null,
    roce: null,
    roe: null,
    debt: null,
    changePercent: null,
    promoterHolding: null,
    ratios: [],
    peers: [],
    shareholding: [],
    shareholdingPeriods: [],
    annualPL: [],
    quarterlyPL: [],
    balanceSheet: null,
    cashFlow: null,
    basis: "consolidated",
    statementKind: "industrial",
    kpis: [],
    documents: null,
    ...overrides,
  };
}

/** Real screener.in balance-sheet shape (row names verified live, 2026-08). */
function balanceSheet(overrides: Partial<Record<string, number[]>> = {}): ScreenerInStatements {
  const rows: Record<string, number[]> = {
    "Equity Capital": [100, 100],
    Reserves: [900, 1100],
    Borrowings: [600, 480],
    "Other Liabilities": [200, 220],
    "Total Liabilities": [1800, 1900],
    "Total Assets": [1800, 1900],
    ...overrides,
  };
  return {
    periods: ["Mar 2025", "Mar 2026"],
    rows: Object.entries(rows).map(([name, values]) => ({ name, values })),
  };
}

function cashFlow(): ScreenerInStatements {
  return {
    periods: ["Mar 2025", "Mar 2026"],
    rows: [
      { name: "Cash from Operating Activity", values: [300, 340] },
      { name: "Cash from Investing Activity", values: [-150, -180] },
      { name: "Cash from Financing Activity", values: [-100, -120] },
      { name: "Net Cash Flow", values: [50, 40] },
      { name: "Free Cash Flow", values: [180, 210] },
    ],
  };
}

/** 5 full FYs + TTM (as the parser produces), industrial shape. */
const ANNUAL_PL = [
  { period: "Mar 2022", sales: 1000, netProfit: 100, opmPercent: 18, operatingProfit: 180, otherIncome: 10, interest: 30, depreciation: 40, eps: 10 },
  { period: "Mar 2023", sales: 1150, netProfit: 118, opmPercent: 18, operatingProfit: 205, otherIncome: 11, interest: 28, depreciation: 44, eps: 11.8 },
  { period: "Mar 2024", sales: 1330, netProfit: 140, opmPercent: 19, operatingProfit: 250, otherIncome: 12, interest: 26, depreciation: 48, eps: 14 },
  { period: "Mar 2025", sales: 1520, netProfit: 165, opmPercent: 19, operatingProfit: 290, otherIncome: 13, interest: 24, depreciation: 52, eps: 16.5 },
  { period: "Mar 2026", sales: 1750, netProfit: 196, opmPercent: 20, operatingProfit: 350, otherIncome: 14, interest: 22, depreciation: 56, eps: 19.6 },
  { period: "TTM", sales: 1820, netProfit: 205, opmPercent: 20, operatingProfit: 364, otherIncome: 15, interest: 22, depreciation: 57, eps: 20.5 },
];

/** 5 quarters so the latest has a YoY partner 4 back. */
const QUARTERLY_PL = [
  { period: "Jun 2025", sales: 420, netProfit: 46, opmPercent: 19, eps: 4.6 },
  { period: "Sep 2025", sales: 430, netProfit: 48, opmPercent: 19, eps: 4.8 },
  { period: "Dec 2025", sales: 445, netProfit: 50, opmPercent: 20, eps: 5.0 },
  { period: "Mar 2026", sales: 455, netProfit: 52, opmPercent: 20, eps: 5.2 },
  { period: "Jun 2026", sales: 470, netProfit: 55, opmPercent: 20, eps: 5.5 },
];

function industrialCompany(over: Partial<ScreenerInCompany> = {}): ScreenerInCompany {
  return company({
    marketCap: 4800,
    pe: 24,
    roce: 22,
    roe: 17,
    dividendYield: 1.2,
    annualPL: ANNUAL_PL,
    quarterlyPL: QUARTERLY_PL,
    balanceSheet: balanceSheet(),
    cashFlow: cashFlow(),
    ...over,
  });
}

/* -------------------------------------------------------------------------- */
/* deriveIndiaFundamentals                                                    */
/* -------------------------------------------------------------------------- */

describe("deriveIndiaFundamentals", () => {
  it("derives leverage, coverage, P/B and cash flow from the statements", () => {
    const d = deriveIndiaFundamentals(industrialCompany());
    expect(d.totalEquity).toBe(1200);        // 100 + 1100
    expect(d.totalDebt).toBe(480);
    expect(d.debtToEquity).toBe(0.4);        // 480 / 1200
    // EBIT = 350 + 14 − 56 = 308; interest 22 → 14.0x
    expect(d.interestCoverage).toBe(14);
    expect(d.priceToBook).toBe(4);           // 4800 / 1200
    expect(d.operatingCashFlow).toBe(340);
    expect(d.freeCashFlow).toBe(210);
    expect(d.basis).toBe("consolidated");
  });

  it("computes growth over full fiscal years, excluding the TTM column", () => {
    const d = deriveIndiaFundamentals(industrialCompany());
    expect(d.salesGrowthYoYPercent).toBeCloseTo(((1750 - 1520) / 1520) * 100, 5);
    expect(d.salesCagr3yPercent).toBeCloseTo((((1750 / 1150) ** (1 / 3)) - 1) * 100, 0);
    expect(d.latestAnnualPeriod).toBe("Mar 2026");
  });

  it("identifies the latest quarter with an Indian fiscal label and YoY deltas", () => {
    const d = deriveIndiaFundamentals(industrialCompany());
    expect(d.latestQuarter?.period).toBe("Jun 2026");
    expect(d.latestQuarter?.fiscalLabel).toBe("Q1 FY27");
    expect(d.latestQuarter?.salesYoYPercent).toBeCloseTo(((470 - 420) / 420) * 100, 5);
    expect(d.latestQuarter?.eps).toBe(5.5);
  });

  it("marks leverage metrics not-applicable for banks and surfaces NPA instead", () => {
    const bank = company({
      statementKind: "financial",
      roe: 16,
      balanceSheet: balanceSheet({ Deposits: [8000, 9000], Borrowing: [1500, 1600] }),
      quarterlyPL: [{ period: "Jun 2026", sales: 900, netProfit: 210, opmPercent: null, grossNpaPercent: 1.3, netNpaPercent: 0.4 }],
    });
    const d = deriveIndiaFundamentals(bank);
    expect(d.debtToEquity).toBeNull();
    expect(d.interestCoverage).toBeNull();
    expect(d.notApplicable).toContain("debt/equity");
    expect(d.deposits).toBe(9000);
    expect(d.netNpaPercent).toBe(0.4);
  });

  it("returns null D/E for negative equity instead of a nonsense ratio", () => {
    const distressed = industrialCompany({
      balanceSheet: balanceSheet({ Reserves: [-2000, -2400] }),
    });
    const d = deriveIndiaFundamentals(distressed);
    expect(d.totalEquity).toBe(-2300);
    expect(d.debtToEquity).toBeNull();
  });

  it("treats negligible interest as not-applicable coverage, not missing", () => {
    const debtFree = industrialCompany({
      annualPL: ANNUAL_PL.map((r) => ({ ...r, interest: 0.2 })),
    });
    const d = deriveIndiaFundamentals(debtFree);
    expect(d.interestCoverage).toBeNull();
    expect(d.notApplicable.join()).toContain("interest coverage");
    expect(d.missing).not.toContain("interest coverage");
  });

  it("tracks genuinely missing data in `missing`", () => {
    const sparse = company({ pe: 30 });
    const d = deriveIndiaFundamentals(sparse);
    expect(d.missing).toContain("total equity");
    expect(d.missing).toContain("operating cash flow");
    expect(d.missing).toContain("quarterly results");
  });
});

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

describe("computeIndiaSnapshot", () => {
  it("scores a high-quality, cheap compounder highly", () => {
    const c = industrialCompany({ roce: 28, roe: 24, pe: 14, dividendYield: 2 });
    const snap = computeIndiaSnapshot(c, deriveIndiaFundamentals(c));
    expect(snap.composite).toBeGreaterThanOrEqual(70);
    expect(["Strong Buy", "Accumulate"]).toContain(snap.verdict.label);
  });

  it("scores an expensive, low-return, levered name poorly", () => {
    const c = industrialCompany({
      roce: 6, roe: 5, pe: 60, dividendYield: null,
      balanceSheet: balanceSheet({ Borrowings: [3000, 3400] }),
      annualPL: ANNUAL_PL.map((r) => ({ ...r, sales: 1000, netProfit: 20, operatingProfit: 60, interest: 90 })),
    });
    const snap = computeIndiaSnapshot(c, deriveIndiaFundamentals(c));
    expect(snap.composite).toBeLessThan(45);
    expect(["Reduce", "Avoid", "Hold"]).toContain(snap.verdict.label);
  });

  it("EXCLUDES missing factors instead of granting neutral credit", () => {
    // Only P/E is known. Under the old neutral-stuffing, EV/EBITDA (15/30)
    // and P/B (10/20) padded the valuation score. Now the bucket must be
    // P/E + dividend-yield-if-present only.
    const c = company({ pe: 60 });          // deep-expensive
    const snap = computeIndiaSnapshot(c, deriveIndiaFundamentals(c));
    // P/E 60 → 2/35 ≈ 6, no padding toward 50
    expect(snap.valuation).not.toBeNull();
    expect(snap.valuation as number).toBeLessThan(10);
    expect(snap.dataQuality.missing.length).toBeGreaterThan(0);
  });

  it("returns null buckets (not fake scores) when a bucket has zero data", () => {
    const c = company({ pe: 20 });          // no ROCE/ROE/statements
    const snap = computeIndiaSnapshot(c, deriveIndiaFundamentals(c));
    expect(snap.quality).toBeNull();
    expect(snap.growth).toBeNull();
    expect(snap.valuation).not.toBeNull();
    // composite renormalizes over available buckets
    expect(snap.composite).toBeGreaterThan(0);
    expect(snap.dataQuality.coverage).toBeLessThan(0.5);
  });

  it("does not flag banks for leverage, and scores their asset quality", () => {
    const bank = company({
      statementKind: "financial",
      roe: 17, pe: 18,
      balanceSheet: balanceSheet({ Deposits: [8000, 9000], Borrowing: [1500, 1600] }),
      quarterlyPL: [{ period: "Jun 2026", sales: 900, netProfit: 210, opmPercent: null, grossNpaPercent: 1.3, netNpaPercent: 0.4 }],
    });
    const snap = computeIndiaSnapshot(bank, deriveIndiaFundamentals(bank));
    expect(snap.risks.join(" ")).not.toMatch(/leverage|D\/E/i);
    expect(snap.strengths.join(" ")).toMatch(/asset quality/i);
    expect(snap.dataQuality.notApplicable).toContain("debt/equity");
  });

  it("flags elevated NPA as a bank risk", () => {
    const bank = company({
      statementKind: "financial",
      roe: 9, pe: 10,
      quarterlyPL: [{ period: "Jun 2026", sales: 900, netProfit: 60, opmPercent: null, grossNpaPercent: 6.1, netNpaPercent: 3.2 }],
    });
    const snap = computeIndiaSnapshot(bank, deriveIndiaFundamentals(bank));
    expect(snap.risks.join(" ")).toMatch(/NPA/);
  });

  it("flags negative net worth for industrials", () => {
    const c = industrialCompany({ balanceSheet: balanceSheet({ Reserves: [-2000, -2400] }) });
    const snap = computeIndiaSnapshot(c, deriveIndiaFundamentals(c));
    expect(snap.risks.join(" ")).toMatch(/negative net worth/i);
  });
});

describe("overallVerdict", () => {
  it("maps composite bands to verdict labels", () => {
    expect(overallVerdict(80).label).toBe("Strong Buy");
    expect(overallVerdict(70).label).toBe("Accumulate");
    expect(overallVerdict(50).label).toBe("Hold");
    expect(overallVerdict(35).label).toBe("Reduce");
    expect(overallVerdict(10).label).toBe("Avoid");
  });
});

describe("indianFiscalLabel", () => {
  it("labels quarters on the April–March fiscal year", () => {
    expect(indianFiscalLabel("Jun 2026")).toBe("Q1 FY27");
    expect(indianFiscalLabel("Sep 2026")).toBe("Q2 FY27");
    expect(indianFiscalLabel("Dec 2025")).toBe("Q3 FY26");
    expect(indianFiscalLabel("Mar 2026")).toBe("Q4 FY26");
  });
  it("labels annual FY-end columns", () => {
    expect(indianFiscalLabel("Mar 2026", true)).toBe("FY26");
    expect(indianFiscalLabel("Mar 2015", true)).toBe("FY15");
  });
  it("passes through non-period strings", () => {
    expect(indianFiscalLabel("TTM")).toBe("TTM");
  });
});
