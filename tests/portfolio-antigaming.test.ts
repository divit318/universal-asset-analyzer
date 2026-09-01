/**
 * Portfolio anti-gaming suite.
 *
 * The 2026-08 $1,000 portfolio-construction exercise drove an optimizer against
 * the portfolio scores and found strategies that raise a SCORE without making
 * the PORTFOLIO better. The universal Health engine those exploits were first
 * found in has since been retired (replaced by policy-scored Alignment —
 * see tests/portfolio-alignment.test.ts), which retires the exploits that were
 * artifacts of its curves (class-breadth anchors, dimension orderings). What
 * remains are the exploits against engines that SURVIVE, encoded as economic
 * assertions so they can never silently regress:
 *
 *   1. CURRENCY MECHANICS — FX exposure must be ECONOMIC (look-through: an
 *      unhedged international fund counts at its FX pass-through, a hedged or
 *      domestic-mandate fund at zero) and venue-independent (a foreign listing
 *      and its USD ADR are the same exposure). Guarded at the risk engine
 *      (fxExposurePct) and at the Alignment exposure theme that scores it.
 *   2. YIELD-AS-QUALITY — the ETF scorer paid 30% of its weight for
 *      distribution yield, so an expensive covered-call fund tied a broad
 *      index fund; the bond scorer paid 50% for raw yield with no credit-risk
 *      context, so a junk fund outscored a Treasury fund. Yield is income,
 *      not fund quality. Guarded at the class-native holding scorers.
 */

import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { computeAllocation } from "@/lib/portfolio/engines/allocation";
import { computeRisk } from "@/lib/portfolio/engines/risk";
import { computeAlignment, type AlignmentReport } from "@/lib/portfolio/alignment/engine";
import { derivePolicy, type InvestorPolicy, type PolicyAnswers } from "@/lib/portfolio/alignment/policy";
import type { ContextFundamentals, MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures — same builders as portfolio-alignment.test.ts, extended w/ funds  */
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
      q("AAPL", 200), q("JNJ", 150),
      q("SAP.DE", 100, "EUR"),
      // The same German issuer as a USD-quoted ADR: same economics, US venue.
      q("SAPADR", 108),
      // USD-quoted developed-international equity fund (a VEA stand-in).
      q("INTLFUND", 74),
      // Cheap broad index fund vs pricey high-distribution fund.
      q("CHEAPX", 400), q("PRICEYX", 56),
      // Treasury fund vs junk fund.
      q("TSYX", 82), q("JNKX", 23),
    ]),
    history: new Map([
      ["AAPL", walk(300, 0.0006, 0.018, 3)],
      ["JNJ", walk(300, 0.0003, 0.010, 21)],
      ["SAP.DE", walk(300, 0.0004, 0.017, 29)],
      ["SAPADR", walk(300, 0.0004, 0.017, 29)],
      ["INTLFUND", walk(300, 0.0003, 0.012, 37)],
      ["CHEAPX", walk(300, 0.0004, 0.012, 43)],
      ["PRICEYX", walk(300, 0.0003, 0.011, 47)],
      ["TSYX", walk(300, 0.00005, 0.002, 53)],
      ["JNKX", walk(300, 0.0002, 0.006, 59)],
    ]),
    fundamentals: new Map<string, ContextFundamentals>([
      ["AAPL", fund({ sector: "Technology", country: "United States", dividendYield: 0.005, marketCap: 3e12, peRatio: 30, returnOnEquity: 0.55, revenueGrowth: 0.08, operatingMargins: 0.3, debtToEquity: 150, beta: 1.25, priceToBook: 45 })],
      ["JNJ", fund({ sector: "Healthcare", country: "United States", dividendYield: 0.03, marketCap: 4e11, peRatio: 15, returnOnEquity: 0.25, revenueGrowth: 0.04, operatingMargins: 0.25, debtToEquity: 45, beta: 0.6, priceToBook: 5 })],
      ["SAP.DE", fund({ sector: "Technology", country: "Germany", currency: "EUR", dividendYield: 0.015, marketCap: 2e11, peRatio: 25, returnOnEquity: 0.18, revenueGrowth: 0.09, operatingMargins: 0.28, debtToEquity: 40, beta: 1.0, priceToBook: 4 })],
      ["SAPADR", fund({ sector: "Technology", country: "Germany", currency: "USD", dividendYield: 0.015, marketCap: 2e11, peRatio: 25, returnOnEquity: 0.18, revenueGrowth: 0.09, operatingMargins: 0.28, debtToEquity: 40, beta: 1.0, priceToBook: 4 })],
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
  return { holdings, totalValue, alloc, risk };
}

const fxOf = (rs: RawHolding[], c: MarketContext = ctx()): number => evalOf(rs, c).risk.fxExposurePct;

const answers = (over: Partial<PolicyAnswers>): PolicyAnswers => ({
  goal: "balanced", horizon: "medium", drawdown: "moderate", concentration: "focused",
  liquidity: "buffer", income: "no", inflation: "no", exposure: "home", ...over,
});

function alignmentOf(rs: RawHolding[], policy: InvestorPolicy, c: MarketContext = ctx()): AlignmentReport {
  const { holdings, totalValue, alloc, risk } = evalOf(rs, c);
  return computeAlignment(holdings, totalValue, alloc, risk, policy);
}

const themeScore = (r: AlignmentReport, id: string): number | null =>
  r.themes.find((t) => t.id === id)?.score ?? null;

/* -------------------------------------------------------------------------- */
/* 1. FX exposure is economic and venue-independent                            */
/* -------------------------------------------------------------------------- */

describe("anti-gaming — FX exposure is economic, not denominational", () => {
  it("a USD-quoted unhedged international fund carries FX exposure (look-through)", () => {
    const domestic = fxOf([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "equity", symbol: "JNJ", quantity: 100 }),
    ]);
    const withIntl = fxOf([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "i", assetClass: "etf", symbol: "INTLFUND", quantity: 70 }),
    ]);
    expect(domestic).toBeCloseTo(0, 0);
    expect(withIntl).toBeGreaterThan(10);
  });

  it("a foreign LISTING and its USD ADR carry the same FX exposure (no venue arbitrage)", () => {
    // Identical issuer (Germany), identical value; only the quote currency differs.
    const listing = fxOf([
      raw({ id: "us", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "de", assetClass: "equity", symbol: "SAP.DE", quantity: 185, currency: "EUR" }),
    ]);
    const adr = fxOf([
      raw({ id: "us", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "de", assetClass: "equity", symbol: "SAPADR", quantity: 185 }),
    ]);
    expect(Math.abs(listing - adr)).toBeLessThan(3);
  });

  it("a domestic-mandate fund carries no FX exposure", () => {
    const usFund = fxOf([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "f", assetClass: "etf", symbol: "CHEAPX", quantity: 13 }),
    ]);
    expect(usFund).toBeCloseTo(0, 0);
  });

  it("the Alignment exposure theme scores the economic measure, so venue arbitrage buys nothing", () => {
    const global = derivePolicy(answers({ exposure: "global" }));
    const s = (rs: RawHolding[]) => themeScore(alignmentOf(rs, global), "exposure");
    const listing = s([
      raw({ id: "us", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "de", assetClass: "equity", symbol: "SAP.DE", quantity: 185, currency: "EUR" }),
    ]);
    const adr = s([
      raw({ id: "us", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "de", assetClass: "equity", symbol: "SAPADR", quantity: 185 }),
    ]);
    expect(listing).not.toBeNull();
    expect(adr).not.toBeNull();
    expect(Math.abs(listing! - adr!)).toBeLessThan(3);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Yield is income, not quality                                             */
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
});
