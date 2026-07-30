/**
 * Date-aligned return series — the primitive every cross-holding statistic needs.
 *
 * ── The bug this exists to fix ────────────────────────────────────────────────
 *
 * `MarketContext.history` is a `Map<string, number[]>`: closes with the DATES
 * THROWN AWAY. Every statistic that combines two holdings therefore had to guess
 * how to line them up, and the two places that did it guessed differently:
 *
 *   • `computeRisk()` built its portfolio return series by taking each holding's
 *     LAST `minLen` returns (`returns.slice(-minLen)`) — tail alignment.
 *   • `computeCorrelation()` passed raw, unequal-length arrays straight to
 *     `pearson()`, which truncates to `Math.min(len)` and reads from INDEX 0 —
 *     head alignment.
 *
 * Neither is date alignment, and the second is catastrophic. Correlating a
 * symbol with 400 observations against one with 275 compared the OLDEST 275
 * observations of each: 275 days ending ~4 months ago against 275 days ending
 * today. The resulting r described no period that ever existed. That number is
 * displayed in the Risk Lab as "r = 0.83" and feeds the Health score's
 * Correlation dimension.
 *
 * Unequal lengths are not an edge case here. The portfolio is deliberately
 * multi-asset and requests a fixed 400-CALENDAR-day window per symbol, so:
 *   • an equity returns ~275 observations (5 sessions a week, minus holidays)
 *   • BTC-USD returns ~400 (crypto trades every day)
 *   • anything listed inside the window returns fewer still
 * A crypto/equity pair — the single most interesting correlation in a modern
 * book — was guaranteed to be misaligned by ~125 observations.
 *
 * Tail alignment is better than head alignment (at least both series end today)
 * but is still wrong across trading calendars: BTC's last 275 observations span
 * 275 calendar days while AAPL's span ~400. So the only correct answer is to
 * join on the date itself, which is what this module does.
 */

export interface DatedReturns {
  /** Ascending. `dates[i]` is the date on which `returns[i]` was realized. */
  dates: string[];
  returns: number[];
}

/**
 * Simple returns from an ascending close series.
 *
 * `closes[i]` is observed on `dates[i]`, so the return between `i-1` and `i` is
 * realized ON `dates[i]` — the label must be the LATER of the two dates, or a
 * join lines each series up one session out of step.
 *
 * `dates` may be omitted (or shorter than `closes`), in which case the result
 * carries no dates and consumers fall back to tail alignment. That is the
 * degraded path, not the intended one.
 */
export function datedReturns(closes: number[], dates?: string[]): DatedReturns {
  const outReturns: number[] = [];
  const outDates: string[] = [];
  const haveDates = dates != null && dates.length === closes.length;

  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (!(prev > 0)) continue;
    outReturns.push((closes[i] - prev) / prev);
    if (haveDates) outDates.push(dates[i]);
  }

  return { dates: haveDates ? outDates : [], returns: outReturns };
}

/** The result of aligning N series: equal-length arrays over a shared calendar. */
export interface AlignedReturns {
  /**
   * The shared dates, ascending. Empty when alignment had to fall back to
   * position-based tail alignment — which is itself the signal that this result
   * carries no calendar guarantee.
   */
  dates: string[];
  /** One array per input series, in input order, all `dates.length` long. */
  series: number[][];
}

const EMPTY: AlignedReturns = { dates: [], series: [] };

/** Tail alignment: the last N of each series, N = the shortest length. */
function tailAlign(series: DatedReturns[]): AlignedReturns {
  const minLen = Math.min(...series.map((s) => s.returns.length));
  if (minLen < 2) return EMPTY;
  return { dates: [], series: series.map((s) => s.returns.slice(-minLen)) };
}

/**
 * Inner-join N return series on the dates they share.
 *
 * Returns one equal-length array per input, in input order, covering only the
 * dates present in EVERY series — so index `i` refers to the same calendar day
 * in all of them.
 *
 * When any input lacks dates we degrade to tail alignment rather than returning
 * nothing: a fixture or provider that supplies bare closes still gets the old
 * behaviour instead of losing the statistic entirely. `dates` is empty in that
 * case, so a caller that needs a real calendar (to align against a benchmark,
 * say) can tell the difference.
 */
export function alignReturns(series: DatedReturns[]): AlignedReturns {
  if (series.length === 0) return EMPTY;
  if (series.length === 1) {
    const only = series[0];
    return only.returns.length >= 2
      ? { dates: only.dates.length === only.returns.length ? only.dates : [], series: [only.returns] }
      : EMPTY;
  }
  if (series.some((s) => s.dates.length !== s.returns.length || s.dates.length === 0)) {
    return tailAlign(series);
  }

  // Intersect progressively from the shortest series — the common set can only
  // shrink, so starting small keeps the work proportional to the overlap.
  const ordered = [...series].sort((a, b) => a.dates.length - b.dates.length);
  let common = new Set(ordered[0].dates);
  for (let i = 1; i < ordered.length && common.size > 0; i++) {
    const next = new Set<string>();
    const hay = new Set(ordered[i].dates);
    for (const d of common) if (hay.has(d)) next.add(d);
    common = next;
  }
  if (common.size < 2) return EMPTY;

  const dates = [...common].sort();
  return {
    dates,
    series: series.map((s) => {
      const byDate = new Map<string, number>();
      for (let i = 0; i < s.dates.length; i++) byDate.set(s.dates[i], s.returns[i]);
      return dates.map((d) => byDate.get(d)!);
    }),
  };
}

/**
 * Align exactly two series and return them as a pair.
 *
 * A correlation MATRIX is built pairwise rather than on the intersection of all
 * holdings at once: one six-week-old position must not truncate the correlation
 * between two names that each have four hundred days of overlap. The cost is
 * that the matrix is not guaranteed positive semi-definite — acceptable, because
 * it is read as a set of pairwise readings, not inverted.
 *
 * `null` when the overlap is too short to say anything (pearson itself needs 5
 * points, and below that it returns a fabricated 0).
 */
export function alignPair(a: DatedReturns, b: DatedReturns): [number[], number[]] | null {
  const { series } = alignReturns([a, b]);
  if (series.length !== 2 || series[0].length < 5) return null;
  return [series[0], series[1]];
}
