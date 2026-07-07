import { describe, it, expect } from "vitest";
import { runBacktest, type BacktestInput } from "@/lib/backtest";

const inp = (signal: string, compositeScore: number, realizedReturn: number, symbol = "X"): BacktestInput => ({
  symbol,
  signal,
  compositeScore,
  realizedReturn,
});

describe("runBacktest", () => {
  it("returns an empty result for no inputs", () => {
    const r = runBacktest([]);
    expect(r.evaluated).toBe(0);
    expect(r.longShortSpread).toBeNull();
    expect(r.monotonic).toBe(false);
  });

  it("computes a positive long-short spread when the engine works", () => {
    const r = runBacktest([
      inp("STRONG_BUY", 0.9, 0.12),
      inp("BUY", 0.5, 0.06),
      inp("SELL", -0.5, -0.04),
      inp("STRONG_SELL", -0.9, -0.1),
    ]);
    // bullish mean = 0.09, bearish mean = -0.07 → spread 0.16
    expect(r.longShortSpread).toBeCloseTo(0.16, 4);
    expect(r.monotonic).toBe(true);
    expect(r.scoreReturnCorrelation!).toBeGreaterThan(0.9);
  });

  it("flags a broken engine with a negative spread", () => {
    const r = runBacktest([
      inp("BUY", 0.6, -0.05), // buys fell
      inp("SELL", -0.6, 0.05), // sells rose
    ]);
    expect(r.longShortSpread!).toBeLessThan(0);
    expect(r.monotonic).toBe(false);
    expect(r.scoreReturnCorrelation!).toBeLessThan(0);
  });

  it("computes direction-aware hit rate per tier", () => {
    const r = runBacktest([
      inp("BUY", 0.6, 0.05), // correct (up)
      inp("BUY", 0.6, -0.05), // wrong
      inp("SELL", -0.6, -0.05), // correct (down)
    ]);
    const buy = r.byTier.find((t) => t.signal === "BUY")!;
    expect(buy.count).toBe(2);
    expect(buy.hitRate).toBe(0.5);
    const sell = r.byTier.find((t) => t.signal === "SELL")!;
    expect(sell.hitRate).toBe(1);
  });

  it("orders tiers STRONG_BUY → STRONG_SELL", () => {
    const r = runBacktest([inp("STRONG_SELL", -0.9, 0), inp("STRONG_BUY", 0.9, 0), inp("HOLD", 0, 0)]);
    expect(r.byTier.map((t) => t.signal)).toEqual(["STRONG_BUY", "HOLD", "STRONG_SELL"]);
  });

  it("buckets by score quintile", () => {
    const inputs = Array.from({ length: 10 }, (_, i) => inp("HOLD", i / 10, i / 100));
    const r = runBacktest(inputs);
    expect(r.byScoreQuintile).toHaveLength(5);
    // higher quintile → higher avg return
    expect(r.byScoreQuintile[4].avgReturn).toBeGreaterThan(r.byScoreQuintile[0].avgReturn);
  });
});
