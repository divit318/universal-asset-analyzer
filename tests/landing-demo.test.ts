import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Quote, HistoryPoint } from "@/lib/types";

const getQuoteMock = vi.fn();
const getHistoryMock = vi.fn();
const getFundProfileMock = vi.fn();
vi.mock("@/lib/yahoo", () => ({
  getQuote: (...args: unknown[]) => getQuoteMock(...args),
  getHistory: (...args: unknown[]) => getHistoryMock(...args),
  getFundProfile: (...args: unknown[]) => getFundProfileMock(...args),
}));

const buildFundamentalsDataMock = vi.fn();
vi.mock("@/lib/fundamentals-data", () => ({
  buildFundamentalsData: (...args: unknown[]) => buildFundamentalsDataMock(...args),
}));

const { analyzeForDemo, DemoError } = await import("@/lib/landing-demo");

function quoteOf(overrides: Partial<Quote>): Quote {
  return {
    symbol: "TEST",
    name: "Test Asset",
    price: 100,
    previousClose: 99,
    change: 1,
    changePercent: 1.01,
    currency: "USD",
    marketCap: null,
    peRatio: null,
    dayHigh: null,
    dayLow: null,
    fiftyTwoWeekHigh: 120,
    fiftyTwoWeekLow: 80,
    volume: 1000,
    exchange: "NYQ",
    assetType: "EQUITY",
    regularMarketTime: "2026-08-10T15:30:00.000Z",
    ...overrides,
  };
}

/** Two years of gently rising daily closes: enough for every history-based scorer. */
function historyOf(days = 504): HistoryPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(2024, 7, 1);
    d.setDate(d.getDate() + i);
    const close = 100 + i * 0.1;
    return { date: d.toISOString().slice(0, 10), open: close, high: close, low: close, close, adjClose: close, volume: 1000 };
  });
}

async function expectDemoError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    expect.unreachable("expected a DemoError");
  } catch (err) {
    expect(err).toBeInstanceOf(DemoError);
    expect((err as InstanceType<typeof DemoError>).code).toBe(code);
  }
}

describe("analyzeForDemo", () => {
  beforeEach(() => {
    getQuoteMock.mockReset();
    getHistoryMock.mockReset();
    getFundProfileMock.mockReset();
    buildFundamentalsDataMock.mockReset();
  });

  it("rejects garbage input as invalid_symbol without touching the network", async () => {
    await expectDemoError(analyzeForDemo("hello world$"), "invalid_symbol");
    expect(getQuoteMock).not.toHaveBeenCalled();
  });

  it("maps a failed quote lookup to unknown_symbol", async () => {
    getQuoteMock.mockRejectedValue(new Error("Failed to fetch quote"));
    await expectDemoError(analyzeForDemo("ZZZZQQ"), "unknown_symbol");
  });

  it("refuses indices honestly instead of scoring them as equities", async () => {
    getQuoteMock.mockResolvedValue(quoteOf({ symbol: "^GSPC", assetType: "INDEX" }));
    await expectDemoError(analyzeForDemo("^GSPC"), "unsupported");
    expect(buildFundamentalsDataMock).not.toHaveBeenCalled();
  });

  it("reports no_data for funds Yahoo carries no profile for, instead of an all-n/a score", async () => {
    getQuoteMock.mockResolvedValue(quoteOf({ symbol: "NIFTYBEES.NS", assetType: "ETF", currency: "INR" }));
    getHistoryMock.mockResolvedValue(historyOf());
    getFundProfileMock.mockResolvedValue({
      family: null,
      category: null,
      legalType: null,
      expenseRatio: null,
      expenseRatioSource: null,
      turnoverPercent: null,
      totalNetAssets: null,
      currency: null,
      morningstarRating: null,
      inceptionDate: null,
      holdings: [],
      sectorWeights: [],
      assetAllocation: { stock: null, bond: null, cash: null, other: null },
      trailingReturns: { ytd: null, oneYear: null, threeYear: null, fiveYear: null },
      categoryRelativeReturns: { oneYear: null, threeYear: null, fiveYear: null },
      risk: null,
    });
    await expectDemoError(analyzeForDemo("NIFTYBEES.NS"), "no_data");
  });

  it("normalizes crypto engine output with real stages, sourced metrics, and no fabricated fields", async () => {
    getQuoteMock.mockResolvedValue(
      quoteOf({ symbol: "BTC-USD", name: "Bitcoin USD", assetType: "CRYPTOCURRENCY", exchange: "CCC" }),
    );
    getHistoryMock.mockResolvedValue(historyOf());

    const stages: string[] = [];
    const analysis = await analyzeForDemo("BTC-USD", (s) => stages.push(s.id));

    expect(stages).toEqual(["quote", "data", "score"]);
    expect(analysis.assetClass).toBe("crypto");
    expect(analysis.assetClassLabel).toBe("Crypto");
    expect(analysis.composite).toBeGreaterThanOrEqual(0);
    expect(analysis.composite).toBeLessThanOrEqual(100);
    expect(analysis.buckets.length).toBeGreaterThan(0);
    for (const bucket of analysis.buckets) {
      expect(bucket.points).toBeLessThanOrEqual(bucket.max);
      for (const factor of bucket.factors) expect(factor.detail.length).toBeGreaterThan(0);
    }
    for (const metric of analysis.metrics) {
      expect(metric.label.length).toBeGreaterThan(0);
      expect(metric.value.length).toBeGreaterThan(0);
      expect(metric.source.length).toBeGreaterThan(0);
    }
    // BTC is the crypto benchmark itself: only one history fetch, no benchmark fetch.
    expect(getHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("routes equities through the decision engine and carries its signals and provenance", async () => {
    getQuoteMock.mockResolvedValue(
      quoteOf({ symbol: "RELIANCE.NS", name: "Reliance Industries", currency: "INR", exchange: "NSI", marketCap: 1.7e13 }),
    );
    buildFundamentalsDataMock.mockResolvedValue({
      snapshot: {
        symbol: "RELIANCE.NS",
        price: 1327.3,
        sector: "Energy",
        trailingPE: 24.0,
        forwardPE: 18.6,
        pegRatio: 0.82,
        priceToBook: null,
        dividendYield: null,
        returnOnEquity: null,
        returnOnAssets: null,
        grossMargins: null,
        operatingMargins: 0.123,
        profitMargins: null,
        ebitdaMargins: null,
        revenueGrowth: 0.297,
        earningsGrowth: null,
        debtToEquity: 0.37,
        currentRatio: null,
        quickRatio: null,
        freeCashflow: null,
        operatingCashflow: null,
        totalCash: null,
        totalDebt: null,
        ebitda: null,
        enterpriseToEbitda: null,
        priceToSalesTrailing12Months: null,
      },
      analyst: { targetMean: 1681.7, upsidePercent: 26.7, numberOfOpinions: 31 },
      momentum: { score: 47, return3m: -1.3, vsSma200: -4.8, pctFrom52WkHigh: null, pctFrom52WkLow: null, vsSma50: null, trend: "down" },
      score: {
        total: 66,
        composite: 57,
        recommendation: "HOLD",
        confidence: 79,
        rationale: "Hold",
        signals: { fundamentals: 66, analysts: 70, momentum: 47, capitalAllocation: 38, sectorRotation: 25 },
        buckets: [
          { name: "Valuation", points: 27, max: 30, factors: [{ label: "PEG ratio", points: 10, max: 10, detail: "PEG 0.82" }] },
        ],
      },
    });

    const analysis = await analyzeForDemo("reliance.ns");

    expect(analysis.symbol).toBe("RELIANCE.NS");
    expect(analysis.assetClassLabel).toBe("Equity · NSE");
    expect(analysis.recommendationLabel).toBe("Hold");
    expect(analysis.confidence).toBe(79);
    expect(analysis.signals.map((s) => s.label)).toContain("Sector rotation");
    expect(analysis.metrics.find((m) => m.label === "Market cap")?.value).toContain("Cr");
    expect(analysis.metrics.every((m) => m.source.length > 0)).toBe(true);
    expect(analysis.sources.some((s) => s.includes("India weight profile"))).toBe(true);
    expect(analysis.computedAt).toBeTruthy();
  });
});
