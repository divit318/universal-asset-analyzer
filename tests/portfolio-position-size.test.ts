import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { computePositionSizing, DEFAULT_SIZING_TRANCHES } from "@/lib/portfolio/engines/position-size";
import { DEFAULT_CONSTRAINTS, type Objective } from "@/lib/portfolio/engines/optimize";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures — same shape/convention as tests/portfolio-cash.test.ts            */
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

function ctx(overrides: Partial<MarketContext> = {}): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  return {
    baseCurrency: "USD",
    fx: { USD: 1 },
    quotes: new Map([
      ["AAPL", { symbol: "AAPL", price: 200, changePercent: 1.2, currency: "USD", name: "Apple", marketCap: 3e12 }],
      ["IEF", { symbol: "IEF", price: 95, changePercent: -0.1, currency: "USD", name: "7-10y Treasury", marketCap: null }],
    ]),
    history: new Map([
      ["AAPL", walk(300, 0.0006, 0.018, 3)],
      ["IEF", walk(300, 0.0001, 0.004, 11)],
    ]),
    fundamentals: new Map([
      ["AAPL", {
        sector: "Technology", industry: "Consumer Electronics", country: "United States", currency: "USD",
        dividendYield: 0.005, duration: null, maturity: null, creditQuality: null, expenseRatio: null,
        marketCap: 3e12, peRatio: 30, priceToBook: 45, returnOnEquity: 0.55, revenueGrowth: 0.08,
        operatingMargins: 0.30, debtToEquity: 150, operatingCashflow: 1.1e11, beta: 1.25,
      }],
      ["IEF", {
        sector: null, industry: null, country: "United States", currency: "USD",
        dividendYield: 0.035, duration: 7.4, maturity: 8.5, creditQuality: "us_government", expenseRatio: 0.15,
        marketCap: null, peRatio: null, priceToBook: null, returnOnEquity: null, revenueGrowth: null,
        operatingMargins: null, debtToEquity: null, operatingCashflow: null, beta: null,
      }],
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

/**
 * A concentrated single-stock portfolio (~85% AAPL) with idle cash — plenty of
 * room for IEF to help diversify. The cash sleeve is deliberate: under the
 * alignment engine's default policy (cash band 1–25%) a ZERO-cash book's first
 * tranche is honestly better spent topping up cash than buying anything, so a
 * cashless fixture would test the cash-starvation brake, not the diversifier.
 */
function concentrated(c: MarketContext) {
  const { holdings } = normalizeHoldings(
    [
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 200 }),
      raw({ id: "cash", assetClass: "cash", quantity: 7000, unit: "units", manualValue: 7000, costBasis: 7000 }),
    ],
    c,
  );
  return evaluate(holdings, c);
}

const OBJECTIVES_UNDER_TEST: Objective[] = ["maximize_sharpe", "minimize_volatility", "maximize_diversification"];

const IEF_TARGET = { symbol: "IEF", name: "7-10y Treasury", assetClass: "bond" as const };

describe("computePositionSizing — determinism", () => {
  it.each(OBJECTIVES_UNDER_TEST)("is deterministic for %s — identical inputs, identical recommendation", (objective) => {
    const c = ctx();
    const evaluation = concentrated(c);
    const first = computePositionSizing(evaluation, IEF_TARGET, objective, c);
    const second = computePositionSizing(evaluation, IEF_TARGET, objective, c);
    const { before: b1, after: a1, ...rest1 } = first;
    const { before: b2, after: a2, ...rest2 } = second;
    void b1; void a1; void b2; void a2;
    expect(JSON.stringify(rest2)).toBe(JSON.stringify(rest1));
  });
});

describe("computePositionSizing — recommends buying a genuine diversifier", () => {
  it("recommends a positive IEF allocation for a 100% AAPL portfolio under maximize_diversification", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computePositionSizing(evaluation, IEF_TARGET, "maximize_diversification", c);
    expect(plan.action).toBe("BUY");
    expect(plan.recommendedAmount).toBeGreaterThan(0);
    expect(plan.recommendedShares).toBeGreaterThan(0);
    expect(plan.impact.alignmentDelta).not.toBeNull();
    expect(plan.impact.alignmentDelta!).toBeGreaterThanOrEqual(0);
  });

  it("never recommends beyond the single-holding cap", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computePositionSizing(evaluation, IEF_TARGET, "maximize_diversification", c);
    expect(plan.recommendedAllocationPct).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.maxHoldingPct + 1);
  });

  it("respects a tightened maxHoldingPct", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const tight = { ...DEFAULT_CONSTRAINTS, maxHoldingPct: 3 };
    const plan = computePositionSizing(evaluation, IEF_TARGET, "maximize_diversification", c, tight);
    expect(plan.recommendedAllocationPct).toBeLessThanOrEqual(tight.maxHoldingPct + 1);
  });
});

describe("computePositionSizing — marginal benefit curve", () => {
  it("is internally consistent — cumulative curve ends at the recommended amount", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computePositionSizing(evaluation, IEF_TARGET, "maximize_diversification", c);
    expect(plan.marginalBenefit[0]).toEqual({ cumulativeAmount: 0, alignmentDelta: 0 });
    if (plan.action === "BUY") {
      const last = plan.marginalBenefit[plan.marginalBenefit.length - 1];
      expect(last.cumulativeAmount).toBeCloseTo(plan.recommendedAmount, -1);
      expect(plan.marginalBenefit.length).toBeLessThanOrEqual(DEFAULT_SIZING_TRANCHES + 1);
    }
  });

  it("produces scenarios that are monotonically ordered by amount", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computePositionSizing(evaluation, IEF_TARGET, "maximize_diversification", c);
    for (let i = 1; i < plan.scenarios.length; i++) {
      expect(plan.scenarios[i].amount).toBeGreaterThanOrEqual(plan.scenarios[i - 1].amount);
    }
    expect(plan.scenarios.some((s) => s.isRecommended)).toBe(plan.action === "BUY");
  });
});

describe("computePositionSizing — honest HOLD", () => {
  it("holds when the portfolio has no positions to measure against", () => {
    const c = ctx();
    const evaluation = evaluate([], c);
    const plan = computePositionSizing(evaluation, IEF_TARGET, "maximize_sharpe", c);
    expect(plan.action).toBe("HOLD");
    expect(plan.recommendedAmount).toBe(0);
    expect(plan.holdReason).toBeTruthy();
  });

  it("holds when already at the single-holding cap for that symbol", () => {
    const c = ctx();
    // A portfolio already 100% AAPL, recommending MORE AAPL, should hold — there is no room left under the cap.
    const evaluation = concentrated(c);
    const plan = computePositionSizing(
      evaluation,
      { symbol: "AAPL", name: "Apple", assetClass: "equity" },
      "maximize_sharpe",
      c,
    );
    expect(plan.action).toBe("HOLD");
    expect(plan.recommendedAmount).toBe(0);
  });
});

describe("computePositionSizing — value conservation", () => {
  it("the recommended buy's after-state totalValue equals before + recommendedAmount", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computePositionSizing(evaluation, IEF_TARGET, "maximize_diversification", c);
    if (plan.action === "BUY") {
      expect(plan.after.totalValue).toBeCloseTo(evaluation.totalValue + plan.recommendedAmount, -1);
    }
  });
});
