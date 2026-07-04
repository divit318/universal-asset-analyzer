/**
 * Pure, dependency-free technical indicator computations and candlestick
 * pattern detection. All functions take plain arrays and return plain arrays —
 * no side effects, fully unit-testable.
 */

import type { HistoryPoint } from "./types";

/* -------------------------------------------------------------------------- */
/* Moving averages                                                             */
/* -------------------------------------------------------------------------- */

/** Exponential moving average. First `period - 1` values are null. */
export function calcEma(closes: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let ema: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j];
      ema = sum / period;
      out[i] = ema;
      continue;
    }
    ema = closes[i] * k + (ema ?? closes[i]) * (1 - k);
    out[i] = ema;
  }
  return out;
}

/** Simple moving average. Returns null for indices < period - 1. */
export function calcSma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    out[i] = sum / period;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* RSI                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Relative Strength Index using Wilder's smoothing. Returns null for
 * the first `period` indices. Output range: 0–100.
 */
export function calcRsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain += Math.max(d, 0);
    avgLoss += Math.max(-d, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* MACD                                                                       */
/* -------------------------------------------------------------------------- */

export interface MacdPoint {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

/**
 * MACD (fast=12, slow=26, signal=9 by default).
 * macd = fastEMA − slowEMA; signal = 9-EMA of macd line; histogram = macd − signal.
 */
export function calcMacd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdPoint[] {
  const fastEma = calcEma(closes, fast);
  const slowEma = calcEma(closes, slow);

  const macdLine = closes.map((_, i) =>
    fastEma[i] != null && slowEma[i] != null ? fastEma[i]! - slowEma[i]! : null,
  );

  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const start = macdLine.findIndex((v) => v != null);
  if (start >= 0) {
    const slice = macdLine.slice(start).map((v) => v ?? 0);
    const sigSlice = calcEma(slice, signalPeriod);
    for (let i = 0; i < sigSlice.length; i++) {
      signalLine[start + i] = sigSlice[i];
    }
  }

  return closes.map((_, i) => ({
    macd: macdLine[i],
    signal: signalLine[i],
    histogram:
      macdLine[i] != null && signalLine[i] != null
        ? macdLine[i]! - signalLine[i]!
        : null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Bollinger Bands                                                             */
/* -------------------------------------------------------------------------- */

export interface BollingerPoint {
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

/**
 * Bollinger Bands (period=20, multiplier=2).
 * middle = SMA; upper/lower = middle ± mult × population std dev.
 */
export function calcBollingerBands(
  closes: number[],
  period = 20,
  mult = 2,
): BollingerPoint[] {
  const sma = calcSma(closes, period);
  return closes.map((_, i) => {
    if (sma[i] == null) return { upper: null, middle: null, lower: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i]!;
    const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
  });
}

/* -------------------------------------------------------------------------- */
/* ATR                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Average True Range using Wilder's smoothing (period=14).
 * True Range = max(H−L, |H−prevC|, |L−prevC|).
 */
export function calcAtr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return out;

  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(hl, hc, lc));
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period] = atr;
  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + trs[i - 1]) / period;
    out[i] = atr;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Candlestick pattern detection                                               */
/* -------------------------------------------------------------------------- */

export type PatternDirection = "bullish" | "bearish" | "neutral";

export interface CandlePattern {
  /** Index in the HistoryPoint array of the last candle this pattern spans. */
  index: number;
  name: string;
  direction: PatternDirection;
  description: string;
}

/* Internal candle helpers — all pure, no closure capture */
const body = (o: number, c: number) => Math.abs(c - o);
const range = (h: number, l: number) => h - l;
const upperShadow = (h: number, o: number, c: number) => h - Math.max(o, c);
const lowerShadow = (o: number, c: number, l: number) => Math.min(o, c) - l;
const midpoint = (o: number, c: number) => (o + c) / 2;
const isBull = (o: number, c: number) => c > o;
const isBear = (o: number, c: number) => c < o;
const bodyRatio = (o: number, h: number, c: number, l: number) =>
  range(h, l) > 0 ? body(o, c) / range(h, l) : 0;
/** Two prices are "equal" within 0.1% */
const approxEq = (a: number, b: number) =>
  Math.abs(a - b) <= Math.min(a, b) * 0.001;

/**
 * Detect common single-, two-, and three-candle patterns in a HistoryPoint
 * series. Candles missing OHLC (line-only history) are silently skipped.
 * Returns one entry per detected pattern; the `index` field points to the
 * last candle the pattern spans.
 */
export function detectPatterns(points: HistoryPoint[]): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  const n = points.length;
  if (n < 3) return patterns;

  const isDowntrend = (i: number, lb = 5) =>
    points[i].close < points[Math.max(0, i - lb)].close;
  const isUptrend = (i: number, lb = 5) =>
    points[i].close > points[Math.max(0, i - lb)].close;

  for (let i = 2; i < n; i++) {
    const p0 = points[i - 2];
    const p1 = points[i - 1];
    const p2 = points[i];

    // Skip if any required OHLC field is absent on the current candle
    if (p2.open == null || p2.high == null || p2.low == null) continue;

    const o2 = p2.open, h2 = p2.high, l2 = p2.low, c2 = p2.close;
    const br2 = bodyRatio(o2, h2, c2, l2);
    const us2 = upperShadow(h2, o2, c2);
    const ls2 = lowerShadow(o2, c2, l2);
    const bd2 = body(o2, c2);

    /* ── Single-candle patterns on c2 ─────────────────────────────────── */

    if (br2 < 0.1 && range(h2, l2) > 0) {
      patterns.push({
        index: i,
        name: "Doji",
        direction: "neutral",
        description: "Open ≈ close — market indecision. Watch for confirmation of direction.",
      });
    } else if (
      ls2 >= 2 * Math.max(bd2, 1e-8) &&
      us2 <= Math.max(bd2, range(h2, l2) * 0.1) &&
      isDowntrend(i)
    ) {
      patterns.push({
        index: i,
        name: "Hammer",
        direction: "bullish",
        description: "Long lower wick after a downtrend — buyers rejecting lower prices. Classic bullish reversal.",
      });
    } else if (
      ls2 >= 2 * Math.max(bd2, 1e-8) &&
      us2 <= Math.max(bd2, range(h2, l2) * 0.1) &&
      isUptrend(i)
    ) {
      patterns.push({
        index: i,
        name: "Hanging Man",
        direction: "bearish",
        description: "Hammer shape after an uptrend — sellers pushed prices sharply lower intraday. Bearish warning.",
      });
    } else if (
      us2 >= 2 * Math.max(bd2, 1e-8) &&
      ls2 <= Math.max(bd2, range(h2, l2) * 0.1) &&
      isUptrend(i) &&
      isBear(o2, c2)
    ) {
      patterns.push({
        index: i,
        name: "Shooting Star",
        direction: "bearish",
        description: "Long upper wick after an uptrend — buyers failed to hold gains. Bearish reversal signal.",
      });
    } else if (
      us2 >= 2 * Math.max(bd2, 1e-8) &&
      ls2 <= Math.max(bd2, range(h2, l2) * 0.1) &&
      isDowntrend(i) &&
      isBull(o2, c2)
    ) {
      patterns.push({
        index: i,
        name: "Inverted Hammer",
        direction: "bullish",
        description: "Long upper wick in a downtrend with bullish close — potential bottoming signal.",
      });
    } else if (
      isBull(o2, c2) &&
      br2 > 0.9 &&
      us2 / Math.max(range(h2, l2), 1e-8) < 0.05 &&
      ls2 / Math.max(range(h2, l2), 1e-8) < 0.05
    ) {
      patterns.push({
        index: i,
        name: "Bullish Marubozu",
        direction: "bullish",
        description: "Buyers dominated the full session with virtually no rejection — strong momentum.",
      });
    } else if (
      isBear(o2, c2) &&
      br2 > 0.9 &&
      us2 / Math.max(range(h2, l2), 1e-8) < 0.05 &&
      ls2 / Math.max(range(h2, l2), 1e-8) < 0.05
    ) {
      patterns.push({
        index: i,
        name: "Bearish Marubozu",
        direction: "bearish",
        description: "Sellers dominated the full session — strong bearish momentum.",
      });
    } else if (
      br2 >= 0.1 && br2 < 0.35 &&
      us2 > bd2 * 0.5 &&
      ls2 > bd2 * 0.5
    ) {
      patterns.push({
        index: i,
        name: "Spinning Top",
        direction: "neutral",
        description: "Small body with long shadows on both sides — indecision between buyers and sellers.",
      });
    }

    /* ── Two-candle patterns (p1, p2) ─────────────────────────────────── */

    if (p1.open == null || p1.high == null || p1.low == null) continue;
    const o1 = p1.open, h1 = p1.high, l1 = p1.low, c1 = p1.close;
    const br1 = bodyRatio(o1, h1, c1, l1);
    const bd1 = body(o1, c1);

    if (
      isBear(o1, c1) && isBull(o2, c2) &&
      o2 < c1 && c2 > o1 && br1 > 0.4 && br2 > 0.4
    ) {
      patterns.push({
        index: i,
        name: "Bullish Engulfing",
        direction: "bullish",
        description: "A strong bullish candle fully engulfs the prior bearish body — powerful reversal signal.",
      });
    } else if (
      isBull(o1, c1) && isBear(o2, c2) &&
      o2 > c1 && c2 < o1 && br1 > 0.4 && br2 > 0.4
    ) {
      patterns.push({
        index: i,
        name: "Bearish Engulfing",
        direction: "bearish",
        description: "A strong bearish candle fully engulfs the prior bullish body — powerful reversal signal.",
      });
    } else if (
      isBear(o1, c1) && isBull(o2, c2) && br1 > 0.6 &&
      o2 > c1 && c2 < o1 && bd2 < bd1 * 0.5
    ) {
      patterns.push({
        index: i,
        name: "Bullish Harami",
        direction: "bullish",
        description: "Small bullish candle inside the prior large bearish body — selling pressure may be exhausting.",
      });
    } else if (
      isBull(o1, c1) && isBear(o2, c2) && br1 > 0.6 &&
      o2 < c1 && c2 > o1 && bd2 < bd1 * 0.5
    ) {
      patterns.push({
        index: i,
        name: "Bearish Harami",
        direction: "bearish",
        description: "Small bearish candle inside the prior large bullish body — buying momentum may be fading.",
      });
    } else if (
      isBear(o1, c1) && isBull(o2, c2) && isDowntrend(i) &&
      o2 < l1 && c2 > midpoint(o1, c1) && c2 < o1
    ) {
      patterns.push({
        index: i,
        name: "Piercing Line",
        direction: "bullish",
        description: "After gapping down, bulls reclaim more than half of the prior bearish candle — reversal signal.",
      });
    } else if (
      isBull(o1, c1) && isBear(o2, c2) && isUptrend(i) &&
      o2 > h1 && c2 < midpoint(o1, c1) && c2 > o1
    ) {
      patterns.push({
        index: i,
        name: "Dark Cloud Cover",
        direction: "bearish",
        description: "After gapping up, bears push below the midpoint of the prior bullish candle — reversal warning.",
      });
    } else if (
      isUptrend(i) && approxEq(h1, h2) && isBull(o1, c1) && isBear(o2, c2)
    ) {
      patterns.push({
        index: i,
        name: "Tweezer Top",
        direction: "bearish",
        description: "Two highs at the same level — strong overhead resistance. Potential reversal.",
      });
    } else if (
      isDowntrend(i) && approxEq(l1, l2) && isBear(o1, c1) && isBull(o2, c2)
    ) {
      patterns.push({
        index: i,
        name: "Tweezer Bottom",
        direction: "bullish",
        description: "Two lows at the same level — strong support. Potential reversal.",
      });
    }

    /* ── Three-candle patterns (p0, p1, p2) ─────────────────────────────── */

    if (p0.open == null || p0.high == null || p0.low == null) continue;
    const o0 = p0.open, h0 = p0.high, l0 = p0.low, c0 = p0.close;
    const br0 = bodyRatio(o0, h0, c0, l0);

    if (
      isBear(o0, c0) && br0 > 0.5 &&
      br1 < 0.35 &&
      p1.high! < l0 * 1.005 &&
      isBull(o2, c2) && br2 > 0.4 &&
      c2 > midpoint(o0, c0) &&
      isDowntrend(i)
    ) {
      patterns.push({
        index: i,
        name: "Morning Star",
        direction: "bullish",
        description: "Strong bearish → indecision gap → strong bullish. Classic three-candle bullish reversal.",
      });
    } else if (
      isBull(o0, c0) && br0 > 0.5 &&
      br1 < 0.35 &&
      p1.low! > h0 * 0.995 &&
      isBear(o2, c2) && br2 > 0.4 &&
      c2 < midpoint(o0, c0) &&
      isUptrend(i)
    ) {
      patterns.push({
        index: i,
        name: "Evening Star",
        direction: "bearish",
        description: "Strong bullish → indecision gap → strong bearish. Classic three-candle bearish reversal.",
      });
    } else if (
      isBull(o0, c0) && isBull(o1, c1) && isBull(o2, c2) &&
      br0 > 0.5 && br1 > 0.5 && br2 > 0.5 &&
      c1 > c0 && c2 > c1 && o1 > o0 && o2 > o1
    ) {
      patterns.push({
        index: i,
        name: "Three White Soldiers",
        direction: "bullish",
        description: "Three consecutive strong bullish candles — sustained buying pressure, momentum building.",
      });
    } else if (
      isBear(o0, c0) && isBear(o1, c1) && isBear(o2, c2) &&
      br0 > 0.5 && br1 > 0.5 && br2 > 0.5 &&
      c1 < c0 && c2 < c1 && o1 < o0 && o2 < o1
    ) {
      patterns.push({
        index: i,
        name: "Three Black Crows",
        direction: "bearish",
        description: "Three consecutive strong bearish candles — sustained selling pressure, downtrend accelerating.",
      });
    }
  }

  return patterns;
}

/* -------------------------------------------------------------------------- */
/* Convenience: build all indicators for a HistoryPoint array                 */
/* -------------------------------------------------------------------------- */

export interface TechnicalSummary {
  rsi: (number | null)[];
  macd: MacdPoint[];
  bb: BollingerPoint[];
  atr: (number | null)[];
  patterns: CandlePattern[];
}

/**
 * Compute all indicators and detect patterns in a single pass.
 * Accepts the raw HistoryPoint array from the API.
 */
export function buildTechnicalSummary(points: HistoryPoint[]): TechnicalSummary {
  const closes = points.map((p) => p.close);
  const highs = points.map((p) => p.high ?? p.close);
  const lows = points.map((p) => p.low ?? p.close);

  return {
    rsi: calcRsi(closes),
    macd: calcMacd(closes),
    bb: calcBollingerBands(closes),
    atr: calcAtr(highs, lows, closes),
    patterns: detectPatterns(points),
  };
}
