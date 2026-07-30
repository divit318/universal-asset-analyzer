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

/**
 * Below this, an annualized return says more about the calendar than about the
 * portfolio: XIRR over 18 days extrapolates an 18-day move by a factor of ~20, so
 * normal short-term noise becomes an implausible headline rate. A quarter is the
 * shortest window over which the extrapolation is not actively misleading.
 *
 * Lives here, next to the `holdingDays` this engine computes, because EVERY
 * annualized figure derived from it inherits the gate — the portfolio XIRR, each
 * position's IRR, and the benchmark comparison, which is a difference of two
 * annualized rates and is therefore no more trustworthy than either of them. It
 * was previously duplicated as a private constant per surface, which is how the
 * Portfolio page came to withhold its own XIRR under this rule while displaying
 * "Underperforming by 10.3pp/yr" from the same 18-day dataset.
 */
export const MIN_DAYS_TO_ANNUALIZE = 90;

export interface CashFlow {
  /** ISO date (YYYY-MM-DD or full ISO). */
  date: string;
  /** Signed: negative = capital in (buy), positive = capital out (sell / terminal value). */
  amount: number;
}

/**
 * What one unit of a symbol is worth, in the BASE currency.
 *
 * Two things the plain `number` this replaced could not express, both of which
 * silently corrupted totals:
 *
 *   - **FX.** The ledger stores a foreign holding's shares and price in its own
 *     currency. Multiplying them yields a figure in THAT currency, and summing it
 *     into a base-currency portfolio total adds francs to dollars. The book here
 *     carries a CHF forex position, so this was live — it escaped notice only
 *     because the position also happened to be unpriced.
 *   - **Bond face value.** A bond's quantity is face and its price is a percent of
 *     par, so 10,000 face at 98.5 is worth 9,850, not 985,000.
 *
 * Callers that pass a plain `number` are declaring "this is already one unit in the
 * base currency, at a 1:1 rate" — correct for a single-currency book of shares, and
 * the reason every existing caller keeps working unchanged.
 */
export interface UnitPricing {
  /** Value of ONE unit, in base currency. Bond face-value scaling already applied. */
  priceBase: number;
  /**
   * The holding's currency → base multiplier, applied to cost basis, realized P&L
   * and cash flows so they land in the same currency as `priceBase`.
   *
   * Today's rate is used for historical flows too. That is an approximation, and a
   * deliberate one: it is exactly what `normalizeHoldings()` does for
   * `costBasisBase`, so the two surfaces agree. A per-date FX series would be more
   * precise and would stop this figure reconciling with the rest of the page.
   */
  fxRate: number;
}

/** Resolves a symbol to its base-currency unit value, or null when unpriced. */
export type PriceResolver = (symbol: string) => number | UnitPricing | null;

/**
 * Currency → base multiplier ON a given date, or null when unavailable.
 *
 * Realized P&L, the capital a position consumed, and every XIRR cash flow are all
 * DATED facts. Converting them at today's rate is an approximation; converting them
 * at 1.0 — which is what happened to a fully closed foreign position, because it has
 * no `RawHolding` left to read a currency off — is simply wrong: it reported francs
 * as dollars.
 *
 * `date` is an ISO date (YYYY-MM-DD or full ISO). Implementations should return the
 * last known rate on or before it (a step function), the way `priceOnOrBefore()`
 * does for prices.
 */
export type FxOnDate = (currency: string, date: string) => number | null;

export interface PositionPricingOptions {
  /** Historical currency→base rates. See {@link FxOnDate}. */
  fxOn?: FxOnDate;
  /**
   * Fallback when `fxOn` has no rate for a date — today's rate for that currency.
   *
   * The chain is deliberate and never ends at an implicit 1.0 for a known foreign
   * currency: historical rate → today's rate → `unconvertible`. Silently treating an
   * unresolved rate as 1:1 produces a plausible wrong number, which is worse than a
   * flagged one.
   */
  fxNow?: (currency: string) => number | null;
}

export interface PositionPerformance {
  symbol: string;
  name: string;
  shares: number;
  /** Cost basis of the shares STILL HELD, in base currency. */
  costBasis: number;
  currentValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  /**
   * Gross capital this position ever consumed — every buy, fees included, in base
   * currency. This is `totalReturnPct`'s denominator, and it is reported rather
   * than left implicit because for a sold-down position it is the ONLY figure on
   * the row that makes the percentage add up.
   *
   * A GLD position that bought $375,026, sold out at a $2,856 profit and was left
   * holding $0.18 of rounding dust rendered as "Cost $0.18 / Realized +$2,856 /
   * Return +0.8%" — three numbers that cannot all be true of the same denominator.
   * All three were correct; the denominator was simply invisible.
   */
  grossInvested: number;
  /** Total P&L as a fraction of `grossInvested`. */
  totalReturnPct: number;
  /** Annualized money-weighted return (fraction, e.g. 0.23 = 23%), or null. */
  xirr: number | null;
  /** Days from first trade to as-of — lets the UI flag unstable short-period XIRR. */
  holdingDays: number;
  /** True once every share has been sold. Its realized P&L still counts. */
  closed: boolean;
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

/**
 * Why a holding the user owns is not in the figures above.
 *
 * "Excluded" and "worth nothing" must never render the same way, so an exclusion
 * carries both its reason and its value — which is what lets the UI show the
 * subtraction that reconciles this panel's total with the page headline instead of
 * leaving the user to guess at a difference.
 */
export interface ExcludedHolding {
  /** Ledger symbol, or the asset's name for a manually-valued holding. */
  label: string;
  reason: "unpriced" | "manual";
  /** Best available base-currency value — cost basis for an unpriced position. */
  valueBase: number;
  /**
   * Base-currency cost basis. Required, not optional: it is what lets a holding
   * excluded from the RATE calculation still contribute to the whole-portfolio
   * total return, which is why the Dashboard and this panel can now agree.
   * Manual assets were carried at $1,750 against a $15,250 basis — a −$13,500
   * loss that the Performance tab omitted entirely while the Dashboard counted
   * it, and that alone flipped the sign between the two panels.
   */
  costBasisBase: number;
}

/**
 * The whole portfolio's total return — the ONE definition every surface renders.
 *
 * Before this existed the Portfolio page answered "am I up or down?" three ways
 * from three formulas, and two of them disagreed on the SIGN:
 *
 *   Dashboard    (value − cost) / cost over every holding    → −$396.01 / −0.0043%
 *   Attribution  same, minus holdings with no cost basis      → −0.0043%
 *   Performance  realized + unrealized over the traded book   → +$5,359.31 / +0.03%
 *
 * Neither was right. The Dashboard could not see realized P&L (−$9,819.50 of it,
 * because a sold position leaves the holdings list). Performance could not see
 * manually-valued assets (−$13,500, because they have no dated trades). Each
 * omitted a real, signed loss the other counted.
 *
 * This includes both, over one snapshot, and is the numerator AND denominator both
 * panels use.
 */
export interface TotalReturn {
  /** Realized + unrealized, over EVERY holding the user owns. */
  pnl: number;
  /**
   * Capital at risk: Σ cost basis over every holding, cash at par included.
   *
   * A balance-sheet quantity, deliberately NOT a sum of transaction flows. Any
   * flow-sum double-counts recycled capital — a $4.5M deposit followed by $4.5M
   * of purchases is $4.5M, not $9M — which is how the old denominator reached
   * $15,866,581 on a $9.25M book and made the reported return decay every time
   * the user rebalanced. This figure is invariant to internal plumbing: a
   * rebalance that sells one holding to buy another leaves it unchanged.
   */
  cost: number;
  /** `pnl / cost`, in PERCENT (not a fraction) to match the Dashboard's tile. */
  pct: number;
}

export interface PortfolioPerformance {
  costBasis: number;
  currentValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  /**
   * P&L of the TRADED BOOK only (realized + unrealized over priced positions).
   *
   * `positions` sums to exactly this, which is what makes the per-position table a
   * true decomposition of it. For the whole-portfolio figure a headline should
   * render — the one that agrees with the Dashboard — use {@link total}.
   */
  totalPnl: number;
  /**
   * The whole portfolio's total return. THE headline number, shared with the
   * Dashboard tile and the Attribution panel.
   *
   * There is deliberately no portfolio-level `totalReturnPct`/`grossInvested` any
   * more. Those were a second, competing definition of the same question whose
   * denominator summed transaction flows including synthetic cash lots, and having
   * both on one page is what allowed the two to disagree.
   */
  total: TotalReturn;
  xirr: number | null;
  holdingDays: number;
  benchmark: BenchmarkComparison | null;
  positions: PositionPerformance[];
  /**
   * Open positions excluded because no current price could be resolved.
   *
   * Reported rather than silently valued at zero. Every figure above therefore
   * describes the priced portion of the book, and the UI must say so — a
   * performance number computed over an unstated subset is exactly as misleading
   * as a wrong one.
   */
  unpricedSymbols: string[];
  /**
   * Everything the user owns that is NOT in `currentValue`, valued from the same
   * snapshot, so that:
   *
   *   currentValue + Σ excluded.valueBase === portfolioValue
   *
   * holds exactly. The panel used to state "manually-valued assets are excluded"
   * and print a figure $2,665.81 below the page's Total Value when those assets
   * came to $1,750 — the rest was an unpriced forex position the prose never
   * mentioned, plus price drift between two independent quote fetches. An
   * unexplained residual on a reconciliation is indistinguishable from an error.
   */
  excluded: ExcludedHolding[];
  /**
   * Total value of the WHOLE portfolio at this snapshot — the same quantity the
   * page headline shows, computed from the same prices, so the two agree by
   * construction rather than by coincidence of timing.
   */
  portfolioValue: number;
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
 *  capital out (positive), fees included. Excludes the terminal value.
 *  `fxRate` converts the lots' native currency to base. */
export function lotCashFlows(lots: PortfolioLot[], fxRate = 1): CashFlow[] {
  return lots.map((l) => ({
    date: l.tradeDate,
    amount: (l.kind === "buy" ? -(l.shares * l.price + l.fees) : l.shares * l.price - l.fees) * fxRate,
  }));
}

/** A synthetic ticker: an account, not an instrument. `upsertCash()` writes these. */
export function isSyntheticSymbol(symbol: string): boolean {
  return symbol.toUpperCase().startsWith("CASH-");
}

/**
 * True when a lot moves no NEW capital into the portfolio.
 *
 * Two kinds, and both were being counted as invested capital:
 *
 *   1. **Balancing plugs.** `cashBalancingLot()` writes one cash lot per executed
 *      batch, equal to the negative of its net cash flow, so a rebalance conserves
 *      total value. On this book that was $699,442.65 of "buys" across 11 lots that
 *      no user ever contributed.
 *   2. **Every cash lot at all.** Cash is the FUNDING ACCOUNT, not a deployment.
 *      A $4.5M deposit followed by $4.5M of equity purchases is $4.5M of capital,
 *      but a sum over all buys counts it twice — once entering cash, once leaving
 *      it. Excluding only the balancing plugs would have removed $699k of a
 *      $6.62M overstatement and left the ledger looking fixed while still being
 *      64% wrong.
 *
 * So "capital deployed" is measured over INSTRUMENTS only. Cash's own row reports
 * no deployed figure rather than a nonsensical one — it was showing $5,267,690
 * against a $1,250,635 balance.
 */
export function isInternalCapitalLot(lot: PortfolioLot): boolean {
  return isSyntheticSymbol(lot.symbol) || lot.meta?.balancing === true;
}

/** Normalize either supported pricing shape into `{ priceBase, fxRate }`. */
function resolvePricing(p: number | UnitPricing | null | undefined): UnitPricing | null {
  if (p == null) return null;
  const { priceBase, fxRate } = typeof p === "number" ? { priceBase: p, fxRate: 1 } : p;
  if (!Number.isFinite(priceBase) || !Number.isFinite(fxRate) || fxRate <= 0) return null;
  return { priceBase, fxRate };
}

/**
 * Performance for one symbol's lots given its current price.
 *
 * `currentPrice` may be null, meaning "no price could be resolved". An OPEN
 * position cannot be valued without one, so this returns null rather than
 * pricing it at zero — see the note on `unpricedSymbols`. A fully CLOSED
 * position (shares === 0) needs no price at all: its realized P&L is already
 * known, and it is still reported.
 */
export function positionPerformance(
  lots: PortfolioLot[],
  currentPrice: number | UnitPricing | null,
  asOf: string,
  opts: PositionPricingOptions = {},
): PositionPerformance | null {
  const agg = aggregateLots(lots);
  if (!agg) return null;
  const pricing = resolvePricing(currentPrice);
  if (agg.shares > 0 && (pricing == null || pricing.priceBase <= 0)) return null;

  /**
   * The position's currency, from the LEDGER.
   *
   * A closed position has no `RawHolding` — `aggregateOpenPositions()` filters
   * `shares === 0` out — so the live quote/valuation seam that supplies `fxRate` for
   * open positions returns nothing for it. The lots are the only surviving record.
   */
  const currency = (lots.find((l) => l.currency)?.currency ?? "").toUpperCase();

  /**
   * Rate to convert a DATED amount in this position's currency to base.
   *
   * Fallback chain, in order: the rate on that date → today's rate → the rate the
   * open-position valuation carries → 1. It only reaches 1 for a position that is
   * genuinely in the base currency (or whose currency the ledger never recorded,
   * which for pre-migration rows means USD). It used to start at 1.
   */
  const rateOn = (date: string): number => {
    if (!currency) return pricing?.fxRate ?? 1;
    const hist = opts.fxOn?.(currency, date);
    if (hist != null && Number.isFinite(hist) && hist > 0) return hist;
    const now = opts.fxNow?.(currency);
    if (now != null && Number.isFinite(now) && now > 0) return now;
    return pricing?.fxRate ?? 1;
  };

  /**
   * Today's rate — for the MARK-TO-MARKET side only.
   *
   * `currentValue` already arrives in base (the adapter converted it), and
   * `costBasis` must stay at today's rate because `normalizeHoldings()` computes
   * `costBasisBase` that way and `total.cost` is asserted equal to its `totalCost`.
   * Unrealized P&L is a present-tense figure, so a present-tense rate is right for
   * it. Realized P&L and deployed capital are past-tense facts and use the dated
   * rates above.
   */
  const fxNow = pricing?.fxRate ?? (currency ? opts.fxNow?.(currency) ?? 1 : 1);

  const currentValue = agg.shares * (pricing?.priceBase ?? 0);
  const costBasis = agg.shares * agg.avgCost * fxNow;
  const unrealizedPnl = currentValue - costBasis;

  // Realized P&L, converted per sell at that sell's own rate, then summed. A single
  // cumulative figure has no one date to convert at; this does.
  const realizedPnl = agg.realizedEvents.reduce((s, e) => s + e.amount * rateOn(e.date), 0);

  const totalPnl = realizedPnl + unrealizedPnl;
  // Capital deployed into this INSTRUMENT, each buy at the rate on its own trade
  // date. Internal lots contribute nothing — see isInternalCapitalLot(). For a cash
  // position this is 0 by construction, which is correct: cash is held, not deployed.
  const grossInvested = lots
    .filter((l) => l.kind === "buy" && !isInternalCapitalLot(l))
    .reduce((s, l) => s + (l.shares * l.price + l.fees) * rateOn(l.tradeDate), 0);

  // Cash flows likewise: a money-weighted return over mixed currencies is only
  // meaningful if each flow is converted at the rate that applied when it moved.
  const flows = lots.map((l) => lotCashFlows([l], rateOn(l.tradeDate))[0]);
  if (currentValue > 0) flows.push({ date: asOf, amount: currentValue });

  return {
    symbol: agg.symbol,
    name: agg.name,
    shares: agg.shares,
    costBasis,
    currentValue,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    grossInvested,
    totalReturnPct: grossInvested > 0 ? totalPnl / grossInvested : 0,
    xirr: xirr(flows),
    holdingDays: Math.round(yearsBetween(agg.firstTradeDate, asOf) * 365),
    closed: agg.shares === 0,
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
  /**
   * Per-LOT currency→base multiplier, evaluated at that lot's own trade date.
   *
   * The replication buys the index with the portfolio's own cash flows, and the index
   * is priced in base currency, so a foreign lot's amount has to be converted before
   * it can buy index units — at the rate that applied when the money actually moved,
   * not today's, and certainly not 1.0.
   */
  fxFor: (lot: PortfolioLot) => number = () => 1,
): BenchmarkComparison | null {
  if (allLots.length === 0 || benchmarkHistory.length === 0 || benchmarkPriceNow <= 0) return null;

  let units = 0;
  const flows: CashFlow[] = [];
  for (const l of allLots) {
    const px = priceOnOrBefore(benchmarkHistory, l.tradeDate.slice(0, 10));
    if (px == null || px <= 0) continue;
    const fx = fxFor(l);
    const amount = (l.kind === "buy" ? l.shares * l.price + l.fees : l.shares * l.price - l.fees) * fx;
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
 * Full portfolio performance. `priceFor` resolves a symbol's base-currency unit
 * value (see {@link UnitPricing}); `benchmark` is optional (omit for portfolios
 * with no usable benchmark).
 *
 * `opts.otherHoldings` are assets the user owns that this engine cannot produce a
 * rate of return for — a house, a private stake — passed in only so the result can
 * report a portfolio total that RECONCILES with the page headline. They contribute
 * to `portfolioValue` and `excluded`, and to nothing else.
 */
export function portfolioPerformance(
  lotsBySymbol: Map<string, PortfolioLot[]>,
  priceFor: PriceResolver,
  asOf: string,
  benchmark?: {
    symbol: string;
    history: { date: string; close: number }[];
    priceNow: number;
  },
  opts: {
    otherHoldings?: { label: string; valueBase: number; costBasisBase: number }[];
    /**
     * Base-currency value the caller's snapshot carries for an unpriced position.
     * Defaults to the position's cost basis — the same fallback the rest of the
     * Portfolio uses — but a caller holding the real valuation should pass it, so
     * `portfolioValue` matches the page headline to the cent rather than to within
     * an FX rate.
     */
    fallbackValueFor?: (symbol: string) => number | null;
    /**
     * Historical / current FX, applied to every DATED amount. See
     * {@link PositionPricingOptions}. Without these a fully closed foreign position
     * converted its realized P&L at 1.0, because a closed position has no holding
     * left to read a currency or a rate off.
     */
    fxOn?: FxOnDate;
    fxNow?: (currency: string) => number | null;
  } = {},
): PortfolioPerformance {
  const positions: PositionPerformance[] = [];
  const allLots: PortfolioLot[] = [];
  let costBasis = 0;
  let currentValue = 0;
  let realizedPnl = 0;

  const unpricedSymbols: string[] = [];
  const excluded: ExcludedHolding[] = [];
  const pricingOpts: PositionPricingOptions = { fxOn: opts.fxOn, fxNow: opts.fxNow };

  for (const [symbol, lots] of lotsBySymbol) {
    const pricing = priceFor(symbol);
    const perf = positionPerformance(lots, pricing, asOf, pricingOpts);

    // An open position with no resolvable price is EXCLUDED, not marked to zero.
    //
    // This line used to read `positionPerformance(lots, price ?? 0, asOf)`, and
    // that `?? 0` was the single most damaging number on the Performance surface.
    // A position with no live quote was valued at zero against its full cost
    // basis, i.e. reported as a total loss.
    //
    // It fired on the most ordinary holding there is: cash. `upsertCash()` stores
    // a cash position as a `CASH-USD` lot, and no quote provider returns a price
    // for a synthetic ticker — so a real $9.28M book with $1.25M of cash reported
    // −$1,228,679 of P&L against the same page's +$14,920, and the benchmark panel
    // concluded the user was $1.22M behind SPY. Both were entirely the phantom
    // loss on cash. Any newly-listed, delisted or provider-missing ticker did the
    // same thing in proportion to its size.
    //
    // Its lots are also kept OUT of `allLots`, so neither the XIRR nor the
    // benchmark replication sees a capital outflow whose terminal value we then
    // fail to credit — which is what turned the phantom loss into a phantom
    // underperformance.
    if (!perf) {
      unpricedSymbols.push(symbol);
      // Carried at cost so the reconciliation below still balances. This is the
      // same fallback `normalizeHoldings()` uses for an unpriced holding, which is
      // what makes `portfolioValue` equal the page headline rather than approximate
      // it. Cost is a value we know; zero is a claim we do not.
      const agg = aggregateLots(lots);
      const atCost = agg ? agg.shares * agg.avgCost : 0;
      excluded.push({
        label: symbol,
        reason: "unpriced",
        valueBase: opts.fallbackValueFor?.(symbol) ?? atCost,
        // Carried at cost, so it contributes exactly zero P&L to `total` rather
        // than a fabricated gain or loss — while still counting toward capital at
        // risk, which keeps the denominator equal to the page's totalCost.
        costBasisBase: atCost,
      });
      continue;
    }

    allLots.push(...lots);

    // Closed positions are REPORTED, not dropped.
    //
    // `positions` used to be filtered to `shares > 0` while `realizedPnl` above
    // accrued from every position — so a fully-exited winner contributed to the
    // headline and appeared nowhere in the table beneath it. The per-position
    // breakdown has to be additive against the same total it sits under, or it
    // argues with it: GLD's banked +$2,856 was 7% of this book's total P&L and was
    // about to vanish from the table entirely the moment its dust residual was
    // cleaned up.
    if (perf.shares > 0 || perf.realizedPnl !== 0) positions.push(perf);

    // Realized P&L accrues even on closed positions.
    realizedPnl += perf.realizedPnl;
    if (perf.shares > 0) {
      costBasis += perf.costBasis;
      currentValue += perf.currentValue;
    }
  }

  const unrealizedPnl = currentValue - costBasis;
  const totalPnl = realizedPnl + unrealizedPnl;

  /**
   * A lot's currency→base rate on its OWN trade date.
   *
   * Shared by the portfolio XIRR and the benchmark replication below so both convert
   * a foreign flow exactly the way `positionPerformance()` did. Reading a single
   * per-symbol rate off the live valuation (the previous approach) meant a closed
   * foreign position contributed its flows at 1.0, which flowed straight into the
   * money-weighted return and into the "same money in SPY" comparison.
   */
  const lotRate = (l: PortfolioLot): number => {
    const cur = (l.currency ?? "").toUpperCase();
    // Live valuation's rate is the LAST resort, not skipped: a ledger row written
    // before `currency` was persisted still has a correctly-priced open holding to
    // read a rate from, and using that beats falling back to 1.
    const live = resolvePricing(priceFor(l.symbol))?.fxRate;
    const liveRate = live != null && Number.isFinite(live) && live > 0 ? live : 1;
    if (!cur) return liveRate;
    const hist = opts.fxOn?.(cur, l.tradeDate);
    if (hist != null && Number.isFinite(hist) && hist > 0) return hist;
    const now = opts.fxNow?.(cur);
    if (now != null && Number.isFinite(now) && now > 0) return now;
    return liveRate;
  };

  const flows: CashFlow[] = [];
  for (const l of allLots) {
    const [f] = lotCashFlows([l], lotRate(l));
    flows.push(f);
  }
  if (currentValue > 0) flows.push({ date: asOf, amount: currentValue });
  const portXirr = xirr(flows);

  const firstDate = allLots.reduce<string | null>(
    (min, l) => (min == null || l.tradeDate < min ? l.tradeDate : min),
    null,
  );

  // Open positions first (ranked by size), then the closed ones — a position with
  // nothing left in it should not outrank a live holding just because it is sorted
  // on a column it no longer has a value in.
  positions.sort((a, b) =>
    a.closed === b.closed ? b.currentValue - a.currentValue : a.closed ? 1 : -1,
  );

  for (const other of opts.otherHoldings ?? []) {
    excluded.push({
      label: other.label,
      reason: "manual",
      valueBase: other.valueBase,
      costBasisBase: other.costBasisBase,
    });
  }

  // ── The one total return ────────────────────────────────────────────────────
  //
  // Numerator spans EVERYTHING: the traded book's realized + unrealized, plus the
  // gain or loss on holdings excluded from the rate calculation. Denominator is
  // capital at risk, not a flow sum. Both panels render this, so neither can
  // disagree with the other about whether the portfolio is up or down.
  const excludedPnl = excluded.reduce((s, e) => s + (e.valueBase - e.costBasisBase), 0);
  const excludedCost = excluded.reduce((s, e) => s + e.costBasisBase, 0);
  const totalCost = costBasis + excludedCost;
  const totalPnlAll = totalPnl + excludedPnl;

  return {
    costBasis,
    currentValue,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    total: {
      pnl: totalPnlAll,
      cost: totalCost,
      pct: totalCost > 0 ? (totalPnlAll / totalCost) * 100 : 0,
    },
    xirr: portXirr,
    holdingDays: firstDate ? Math.round(yearsBetween(firstDate, asOf) * 365) : 0,
    benchmark: benchmark
      ? benchmarkComparison(
          allLots,
          benchmark.symbol,
          benchmark.history,
          benchmark.priceNow,
          asOf,
          portXirr,
          lotRate,
        )
      : null,
    positions,
    unpricedSymbols,
    excluded,
    portfolioValue: currentValue + excluded.reduce((s, e) => s + e.valueBase, 0),
    asOf,
  };
}
