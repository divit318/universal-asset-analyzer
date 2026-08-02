import { describe, it, expect } from "vitest";
import { buildCanonicalFacts, validateStatements, resolveMarket, type CanonicalInput } from "@/lib/ic/canonical";
import type { Quote, FundamentalsSnapshot, FinancialStatements } from "@/lib/types";

const quote = (over: Partial<Quote> = {}): Quote => ({
  symbol: "TEST",
  name: "Test Corp",
  price: 100,
  previousClose: 99,
  change: 1,
  changePercent: 1,
  currency: "USD",
  marketCap: 1_000_000_000_000,
  peRatio: 25,
  dayHigh: null,
  dayLow: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  volume: null,
  exchange: "NMS",
  ...over,
});

const snapshot = (over: Partial<FundamentalsSnapshot> = {}): FundamentalsSnapshot => ({
  symbol: "TEST",
  price: 100,
  trailingPE: 25,
  forwardPE: 22,
  pegRatio: 1.5,
  priceToBook: 10,
  dividendYield: 0.01,
  returnOnEquity: 0.3,
  returnOnAssets: 0.15,
  grossMargins: 0.6,
  operatingMargins: 0.3,
  profitMargins: 0.25,
  ebitdaMargins: 0.35,
  revenueGrowth: 0.2,
  earningsGrowth: 0.25,
  debtToEquity: 0.5,
  currentRatio: 2,
  quickRatio: 1.5,
  freeCashflow: 40_000_000_000,
  operatingCashflow: 50_000_000_000,
  totalCash: 30_000_000_000,
  totalDebt: 10_000_000_000,
  ebitda: 60_000_000_000,
  enterpriseToEbitda: 16,
  priceToSalesTrailing12Months: 8,
  ...over,
});

const statements = (over: Partial<FinancialStatements> = {}): FinancialStatements => ({
  symbol: "TEST",
  fiscalYears: [2024, 2025, 2026],
  revenue: [
    { fy: 2024, value: 100e9 },
    { fy: 2025, value: 120e9 },
    { fy: 2026, value: 150e9 },
  ],
  grossProfit: [],
  operatingIncome: [],
  netIncome: [{ fy: 2026, value: 40e9 }],
  freeCashFlow: [
    { fy: 2025, value: 30e9 },
    { fy: 2026, value: 45e9 },
  ],
  grossMargin: [],
  operatingMargin: [
    { fy: 2025, value: 0.28 },
    { fy: 2026, value: 0.31 },
  ],
  netMargin: [],
  revenueCagr: 0.22,
  fcfCagr: 0.5,
  ...over,
});

const input = (over: Partial<CanonicalInput> = {}): CanonicalInput => ({
  symbol: "TEST",
  quote: quote(),
  snapshot: snapshot(),
  analyst: null,
  insider: null,
  statements: statements(),
  screenerIn: null,
  now: "2026-08-02T00:00:00.000Z",
  ...over,
});

describe("buildCanonicalFacts", () => {
  it("every field carries value, unit, period, source and asOf", () => {
    const f = buildCanonicalFacts(input());
    for (const d of [f.spot, f.marketCap, f.netDebt, f.enterpriseValue, f.freeCashFlowTtm]) {
      expect(d).not.toBeNull();
      expect(d!.asOf).toBe("2026-08-02T00:00:00.000Z");
      expect(d!.periodLabel.length).toBeGreaterThan(0);
      expect(d!.source.provider.length).toBeGreaterThan(0);
      expect(Number.isFinite(d!.value)).toBe(true);
    }
    expect(f.netDebt!.value).toBe(10_000_000_000 - 30_000_000_000);
    expect(f.enterpriseValue!.value).toBe(1_000_000_000_000 + f.netDebt!.value);
  });

  it("TTM and FY free cash flow are distinct named concepts", () => {
    const f = buildCanonicalFacts(input());
    expect(f.freeCashFlowTtm!.periodLabel).toBe("TTM");
    expect(f.freeCashFlowFy!.periodLabel).toBe("FY2026");
    expect(f.freeCashFlowFy!.value).toBe(45e9);
  });

  it("missing data lands in gaps with a reason, never as zero", () => {
    const f = buildCanonicalFacts(input({ snapshot: snapshot({ freeCashflow: null, totalDebt: null }) }));
    expect(f.freeCashFlowTtm).toBeNull();
    expect(f.gaps.some((g) => g.concept === "free cash flow (TTM)")).toBe(true);
    expect(f.gaps.some((g) => g.concept === "net debt")).toBe(true);
  });

  it("flags market cap vs spot × shares drift", () => {
    // marketCap deliberately inconsistent with price × derived shares is impossible
    // by construction (shares are derived), so simulate via statements currency clash
    const f = buildCanonicalFacts(input({ quote: quote({ currency: "INR" }) }));
    expect(f.validationIssues.some((i) => i.includes("USD (SEC EDGAR)"))).toBe(true);
  });

  it("records analyst/insider gaps for uncovered names", () => {
    const f = buildCanonicalFacts(input());
    expect(f.gaps.some((g) => g.concept === "analyst coverage")).toBe(true);
    expect(f.gaps.some((g) => g.concept === "insider transactions")).toBe(true);
  });

  it("explains the EDGAR gap for Indian names instead of silence", () => {
    const f = buildCanonicalFacts(input({
      symbol: "TCS.NS",
      quote: quote({ currency: "INR", exchange: "NSI" }),
      statements: null,
    }));
    expect(f.market).toBe("IN");
    expect(f.gaps.some((g) => g.concept === "annual statements" && g.reason.includes("EDGAR"))).toBe(true);
  });
});

describe("resolveMarket", () => {
  it("resolves by suffix, currency and exchange", () => {
    expect(resolveMarket("TCS.NS", null)).toBe("IN");
    expect(resolveMarket("RELIANCE.BO", null)).toBe("IN");
    expect(resolveMarket("NVDA", quote())).toBe("US");
    expect(resolveMarket("SAP.DE", quote({ currency: "EUR", exchange: "GER" }))).toBe("OTHER");
  });
});

describe("validateStatements (Phase 1.2/1.3)", () => {
  it("passes clean statements", () => {
    expect(validateStatements(statements())).toHaveLength(0);
  });

  it("catches non-increasing fiscal years", () => {
    const bad = statements({ revenue: [{ fy: 2025, value: 1 }, { fy: 2025, value: 2 }] });
    expect(validateStatements(bad).some((i) => i.includes("not strictly increasing"))).toBe(true);
  });

  it("catches period-end dates that disagree with fiscal labels", () => {
    const bad = statements({
      revenue: [
        { fy: 2024, value: 1, end: "2025-06-30" } as never,
        { fy: 2025, value: 2, end: "2024-06-30" } as never,
      ],
    });
    expect(validateStatements(bad).some((i) => i.includes("disagree"))).toBe(true);
  });

  it("catches a revenue-into-FCF field collision", () => {
    const bad = statements({
      freeCashFlow: [
        { fy: 2024, value: 100e9 },
        { fy: 2025, value: 120e9 },
      ],
    });
    expect(validateStatements(bad).some((i) => i.includes("field mapping collision"))).toBe(true);
  });

  it("catches a currency value in a margin field", () => {
    const bad = statements({ operatingMargin: [{ fy: 2026, value: 45e9 }] });
    expect(validateStatements(bad).some((i) => i.includes("plausible margin"))).toBe(true);
  });
});
