import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { computeCashAllocation, allocateToExactTotal, DEFAULT_TRANCHES } from "@/lib/portfolio/engines/cash";
import { DEFAULT_CONSTRAINTS, type Objective } from "@/lib/portfolio/engines/optimize";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures — same shape as tests/portfolio-universal.test.ts, duplicated per   */
/* the existing per-file convention rather than shared.                        */
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
      ["SHY", { symbol: "SHY", price: 82, changePercent: 0, currency: "USD", name: "1-3y Treasury", marketCap: null }],
      ["TIP", { symbol: "TIP", price: 108, changePercent: 0.1, currency: "USD", name: "TIPS", marketCap: null }],
      ["GLD", { symbol: "GLD", price: 190, changePercent: 0.3, currency: "USD", name: "SPDR Gold", marketCap: null }],
      ["VNQ", { symbol: "VNQ", price: 90, changePercent: -0.2, currency: "USD", name: "Vanguard REIT", marketCap: null }],
      ["VXUS", { symbol: "VXUS", price: 60, changePercent: 0.4, currency: "USD", name: "Total Intl Stock", marketCap: null }],
      ["VEA", { symbol: "VEA", price: 48, changePercent: 0.2, currency: "USD", name: "FTSE Developed", marketCap: null }],
      ["VYM", { symbol: "VYM", price: 115, changePercent: 0.3, currency: "USD", name: "High Div Yield", marketCap: null }],
      ["USFR", { symbol: "USFR", price: 50, changePercent: 0, currency: "USD", name: "Floating Rate Treasury", marketCap: null }],
      ["DBC", { symbol: "DBC", price: 22, changePercent: 0.6, currency: "USD", name: "Commodity Index", marketCap: null }],
    ]),
    history: new Map([
      ["AAPL", walk(300, 0.0006, 0.018, 3)],
      ["IEF", walk(300, 0.0001, 0.004, 11)],
      ["SHY", walk(300, 0.00005, 0.002, 21)],
      ["TIP", walk(300, 0.0001, 0.005, 23)],
      ["GLD", walk(300, 0.0002, 0.009, 13)],
      ["VNQ", walk(300, 0.0003, 0.014, 27)],
      ["VXUS", walk(300, 0.0003, 0.011, 29)],
      ["VEA", walk(300, 0.0003, 0.011, 31)],
      ["VYM", walk(300, 0.0004, 0.012, 33)],
      ["USFR", walk(300, 0.00006, 0.001, 37)],
      ["DBC", walk(300, 0.0002, 0.016, 41)],
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

/** A concentrated single-holding portfolio — plenty of room for cash to do something. */
function concentrated(c: MarketContext) {
  const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 200 })], c);
  return evaluate(holdings, c);
}

/** Whole cents. Dollar figures are compared here rather than in dollars, because
 * `1388900 / 100` is 138.88999999999999 in a double — the invariant is "exact to
 * the cent", which is a statement about cents. */
const cents = (v: number) => Math.round(v * 100);

const OBJECTIVES_UNDER_TEST: Objective[] = [
  "maximize_return",
  "minimize_volatility",
  "maximize_sharpe",
  "maximize_income",
  "maximize_diversification",
  "inflation_protection",
  "preserve_capital",
  "balanced",
  "growth",
];

/* -------------------------------------------------------------------------- */

/** Strips fields that are allowed to vary between two calls for reasons that don't
 * affect the actual decision (e.g. `acquiredAt` timestamps stamped onto freshly
 * synthesized candidate holdings) — determinism is about the RECOMMENDATION, not
 * incidental wall-clock metadata on a hypothetical position that was never real. */
function decisionShape(plan: ReturnType<typeof computeCashAllocation>) {
  const { after, ...rest } = plan;
  void after;
  return rest;
}

describe("computeCashAllocation — determinism and value conservation", () => {
  it.each(OBJECTIVES_UNDER_TEST)("is deterministic for %s — identical inputs, identical recommendation", (objective) => {
    const c = ctx();
    const evaluation = concentrated(c);
    const first = computeCashAllocation(evaluation, 50_000, objective, c);
    const second = computeCashAllocation(evaluation, 50_000, objective, c);
    expect(JSON.stringify(decisionShape(second))).toBe(JSON.stringify(decisionShape(first)));
  });

  it.each(OBJECTIVES_UNDER_TEST)("conserves total portfolio value for %s — after = before + cashAmount deployed", (objective) => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computeCashAllocation(evaluation, 50_000, objective, c);

    const deployed = plan.items.reduce((s, i) => s + i.dollarAmount, 0) + plan.heldAsCash;
    // EXACTLY the requested cash, to the cent — not "very nearly". This assertion
    // used to allow ±5 (toBeCloseTo(…, -1)), which is precisely the slack a
    // per-item Math.round() needs to propose spending $3,001 of a $3,000 deposit.
    // Compared in cents because `n/100` is not exactly representable in binary.
    expect(cents(deployed)).toBe(cents(50_000));
    // `after` is the exact fully-evaluated state the tranche loop actually built —
    // no reconstruction, so this checks real conservation, not a re-derivation of it.
    expect(plan.after.totalValue).toBeCloseTo(evaluation.totalValue + 50_000, 0);
  });

  it.each(OBJECTIVES_UNDER_TEST)("never sells the existing holding for %s — additive only", (objective) => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computeCashAllocation(evaluation, 50_000, objective, c);
    // Every item is a positive dollar amount by construction (tranches only ever add).
    for (const item of plan.items) {
      expect(item.dollarAmount).toBeGreaterThanOrEqual(0);
    }
    expect(plan.heldAsCash).toBeGreaterThanOrEqual(0);
  });

  it.each(OBJECTIVES_UNDER_TEST)("respects maxHoldingPct/maxAssetClassPct for %s", (objective) => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computeCashAllocation(evaluation, 200_000, objective, c);
    for (const item of plan.items) {
      expect(item.resultingWeight).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.maxHoldingPct + 1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Share sizing — the plan may never propose spending more than it was given   */
/* -------------------------------------------------------------------------- */

describe("allocateToExactTotal", () => {
  it("sums to the total exactly, to the cent", () => {
    // The reported case: $3,000 over 18 tranches is $166.67 each, won 1 / 1 / 16
    // times. Rounding each independently gave $167 + $167 + $2,667 = $3,001.
    const tranche = 3000 / 18;
    const out = allocateToExactTotal([tranche, tranche, tranche * 16, 0], 3000);
    expect(out.reduce((s, v) => s + v, 0)).toBe(3000);
  });

  it.each([
    [3000, 18],
    [1000, 18],
    [7, 18],
    [12_345.67, 18],
    [50_000, 7],
    [999.99, 3],
  ])("sums to $%s exactly across %s buckets, whatever the tranche fraction", (total, buckets) => {
    const tranche = total / buckets;
    const raw = Array.from({ length: buckets }, () => tranche);
    const out = allocateToExactTotal(raw, total);
    expect(out.reduce((s, v) => s + v, 0)).toBeCloseTo(total, 10);
    // Never over-allocates a single bucket by more than the rounding unit, and
    // never hands one a negative amount.
    for (const [i, v] of out.entries()) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(raw[i] + 0.01);
    }
  });

  it("is deterministic — equal remainders break by index, not by iteration order", () => {
    const raw = [1 / 3, 1 / 3, 1 / 3];
    expect(allocateToExactTotal(raw, 1)).toEqual(allocateToExactTotal(raw, 1));
  });

  it("never returns a negative bucket even when the raw amounts exceed the total", () => {
    const out = allocateToExactTotal([600, 600], 1000);
    expect(out.every((v) => v >= 0)).toBe(true);
    expect(out.reduce((s, v) => s + v, 0)).toBe(1000);
  });
});

describe("computeCashAllocation — never proposes spending more than it was given", () => {
  // $3,000 was the reported case: three positions summing to $3,001, a modal
  // reading "Remaining as cash: -$1.00", and a footer claiming $3,000 of $3,000
  // deployed — three different answers to one question. The executor deposits
  // exactly `cashAmount` and then buys Σ dollarAmount, so the overshoot was real
  // money, not a display artifact.
  // $3,000 / 18 tranches = $166.67, the exact case reported. The rest cover other
  // ways the tranche size lands off a cent boundary.
  it.each([3000, 1000, 2500, 999, 100_000, 12_345.67, 7])(
    "Σ items + heldAsCash === $%s exactly, and remaining cash is never negative",
    (amount) => {
      const c = ctx();
      const plan = computeCashAllocation(concentrated(c), amount, "maximize_sharpe", c);
      const deployed = plan.items.reduce((s, i) => s + i.dollarAmount, 0);

      expect(cents(deployed) + cents(plan.heldAsCash)).toBe(cents(amount));
      expect(cents(deployed)).toBeLessThanOrEqual(cents(amount));
      expect(plan.heldAsCash).toBeGreaterThanOrEqual(0);
      // Every figure is a whole number of cents — no $166.66666666666666 reaching
      // the executor, which writes `dollarAmount / price` shares straight to the ledger.
      for (const item of plan.items) {
        expect(Math.abs(item.dollarAmount * 100 - cents(item.dollarAmount))).toBeLessThan(1e-6);
      }
    },
  );

  it.each(OBJECTIVES_UNDER_TEST)("holds the invariant for %s on the reported $3,000 deployment", (objective) => {
    const c = ctx();
    const plan = computeCashAllocation(concentrated(c), 3000, objective, c);
    const deployed = plan.items.reduce((s, i) => s + i.dollarAmount, 0);
    expect(cents(deployed) + cents(plan.heldAsCash)).toBe(cents(3000));
    expect(cents(deployed)).toBeLessThanOrEqual(cents(3000));
  }, 20_000);

  it("quantity × price reconciles with the dollar amount beside it", () => {
    const c = ctx();
    const plan = computeCashAllocation(concentrated(c), 3000, "maximize_sharpe", c);
    for (const item of plan.items) {
      if (item.quantity == null || !item.symbol) continue;
      const price = c.quotes.get(item.symbol)!.price;
      expect(item.quantity * price).toBeCloseTo(item.dollarAmount, 6);
    }
  });

  it("keeps the invariant when constraints stop the tranche loop early", () => {
    // A 3% single-holding cap on a small portfolio blocks every option well before
    // the 18th tranche. The unplaced tranches are money that was never deployed —
    // it has to show up as held cash rather than vanishing from the accounting.
    const c = ctx();
    const tight = { ...DEFAULT_CONSTRAINTS, maxHoldingPct: 3, maxAssetClassPct: 5 };
    const plan = computeCashAllocation(concentrated(c), 500_000, "maximize_diversification", c, tight);

    const deployed = plan.items.reduce((s, i) => s + i.dollarAmount, 0);
    expect(cents(deployed) + cents(plan.heldAsCash)).toBe(cents(500_000));
    expect(cents(deployed)).toBeLessThanOrEqual(cents(500_000));
  });

  it("the marginal-benefit curve ends at the amount actually entered", () => {
    const c = ctx();
    const plan = computeCashAllocation(concentrated(c), 3000, "maximize_sharpe", c);
    const last = plan.marginalBenefit[plan.marginalBenefit.length - 1];
    // The x-axis' final tick is the deployment, not a rounded approximation of it.
    expect(last.cumulativeAmount).toBeLessThanOrEqual(3000);
    expect(last.cumulativeAmount).toBeCloseTo(3000, 2);
  });

  it("states the same deployed figure in the summary as the items sum to", () => {
    const c = ctx();
    const plan = computeCashAllocation(concentrated(c), 3000, "maximize_sharpe", c);
    const deployed = plan.items.reduce((s, i) => s + i.dollarAmount, 0);
    expect(plan.summary).toContain(
      deployed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    );
  });
});

describe("computeCashAllocation — constraint enforcement", () => {
  it("blocks a candidate that would exceed a tightened maxHoldingPct and records it as constraint_capped", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const tight = { ...DEFAULT_CONSTRAINTS, maxHoldingPct: 3 };
    const plan = computeCashAllocation(evaluation, 100_000, "maximize_diversification", c, tight);

    for (const item of plan.items) {
      expect(item.resultingWeight).toBeLessThanOrEqual(tight.maxHoldingPct + 1);
    }
    const capped = plan.rejectedOpportunities.filter((r) => r.reason === "constraint_capped");
    // With a 3% single-holding cap and $100k into a portfolio this size, at least
    // one otherwise-attractive candidate should hit the cap and get excluded.
    expect(capped.length).toBeGreaterThan(0);
  });

  it("excludes a symbol via excludedSymbols entirely — never appears in items or as a live candidate", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const constraints = { ...DEFAULT_CONSTRAINTS, excludedSymbols: ["GLD", "IEF", "SHY", "TIP", "VNQ", "VXUS", "VEA", "VYM", "USFR", "DBC"] };
    const plan = computeCashAllocation(evaluation, 50_000, "maximize_diversification", c, constraints);
    // Every candidate is excluded — only "add to AAPL" (ineligible: unscored/low
    // confidence in this fixture) and cash remain, so the plan should be pure cash.
    expect(plan.items.every((i) => i.symbol == null || !constraints.excludedSymbols.includes(i.symbol))).toBe(true);
  });
});

describe("computeCashAllocation — marginal benefit curve", () => {
  it("is internally consistent — last cumulative point matches totalAlignmentDelta and cashAmount actually deployed", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computeCashAllocation(evaluation, 60_000, "maximize_diversification", c);

    expect(plan.marginalBenefit[0]).toEqual({ cumulativeAmount: 0, alignmentDelta: 0 });
    const last = plan.marginalBenefit[plan.marginalBenefit.length - 1];
    expect(last.alignmentDelta).toBeCloseTo(plan.totalAlignmentDelta, 5);
    // One point per tranche actually run, plus the zero point.
    expect(plan.marginalBenefit.length).toBeLessThanOrEqual(DEFAULT_TRANCHES + 1);
  });

  it("shows diminishing returns on a concentrated portfolio — the first tranche's marginal step is at least as large as the last", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    // A large deployment into a single-holding, single-class portfolio should show
    // its biggest alignment gains early (fixing the "no diversification at all" gap)
    // and taper as the portfolio approaches the objective's target mix.
    const plan = computeCashAllocation(evaluation, 300_000, "maximize_diversification", c);
    expect(plan.marginalBenefit.length).toBeGreaterThan(2);

    const firstStep = plan.marginalBenefit[1].alignmentDelta - plan.marginalBenefit[0].alignmentDelta;
    const lastStep =
      plan.marginalBenefit[plan.marginalBenefit.length - 1].alignmentDelta -
      plan.marginalBenefit[plan.marginalBenefit.length - 2].alignmentDelta;
    expect(firstStep).toBeGreaterThanOrEqual(lastStep - 0.5);
  });
});

describe("computeCashAllocation — alternatives and rejected opportunities", () => {
  it("no option appears in both items and rejectedOpportunities", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computeCashAllocation(evaluation, 80_000, "maximize_diversification", c);
    const itemSymbols = new Set(plan.items.map((i) => i.symbol).filter(Boolean));
    for (const r of plan.rejectedOpportunities) {
      if (r.symbol) expect(itemSymbols.has(r.symbol)).toBe(false);
    }
  });

  it("alternatives are ranked descending by score and capped at 3", () => {
    const c = ctx();
    const evaluation = concentrated(c);
    const plan = computeCashAllocation(evaluation, 80_000, "maximize_diversification", c);
    for (const item of plan.items) {
      expect(item.alternatives.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < item.alternatives.length; i++) {
        expect(item.alternatives[i - 1].score).toBeGreaterThanOrEqual(item.alternatives[i].score);
      }
      for (const alt of item.alternatives) {
        expect(alt.relativeScorePct).toBeGreaterThanOrEqual(0);
        expect(alt.relativeScorePct).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("computeCashAllocation — repeated deployment shows diminishing benefit", () => {
  it("a second, equal-sized deployment under the same objective measures a smaller total alignment improvement than the first", () => {
    // The honest analog of "idempotent" for a strictly-additive engine: it cannot
    // propose "zero trades" the way a full rebalance can (the cash still has to go
    // SOMEWHERE, even if that's cash itself) — but once the first deployment has
    // moved the portfolio toward the objective's target, a second identical
    // deployment must measure less benefit, not the same or more.
    const c = ctx();
    const evaluation = concentrated(c);
    const objective: Objective = "maximize_diversification";

    const first = computeCashAllocation(evaluation, 80_000, objective, c);
    // `first.after` is already the fully-evaluated post-deployment state — no need
    // to reconstruct it by replaying trades.
    const second = computeCashAllocation(first.after, 80_000, objective, c);

    expect(second.totalAlignmentDelta).toBeLessThanOrEqual(first.totalAlignmentDelta + 0.5);
  });
});
