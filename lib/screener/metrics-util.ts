/**
 * Derived-metric math shared by the universe providers.
 *
 * Everything here is computed from the daily OHLC series lib/yahoo.ts#getHistory
 * already returns — no new provider. The underlying statistics (dailyReturns,
 * stddev, maxDrawdown) are reused from lib/portfolio-analytics.ts rather than
 * reimplemented; only the framing is new.
 */

import { dailyReturns, maxDrawdown, stddev } from "../portfolio-analytics";
import { totalReturnClose } from "../prices";
import type { HistoryPoint } from "../types";

const closes = (history: HistoryPoint[]): number[] =>
  history.map(totalReturnClose).filter((c) => c > 0);

/** Percentage price change over the trailing `sessions` bars. Null if we don't have that much history. */
export function trailingReturn(history: HistoryPoint[], sessions: number): number | null {
  const c = closes(history);
  if (c.length < 2) return null;
  const from = c[Math.max(0, c.length - 1 - sessions)];
  const to = c.at(-1)!;
  return from > 0 ? ((to - from) / from) * 100 : null;
}

/**
 * Annualised volatility, %. `periodsPerYear` is 252 for anything that trades on
 * an exchange calendar and 365 for crypto, which never closes — using 252 for
 * crypto would understate its volatility by about 20%.
 */
export function annualizedVolatility(
  history: HistoryPoint[],
  periodsPerYear = 252,
): number | null {
  const returns = dailyReturns(history);
  if (returns.length < 20) return null;
  return stddev(returns) * Math.sqrt(periodsPerYear) * 100;
}

/** Worst peak-to-trough decline over the window, as a negative percentage. */
export function drawdown(history: HistoryPoint[]): number | null {
  const returns = dailyReturns(history);
  if (returns.length < 20) return null;
  // lib/portfolio-analytics#maxDrawdown already returns a signed percentage
  // (e.g. -8.9, not -0.089) — normalize the sign without rescaling again.
  return -Math.abs(maxDrawdown(returns));
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((s, v) => s + v, 0) / period;
}

/**
 * Trend, 0-100, from price versus its own moving averages:
 *   +50 price above the 50-day
 *   +30 price above the 200-day
 *   +20 the 50-day above the 200-day (a "golden cross" regime)
 * 100 is a clean uptrend on all three counts; 0 is a clean downtrend.
 * Needs 200 sessions of history — returns null rather than a partial score.
 */
export function trendScore(history: HistoryPoint[]): number | null {
  const c = closes(history);
  const ma50 = sma(c, 50);
  const ma200 = sma(c, 200);
  if (ma50 == null || ma200 == null) return null;
  const price = c.at(-1)!;

  return (price > ma50 ? 50 : 0) + (price > ma200 ? 30 : 0) + (ma50 > ma200 ? 20 : 0);
}

/** How far below the window high the last price sits, as a negative percentage. */
export function distanceFromHigh(history: HistoryPoint[]): number | null {
  const c = closes(history);
  if (c.length === 0) return null;
  const high = Math.max(...c);
  const last = c.at(-1)!;
  return high > 0 ? ((last - high) / high) * 100 : null;
}

/* -------------------------------------------------------------------------- */
/* Seasonality                                                                 */
/* -------------------------------------------------------------------------- */

export interface Seasonality {
  /** Mean return this contract has produced in the given calendar month, across all years of history. */
  avgReturn: number | null;
  /** Where that month ranks against the other eleven, 0-100. 100 = its strongest month. */
  score: number | null;
}

/**
 * Historical performance in a given calendar month. Genuinely useful for
 * commodities, where planting/harvest/heating cycles put real structure in the
 * calendar — and meaningless without several years of history, so this returns
 * nulls rather than a number built on one or two observations.
 */
export function seasonality(history: HistoryPoint[], month: number): Seasonality {
  // Group returns by year+month, so each (year, month) gives one observation.
  const byYearMonth = new Map<string, { first: number; last: number }>();
  for (const h of history) {
    const close = totalReturnClose(h);
    if (!(close > 0)) continue;
    const d = new Date(h.date);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const entry = byYearMonth.get(key);
    if (!entry) byYearMonth.set(key, { first: close, last: close });
    else entry.last = close;
  }

  /** Mean monthly return for one calendar month across the years we have. */
  const monthlyMean = (m: number): number | null => {
    const rets: number[] = [];
    for (const [key, { first, last }] of byYearMonth) {
      if (Number(key.split("-")[1]) !== m) continue;
      if (first > 0) rets.push(((last - first) / first) * 100);
    }
    // Two observations is noise, not seasonality.
    if (rets.length < 3) return null;
    return rets.reduce((s, v) => s + v, 0) / rets.length;
  };

  const avgReturn = monthlyMean(month);
  if (avgReturn == null) return { avgReturn: null, score: null };

  const all = Array.from({ length: 12 }, (_, m) => monthlyMean(m)).filter(
    (v): v is number => v != null,
  );
  if (all.length < 6) return { avgReturn, score: null };

  const below = all.filter((v) => v < avgReturn).length;
  return { avgReturn, score: Math.round((below / (all.length - 1)) * 100) };
}

/* -------------------------------------------------------------------------- */
/* Concurrency                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Bounded-concurrency map. Universe enrichment is hundreds of Yahoo calls;
 * firing them all at once gets the process rate-limited within seconds.
 * (Same shape as lib/dataset.ts#mapPool, which stays where it is — the equity
 * path is untouched by this redesign.)
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry with exponential backoff + jitter, to ride out Yahoo rate limits. Returns null if every attempt fails. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T | null> {
  for (let a = 0; a < attempts; a++) {
    try {
      return await fn();
    } catch {
      if (a === attempts - 1) break;
      await sleep(400 * 2 ** a + Math.random() * 300);
    }
  }
  return null;
}
