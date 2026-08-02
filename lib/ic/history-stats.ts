/**
 * IC Report — historical return statistics (Phase 2.6/2.7 rebuild).
 *
 * Replaces the old computeRunHotCold, whose headline paired the 1-year return
 * with a percentile computed on a *different* window (5Y rolling CAGRs), so a
 * below-median return could render at an above-median percentile, and the same
 * value could show two different percentiles on one screen.
 *
 * Design rule: a return, its median and its percentile are only ever reported
 * together when all three come from the SAME window's rolling distribution.
 * The verdict names the window it was computed on.
 */

export interface PricePoint {
  date: string;
  close: number;
}

export interface WindowStat {
  years: number;
  available: boolean;
  /** Annualised return (CAGR) over the most recent window, fraction. */
  cagr: number | null;
  /** Median of the rolling same-window CAGRs, fraction. */
  medianCagr: number | null;
  /** Percentile rank of the current CAGR within that rolling distribution (0–100). */
  percentile: number | null;
  /** Number of rolling observations behind median/percentile. */
  observations: number;
  signal: "run_hot" | "run_cold" | "neutral" | null;
}

export interface HistoryStats {
  windows: WindowStat[];
  /**
   * The verdict window: the longest window with enough rolling observations.
   * Its cagr / medianCagr / percentile are mutually consistent by construction.
   */
  verdict: {
    windowYears: number;
    cagr: number;
    medianCagr: number;
    percentile: number;
    signal: "run_hot" | "run_cold" | "neutral";
    observations: number;
  } | null;
  /** Fallback context for very young listings where no window has a distribution. */
  sinceListing: { totalReturn: number; years: number } | null;
}

const TRADING_DAYS_PER_YEAR = 252;
const WINDOW_YEARS = [1, 3, 5, 10, 15, 20];
const MIN_OBSERVATIONS = 8;
const STEP_DAYS = 21; // monthly sampling of rolling windows

/**
 * Percentile rank of `value` within `sample`, midpoint method:
 * (countBelow + 0.5 × countEqual) / n × 100. Unit tested against known
 * distributions — a value below the median can never rank above 50.
 */
export function percentileRank(sample: number[], value: number): number {
  if (sample.length === 0) return NaN;
  let below = 0;
  let equal = 0;
  for (const s of sample) {
    if (s < value) below++;
    else if (s === value) equal++;
  }
  return ((below + 0.5 * equal) / sample.length) * 100;
}

/** Median of a sample (interpolated for even sizes). */
export function median(sample: number[]): number {
  if (sample.length === 0) return NaN;
  const sorted = [...sample].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function annualised(endPrice: number, startPrice: number, years: number): number | null {
  if (startPrice <= 0 || endPrice <= 0 || years <= 0) return null;
  return Math.pow(endPrice / startPrice, 1 / years) - 1;
}

function computeWindow(sorted: PricePoint[], years: number): WindowStat {
  const windowDays = years * TRADING_DAYS_PER_YEAR;
  const n = sorted.length;
  const empty: WindowStat = { years, available: false, cagr: null, medianCagr: null, percentile: null, observations: 0, signal: null };
  if (n <= windowDays) return empty;

  const current = annualised(sorted[n - 1].close, sorted[n - 1 - windowDays].close, years);
  if (current == null) return empty;

  // Rolling distribution of same-window CAGRs, monthly steps, EXCLUDING the
  // current window (the statistic is "current vs its own history").
  const rolling: number[] = [];
  for (let i = n - 1 - STEP_DAYS; i >= windowDays; i -= STEP_DAYS) {
    const c = annualised(sorted[i].close, sorted[i - windowDays].close, years);
    if (c != null) rolling.push(c);
  }
  if (rolling.length < MIN_OBSERVATIONS) {
    return { years, available: true, cagr: current, medianCagr: null, percentile: null, observations: rolling.length, signal: null };
  }

  const pct = percentileRank(rolling, current);
  const signal: WindowStat["signal"] = pct >= 80 ? "run_hot" : pct <= 20 ? "run_cold" : "neutral";
  return {
    years,
    available: true,
    cagr: current,
    medianCagr: median(rolling),
    percentile: Math.round(pct),
    observations: rolling.length,
    signal,
  };
}

/**
 * Compute per-window return statistics from daily closes. Handles short
 * histories gracefully: windows without data are marked unavailable; windows
 * with a current return but too few rolling observations carry no percentile;
 * listings younger than a year fall back to a since-listing total return.
 */
export function computeHistoryStats(dailyCloses: PricePoint[]): HistoryStats | null {
  if (dailyCloses.length < 21) return null;
  const sorted = [...dailyCloses].filter((p) => p.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 21) return null;

  const windows = WINDOW_YEARS.map((y) => computeWindow(sorted, y));

  // Verdict: longest window with a percentile. All of its numbers are from one
  // distribution, so the rendered sentence can never contradict itself.
  const withPercentile = windows.filter((w) => w.percentile != null && w.cagr != null && w.medianCagr != null);
  const primary = withPercentile.at(-1) ?? null;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const spanYears = (new Date(last.date).getTime() - new Date(first.date).getTime()) / (365.25 * 86_400_000);
  const sinceListing = first.close > 0
    ? { totalReturn: (last.close - first.close) / first.close, years: Math.round(spanYears * 10) / 10 }
    : null;

  return {
    windows,
    verdict: primary
      ? {
          windowYears: primary.years,
          cagr: primary.cagr!,
          medianCagr: primary.medianCagr!,
          percentile: primary.percentile!,
          signal: primary.signal ?? "neutral",
          observations: primary.observations,
        }
      : null,
    sinceListing,
  };
}
