/**
 * Pattern Signals — curates `lib/indicators.ts`'s raw candlestick pattern
 * detection into a short list of *meaningful* technical events, each scored
 * with a deterministic confidence and a handful of confirming signals.
 *
 * `lib/indicators.ts` stays focused on pure indicator math (RSI, MACD,
 * Bollinger, the candlestick shape detector); this module is the "which of
 * these actually matter, and why" layer on top of it — plus the breakout /
 * breakdown / gap / support-resistance detectors that don't exist there yet.
 * Everything here is pure and runs client-side over data already on the page
 * (no fetches) so the chart's pattern list, click-to-zoom, and historical
 * stats never depend on network round trips.
 */

import {
  calcRsi,
  calcSma,
  detectPatterns,
  type CandlePattern,
  type PatternDirection,
} from "./indicators";
import { norm } from "./score-math";
import type { HistoryPoint } from "./types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type PatternCategory =
  | "reversal"
  | "continuation"
  | "breakout"
  | "breakdown"
  | "gap"
  | "support"
  | "resistance";

export interface PatternConfirmation {
  label: string;
  detail: string;
}

export interface TechnicalSignal extends CandlePattern {
  /** ISO date of the candle this signal is anchored to (points[index].date). */
  date: string;
  /** How many candles this pattern spans (1 for Hammer, 3 for Morning Star, etc.). */
  span: number;
  confidence: number; // 0-100, deterministic
  category: PatternCategory;
  confirmations: PatternConfirmation[]; // max 5
}

export interface SwingLevel {
  price: number;
  touches: number;
  lastIndex: number;
}

export interface PatternHorizonStat {
  horizonDays: number;
  winRatePct: number;
  avgReturnPct: number;
}

export interface PatternStats {
  occurrences: number;
  bullishPct: number;
  bearishPct: number;
  avgReturnPct: number; // at the default 5-day horizon
  extended: PatternHorizonStat[]; // 1d/10d/20d, for "View More"
  best: { date: string; returnPct: number } | null;
  worst: { date: string; returnPct: number } | null;
}

/* -------------------------------------------------------------------------- */
/* Curation                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Only patterns worth surfacing as a "Key Technical Signal." Indecision/noise
 * patterns (Doji, Harami, Spinning Top, Piercing Line, Dark Cloud Cover,
 * Tweezer, Marubozu) are deliberately excluded — quality over quantity.
 */
export const CURATED_PATTERNS = new Set<string>([
  "Three Black Crows",
  "Three White Soldiers",
  "Bullish Engulfing",
  "Bearish Engulfing",
  "Morning Star",
  "Evening Star",
  "Hammer",
  "Hanging Man",
  "Shooting Star",
  "Inverted Hammer",
  "Major Breakout",
  "Major Breakdown",
  "Gap Reversal",
  "Support Bounce",
  "Resistance Rejection",
]);

/** How many candles a given pattern name spans, for highlight/zoom purposes. */
const PATTERN_SPAN: Record<string, number> = {
  "Three Black Crows": 3,
  "Three White Soldiers": 3,
  "Morning Star": 3,
  "Evening Star": 3,
  "Bullish Engulfing": 2,
  "Bearish Engulfing": 2,
  "Gap Reversal": 2,
};
const spanFor = (name: string) => PATTERN_SPAN[name] ?? 1;

const CATEGORY_BY_NAME: Record<string, PatternCategory> = {
  "Three Black Crows": "reversal",
  "Three White Soldiers": "reversal",
  "Bullish Engulfing": "reversal",
  "Bearish Engulfing": "reversal",
  "Morning Star": "reversal",
  "Evening Star": "reversal",
  Hammer: "reversal",
  "Hanging Man": "reversal",
  "Shooting Star": "reversal",
  "Inverted Hammer": "reversal",
  "Major Breakout": "breakout",
  "Major Breakdown": "breakdown",
  "Gap Reversal": "gap",
  "Support Bounce": "support",
  "Resistance Rejection": "resistance",
};

/* -------------------------------------------------------------------------- */
/* Volume                                                                      */
/* -------------------------------------------------------------------------- */

/** Rolling simple-average volume. Returns null for indices < period - 1 or missing volume. */
export function calcVolumeSma(volumes: (number | undefined)[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(volumes.length).fill(null);
  for (let i = period - 1; i < volumes.length; i++) {
    let sum = 0;
    let missing = false;
    for (let j = i - period + 1; j <= i; j++) {
      const v = volumes[j];
      if (v == null) { missing = true; break; }
      sum += v;
    }
    out[i] = missing ? null : sum / period;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Swing highs/lows → support & resistance levels                             */
/* -------------------------------------------------------------------------- */

/**
 * Local swing highs/lows (a `±lookback`-window extremum), clustered by ~1%
 * price proximity into support/resistance levels. A level needs >=2 touches
 * to be considered "established."
 */
export function detectSwingLevels(
  points: HistoryPoint[],
  lookback = 5,
): { supports: SwingLevel[]; resistances: SwingLevel[] } {
  const n = points.length;
  const swingHighs: { price: number; index: number }[] = [];
  const swingLows: { price: number; index: number }[] = [];

  for (let i = lookback; i < n - lookback; i++) {
    const high = points[i].high ?? points[i].close;
    const low = points[i].low ?? points[i].close;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      const h = points[j].high ?? points[j].close;
      const l = points[j].low ?? points[j].close;
      if (h >= high) isHigh = false;
      if (l <= low) isLow = false;
    }
    if (isHigh) swingHighs.push({ price: high, index: i });
    if (isLow) swingLows.push({ price: low, index: i });
  }

  const cluster = (swings: { price: number; index: number }[]): SwingLevel[] => {
    const sorted = [...swings].sort((a, b) => a.price - b.price);
    const levels: SwingLevel[] = [];
    for (const s of sorted) {
      const last = levels.at(-1);
      if (last && Math.abs(s.price - last.price) <= last.price * 0.01) {
        // merge into the existing cluster — weighted toward more touches
        last.price = (last.price * last.touches + s.price) / (last.touches + 1);
        last.touches += 1;
        last.lastIndex = Math.max(last.lastIndex, s.index);
      } else {
        levels.push({ price: s.price, touches: 1, lastIndex: s.index });
      }
    }
    return levels.filter((l) => l.touches >= 2);
  };

  return { supports: cluster(swingLows), resistances: cluster(swingHighs) };
}

/* -------------------------------------------------------------------------- */
/* Breakouts / breakdowns                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Flags a candle that closes beyond the prior `nBars` high/low on above-average
 * volume — a "Major Breakout" (bullish) or "Major Breakdown" (bearish). The
 * volume multiplier keeps this from firing on every minor new high.
 */
export function detectBreakouts(points: HistoryPoint[], nBars = 20): CandlePattern[] {
  const out: CandlePattern[] = [];
  const volumes = points.map((p) => p.volume);
  const volSma = calcVolumeSma(volumes, 20);

  for (let i = nBars; i < points.length; i++) {
    const p = points[i];
    if (p.close == null) continue;
    const vol = p.volume;
    const avgVol = volSma[i];
    const hasVolumeConfirmation = vol != null && avgVol != null && vol > 1.5 * avgVol;
    if (!hasVolumeConfirmation) continue;

    let priorHigh = -Infinity;
    let priorLow = Infinity;
    for (let j = i - nBars; j < i; j++) {
      const h = points[j].high ?? points[j].close;
      const l = points[j].low ?? points[j].close;
      if (h > priorHigh) priorHigh = h;
      if (l < priorLow) priorLow = l;
    }

    if (p.close > priorHigh) {
      out.push({
        index: i,
        name: "Major Breakout",
        direction: "bullish",
        description: `Close broke above the prior ${nBars}-bar high on ${(vol! / avgVol!).toFixed(1)}x average volume — a decisive, volume-confirmed breakout.`,
      });
    } else if (p.close < priorLow) {
      out.push({
        index: i,
        name: "Major Breakdown",
        direction: "bearish",
        description: `Close broke below the prior ${nBars}-bar low on ${(vol! / avgVol!).toFixed(1)}x average volume — a decisive, volume-confirmed breakdown.`,
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Gaps                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A gap of at least `thresholdPct` between one day's close and the next day's
 * open, where price reverses back through the pre-gap close within
 * `reversalBars` — tagged at the candle where the reversal completes.
 */
export function detectGaps(
  points: HistoryPoint[],
  thresholdPct = 2,
  reversalBars = 3,
): CandlePattern[] {
  const out: CandlePattern[] = [];
  for (let i = 1; i < points.length; i++) {
    const prevClose = points[i - 1].close;
    const open = points[i].open;
    if (prevClose == null || open == null || prevClose === 0) continue;
    const gapPct = ((open - prevClose) / prevClose) * 100;
    if (Math.abs(gapPct) < thresholdPct) continue;

    const gapUp = gapPct > 0;
    const end = Math.min(points.length - 1, i + reversalBars);
    for (let j = i; j <= end; j++) {
      const close = points[j].close;
      if (close == null) continue;
      const reversed = gapUp ? close < prevClose : close > prevClose;
      if (reversed) {
        out.push({
          index: j,
          name: "Gap Reversal",
          direction: gapUp ? "bearish" : "bullish",
          description: `Price gapped ${gapUp ? "up" : "down"} ${Math.abs(gapPct).toFixed(1)}% and reversed back through the pre-gap close within ${j - i + 1} session(s) — the gap failed to hold.`,
        });
        break;
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Support / resistance reactions                                             */
/* -------------------------------------------------------------------------- */

/**
 * A candle whose low/high comes within `tolerancePct` of an established
 * support/resistance level, with a close that confirms a bounce (off support)
 * or rejection (off resistance).
 */
export function detectSupportResistanceReactions(
  points: HistoryPoint[],
  levels: { supports: SwingLevel[]; resistances: SwingLevel[] },
  tolerancePct = 0.5,
): CandlePattern[] {
  const out: CandlePattern[] = [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const low = p.low ?? p.close;
    const high = p.high ?? p.close;
    if (p.close == null || p.open == null) continue;

    for (const level of levels.supports) {
      if (level.lastIndex >= i) continue; // level must be established before this candle
      const near = Math.abs(low - level.price) <= level.price * (tolerancePct / 100);
      if (near && p.close > p.open && p.close > level.price) {
        out.push({
          index: i,
          name: "Support Bounce",
          direction: "bullish",
          description: `Price touched the established support near ${level.price.toFixed(2)} (${level.touches} prior touches) and bounced — buyers defended the level.`,
        });
        break;
      }
    }
    for (const level of levels.resistances) {
      if (level.lastIndex >= i) continue;
      const near = Math.abs(high - level.price) <= level.price * (tolerancePct / 100);
      if (near && p.close < p.open && p.close < level.price) {
        out.push({
          index: i,
          name: "Resistance Rejection",
          direction: "bearish",
          description: `Price touched the established resistance near ${level.price.toFixed(2)} (${level.touches} prior touches) and rejected — sellers defended the level.`,
        });
        break;
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Confidence scoring                                                          */
/* -------------------------------------------------------------------------- */

function patternStrengthScore(pattern: CandlePattern, points: HistoryPoint[]): number {
  const i = pattern.index;
  const p = points[i];
  if (p.open == null || p.high == null || p.low == null) return 50;
  const range = p.high - p.low;
  const body = Math.abs(p.close - p.open);
  const bodyRatio = range > 0 ? body / range : 0;

  switch (pattern.name) {
    case "Bullish Engulfing":
    case "Bearish Engulfing": {
      const prev = points[i - 1];
      if (prev.open == null) return 50;
      const prevBody = Math.abs(prev.close - prev.open);
      return norm(prevBody > 0 ? body / prevBody : 1, 1, 2.5) ?? 50;
    }
    case "Hammer":
    case "Inverted Hammer":
    case "Hanging Man":
    case "Shooting Star": {
      const shadow = pattern.name === "Hammer" || pattern.name === "Hanging Man"
        ? Math.min(p.open, p.close) - p.low
        : p.high - Math.max(p.open, p.close);
      return norm(body > 0 ? shadow / body : 5, 2, 5) ?? 50;
    }
    case "Major Breakout":
    case "Major Breakdown":
      return norm(bodyRatio, 0.3, 0.9) ?? 50;
    case "Gap Reversal":
      return 70; // gap reversals are inherently notable; strength captured in the volume/trend components
    case "Support Bounce":
    case "Resistance Rejection":
      return 65;
    default:
      return norm(bodyRatio, 0.4, 0.9) ?? 50;
  }
}

function volumeConfirmationScore(index: number, points: HistoryPoint[], volSma: (number | null)[]): number {
  const vol = points[index].volume;
  const avg = volSma[index];
  if (vol == null || avg == null || avg === 0) return 50; // neutral when volume data is unavailable
  return norm(vol / avg, 0.8, 2.5) ?? 50;
}

function trendContextScore(pattern: CandlePattern, points: HistoryPoint[], sma20: (number | null)[]): number {
  const i = pattern.index;
  const lookback = Math.max(0, i - 10);
  const cur = sma20[i];
  const prior = sma20[lookback];
  if (cur == null || prior == null || prior === 0) return 50;
  const slopePct = ((cur - prior) / Math.abs(prior)) * 100;

  const reversalNames = new Set([
    "Three Black Crows", "Three White Soldiers", "Bullish Engulfing", "Bearish Engulfing",
    "Morning Star", "Evening Star", "Hammer", "Hanging Man", "Shooting Star", "Inverted Hammer",
  ]);
  if (reversalNames.has(pattern.name)) {
    // A reversal is more meaningful when it opposes a clear prevailing trend.
    const opposesUptrend = pattern.direction === "bearish" && slopePct > 0.5;
    const opposesDowntrend = pattern.direction === "bullish" && slopePct < -0.5;
    if (opposesUptrend || opposesDowntrend) return norm(Math.abs(slopePct), 0.5, 5) ?? 50;
    return 35; // reversal pattern without a clear trend to reverse is weaker
  }
  // Breakouts/breakdowns/gaps/support-resistance: alignment with the trend direction is confirming.
  const alignsUp = pattern.direction === "bullish" && slopePct > 0;
  const alignsDown = pattern.direction === "bearish" && slopePct < 0;
  if (alignsUp || alignsDown) return norm(Math.abs(slopePct), 0, 5) ?? 50;
  return 45;
}

/* -------------------------------------------------------------------------- */
/* Confirmations                                                               */
/* -------------------------------------------------------------------------- */

function computeConfirmations(
  pattern: CandlePattern,
  points: HistoryPoint[],
  levels: { supports: SwingLevel[]; resistances: SwingLevel[] },
  volSma: (number | null)[],
  rsi: (number | null)[],
  sma50: (number | null)[],
  sma200: (number | null)[],
): PatternConfirmation[] {
  const i = pattern.index;
  const p = points[i];
  const out: PatternConfirmation[] = [];

  const vol = p.volume;
  const avgVol = volSma[i];
  if (vol != null && avgVol != null && avgVol > 0 && vol > 1.5 * avgVol) {
    out.push({ label: "High Volume", detail: `${(vol / avgVol).toFixed(1)}x average volume` });
  }

  const price = p.close;
  const tolerance = price * 0.01;
  const brokenSupport = levels.supports.find((l) => l.lastIndex < i && price < l.price - tolerance && (points[i - 1]?.close ?? price) >= l.price - tolerance);
  const brokenResistance = levels.resistances.find((l) => l.lastIndex < i && price > l.price + tolerance && (points[i - 1]?.close ?? price) <= l.price + tolerance);
  if (brokenSupport) out.push({ label: "Break of Support", detail: `Below ${brokenSupport.price.toFixed(2)}` });
  if (brokenResistance) out.push({ label: "Break of Resistance", detail: `Above ${brokenResistance.price.toFixed(2)}` });

  if (!brokenSupport) {
    const nearSupport = levels.supports.find((l) => l.lastIndex < i && Math.abs(price - l.price) <= tolerance);
    if (nearSupport) out.push({ label: "Support Nearby", detail: `~${nearSupport.price.toFixed(2)}` });
  }
  if (!brokenResistance) {
    const nearResistance = levels.resistances.find((l) => l.lastIndex < i && Math.abs(price - l.price) <= tolerance);
    if (nearResistance) out.push({ label: "Resistance Nearby", detail: `~${nearResistance.price.toFixed(2)}` });
  }

  // RSI divergence: price makes a new local extreme but RSI doesn't confirm it.
  const lb = Math.max(0, i - 10);
  const priorCloseExtreme = pattern.direction === "bullish"
    ? Math.min(...points.slice(lb, i).map((pt) => pt.close))
    : Math.max(...points.slice(lb, i).map((pt) => pt.close));
  const priceNewExtreme = pattern.direction === "bullish" ? price < priorCloseExtreme : price > priorCloseExtreme;
  const curRsi = rsi[i];
  const priorRsi = rsi[lb];
  if (priceNewExtreme && curRsi != null && priorRsi != null) {
    const rsiConfirms = pattern.direction === "bullish" ? curRsi < priorRsi : curRsi > priorRsi;
    if (!rsiConfirms) out.push({ label: "RSI Divergence", detail: `RSI ${curRsi.toFixed(0)} vs ${priorRsi.toFixed(0)}` });
  }

  const s50 = sma50[i];
  const s200 = sma200[i];
  if (s50 != null && s200 != null) {
    const trendUp = s50 > s200;
    const contradicts = (pattern.direction === "bullish" && !trendUp) || (pattern.direction === "bearish" && trendUp);
    if (contradicts) out.push({ label: "Trend Reversal", detail: trendUp ? "Against uptrend" : "Against downtrend" });
  }

  if (curRsi != null) {
    if (curRsi < 30) out.push({ label: "Oversold", detail: `RSI ${curRsi.toFixed(0)}` });
    else if (curRsi > 70) out.push({ label: "Overbought", detail: `RSI ${curRsi.toFixed(0)}` });
  }

  return out.slice(0, 5);
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build the curated, scored, confirmed technical signal list for a history
 * series — the single entry point the chart calls. Combines the existing
 * candlestick detector with the new breakout/gap/support-resistance
 * detectors, filters to {@link CURATED_PATTERNS}, and attaches confidence +
 * confirmations to each surviving signal.
 */
export function buildTechnicalSignals(points: HistoryPoint[]): TechnicalSignal[] {
  if (points.length < 3) return [];

  const closes = points.map((p) => p.close);
  const rsi = calcRsi(closes);
  const sma20 = calcSma(closes, 20);
  const sma50 = calcSma(closes, 50);
  const sma200 = calcSma(closes, 200);
  const volSma = calcVolumeSma(points.map((p) => p.volume), 20);
  const levels = detectSwingLevels(points);

  const raw: CandlePattern[] = [
    ...detectPatterns(points),
    ...detectBreakouts(points),
    ...detectGaps(points),
    ...detectSupportResistanceReactions(points, levels),
  ].filter((p) => CURATED_PATTERNS.has(p.name));

  return raw
    .map((pattern): TechnicalSignal => {
      const confidence = Math.max(0, Math.min(100, Math.round(
        0.40 * patternStrengthScore(pattern, points) +
        0.35 * volumeConfirmationScore(pattern.index, points, volSma) +
        0.25 * trendContextScore(pattern, points, sma20),
      )));
      return {
        ...pattern,
        date: points[pattern.index].date,
        span: spanFor(pattern.name),
        confidence,
        category: CATEGORY_BY_NAME[pattern.name] ?? "reversal",
        confirmations: computeConfirmations(pattern, points, levels, volSma, rsi, sma50, sma200),
      };
    })
    .sort((a, b) => points.findIndex((p) => p.date === b.date) - points.findIndex((p) => p.date === a.date));
}

/* -------------------------------------------------------------------------- */
/* Historical similar setups                                                  */
/* -------------------------------------------------------------------------- */

const STATS_HORIZONS = [1, 5, 10, 20];

/**
 * Forward-return statistics for every historical occurrence of `patternName`
 * within `allSignals` — occurrence count, bullish/bearish split, and average
 * return at several horizons. Purely derived from data already on the page;
 * no network call.
 */
export function computePatternStats(
  patternName: string,
  allSignals: TechnicalSignal[],
  points: HistoryPoint[],
  horizonDays = 5,
): PatternStats {
  const occurrences = allSignals.filter((s) => s.name === patternName);
  const dateIndex = new Map(points.map((p, i) => [p.date, i]));

  const returnsAt = (horizon: number) => {
    const rets: { date: string; returnPct: number }[] = [];
    for (const occ of occurrences) {
      const idx = dateIndex.get(occ.date);
      if (idx == null) continue;
      const target = idx + horizon;
      if (target >= points.length) continue;
      const base = points[idx].close;
      const future = points[target].close;
      if (base === 0) continue;
      rets.push({ date: occ.date, returnPct: ((future - base) / base) * 100 });
    }
    return rets;
  };

  const primary = returnsAt(horizonDays);
  const bullish = primary.filter((r) => r.returnPct > 0).length;
  const bearish = primary.filter((r) => r.returnPct < 0).length;
  const avgReturnPct = primary.length > 0
    ? primary.reduce((sum, r) => sum + r.returnPct, 0) / primary.length
    : 0;

  const extended: PatternHorizonStat[] = STATS_HORIZONS.filter((h) => h !== horizonDays).map((h) => {
    const rets = returnsAt(h);
    const wins = rets.filter((r) => r.returnPct > 0).length;
    return {
      horizonDays: h,
      winRatePct: rets.length > 0 ? (wins / rets.length) * 100 : 0,
      avgReturnPct: rets.length > 0 ? rets.reduce((sum, r) => sum + r.returnPct, 0) / rets.length : 0,
    };
  });

  const sorted = [...primary].sort((a, b) => a.returnPct - b.returnPct);

  return {
    occurrences: occurrences.length,
    bullishPct: primary.length > 0 ? (bullish / primary.length) * 100 : 0,
    bearishPct: primary.length > 0 ? (bearish / primary.length) * 100 : 0,
    avgReturnPct,
    extended,
    best: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    worst: sorted.length > 0 ? sorted[0] : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Deterministic fallback insight                                             */
/* -------------------------------------------------------------------------- */

const DIRECTION_WORD: Record<PatternDirection, string> = {
  bullish: "upside",
  bearish: "downside",
  neutral: "consolidation",
};

/**
 * Instant, deterministic "why it matters" sentence — shown immediately when
 * an Analysis Panel opens, and kept as the permanent fallback if the on-demand
 * AI call fails or times out.
 */
export function defaultPatternInsight(signal: TechnicalSignal): string {
  const confirmCount = signal.confirmations.length;
  const confirmClause = confirmCount > 0
    ? `${confirmCount} confirming signal${confirmCount === 1 ? "" : "s"}`
    : "no additional confirmation yet";
  return `${signal.description} With ${signal.confidence}% confidence and ${confirmClause}, this ${signal.direction} setup suggests near-term ${DIRECTION_WORD[signal.direction]} risk.`;
}
