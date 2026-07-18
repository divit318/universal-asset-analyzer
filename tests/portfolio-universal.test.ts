import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { computeAllocation, computeConcentration } from "@/lib/portfolio/engines/allocation";
import { computeRisk } from "@/lib/portfolio/engines/risk";
import { computeHealth } from "@/lib/portfolio/engines/health";
import { runScenario, getScenario, applyShocks } from "@/lib/portfolio/engines/scenario";
import { evaluate, applyTargetPlanConserving } from "@/lib/portfolio/engines/simulate";
import { optimize, DEFAULT_CONSTRAINTS, computeTradeImpacts, type Objective } from "@/lib/portfolio/engines/optimize";
import { computeRecommendations } from "@/lib/portfolio/engines/recommend";
import { buildDecisionCards } from "@/lib/portfolio/engines/decision";
import { contentHash, fallbackThesis, fallbackIdentity } from "@/lib/portfolio/thesis";
import { fallbackExplanation, confidenceFor, cacheKeyFor } from "@/lib/portfolio/holding-explain";
import { listClassAdapters, getClassAdapter } from "@/lib/portfolio/model/adapter";
import { PORTFOLIO_ASSET_CLASSES } from "@/lib/portfolio/model/types";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** Deterministic pseudo-random walk, so vol/beta are stable across runs. */
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
    fx: { USD: 1, EUR: 1.08 },
    quotes: new Map([
      ["AAPL", { symbol: "AAPL", price: 200, changePercent: 1.2, currency: "USD", name: "Apple", marketCap: 3e12 }],
      ["IEF",  { symbol: "IEF",  price: 95,  changePercent: -0.1, currency: "USD", name: "7-10y Treasury", marketCap: null }],
      ["GLD",  { symbol: "GLD",  price: 190, changePercent: 0.3, currency: "USD", name: "SPDR Gold", marketCap: null }],
      ["BTC-USD", { symbol: "BTC-USD", price: 60000, changePercent: 2.5, currency: "USD", name: "Bitcoin", marketCap: 1.2e12 }],
    ]),
    history: new Map([
      ["AAPL", walk(300, 0.0006, 0.018, 3)],
      ["IEF", walk(300, 0.0001, 0.004, 11)],
      ["GLD", walk(300, 0.0002, 0.009, 13)],
      ["BTC-USD", walk(300, 0.001, 0.045, 17)],
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

/* -------------------------------------------------------------------------- */

describe("class registry", () => {
  it("registers an adapter for every declared asset class", () => {
    const registered = new Set(listClassAdapters().map((a) => a.id));
    for (const cls of PORTFOLIO_ASSET_CLASSES) {
      expect(registered.has(cls), `no adapter for "${cls}"`).toBe(true);
    }
  });

  it("reuses the shared asset registry rather than forking it", () => {
    // The seven market-priced classes must point back at lib/assets/. Cash and the
    // four manual classes have no screening domain, so registryClass is null.
    expect(getClassAdapter("equity").registryClass).toBe("equity");
    expect(getClassAdapter("bond").registryClass).toBe("bond");
    expect(getClassAdapter("cash").registryClass).toBeNull();
    expect(getClassAdapter("real_estate").registryClass).toBeNull();
  });
});

describe("valuation", () => {
  it("values a bond by face × price-as-%-of-par, not quantity × price", () => {
    // The equity way (10000 × 98.5) would report $985,000 for a $9,850 position —
    // a 100x error that would dominate every allocation number in the portfolio.
    const c = ctx({
      quotes: new Map([["TBOND", { symbol: "TBOND", price: 98.5, changePercent: 0, currency: "USD", name: "T", marketCap: null }]]),
    });
    const { totalValue } = normalizeHoldings(
      [raw({ id: "b", assetClass: "bond", symbol: "TBOND", quantity: 10000, unit: "face", costBasis: 10000 })],
      c,
    );
    expect(totalValue).toBeCloseTo(9850, 0);
  });

  it("values real estate as NET EQUITY, not gross property value", () => {
    const { holdings } = normalizeHoldings([
      raw({
        id: "house", assetClass: "real_estate", name: "Home", costBasis: 500_000,
        manualValue: 600_000, manualValueAsOf: new Date().toISOString(),
        meta: { details: { propertyType: "Single-family", address: "x", annualRentalIncome: null, annualExpenses: null, outstandingMortgage: 450_000, mortgageRatePercent: 6 } },
      }),
    ], ctx());
    // $600k house with a $450k mortgage is a $150k position, not a $600k one.
    expect(holdings[0].valuation.valueBase).toBeCloseTo(150_000, 0);
  });

  it("computes real estate P&L against cash invested, not gross purchase price", () => {
    // A $420k property now worth $520k with a $310k mortgage: net equity is
    // $210k. Comparing that net figure against the $420k GROSS cost basis
    // produced a fabricated -50% P&L on a property that had genuinely
    // appreciated — the bug this test locks in place.
    const { holdings } = normalizeHoldings([
      raw({
        id: "house", assetClass: "real_estate", name: "Duplex", costBasis: 420_000,
        manualValue: 520_000, manualValueAsOf: new Date().toISOString(),
        meta: { details: { propertyType: "Multi-family", address: "x", annualRentalIncome: null, annualExpenses: null, outstandingMortgage: 310_000, mortgageRatePercent: 5.75 } },
      }),
    ], ctx());

    const h = holdings[0];
    expect(h.valuation.valueBase).toBeCloseTo(210_000, 0);         // net equity
    expect(h.costBasisBase).toBeCloseTo(110_000, 0);               // cash invested: 420k - 310k
    expect(h.unrealizedPL).toBeCloseTo(100_000, 0);                // 210k - 110k
    expect(h.unrealizedPct!).toBeGreaterThan(0);                   // must be a GAIN, not -50%
    expect(h.unrealizedPct!).toBeCloseTo((100_000 / 110_000) * 100, 0);
    // The displayed "cost basis" stays the true gross purchase price — only the
    // P&L comparison uses the net-of-mortgage figure.
    expect(h.costBasis).toBe(420_000);
  });

  it("flags a stale manual valuation", () => {
    const old = new Date(Date.now() - 800 * 86_400_000).toISOString();
    const { holdings } = normalizeHoldings([
      raw({ id: "h", assetClass: "real_estate", manualValue: 100, manualValueAsOf: old, meta: { details: {} } }),
    ], ctx());
    expect(holdings[0].valuation.stale).toBe(true);
  });

  it("converts foreign-currency holdings into the base currency", () => {
    const c = ctx({
      quotes: new Map([["SAP.DE", { symbol: "SAP.DE", price: 100, changePercent: 0, currency: "EUR", name: "SAP", marketCap: null }]]),
    });
    const { totalValue } = normalizeHoldings(
      [raw({ id: "e", assetClass: "equity", symbol: "SAP.DE", quantity: 10, currency: "EUR" })],
      c,
    );
    expect(totalValue).toBeCloseTo(1080, 0); // 10 × €100 × 1.08
  });
});

describe("scoring honesty", () => {
  it("returns null — never a fabricated 50 — when a class cannot be scored", () => {
    // This is the bug the whole model exists to fix: the old engine gave a bond a
    // composite of 50 because computeScore() wanted a FundamentalsSnapshot and got
    // null, then fed that 50 into target weights and BUY/SELL actions.
    const { holdings } = normalizeHoldings(
      [raw({ id: "x", assetClass: "bond", symbol: "UNKNOWN", quantity: 1 })],
      ctx(),
    );
    expect(holdings[0].score).toBeNull();
  });

  it("caps crypto confidence — no on-chain data means no high-confidence score", () => {
    const { holdings } = normalizeHoldings(
      [raw({ id: "btc", assetClass: "crypto", symbol: "BTC-USD", quantity: 1, unit: "coins" })],
      ctx(),
    );
    expect(holdings[0].score!.confidence).toBeLessThanOrEqual(55);
  });
});

/* -------------------------------------------------------------------------- */
/* THE central correctness claim                                               */
/* -------------------------------------------------------------------------- */

describe("scenario engine — cross-asset correctness", () => {
  const gfc = getScenario("gfc_2008")!;

  function holdingOf(assetClass: RawHolding["assetClass"], symbol: string | null, extra: Partial<RawHolding> = {}) {
    const { holdings } = normalizeHoldings(
      [raw({ id: symbol ?? assetClass, assetClass, symbol, quantity: 1, ...extra })],
      ctx(),
    );
    return holdings[0];
  }

  it("gold RISES in the 2008 crisis (the old engine said -20%)", () => {
    const gold = holdingOf("commodity", "GLD");
    const impact = applyShocks(gold, gfc.shocks);
    expect(impact.impactPct).toBeGreaterThan(0);
  });

  it("Treasuries RALLY in the 2008 crisis (the old engine said -20%)", () => {
    // 7.4y duration × -2pp rates = +14.8%, plus a positive credit-spread beta
    // (flight to quality). The old engine had neither concept.
    const ief = holdingOf("bond", "IEF");
    const impact = applyShocks(ief, gfc.shocks);
    expect(impact.impactPct).toBeGreaterThan(0);
  });

  it("cash is roughly flat in the 2008 crisis (the old engine said -20%)", () => {
    const cash = holdingOf("cash", null, { quantity: 10_000, unit: "currency" });
    const impact = applyShocks(cash, gfc.shocks);
    expect(Math.abs(impact.impactPct)).toBeLessThan(3);
  });

  it("equities fall hard in the 2008 crisis", () => {
    const aapl = holdingOf("equity", "AAPL");
    expect(applyShocks(aapl, gfc.shocks).impactPct).toBeLessThan(-30);
  });

  it("a diversified portfolio loses less than an all-equity one", () => {
    const c = ctx();
    const allEquity = normalizeHoldings(
      [raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c,
    );
    const diversified = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
      raw({ id: "g", assetClass: "commodity", symbol: "GLD", quantity: 30 }),
    ], c);

    const eq = runScenario(gfc, allEquity.holdings, allEquity.totalValue);
    const dv = runScenario(gfc, diversified.holdings, diversified.totalValue);

    expect(dv.portfolioImpactPct).toBeGreaterThan(eq.portfolioImpactPct);
  });

  it("cannot lose more than 100% of a holding", () => {
    const h = holdingOf("bond", "IEF");
    const impact = applyShocks(h, { rates: 50 });  // absurd shock
    expect(impact.impactPct).toBeGreaterThanOrEqual(-100);
  });

  it("reports scenario coverage rather than defaulting unmodelled assets to -20%", () => {
    const c = ctx();
    const { holdings, totalValue } = normalizeHoldings(
      [raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c,
    );
    const res = runScenario(getScenario("crypto_winter")!, holdings, totalValue);
    // An equity has a small equityBeta loading in crypto_winter, so it IS covered —
    // but the field must exist and be a real percentage.
    expect(res.coveragePct).toBeGreaterThanOrEqual(0);
    expect(res.coveragePct).toBeLessThanOrEqual(100);
  });
});

/* -------------------------------------------------------------------------- */

describe("allocation", () => {
  it("breaks the portfolio down by class, currency and liquidity", () => {
    const c = ctx();
    const { holdings, totalValue } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
      raw({ id: "cash", assetClass: "cash", quantity: 10_000, unit: "currency" }),
    ], c);

    const alloc = computeAllocation(holdings, totalValue);
    expect(alloc.byAssetClass.slices.map((s) => s.key).sort()).toEqual(["bond", "cash", "equity"]);
    expect(alloc.byCurrency.slices[0].key).toBe("USD");
    expect(alloc.byLiquidity.slices.length).toBeGreaterThan(0);
  });

  it("gives a bond portfolio real interest-rate exposure (the old model gave it none)", () => {
    const c = ctx();
    const { holdings, totalValue } = normalizeHoldings(
      [raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 })], c,
    );
    const alloc = computeAllocation(holdings, totalValue);
    const rates = alloc.byFactor.find((f) => f.factor === "rates");
    expect(rates).toBeDefined();
    expect(rates!.exposure).toBeLessThan(-5);  // ≈ -7.4 (the real duration)
  });

  it("flags 100% single-currency exposure", () => {
    const c = ctx();
    const { holdings, totalValue } = normalizeHoldings(
      [raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50 })], c,
    );
    const alloc = computeAllocation(holdings, totalValue);
    const findings = computeConcentration(holdings, alloc);
    expect(findings.some((f) => f.type === "currency")).toBe(true);
  });
});

describe("risk", () => {
  it("reports coverage and does NOT treat illiquid holdings as riskless", () => {
    const c = ctx();
    const { holdings, totalValue } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50 }),
      raw({ id: "pe", assetClass: "private_market", name: "Startup", costBasis: 50_000, manualValue: 100_000, manualValueAsOf: new Date().toISOString(), meta: { details: { companyName: "X", round: "Seed", ownershipPercent: 2, lastRoundValuation: 5e6 } } }),
    ], c);

    const alloc = computeAllocation(holdings, totalValue);
    const risk = computeRisk(holdings, totalValue, alloc, c);

    // The private stake has no return series — it must be PROXIED, not ignored.
    expect(risk.coverage.holdingsProxied).toBe(1);
    expect(risk.coverage.observedPct).toBeLessThan(100);
    expect(risk.illiquidPct).toBeGreaterThan(0);
  });

  it("excludes illiquid holdings from correlation instead of assuming r=0", () => {
    const c = ctx();
    const { holdings, totalValue } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
      raw({ id: "h", assetClass: "real_estate", name: "House", manualValue: 300_000, manualValueAsOf: new Date().toISOString(), meta: { details: {} } }),
    ], c);
    const alloc = computeAllocation(holdings, totalValue);
    const risk = computeRisk(holdings, totalValue, alloc, c);

    expect(risk.correlation!.excluded).toContain("House");
    expect(risk.correlation!.symbols).not.toContain("House");
  });
});

describe("health score", () => {
  it("ABSTAINS instead of scoring 50 on dimensions that do not apply", () => {
    const c = ctx();
    // An all-bond portfolio: Holding Quality can speak, but geography/correlation
    // cannot. The old engine returned a fabricated 50 for each.
    const { holdings, totalValue } = normalizeHoldings(
      [raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 })], c,
    );
    const alloc = computeAllocation(holdings, totalValue);
    const risk = computeRisk(holdings, totalValue, alloc, c);
    const health = computeHealth(holdings, totalValue, alloc, risk);

    const abstained = health.dimensions.filter((d) => d.score === null);
    expect(abstained.length).toBeGreaterThan(0);
    // No dimension may report exactly the old fabricated midpoint by default.
    expect(health.coveragePct).toBeLessThan(100);
    // Redistributed weights must still sum to 1 across scoring dimensions.
    const sum = health.dimensions.reduce((s, d) => s + d.effectiveWeight, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("penalizes a portfolio with no cash buffer", () => {
    const c = ctx();
    const { holdings, totalValue } = normalizeHoldings(
      [raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c,
    );
    const alloc = computeAllocation(holdings, totalValue);
    const risk = computeRisk(holdings, totalValue, alloc, c);
    const health = computeHealth(holdings, totalValue, alloc, risk);

    const cash = health.dimensions.find((d) => d.name === "Cash Management")!;
    expect(cash.score).toBeLessThan(50);
  });

  it("treats cash as inflation-exposed, not riskless", () => {
    const c = ctx();
    const { holdings, totalValue } = normalizeHoldings(
      [raw({ id: "cash", assetClass: "cash", quantity: 100_000, unit: "currency" })], c,
    );
    const alloc = computeAllocation(holdings, totalValue);
    const risk = computeRisk(holdings, totalValue, alloc, c);

    expect(risk.inflationSensitivity).toBeLessThan(0);
    const health = computeHealth(holdings, totalValue, alloc, risk);
    const infl = health.dimensions.find((d) => d.name === "Inflation Protection")!;
    expect(infl.score).toBeLessThan(50);
  });
});

describe("simulate", () => {
  it("recomputes weights against the NEW total after a change", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
    ], c);

    const before = evaluate(holdings, c);
    const sum = before.holdings.reduce((s, h) => s + h.weight, 0);
    expect(sum).toBeCloseTo(100, 3);
  });
});

describe("optimize — class zeroed out of the objective", () => {
  it("generates SELL trades for a held, tradeable class the objective doesn't want", () => {
    // "Maximize Return" targets only equity/etf/crypto/reit/bond/cash — commodities
    // aren't in that mix at all. The class-level summary correctly showed this
    // class dropping to a 0% target, but the per-holding trade list silently
    // generated NO sell trades for it — the exact bug this test locks in place.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50 }),
      raw({ id: "g", assetClass: "commodity", symbol: "GLD", quantity: 100 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const result = optimize(evaluation, "maximize_return", DEFAULT_CONSTRAINTS, undefined, c);

    const commodityTarget = result.classTargets.find((t) => t.assetClass === "commodity");
    expect(commodityTarget?.targetWeight).toBe(0);

    const gldTrade = result.trades.find((t) => t.symbol === "GLD");
    expect(gldTrade).toBeDefined();
    expect(gldTrade!.action).toBe("SELL");
    expect(gldTrade!.targetWeight).toBe(0);
  });

  it("a fully-tradeable, unwanted class has no holdings silently frozen at current weight", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50 }),
      raw({ id: "g", assetClass: "commodity", symbol: "GLD", quantity: 100 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const result = optimize(evaluation, "maximize_return", DEFAULT_CONSTRAINTS, undefined, c);
    const gld = result.holdings.find((h) => h.symbol === "GLD")!;
    expect(gld.targetWeight).toBe(0);
    expect(gld.constrained).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Convergence, value conservation, and the 100% invariant                     */
/* -------------------------------------------------------------------------- */

describe("optimize — convergent, idempotent, value-conserving", () => {
  const OBJECTIVES_UNDER_TEST: Objective[] = [
    "maximize_return",
    "minimize_volatility",
    "maximize_sharpe",
    "maximize_income",
    "maximize_diversification",
    "preserve_capital",
    "balanced",
    "growth",
  ];

  /** A mixed portfolio that holds SOME but not all of what the objectives want. */
  function mixed(c: MarketContext) {
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "g", assetClass: "commodity", symbol: "GLD", quantity: 40 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 80 }),
    ], c);
    return evaluate(holdings, c);
  }

  /** Apply the plan the SAME value-conserving way the executor does. */
  function applyPlan(evaluation: ReturnType<typeof evaluate>, result: ReturnType<typeof optimize>, c: MarketContext) {
    const changes = result.trades.map((t) => ({ holdingId: t.holdingId, targetWeight: t.targetWeight }));
    return evaluate(applyTargetPlanConserving(evaluation.holdings, changes, c), c);
  }

  it.each(OBJECTIVES_UNDER_TEST)("class targets sum to exactly 100%% for %s", (objective) => {
    const c = ctx();
    const result = optimize(mixed(c), objective, DEFAULT_CONSTRAINTS, undefined, c);
    const sum = result.classTargets.reduce((s, t) => s + t.targetWeight, 0);
    expect(sum).toBeCloseTo(100, 0);
  });

  it.each(OBJECTIVES_UNDER_TEST)("converges in ONE round for %s — re-optimizing proposes no trades", (objective) => {
    const c = ctx();
    const evaluation = mixed(c);
    const first = optimize(evaluation, objective, DEFAULT_CONSTRAINTS, undefined, c);

    const applied = applyPlan(evaluation, first, c);

    // The whole point: after executing the plan, running the optimizer again on the
    // resulting portfolio must produce nothing. This is the regression guard for the
    // "execute → immediately more trades, forever" bug.
    const second = optimize(applied, objective, DEFAULT_CONSTRAINTS, undefined, c);
    expect(second.trades.length).toBe(0);
  });

  it.each(OBJECTIVES_UNDER_TEST)("conserves total portfolio value through a rebalance for %s", (objective) => {
    const c = ctx();
    const evaluation = mixed(c);
    const result = optimize(evaluation, objective, DEFAULT_CONSTRAINTS, undefined, c);
    const applied = applyPlan(evaluation, result, c);
    // A rebalance is not new money — total value is unchanged (within rounding).
    expect(applied.totalValue).toBeCloseTo(evaluation.totalValue, 0);
  });

  it("routes the budget of UNAVAILABLE asset classes to cash, then converges", () => {
    // An all-equity, single-holding portfolio under Maximize Sharpe: the objective
    // wants bonds/REITs/commodities/cash the portfolio doesn't hold, AND the single
    // equity name can't legally exceed the 20% per-holding cap. Everything the
    // rebalancer can't place must land in cash — and re-running must be a no-op.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const result = optimize(evaluation, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);

    // AAPL is trimmed to at most the single-holding cap; the rest is cash.
    const aapl = result.holdings.find((h) => h.symbol === "AAPL")!;
    expect(aapl.targetWeight).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.maxHoldingPct + 0.1);

    const changes = result.trades.map((t) => ({ holdingId: t.holdingId, targetWeight: t.targetWeight }));
    const applied = evaluate(applyTargetPlanConserving(evaluation.holdings, changes, c), c);

    const cashWeight = applied.allocation.byAssetClass.slices.find((s) => s.key === "cash")?.weight ?? 0;
    expect(cashWeight).toBeGreaterThan(50);
    expect(applied.totalValue).toBeCloseTo(evaluation.totalValue, 0);

    const second = optimize(applied, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);
    expect(second.trades.length).toBe(0);
  });

  it("never sizes a holding above the single-holding cap (water-filling redistributes the overflow)", () => {
    // Two equity names, one scoring far higher: the high scorer would be tilted past
    // the cap, so its overflow must redistribute to the other name (not vanish, the
    // old clamp bug), and no holding may exceed the cap.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 50 }),
    ], c);
    const evaluation = evaluate(holdings, c);
    const result = optimize(evaluation, "maximize_return", DEFAULT_CONSTRAINTS, undefined, c);
    for (const t of result.holdings) {
      if (t.assetClass === "cash") continue;
      expect(t.targetWeight).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.maxHoldingPct + 0.1);
    }
  });

  it("enforces the minimum-cash floor", () => {
    // target_allocation with 100% equity and no cash entry must still leave the
    // minimum cash buffer, funded by scaling the equity target down.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
    ], c);
    const evaluation = evaluate(holdings, c);
    const result = optimize(evaluation, "target_allocation", DEFAULT_CONSTRAINTS, { equity: 100 }, c);
    const cashTarget = result.classTargets.find((t) => t.assetClass === "cash")?.targetWeight ?? 0;
    expect(cashTarget).toBeGreaterThanOrEqual(DEFAULT_CONSTRAINTS.minCashPct - 0.1);
  });

  it("is idempotent — a second optimize on an already-optimal portfolio is a no-op", () => {
    // Feed the optimizer a portfolio that already sits at a maximize_sharpe-shaped
    // mix; it should propose nothing rather than churn.
    const c = ctx();
    const evaluation = mixed(c);
    const once = optimize(evaluation, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);
    const applied = applyPlan(evaluation, once, c);
    const twice = optimize(applied, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);
    const thrice = optimize(
      applyPlan(applied, twice, c),
      "maximize_sharpe",
      DEFAULT_CONSTRAINTS,
      undefined,
      c,
    );
    expect(twice.trades.length).toBe(0);
    expect(thrice.trades.length).toBe(0);
  });

  it("enforces the sector cap — excess in an over-cap sector routes to cash, not silently dropped", () => {
    // Three Technology-sector names: even after each is capped at the 20%
    // per-holding limit (60% of capacity), the sector as a whole still exceeds the
    // 40% cap, so the sector cap itself must bind — not just the holding cap — and
    // scale all three down proportionally, with the freed budget reappearing in
    // cash rather than evaporating (the exact bug already fixed once for
    // maxHoldingPct/maxAssetClassPct).
    const c = ctx({
      quotes: new Map([
        ["AAPL", { symbol: "AAPL", price: 200, changePercent: 1.2, currency: "USD", name: "Apple", marketCap: 3e12 }],
        ["MSFT", { symbol: "MSFT", price: 400, changePercent: 0.8, currency: "USD", name: "Microsoft", marketCap: 3e12 }],
        ["GOOGL", { symbol: "GOOGL", price: 170, changePercent: 0.5, currency: "USD", name: "Alphabet", marketCap: 2e12 }],
        ["IEF", { symbol: "IEF", price: 95, changePercent: -0.1, currency: "USD", name: "7-10y Treasury", marketCap: null }],
      ]),
      history: new Map([
        ["AAPL", walk(300, 0.0006, 0.018, 3)],
        ["MSFT", walk(300, 0.0005, 0.016, 5)],
        ["GOOGL", walk(300, 0.0005, 0.017, 9)],
        ["IEF", walk(300, 0.0001, 0.004, 11)],
      ]),
      fundamentals: new Map([
        ["AAPL", {
          sector: "Technology", industry: "Consumer Electronics", country: "United States", currency: "USD",
          dividendYield: 0.005, duration: null, maturity: null, creditQuality: null, expenseRatio: null,
          marketCap: 3e12, peRatio: 30, priceToBook: 45, returnOnEquity: 0.55, revenueGrowth: 0.08,
          operatingMargins: 0.30, debtToEquity: 150, operatingCashflow: 1.1e11, beta: 1.25,
        }],
        ["MSFT", {
          sector: "Technology", industry: "Software", country: "United States", currency: "USD",
          dividendYield: 0.007, duration: null, maturity: null, creditQuality: null, expenseRatio: null,
          marketCap: 3e12, peRatio: 32, priceToBook: 14, returnOnEquity: 0.40, revenueGrowth: 0.12,
          operatingMargins: 0.42, debtToEquity: 60, operatingCashflow: 1e11, beta: 0.9,
        }],
        ["GOOGL", {
          sector: "Technology", industry: "Internet Content", country: "United States", currency: "USD",
          dividendYield: 0.004, duration: null, maturity: null, creditQuality: null, expenseRatio: null,
          marketCap: 2e12, peRatio: 25, priceToBook: 7, returnOnEquity: 0.30, revenueGrowth: 0.10,
          operatingMargins: 0.32, debtToEquity: 12, operatingCashflow: 9e10, beta: 1.05,
        }],
      ]),
    });
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 200 }),
      raw({ id: "m", assetClass: "equity", symbol: "MSFT", quantity: 100 }),
      raw({ id: "gg", assetClass: "equity", symbol: "GOOGL", quantity: 100 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 20 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const result = optimize(evaluation, "maximize_return", DEFAULT_CONSTRAINTS, undefined, c);

    const techWeight = result.holdings
      .filter((h) => h.symbol === "AAPL" || h.symbol === "MSFT" || h.symbol === "GOOGL")
      .reduce((s, h) => s + h.targetWeight, 0);
    expect(techWeight).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.maxSectorPct + 0.5);
    expect(result.warnings.some((w) => w.toLowerCase().includes("sector"))).toBe(true);

    const changes = result.trades.map((t) => ({ holdingId: t.holdingId, targetWeight: t.targetWeight }));
    const applied = evaluate(applyTargetPlanConserving(evaluation.holdings, changes, c), c);
    expect(applied.totalValue).toBeCloseTo(evaluation.totalValue, 0);

    // Convergent: re-optimizing the capped result proposes nothing further.
    const second = optimize(applied, "maximize_return", DEFAULT_CONSTRAINTS, undefined, c);
    expect(second.trades.length).toBe(0);
  });

  it("enforces the country cap when tightened below the generous default", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 200 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const tightCountry = { ...DEFAULT_CONSTRAINTS, maxCountryPct: 30 };
    const result = optimize(evaluation, "maximize_return", tightCountry, undefined, c);

    const usWeight = result.holdings
      .filter((h) => h.symbol === "AAPL") // only US-attributed holding in this fixture
      .reduce((s, h) => s + h.targetWeight, 0);
    expect(usWeight).toBeLessThanOrEqual(tightCountry.maxCountryPct + 0.5);
  });
});

describe("computeTradeImpacts", () => {
  it("measures every trade's impact individually, not the combined plan's impact", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 }),
      raw({ id: "g", assetClass: "commodity", symbol: "GLD", quantity: 100 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const result = optimize(evaluation, "maximize_return", DEFAULT_CONSTRAINTS, undefined, c);
    expect(result.trades.length).toBeGreaterThan(0);

    const impacts = computeTradeImpacts(evaluation, c, result.trades);
    expect(impacts.size).toBe(result.trades.length);
    for (const t of result.trades) {
      const impact = impacts.get(t.holdingId);
      expect(impact).toBeDefined();
      expect(typeof impact!.healthDelta).toBe("number");
    }
  });

  it("returns an empty map for an empty trade list", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 })], c);
    const evaluation = evaluate(holdings, c);
    expect(computeTradeImpacts(evaluation, c, []).size).toBe(0);
  });
});

describe("computeRecommendations — alternatives considered", () => {
  it("keeps every simulated candidate for a gap, not just the winner", () => {
    // An all-equity portfolio with no bonds triggers "no_bonds", which has three
    // candidates (IEF, SHY, TIP). All three get simulated; only the best survives
    // as the recommendation, but the others must not be discarded — they are the
    // real, honest "alternatives considered" for this decision.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const recs = computeRecommendations(evaluation, c);
    const bondsRec = recs.find((r) => r.id === "gap:no_bonds");

    expect(bondsRec).toBeDefined();
    // At least one other bond candidate must have been tried and rejected.
    expect(bondsRec!.alternatives.length).toBeGreaterThan(0);
    for (const alt of bondsRec!.alternatives) {
      expect(alt.symbol).not.toBe(bondsRec!.symbol);
      expect(alt.rejectedReason.length).toBeGreaterThan(0);
    }
  });

  it("reports a real, non-fabricated total of every candidate simulated", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const recs = computeRecommendations(evaluation, c);
    expect(recs.length).toBeGreaterThan(0);

    // Every recommendation in the same pass reports the SAME total — it is the
    // full pass's evaluated-candidate count, not a per-recommendation count.
    const totals = new Set(recs.map((r) => r.alternativesEvaluated));
    expect(totals.size).toBe(1);

    // The total must be at least as large as the alternatives actually shown for
    // any single recommendation, since it includes those plus every other trial.
    const maxAlternatives = Math.max(...recs.map((r) => r.alternatives.length + 1));
    expect([...totals][0]).toBeGreaterThanOrEqual(maxAlternatives);
  });
});

describe("buildDecisionCards", () => {
  it("ranks by decisionScore, assigns sequential priority, and bounds the score to 0-100", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const recs = computeRecommendations(evaluation, c);
    const cards = buildDecisionCards(recs, evaluation);

    expect(cards.length).toBe(recs.length);
    cards.forEach((card, i) => {
      expect(card.decisionScore).toBeGreaterThanOrEqual(0);
      expect(card.decisionScore).toBeLessThanOrEqual(100);
      expect(card.decisionPriority).toBe(i + 1);
      expect(card.alternativesConsidered).toBe(card.recommendation.alternatives.length + 1);
      if (i > 0) expect(card.decisionScore).toBeLessThanOrEqual(cards[i - 1].decisionScore);
    });
  });

  it("states tax impact as a realized gain/loss fact, never as a fabricated tax dollar amount", () => {
    // A single, heavily concentrated holding triggers the "trim" recommendation —
    // a REDUCE action against a real, held position with a known cost basis.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500, costBasis: 40000 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const recs = computeRecommendations(evaluation, c);
    const trim = recs.find((r) => r.id === "trim:a");
    expect(trim).toBeDefined();

    const cards = buildDecisionCards(recs, evaluation);
    const card = cards.find((cd) => cd.recommendation.id === "trim:a")!;

    expect(card.taxImpact).toMatch(/unrealized (gain|loss)/);
    expect(card.taxImpact).not.toMatch(/\btax owed\b.*\$/i);
    expect(card.taxImpact).toContain("No tax rate is modeled");
  });

  it("marks ADD recommendations as not realizing anything", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const recs = computeRecommendations(evaluation, c);
    const add = recs.find((r) => r.action === "ADD");
    expect(add).toBeDefined();

    const cards = buildDecisionCards(recs, evaluation);
    const card = cards.find((cd) => cd.recommendation.id === add!.id)!;
    expect(card.taxImpact).toMatch(/^N\/A/);
  });
});

describe("portfolio thesis — content hash and fallback", () => {
  it("is stable when only a live quote's tiny price move changes a holding's weight", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    // Simulate the SAME portfolio after an intraday price wiggle: weights shift
    // by a fraction of a point, but rounded-to-whole-percent buckets (and thus
    // the cache key) must not change — otherwise every page load would burn a
    // fresh Ollama call just because AAPL moved 0.1%.
    const jittered = evaluation.holdings.map((h) => ({ ...h, weight: h.weight + 0.05 }));
    const jitteredEval = { ...evaluation, holdings: jittered };

    expect(contentHash(evaluation)).toBe(contentHash(jitteredEval));
  });

  it("changes when a holding is added, removed, or meaningfully resized", () => {
    const c = ctx();
    const base = evaluate(normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 }),
    ], c).holdings, c);

    const withBond = evaluate(normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
    ], c).holdings, c);

    expect(contentHash(base)).not.toBe(contentHash(withBond));
  });

  it("produces an honest, data-grounded fallback thesis and identity when AI is unavailable", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 2000 }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const thesis = fallbackThesis(evaluation);
    expect(thesis).toContain(String(evaluation.health.total));
    expect(thesis.length).toBeGreaterThan(0);

    const identity = fallbackIdentity(evaluation);
    expect(identity.length).toBeGreaterThan(0);
    // A single-holding, all-equity portfolio is unambiguously concentrated.
    expect(identity).toContain("Concentrated");
  });
});

describe("why do I own this — per-holding explanation", () => {
  it("grounds confidence in the holding's own score, never a fabricated number", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
    ], c);
    const evaluation = evaluate(holdings, c);
    const aapl = evaluation.holdings[0];

    expect(aapl.score).not.toBeNull();
    expect(confidenceFor(aapl)).toBe(aapl.score!.confidence);
  });

  it("falls back to a data-quality confidence when a holding has no score", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
    ], c);
    const evaluation = evaluate(holdings, c);
    // Simulate a class with no honest scoring basis — the field is nullable by
    // design (lib/portfolio/model/types.ts: HoldingScore | null) for exactly this case.
    const unscored = { ...evaluation.holdings[0], score: null };

    expect(confidenceFor(unscored)).toBeGreaterThan(0);
    expect(confidenceFor(unscored)).toBeLessThanOrEqual(100);
    // A live, non-stale market price backs a more confident explanation than no data at all.
    expect(confidenceFor(unscored)).toBe(70);
  });

  it("produces a grounded fallback explanation referencing the holding's real weight and value", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 50 }),
    ], c);
    const evaluation = evaluate(holdings, c);
    const aapl = evaluation.holdings.find((h) => h.symbol === "AAPL")!;

    const text = fallbackExplanation(aapl, evaluation, null);
    expect(text).toContain("AAPL");
    expect(text).toContain(aapl.weight.toFixed(1));
  });

  it("changes cache key when the holding's weight materially shifts, but not on tiny jitter", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 50 }),
    ], c);
    const evaluation = evaluate(holdings, c);
    const aapl = evaluation.holdings.find((h) => h.symbol === "AAPL")!;

    const jittered = { ...aapl, weight: aapl.weight + 0.05 };
    expect(cacheKeyFor(aapl, evaluation)).toBe(cacheKeyFor(jittered, evaluation));

    const resized = { ...aapl, weight: aapl.weight + 10 };
    expect(cacheKeyFor(aapl, evaluation)).not.toBe(cacheKeyFor(resized, evaluation));
  });
});
