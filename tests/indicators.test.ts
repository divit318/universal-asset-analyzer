import { describe, expect, it } from "vitest";
import {
  calcEma,
  calcSma,
  calcRsi,
  calcMacd,
  calcBollingerBands,
  calcAtr,
  detectPatterns,
  buildTechnicalSummary,
} from "@/lib/indicators";
import type { HistoryPoint } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Build a HistoryPoint array from close prices only (no OHLC). */
function fromCloses(closes: number[]): HistoryPoint[] {
  return closes.map((c, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, close: c }));
}

/** Build a full OHLCV HistoryPoint array. */
function candle(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1_000_000,
): HistoryPoint {
  return { date, open, high, low, close, volume };
}

/* -------------------------------------------------------------------------- */
/* EMA                                                                        */
/* -------------------------------------------------------------------------- */

describe("calcEma", () => {
  it("returns all nulls when fewer data points than period", () => {
    const out = calcEma([10, 20], 3);
    expect(out).toEqual([null, null]);
  });

  it("seeds with SMA at period-1 index", () => {
    const out = calcEma([10, 20, 30], 3);
    // SMA of [10, 20, 30] = 20
    expect(out[2]).toBeCloseTo(20);
  });

  it("converges correctly for a rising series", () => {
    // For a series [1..10], EMA(3) should be rising
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = calcEma(closes, 3);
    // First two are null
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    // Each subsequent value should be larger than the previous
    for (let i = 3; i < out.length; i++) {
      expect(out[i]!).toBeGreaterThan(out[i - 1]!);
    }
  });

  it("length matches input", () => {
    const closes = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(calcEma(closes, 5)).toHaveLength(30);
  });
});

/* -------------------------------------------------------------------------- */
/* SMA                                                                        */
/* -------------------------------------------------------------------------- */

describe("calcSma", () => {
  it("computes correct SMA values", () => {
    const out = calcSma([2, 4, 6, 8, 10], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(4);   // (2+4+6)/3
    expect(out[3]).toBeCloseTo(6);   // (4+6+8)/3
    expect(out[4]).toBeCloseTo(8);   // (6+8+10)/3
  });

  it("handles period of 1", () => {
    const closes = [5, 10, 15];
    const out = calcSma(closes, 1);
    expect(out).toEqual([5, 10, 15]);
  });

  it("returns all nulls when period exceeds length", () => {
    const out = calcSma([1, 2], 5);
    expect(out.every((v) => v === null)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* RSI                                                                        */
/* -------------------------------------------------------------------------- */

describe("calcRsi", () => {
  it("returns all nulls for insufficient data", () => {
    const out = calcRsi([10, 11, 12], 14);
    expect(out.every((v) => v === null)).toBe(true);
  });

  it("returns 100 for a perfectly rising series", () => {
    // All gains, no losses → RSI should be 100
    const closes = Array.from({ length: 20 }, (_, i) => i + 1);
    const out = calcRsi(closes, 14);
    const nonNull = out.filter((v) => v != null) as number[];
    expect(nonNull[0]).toBeCloseTo(100);
  });

  it("returns 0 for a perfectly falling series", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 20 - i);
    const out = calcRsi(closes, 14);
    const nonNull = out.filter((v) => v != null) as number[];
    expect(nonNull[0]).toBeCloseTo(0);
  });

  it("stays within 0–100 for a mixed series", () => {
    const closes = [44, 46, 48, 47, 50, 52, 51, 53, 55, 56, 54, 57, 59, 60, 62, 61, 63, 65, 64, 66];
    const out = calcRsi(closes, 14);
    const nonNull = out.filter((v): v is number => v != null);
    for (const v of nonNull) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("produces the first value at index `period`", () => {
    const closes = Array.from({ length: 25 }, (_, i) => i % 2 === 0 ? 10 + i : 10 - i);
    const out = calcRsi(closes, 14);
    expect(out[13]).toBeNull();
    expect(out[14]).not.toBeNull();
  });

  it("matches length of input", () => {
    const closes = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(calcRsi(closes, 14)).toHaveLength(30);
  });
});

/* -------------------------------------------------------------------------- */
/* MACD                                                                       */
/* -------------------------------------------------------------------------- */

describe("calcMacd", () => {
  it("returns length matching input", () => {
    const closes = Array.from({ length: 50 }, (_, i) => i + 10);
    const out = calcMacd(closes);
    expect(out).toHaveLength(50);
  });

  it("early entries are all null during warm-up", () => {
    const closes = Array.from({ length: 50 }, (_, i) => i + 10);
    const out = calcMacd(closes, 12, 26, 9);
    // slow EMA needs period-1 = 25 entries before first value
    expect(out[24].macd).toBeNull();
    expect(out[25].macd).not.toBeNull();
  });

  it("histogram = macd - signal", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 50 + Math.sin(i * 0.3) * 10);
    const out = calcMacd(closes);
    for (const pt of out) {
      if (pt.macd != null && pt.signal != null && pt.histogram != null) {
        expect(pt.histogram).toBeCloseTo(pt.macd - pt.signal, 8);
      }
    }
  });

  it("detects bullish crossover (MACD crossing above signal)", () => {
    // Synthetic: rising series causes MACD to cross above signal
    const closes = [
      ...Array.from({ length: 30 }, () => 50),     // flat → MACD ≈ 0
      ...Array.from({ length: 30 }, (_, i) => 50 + i * 2), // sharp rise → MACD > signal
    ];
    const out = calcMacd(closes);
    const validPts = out.filter((p) => p.macd != null && p.signal != null);
    const lastPts = validPts.slice(-5);
    // In the last few points the MACD should be above signal (histogram > 0)
    const lastPos = lastPts.filter((p) => (p.histogram ?? 0) > 0);
    expect(lastPos.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Bollinger Bands                                                             */
/* -------------------------------------------------------------------------- */

describe("calcBollingerBands", () => {
  it("returns nulls for the warm-up period", () => {
    const closes = Array.from({ length: 25 }, (_, i) => i + 1);
    const out = calcBollingerBands(closes, 20);
    expect(out[18].upper).toBeNull();
    expect(out[19].upper).not.toBeNull();
  });

  it("upper > middle > lower", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
    const out = calcBollingerBands(closes, 20);
    for (const pt of out) {
      if (pt.upper != null && pt.middle != null && pt.lower != null) {
        expect(pt.upper).toBeGreaterThan(pt.middle);
        expect(pt.middle).toBeGreaterThan(pt.lower);
      }
    }
  });

  it("middle equals SMA", () => {
    const closes = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210];
    const out = calcBollingerBands(closes, 5);
    // Middle of index 4 = (10+20+30+40+50)/5 = 30
    expect(out[4].middle).toBeCloseTo(30);
    expect(out[5].middle).toBeCloseTo(40);
  });

  it("bands are symmetric around middle", () => {
    const closes = Array.from({ length: 25 }, () => 100);
    const out = calcBollingerBands(closes, 20, 2);
    for (const pt of out) {
      if (pt.upper != null && pt.middle != null && pt.lower != null) {
        // Constant series → std = 0 → all three bands equal
        expect(pt.upper).toBeCloseTo(pt.middle);
        expect(pt.lower).toBeCloseTo(pt.middle);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* ATR                                                                        */
/* -------------------------------------------------------------------------- */

describe("calcAtr", () => {
  it("returns all nulls for insufficient data", () => {
    const out = calcAtr([10], [8], [9], 14);
    expect(out.every((v) => v === null)).toBe(true);
  });

  it("equals average true range for a simple series", () => {
    // H-L is constant at 2, no gaps between candles
    const highs = Array.from({ length: 20 }, () => 11);
    const lows = Array.from({ length: 20 }, () => 9);
    const closes = Array.from({ length: 20 }, () => 10);
    const out = calcAtr(highs, lows, closes, 14);
    // True range always = H-L = 2, so ATR should converge to 2
    const nonNull = out.filter((v): v is number => v != null);
    for (const v of nonNull) {
      expect(v).toBeCloseTo(2, 1);
    }
  });

  it("produces first value at index `period`", () => {
    const highs = Array.from({ length: 20 }, () => 11);
    const lows = Array.from({ length: 20 }, () => 9);
    const closes = Array.from({ length: 20 }, () => 10);
    const out = calcAtr(highs, lows, closes, 14);
    expect(out[13]).toBeNull();
    expect(out[14]).not.toBeNull();
  });

  it("ATR is non-negative", () => {
    const highs = [12, 13, 11, 14, 10, 15, 9, 16, 8, 17, 12, 13, 14, 15, 16, 17];
    const lows =  [9,  10, 8,  11, 7,  12, 6, 13, 5, 14,  9, 10, 11, 12, 13, 14];
    const closes = [10, 11, 9, 12, 8, 13, 7, 14, 6, 15, 11, 12, 13, 14, 15, 16];
    const out = calcAtr(highs, lows, closes, 5);
    for (const v of out) {
      if (v != null) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Pattern detection                                                           */
/* -------------------------------------------------------------------------- */

describe("detectPatterns — Doji", () => {
  it("detects a doji when open ≈ close", () => {
    // Build enough candles to pass the lookback window
    const history: HistoryPoint[] = [
      candle("2024-01-01", 100, 105, 95, 102),
      candle("2024-01-02", 102, 107, 97, 104),
      candle("2024-01-03", 104, 109, 99, 106),
      candle("2024-01-04", 106, 111, 101, 108),
      candle("2024-01-05", 108, 113, 103, 110),
      // Pure doji: open = close, long range
      candle("2024-01-06", 110, 115, 105, 110.05),
    ];
    const patterns = detectPatterns(history);
    expect(patterns.some((p) => p.name === "Doji")).toBe(true);
  });
});

describe("detectPatterns — Bullish Engulfing", () => {
  it("detects bullish engulfing", () => {
    const history: HistoryPoint[] = [
      candle("2024-01-01", 100, 105, 95, 102),
      candle("2024-01-02", 102, 107, 97, 104),
      candle("2024-01-03", 104, 109, 99, 106),
      // Bearish candle
      candle("2024-01-04", 108, 110, 100, 102),
      // Bullish engulfing: opens below prior close, closes above prior open
      candle("2024-01-05", 100, 115, 98, 112),
    ];
    const patterns = detectPatterns(history);
    expect(patterns.some((p) => p.name === "Bullish Engulfing")).toBe(true);
    expect(patterns.find((p) => p.name === "Bullish Engulfing")?.direction).toBe("bullish");
  });
});

describe("detectPatterns — Bearish Engulfing", () => {
  it("detects bearish engulfing", () => {
    const history: HistoryPoint[] = [
      candle("2024-01-01", 90, 95, 85, 92),
      candle("2024-01-02", 92, 97, 87, 95),
      candle("2024-01-03", 95, 100, 90, 99),
      // Bullish candle
      candle("2024-01-04", 97, 105, 96, 104),
      // Bearish engulfing: opens above prior close, closes below prior open
      candle("2024-01-05", 106, 108, 92, 93),
    ];
    const patterns = detectPatterns(history);
    expect(patterns.some((p) => p.name === "Bearish Engulfing")).toBe(true);
    expect(patterns.find((p) => p.name === "Bearish Engulfing")?.direction).toBe("bearish");
  });
});

describe("detectPatterns — Hammer", () => {
  it("detects hammer after a downtrend", () => {
    const history: HistoryPoint[] = [
      // Downtrend
      candle("2024-01-01", 120, 122, 115, 116),
      candle("2024-01-02", 116, 118, 110, 111),
      candle("2024-01-03", 111, 113, 105, 106),
      candle("2024-01-04", 106, 108, 100, 101),
      candle("2024-01-05", 101, 103, 95,  96),
      // Hammer: visible bullish body at top (br≈0.16), long lower wick (≥2×body), tiny upper wick
      // o=94, h=97, l=78, c=97 → body=3, range=19, ls=16, us=0
      candle("2024-01-06", 94, 97, 78, 97),
    ];
    const patterns = detectPatterns(history);
    expect(patterns.some((p) => p.name === "Hammer")).toBe(true);
  });
});

describe("detectPatterns — Shooting Star", () => {
  it("detects shooting star after an uptrend", () => {
    const history: HistoryPoint[] = [
      // Uptrend
      candle("2024-01-01", 80,  82, 78,  81),
      candle("2024-01-02", 81,  84, 80,  83),
      candle("2024-01-03", 83,  86, 82,  85),
      candle("2024-01-04", 85,  88, 84,  87),
      candle("2024-01-05", 87,  90, 86,  89),
      // Shooting star: bearish body (br≈0.14), long upper wick (≥2×body), small lower wick
      // o=92, h=108, l=87, c=89 → body=3, range=21, us=16, ls=2
      candle("2024-01-06", 92, 108, 87, 89),
    ];
    const patterns = detectPatterns(history);
    expect(patterns.some((p) => p.name === "Shooting Star")).toBe(true);
  });
});

describe("detectPatterns — Three White Soldiers", () => {
  it("detects three white soldiers", () => {
    const history: HistoryPoint[] = [
      candle("2024-01-01", 90, 95, 88, 92),
      candle("2024-01-02", 92, 97, 91, 96),
      // Three strong bullish candles with higher highs and closes
      candle("2024-01-03", 96, 102, 95, 101),
      candle("2024-01-04", 101, 108, 100, 107),
      candle("2024-01-05", 107, 114, 106, 113),
    ];
    const patterns = detectPatterns(history);
    expect(patterns.some((p) => p.name === "Three White Soldiers")).toBe(true);
    expect(patterns.find((p) => p.name === "Three White Soldiers")?.direction).toBe("bullish");
  });
});

describe("detectPatterns — Three Black Crows", () => {
  it("detects three black crows", () => {
    const history: HistoryPoint[] = [
      candle("2024-01-01", 110, 112, 105, 108),
      candle("2024-01-02", 108, 110, 103, 105),
      // Three strong bearish candles with lower lows and closes
      candle("2024-01-03", 104, 106, 98, 99),
      candle("2024-01-04", 98, 100, 92, 93),
      candle("2024-01-05", 92, 94, 86, 87),
    ];
    const patterns = detectPatterns(history);
    expect(patterns.some((p) => p.name === "Three Black Crows")).toBe(true);
    expect(patterns.find((p) => p.name === "Three Black Crows")?.direction).toBe("bearish");
  });
});

describe("detectPatterns — edge cases", () => {
  it("returns empty array for fewer than 3 candles", () => {
    const h = [candle("2024-01-01", 10, 12, 9, 11)];
    expect(detectPatterns(h)).toHaveLength(0);
  });

  it("skips candles missing OHLC data", () => {
    const history: HistoryPoint[] = [
      fromCloses([100, 102, 104])[0],
      fromCloses([100, 102, 104])[1],
      fromCloses([100, 102, 104])[2],
    ];
    // These are close-only points (no open/high/low) — no patterns should fire
    const patterns = detectPatterns(history);
    expect(patterns).toHaveLength(0);
  });

  it("index points to last candle in pattern", () => {
    const history: HistoryPoint[] = [
      candle("2024-01-01", 100, 105, 95, 102),
      candle("2024-01-02", 102, 107, 97, 104),
      candle("2024-01-03", 104, 109, 99, 106),
      candle("2024-01-04", 108, 110, 100, 102), // bearish
      candle("2024-01-05", 100, 115, 98, 112),  // bullish engulfing → index = 4
    ];
    const patterns = detectPatterns(history);
    const eng = patterns.find((p) => p.name === "Bullish Engulfing");
    if (eng) expect(eng.index).toBe(4);
  });
});

/* -------------------------------------------------------------------------- */
/* Morning Star / Evening Star                                                 */
/* -------------------------------------------------------------------------- */

describe("detectPatterns — Morning Star", () => {
  it("detects morning star in a downtrend", () => {
    const history: HistoryPoint[] = [
      // Downtrend leading up to the pattern
      candle("2024-01-01", 120, 122, 114, 115),
      candle("2024-01-02", 115, 117, 109, 110),
      candle("2024-01-03", 110, 112, 104, 105),
      // c0: strong bearish
      candle("2024-01-04", 105, 106,  97,  98),
      // c1: doji / small body gapping down
      candle("2024-01-05",  96,  97,  93,  95),
      // c2: strong bullish closing above c0 midpoint
      candle("2024-01-06",  96, 104,  95, 103),
    ];
    const patterns = detectPatterns(history);
    expect(patterns.some((p) => p.name === "Morning Star")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* buildTechnicalSummary convenience function                                 */
/* -------------------------------------------------------------------------- */

describe("buildTechnicalSummary", () => {
  it("returns arrays matching input length", () => {
    const points = fromCloses(Array.from({ length: 50 }, (_, i) => 100 + i));
    const summary = buildTechnicalSummary(points);
    expect(summary.rsi).toHaveLength(50);
    expect(summary.macd).toHaveLength(50);
    expect(summary.bb).toHaveLength(50);
    expect(summary.atr).toHaveLength(50);
  });

  it("handles empty input gracefully", () => {
    const summary = buildTechnicalSummary([]);
    expect(summary.rsi).toHaveLength(0);
    expect(summary.patterns).toHaveLength(0);
  });

  it("falls back high/low to close when OHLC absent", () => {
    // Points with no open/high/low — ATR should be 0 since H = L = C
    const points = fromCloses([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    const summary = buildTechnicalSummary(points);
    const atrNonNull = summary.atr.filter((v): v is number => v != null);
    for (const v of atrNonNull) {
      expect(v).toBeCloseTo(0, 5);
    }
  });
});
