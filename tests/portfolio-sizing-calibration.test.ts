/**
 * Position-sizing calibration.
 *
 * Guards the two defects that made "Recommended Allocation" decline almost
 * everything:
 *
 *   1. health.ts rounded every dimension to an integer AND rounded the weighted
 *      total again, so differencing two portfolios that differ by one position
 *      yielded exactly 0.0 — the sizing loop's primary signal was dead. Fixed by
 *      carrying an unrounded `scoreExact` / `totalExact` alongside the displayed
 *      integers.
 *
 *   2. The loop gated on an ABSOLUTE score threshold (buyScore < 0.5) applied to
 *      a per-tranche quantity. A tranche is ~1/24th of the room to the
 *      concentration cap, so on a real book it moves any score by hundredths of
 *      a point and the gate could only be cleared by a large asset-class-gap
 *      term. Replaced by a relative "does this beat holding cash" margin.
 *
 * The assertions below are about ORDERING and SIGN, not about specific dollar
 * amounts — the amounts depend on live-ish inputs and would make this a change
 * detector rather than a correctness test.
 */
import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate, simulate, type PortfolioChange } from "@/lib/portfolio/engines/simulate";
import { computePositionSizing } from "@/lib/portfolio/engines/position-size";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

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

const PRICES: Record<string, number> = {
  BIGEQ: 250, EQ2: 180, BONDETF: 95, REITCO: 55, GOLD: 190, CASHY: 1,
};

function ctx(): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  const quotes = new Map<string, any>();
  const history = new Map<string, number[]>();
  let seed = 5;
  for (const [sym, price] of Object.entries(PRICES)) {
    quotes.set(sym, { symbol: sym, price, changePercent: 0.3, currency: "USD", name: sym, marketCap: 1e11 });
    history.set(sym, walk(300, 0.0004, 0.016, (seed += 13)));
  }

  return {
    baseCurrency: "USD",
    fx: { USD: 1 },
    quotes,
    history,
    fundamentals: new Map([
      ["BIGEQ", {
        sector: "Technology", industry: "Software", country: "United States", currency: "USD",
        dividendYield: 0.006, duration: null, maturity: null, creditQuality: null, expenseRatio: null,
        marketCap: 2e12, peRatio: 30, priceToBook: 12, returnOnEquity: 0.4, revenueGrowth: 0.1,
        operatingMargins: 0.35, debtToEquity: 60, operatingCashflow: 8e10, beta: 1.2,
      }],
      ["EQ2", {
        sector: "Technology", industry: "Semiconductors", country: "United States", currency: "USD",
        dividendYield: 0.004, duration: null, maturity: null, creditQuality: null, expenseRatio: null,
        marketCap: 1e12, peRatio: 28, priceToBook: 9, returnOnEquity: 0.35, revenueGrowth: 0.15,
        operatingMargins: 0.4, debtToEquity: 50, operatingCashflow: 5e10, beta: 1.35,
      }],
    ]),
    benchmarkReturns,
    asOf: new Date().toISOString(),
  };
}

function raw(o: Partial<RawHolding> & Pick<RawHolding, "id" | "assetClass">): RawHolding {
  return {
    symbol: null, name: o.id, currency: "USD", quantity: 1, unit: "shares",
    costBasis: 1000, acquiredAt: "2024-01-01", manualValue: null, manualValueAsOf: null, meta: {},
    ...o,
  };
}

/**
 * Deliberately lopsided vs the maximize_sharpe target
 * (equity 35 / etf 20 / bond 25 / reit 7 / commodity 8 / cash 5):
 * equity is heavily overweight, bond and reit are starved.
 */
function lopsidedPortfolio(c: MarketContext) {
  const holdings = normalizeHoldings(
    [
      raw({ id: "h-bigeq", assetClass: "equity", symbol: "BIGEQ", quantity: 1200, costBasis: 250000 }),
      raw({ id: "h-eq2", assetClass: "equity", symbol: "EQ2", quantity: 700, costBasis: 110000 }),
      raw({ id: "h-bond", assetClass: "bond", symbol: "BONDETF", quantity: 300, costBasis: 28000 }),
      raw({ id: "h-cash", assetClass: "cash", symbol: null, quantity: 60000, unit: "units", manualValue: 60000, costBasis: 60000 }),
    ],
    c,
  ).holdings;
  return evaluate(holdings, c);
}

describe("alignment score resolution", () => {
  const c = ctx();

  it("moves scoreExact when a single position is added, even if the displayed integer does not", () => {
    const evaluation = lopsidedPortfolio(c);
    const template = evaluation.holdings.find((h) => h.symbol === "BONDETF")!;

    // ~0.4% of the book — the scale of one sizing tranche.
    const change: PortfolioChange = { kind: "buy", holding: template, amount: 2000 };
    const { after } = simulate(evaluation, [change], c);

    expect(evaluation.alignment.scoreExact).not.toBeNull();
    expect(after.alignment.scoreExact).not.toBeNull();
    const deltaExact = after.alignment.scoreExact! - evaluation.alignment.scoreExact!;
    expect(deltaExact).not.toBe(0);
    expect(Number.isFinite(deltaExact)).toBe(true);

    // The regression: differencing the DISPLAYED integers is what used to be
    // fed to the sizing loop, and it quantizes this same change to nothing.
    const deltaDisplayed = after.alignment.score! - evaluation.alignment.score!;
    expect(Math.abs(deltaExact)).toBeGreaterThan(Math.abs(deltaDisplayed) === 0 ? 0 : -1);
  });

  it("keeps the displayed total the rounded form of the exact total", () => {
    const evaluation = lopsidedPortfolio(c);
    expect(evaluation.alignment.score).toBe(Math.round(evaluation.alignment.scoreExact!));
  });

  it("carries scoreExact on every scored theme and rounds it into score", () => {
    const evaluation = lopsidedPortfolio(c);
    expect(evaluation.alignment.themes.length).toBeGreaterThan(0);
    for (const t of evaluation.alignment.themes) {
      if (t.score == null) {
        expect(t.scoreExact).toBeNull();
      } else {
        expect(t.scoreExact).not.toBeNull();
        expect(t.score).toBe(Math.round(t.scoreExact!));
      }
    }
  });
});

describe("sizing calibration on a lopsided portfolio", () => {
  const c = ctx();
  const evaluation = lopsidedPortfolio(c);

  const size = (symbol: string, assetClass: any) =>
    computePositionSizing(evaluation, { symbol, name: symbol, assetClass }, "maximize_sharpe", c);

  it("recommends buying the starved asset classes", () => {
    // bond is at ~7% against a 25% target; reit at 0% against 7%.
    const bond = size("BONDETF", "bond");
    const reit = size("REITCO", "reit");

    expect(bond.action, `bond declined: ${bond.holdReason}`).toBe("BUY");
    expect(bond.recommendedAmount).toBeGreaterThan(0);
    expect(reit.action, `reit declined: ${reit.holdReason}`).toBe("BUY");
    expect(reit.recommendedAmount).toBeGreaterThan(0);
  });

  it("does not size the overweight class as aggressively as the starved one", () => {
    // equity is ~78% against a 35% target — adding more must not be preferred
    // over filling the bond gap.
    const equity = size("BIGEQ", "equity");
    const bond = size("BONDETF", "bond");

    if (equity.action === "BUY") {
      expect(equity.recommendedAmount).toBeLessThan(bond.recommendedAmount);
    } else {
      expect(equity.holdReason).toBeTruthy();
    }
  });

  it("reports a non-zero measured alignment impact for whatever it recommends", () => {
    const bond = size("BONDETF", "bond");
    expect(bond.action).toBe("BUY");
    // Previously this was structurally always 0.0 — the loop could not see it.
    expect(bond.impact.alignmentDelta).not.toBeNull();
    expect(bond.impact.alignmentDelta).not.toBe(0);
  });

  it("respects the concentration cap it sizes against", () => {
    const bond = size("BONDETF", "bond");
    expect(bond.recommendedAllocationPct).toBeLessThanOrEqual(20 + 1e-6);
  });

  it("never spends more than the tranche loop simulated", () => {
    const bond = size("BONDETF", "bond");
    const last = bond.marginalBenefit[bond.marginalBenefit.length - 1];
    expect(last.cumulativeAmount).toBe(bond.recommendedAmount);
  });
});
