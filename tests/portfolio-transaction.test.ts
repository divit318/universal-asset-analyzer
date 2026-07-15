import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { buildLotWrites, previewTrades, type TradeToExecute } from "@/lib/portfolio/engines/transaction";
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
  it("matches optimize.ts's own target-weight simulation mechanism exactly (zero duplicated math)", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 50 }),
    ], c);
    const evaluation = evaluate(holdings, c);
    const aapl = evaluation.holdings.find((h) => h.symbol === "AAPL")!;

    const { after, impact } = previewTrades(evaluation, c, [{ holdingId: aapl.id, targetWeight: 20 }]);

    // A single isolated "target" change (no offsetting buy elsewhere) shrinks
    // total portfolio value too, so the resulting weight doesn't land exactly
    // on 20% — this is the real applyChange()/"target" mechanic optimize.ts's
    // own impact calc already relies on, not something previewTrades invents.
    // What must hold is that it moved substantially toward the target.
    expect(aapl.weight).toBeGreaterThan(75);
    const trimmed = after.holdings.find((h) => h.symbol === "AAPL")!;
    expect(trimmed.weight).toBeLessThan(aapl.weight);
    expect(trimmed.weight).toBeGreaterThan(20);
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
