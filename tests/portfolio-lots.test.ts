import { describe, it, expect } from "vitest";
import { aggregateLots, aggregateOpenPositions } from "@/lib/portfolio-lots";
import type { PortfolioLot } from "@/lib/types";

let nextId = 1;
function lot(o: Partial<PortfolioLot> & { shares: number; price: number }): PortfolioLot {
  return {
    id: nextId++,
    symbol: "AAPL",
    name: "Apple Inc.",
    kind: "buy",
    fees: 0,
    tradeDate: "2026-01-01",
    createdAt: "2026-01-01T00:00:00Z",
    ...o,
  };
}

describe("aggregateLots", () => {
  it("returns null for an empty ledger", () => {
    expect(aggregateLots([])).toBeNull();
  });

  it("aggregates a single buy", () => {
    const p = aggregateLots([lot({ shares: 10, price: 100 })])!;
    expect(p.shares).toBe(10);
    expect(p.avgCost).toBe(100);
    expect(p.realizedPnl).toBe(0);
    expect(p.lotCount).toBe(1);
  });

  it("averages the cost of multiple buys and capitalizes fees", () => {
    const p = aggregateLots([
      lot({ shares: 10, price: 100, tradeDate: "2026-01-01" }),
      lot({ shares: 10, price: 120, fees: 20, tradeDate: "2026-02-01" }),
    ])!;
    // (10*100 + 10*120 + 20 fees) / 20 = 2220/20 = 111
    expect(p.shares).toBe(20);
    expect(p.avgCost).toBeCloseTo(111, 6);
    expect(p.totalFees).toBe(20);
  });

  it("realizes P&L on a partial sell and leaves basis unchanged", () => {
    const p = aggregateLots([
      lot({ shares: 10, price: 100, tradeDate: "2026-01-01" }),
      lot({ shares: 4, price: 150, kind: "sell", tradeDate: "2026-03-01" }),
    ])!;
    expect(p.shares).toBe(6);
    expect(p.avgCost).toBeCloseTo(100, 6); // avg cost of remaining shares unchanged
    expect(p.realizedPnl).toBeCloseTo(4 * (150 - 100), 6); // 200
  });

  it("nets sell fees against realized P&L", () => {
    const p = aggregateLots([
      lot({ shares: 10, price: 100 }),
      lot({ shares: 5, price: 130, kind: "sell", fees: 10, tradeDate: "2026-04-01" }),
    ])!;
    expect(p.realizedPnl).toBeCloseTo(5 * (130 - 100) - 10, 6); // 140
  });

  it("marks a fully-exited position as closed (0 shares) with realized P&L intact", () => {
    const p = aggregateLots([
      lot({ shares: 10, price: 100 }),
      lot({ shares: 10, price: 130, kind: "sell", tradeDate: "2026-05-01" }),
    ])!;
    expect(p.shares).toBe(0);
    expect(p.realizedPnl).toBeCloseTo(300, 6);
  });

  it("resets basis after going flat so a re-entry starts fresh", () => {
    const p = aggregateLots([
      lot({ shares: 10, price: 100, tradeDate: "2026-01-01" }),
      lot({ shares: 10, price: 130, kind: "sell", tradeDate: "2026-02-01" }),
      lot({ shares: 5, price: 200, tradeDate: "2026-03-01" }), // re-buy higher
    ])!;
    expect(p.shares).toBe(5);
    expect(p.avgCost).toBeCloseTo(200, 6); // not blended with the old 100 basis
  });

  it("processes lots in trade-date order regardless of input order", () => {
    const unordered = [
      lot({ shares: 4, price: 150, kind: "sell", tradeDate: "2026-03-01" }),
      lot({ shares: 10, price: 100, tradeDate: "2026-01-01" }),
    ];
    const p = aggregateLots(unordered)!;
    expect(p.shares).toBe(6);
    expect(p.realizedPnl).toBeCloseTo(200, 6);
    expect(p.firstTradeDate).toBe("2026-01-01");
  });
});

describe("aggregateOpenPositions", () => {
  it("groups by symbol, excludes closed positions, newest inception first", () => {
    const positions = aggregateOpenPositions([
      lot({ symbol: "AAPL", name: "Apple", shares: 10, price: 100, tradeDate: "2026-01-01" }),
      lot({ symbol: "MSFT", name: "Microsoft", shares: 5, price: 300, tradeDate: "2026-02-01" }),
      // TSLA fully exited → excluded
      lot({ symbol: "TSLA", name: "Tesla", shares: 3, price: 200, tradeDate: "2026-01-15" }),
      lot({ symbol: "TSLA", name: "Tesla", shares: 3, price: 250, kind: "sell", tradeDate: "2026-03-01" }),
    ]);
    expect(positions.map((p) => p.symbol)).toEqual(["MSFT", "AAPL"]); // MSFT inception is later
    expect(positions.find((p) => p.symbol === "TSLA")).toBeUndefined();
  });
});
