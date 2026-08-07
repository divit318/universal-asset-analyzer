/**
 * Equity curve — the Book card's 90-day portfolio-vs-benchmark return index.
 *
 * There is no persisted daily portfolio-value history anywhere in the app
 * (`portfolio_snapshot` is the Undo ledger; `lib/portfolio/history` records
 * states around *changes*, not days), so this reconstructs the series the only
 * honest way available: the dated lot ledger plus daily adjusted closes — the
 * exact inputs `lib/portfolio/performance.ts` already trusts for XIRR and the
 * benchmark replication.
 *
 * Two disciplines carried over from the neighbours:
 *
 *   1. **A return index, not a value line.** trajectory-panel.tsx documents why
 *      portfolio value is never plotted: it jumps when money is deposited. Each
 *      day's growth factor here is `V_d / (V_{d-1} + F_d)` where `F_d` is the
 *      day's net traded value, so contributions move the *denominator*, not the
 *      line. Both lines are normalized to 100 at the window start.
 *
 *   2. **ADJUSTED closes** (`adjClose ?? close`), matching buildPerformance —
 *      raw closes discard every dividend and the error is one-directional.
 *
 * Priced coverage is reported rather than hidden: a manually-valued asset or a
 * symbol with no history simply isn't in the line, and `coveragePct` says how
 * much of the book the line actually describes.
 *
 * The math is pure (`computeEquityCurve`, unit-tested in
 * tests/home-equity-curve.test.ts); `buildEquityCurve` is the thin server
 * fetcher the digest plan calls, non-fatal like every other digest step.
 */

import { listLots } from "../db";
import { getHistory } from "../yahoo";
import { priceOnOrBefore } from "../portfolio-performance";
import type { PortfolioLot } from "../types";
import type { EquityCurve, EquityCurvePoint } from "./contracts";

const BENCHMARK = "SPY";
export const EQUITY_CURVE_DAYS = 90;
/** Fetch lookback beyond the window so the step-function has a print to start from. */
const FETCH_BUFFER_DAYS = 45;

type Series = { date: string; close: number }[];

const EMPTY: EquityCurve = {
  status: "empty",
  windowDays: EQUITY_CURVE_DAYS,
  points: [],
  portfolioPct: null,
  benchmarkPct: null,
  benchmarkSymbol: BENCHMARK,
  coveragePct: null,
};

/** `upsertCash()` stores cash as CASH-<CCY> lots — synthetic, never quotable. */
function isCashLot(l: PortfolioLot): boolean {
  return l.symbol.toUpperCase().startsWith("CASH-");
}

export interface EquityCurveInput {
  lots: PortfolioLot[];
  /** SYMBOL (upper) → ascending daily adjusted closes. */
  histories: Map<string, Series>;
  benchmark: { symbol: string; history: Series };
  /** CCY (upper) → ascending `<CCY>USD=X` closes, for foreign-currency lots. */
  fxSeries: Map<string, Series>;
  windowDays: number;
  /** YYYY-MM-DD "today", injectable for tests. */
  today?: string;
}

export function computeEquityCurve(input: EquityCurveInput): EquityCurve {
  const { histories, benchmark, fxSeries, windowDays } = input;
  const lots = input.lots.filter((l) => !isCashLot(l));
  if (lots.length === 0 || benchmark.history.length === 0) return { ...EMPTY, windowDays };

  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${today}T12:00:00Z`) - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // The benchmark's trading days are the calendar — one shared x-axis.
  const calendar = benchmark.history
    .map((p) => p.date)
    .filter((d) => d >= start && d <= today);
  if (calendar.length < 2) return { ...EMPTY, windowDays };

  // FX multiplier to base (USD), the same step-function rule prices use. A
  // foreign symbol whose FX series is missing is UNPRICED, not converted at 1.0.
  const fxOn = (currency: string | undefined, date: string): number | null => {
    const ccy = (currency ?? "USD").toUpperCase();
    if (ccy === "USD") return 1;
    const series = fxSeries.get(ccy);
    return series && series.length > 0 ? priceOnOrBefore(series, date) : null;
  };

  const bySymbol = new Map<string, PortfolioLot[]>();
  for (const l of lots) {
    const key = l.symbol.toUpperCase();
    const list = bySymbol.get(key);
    if (list) list.push(l);
    else bySymbol.set(key, [l]);
  }

  const priced: { symbol: string; lots: PortfolioLot[]; history: Series }[] = [];
  const unpriced: { symbol: string; lots: PortfolioLot[] }[] = [];
  for (const [symbol, symbolLots] of bySymbol) {
    const history = histories.get(symbol);
    const currency = symbolLots.find((l) => l.currency)?.currency;
    if (history && history.length > 0 && fxOn(currency, today) != null) {
      priced.push({ symbol, lots: symbolLots, history });
    } else {
      unpriced.push({ symbol, lots: symbolLots });
    }
  }
  if (priced.length === 0) return { ...EMPTY, windowDays, status: "degraded" };

  const signedShares = (l: PortfolioLot) => (l.kind === "sell" ? -l.shares : l.shares);
  const quantityOn = (symbolLots: PortfolioLot[], date: string) =>
    symbolLots.reduce((q, l) => (l.tradeDate.slice(0, 10) <= date ? q + signedShares(l) : q), 0);

  const valueOn = (date: string): number => {
    let value = 0;
    for (const { lots: symbolLots, history } of priced) {
      const qty = quantityOn(symbolLots, date);
      if (qty <= 0) continue;
      const close = priceOnOrBefore(history, date);
      const fx = fxOn(symbolLots.find((l) => l.currency)?.currency, date);
      if (close != null && close > 0 && fx != null) value += qty * close * fx;
    }
    return value;
  };

  // Net traded value in (prevDate, date] — the flow stripped from that day's
  // growth factor. Trade price, not fees: fees are a real return drag and stay in.
  const flowsBetween = (prevDate: string, date: string): number => {
    let flow = 0;
    for (const { lots: symbolLots } of priced) {
      for (const l of symbolLots) {
        const d = l.tradeDate.slice(0, 10);
        if (d > prevDate && d <= date) {
          const fx = fxOn(l.currency, d) ?? fxOn(l.currency, date) ?? 1;
          flow += signedShares(l) * l.price * fx;
        }
      }
    }
    return flow;
  };

  // Start the line at the first calendar day the priced book has value — a
  // portfolio younger than the window gets a shorter, honest line.
  const startIdx = calendar.findIndex((d) => valueOn(d) > 0);
  if (startIdx === -1 || startIdx >= calendar.length - 1) return { ...EMPTY, windowDays };

  const benchCloseOn = (date: string) => priceOnOrBefore(benchmark.history, date);
  const benchStart = benchCloseOn(calendar[startIdx]);

  const points: EquityCurvePoint[] = [];
  let index = 100;
  let prevValue = valueOn(calendar[startIdx]);
  points.push({ date: calendar[startIdx], portfolio: 100, benchmark: benchStart != null ? 100 : null });

  for (let i = startIdx + 1; i < calendar.length; i++) {
    const date = calendar[i];
    const value = valueOn(date);
    if (value <= 0) break; // the priced book closed out mid-window — the line ends
    const denom = prevValue + flowsBetween(calendar[i - 1], date);
    if (denom > 0) index *= value / denom;
    prevValue = value;

    const bench = benchCloseOn(date);
    points.push({
      date,
      portfolio: index,
      benchmark: bench != null && benchStart != null && benchStart > 0 ? (bench / benchStart) * 100 : null,
    });
  }
  if (points.length < 2) return { ...EMPTY, windowDays };

  // Coverage: how much of the book's end value the line prices. Unpriced
  // positions are approximated at cost — the only price the ledger has for them.
  const pricedEnd = valueOn(today);
  const unpricedEnd = unpriced.reduce((sum, u) => {
    const qty = quantityOn(u.lots, today);
    if (qty <= 0) return sum;
    const lastLot = [...u.lots].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).at(-1);
    return sum + qty * (lastLot?.price ?? 0);
  }, 0);
  const totalEnd = pricedEnd + unpricedEnd;

  const last = points[points.length - 1];
  return {
    status: "ok",
    windowDays,
    points,
    portfolioPct: last.portfolio - 100,
    benchmarkPct: last.benchmark != null ? last.benchmark - 100 : null,
    benchmarkSymbol: benchmark.symbol,
    coveragePct: totalEnd > 0 ? Math.round((pricedEnd / totalEnd) * 100) : null,
  };
}

/** The digest-plan fetcher. Non-fatal: any failure degrades this slice alone. */
export async function buildEquityCurve(windowDays = EQUITY_CURVE_DAYS): Promise<EquityCurve> {
  try {
    const lots = listLots().filter((l) => !isCashLot(l));
    if (lots.length === 0) return { ...EMPTY, windowDays };

    const symbols = [...new Set(lots.map((l) => l.symbol.toUpperCase()))];
    const currencies = [...new Set(lots.map((l) => (l.currency ?? "").toUpperCase()))].filter(
      (c) => c && c !== "USD",
    );
    const fetchDays = windowDays + FETCH_BUFFER_DAYS;

    const toSeries = (points: { date: string; close: number; adjClose?: number | null }[]): Series =>
      points
        .map((p) => ({ date: p.date.slice(0, 10), close: p.adjClose ?? p.close }))
        .filter((p) => p.close > 0);

    const [benchHistory, symbolHistories, fxHistories] = await Promise.all([
      getHistory(BENCHMARK, fetchDays).catch(() => []),
      Promise.all(symbols.map((s) => getHistory(s, fetchDays).catch(() => []))),
      Promise.all(currencies.map((c) => getHistory(`${c}USD=X`, fetchDays).catch(() => []))),
    ]);

    const histories = new Map(symbols.map((s, i) => [s, toSeries(symbolHistories[i])]));
    const fxSeries = new Map(currencies.map((c, i) => [c, toSeries(fxHistories[i])]));

    return computeEquityCurve({
      lots,
      histories,
      benchmark: { symbol: BENCHMARK, history: toSeries(benchHistory) },
      fxSeries,
      windowDays,
    });
  } catch {
    return { ...EMPTY, windowDays, status: "degraded" };
  }
}
