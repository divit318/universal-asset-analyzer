import { describe, expect, it } from "vitest";
import {
  CURATED_PATTERNS,
  buildTechnicalSignals,
  calcVolumeSma,
  computePatternStats,
  defaultPatternInsight,
  detectBreakouts,
  detectGaps,
  detectSupportResistanceReactions,
  type TechnicalSignal,
} from "@/lib/pattern-signals";
import { detectPatterns } from "@/lib/indicators";
import type { HistoryPoint } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function candle(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1_000,
): HistoryPoint {
  return { date, open, high, low, close, volume };
}

function isoDate(i: number): string {
  const d = new Date(2024, 0, 1 + i);
  return d.toISOString().slice(0, 10);
}

/** Flat, low-volatility baseline series — no patterns of interest. */
function flatSeries(n: number, price = 100, volume = 1_000): HistoryPoint[] {
  return Array.from({ length: n }, (_, i) =>
    candle(isoDate(i), price, price + 1, price - 1, price, volume),
  );
}

/* -------------------------------------------------------------------------- */
/* calcVolumeSma                                                              */
/* -------------------------------------------------------------------------- */

describe("calcVolumeSma", () => {
  it("returns null before the period is filled", () => {
    const out = calcVolumeSma([10, 20, 30], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
  });

  it("computes a correct rolling average", () => {
    const out = calcVolumeSma([10, 20, 30, 40, 50], 3);
    expect(out[2]).toBeCloseTo(20); // (10+20+30)/3
    expect(out[3]).toBeCloseTo(30); // (20+30+40)/3
    expect(out[4]).toBeCloseTo(40); // (30+40+50)/3
  });

  it("is null for a window containing missing volume", () => {
    const out = calcVolumeSma([10, undefined, 30], 3);
    expect(out[2]).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* detectBreakouts                                                            */
/* -------------------------------------------------------------------------- */

describe("detectBreakouts", () => {
  it("flags a volume-confirmed close above the prior N-bar high as a Major Breakout", () => {
    const points = flatSeries(20, 100, 1_000);
    points.push(candle(isoDate(20), 108, 111, 107, 110, 5_000)); // breaks the flat 101 high, 5x context volume
    points.push(...flatSeries(5, 110, 1_000).map((p, i) => ({ ...p, date: isoDate(21 + i) })));

    const out = detectBreakouts(points, 20);
    expect(out.some((p) => p.name === "Major Breakout" && p.index === 20)).toBe(true);
    expect(out.find((p) => p.index === 20)?.direction).toBe("bullish");
  });

  it("flags a volume-confirmed close below the prior N-bar low as a Major Breakdown", () => {
    const points = flatSeries(20, 100, 1_000);
    points.push(candle(isoDate(20), 92, 93, 89, 90, 5_000));
    points.push(...flatSeries(5, 90, 1_000).map((p, i) => ({ ...p, date: isoDate(21 + i) })));

    const out = detectBreakouts(points, 20);
    expect(out.some((p) => p.name === "Major Breakdown" && p.index === 20)).toBe(true);
  });

  it("does not flag a new high without volume confirmation", () => {
    const points = flatSeries(20, 100, 1_000);
    points.push(candle(isoDate(20), 100, 102, 99, 101, 1_000)); // new high, but no volume spike
    expect(detectBreakouts(points, 20)).toHaveLength(0);
  });

  it("stays silent on a flat, unremarkable series", () => {
    expect(detectBreakouts(flatSeries(30), 20)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* detectGaps                                                                 */
/* -------------------------------------------------------------------------- */

describe("detectGaps", () => {
  it("flags a gap-up that reverses back through the pre-gap close", () => {
    const points = [
      candle(isoDate(0), 100, 101, 99, 100),
      candle(isoDate(1), 105, 107, 104, 106), // gap up 5%, holds
      candle(isoDate(2), 106, 106, 97, 98),   // reverses below prevClose(100)
      candle(isoDate(3), 98, 99, 96, 97),
    ];
    const out = detectGaps(points, 2, 3);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ index: 2, name: "Gap Reversal", direction: "bearish" });
  });

  it("flags a gap-down that reverses back above the pre-gap close", () => {
    const points = [
      candle(isoDate(0), 100, 101, 99, 100),
      candle(isoDate(1), 95, 96, 93, 94), // gap down 5%, holds
      candle(isoDate(2), 94, 103, 93, 102), // reverses above prevClose(100)
      candle(isoDate(3), 102, 103, 101, 102),
    ];
    const out = detectGaps(points, 2, 3);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ index: 2, name: "Gap Reversal", direction: "bullish" });
  });

  it("ignores gaps below the threshold and gaps that never reverse", () => {
    const smallGap = [
      candle(isoDate(0), 100, 101, 99, 100),
      candle(isoDate(1), 100.5, 101.5, 100, 101), // 0.5% gap, below 2% threshold
    ];
    expect(detectGaps(smallGap, 2, 3)).toHaveLength(0);

    const noReversal = [
      candle(isoDate(0), 100, 101, 99, 100),
      candle(isoDate(1), 106, 108, 105, 107), // gaps up and keeps climbing
      candle(isoDate(2), 107, 110, 106, 109),
      candle(isoDate(3), 109, 112, 108, 111),
      candle(isoDate(4), 111, 114, 110, 113),
    ];
    expect(detectGaps(noReversal, 2, 3)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* detectSupportResistanceReactions                                          */
/* -------------------------------------------------------------------------- */

describe("detectSupportResistanceReactions", () => {
  const points = [
    candle(isoDate(0), 105, 106, 104, 105),
    candle(isoDate(1), 104, 105, 103, 104),
    candle(isoDate(2), 103, 104, 100.2, 102), // touches support ~100, but bearish close -> no bounce here
    candle(isoDate(3), 102, 103, 101, 102.5),
    candle(isoDate(4), 102, 104, 101, 103),
    candle(isoDate(5), 103, 105, 102, 104), // established after this point
    candle(isoDate(6), 104, 106, 103, 105),
    candle(isoDate(7), 105, 107, 104, 106),
    candle(isoDate(8), 106, 108, 105, 107),
    candle(isoDate(9), 100.3, 104, 100.1, 103), // bullish reaction off the established support
  ];
  const levels = { supports: [{ price: 100, touches: 2, lastIndex: 5 }], resistances: [] };

  it("flags a bullish bounce off an established support level", () => {
    const out = detectSupportResistanceReactions(points, levels, 0.5);
    expect(out.some((p) => p.name === "Support Bounce" && p.index === 9)).toBe(true);
  });

  it("does not flag a level that hasn't been established yet at that index", () => {
    const earlyLevels = { supports: [{ price: 100, touches: 2, lastIndex: 9 }], resistances: [] };
    const out = detectSupportResistanceReactions(points, earlyLevels, 0.5);
    expect(out.some((p) => p.index === 9)).toBe(false);
  });

  it("stays silent when price never approaches a level", () => {
    const farLevels = { supports: [{ price: 10, touches: 2, lastIndex: 1 }], resistances: [] };
    expect(detectSupportResistanceReactions(points, farLevels, 0.5)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* buildTechnicalSignals — curation + confidence                              */
/* -------------------------------------------------------------------------- */

function bullishEngulfingSeries(engulfingVolume: number): HistoryPoint[] {
  const points = flatSeries(20, 100, 1_000);
  points.push(candle(isoDate(20), 105, 106, 94, 95, 1_000));       // bearish
  points.push(candle(isoDate(21), 94, 108, 93, 107, engulfingVolume)); // bullish engulfing
  points.push(...flatSeries(5, 107, 1_000).map((p, i) => ({ ...p, date: isoDate(22 + i) })));
  return points;
}

function dojiSeries(): HistoryPoint[] {
  const points = flatSeries(10, 100, 1_000);
  points.push(candle(isoDate(10), 100, 105, 95, 100.02, 1_000)); // open ≈ close, wide range → Doji
  points.push(...flatSeries(5, 100, 1_000).map((p, i) => ({ ...p, date: isoDate(11 + i) })));
  return points;
}

describe("buildTechnicalSignals — curation filter", () => {
  it("never surfaces noise patterns excluded from CURATED_PATTERNS", () => {
    const points = dojiSeries();
    // Sanity: the raw detector does find a Doji here...
    expect(detectPatterns(points).some((p) => p.name === "Doji")).toBe(true);
    // ...but the curated signal builder filters it out.
    const signals = buildTechnicalSignals(points);
    expect(signals.some((s) => s.name === "Doji")).toBe(false);
    expect(["Doji", "Spinning Top", "Bullish Harami", "Bearish Harami"].some((n) => CURATED_PATTERNS.has(n))).toBe(false);
  });

  it("does surface a curated pattern (Bullish Engulfing) when triggered", () => {
    const signals = buildTechnicalSignals(bullishEngulfingSeries(1_000));
    expect(signals.some((s) => s.name === "Bullish Engulfing")).toBe(true);
  });
});

describe("buildTechnicalSignals — confidence scoring", () => {
  it("scores a volume-confirmed occurrence higher than an identical shape without volume confirmation", () => {
    const low = buildTechnicalSignals(bullishEngulfingSeries(1_000));
    const high = buildTechnicalSignals(bullishEngulfingSeries(6_000));

    const lowSignal = low.find((s) => s.name === "Bullish Engulfing");
    const highSignal = high.find((s) => s.name === "Bullish Engulfing");
    expect(lowSignal).toBeDefined();
    expect(highSignal).toBeDefined();
    expect(highSignal!.confidence).toBeGreaterThan(lowSignal!.confidence);
  });

  it("keeps every confidence score clamped to [0, 100]", () => {
    const signals = buildTechnicalSignals(bullishEngulfingSeries(20_000));
    for (const s of signals) {
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("caps confirmations at 5 and flags High Volume when clearly present", () => {
    const signals = buildTechnicalSignals(bullishEngulfingSeries(8_000));
    const signal = signals.find((s) => s.name === "Bullish Engulfing")!;
    expect(signal.confirmations.length).toBeLessThanOrEqual(5);
    expect(signal.confirmations.some((c) => c.label === "High Volume")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* computePatternStats                                                       */
/* -------------------------------------------------------------------------- */

describe("computePatternStats", () => {
  // Deterministic closes: 100 everywhere except a handful of hand-picked points.
  const closes = new Array(32).fill(100);
  closes[10] = 110; // +10% from index 5
  closes[20] = 90;  // -10% from index 15
  closes[30] = 105; // +5% from index 25
  const points: HistoryPoint[] = closes.map((c, i) => candle(isoDate(i), c, c + 1, c - 1, c));

  const signals = [5, 15, 25].map(
    (index): TechnicalSignal => ({
      index,
      name: "Test Bullish",
      direction: "bullish",
      description: "synthetic fixture",
      date: points[index].date,
      span: 1,
      confidence: 70,
      category: "reversal",
      confirmations: [],
    }),
  );

  it("computes exact occurrence count, bullish/bearish split, and average 5-day return", () => {
    const stats = computePatternStats("Test Bullish", signals, points, 5);
    expect(stats.occurrences).toBe(3);
    expect(stats.bullishPct).toBeCloseTo((2 / 3) * 100);
    expect(stats.bearishPct).toBeCloseTo((1 / 3) * 100);
    expect(stats.avgReturnPct).toBeCloseTo((10 - 10 + 5) / 3);
  });

  it("identifies the best and worst occurrences", () => {
    const stats = computePatternStats("Test Bullish", signals, points, 5);
    expect(stats.best?.returnPct).toBeCloseTo(10);
    expect(stats.worst?.returnPct).toBeCloseTo(-10);
  });

  it("provides extended horizon stats for the remaining horizons", () => {
    const stats = computePatternStats("Test Bullish", signals, points, 5);
    const horizons = stats.extended.map((e) => e.horizonDays).sort((a, b) => a - b);
    expect(horizons).toEqual([1, 10, 20]);
  });

  it("returns zeroed stats for a pattern with no occurrences", () => {
    const stats = computePatternStats("Nonexistent Pattern", signals, points, 5);
    expect(stats.occurrences).toBe(0);
    expect(stats.bullishPct).toBe(0);
    expect(stats.best).toBeNull();
    expect(stats.worst).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* defaultPatternInsight                                                     */
/* -------------------------------------------------------------------------- */

describe("defaultPatternInsight", () => {
  it("produces a non-empty sentence referencing the pattern name and direction", () => {
    const signal: TechnicalSignal = {
      index: 10,
      name: "Bullish Engulfing",
      direction: "bullish",
      description: "A strong bullish candle fully engulfs the prior bearish body.",
      date: isoDate(10),
      span: 2,
      confidence: 82,
      category: "reversal",
      confirmations: [{ label: "High Volume", detail: "2.1x average volume" }],
    };
    const insight = defaultPatternInsight(signal);
    expect(insight.length).toBeGreaterThan(0);
    expect(insight).toContain("bullish");
    expect(insight).toContain("82%");
  });
});
