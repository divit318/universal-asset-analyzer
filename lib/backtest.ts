/**
 * Signal backtest — does the quant engine's scorecard actually predict returns?
 *
 * The engine logs a signal (STRONG_BUY … STRONG_SELL) and composite score for a
 * universe each run (data/signal_log.csv), but nothing ever checked whether
 * those calls worked. This engine takes each actionable signal joined to its
 * realized return since it fired and answers the only question that matters:
 * did higher scores / more bullish signals earn higher returns?
 *
 * Pure and deterministic — the API does the messy CSV parse + price join and
 * hands this clean records; this aggregates. Fully unit-testable.
 */

export interface BacktestInput {
  symbol: string;
  /** Engine signal: STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL. */
  signal: string;
  /** Composite score at signal time (engine's native scale). */
  compositeScore: number;
  /** Realized price return since the signal fired (fraction, e.g. 0.05). */
  realizedReturn: number;
}

export interface TierStat {
  signal: string;
  count: number;
  avgReturn: number;
  /** Fraction directionally correct: bullish → return > 0, bearish → return < 0. */
  hitRate: number;
}

export interface QuintileStat {
  quintile: number; // 1 (lowest score) .. 5 (highest)
  scoreRange: [number, number];
  count: number;
  avgReturn: number;
}

export interface BacktestResult {
  evaluated: number;
  byTier: TierStat[];
  byScoreQuintile: QuintileStat[];
  /** Avg return of bullish signals minus bearish signals — the money metric. */
  longShortSpread: number | null;
  /** True when bullish signals outperformed bearish ones (spread > 0). */
  monotonic: boolean;
  overall: { avgReturn: number; hitRate: number };
  /** Pearson correlation of composite score vs realized return. */
  scoreReturnCorrelation: number | null;
}

const TIER_ORDER = ["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"];
const BULLISH = new Set(["STRONG_BUY", "BUY"]);
const BEARISH = new Set(["SELL", "STRONG_SELL"]);

function directionallyCorrect(signal: string, ret: number): boolean {
  if (BULLISH.has(signal)) return ret > 0;
  if (BEARISH.has(signal)) return ret < 0;
  return ret > 0; // treat neutral/HOLD as a mild long bias for hit-rate purposes
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? null : round4(num / denom);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function runBacktest(inputs: BacktestInput[]): BacktestResult {
  const evaluated = inputs.length;
  if (evaluated === 0) {
    return {
      evaluated: 0,
      byTier: [],
      byScoreQuintile: [],
      longShortSpread: null,
      monotonic: false,
      overall: { avgReturn: 0, hitRate: 0 },
      scoreReturnCorrelation: null,
    };
  }

  // ── By tier ──
  const tierMap = new Map<string, BacktestInput[]>();
  for (const inp of inputs) {
    const list = tierMap.get(inp.signal) ?? [];
    list.push(inp);
    tierMap.set(inp.signal, list);
  }
  const byTier: TierStat[] = [...tierMap.entries()]
    .map(([signal, rows]) => ({
      signal,
      count: rows.length,
      avgReturn: round4(mean(rows.map((r) => r.realizedReturn))),
      hitRate: round4(mean(rows.map((r) => (directionallyCorrect(r.signal, r.realizedReturn) ? 1 : 0)))),
    }))
    .sort((a, b) => TIER_ORDER.indexOf(a.signal) - TIER_ORDER.indexOf(b.signal));

  // ── By score quintile ──
  const sorted = [...inputs].sort((a, b) => a.compositeScore - b.compositeScore);
  const byScoreQuintile: QuintileStat[] = [];
  for (let qi = 0; qi < 5; qi++) {
    const start = Math.floor((qi * sorted.length) / 5);
    const end = Math.floor(((qi + 1) * sorted.length) / 5);
    const slice = sorted.slice(start, end);
    if (slice.length === 0) continue;
    byScoreQuintile.push({
      quintile: qi + 1,
      scoreRange: [round4(slice[0].compositeScore), round4(slice[slice.length - 1].compositeScore)],
      count: slice.length,
      avgReturn: round4(mean(slice.map((r) => r.realizedReturn))),
    });
  }

  // ── Long-short spread ──
  const bullish = inputs.filter((i) => BULLISH.has(i.signal)).map((i) => i.realizedReturn);
  const bearish = inputs.filter((i) => BEARISH.has(i.signal)).map((i) => i.realizedReturn);
  const longShortSpread =
    bullish.length && bearish.length ? round4(mean(bullish) - mean(bearish)) : null;

  return {
    evaluated,
    byTier,
    byScoreQuintile,
    longShortSpread,
    monotonic: longShortSpread != null && longShortSpread > 0,
    overall: {
      avgReturn: round4(mean(inputs.map((i) => i.realizedReturn))),
      hitRate: round4(mean(inputs.map((i) => (directionallyCorrect(i.signal, i.realizedReturn) ? 1 : 0)))),
    },
    scoreReturnCorrelation: pearson(
      inputs.map((i) => i.compositeScore),
      inputs.map((i) => i.realizedReturn),
    ),
  };
}
