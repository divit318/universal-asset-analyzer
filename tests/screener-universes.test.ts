import { describe, expect, it } from "vitest";
import { computeFdv, toCandidate as cryptoCandidate } from "@/lib/screener/universes/crypto";
import { creditProfile, issuerType, riskLevel } from "@/lib/screener/universes/bond";
import { curveSlope, datedContracts } from "@/lib/screener/universes/commodity";
import { categoryFocus, categoryRegion, categoryStyle, isNonEquityFund } from "@/lib/screener/universes/etf";
import type { FundDetail } from "@/lib/screener/universes/fund-shared";
import { toCandidate as reitCandidate } from "@/lib/screener/universes/reit";
import { toCandidate as equityCandidate } from "@/lib/screener/universes/equity";
import { seasonality, trendScore } from "@/lib/screener/metrics-util";
import { getCommodity } from "@/lib/assets/reference/commodities";
import { cryptoSector } from "@/lib/assets/reference/crypto-sectors";
import { rateDifferential, realRateDifferential, getPair } from "@/lib/assets/reference/policy-rates";
import type { HistoryPoint, StockMetrics } from "@/lib/types";

/**
 * The per-asset-class derivation logic — the pure functions that turn a
 * provider's response into normalized metrics. Every fixture here is taken from
 * a real, verified Yahoo response (see the probe values quoted in each test),
 * so these are contract tests against the actual upstream shapes, not against
 * made-up data.
 */

/* -------------------------------------------------------------------------- */
/* Crypto                                                                      */
/* -------------------------------------------------------------------------- */

describe("crypto: FDV derivation", () => {
  it("uses maxSupply for a hard-capped token (BTC: 21M cap)", () => {
    expect(computeFdv({ symbol: "BTC-USD", maxSupply: 21_000_000, totalSupply: 20_054_880, circulatingSupply: 20_054_880 }, 64_000)).toBe(
      21_000_000 * 64_000,
    );
  });

  it("falls back to totalSupply when there is no hard cap (ETH/SOL report maxSupply: 0)", () => {
    // Verified live: ETH and SOL both return maxSupply 0, which must not be
    // read as "this token has a zero supply cap".
    expect(computeFdv({ symbol: "ETH-USD", maxSupply: 0, totalSupply: 120_683_056, circulatingSupply: 120_683_056 }, 1800)).toBe(
      120_683_056 * 1800,
    );
  });

  it("falls back to circulating supply when neither cap is reported", () => {
    expect(computeFdv({ symbol: "X-USD", circulatingSupply: 1000 }, 5)).toBe(5000);
  });

  it("returns null rather than guessing when price or supply is missing", () => {
    expect(computeFdv({ symbol: "X-USD" }, 5)).toBeNull();
    expect(computeFdv({ symbol: "X-USD", maxSupply: 1000 }, null)).toBeNull();
  });

  it("caps mcap/FDV at 1 — a stale maxSupply must not report >100% circulating", () => {
    const row = {
      symbol: "SOL-USD",
      regularMarketPrice: 100,
      marketCap: 70_000, // implies 700 coins circulating
      maxSupply: 0,
      totalSupply: 600, // stale/lower than circulating
      circulatingSupply: 700,
      volume24Hr: 7_000,
    };
    const c = cryptoCandidate(row, undefined);
    expect(c.metrics.mcapToFdv).toBe(1);
  });

  it("derives turnover and tags the sector from the curated table", () => {
    const c = cryptoCandidate(
      {
        symbol: "UNI-USD",
        longName: "Uniswap USD",
        regularMarketPrice: 10,
        marketCap: 1_000_000,
        volume24Hr: 50_000,
        maxSupply: 1_000_000_000,
        circulatingSupply: 100_000,
      },
      undefined,
    );
    expect(c.metrics.volumeToMcap).toBeCloseTo(0.05);
    expect(c.attributes.sector).toBe("DeFi");
  });

  it("classifies known tokens and refuses to guess unknown ones", () => {
    expect(cryptoSector("BTC-USD")).toBe("Store of Value");
    expect(cryptoSector("SOL-USD")).toBe("Layer 1");
    expect(cryptoSector("FET-USD")).toBe("AI");
    expect(cryptoSector("ARB-USD")).toBe("Layer 2");
    expect(cryptoSector("USDC-USD")).toBe("Stablecoin");
    // Unknown → "Other", never an invented category.
    expect(cryptoSector("ZZZZ-USD")).toBe("Other");
  });
});

/* -------------------------------------------------------------------------- */
/* Bonds                                                                       */
/* -------------------------------------------------------------------------- */

describe("bond: credit profile", () => {
  // Verified live against AGG's actual bondRatings payload.
  const AGG = {
    aa: 74.05,
    aaa: 2.27,
    a: 11.99,
    bbb: 11.69,
    bb: 0,
    b: 0,
    below_b: 0,
    us_government: 48.88,
    other: 0,
  };
  // Verified live against HYG's actual bondRatings payload.
  const HYG = {
    bb: 57.86,
    b: 31.85,
    below_b: 9.26,
    bbb: 0.69,
    aa: 0,
    aaa: 0,
    a: 0,
    us_government: 0,
    other: 0.34,
  };

  it("reads an investment-grade fund as investment grade", () => {
    const p = creditProfile(AGG);
    expect(p.highYieldPct).toBe(0);
    // The letter buckets partition the portfolio exactly — no double-counting
    // of Treasuries, which appear under BOTH us_government and their AA rating.
    expect(p.investmentGradePct).toBeCloseTo(100, 1);
    expect(p.avgRating).toBe("AA"); // AGG is Treasury/agency-heavy: AA, not AAA
    // Reported separately, precisely because it overlaps the letter buckets.
    expect(p.govtPct).toBeCloseTo(48.88);
  });

  it("never lets the government bucket push investment grade above 100%", () => {
    // Regression: summing us_government into the IG total double-counted every
    // Treasury and produced "investment grade: 149%".
    expect(creditProfile(AGG).investmentGradePct!).toBeLessThanOrEqual(100.5);
  });

  it("reads a junk fund as junk", () => {
    const p = creditProfile(HYG);
    expect(p.highYieldPct).toBeCloseTo(98.97, 1);
    expect(p.investmentGradePct).toBeCloseTo(0.69, 1);
    expect(p.avgRating).toBe("BB"); // HYG is majority BB
  });

  it("returns nulls — not zeros — when a fund reports no ratings at all", () => {
    // An equity ETF's bondRatings come back all-zero. That means "no bond data",
    // not "0% investment grade", and must not rank as maximally risky.
    expect(creditProfile({ aaa: 0, aa: 0, a: 0, bbb: 0, bb: 0, b: 0, below_b: 0, us_government: 0 })).toEqual({
      investmentGradePct: null,
      highYieldPct: null,
      govtPct: null,
      avgRating: null,
    });
    expect(creditProfile(null).avgRating).toBeNull();
  });
});

describe("bond: classification", () => {
  it("maps Morningstar categories to issuer types", () => {
    expect(issuerType("High Yield Bond")).toBe("High Yield");
    expect(issuerType("Long Government")).toBe("Government");
    expect(issuerType("Corporate Bond")).toBe("Corporate");
    expect(issuerType("Muni National Interm")).toBe("Municipal");
    expect(issuerType("Inflation-Protected Bond")).toBe("Inflation-Protected");
    expect(issuerType("Emerging Markets Bond")).toBe("Emerging Markets");
    expect(issuerType("Bank Loan")).toBe("Bank Loan");
    expect(issuerType(null)).toBeNull();
  });

  it("bands risk from BOTH duration and credit, since either alone can sink a fund", () => {
    expect(riskLevel(1, 0)).toBe("Very Low"); // short + safe
    expect(riskLevel(5, 0)).toBe("Low"); // core bond fund
    // A long Treasury fund has zero credit risk and still fell by a third when
    // rates rose. Duration alone is enough to make it High.
    expect(riskLevel(12, 0)).toBe("High");
    // A short junk fund has almost no duration and still defaults in a recession.
    expect(riskLevel(2, 95)).toBe("High");
    expect(riskLevel(12, 95)).toBe("Very High"); // both at once
    expect(riskLevel(null, null)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Commodities                                                                 */
/* -------------------------------------------------------------------------- */

describe("commodity: futures curve", () => {
  it("builds Yahoo's dated contract symbols from a root", () => {
    const crude = getCommodity("CL=F")!;
    // From July 2026, the next contracts are Aug (Q), Sep (U), Oct (V)…
    const symbols = datedContracts(crude, 3, new Date(Date.UTC(2026, 6, 11)));
    expect(symbols.slice(0, 3)).toEqual(["CLQ26.NYM", "CLU26.NYM", "CLV26.NYM"]);
  });

  it("rolls the month code into the next year correctly", () => {
    const gold = getCommodity("GC=F")!;
    const symbols = datedContracts(gold, 3, new Date(Date.UTC(2026, 10, 15))); // November
    expect(symbols.slice(0, 3)).toEqual(["GCZ26.CMX", "GCF27.CMX", "GCG27.CMX"]);
  });

  it("reads a downward-sloping curve as backwardation (negative slope)", () => {
    // The real CL curve, verified live: 71.41 front → 70.34 six months out.
    const slope = curveSlope([
      { symbol: "CLQ26.NYM", price: 71.41, monthsOut: 1 },
      { symbol: "CLU26.NYM", price: 71.34, monthsOut: 2 },
      { symbol: "CLF27.NYM", price: 70.34, monthsOut: 6 },
    ]);
    expect(slope).toBeLessThan(0); // backwardation → the roll pays a long
    expect(slope).toBeCloseTo(-3.6, 0);
  });

  it("reads an upward-sloping curve as contango (positive slope)", () => {
    const slope = curveSlope([
      { symbol: "A", price: 100, monthsOut: 1 },
      { symbol: "B", price: 106, monthsOut: 7 },
    ]);
    expect(slope).toBeGreaterThan(0);
    expect(slope).toBeCloseTo(12, 0); // +6% over 6 months → ~12%/yr
  });

  it("returns null when fewer than two contracts quoted", () => {
    expect(curveSlope([{ symbol: "A", price: 100, monthsOut: 1 }])).toBeNull();
    expect(curveSlope([])).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Trend & seasonality (shared derivations)                                    */
/* -------------------------------------------------------------------------- */

function series(prices: number[], startISO = "2024-01-01"): HistoryPoint[] {
  const start = new Date(startISO);
  return prices.map((close, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), close };
  });
}

describe("trendScore", () => {
  it("scores a clean uptrend at 100", () => {
    // Steadily rising: price above both MAs, and the 50 above the 200.
    const rising = series(Array.from({ length: 260 }, (_, i) => 100 + i));
    expect(trendScore(rising)).toBe(100);
  });

  it("scores a clean downtrend at 0", () => {
    const falling = series(Array.from({ length: 260 }, (_, i) => 400 - i));
    expect(trendScore(falling)).toBe(0);
  });

  it("returns null rather than a partial score without 200 sessions", () => {
    expect(trendScore(series([1, 2, 3]))).toBeNull();
  });
});

describe("seasonality", () => {
  it("returns nulls when there aren't enough years to be meaningful", () => {
    // Two observations of a calendar month is noise, not a seasonal pattern.
    const thin = series([100, 101, 102], "2024-03-01");
    expect(seasonality(thin, 2)).toEqual({ avgReturn: null, score: null });
  });

  it("measures the average return for a calendar month across years", () => {
    // Build 4 years where March always rises 10% and every other month is flat.
    const points: HistoryPoint[] = [];
    for (const year of [2021, 2022, 2023, 2024]) {
      for (let month = 0; month < 12; month++) {
        const rise = month === 2 ? 1.1 : 1.0;
        points.push({ date: `${year}-${String(month + 1).padStart(2, "0")}-01`, close: 100 });
        points.push({ date: `${year}-${String(month + 1).padStart(2, "0")}-28`, close: 100 * rise });
      }
    }
    const march = seasonality(points, 2);
    expect(march.avgReturn).toBeCloseTo(10, 1);
    expect(march.score).toBe(100); // its strongest month
  });
});

/* -------------------------------------------------------------------------- */
/* ETFs                                                                        */
/* -------------------------------------------------------------------------- */

describe("etf: category mapping", () => {
  it("reads geography out of the fund category", () => {
    expect(categoryRegion("China Region")).toBe("China");
    expect(categoryRegion("Japan Stock")).toBe("Japan");
    expect(categoryRegion("Diversified Emerging Mkts")).toBe("Emerging Markets");
    expect(categoryRegion("Foreign Large Blend")).toBe("Developed ex-US");
    expect(categoryRegion("Large Blend")).toBe("US");
    expect(categoryRegion(null)).toBeNull();
  });

  it("reads sector focus out of the category, falling back to the largest holding weight", () => {
    expect(categoryFocus("Technology", null)).toBe("Technology");
    expect(categoryFocus("Health", null)).toBe("Healthcare");
    expect(categoryFocus("Large Blend", null)).toBe("Broad Market");
    // No sector in the name → use what the fund actually holds.
    expect(categoryFocus("Miscellaneous Sector", "Technology")).toBe("Technology");
    expect(categoryFocus("Miscellaneous Sector", "Financial Services")).toBe("Financials");
  });

  it("reads style out of the category", () => {
    expect(categoryStyle("Large Value")).toBe("Value");
    expect(categoryStyle("Large Growth")).toBe("Growth");
    expect(categoryStyle("Large Blend")).toBe("Blend");
    expect(categoryStyle("Miscellaneous Sector")).toBe("Thematic");
    expect(categoryStyle("Technology")).toBe("Sector");
    expect(categoryStyle("Equity Income")).toBe("Income");
  });
});

/**
 * Asset-class purity for the ETF universe.
 *
 * Every fixture below is a real, verified `topHoldings`/`fundProfile` payload
 * (the stock/bond/cash weights are quoted from live responses), because the
 * whole difficulty here is that the intuitive rules are wrong: 0% equity is
 * normal for a commodity ETF, and a 67% cash position is normal for a
 * futures-backed one.
 */
describe("etf: is this fund actually an ETF for this class?", () => {
  const detail = (over: Partial<FundDetail>): FundDetail => ({
    available: true,
    category: null,
    family: null,
    effectiveSectors: null,
    expenseRatio: null,
    top10Concentration: null,
    topHoldings: null,
    topSectorWeight: null,
    topSector: null,
    sectorWeights: null,
    equityWeight: null,
    bondWeight: null,
    cashWeight: null,
    otherWeight: null,
    duration: null,
    maturity: null,
    ratings: null,
    ...over,
  });

  it("keeps plain equity funds", () => {
    expect(isNonEquityFund(detail({ category: "Large Blend", equityWeight: 99.31, bondWeight: 0, cashWeight: 0.54 }), "Vanguard Total Stock Market ETF")).toBe(false);
    expect(isNonEquityFund(detail({ category: "Japan Stock", equityWeight: 99.59, bondWeight: 0, cashWeight: 0.41 }), "iShares MSCI Japan ETF")).toBe(false);
    expect(isNonEquityFund(detail({ category: "Derivative Income", equityWeight: 85.57, bondWeight: 0, cashWeight: 0.7 }), "JPMorgan Equity Premium Income ETF")).toBe(false);
  });

  /**
   * The trap that makes an equity-weight threshold unusable: GLD, SLV and BITO
   * all report `stockPosition: 0`, and USO/BITO hold most of their assets in
   * cash because that is how a futures-backed fund posts collateral. Excluding
   * on either signal alone would delete the entire commodity and crypto shelf.
   */
  it("keeps commodity and crypto funds that hold no stocks and lots of cash", () => {
    expect(isNonEquityFund(detail({ category: "Commodities Focused", equityWeight: 0, bondWeight: 0, cashWeight: 0 }), "SPDR Gold Shares")).toBe(false);
    // USO: 57.3% cash, verified.
    expect(isNonEquityFund(detail({ category: "Commodities Focused", equityWeight: 0, bondWeight: 0, cashWeight: 57.26 }), "United States Oil Fund")).toBe(false);
    // BITO: 67.5% cash, verified.
    expect(isNonEquityFund(detail({ category: "Digital Assets", equityWeight: 0, bondWeight: 0, cashWeight: 67.53 }), "ProShares Bitcoin Strategy ETF")).toBe(false);
    // TQQQ: 34.5% cash collateral against a leveraged equity book.
    expect(isNonEquityFund(detail({ category: "Trading--Leveraged Equity", equityWeight: 61.98, bondWeight: 2.54, cashWeight: 34.5 }), "ProShares UltraPro QQQ")).toBe(false);
  });

  it("drops bond funds, whatever their category says", () => {
    expect(isNonEquityFund(detail({ category: "Intermediate Core Bond", equityWeight: 0, bondWeight: 99.28, cashWeight: 0.73 }), "iShares Core U.S. Aggregate Bond ETF")).toBe(true);
    expect(isNonEquityFund(detail({ category: "Long Government", equityWeight: 0, bondWeight: 99.63, cashWeight: 0.37 }), "iShares 20+ Year Treasury Bond ETF")).toBe(true);
    expect(isNonEquityFund(detail({ category: "Muni National Interm", equityWeight: 0, bondWeight: 99.82, cashWeight: 0.58 }), "Fidelity Intermediate Municipal Income Fund ETF")).toBe(true);
  });

  /**
   * Regression: these three were the top three results of the "Low Volatility"
   * ETF template. A money-market fund at 0.26% annualised volatility wins a
   * volatility-weighted ranking by construction, and none of them is remotely
   * what someone screening low-volatility ETFs is asking for. Neither category
   * appears in BOND_CATEGORIES, and neither fund reports ≥70% bonds — the two
   * conditions the old filter tested.
   */
  it("drops money-market funds and maturity-dated bond ladders", () => {
    // SBIL: 31.2% bonds + 68.8% cash.
    expect(isNonEquityFund(detail({ category: "Money Market-Taxable", equityWeight: 0, bondWeight: 31.18, cashWeight: 68.82 }), "Simplify Government Money Market ETF")).toBe(true);
    // BSCQ / IBDR: 48% bonds + 52% cash, category "Target Maturity".
    expect(isNonEquityFund(detail({ category: "Target Maturity", equityWeight: 0, bondWeight: 47.99, cashWeight: 52 }), "Invesco BulletShares 2026 Corporate Bond ETF")).toBe(true);
    // BIL: 100% cash, no bond position reported at all.
    expect(isNonEquityFund(detail({ category: "Ultrashort Bond", equityWeight: 0, bondWeight: 0, cashWeight: 100 }), "SPDR Bloomberg 1-3 Month T-Bill ETF")).toBe(true);
  });

  it("drops a convertible-bond fund, and keeps preferred stock", () => {
    // ICVT is literally named "iShares Convertible Bond ETF": 0.1% stocks, 16%
    // bonds, the rest convertible paper. Neither weight trips a composition
    // rule, so the category is what catches it.
    expect(isNonEquityFund(detail({ category: "Convertibles", equityWeight: 0.14, bondWeight: 16.05, cashWeight: 2.03 }), "iShares Convertible Bond ETF")).toBe(true);
    // PFF/VRP stay: the registry already models preferred funds as the Income
    // style, and they have no other class to live in. Their bond-like volatility
    // is handled by the low-volatility template's equity floor instead.
    expect(isNonEquityFund(detail({ category: "Preferred Stock", equityWeight: 5.44, bondWeight: 0.01, cashWeight: 1.48 }), "iShares Preferred & Income Securities ETF")).toBe(false);
  });

  it("drops an allocation fund whose bond sleeve dominates it", () => {
    // FREI: 61.6% bonds against 22% equity, filed as "Miscellaneous Allocation".
    expect(isNonEquityFund(detail({ category: "Miscellaneous Allocation", equityWeight: 22, bondWeight: 61.55, cashWeight: 5.34 }), "Fidelity Real Estate Income Fund ETF")).toBe(true);
    // AOR is majority equity (60.9/38.5) and stays — it has nowhere else to live.
    expect(isNonEquityFund(detail({ category: "Global Moderate Allocation", equityWeight: 60.86, bondWeight: 38.54, cashWeight: 0.57 }), "iShares Core Growth Allocation ETF")).toBe(false);
  });

  /**
   * The failure mode that let a bond ETF into the equity universe: enrichment
   * is one HTTP call per fund and it sometimes times out, which produced an
   * all-null detail indistinguishable from "this fund holds no bonds". NXUS
   * (Nuveen International Aggregate Bond ETF) rode that ambiguity in.
   */
  it("falls back to the fund name when Yahoo returned nothing", () => {
    const unknown = detail({ available: false });
    expect(isNonEquityFund(unknown, "Nuveen International Aggregate Bond ETF")).toBe(true);
    expect(isNonEquityFund(unknown, "ProShares GENIUS Money Market ETF")).toBe(true);
    expect(isNonEquityFund(unknown, "Fidelity Intermediate Municipal Income Fund ETF")).toBe(true);
    // …but an unenriched equity fund is still an equity fund.
    expect(isNonEquityFund(unknown, "DFA US Micro Cap Portfolio ETF")).toBe(false);
    expect(isNonEquityFund(unknown, "MicroSectors FANG+ Index 3X Leveraged ETN")).toBe(false);
    // A missing detail entirely is treated the same way.
    expect(isNonEquityFund(undefined, "iShares Core U.S. Aggregate Bond ETF")).toBe(true);
    expect(isNonEquityFund(undefined, "Vanguard Total Stock Market ETF")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* REITs                                                                       */
/* -------------------------------------------------------------------------- */

function stock(overrides: Partial<StockMetrics>): StockMetrics {
  return {
    symbol: "O",
    name: "Realty Income",
    sector: "Real Estate",
    industry: "REIT - Retail",
    price: 55,
    marketCap: 50e9,
    forwardPE: null,
    evToEbitda: 18,
    fcfYield: null,
    revenueGrowthYoY: 6,
    revenueCagr3y: null,
    epsGrowthYoY: null,
    epsCagr3y: null,
    roic: null,
    roe: null,
    grossMargin: null,
    operatingMargin: null,
    debtToEquity: 0.7,
    netDebtToEbitda: 5.5,
    netDebt: null,
    currentRatio: null,
    fcfMargin: null,
    fcfGrowthYoY: null,
    dividendYield: 5.5,
    buybackYield: null,
    oneYearReturn: 3,
    distanceFrom52WkHigh: -8,
    institutionalOwnership: null,
    earningsSurprisePct: null,
    operatingCashflow: 5e9,
    ocfGrowthYoY: 4,
    scores: { overall: 60, value: 55, growth: 50, quality: 58, momentum: 52, financialHealth: 60 },
    ...overrides,
  };
}

describe("reit: FFO proxies", () => {
  it("derives P/FFO and FFO yield from operating cash flow", () => {
    const c = reitCandidate(stock({}));
    expect(c.metrics.pFfo).toBe(10); // 50e9 / 5e9
    expect(c.metrics.ffoYield).toBeCloseTo(10);
  });

  it("computes payout as the dividend's share of the FFO proxy", () => {
    // 5.5% dividend against a 10% FFO yield → 55% of cash flow paid out.
    expect(reitCandidate(stock({})).metrics.payoutRatio).toBeCloseTo(55);
  });

  it("flags an uncovered distribution", () => {
    // 12% dividend against a 10% FFO yield → paying out more than it earns.
    const c = reitCandidate(stock({ dividendYield: 12 }));
    expect(c.metrics.payoutRatio!).toBeGreaterThan(100);
  });

  it("refuses to compute a multiple on negative cash flow", () => {
    // A REIT burning cash has no meaningful P/FFO — and a negative multiple
    // would sort as "cheap", which is exactly backwards.
    const c = reitCandidate(stock({ operatingCashflow: -1e9 }));
    expect(c.metrics.pFfo).toBeNull();
    expect(c.metrics.ffoYield).toBeNull();
    expect(c.metrics.payoutRatio).toBeNull();
  });

  it("returns nulls when cash flow data is missing entirely", () => {
    const c = reitCandidate(stock({ operatingCashflow: null }));
    expect(c.metrics.pFfo).toBeNull();
  });

  /**
   * Regression: widening the REIT universe from 55 large-caps to all 237 listed
   * REITs surfaced mortgage REITs and real-estate services companies for the
   * first time, and the OCF-as-FFO proxy produced nonsense for both — a P/FFO
   * of 0.0x-2.1x, which sorted them straight to the top of a "cheap REITs"
   * screen. They own loans and run brokerages; they don't collect rent.
   */
  it("refuses to compute an FFO proxy for a mortgage REIT", () => {
    const mreit = reitCandidate(stock({ industry: "REIT - Mortgage", operatingCashflow: 25e9 }));
    expect(mreit.attributes.propertyType).toBe("Mortgage");
    // 50e9 / 25e9 = 2x would be arithmetically valid and financially meaningless.
    expect(mreit.metrics.pFfo).toBeNull();
    expect(mreit.metrics.ffoYield).toBeNull();
    expect(mreit.metrics.payoutRatio).toBeNull();
    expect(mreit.metrics.ffoGrowthYoY).toBeNull();
    // The dividend is still real, and still screenable.
    expect(mreit.metrics.dividendYield).toBe(5.5);
  });

  it("refuses to compute an FFO proxy for a real-estate services company", () => {
    const svc = reitCandidate(stock({ industry: "Real Estate Services", operatingCashflow: 40e9 }));
    expect(svc.attributes.propertyType).toBe("Real Estate Services");
    expect(svc.metrics.pFfo).toBeNull();
    expect(svc.metrics.payoutRatio).toBeNull();
  });

  it("rejects an implausible P/FFO as a broken denominator, not a bargain", () => {
    // 50e9 / 45e9 = 1.1x. No equity REIT trades at one times cash earnings;
    // the denominator is wrong.
    expect(reitCandidate(stock({ operatingCashflow: 45e9 })).metrics.pFfo).toBeNull();
    // ...and the same in the other direction (a near-zero OCF → 500x).
    expect(reitCandidate(stock({ operatingCashflow: 1e8 })).metrics.pFfo).toBeNull();
    // A normal equity REIT is untouched.
    expect(reitCandidate(stock({ operatingCashflow: 5e9 })).metrics.pFfo).toBe(10);
  });

  it("reads property type from Yahoo's industry string", () => {
    expect(reitCandidate(stock({ industry: "REIT - Retail" })).attributes.propertyType).toBe("Retail");
    expect(reitCandidate(stock({ industry: "REIT - Office" })).attributes.propertyType).toBe("Office");
    expect(reitCandidate(stock({ industry: "REIT - Hotel & Motel" })).attributes.propertyType).toBe("Hotel & Motel");
    expect(reitCandidate(stock({ industry: "REIT - Diversified" })).attributes.propertyType).toBe("Diversified");
    expect(reitCandidate(stock({ industry: null })).attributes.propertyType).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Equity (regression: the existing pipeline must be projected faithfully)     */
/* -------------------------------------------------------------------------- */

describe("equity: projection from the existing StockMetrics pipeline", () => {
  it("carries every scored metric through unchanged", () => {
    const m = stock({ sector: "Technology", industry: "Software", roic: 22, forwardPE: 18 });
    const c = equityCandidate(m);

    expect(c.symbol).toBe("O");
    expect(c.assetClass).toBe("equity");
    expect(c.metrics.roic).toBe(22);
    expect(c.metrics.forwardPE).toBe(18);
    expect(c.metrics.dividendYield).toBe(5.5);
    // Composite scores are lifted out of the nested `scores` object.
    expect(c.metrics.overallScore).toBe(60);
    expect(c.metrics.qualityScore).toBe(58);
    expect(c.attributes.sector).toBe("Technology");
  });

  it("derives PEG, and refuses to on negative growth", () => {
    expect(equityCandidate(stock({ forwardPE: 20, epsGrowthYoY: 25 })).metrics.pegRatio).toBeCloseTo(0.8);
    // A shrinking company doesn't become "cheap" by shrinking faster.
    expect(equityCandidate(stock({ forwardPE: 20, epsGrowthYoY: -10 })).metrics.pegRatio).toBeNull();
    expect(equityCandidate(stock({ forwardPE: 20, epsGrowthYoY: 0 })).metrics.pegRatio).toBeNull();
    expect(equityCandidate(stock({ forwardPE: null, epsGrowthYoY: 25 })).metrics.pegRatio).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Forex                                                                       */
/* -------------------------------------------------------------------------- */

describe("forex: carry", () => {
  it("computes carry as base rate minus quote rate", () => {
    const eurusd = getPair("EURUSD=X")!;
    // Long EURUSD earns EUR's rate and pays USD's. With USD above EUR, that's
    // negative carry — the direction people most often get backwards.
    expect(rateDifferential(eurusd)!).toBeLessThan(0);
  });

  it("computes a positive carry for a high-rate base currency", () => {
    // USDJPY: earn USD, pay JPY → positive.
    expect(rateDifferential(getPair("USDJPY=X")!)!).toBeGreaterThan(0);
  });

  it("adjusts for inflation in the real rate differential", () => {
    const usdtry = getPair("USDTRY=X")!;
    const nominal = rateDifferential(usdtry)!;
    const real = realRateDifferential(usdtry)!;
    // TRY's huge nominal rate is largely inflation; the real differential is a
    // very different (and far more informative) number.
    expect(nominal).not.toBeCloseTo(real);
  });

  it("classifies pairs by type and liquidity", () => {
    expect(getPair("EURUSD=X")!.type).toBe("Major");
    expect(getPair("EURUSD=X")!.liquidityTier).toBe(1);
    expect(getPair("USDTRY=X")!.type).toBe("Exotic");
    expect(getPair("USDTRY=X")!.liquidityTier).toBe(3);
    expect(getPair("NOPE=X")).toBeNull();
  });
});
