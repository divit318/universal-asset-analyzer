/**
 * Aggregates a chronological HistoryPoint series into coarser bars — the
 * valid direction of candle aggregation (daily → weekly → monthly, hourly →
 * 4-hour). The reverse (deriving intraday bars from daily data) isn't
 * possible: a daily OHLC doesn't preserve the intraday path, so finer
 * intervals must come from a real fetch (see lib/yahoo.ts's
 * getIntradayHistory) rather than this module.
 */

import type { HistoryPoint } from "./types";

function combineGroup(group: HistoryPoint[]): HistoryPoint {
  const first = group[0];
  const last = group[group.length - 1];
  const highs = group.map((b) => b.high ?? b.close);
  const lows = group.map((b) => b.low ?? b.close);
  const hasVolume = group.some((b) => b.volume != null);

  return {
    date: first.date,
    open: first.open ?? first.close,
    high: Math.max(...highs),
    low: Math.min(...lows),
    close: last.close,
    adjClose: last.adjClose ?? last.close,
    ...(hasVolume ? { volume: group.reduce((sum, b) => sum + (b.volume ?? 0), 0) } : {}),
  };
}

/**
 * Combine every `groupSize` consecutive bars into one coarser bar
 * (open=first's open, close=last's close, high=max, low=min, volume=sum). A
 * trailing partial group (fewer than groupSize bars left) still aggregates
 * into a final bar rather than being dropped.
 */
export function aggregateBars(bars: HistoryPoint[], groupSize: number): HistoryPoint[] {
  if (groupSize <= 1 || bars.length === 0) return bars;
  const out: HistoryPoint[] = [];
  for (let i = 0; i < bars.length; i += groupSize) {
    out.push(combineGroup(bars.slice(i, i + groupSize)));
  }
  return out;
}

function groupByKey(bars: HistoryPoint[], keyFn: (date: string) => string): HistoryPoint[] {
  const groups = new Map<string, HistoryPoint[]>();
  for (const bar of bars) {
    const key = keyFn(bar.date);
    const arr = groups.get(key);
    if (arr) arr.push(bar);
    else groups.set(key, [bar]);
  }
  // Map preserves insertion order, and `bars` is already chronological, so
  // groups come out chronological too — no extra sort needed.
  return Array.from(groups.values()).map(combineGroup);
}

/**
 * ISO-ish week key: the Monday on/before this date (UTC), as "YYYY-MM-DD".
 * Takes only the date portion so this stays correct even if `dateStr` is a
 * full intraday ISO timestamp rather than a bare `YYYY-MM-DD` (this function
 * is only ever called on daily bars today, but slicing defensively costs
 * nothing and avoids an `Invalid Date` if that ever changes).
 */
function weekKey(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const dayIndex = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dayIndex);
  return monday.toISOString().slice(0, 10);
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

/** Group daily bars into weekly bars, keyed by calendar week (Monday start). */
export function aggregateToWeekly(daily: HistoryPoint[]): HistoryPoint[] {
  return groupByKey(daily, weekKey);
}

/** Group daily bars into monthly bars, keyed by calendar month. */
export function aggregateToMonthly(daily: HistoryPoint[]): HistoryPoint[] {
  return groupByKey(daily, monthKey);
}

/** Group hourly (60m) bars into 4-hour bars — Yahoo has no native 4h interval. */
export function aggregateToFourHour(hourly: HistoryPoint[]): HistoryPoint[] {
  return aggregateBars(hourly, 4);
}
