import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { buildLotWrites, cashBalancingLot, previewTrades, type TradeToExecute } from "@/lib/portfolio/engines/transaction";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures — mirrors tests/portfolio-universal.test.ts's ctx()/raw() shape.  */
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
    fx: { USD: 1, EUR: 1.08 },
    quotes: new Map([
      ["AAPL", { symbol: "AAPL", price: 200, changePercent: 1.2, currency: "USD", name: "Apple", marketCap: 3e12 }],
      ["IEF", { symbol: "IEF", price: 95, changePercent: -0.1, currency: "USD", name: "7-10y Treasury", marketCap: null }],
    ]),
    history: new Map([
      ["AAPL", walk(300, 0.0006, 0.018, 3)],
      ["IEF", walk(300, 0.0001, 0.004, 11)],
    ]),
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

/* -------------------------------------------------------------------------- */

describe("buildLotWrites", () => {
  it("computes a real BUY lot at the holding's current price", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c);
    const evaluation = evaluate(holdings, c);
    const holding = evaluation.holdings[0];
    const price = holding.valuation.valueBase / holding.quantity;

    const trades: TradeToExecute[] = [{
      holdingId: holding.id, symbol: "AAPL", name: "Apple", assetClass: "equity",
      dollarDelta: 2000, reason: "test buy",
    }];

    const { lots, manualAssetIdsToDelete, skipped } = buildLotWrites(evaluation, trades, { objective: "maximize_sharpe" });

    expect(skipped).toHaveLength(0);
    expect(manualAssetIdsToDelete).toHaveLength(0);
    expect(lots).toHaveLength(1);
    expect(lots[0].kind).toBe("buy");
    expect(lots[0].symbol).toBe("AAPL");
    expect(lots[0].price).toBeCloseTo(price, 6);
    expect(lots[0].shares).toBeCloseTo(2000 / price, 6);
  });

  it("caps a SELL at the holding's actual quantity — never goes negative on price drift", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 10 })], c);
    const evaluation = evaluate(holdings, c);
    const holding = evaluation.holdings[0];

    // A sell far larger than the whole position — simulates the optimizer having
    // proposed a full exit and the price having moved since.
    const trades: TradeToExecute[] = [{
      holdingId: holding.id, symbol: "AAPL", name: "Apple", assetClass: "equity",
      dollarDelta: -1_000_000, reason: "full exit",
    }];

    const { lots } = buildLotWrites(evaluation, trades, { objective: "maximize_sharpe" });
    expect(lots).toHaveLength(1);
    expect(lots[0].kind).toBe("sell");
    expect(lots[0].shares).toBeLessThanOrEqual(holding.quantity);
    expect(lots[0].shares).toBeCloseTo(holding.quantity, 6);
  });

  it("treats any trade against a manual-asset holding as a full delete, never a lot write", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c);
    const evaluation = evaluate(holdings, c);

    const trades: TradeToExecute[] = [{
      holdingId: "manual:abc-123", symbol: null, name: "MSFT Barrier Reverse Convertible",
      assetClass: "structured_product", dollarDelta: -20000, reason: "above target",
    }];

    const { lots, manualAssetIdsToDelete, skipped } = buildLotWrites(evaluation, trades, { objective: "maximize_return" });
    expect(lots).toHaveLength(0);
    expect(skipped).toHaveLength(0);
    expect(manualAssetIdsToDelete).toEqual(["abc-123"]);
  });

  it("skips (never silently drops or crashes on) a holdingId that no longer exists", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c);
    const evaluation = evaluate(holdings, c);

    const trades: TradeToExecute[] = [{
      holdingId: "lot:GHOST", symbol: "GHOST", name: "Ghost Corp", assetClass: "equity",
      dollarDelta: 5000, reason: "stale trade",
    }];

    const { lots, skipped } = buildLotWrites(evaluation, trades, { objective: "maximize_sharpe" });
    expect(lots).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].holdingId).toBe("lot:GHOST");
    expect(skipped[0].reason.length).toBeGreaterThan(0);
  });

  it("synthesizes the CASH-<currency> ledger symbol for a cash holding, ignoring any symbol passed in", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "cash1", assetClass: "cash", quantity: 10000, costBasis: 10000 })], c);
    const evaluation = evaluate(holdings, c);
    const cash = evaluation.holdings[0];

    const trades: TradeToExecute[] = [{
      holdingId: cash.id, symbol: null, name: "USD Cash", assetClass: "cash",
      dollarDelta: -2000, reason: "fund a buy",
    }];

    const { lots } = buildLotWrites(evaluation, trades, { objective: "maximize_return" });
    expect(lots).toHaveLength(1);
    expect(lots[0].symbol).toBe(`CASH-${cash.currency}`);
    expect(lots[0].kind).toBe("sell");
  });

  it("carries the reason/objective/recommendationId/snapshotId through into each lot's meta", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c);
    const evaluation = evaluate(holdings, c);

    const trades: TradeToExecute[] = [{
      holdingId: evaluation.holdings[0].id, symbol: "AAPL", name: "Apple", assetClass: "equity",
      dollarDelta: 1000, reason: "above equities target", recommendationId: "gap:no_bonds",
    }];

    const { lots } = buildLotWrites(evaluation, trades, { objective: "maximize_return", snapshotId: "snap-1" });
    expect(lots[0].meta).toEqual({
      reason: "above equities target",
      objective: "maximize_return",
      recommendationId: "gap:no_bonds",
      snapshotId: "snap-1",
    });
  });
});

describe("previewTrades", () => {
  it("conserves total value and routes the residual to cash (matches execution exactly)", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 50 }),
    ], c);
    const evaluation = evaluate(holdings, c);
    const aapl = evaluation.holdings.find((h) => h.symbol === "AAPL")!;
    const totalBefore = evaluation.totalValue;

    const { after, impact } = previewTrades(evaluation, c, [{ holdingId: aapl.id, targetWeight: 20 }]);

    // Value-conserving now: total is held fixed, AAPL lands EXACTLY on its target
    // weight, and the freed value shows up as a new cash position — the same thing
    // the executor's cash-balancing lot writes, so preview == execution.
    expect(aapl.weight).toBeGreaterThan(75);
    const trimmed = after.holdings.find((h) => h.symbol === "AAPL")!;
    expect(trimmed.weight).toBeCloseTo(20, 1);

    // Total portfolio value is unchanged — a rebalance is not new money.
    expect(after.totalValue).toBeCloseTo(totalBefore, 0);

    // The residual is parked in a base-currency cash holding.
    const cash = after.holdings.find((h) => h.assetClass === "cash");
    expect(cash).toBeDefined();
    expect(cash!.valuation.valueBase).toBeGreaterThan(0);

    // The DB is untouched — this is purely a hypothetical evaluation.
    expect(impact).toBeDefined();
    expect(typeof impact.healthDelta).toBe("number");
  });

  it("does not mutate the input evaluation's holdings", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c);
    const evaluation = evaluate(holdings, c);
    const originalWeight = evaluation.holdings[0].weight;

    previewTrades(evaluation, c, [{ holdingId: evaluation.holdings[0].id, targetWeight: 5 }]);

    expect(evaluation.holdings[0].weight).toBe(originalWeight);
  });
});

/* -------------------------------------------------------------------------- */
/* cashBalancingLot — the entry that makes execution conserve value            */
/* -------------------------------------------------------------------------- */

describe("cashBalancingLot", () => {
  /** Total tracked-value change of a batch, including the balancing lot. Must be ~0
   *  for a value-conserving execution. */
  function netValueChange(
    built: ReturnType<typeof buildLotWrites>,
    plug: ReturnType<typeof cashBalancingLot>,
    evaluation: ReturnType<typeof evaluate>,
  ): number {
    const all = plug ? [...built.lots, plug] : built.lots;
    let change = 0;
    for (const lot of all) change += (lot.kind === "buy" ? 1 : -1) * lot.shares * lot.price;
    for (const id of built.manualAssetIdsToDelete) {
      const h = evaluation.holdings.find((x) => x.id === `manual:${id}`);
      if (h) change -= h.valuation.valueBase;
    }
    return change;
  }

  it("parks NET-SELL proceeds in a cash BUY lot", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c);
    const ev = evaluate(holdings, c);
    const trades: TradeToExecute[] = [{
      holdingId: ev.holdings[0].id, symbol: "AAPL", name: "Apple", assetClass: "equity",
      dollarDelta: -3000, reason: "trim",
    }];
    const built = buildLotWrites(ev, trades, { objective: "maximize_sharpe" });
    const plug = cashBalancingLot(ev, built, "USD");

    expect(plug).not.toBeNull();
    expect(plug!.kind).toBe("buy");
    expect(plug!.symbol).toBe("CASH-USD");
    expect(plug!.price).toBe(1);
    expect(plug!.shares).toBeCloseTo(3000, 0);
    expect(netValueChange(built, plug, ev)).toBeCloseTo(0, 4);
  });

  it("draws from existing cash to fund a NET BUY", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "cash1", assetClass: "cash", quantity: 5000, costBasis: 5000 }),
    ], c);
    const ev = evaluate(holdings, c);
    const aaplId = ev.holdings.find((h) => h.symbol === "AAPL")!.id;
    const trades: TradeToExecute[] = [{
      holdingId: aaplId, symbol: "AAPL", name: "Apple", assetClass: "equity",
      dollarDelta: 2000, reason: "add",
    }];
    const built = buildLotWrites(ev, trades, { objective: "maximize_sharpe" });
    const plug = cashBalancingLot(ev, built, "USD");

    expect(plug!.kind).toBe("sell");
    expect(plug!.symbol).toBe("CASH-USD");
    expect(plug!.shares).toBeCloseTo(2000, 0);
    expect(netValueChange(built, plug, ev)).toBeCloseTo(0, 4);
  });

  it("does not fabricate cash to fund a buy when there is none to draw on", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c);
    const ev = evaluate(holdings, c);
    const trades: TradeToExecute[] = [{
      holdingId: ev.holdings[0].id, symbol: "AAPL", name: "Apple", assetClass: "equity",
      dollarDelta: 2000, reason: "add",
    }];
    const built = buildLotWrites(ev, trades, { objective: "maximize_sharpe" });
    expect(cashBalancingLot(ev, built, "USD")).toBeNull();
  });

  it("needs no balancing entry when buys and sells already net to zero", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
    ], c);
    const ev = evaluate(holdings, c);
    const trades: TradeToExecute[] = [
      { holdingId: ev.holdings.find((h) => h.symbol === "AAPL")!.id, symbol: "AAPL", name: "Apple", assetClass: "equity", dollarDelta: -2000, reason: "trim" },
      { holdingId: ev.holdings.find((h) => h.symbol === "IEF")!.id, symbol: "IEF", name: "Treasury", assetClass: "bond", dollarDelta: 2000, reason: "add" },
    ];
    const built = buildLotWrites(ev, trades, { objective: "maximize_sharpe" });
    expect(cashBalancingLot(ev, built, "USD")).toBeNull();
  });

  it("releases the value of an exited manual asset into cash", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "manual:re1", assetClass: "real_estate", name: "House", manualValue: 300_000, manualValueAsOf: new Date().toISOString(), meta: { details: {} } }),
    ], c);
    const ev = evaluate(holdings, c);
    const trades: TradeToExecute[] = [{
      holdingId: "manual:re1", symbol: null, name: "House", assetClass: "real_estate",
      dollarDelta: -300_000, reason: "exit",
    }];
    const built = buildLotWrites(ev, trades, { objective: "maximize_sharpe" });
    const plug = cashBalancingLot(ev, built, "USD");

    expect(built.manualAssetIdsToDelete).toEqual(["re1"]);
    expect(plug!.kind).toBe("buy");
    expect(plug!.shares).toBeCloseTo(300_000, 0);
    expect(netValueChange(built, plug, ev)).toBeCloseTo(0, 2);
  });

  it("conserves value for a PARTIAL, mixed selection (arbitrary subset of trades)", () => {
    // A partial implementation is just an arbitrary subset — the balancing entry
    // must still make the whole batch net to zero.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100 }),
    ], c);
    const ev = evaluate(holdings, c);
    const trades: TradeToExecute[] = [
      { holdingId: ev.holdings.find((h) => h.symbol === "AAPL")!.id, symbol: "AAPL", name: "Apple", assetClass: "equity", dollarDelta: -3000, reason: "trim" },
      { holdingId: ev.holdings.find((h) => h.symbol === "IEF")!.id, symbol: "IEF", name: "Treasury", assetClass: "bond", dollarDelta: 1000, reason: "add" },
    ];
    const built = buildLotWrites(ev, trades, { objective: "maximize_sharpe" });
    const plug = cashBalancingLot(ev, built, "USD");
    // net -2000 → park 2000 in cash.
    expect(plug!.kind).toBe("buy");
    expect(plug!.shares).toBeCloseTo(2000, 0);
    expect(netValueChange(built, plug, ev)).toBeCloseTo(0, 4);
  });
});
