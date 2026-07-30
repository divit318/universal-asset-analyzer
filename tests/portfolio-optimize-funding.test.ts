/**
 * Where a rebalancing plan's money comes from.
 *
 * The bug these tests exist for was not arithmetic — it was silence. On a real
 * $9.2M book under Maximize Sharpe the sixteen listed trades bought $1.95M and
 * sold $1.71M, and nothing on the page explained the $242k difference. The
 * optimizer's own invariant (target changes sum to zero across EVERY holding) was
 * exact to the cent; the gap was four sub-1pp trims filtered out of the list, plus
 * the cash row, which is never listed. Both legitimate, neither disclosed, and the
 * only reading available to a user was "this plan is $242k short".
 *
 * So: the invariant is pinned, the funding disclosure is pinned, and the one thing
 * that WOULD be a real financial-correctness failure — a plan that buys more than
 * its sells plus the cash balance can pay for, which the executor settles by
 * drawing what exists and letting the rest inflate tracked value out of nothing —
 * is pinned as never happening silently.
 */
import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import {
  optimize,
  computePlanFunding,
  availableBaseCash,
  DEFAULT_CONSTRAINTS,
  OBJECTIVES,
  CASH_SETTLEMENT_TOLERANCE,
  type Objective,
} from "@/lib/portfolio/engines/optimize";
import { describeIlliquidWeight } from "@/lib/portfolio/model/types";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
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
  AAPL: 200, MSFT: 400, JNJ: 150, TM: 180, JPM: 210,
  VOO: 500, VXUS: 60, VCLT: 75,
  IEF: 95, TIP: 105, SHY: 82,
  GLD: 190, VNQ: 88, O: 55,
};

function ctx(overrides: Partial<MarketContext> = {}): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  let seed = 3;
  return {
    baseCurrency: "USD",
    fx: { USD: 1, EUR: 1.08 },
    quotes: new Map(
      Object.entries(PRICES).map(([symbol, price]) => [
        symbol,
        { symbol, price, changePercent: 0.4, currency: "USD", name: symbol, marketCap: null },
      ]),
    ),
    history: new Map(Object.keys(PRICES).map((s) => [s, walk(300, 0.0004, 0.014, (seed += 4))])),
    fundamentals: new Map(),
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

const ALL_OBJECTIVES = (Object.keys(OBJECTIVES) as Objective[]).filter((o) => o !== "target_allocation");

/**
 * A book shaped like the real one that surfaced this: many equity/ETF names heavy
 * against target, a thin bond sleeve far under target, a large cash balance, and
 * three tiny genuinely-illiquid holdings. That mix is what produces sub-materiality
 * trims — the rows the trade list drops.
 */
function realisticBook(c: MarketContext) {
  const { holdings } = normalizeHoldings([
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 2700, costBasis: 300_000 }),
    raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 1400, costBasis: 300_000 }),
    raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 2900, costBasis: 300_000 }),
    raw({ id: "tm", assetClass: "equity", symbol: "TM", quantity: 2100, costBasis: 300_000 }),
    raw({ id: "jpm", assetClass: "equity", symbol: "JPM", quantity: 1800, costBasis: 300_000 }),
    raw({ id: "voo", assetClass: "etf", symbol: "VOO", quantity: 1550, costBasis: 600_000 }),
    raw({ id: "vxus", assetClass: "etf", symbol: "VXUS", quantity: 12800, costBasis: 600_000 }),
    raw({ id: "vclt", assetClass: "etf", symbol: "VCLT", quantity: 10300, costBasis: 600_000 }),
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 1200, costBasis: 110_000 }),
    raw({ id: "tip", assetClass: "bond", symbol: "TIP", quantity: 1100, costBasis: 110_000 }),
    raw({ id: "shy", assetClass: "bond", symbol: "SHY", quantity: 1400, costBasis: 110_000 }),
    raw({ id: "vnq", assetClass: "reit", symbol: "VNQ", quantity: 2900, costBasis: 240_000 }),
    raw({ id: "o", assetClass: "reit", symbol: "O", quantity: 4800, costBasis: 240_000 }),
    raw({ id: "cash", assetClass: "cash", symbol: null, name: "USD Cash", quantity: 1_250_000, unit: "currency", costBasis: 1_250_000 }),
    // Real, untradeable, and tiny — 0.0% at one decimal place, three holdings.
    raw({ id: "manual:watch", assetClass: "alternative", name: "Rolex Daytona", costBasis: 600, manualValue: 900, manualValueAsOf: new Date().toISOString() }),
    raw({ id: "manual:angel", assetClass: "private_market", name: "Acme AI - Series A", costBasis: 500, manualValue: 500, manualValueAsOf: new Date().toISOString() }),
    raw({ id: "manual:land", assetClass: "real_estate", name: "Land Parcel", costBasis: 350, manualValue: 350, manualValueAsOf: new Date().toISOString() }),
  ], c);
  return evaluate(holdings, c);
}

/* -------------------------------------------------------------------------- */
/* computePlanFunding — the pure arithmetic                                    */
/* -------------------------------------------------------------------------- */

describe("computePlanFunding", () => {
  it("calls a plan whose sells cover its buys self-funded", () => {
    const f = computePlanFunding([{ dollarDelta: 100 }, { dollarDelta: -250 }], 0);
    expect(f.buys).toBe(100);
    expect(f.sells).toBe(250);
    expect(f.gross).toBe(350);
    expect(f.netCash).toBe(-150);
    expect(f.selfFunded).toBe(true);
    expect(f.shortfall).toBe(0);
    expect(f.cashAfter).toBe(150);
  });

  it("reports a cash draw when buys exceed sells but cash covers the difference", () => {
    const f = computePlanFunding([{ dollarDelta: 1000 }, { dollarDelta: -400 }], 5000);
    expect(f.netCash).toBe(600);
    expect(f.selfFunded).toBe(false);
    expect(f.shortfall).toBe(0); // fundable — just not out of the sells
    expect(f.cashAfter).toBe(4400);
  });

  it("reports a shortfall only when sells AND the whole cash balance are exhausted", () => {
    const f = computePlanFunding([{ dollarDelta: 1000 }, { dollarDelta: -400 }], 250);
    expect(f.shortfall).toBe(350);
    expect(f.cashAfter).toBe(-350);
  });

  it("is empty-safe", () => {
    const f = computePlanFunding([], 1000);
    expect(f).toMatchObject({ buys: 0, sells: 0, gross: 0, netCash: 0, selfFunded: true, shortfall: 0 });
  });
});

describe("availableBaseCash", () => {
  it("sums EVERY base-currency cash holding, not just the first", () => {
    // The executor used to `find()` one cash holding. A book with a checking lot
    // and a money-market lot then reported half its liquidity, and a plan the
    // second lot could have funded was silently under-funded instead.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "c1", assetClass: "cash", name: "Checking", quantity: 40_000, unit: "currency", costBasis: 40_000 }),
      raw({ id: "c2", assetClass: "cash", name: "Money market", quantity: 60_000, unit: "currency", costBasis: 60_000 }),
      raw({ id: "eur", assetClass: "cash", name: "EUR Cash", currency: "EUR", quantity: 10_000, unit: "currency", costBasis: 10_000 }),
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
    ], c);
    expect(availableBaseCash(holdings, "USD")).toBeCloseTo(100_000, 6);
    // Non-base cash is deliberately excluded: settling a USD rebalance out of a
    // EUR balance is an FX trade nobody asked for.
    expect(availableBaseCash(holdings, "EUR")).toBeCloseTo(10_000 * 1.08, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* The invariant, and its disclosure                                          */
/* -------------------------------------------------------------------------- */

describe("optimize — plan funding", () => {
  it.each(ALL_OBJECTIVES)(
    "%s: total buys never exceed sell proceeds plus available cash",
    (objective) => {
      const c = ctx();
      const result = optimize(realisticBook(c), objective, DEFAULT_CONSTRAINTS, undefined, c);
      const { funding } = result;

      // THE property. Anything above zero means the executor would draw every
      // dollar of cash and still write buys it could not pay for.
      expect(funding.shortfall).toBe(0);
      expect(funding.buys).toBeLessThanOrEqual(funding.sells + funding.cashAvailable + CASH_SETTLEMENT_TOLERANCE);
      expect(funding.cashAfter).toBeGreaterThanOrEqual(-CASH_SETTLEMENT_TOLERANCE);

      // …and it is never asserted without being reported.
      expect(result.warnings.some((w) => w.includes("would leave that much unfunded"))).toBe(false);
    },
  );

  it.each(ALL_OBJECTIVES)(
    "%s: target changes sum to zero across EVERY holding, so the visible gap is exactly what is unlisted",
    (objective) => {
      const c = ctx();
      const result = optimize(realisticBook(c), objective, DEFAULT_CONSTRAINTS, undefined, c);

      // The engine's governing invariant, in dollars: a rebalance is not new money.
      const total = result.holdings.reduce((s, h) => s + h.dollarDelta, 0);
      expect(total).toBeCloseTo(0, 4);

      // Therefore the trade list's imbalance is, to the cent, the net of the rows
      // it does not show. This is the proof that the buy/sell gap is disclosure
      // rather than a sizing error — and the reason the fix is a funding line and
      // not a change to how trades are sized.
      expect(result.funding.unlistedNetCash).toBeCloseTo(-result.funding.netCash, 4);
    },
  );

  it("counts the sub-materiality trims that explain the gap", () => {
    const c = ctx();
    const result = optimize(realisticBook(c), "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);

    // A book this size necessarily leaves some holdings within 1pp of target. If
    // that ever stops being true this test is not wrong — but the disclosure it
    // guards would then have nothing to disclose, so it must be re-derived.
    expect(result.trades.length).toBeGreaterThan(0);
    if (Math.abs(result.funding.netCash) > CASH_SETTLEMENT_TOLERANCE) {
      const unlistedCount = result.holdings.filter(
        (h) => !result.trades.some((t) => t.holdingId === h.holdingId) && h.dollarDelta !== 0,
      ).length;
      expect(unlistedCount).toBeGreaterThan(0);
    }
  });

  it("reports cashAvailable as the real base-currency cash balance", () => {
    const c = ctx();
    const ev = realisticBook(c);
    const result = optimize(ev, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);
    expect(result.funding.cashAvailable).toBeCloseTo(availableBaseCash(ev.holdings, "USD"), 6);
  });

  it("warns explicitly when a plan cannot be funded, instead of leaving buys silently unpaid", () => {
    // No cash at all, and an objective that wants far more invested than the book
    // is: the sells cannot cover the buys and there is no balance to draw on.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 2 }),
    ], c);
    const ev = evaluate(holdings, c);

    // Force the pathological case rather than hoping an objective produces it:
    // a target that wants everything in the sleeve the book barely holds.
    const result = optimize(ev, "target_allocation", DEFAULT_CONSTRAINTS, { bond: 100 }, c);
    expect(result.funding.cashAvailable).toBe(0);

    if (result.funding.shortfall > CASH_SETTLEMENT_TOLERANCE) {
      expect(result.warnings.some((w) => w.includes("would leave that much unfunded"))).toBe(true);
    } else {
      // Fully funded out of the sells — which is also a legitimate outcome, and
      // then there must be no scare warning.
      expect(result.warnings.some((w) => w.includes("would leave that much unfunded"))).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Class-target deltas — every real change is annotated                        */
/* -------------------------------------------------------------------------- */

describe("optimize — class-target deltas", () => {
  it("emits a nonzero delta for a class that moves less than 1pp, and exactly zero for one that doesn't move", () => {
    // The Optimize tab renders the "(−0.1)" annotation for any row where
    // `delta !== 0`. It used to require `Math.abs(delta) > 1`, which silently
    // dropped the annotation on Forex (0.1% → 0.0%) and on Cash (13.5% → 13.0%) —
    // rendering them identically to Alternatives / Private Markets / Real Estate,
    // whose values genuinely do not change. This pins the DATA side of that: a
    // sub-1pp mover must carry a nonzero delta for the UI to have anything to show.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 2700, costBasis: 300_000 }),
      raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 1200, costBasis: 110_000 }),
      raw({ id: "cash", assetClass: "cash", name: "USD Cash", quantity: 200_000, unit: "currency", costBasis: 200_000 }),
      // A ~0.2% sliver: real, and far under 1pp.
      raw({ id: "fx", assetClass: "forex", symbol: null, name: "USDCHF", quantity: 1500, unit: "currency", costBasis: 1500 }),
      // Frozen at current weight, so its delta is genuinely zero.
      raw({ id: "manual:watch", assetClass: "alternative", name: "Rolex", costBasis: 600, manualValue: 900, manualValueAsOf: new Date().toISOString() }),
    ], c);
    const result = optimize(evaluate(holdings, c), "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);

    const forex = result.classTargets.find((t) => t.assetClass === "forex");
    expect(forex).toBeDefined();
    expect(forex!.currentWeight).toBeGreaterThan(0);
    expect(forex!.targetWeight).toBe(0);
    // Sub-1pp, but not zero — the annotation the old threshold suppressed.
    expect(forex!.delta).not.toBe(0);
    expect(Math.abs(forex!.delta)).toBeLessThan(1);

    // A frozen class does not move, and must therefore report exactly zero — so
    // "delta !== 0" stays a faithful test of "did this actually change".
    const alt = result.classTargets.find((t) => t.assetClass === "alternative");
    expect(alt!.delta).toBe(0);
  });

  it("keeps every class-target delta consistent with its own before/after pair", () => {
    const c = ctx();
    const result = optimize(realisticBook(c), "preserve_capital", DEFAULT_CONSTRAINTS, undefined, c);
    for (const t of result.classTargets) {
      // Both sides are rounded to a tenth independently, so allow a tenth of slack.
      expect(Math.abs(t.delta - (t.targetWeight - t.currentWeight))).toBeLessThanOrEqual(0.11);
      if (t.delta === 0) expect(t.targetWeight).toBeCloseTo(t.currentWeight, 1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Illiquid disclosure — one fact, one wording                                 */
/* -------------------------------------------------------------------------- */

describe("illiquid disclosure", () => {
  it("never states a rounded-to-zero weight without its holding count", () => {
    const d = describeIlliquidWeight(0.0189, 3);
    expect(d.weight).toBe("0.0%");
    expect(d.context).toBe("3 holdings · cannot sell within days");
    expect(d.sentence).toBe("3 holdings (0.0% of value) cannot be sold within days.");
    expect(describeIlliquidWeight(0, 0).context).toBe("Everything can be sold within days");
    expect(describeIlliquidWeight(1.2, 1).sentence).toBe("1 holding (1.2% of value) cannot be sold within days.");
  });

  it("optimizer and Risk Lab state the SAME illiquid fact in the SAME words", () => {
    const c = ctx();
    const ev = realisticBook(c);
    const result = optimize(ev, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);

    // Three real illiquid holdings worth ~$1,750 in a ~$9.2M book.
    expect(ev.risk.illiquidHoldings).toBe(3);
    expect(ev.risk.illiquidPct).toBeLessThan(0.05);

    const expected = describeIlliquidWeight(ev.risk.illiquidPct, ev.risk.illiquidHoldings);
    const banner = result.warnings.find((w) => w.includes("cannot be rebalanced"));
    expect(banner).toBeDefined();
    // The Risk Lab renders `expected.weight` + `expected.context`; the banner
    // renders `expected.sentence`. Same function, so the two cannot drift.
    expect(banner).toContain(expected.sentence);
    // And specifically NOT the old wording, which led with a bare rounded zero.
    expect(banner).not.toMatch(/^0% of the portfolio/);
  });

  it("freezes a holding that takes weeks to sell, matching the ILLIQUID badge it already carries", () => {
    // isIlliquid() counts `t2`. The optimizer used to test `liquidity === "illiquid"`
    // only, so a structured product was badged ILLIQUID on Holdings, counted
    // illiquid by the Risk Lab, and cheerfully proposed for sale here.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 1000, costBasis: 150_000 }),
      raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 500, costBasis: 45_000 }),
      raw({
        id: "manual:note", assetClass: "structured_product", name: "Barrier Note on AAPL",
        costBasis: 50_000, manualValue: 52_000, manualValueAsOf: new Date().toISOString(),
        meta: {
          details: {
            productType: "barrier_reverse_convertible",
            underlyingSymbols: ["AAPL"],
            initialLevels: { AAPL: 180 },
            barrierPercent: 70,
            couponRatePercent: 8,
            participationRatePercent: null,
            principalProtectionPercent: null,
            maturityDate: "2027-06-30",
          },
        },
      }),
    ], c);
    const ev = evaluate(holdings, c);
    const note = ev.holdings.find((h) => h.id === "manual:note")!;
    expect(note.liquidity).toBe("t2");
    expect(ev.risk.illiquidHoldings).toBe(1);

    const result = optimize(ev, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);
    const row = result.holdings.find((h) => h.holdingId === "manual:note")!;
    expect(row.constrained).toBe(true);
    expect(row.action).toBe("HOLD");
    expect(result.trades.some((t) => t.holdingId === "manual:note")).toBe(false);
  });
});
