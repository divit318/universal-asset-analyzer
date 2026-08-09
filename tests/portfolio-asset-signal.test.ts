/**
 * Research-signal integration for the Position Sizing Engine.
 *
 * Guards the defect that made "Recommended Allocation" decline almost every
 * stock: the sizing loop treated the objective's strategic class target as a
 * hard ceiling, so on any equity-overweight portfolio EVERY equity — Strong
 * Buy or value trap alike — was declined with the same class-target sentence.
 * The engine had no concept of the asset itself.
 *
 * With asset-signal.ts, the Research page's own verdict (composite score,
 * recommendation band, valuation upside, risk flags, confidence) sets a
 * conviction-supported position weight, portfolio context scales it, and the
 * tranche loop measures its way there. These tests assert ORDERING, SIGN and
 * CONSISTENCY (modal can never contradict the research verdict) — not dollar
 * amounts, which depend on fixture geometry.
 */
import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { computePositionSizing, computePositionSizingAtAmount } from "@/lib/portfolio/engines/position-size";
import { assessConviction, deriveAssetSignal, type AssetSignal } from "@/lib/portfolio/engines/asset-signal";
import type { FundamentalsData } from "@/lib/types";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures — same walk/ctx conventions as tests/portfolio-sizing-calibration   */
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

const PRICES: Record<string, number> = {
  BIGEQ: 250, EQ2: 180, NEWEQ: 120, BONDETF: 95, "BTC-USD": 60000,
};

function ctx(): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  const quotes = new Map<string, NonNullable<ReturnType<MarketContext["quotes"]["get"]>>>();
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
      ["NEWEQ", {
        sector: "Healthcare", industry: "Pharma", country: "United States", currency: "USD",
        dividendYield: 0.02, duration: null, maturity: null, creditQuality: null, expenseRatio: null,
        marketCap: 3e11, peRatio: 18, priceToBook: 4, returnOnEquity: 0.25, revenueGrowth: 0.07,
        operatingMargins: 0.28, debtToEquity: 45, operatingCashflow: 2e10, beta: 0.8,
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

/** Heavily equity-overweight vs the maximize_sharpe target (equity 35) — the exact geometry that used to decline every stock. */
function equityHeavyPortfolio(c: MarketContext) {
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

function signal(overrides: Partial<AssetSignal> = {}): AssetSignal {
  return {
    symbol: "NEWEQ",
    compositeScore: 82,
    recommendation: "STRONG_BUY",
    scoreConfidence: 85,
    upsidePct: 25,
    upsideBasis: "analyst_consensus",
    qualityPct: 80,
    valuationPct: 70,
    growthPct: 65,
    financialHealthPct: 75,
    momentumTrend: "up",
    dividendYieldPct: 2,
    highRisks: [],
    ...overrides,
  };
}

const NEWEQ = { symbol: "NEWEQ", name: "New Equity", assetClass: "equity" as const };

/* -------------------------------------------------------------------------- */

describe("deriveAssetSignal", () => {
  const data = {
    score: {
      total: 70, composite: 74, recommendation: "BUY", confidence: 80, rationale: "",
      buckets: [
        { name: "Quality", points: 16, max: 20, factors: [] },
        { name: "Valuation", points: 10, max: 20, factors: [] },
      ],
      signals: { fundamentals: 70, analysts: null, momentum: null },
    },
    analyst: { upsidePercent: 18.4 },
    snapshot: { dividendYield: 0.012 },
    momentum: { trend: "up" },
    risks: [
      { category: "Valuation", level: "high", reason: "PEG 4.2" },
      { category: "Growth", level: "medium", reason: "slowing" },
    ],
  } as unknown as FundamentalsData;

  it("shapes the research report's own numbers — never recomputed", () => {
    const s = deriveAssetSignal("aapl", data);
    expect(s).not.toBeNull();
    expect(s!.symbol).toBe("AAPL");
    expect(s!.compositeScore).toBe(74);
    expect(s!.recommendation).toBe("BUY");
    expect(s!.scoreConfidence).toBe(80);
    expect(s!.upsidePct).toBe(18.4);
    expect(s!.upsideBasis).toBe("analyst_consensus");
    expect(s!.qualityPct).toBe(80);
    expect(s!.valuationPct).toBe(50);
    expect(s!.momentumTrend).toBe("up");
    expect(s!.dividendYieldPct).toBeCloseTo(1.2, 5);
    expect(s!.highRisks).toEqual(["PEG 4.2"]);
  });

  it("prefers the user's own valuation case over analyst consensus", () => {
    const s = deriveAssetSignal("AAPL", data, 31.2);
    expect(s!.upsidePct).toBe(31.2);
    expect(s!.upsideBasis).toBe("valuation_case");
  });

  it("returns null when there is no score at all", () => {
    expect(deriveAssetSignal("GLD", null)).toBeNull();
    expect(deriveAssetSignal("GLD", {} as FundamentalsData)).toBeNull();
  });
});

describe("assessConviction", () => {
  it("is monotone in the research verdict — Strong Buy > Buy > Hold-band", () => {
    const strong = assessConviction(signal({ compositeScore: 84, recommendation: "STRONG_BUY" }));
    const buy = assessConviction(signal({ compositeScore: 65, recommendation: "BUY" }));
    const hold = assessConviction(signal({ compositeScore: 50, recommendation: "HOLD" }));

    expect(strong.conviction).toBeGreaterThan(buy.conviction);
    expect(buy.conviction).toBeGreaterThan(hold.conviction);
    expect(strong.targetWeightPct).toBeGreaterThan(buy.targetWeightPct);
    expect(buy.targetWeightPct).toBeGreaterThan(hold.targetWeightPct);
  });

  it("vetoes on a SELL verdict — the modal can never out-vote the Research page", () => {
    const c = assessConviction(signal({ compositeScore: 35, recommendation: "SELL", upsidePct: -12 }));
    expect(c.vetoed).toBe(true);
    expect(c.targetWeightPct).toBe(0);
    expect(c.vetoReason).toMatch(/Sell/);
    expect(c.vetoReason).toMatch(/35\/100/);
  });

  it("dampens for red flags, downside and low confidence", () => {
    const clean = assessConviction(signal());
    const flagged = assessConviction(signal({ highRisks: ["PEG 4.2", "net debt 5x EBITDA"] }));
    const overpriced = assessConviction(signal({ upsidePct: -15 }));
    const thin = assessConviction(signal({ scoreConfidence: 25 }));

    expect(flagged.conviction).toBeLessThan(clean.conviction);
    expect(overpriced.conviction).toBeLessThan(clean.conviction);
    expect(thin.conviction).toBeLessThan(clean.conviction);
  });

  it("supports no position at all for a weak case", () => {
    const c = assessConviction(signal({ compositeScore: 43, recommendation: "HOLD", upsidePct: -8, momentumTrend: "down", highRisks: ["a", "b"] }));
    expect(c.vetoed).toBe(false);
    expect(c.targetWeightPct).toBe(0);
  });
});

describe("computePositionSizing with a research signal", () => {
  const c = ctx();
  const evaluation = equityHeavyPortfolio(c);

  it("recommends a real allocation for a Strong Buy even on an equity-overweight book — THE original bug", () => {
    const plan = computePositionSizing(evaluation, NEWEQ, "maximize_sharpe", c, undefined, undefined, signal());
    expect(plan.action, `declined: ${plan.holdReason}`).toBe("BUY");
    expect(plan.recommendedAmount).toBeGreaterThan(0);
    expect(plan.effectiveTargetWeightPct).toBeGreaterThan(0);
    expect(plan.conviction).not.toBeNull();
    // The overweight is priced in, not ignored: sized below the raw conviction target.
    expect(plan.effectiveTargetWeightPct!).toBeLessThan(plan.conviction!.targetWeightPct);
    // And it must say so.
    expect(plan.reasons.join(" ")).toMatch(/Equities .* 35/);
  });

  it("sizes stronger research cases larger", () => {
    const strong = computePositionSizing(evaluation, NEWEQ, "maximize_sharpe", c, undefined, undefined, signal({ compositeScore: 84 }));
    const modest = computePositionSizing(evaluation, NEWEQ, "maximize_sharpe", c, undefined, undefined, signal({ compositeScore: 62, recommendation: "BUY", upsidePct: 8 }));
    expect(strong.action).toBe("BUY");
    expect(strong.recommendedAmount).toBeGreaterThan(modest.recommendedAmount);
  });

  it("holds with a research-grounded reason when the verdict is SELL", () => {
    const plan = computePositionSizing(evaluation, NEWEQ, "maximize_sharpe", c, undefined, undefined,
      signal({ compositeScore: 32, recommendation: "SELL", upsidePct: -20 }));
    expect(plan.action).toBe("HOLD");
    expect(plan.holdKind).toBe("research_negative");
    expect(plan.holdReason).toMatch(/32\/100/);
    expect(plan.reasons.length).toBeGreaterThan(0);
  });

  it("holds with research_weak when the case is too thin to size", () => {
    const plan = computePositionSizing(evaluation, NEWEQ, "maximize_sharpe", c, undefined, undefined,
      signal({ compositeScore: 43, recommendation: "HOLD", upsidePct: -8, momentumTrend: "down", highRisks: ["a", "b"] }));
    expect(plan.action).toBe("HOLD");
    expect(plan.holdKind).toBe("research_weak");
    expect(plan.holdReason).toMatch(/43\/100/);
  });

  it("holds at_conviction_size when the existing position already exceeds what conviction supports", () => {
    // EQ2 at ~7% of the book — inside the 20% concentration cap, but well past
    // the 2-3% a Buy-grade case supports on this overweight book.
    const holdings = normalizeHoldings(
      [
        raw({ id: "h-bigeq", assetClass: "equity", symbol: "BIGEQ", quantity: 1200, costBasis: 250000 }),
        raw({ id: "h-eq2", assetClass: "equity", symbol: "EQ2", quantity: 150, costBasis: 24000 }),
        raw({ id: "h-bond", assetClass: "bond", symbol: "BONDETF", quantity: 300, costBasis: 28000 }),
        raw({ id: "h-cash", assetClass: "cash", symbol: null, quantity: 60000, unit: "units", manualValue: 60000, costBasis: 60000 }),
      ],
      c,
    ).holdings;
    const midBook = evaluate(holdings, c);

    const plan = computePositionSizing(midBook, { symbol: "EQ2", name: "Equity Two", assetClass: "equity" }, "maximize_sharpe", c,
      undefined, undefined, signal({ symbol: "EQ2", compositeScore: 70, recommendation: "BUY", upsidePct: 10 }));
    expect(plan.action).toBe("HOLD");
    expect(plan.holdKind).toBe("at_conviction_size");
    expect(plan.holdReason).toMatch(/already hold/);
    expect(plan.effectiveTargetWeightPct).not.toBeNull();
  });

  it("holds at_cap when the position is already at the concentration limit — the cap outranks conviction", () => {
    const plan = computePositionSizing(evaluation, { symbol: "BIGEQ", name: "Big Equity", assetClass: "equity" }, "maximize_sharpe", c,
      undefined, undefined, signal({ symbol: "BIGEQ", compositeScore: 84, recommendation: "STRONG_BUY" }));
    expect(plan.action).toBe("HOLD");
    expect(plan.holdKind).toBe("at_cap");
  });

  it("ignores the single-name signal for classes the research framework cannot score", () => {
    // A bond fund carrying an (inapplicable) equity-style verdict — conviction must not engage.
    const plan = computePositionSizing(evaluation, { symbol: "BONDETF", name: "Bond ETF", assetClass: "bond" }, "maximize_sharpe", c,
      undefined, undefined, signal({ symbol: "BONDETF", compositeScore: 45, recommendation: "HOLD" }));
    expect(plan.conviction).toBeNull();
    // The bond gap is real regardless of the pseudo-score: geometry still recommends it.
    expect(plan.action).toBe("BUY");
  });

  it("never sizes into a class the objective allocates nothing to, even on a hot signal", () => {
    const plan = computePositionSizing(evaluation, { symbol: "BTC-USD", name: "Bitcoin", assetClass: "crypto" }, "maximize_sharpe", c,
      undefined, undefined, signal({ symbol: "BTC-USD" }));
    expect(plan.action).toBe("HOLD");
    expect(plan.holdKind).toBe("class_target");
    expect(plan.holdReason).toMatch(/allocates nothing/);
  });

  it("caps the signal-free geometric path at a sane single trade", () => {
    // Bond is starved (target 25) — the gap must be filled in steps, not one ticket.
    const plan = computePositionSizing(evaluation, { symbol: "BONDETF", name: "Bond ETF", assetClass: "bond" }, "maximize_sharpe", c);
    expect(plan.action).toBe("BUY");
    expect(plan.recommendedAmount).toBeLessThanOrEqual(evaluation.totalValue * 0.0751);
  });

  it("reports an expected-return estimate grounded in the signal's upside", () => {
    const plan = computePositionSizing(evaluation, NEWEQ, "maximize_sharpe", c, undefined, undefined, signal({ upsidePct: 30 }));
    expect(plan.action).toBe("BUY");
    expect(plan.expectedReturn).not.toBeNull();
    expect(plan.expectedReturn!.assetAnnualPct).toBeGreaterThan(0);
    expect(plan.expectedReturn!.portfolioDeltaPct).toBeGreaterThan(0);
    expect(plan.expectedReturn!.basis).toMatch(/analyst consensus/);
  });

  it("is deterministic with a signal — identical inputs, identical plan", () => {
    const a = computePositionSizing(evaluation, NEWEQ, "maximize_sharpe", c, undefined, undefined, signal());
    const b = computePositionSizing(evaluation, NEWEQ, "maximize_sharpe", c, undefined, undefined, signal());
    const { before: b1, after: a1, ...rest1 } = a;
    const { before: b2, after: a2, ...rest2 } = b;
    void b1; void a1; void b2; void a2;
    expect(JSON.stringify(rest2)).toBe(JSON.stringify(rest1));
  });

  it("CONSISTENCY: a high-confidence Strong Buy is only ever refused for a hard, named reason", () => {
    // Sweep starter → full conviction; every HOLD must carry a structural holdKind
    // (constraint/cap/conviction-size), never a shrug — and a Strong Buy must never
    // produce the old generic decline on this equity-overweight book.
    for (const composite of [79, 82, 85, 90]) {
      const plan = computePositionSizing(evaluation, NEWEQ, "maximize_sharpe", c, undefined, undefined,
        signal({ compositeScore: composite, recommendation: "STRONG_BUY", scoreConfidence: 90 }));
      if (plan.action === "HOLD") {
        expect(["at_cap", "constraint", "at_conviction_size"]).toContain(plan.holdKind);
      } else {
        expect(plan.recommendedAmount).toBeGreaterThan(0);
      }
    }
  });
});

describe("computePositionSizingAtAmount with a research signal", () => {
  const c = ctx();
  const evaluation = equityHeavyPortfolio(c);

  it("attaches the signal, conviction and expected return to a manual amount", () => {
    const plan = computePositionSizingAtAmount(evaluation, NEWEQ, 5000, "maximize_sharpe", c, signal());
    expect(plan.action).toBe("BUY");
    expect(plan.signal).not.toBeNull();
    expect(plan.conviction).not.toBeNull();
    expect(plan.expectedReturn).not.toBeNull();
  });

  it("still sizes any amount without a signal — manual is the user's override", () => {
    const plan = computePositionSizingAtAmount(evaluation, NEWEQ, 5000, "maximize_sharpe", c);
    expect(plan.action).toBe("BUY");
    expect(plan.signal).toBeNull();
    expect(plan.expectedReturn).toBeNull();
  });
});
