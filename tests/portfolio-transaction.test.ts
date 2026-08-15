import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { buildLotWrites, cashBalancingLot, previewTrades, buildCashDepositLots, type TradeToExecute, type CashDepositItem } from "@/lib/portfolio/engines/transaction";
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

  /* The GLD bug: two rebalances that both meant "close this position" left
     0.0005 shares worth $0.18 behind, because the sell was denominated in
     dollars rounded to the nearest dollar and converted back to units at
     execution. The residue then rendered as a holding in the Commodities group,
     with a weight, a P&L and a quality score. */
  it("snaps a near-total SELL to the whole position rather than leaving dust behind", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 1008.405485345523 })], c);
    const evaluation = evaluate(holdings, c);
    const holding = evaluation.holdings[0];

    // A full exit whose dollar figure has been rounded down to the nearest dollar
    // — exactly what the optimizer used to emit.
    const trades: TradeToExecute[] = [{
      holdingId: holding.id, symbol: "AAPL", name: "Apple", assetClass: "equity",
      dollarDelta: -Math.round(holding.valuation.valueBase - 0.5),
      reason: "full exit",
    }];

    const { lots } = buildLotWrites(evaluation, trades, { objective: "maximize_sharpe" });
    expect(lots).toHaveLength(1);
    expect(lots[0].kind).toBe("sell");
    expect(lots[0].shares).toBe(holding.quantity);
  });

  it("leaves a deliberate partial SELL partial — the snap is for rounding dust only", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 })], c);
    const evaluation = evaluate(holdings, c);
    const holding = evaluation.holdings[0];
    const price = holding.valuation.valueBase / holding.quantity;

    // 95% of the position: the leftover is worth far more than a dollar, so it is
    // a position the user asked to keep, not a rounding artifact.
    const trades: TradeToExecute[] = [{
      holdingId: holding.id, symbol: "AAPL", name: "Apple", assetClass: "equity",
      dollarDelta: -holding.valuation.valueBase * 0.95, reason: "trim",
    }];

    const { lots } = buildLotWrites(evaluation, trades, { objective: "maximize_sharpe" });
    expect(lots[0].shares).toBeCloseTo(95, 6);
    expect(lots[0].shares).toBeLessThan(holding.quantity);
    expect((holding.quantity - lots[0].shares) * price).toBeGreaterThan(1);
  });

  it("turns a FULL disposal of a manual-asset holding into a delete, never a lot write", () => {
    // This test previously asserted that ANY trade against a `manual:` id deletes
    // the asset — including a −$20,000 trade against a position worth far more.
    // That was the bug: the id prefix alone triggered the delete. Fullness is now
    // derived from the trade's own numbers, so the case is stated with a real
    // holding and a delta that genuinely covers it. The partial and buy cases are
    // pinned in tests/portfolio-manual-asset-disposal.test.ts.
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({
        id: "manual:abc-123", assetClass: "structured_product", name: "MSFT Barrier Reverse Convertible",
        costBasis: 20_000, manualValue: 20_000, manualValueAsOf: new Date().toISOString(), meta: { details: {} },
      }),
    ], c);
    const evaluation = evaluate(holdings, c);

    const trades: TradeToExecute[] = [{
      holdingId: "manual:abc-123", symbol: null, name: "MSFT Barrier Reverse Convertible",
      assetClass: "structured_product", dollarDelta: -20_000, reason: "above target",
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

describe("buildCashDepositLots", () => {
  it("always writes the deposit lot first, sized at the full requested amount", () => {
    const c = ctx();
    const { lots, skipped } = buildCashDepositLots(c, 50_000, []);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ symbol: "CASH-USD", kind: "buy", price: 1, shares: 50_000, assetClass: "cash" });
    expect(skipped).toHaveLength(0);
  });

  it("prices each item off the live quote — never a client-supplied price", () => {
    const c = ctx();
    const items: CashDepositItem[] = [{ symbol: "AAPL", name: "Apple", assetClass: "equity", dollarAmount: 4000, reason: "test" }];
    const { lots } = buildCashDepositLots(c, 10_000, items);
    expect(lots).toHaveLength(2); // deposit + the buy
    const buy = lots.find((l) => l.symbol === "AAPL")!;
    expect(buy.kind).toBe("buy");
    expect(buy.price).toBe(200); // AAPL's quoted price in the fixture
    expect(buy.shares).toBeCloseTo(4000 / 200, 6);
  });

  it("can open a BRAND-NEW position never held before — the case buildLotWrites can't express", () => {
    const c = ctx();
    // IEF is a live quote in the fixture but the portfolio holds none of it yet —
    // there is no existing holdingId to look up, unlike a rebalance trade.
    const items: CashDepositItem[] = [{ symbol: "IEF", name: "7-10y Treasury", assetClass: "bond", dollarAmount: 2000, reason: "new position" }];
    const { lots, skipped } = buildCashDepositLots(c, 5000, items);
    expect(skipped).toHaveLength(0);
    const buy = lots.find((l) => l.symbol === "IEF")!;
    expect(buy).toBeDefined();
    expect(buy.price).toBe(95);
  });

  it("skips (never fabricates a price for) a symbol with no live quote", () => {
    const c = ctx();
    const items: CashDepositItem[] = [{ symbol: "NOQUOTE", name: "No Quote Corp", assetClass: "equity", dollarAmount: 1000, reason: "test" }];
    const { lots, skipped } = buildCashDepositLots(c, 5000, items);
    expect(lots.find((l) => l.symbol === "NOQUOTE")).toBeUndefined();
    expect(skipped).toEqual([{ symbol: "NOQUOTE", reason: "No live price available" }]);
  });

  it("skips an item with no symbol rather than crashing", () => {
    const c = ctx();
    const items: CashDepositItem[] = [{ symbol: null, name: "Cash itself", assetClass: "cash", dollarAmount: 1000, reason: "test" }];
    const { lots, skipped } = buildCashDepositLots(c, 5000, items);
    expect(lots).toHaveLength(1); // only the deposit lot
    expect(skipped).toEqual([{ symbol: null, reason: "No ticker to record the trade against" }]);
  });

  it("the deposit lot plus every buy sums to the requested amount deployed", () => {
    const c = ctx();
    const items: CashDepositItem[] = [
      { symbol: "AAPL", name: "Apple", assetClass: "equity", dollarAmount: 3000, reason: "a" },
      { symbol: "IEF", name: "Treasury", assetClass: "bond", dollarAmount: 2000, reason: "b" },
    ];
    const { lots } = buildCashDepositLots(c, 10_000, items);
    const deposit = lots.find((l) => l.symbol === "CASH-USD")!;
    const buys = lots.filter((l) => l.symbol !== "CASH-USD");
    const buysValue = buys.reduce((s, l) => s + l.shares * l.price, 0);
    // Deposit (10000) funds the buys (5000); the rest (5000) simply remains in the
    // deposited cash lot — no separate "held as cash" write needed.
    expect(deposit.shares).toBe(10_000);
    expect(buysValue).toBeCloseTo(5000, 4);
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
    expect(impact.alignmentDelta).not.toBeNull();
    expect(typeof impact.alignmentDelta).toBe("number");
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
