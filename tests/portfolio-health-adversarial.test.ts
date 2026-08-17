/**
 * Portfolio Health — anti-gaming suite.
 *
 * The 2026-08 $1,000 portfolio-construction exercise drove an optimizer against
 * the health score and found strategies that raise the SCORE without making the
 * PORTFOLIO better. Each describe-block below encodes one of those exploits (or
 * a distortion found while auditing them) as an economic assertion, so the
 * score can never silently regress into rewarding it again:
 *
 *   1. CLASS-BREADTH DUST — ~$25 of a 7th asset class bought a full breadth
 *      step in Asset Allocation. Breadth must be measured in EFFECTIVE classes
 *      (1/Σp², the same anti-dust measure Diversification already uses), so a
 *      token sleeve earns only its marginal contribution.
 *   2. CURRENCY MECHANICS — the dimension read quote currency only, so a
 *      USD-quoted international fund (VEA) earned nothing while a foreign
 *      LISTING of the same economic exposure earned full credit; and the
 *      linear 1.8×pct ramp paid a fixed bounty per FX point up to a 25% cap.
 *      Currency exposure must be ECONOMIC (the same FX_PASS_THROUGH the stress
 *      tests use), venue-independent, and concave.
 *   3. YIELD-AS-QUALITY — the ETF scorer paid 30% of its weight for
 *      distribution yield, so an expensive covered-call fund tied a broad
 *      index fund; the bond scorer paid 50% for raw yield with no credit-risk
 *      context, so a junk fund outscored a Treasury fund. Yield is income (the
 *      Income dimension's job), not fund quality.
 *
 * Plus pathological-portfolio orderings that must stay economically sensible
 * regardless of implementation (single-class books, correlated duplicates,
 * fragmentation).
 */

import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { computeAllocation } from "@/lib/portfolio/engines/allocation";
import { computeRisk } from "@/lib/portfolio/engines/risk";
import { computeHealth, type HealthScore } from "@/lib/portfolio/engines/health";
import type { ContextFundamentals, MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures — same builders as portfolio-health.test.ts, extended with funds   */
/* -------------------------------------------------------------------------- */

function walk(n: number, drift: number, vol: number, seed = 1): number[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  const out = [100];
  for (let i = 1; i < n; i++) out.push(Math.max(out[i - 1] * (1 + drift + rnd() * vol), 1));
  return out;
}

function fund(o: Partial<ContextFundamentals>): ContextFundamentals {
  return {
    sector: null, industry: null, country: null, currency: "USD",
    dividendYield: null, duration: null, maturity: null, creditQuality: null,
    expenseRatio: null, marketCap: null, peRatio: null, priceToBook: null,
    returnOnEquity: null, revenueGrowth: null, operatingMargins: null,
    debtToEquity: null, operatingCashflow: null, beta: null, ...o,
  };
}

const q = (symbol: string, price: number, currency = "USD") =>
  [symbol, { symbol, price, changePercent: 0.5, currency, name: symbol, marketCap: 1e11 }] as const;

function ctx(overrides: Partial<MarketContext> = {}): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  return {
    baseCurrency: "USD",
    fx: { USD: 1, EUR: 1.08, JPY: 0.0067 },
    quotes: new Map([
      q("AAPL", 200), q("MSFT", 400), q("JNJ", 150), q("XOM", 110), q("JPM", 190),
      q("SAP.DE", 100, "EUR"),
      // The same German issuer as a USD-quoted ADR: same economics, US venue.
      q("SAPADR", 108),
      q("IEF", 95), q("GLD", 190), q("BTC-USD", 60000), q("VNQ", 85),
      // USD-quoted developed-international equity fund (a VEA stand-in).
      q("INTLFUND", 74),
      // Cheap broad index fund vs pricey high-distribution fund.
      q("CHEAPX", 400), q("PRICEYX", 56),
      // Treasury fund vs junk fund.
      q("TSYX", 82), q("JNKX", 23),
    ]),
    history: new Map([
      ["AAPL", walk(300, 0.0006, 0.018, 3)],
      ["MSFT", walk(300, 0.0005, 0.016, 5)],
      ["JNJ", walk(300, 0.0003, 0.010, 21)],
      ["XOM", walk(300, 0.0002, 0.014, 23)],
      ["JPM", walk(300, 0.0004, 0.015, 27)],
      ["SAP.DE", walk(300, 0.0004, 0.017, 29)],
      ["SAPADR", walk(300, 0.0004, 0.017, 29)],
      ["IEF", walk(300, 0.0001, 0.004, 11)],
      ["GLD", walk(300, 0.0002, 0.009, 13)],
      ["BTC-USD", walk(300, 0.001, 0.045, 17)],
      ["VNQ", walk(300, 0.0003, 0.013, 31)],
      ["INTLFUND", walk(300, 0.0003, 0.012, 37)],
      ["CHEAPX", walk(300, 0.0004, 0.012, 43)],
      ["PRICEYX", walk(300, 0.0003, 0.011, 47)],
      ["TSYX", walk(300, 0.00005, 0.002, 53)],
      ["JNKX", walk(300, 0.0002, 0.006, 59)],
    ]),
    fundamentals: new Map<string, ContextFundamentals>([
      ["AAPL", fund({ sector: "Technology", country: "United States", dividendYield: 0.005, marketCap: 3e12, peRatio: 30, returnOnEquity: 0.55, revenueGrowth: 0.08, operatingMargins: 0.3, debtToEquity: 150, beta: 1.25, priceToBook: 45 })],
      ["MSFT", fund({ sector: "Technology", country: "United States", dividendYield: 0.007, marketCap: 3e12, peRatio: 32, returnOnEquity: 0.4, revenueGrowth: 0.12, operatingMargins: 0.42, debtToEquity: 60, beta: 0.9, priceToBook: 14 })],
      ["JNJ", fund({ sector: "Healthcare", country: "United States", dividendYield: 0.03, marketCap: 4e11, peRatio: 15, returnOnEquity: 0.25, revenueGrowth: 0.04, operatingMargins: 0.25, debtToEquity: 45, beta: 0.6, priceToBook: 5 })],
      ["XOM", fund({ sector: "Energy", country: "United States", dividendYield: 0.035, marketCap: 4e11, peRatio: 12, returnOnEquity: 0.2, revenueGrowth: 0.03, operatingMargins: 0.15, debtToEquity: 20, beta: 0.85, priceToBook: 2 })],
      ["JPM", fund({ sector: "Financials", country: "United States", dividendYield: 0.025, marketCap: 5e11, peRatio: 11, returnOnEquity: 0.16, revenueGrowth: 0.06, operatingMargins: 0.35, debtToEquity: 120, beta: 1.1, priceToBook: 1.8 })],
      ["SAP.DE", fund({ sector: "Technology", country: "Germany", currency: "EUR", dividendYield: 0.015, marketCap: 2e11, peRatio: 25, returnOnEquity: 0.18, revenueGrowth: 0.09, operatingMargins: 0.28, debtToEquity: 40, beta: 1.0, priceToBook: 4 })],
      ["SAPADR", fund({ sector: "Technology", country: "Germany", currency: "USD", dividendYield: 0.015, marketCap: 2e11, peRatio: 25, returnOnEquity: 0.18, revenueGrowth: 0.09, operatingMargins: 0.28, debtToEquity: 40, beta: 1.0, priceToBook: 4 })],
      ["IEF", fund({ country: "United States", dividendYield: 0.035, duration: 7.4, maturity: 8.5, creditQuality: "us_government", expenseRatio: 0.15 })],
      ["VNQ", fund({ sector: "Real Estate", country: "United States", dividendYield: 0.04, marketCap: 3e10, peRatio: 35, returnOnEquity: 0.08, priceToBook: 2.2 })],
      // Unhedged developed-international equity fund: USD-quoted, foreign mandate.
      ["INTLFUND", fund({ fundCategory: "Foreign Large Blend", equityWeight: 99, expenseRatio: 0.05, dividendYield: 0.028 })],
      // ETF quality pair: a 0.03% broad index fund vs a 0.35% high-distribution fund.
      ["CHEAPX", fund({ fundCategory: "Large Blend", equityWeight: 99, expenseRatio: 0.03, dividendYield: 0.013 })],
      ["PRICEYX", fund({ fundCategory: "Large Value", equityWeight: 99, expenseRatio: 0.35, dividendYield: 0.08 })],
      // Bond quality pair: short Treasuries vs junk, both cheap.
      ["TSYX", fund({ fundCategory: "Short Government", bondWeight: 98, creditQuality: "us_government", expenseRatio: 0.09, dividendYield: 0.042 })],
      ["JNKX", fund({ fundCategory: "High Yield Bond", bondWeight: 97, creditQuality: "b", expenseRatio: 0.05, dividendYield: 0.073 })],
    ]),
    benchmarkReturns,
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function raw(o: Partial<RawHolding> & Pick<RawHolding, "id" | "assetClass">): RawHolding {
  return {
    symbol: null, name: o.id, currency: "USD", quantity: 1, unit: "shares",
    costBasis: 1000, acquiredAt: "2024-01-01", manualValue: null, manualValueAsOf: null, meta: {},
    ...o,
  };
}

function evalOf(rs: RawHolding[], c: MarketContext = ctx()) {
  const { holdings, totalValue } = normalizeHoldings(rs, c);
  const alloc = computeAllocation(holdings, totalValue);
  const risk = computeRisk(holdings, totalValue, alloc, c);
  return { holdings, totalValue, alloc, risk, health: computeHealth(holdings, totalValue, alloc, risk) };
}

const healthOf = (rs: RawHolding[], c: MarketContext = ctx()): HealthScore => evalOf(rs, c).health;
const dimScore = (h: HealthScore, name: string) => h.dimensions.find((d) => d.name === name)?.scoreExact ?? null;

/* -------------------------------------------------------------------------- */
/* 1. Asset-class breadth cannot be bought with dust                           */
/* -------------------------------------------------------------------------- */

describe("anti-gaming — class breadth is effective, not a raw class count", () => {
  // A real three-class core (~$100k): equities + bonds + cash.
  const core = () => [
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 200 }),
    raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 150 }),
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 300 }),
    raw({ id: "cash", assetClass: "cash", quantity: 9_000, unit: "currency" }),
  ];
  // The same book plus three DUST sleeves (~0.2% each) in new classes.
  const dusted = () => [
    ...core(),
    raw({ id: "gld", assetClass: "commodity", symbol: "GLD", quantity: 1, costBasis: 190 }),
    raw({ id: "btc", assetClass: "crypto", symbol: "BTC-USD", quantity: 0.003, unit: "coins", costBasis: 180 }),
    raw({ id: "vnq", assetClass: "reit", symbol: "VNQ", quantity: 2, costBasis: 170 }),
  ];
  // The same book with the same three classes at MEANINGFUL weight (~8% each).
  const meaningful = () => [
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 150 }),
    raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 120 }),
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 250 }),
    raw({ id: "cash", assetClass: "cash", quantity: 9_000, unit: "currency" }),
    raw({ id: "gld", assetClass: "commodity", symbol: "GLD", quantity: 42 }),
    raw({ id: "btc", assetClass: "crypto", symbol: "BTC-USD", quantity: 0.13, unit: "coins" }),
    raw({ id: "vnq", assetClass: "reit", symbol: "VNQ", quantity: 94 }),
  ];

  it("three ~0.2% dust sleeves buy almost no Asset Allocation score", () => {
    const a = dimScore(healthOf(core()), "Asset Allocation")!;
    const b = dimScore(healthOf(dusted()), "Asset Allocation")!;
    // Raw-count breadth paid ~+15 total for these three token positions.
    expect(b - a).toBeLessThan(8);
  });

  it("the same classes at meaningful weight ARE rewarded, and far more than dust", () => {
    const coreScore = dimScore(healthOf(core()), "Asset Allocation")!;
    const dustGain = dimScore(healthOf(dusted()), "Asset Allocation")! - coreScore;
    const realGain = dimScore(healthOf(meaningful()), "Asset Allocation")! - coreScore;
    expect(realGain).toBeGreaterThan(10);
    expect(realGain).toBeGreaterThan(dustGain * 3);
  });

  it("equal-weight class counts keep their historical anchor scores (backward compatibility)", () => {
    // N equal classes → effective count = N → the pre-fix anchor table applies
    // unchanged. Verified for the 1-class book (anchor 20 breadth, balance 4).
    const one = healthOf([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })]);
    expect(dimScore(one, "Asset Allocation")!).toBeCloseTo(0.5 * 20 + 0.5 * 4, 0);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Currency diversification is economic and venue-independent               */
/* -------------------------------------------------------------------------- */

describe("anti-gaming — currency diversification", () => {
  it("a USD-quoted unhedged international fund earns FX credit (look-through)", () => {
    const domestic = healthOf([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "equity", symbol: "JNJ", quantity: 100 }),
    ]);
    const withIntl = healthOf([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "i", assetClass: "etf", symbol: "INTLFUND", quantity: 70 }),
    ]);
    expect(dimScore(withIntl, "Currency Diversification")!).toBeGreaterThan(
      dimScore(domestic, "Currency Diversification")! + 5,
    );
  });

  it("a foreign LISTING and its USD ADR score the same (no venue arbitrage)", () => {
    // Identical issuer (Germany), identical value; only the quote currency differs.
    const listing = healthOf([
      raw({ id: "us", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "de", assetClass: "equity", symbol: "SAP.DE", quantity: 185, currency: "EUR" }),
    ]);
    const adr = healthOf([
      raw({ id: "us", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "de", assetClass: "equity", symbol: "SAPADR", quantity: 185 }),
    ]);
    const a = dimScore(listing, "Currency Diversification")!;
    const b = dimScore(adr, "Currency Diversification")!;
    expect(Math.abs(a - b)).toBeLessThan(3);
  });

  it("FX credit is concave: the first 15 points of exposure buy more than the next 15", () => {
    // ~15% vs ~30% foreign via the EUR listing at two sizes.
    const at = (eurShares: number) =>
      dimScore(
        healthOf([
          raw({ id: "us", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
          raw({ id: "de", assetClass: "equity", symbol: "SAP.DE", quantity: eurShares, currency: "EUR" }),
        ]),
        "Currency Diversification",
      )!;
    const none = dimScore(
      healthOf([raw({ id: "us", assetClass: "equity", symbol: "AAPL", quantity: 100 })]),
      "Currency Diversification",
    )!;
    const g1 = at(33) - none;   // ≈0% → ~15% of book in EUR
    const g2 = at(92) - at(33); // ~15% → ~33%
    expect(g1).toBeGreaterThan(0);
    expect(g1).toBeGreaterThan(g2);
  });

  it("a hedged/domestic-mandate fund earns no FX credit", () => {
    const usFund = healthOf([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "f", assetClass: "etf", symbol: "CHEAPX", quantity: 13 }),
    ]);
    // US broad-equity fund → no foreign exposure → the home-currency floor.
    expect(dimScore(usFund, "Currency Diversification")!).toBeCloseTo(55, 0);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Yield is income, not quality                                             */
/* -------------------------------------------------------------------------- */

describe("anti-gaming — holding quality does not pay twice for yield", () => {
  it("a 0.03% broad index fund clearly outscores a 0.35% high-distribution fund", () => {
    const { holdings } = evalOf([
      raw({ id: "cheap", assetClass: "etf", symbol: "CHEAPX", quantity: 10 }),
      raw({ id: "pricey", assetClass: "etf", symbol: "PRICEYX", quantity: 70 }),
    ]);
    const cheap = holdings.find((h) => h.symbol === "CHEAPX")!.score!;
    const pricey = holdings.find((h) => h.symbol === "PRICEYX")!.score!;
    // Under the 30%-yield-leg scorer these tied (≈78 vs ≈77): an 11x-more-
    // expensive fund matched a broad index fund by paying out distributions.
    expect(cheap.score).toBeGreaterThan(pricey.score + 15);
  });

  it("a Treasury fund is not out-scored by a junk fund on raw yield", () => {
    const { holdings } = evalOf([
      raw({ id: "tsy", assetClass: "bond", symbol: "TSYX", quantity: 100 }),
      raw({ id: "jnk", assetClass: "bond", symbol: "JNKX", quantity: 350 }),
    ]);
    const tsy = holdings.find((h) => h.symbol === "TSYX")!.score!;
    const jnk = holdings.find((h) => h.symbol === "JNKX")!.score!;
    // Junk yield is compensation for credit risk, not free quality. With the
    // credit-quality leg the Treasury fund must at least match the junk fund.
    expect(tsy.score).toBeGreaterThanOrEqual(jnk.score);
  });

  it("higher yield still helps the portfolio through the INCOME dimension", () => {
    const junkBook = healthOf([raw({ id: "j", assetClass: "bond", symbol: "JNKX", quantity: 400 })]);
    const tsyBook = healthOf([raw({ id: "t", assetClass: "bond", symbol: "TSYX", quantity: 110 })]);
    expect(dimScore(junkBook, "Income")!).toBeGreaterThan(dimScore(tsyBook, "Income")!);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Pathological portfolios stay ordered sensibly                            */
/* -------------------------------------------------------------------------- */

describe("anti-gaming — pathological portfolio orderings", () => {
  const balanced = () => [
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
    raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 100 }),
    raw({ id: "sap", assetClass: "equity", symbol: "SAP.DE", quantity: 100, currency: "EUR" }),
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 250 }),
    raw({ id: "gld", assetClass: "commodity", symbol: "GLD", quantity: 60 }),
    raw({ id: "vnq", assetClass: "reit", symbol: "VNQ", quantity: 90 }),
    raw({ id: "cash", assetClass: "cash", quantity: 8_000, unit: "currency" }),
  ];

  it("every 100%-single-class book scores below the diversified multi-asset book", () => {
    const diversified = healthOf(balanced()).total;
    const singles: RawHolding[][] = [
      [raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })],
      [raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 })],
      [raw({ id: "g", assetClass: "commodity", symbol: "GLD", quantity: 100 })],
      [raw({ id: "c", assetClass: "crypto", symbol: "BTC-USD", quantity: 1, unit: "coins" })],
      [raw({ id: "x", assetClass: "cash", quantity: 100_000, unit: "currency" })],
    ];
    for (const s of singles) {
      expect(healthOf(s).total).toBeLessThan(diversified);
    }
  });

  it("five highly-correlated names score worse on Correlation than five independent ones", () => {
    // Five copies of the same walk = pairwise correlation ≈ 1.
    const dupSeries = walk(300, 0.0005, 0.015, 99);
    const c = ctx({
      quotes: new Map([q("D1", 100), q("D2", 100), q("D3", 100), q("D4", 100), q("D5", 100)]),
      history: new Map([
        ["D1", dupSeries], ["D2", [...dupSeries]], ["D3", [...dupSeries]],
        ["D4", [...dupSeries]], ["D5", [...dupSeries]],
      ]),
      fundamentals: new Map(),
    });
    const dupes = healthOf(
      ["D1", "D2", "D3", "D4", "D5"].map((s, i) =>
        raw({ id: `d${i}`, assetClass: "equity", symbol: s, quantity: 10 })),
      c,
    );
    const independent = healthOf([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 10 }),
      raw({ id: "b", assetClass: "equity", symbol: "MSFT", quantity: 5 }),
      raw({ id: "c", assetClass: "equity", symbol: "JNJ", quantity: 13 }),
      raw({ id: "d", assetClass: "equity", symbol: "XOM", quantity: 18 }),
      raw({ id: "e", assetClass: "equity", symbol: "JPM", quantity: 10 }),
    ]);
    expect(dimScore(dupes, "Correlation")!).toBeLessThan(dimScore(independent, "Correlation")!);
  });

  it("fragmenting one position into 14 dust positions does not lift Diversification materially", () => {
    const single = healthOf([raw({ id: "big", assetClass: "equity", symbol: "AAPL", quantity: 1000 })]);
    const fragmented = healthOf([
      raw({ id: "big", assetClass: "equity", symbol: "AAPL", quantity: 1000 }),
      ...Array.from({ length: 14 }, (_, i) =>
        raw({ id: `dust${i}`, assetClass: "equity", symbol: "JNJ", quantity: 0.001, costBasis: 0.1 })),
    ]);
    expect(dimScore(fragmented, "Diversification")! - dimScore(single, "Diversification")!).toBeLessThan(15);
  });
});
