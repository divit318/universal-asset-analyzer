/**
 * Cash funding — the "does buying actually spend my cash, and does the check
 * agree with the Cash tile" regression suite.
 *
 * What broke in production and is pinned here:
 *
 *   1. FALSE "INSUFFICIENT CASH". The Decision Center's buy dialog compared the
 *      purchase against the LARGEST base-currency cash lot instead of the sum
 *      of all of them — a checking + money-market split read as "doesn't
 *      cover" while the Cash tile (which sums) showed plenty. planCashDraw()
 *      is now the one definition, and it sums exactly the set availableBaseCash()
 *      counts.
 *
 *   2. EXACT-BOUNDARY FLIPS. "Buy everything I have" must not bounce off a
 *      float-dust comparison: covered/not-covered is decided within
 *      CASH_SETTLEMENT_TOLERANCE, in both directions.
 *
 *   3. PHANTOM CAPITAL. "Fund from portfolio cash" flows previously recorded
 *      the buy as new money and never debited cash (Research/Watchlist modal
 *      sent no funding at all for its "cash" mode). The draw trades produced
 *      here, pushed through buildLotWrites(), must remove EXACTLY the cost
 *      from cash — and a cash-only batch must never get a balancing plug of
 *      its own (that would double-count the draw).
 */
import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { applyChange, evaluate } from "@/lib/portfolio/engines/simulate";
import { buildLotWrites, cashBalancingLot, planCashDraw } from "@/lib/portfolio/engines/transaction";
import { availableBaseCash, buyFundingCurrency, CASH_SETTLEMENT_TOLERANCE } from "@/lib/portfolio/engines/optimize";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* ── Fixtures — mirrors tests/portfolio-transaction.test.ts's ctx()/raw(). ── */

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
    ]),
    history: new Map([["AAPL", walk(300, 0.0006, 0.018, 3)]]),
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

function cashRaw(id: string, amount: number, currency = "USD"): RawHolding {
  return raw({
    id, assetClass: "cash", symbol: `CASH-${currency}`, name: `${currency} Cash`,
    currency, quantity: amount, unit: "currency", costBasis: amount,
  });
}

function evalWith(raws: RawHolding[], c = ctx()) {
  const { holdings } = normalizeHoldings(raws, c);
  return evaluate(holdings, c);
}

/* ────────────────────────────── planCashDraw ─────────────────────────────── */

describe("planCashDraw", () => {
  it("sums EVERY base-currency cash lot — a checking + money-market split must not read as insufficient", () => {
    // The reported bug: $6k + $5k of cash, an $8k buy, and the old largest-lot
    // check said "doesn't cover" while the Cash tile said $11k.
    const evaluation = evalWith([cashRaw("checking", 6000), cashRaw("mmf", 5000)]);
    const plan = planCashDraw(evaluation, 8000, "USD");

    expect(plan.available).toBeCloseTo(11000, 6);
    expect(plan.covered).toBe(true);
    // Drawn largest-first, across lots, totalling exactly the cost.
    const drawn = plan.trades.reduce((s, t) => s + -t.dollarDelta, 0);
    expect(drawn).toBeCloseTo(8000, 6);
    expect(plan.trades.length).toBe(2);
    expect(-plan.trades[0].dollarDelta).toBeCloseTo(6000, 6);
    expect(-plan.trades[1].dollarDelta).toBeCloseTo(2000, 6);
    // And it counts the same set the executor's own funding check counts.
    expect(plan.available).toBeCloseTo(availableBaseCash(evaluation.holdings, "USD"), 6);
  });

  it("covers a buy of EXACTLY the available cash", () => {
    const evaluation = evalWith([cashRaw("cash", 10_000)]);
    const plan = planCashDraw(evaluation, 10_000, "USD");
    expect(plan.covered).toBe(true);
    expect(plan.trades.reduce((s, t) => s + -t.dollarDelta, 0)).toBeCloseTo(10_000, 6);
  });

  it("float dust cannot flip the boundary in either direction", () => {
    // $100.00000001 of cash funds a $100.00 buy…
    expect(planCashDraw(evalWith([cashRaw("cash", 100.00000001)]), 100, "USD").covered).toBe(true);
    // …a cost inside the settlement tolerance is still covered (draw caps at what exists)…
    const plan = planCashDraw(evalWith([cashRaw("cash", 10_000)]), 10_000.4, "USD");
    expect(plan.covered).toBe(true);
    expect(plan.trades.reduce((s, t) => s + -t.dollarDelta, 0)).toBeLessThanOrEqual(10_000 + 1e-9);
    // …and a material deficit is refused, with the true figure reported.
    const short = planCashDraw(evalWith([cashRaw("cash", 10_000)]), 10_001, "USD");
    expect(short.covered).toBe(false);
    expect(short.trades).toHaveLength(0);
    expect(short.available).toBeCloseTo(10_000, 6);
  });

  it("never counts (or draws) non-base-currency cash", () => {
    const evaluation = evalWith([cashRaw("usd", 1000), cashRaw("eur", 5000, "EUR")]);
    const plan = planCashDraw(evaluation, 2000, "USD");
    expect(plan.covered).toBe(false);
    expect(plan.available).toBeCloseTo(1000, 6);
  });

  it("zero cash and zero/negative cost are refused, never fabricated", () => {
    const noCash = evalWith([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 10 })]);
    expect(planCashDraw(noCash, 500, "USD")).toEqual({ covered: false, available: 0, trades: [] });
    const someCash = evalWith([cashRaw("cash", 500)]);
    expect(planCashDraw(someCash, 0, "USD").covered).toBe(false);
    expect(planCashDraw(someCash, -5, "USD").covered).toBe(false);
  });
});

/* ─────────────── The draw, pushed through the real lot writer ────────────── */

describe("cash draw execution arithmetic", () => {
  it("draw trades become CASH sell lots at price 1 for exactly the cost — and get NO balancing plug", () => {
    const evaluation = evalWith([cashRaw("checking", 6000), cashRaw("mmf", 5000)]);
    const plan = planCashDraw(evaluation, 8000, "USD");
    const built = buildLotWrites(evaluation, plan.trades, { objective: "maximize_sharpe" });

    expect(built.skipped).toHaveLength(0);
    expect(built.lots).toHaveLength(2);
    for (const lot of built.lots) {
      expect(lot.kind).toBe("sell");
      expect(lot.symbol).toBe("CASH-USD");
      expect(lot.price).toBeCloseTo(1, 9);
      expect(lot.assetClass).toBe("cash");
    }
    const cashRemoved = built.lots.reduce((s, l) => s + l.shares * l.price, 0);
    expect(cashRemoved).toBeCloseTo(8000, 6);

    // A cash-only batch is a withdrawal into the pending buy — a balancing plug
    // here would credit the proceeds straight back and undo the draw.
    expect(cashBalancingLot(evaluation, built, "USD")).toBeNull();
  });

  it("user scenario: $10,000 cash, buy $2,000 of AAPL — cash ends at $8,000, position at $2,000", () => {
    // The funded-buy ledger sequence: (1) draw $2,000 of cash, (2) append the
    // $2,000 buy lot. Assert the arithmetic of what gets written.
    const evaluation = evalWith([cashRaw("cash", 10_000)]);
    const plan = planCashDraw(evaluation, 2000, "USD");
    expect(plan.covered).toBe(true);

    const draw = buildLotWrites(evaluation, plan.trades, { objective: "maximize_sharpe" });
    const cashAfter = 10_000 - draw.lots.reduce((s, l) => s + l.shares * l.price, 0);
    expect(cashAfter).toBeCloseTo(8000, 6);

    // The buy lot the route then appends (amount / live price at price):
    const shares = 2000 / 200;
    expect(shares * 200).toBeCloseTo(2000, 9);
    // Total value conserved: cash −2000, position +2000.
    expect(cashAfter + shares * 200).toBeCloseTo(10_000, 6);
  });

  it("sell credits cash; buy draws cash — the balancing plug's two directions", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings(
      [raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100, costBasis: 15_000 }), cashRaw("cash", 5000)],
      c,
    );
    const evaluation = evaluate(holdings, c);
    const aapl = evaluation.holdings.find((h) => h.symbol === "AAPL")!;

    // SELL $2,000 → plug parks $2,000 INTO cash.
    const sell = buildLotWrites(evaluation, [{
      holdingId: aapl.id, symbol: "AAPL", name: "Apple", assetClass: "equity", dollarDelta: -2000, reason: "trim",
    }], { objective: "maximize_sharpe" });
    const sellPlug = cashBalancingLot(evaluation, sell, "USD")!;
    expect(sellPlug.kind).toBe("buy");
    expect(sellPlug.shares).toBeCloseTo(2000, 4);

    // BUY $2,000 → plug draws $2,000 FROM cash.
    const buy = buildLotWrites(evaluation, [{
      holdingId: aapl.id, symbol: "AAPL", name: "Apple", assetClass: "equity", dollarDelta: 2000, reason: "add",
    }], { objective: "maximize_sharpe" });
    const buyPlug = cashBalancingLot(evaluation, buy, "USD")!;
    expect(buyPlug.kind).toBe("sell");
    expect(buyPlug.shares).toBeCloseTo(2000, 4);

    // And the plug never draws more cash than exists (the unfunded remainder is
    // reported, not fabricated).
    const bigBuy = buildLotWrites(evaluation, [{
      holdingId: aapl.id, symbol: "AAPL", name: "Apple", assetClass: "equity", dollarDelta: 9000, reason: "add",
    }], { objective: "maximize_sharpe" });
    const bigPlug = cashBalancingLot(evaluation, bigBuy, "USD")!;
    expect(bigPlug.kind).toBe("sell");
    expect(bigPlug.shares).toBeLessThanOrEqual(5000 + CASH_SETTLEMENT_TOLERANCE);
  });
});

/* ─────────── Simulation parity: funded buys in applyChange() ─────────── */

describe("funded-buy simulation (applyChange + buyFundingCurrency)", () => {
  const totalOf = (hs: { valuation: { valueBase: number } }[]) =>
    hs.reduce((s, h) => s + h.valuation.valueBase, 0);
  const cashOf = (hs: { assetClass: string; currency: string; valuation: { valueBase: number } }[]) =>
    hs.filter((h) => h.assetClass === "cash" && h.currency.toUpperCase() === "USD")
      .reduce((s, h) => s + h.valuation.valueBase, 0);

  it("a funded buy conserves total value: cash down by exactly the amount, position up by it", () => {
    const evaluation = evalWith([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50, costBasis: 8000 }),
      cashRaw("checking", 6000),
      cashRaw("mmf", 5000),
    ]);
    const before = totalOf(evaluation.holdings);
    const candidate = evaluation.holdings.find((h) => h.symbol === "AAPL")!;

    const after = applyChange(evaluation.holdings, {
      kind: "buy", holding: candidate, amount: 8000, fundFromCashCurrency: "USD",
    });

    expect(totalOf(after)).toBeCloseTo(before, 4);
    expect(cashOf(after)).toBeCloseTo(11000 - 8000, 4);
    const aapl = after.find((h) => h.symbol === "AAPL")!;
    expect(aapl.valuation.valueBase).toBeCloseTo(candidate.valuation.valueBase + 8000, 4);
  });

  it("the draw caps at available cash — never negative — mirroring the executor's plug", () => {
    const evaluation = evalWith([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50, costBasis: 8000 }),
      cashRaw("cash", 1000),
    ]);
    const after = applyChange(evaluation.holdings, {
      kind: "buy", holding: evaluation.holdings.find((h) => h.symbol === "AAPL")!, amount: 3000, fundFromCashCurrency: "USD",
    });
    // Cash fully drained (and the emptied lot leaves the book), position grew
    // the full amount: the $2,000 remainder is unfunded growth, exactly what
    // the executor writes and reports.
    expect(cashOf(after)).toBe(0);
    expect(after.some((h) => h.assetClass === "cash")).toBe(false);
  });

  it("an unfunded buy stays additive — cash untouched", () => {
    const evaluation = evalWith([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 50, costBasis: 8000 }),
      cashRaw("cash", 5000),
    ]);
    const after = applyChange(evaluation.holdings, {
      kind: "buy", holding: evaluation.holdings.find((h) => h.symbol === "AAPL")!, amount: 2000,
    });
    expect(cashOf(after)).toBeCloseTo(5000, 6);
  });

  it("buyFundingCurrency marks a buy funded exactly when the engine's own cash sum covers it", () => {
    const evaluation = evalWith([cashRaw("checking", 6000), cashRaw("mmf", 5000)]);
    // Covered (multi-lot sum) → funded in base currency.
    expect(buyFundingCurrency(evaluation.holdings, 8000, "USD")).toBe("USD");
    // Boundary within tolerance → still funded.
    expect(buyFundingCurrency(evaluation.holdings, 11000.4, "USD")).toBe("USD");
    // Materially short → unfunded (execution records new capital, sim stays additive).
    expect(buyFundingCurrency(evaluation.holdings, 11001, "USD")).toBeUndefined();
  });
});
