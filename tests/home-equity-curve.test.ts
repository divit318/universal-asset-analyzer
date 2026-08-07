/**
 * Equity curve — the Book card's 90-day portfolio-vs-benchmark return index.
 *
 * The property under test is the one the contract promises: the line is a
 * RETURN index, not a value line. A deposit mid-window must not move it; a
 * price move must.
 */

import { describe, expect, it } from "vitest";
import { computeEquityCurve } from "@/lib/home/equity-curve";
import type { PortfolioLot } from "@/lib/types";

let nextId = 1;
function lot(overrides: Partial<PortfolioLot> & Pick<PortfolioLot, "symbol" | "shares" | "price" | "tradeDate">): PortfolioLot {
  return {
    id: nextId++,
    name: overrides.symbol,
    kind: "buy",
    fees: 0,
    createdAt: `${overrides.tradeDate}T00:00:00Z`,
    ...overrides,
  } as PortfolioLot;
}

/** N ascending trading days from a start date (skipping nothing — a calendar stub). */
function days(start: string, n: number): string[] {
  const out: string[] = [];
  const t0 = Date.parse(`${start}T12:00:00Z`);
  for (let i = 0; i < n; i++) out.push(new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

function series(dates: string[], closes: number[]): { date: string; close: number }[] {
  return dates.map((date, i) => ({ date, close: closes[i] }));
}

const TODAY = "2026-08-07";
const CAL = days("2026-07-29", 10); // ends on TODAY

describe("computeEquityCurve", () => {
  it("indexes price moves: a 10% rally over the window reads +10 on a 100 base", () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 110];
    const curve = computeEquityCurve({
      lots: [lot({ symbol: "AAA", shares: 10, price: 90, tradeDate: "2026-07-01" })],
      histories: new Map([["AAA", series(CAL, closes)]]),
      benchmark: { symbol: "SPY", history: series(CAL, closes.map((c) => c * 5)) },
      fxSeries: new Map(),
      windowDays: 90,
      today: TODAY,
    });

    expect(curve.status).toBe("ok");
    expect(curve.points[0].portfolio).toBe(100);
    expect(curve.portfolioPct).toBeCloseTo(10, 5);
    // The benchmark rallied identically, so the two normalized lines agree.
    expect(curve.benchmarkPct).toBeCloseTo(10, 5);
  });

  it("strips flows: buying more mid-window does not move the return index", () => {
    const flat = CAL.map(() => 100);
    const curve = computeEquityCurve({
      lots: [
        lot({ symbol: "AAA", shares: 10, price: 100, tradeDate: "2026-07-01" }),
        // A big buy mid-window at the market price — a value line would jump ~5x here.
        lot({ symbol: "AAA", shares: 40, price: 100, tradeDate: CAL[5] }),
      ],
      histories: new Map([["AAA", series(CAL, flat)]]),
      benchmark: { symbol: "SPY", history: series(CAL, flat) },
      fxSeries: new Map(),
      windowDays: 90,
      today: TODAY,
    });

    expect(curve.status).toBe("ok");
    expect(curve.portfolioPct).toBeCloseTo(0, 5);
  });

  it("starts the line at inception when the portfolio is younger than the window", () => {
    const curve = computeEquityCurve({
      lots: [lot({ symbol: "AAA", shares: 5, price: 100, tradeDate: CAL[4] })],
      histories: new Map([["AAA", series(CAL, CAL.map(() => 100))]]),
      benchmark: { symbol: "SPY", history: series(CAL, CAL.map(() => 500)) },
      fxSeries: new Map(),
      windowDays: 90,
      today: TODAY,
    });

    expect(curve.status).toBe("ok");
    expect(curve.points[0].date).toBe(CAL[4]);
    expect(curve.points).toHaveLength(CAL.length - 4);
  });

  it("excludes unpriceable symbols and reports coverage instead of hiding it", () => {
    const closes = CAL.map(() => 100);
    const curve = computeEquityCurve({
      lots: [
        lot({ symbol: "AAA", shares: 10, price: 100, tradeDate: "2026-07-01" }), // priced: $1,000
        lot({ symbol: "ZZZ", shares: 10, price: 100, tradeDate: "2026-07-01" }), // no history: $1,000 at cost
      ],
      histories: new Map([["AAA", series(CAL, closes)]]),
      benchmark: { symbol: "SPY", history: series(CAL, closes) },
      fxSeries: new Map(),
      windowDays: 90,
      today: TODAY,
    });

    expect(curve.status).toBe("ok");
    expect(curve.coveragePct).toBe(50);
  });

  it("is empty for an empty or cash-only ledger", () => {
    const empty = computeEquityCurve({
      lots: [lot({ symbol: "CASH-USD", shares: 1000, price: 1, tradeDate: "2026-07-01" })],
      histories: new Map(),
      benchmark: { symbol: "SPY", history: series(CAL, CAL.map(() => 500)) },
      fxSeries: new Map(),
      windowDays: 90,
      today: TODAY,
    });
    expect(empty.status).toBe("empty");
    expect(empty.points).toHaveLength(0);
  });
});
