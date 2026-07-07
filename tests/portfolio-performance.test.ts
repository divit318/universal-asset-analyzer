import { describe, it, expect } from "vitest";
import {
  xirr,
  positionPerformance,
  benchmarkComparison,
  priceOnOrBefore,
  portfolioPerformance,
} from "@/lib/portfolio-performance";
import type { PortfolioLot } from "@/lib/types";

let nextId = 1;
function lot(o: Partial<PortfolioLot> & { shares: number; price: number }): PortfolioLot {
  return {
    id: nextId++,
    symbol: "AAPL",
    name: "Apple",
    kind: "buy",
    fees: 0,
    tradeDate: "2025-01-01",
    createdAt: "2025-01-01T00:00:00Z",
    ...o,
  };
}

describe("xirr", () => {
  it("returns null without a sign change", () => {
    expect(xirr([{ date: "2025-01-01", amount: -100 }, { date: "2026-01-01", amount: -50 }])).toBeNull();
    expect(xirr([{ date: "2025-01-01", amount: 100 }])).toBeNull();
  });

  it("solves a doubling over one year to ~100%", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 200 },
    ]);
    expect(r).toBeCloseTo(1.0, 2);
  });

  it("solves a flat return to ~0%", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 100 },
    ]);
    expect(r).toBeCloseTo(0, 3);
  });

  it("handles multiple contributions (money-weighted)", () => {
    // Two $100 buys 6 months apart, worth $230 after a year from the first.
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2025-07-01", amount: -100 },
      { date: "2026-01-01", amount: 230 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.1); // positive, money-weighted > simple naive
  });

  it("solves a loss to a negative rate", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 80 },
    ]);
    expect(r).toBeCloseTo(-0.2, 2);
  });
});

describe("positionPerformance", () => {
  it("splits realized and unrealized P&L", () => {
    const lots = [
      lot({ shares: 10, price: 100, tradeDate: "2025-01-01" }),
      lot({ shares: 4, price: 150, kind: "sell", tradeDate: "2025-06-01" }),
    ];
    const p = positionPerformance(lots, 130, "2026-01-01")!;
    expect(p.shares).toBe(6);
    expect(p.realizedPnl).toBeCloseTo(200, 6); // 4*(150-100)
    expect(p.currentValue).toBeCloseTo(6 * 130, 6);
    expect(p.unrealizedPnl).toBeCloseTo(6 * (130 - 100), 6); // 180
    expect(p.totalPnl).toBeCloseTo(380, 6);
    expect(p.holdingDays).toBe(365);
  });

  it("prices an all-cash-out flow set into an XIRR", () => {
    const p = positionPerformance([lot({ shares: 1, price: 100, tradeDate: "2025-01-01" })], 200, "2026-01-01")!;
    expect(p.xirr).toBeCloseTo(1.0, 2);
  });
});

describe("priceOnOrBefore", () => {
  const hist = [
    { date: "2025-01-01", close: 100 },
    { date: "2025-06-01", close: 120 },
    { date: "2025-12-01", close: 150 },
  ];
  it("returns the last close on or before the date", () => {
    expect(priceOnOrBefore(hist, "2025-06-15")).toBe(120);
    expect(priceOnOrBefore(hist, "2025-12-01")).toBe(150);
  });
  it("falls back to the earliest close for a pre-history date", () => {
    expect(priceOnOrBefore(hist, "2024-01-01")).toBe(100);
  });
});

describe("benchmarkComparison", () => {
  it("computes outperformance sign correctly (portfolio beat index)", () => {
    // Bought AAPL at 100, now 200 (doubled). Index went 100 → 120 over the same window.
    const lots = [lot({ symbol: "AAPL", shares: 1, price: 100, tradeDate: "2025-01-01" })];
    const bench = benchmarkComparison(
      lots,
      "SPY",
      [{ date: "2025-01-01", close: 100 }],
      120,
      "2026-01-01",
      1.0, // portfolio xirr ~100%
    );
    expect(bench).not.toBeNull();
    expect(bench!.currentValue).toBeCloseTo(120, 6); // $100 in index → $120
    expect(bench!.xirr).toBeCloseTo(0.2, 2);
    expect(bench!.outperformancePct!).toBeGreaterThan(0); // portfolio beat the index
  });
});

describe("portfolioPerformance", () => {
  it("aggregates positions and benchmarks against the index", () => {
    const lotsBySymbol = new Map<string, PortfolioLot[]>([
      ["AAPL", [lot({ symbol: "AAPL", name: "Apple", shares: 1, price: 100, tradeDate: "2025-01-01" })]],
      ["MSFT", [lot({ symbol: "MSFT", name: "Microsoft", shares: 1, price: 200, tradeDate: "2025-01-01" })]],
    ]);
    const prices: Record<string, number> = { AAPL: 150, MSFT: 250 };
    const perf = portfolioPerformance(
      lotsBySymbol,
      (s) => prices[s] ?? null,
      "2026-01-01",
      { symbol: "SPY", history: [{ date: "2025-01-01", close: 100 }], priceNow: 110 },
    );
    expect(perf.costBasis).toBeCloseTo(300, 6);
    expect(perf.currentValue).toBeCloseTo(400, 6);
    expect(perf.unrealizedPnl).toBeCloseTo(100, 6);
    expect(perf.positions).toHaveLength(2);
    expect(perf.positions[0].symbol).toBe("MSFT"); // sorted by current value desc
    expect(perf.benchmark?.symbol).toBe("SPY");
    expect(perf.benchmark?.currentValue).toBeCloseTo(330, 6); // $300 in index → +10% = 330
  });
});
