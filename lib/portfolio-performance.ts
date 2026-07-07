/**
 * Portfolio performance analytics — money-weighted return (XIRR) and a true
 * benchmark-relative comparison, computed from the lot ledger.
 *
 * The old model could only say "you're up X% on cost." With dated transactions
 * (lib/portfolio-lots.ts) we can answer the questions a real performance system
 * answers:
 *   - XIRR: the annualized money-weighted return that accounts for WHEN capital
 *     was deployed, not just how much.
 *   - Realized vs unrealized: what you've banked vs what's still at risk.
 *   - Benchmark-relative: had you invested the same amounts on the same dates
 *     into the index, where would you be? (The honest "are you beating SPY?"
 *     question — same cash flows, index prices.)
 *
 * Pure and deterministic — no DB, no network. XIRR is solved with Newton's
 * method and a bisection fallback so it converges on well-posed cash-flow sets.
 */

import type { PortfolioLot } from "./types";
import { aggregateLots } from "./portfolio-lots";

export interface CashFlow {
  /** ISO date (YYYY-MM-DD or full ISO). */
  date: string;
  /** Signed: negative = capital in (buy), positive = capital out (sell / terminal value). */
  amount: number;
}

export interface PositionPerformance {
  symbol: string;
  name: string;
  shares: number;
  /** Cost basis of the shares still held. */
  costBasis: number;
  currentValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  /** Total P&L as a fraction of gross capital deployed. */
  totalReturnPct: number;
  /** Annualized money-weighted return (fraction, e.g. 0.23 = 23%), or null. */
  xirr: number | null;
  /** Days from first trade to as-of — lets the UI flag unstable short-period XIRR. */
  holdingDays: number;
}

export interface BenchmarkComparison {
  symbol: string;
  /** What the portfolio's cash flows would be worth today in the benchmark. */
  currentValue: number;
  /** Benchmark money-weighted return over the same flows. */
  xirr: number | null;
  /** Portfolio XIRR minus benchmark XIRR (annualized alpha), or null. */
  outperformancePct: number | null;
}

export interface PortfolioPerformance {
  costBasis: number;
  currentValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalReturnPct: number;
  xirr: number | null;
  holdingDays: number;
  benchmark: BenchmarkComparison | null;
  positions: PositionPerformance[];
  asOf: string;
}

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

function yearsBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / MS_PER_YEAR;
}

/** Net present value of dated flows at annual rate `rate`, discounted to the
 *  first flow's date. */
function npv(rate: number, flows: CashFlow[], t0: string): number {
  let sum = 0;
  for (const f of flows) {
    const t = yearsBetween(t0, f.date);
    sum += f.amount / (1 + rate) ** t;
  }
  return sum;
}

/**
 * Internal rate of return for irregularly-timed cash flows (annualized
 * fraction). Returns null when the flows have no sign change (no solution) or
 * the solver fails to converge. Newton's method, with a robust bisection
 * fallback over a wide bracket.
 */
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null; // no sign change → undefined return

  const t0 = flows.reduce((min, f) => (f.date < min ? f.date : min), flows[0].date);

  // --- Newton's method ---
  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    let f = 0;
    let df = 0;
    for (const cf of flows) {
      const t = yearsBetween(t0, cf.date);
      const denom = (1 + rate) ** t;
      f += cf.amount / denom;
      df += (-t * cf.amount) / ((1 + rate) ** (t + 1));
    }
    if (Math.abs(f) < 1e-7) return round4(rate);
    if (df === 0) break;
    const next = rate - f / df;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-8) return round4(next);
    rate = next;
  }

  // --- Bisection fallback over [-0.9999, 100] ---
  let lo = -0.9999;
  let hi = 100;
  let flo = npv(lo, flows, t0);
  let fhi = npv(hi, flows, t0);
  if (flo * fhi > 0) return null; // no root in bracket
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid, flows, t0);
    if (Math.abs(fmid) < 1e-7) return round4(mid);
    if (flo * fmid < 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return round4((lo + hi) / 2);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Signed cash flows for a set of lots: buys are capital in (negative), sells
 *  capital out (positive), fees included. Excludes the terminal value. */
export function lotCashFlows(lots: PortfolioLot[]): CashFlow[] {
  return lots.map((l) => ({
    date: l.tradeDate,
    amount: l.kind === "buy" ? -(l.shares * l.price + l.fees) : l.shares * l.price - l.fees,
  }));
}

/** Performance for one symbol's lots given its current price. */
export function positionPerformance(
  lots: PortfolioLot[],
  currentPrice: number,
  asOf: string,
): PositionPerformance | null {
  const agg = aggregateLots(lots);
  if (!agg) return null;

  const currentValue = agg.shares * currentPrice;
  const costBasis = agg.shares * agg.avgCost;
  const unrealizedPnl = currentValue - costBasis;
  const totalPnl = agg.realizedPnl + unrealizedPnl;
  const grossInvested = lots
    .filter((l) => l.kind === "buy")
    .reduce((s, l) => s + l.shares * l.price + l.fees, 0);

  const flows = lotCashFlows(lots);
  if (currentValue > 0) flows.push({ date: asOf, amount: currentValue });

  return {
    symbol: agg.symbol,
    name: agg.name,
    shares: agg.shares,
    costBasis,
    currentValue,
    realizedPnl: agg.realizedPnl,
    unrealizedPnl,
    totalPnl,
    totalReturnPct: grossInvested > 0 ? totalPnl / grossInvested : 0,
    xirr: xirr(flows),
    holdingDays: Math.round(yearsBetween(agg.firstTradeDate, asOf) * 365),
  };
}

/** Latest benchmark close on or before `date` (step-function lookup). */
export function priceOnOrBefore(history: { date: string; close: number }[], date: string): number | null {
  let best: number | null = null;
  for (const h of history) {
    if (h.date <= date) best = h.close;
    else break; // history assumed ascending by date
  }
  return best ?? (history[0]?.close ?? null);
}

/**
 * Replicate the portfolio's cash flows in the benchmark: every dollar a buy
 * deployed buys benchmark units at that day's index price; every sell sells
 * units. The remaining units valued at today's index price is the benchmark
 * terminal value — the honest "same money, same dates, in the index" figure.
 */
export function benchmarkComparison(
  allLots: PortfolioLot[],
  benchmarkSymbol: string,
  benchmarkHistory: { date: string; close: number }[],
  benchmarkPriceNow: number,
  asOf: string,
  portfolioXirr: number | null,
): BenchmarkComparison | null {
  if (allLots.length === 0 || benchmarkHistory.length === 0 || benchmarkPriceNow <= 0) return null;

  let units = 0;
  const flows: CashFlow[] = [];
  for (const l of allLots) {
    const px = priceOnOrBefore(benchmarkHistory, l.tradeDate.slice(0, 10));
    if (px == null || px <= 0) continue;
    const amount = l.kind === "buy" ? l.shares * l.price + l.fees : l.shares * l.price - l.fees;
    if (l.kind === "buy") {
      units += amount / px;
      flows.push({ date: l.tradeDate, amount: -amount });
    } else {
      units -= amount / px;
      flows.push({ date: l.tradeDate, amount });
    }
  }

  const currentValue = Math.max(0, units) * benchmarkPriceNow;
  if (currentValue > 0) flows.push({ date: asOf, amount: currentValue });
  const benchXirr = xirr(flows);

  return {
    symbol: benchmarkSymbol,
    currentValue,
    xirr: benchXirr,
    outperformancePct: portfolioXirr != null && benchXirr != null ? round4(portfolioXirr - benchXirr) : null,
  };
}

/**
 * Full portfolio performance. `priceFor` returns the live price for a symbol;
 * `benchmark` is optional (omit for portfolios with no usable benchmark).
 */
export function portfolioPerformance(
  lotsBySymbol: Map<string, PortfolioLot[]>,
  priceFor: (symbol: string) => number | null,
  asOf: string,
  benchmark?: {
    symbol: string;
    history: { date: string; close: number }[];
    priceNow: number;
  },
): PortfolioPerformance {
  const positions: PositionPerformance[] = [];
  const allLots: PortfolioLot[] = [];
  let costBasis = 0;
  let currentValue = 0;
  let realizedPnl = 0;

  for (const [symbol, lots] of lotsBySymbol) {
    allLots.push(...lots);
    const price = priceFor(symbol);
    const perf = positionPerformance(lots, price ?? 0, asOf);
    if (!perf) continue;
    if (perf.shares > 0) positions.push(perf);
    // Realized P&L accrues even on closed positions.
    realizedPnl += perf.realizedPnl;
    if (perf.shares > 0) {
      costBasis += perf.costBasis;
      currentValue += perf.currentValue;
    }
  }

  const unrealizedPnl = currentValue - costBasis;
  const totalPnl = realizedPnl + unrealizedPnl;
  const grossInvested = allLots
    .filter((l) => l.kind === "buy")
    .reduce((s, l) => s + l.shares * l.price + l.fees, 0);

  const flows = lotCashFlows(allLots);
  if (currentValue > 0) flows.push({ date: asOf, amount: currentValue });
  const portXirr = xirr(flows);

  const firstDate = allLots.reduce<string | null>(
    (min, l) => (min == null || l.tradeDate < min ? l.tradeDate : min),
    null,
  );

  positions.sort((a, b) => b.currentValue - a.currentValue);

  return {
    costBasis,
    currentValue,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    totalReturnPct: grossInvested > 0 ? totalPnl / grossInvested : 0,
    xirr: portXirr,
    holdingDays: firstDate ? Math.round(yearsBetween(firstDate, asOf) * 365) : 0,
    benchmark: benchmark
      ? benchmarkComparison(allLots, benchmark.symbol, benchmark.history, benchmark.priceNow, asOf, portXirr)
      : null,
    positions,
    asOf,
  };
}
