import { describe, expect, it } from "vitest";
import { mapFundProfile, mapHistory, mapQuote, mapSuggestion } from "@/lib/yahoo";

describe("mapSuggestion", () => {
  it("maps a Yahoo equity hit", () => {
    expect(
      mapSuggestion({
        symbol: "AAPL",
        longname: "Apple Inc.",
        shortname: "Apple",
        exchDisp: "NASDAQ",
        typeDisp: "Equity",
        quoteType: "EQUITY",
        isYahooFinance: true,
      }),
    ).toEqual({
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NASDAQ",
      type: "Equity",
      country: { code: "US", flag: "🇺🇸" },
    });
  });

  it("resolves a non-US listing's country from its ticker suffix", () => {
    expect(
      mapSuggestion({
        symbol: "RELIANCE.NS",
        longname: "Reliance Industries Limited",
        exchDisp: "NSE",
        typeDisp: "Equity",
        quoteType: "EQUITY",
        isYahooFinance: true,
      })?.country,
    ).toEqual({ code: "IN", flag: "🇮🇳" });

    expect(
      mapSuggestion({
        symbol: "7203.T",
        longname: "Toyota Motor Corporation",
        exchDisp: "Tokyo",
        typeDisp: "Equity",
        quoteType: "EQUITY",
        isYahooFinance: true,
      })?.country,
    ).toEqual({ code: "JP", flag: "🇯🇵" });
  });

  it("omits a flag for instruments not tied to one country", () => {
    expect(
      mapSuggestion({
        symbol: "BTC-USD",
        longname: "Bitcoin USD",
        typeDisp: "Cryptocurrency",
        quoteType: "CRYPTOCURRENCY",
        isYahooFinance: true,
      })?.country,
    ).toBeNull();
  });

  it("drops non-Yahoo or symbol-less rows", () => {
    expect(mapSuggestion({ isYahooFinance: false })).toBeNull();
    expect(mapSuggestion({ symbol: "X", isYahooFinance: undefined })).toBeNull();
  });
});

describe("mapQuote", () => {
  it("maps a full raw quote", () => {
    const q = mapQuote({
      symbol: "AAPL",
      longName: "Apple Inc.",
      regularMarketPrice: 200,
      regularMarketPreviousClose: 190,
      regularMarketChange: 10,
      regularMarketChangePercent: 5.26,
      currency: "USD",
      marketCap: 3e12,
      trailingPE: 30,
      regularMarketVolume: 1000000,
      fullExchangeName: "NasdaqGS",
    });
    expect(q).toMatchObject({
      symbol: "AAPL",
      name: "Apple Inc.",
      price: 200,
      change: 10,
      marketCap: 3e12,
      peRatio: 30,
      exchange: "NasdaqGS",
    });
  });

  it("derives change from price/previousClose when missing", () => {
    const q = mapQuote({
      symbol: "X",
      regularMarketPrice: 110,
      regularMarketPreviousClose: 100,
    });
    expect(q.change).toBeCloseTo(10);
    expect(q.changePercent).toBeCloseTo(10);
  });

  it("falls back to nulls for absent fundamentals", () => {
    const q = mapQuote({ symbol: "Y", regularMarketPrice: 5 });
    expect(q.marketCap).toBeNull();
    expect(q.peRatio).toBeNull();
    expect(q.currency).toBe("USD");
    expect(q.name).toBe("Y");
  });

  it("carries fund-shaped fields (net assets, YTD) for mutual fund quotes", () => {
    const q = mapQuote({
      symbol: "0P0001BA9B.BO",
      longName: "HDFC Large Cap IDCW-R",
      regularMarketPrice: 53.34,
      currency: "INR",
      quoteType: "MUTUALFUND",
      netAssets: 36261556000,
      ytdReturn: -5.58,
    });
    expect(q.name).toBe("HDFC Large Cap IDCW-R");
    expect(q.netAssets).toBe(36261556000);
    expect(q.ytdReturn).toBe(-5.58);
    expect(q.marketCap).toBeNull();
    expect(q.volume).toBeNull();
  });
});

describe("mapFundProfile", () => {
  // The exact shape Yahoo returns for every Indian mutual fund (verified live
  // against 0P0001BA9B.BO — HDFC Large Cap IDCW-R): expense ratios encoded as
  // literal zeros, category returns padded with zeros, no categoryName, with
  // the real turnover/AUM/rating living in defaultKeyStatistics/summaryDetail.
  const indianFundRaw = {
    fundProfile: {
      family: "HDFC Asset Management Co Ltd",
      categoryName: null,
      legalType: null,
      feesExpensesInvestment: { annualReportExpenseRatio: 0 },
    },
    topHoldings: {
      stockPosition: 0.9678,
      bondPosition: 0.005,
      cashPosition: 0.0272,
      holdings: [{ symbol: "ICICIBANK.NS", holdingName: "ICICI Bank Ltd", holdingPercent: 0.0973 }],
      sectorWeightings: [{ financial_services: 0.3965 }],
    },
    fundPerformance: {
      trailingReturns: { ytd: -0.0558, oneYear: -0.0345, threeYear: 0.1034, fiveYear: 0.1204 },
      trailingReturnsCat: { ytd: 0, oneYear: 0, threeYear: 0, fiveYear: 0 },
    },
    defaultKeyStatistics: {
      annualReportExpenseRatio: 0,
      annualHoldingsTurnover: 0.1276,
      totalAssets: 36261556224,
      morningStarOverallRating: 3,
      fundInceptionDate: "1996-10-11T00:00:00.000Z",
    },
    summaryDetail: { totalAssets: 36261556224, currency: "INR" },
  };

  it("treats Yahoo's zero-encoded expense ratio as missing, never as free", () => {
    const fund = mapFundProfile(indianFundRaw);
    expect(fund.expenseRatio).toBeNull();
    expect(fund.expenseRatioSource).toBeNull();
  });

  it("never fabricates a vs-category edge from an all-zero category baseline", () => {
    const fund = mapFundProfile(indianFundRaw);
    expect(fund.categoryRelativeReturns.oneYear).toBeNull();
    expect(fund.categoryRelativeReturns.threeYear).toBeNull();
    // …while the absolute returns themselves survive.
    expect(fund.trailingReturns.threeYear).toBeCloseTo(10.34);
  });

  it("recovers turnover, AUM, currency, rating and inception from the key-stats modules", () => {
    const fund = mapFundProfile(indianFundRaw);
    expect(fund.turnoverPercent).toBeCloseTo(0.1276);
    expect(fund.totalNetAssets).toBe(36261556224);
    expect(fund.currency).toBe("INR");
    expect(fund.morningstarRating).toBe(3);
    expect(fund.inceptionDate).toBe("1996-10-11");
  });

  it("keeps a US fund's real expense ratio and category-relative returns", () => {
    const fund = mapFundProfile({
      fundProfile: {
        family: "SPDR State Street Global Advisors",
        categoryName: "Large Blend",
        feesExpensesInvestment: { annualReportExpenseRatio: 0.000945, totalNetAssets: 486986.6 },
      },
      fundPerformance: {
        trailingReturns: { ytd: 0.1016, oneYear: 0.15, threeYear: 0.19, fiveYear: 0.14 },
        trailingReturnsCat: { ytd: 0.0514, oneYear: 0.2772, threeYear: 0.1934, fiveYear: 0.12 },
      },
      summaryDetail: { totalAssets: 781188857856, currency: "USD" },
    });
    expect(fund.expenseRatio).toBeCloseTo(0.000945);
    expect(fund.expenseRatioSource).toBe("yahoo");
    expect(fund.category).toBe("Large Blend");
    // summaryDetail's live raw figure wins over fundProfile's stale millions figure.
    expect(fund.totalNetAssets).toBe(781188857856);
    expect(fund.categoryRelativeReturns.oneYear).toBeCloseTo((0.15 - 0.2772) * 100);
  });

  // Verified live against QQQM (2026-08): Yahoo returns a riskStatistics row of
  // all zeros for funds it has no Morningstar risk data on. Left through, the
  // fund scorer penalised the fund for a Sharpe and alpha that were never
  // reported, and the verdict-trigger engine posed conditions on them.
  it("reads a fully-zeroed Morningstar risk row as absent, not as measured zeros", () => {
    const fund = mapFundProfile({
      fundProfile: { categoryName: "Large Growth" },
      fundPerformance: {
        riskOverviewStatistics: { riskStatistics: [{ year: "5y", beta: 0, alpha: 0, stdDev: 0, sharpeRatio: 0 }] },
      },
    });
    expect(fund.risk).toBeNull();
  });

  it("keeps a genuine zero alpha inside an otherwise real risk row", () => {
    // Block-level, not field-level: a real fund can post an alpha or Sharpe of
    // exactly 0, but never a beta AND standard deviation of exactly 0.
    const fund = mapFundProfile({
      fundPerformance: {
        riskOverviewStatistics: { riskStatistics: [{ year: "5y", beta: 1.02, alpha: 0, stdDev: 15.3, sharpeRatio: 0 }] },
      },
    });
    expect(fund.risk).toEqual({ beta: 1.02, alpha: 0, stdDev: 15.3, sharpeRatio: 0 });
  });

  it("falls back to fundProfile's millions-denominated AUM only as a last resort", () => {
    const fund = mapFundProfile({
      fundProfile: { feesExpensesInvestment: { totalNetAssets: 486986.6 } },
    });
    expect(fund.totalNetAssets).toBeCloseTo(486986.6e6);
  });

  it("degrades an empty payload to nulls without throwing", () => {
    const fund = mapFundProfile({});
    expect(fund.expenseRatio).toBeNull();
    expect(fund.totalNetAssets).toBeNull();
    expect(fund.currency).toBeNull();
    expect(fund.holdings).toEqual([]);
    expect(fund.categoryRelativeReturns).toEqual({ oneYear: null, threeYear: null });
  });
});

describe("mapHistory", () => {
  it("normalizes dates and drops gaps", () => {
    const points = mapHistory([
      { date: new Date("2024-01-01T00:00:00Z"), close: 100 },
      { date: "2024-01-02T00:00:00Z", close: null },
      { date: null, close: 102 },
      { date: "2024-01-03T00:00:00Z", close: 103 },
    ]);
    expect(points).toEqual([
      { date: "2024-01-01", close: 100, adjClose: 100 },
      { date: "2024-01-03", close: 103, adjClose: 103 },
    ]);
  });

  it("captures OHLC fields when present", () => {
    const points = mapHistory([
      { date: "2024-01-01T00:00:00Z", open: 98, high: 105, low: 97, close: 102, adjclose: 102, volume: 5000000 },
    ]);
    expect(points).toEqual([
      { date: "2024-01-01", open: 98, high: 105, low: 97, close: 102, adjClose: 102, volume: 5000000 },
    ]);
  });

  it("omits OHLC fields when absent (close-only row)", () => {
    const points = mapHistory([
      { date: "2024-01-01T00:00:00Z", close: 50 },
    ]);
    // Should NOT have open/high/low keys at all
    expect(Object.keys(points[0])).not.toContain("open");
    expect(Object.keys(points[0])).not.toContain("high");
    expect(Object.keys(points[0])).not.toContain("low");
  });

  it("uses adjclose when provided", () => {
    const points = mapHistory([
      { date: "2024-01-01T00:00:00Z", close: 100, adjclose: 95 },
    ]);
    expect(points[0].adjClose).toBe(95);
  });
});
