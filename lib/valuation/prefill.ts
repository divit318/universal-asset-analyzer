/**
 * The facts a valuation starts from, in one place.
 *
 * Both /api/dcf (assumption field hints) and the ValuationCase seeder need the
 * same figures. Mapping them twice is how the app ended up with three WACCs, so
 * the mapping lives here and the routes are thin.
 *
 * Everything is in the symbol's reporting currency, and `currency` says which.
 */

import { getHistory, getQuote, getQuoteSummary } from "../yahoo";
import { getFinancialStatementsYahoo } from "../statements";
import { marketBenchmark } from "../benchmarks";
import type { FinancialStatements, HistoryPoint } from "../types";
import { betaVsBenchmark, type BetaSource } from "./beta";
import { computeWacc, debtToEquityFromYahoo, waccRegionFor, type WaccBreakdown } from "./wacc";

/** Unwrap Yahoo's { raw, fmt } wrapper or a bare number. */
function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "raw" in (v as object)) {
    const raw = (v as { raw?: number }).raw;
    return raw != null && Number.isFinite(raw) ? raw : null;
  }
  return null;
}

/**
 * What the growth figure a valuation is seeded from actually measures.
 *
 * `fcf_cagr` is the real thing — compound annual growth of free cash flow across
 * the reported fiscal years, which is the quantity the model projects.
 * `ttm_revenue` is a fallback for names with no usable cash-flow history (or
 * negative FCF at either endpoint, where a CAGR has no meaning), and is labelled
 * as a proxy everywhere it surfaces so nobody mistakes it for cash-flow growth.
 */
export type DeliveredGrowthBasis = "fcf_cagr" | "ttm_revenue" | "none";

export interface DeliveredGrowth {
  /** Percent, or null when neither basis is available. */
  value: number | null;
  basis: DeliveredGrowthBasis;
  /** Fiscal years spanned, e.g. "FY2021→FY2025". Null for the TTM proxy. */
  window: string | null;
  /** Display-ready description of what this number is. */
  label: string;
  /** True when this is a proxy rather than measured cash-flow growth. */
  isProxy: boolean;
}

/**
 * Long-run perpetuity growth defaults, matching the quant engine's
 * `_DEFAULT_TERMINAL_GROWTH` (2.5%) and its +1pp India PPP adjustment so the
 * deterministic DCF and the Monte Carlo start from the same place.
 */
const TERMINAL_GROWTH_DEFAULT = { US: 2.5, IN: 3.5 } as const;

export interface ValuationFacts {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  /** Trailing twelve-month free cash flow. */
  baseFcf: number | null;
  sharesOutstanding: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  /** totalDebt − totalCash. Negative means net cash. */
  netDebt: number | null;
  operatingMargins: number | null;
  /** Growth the business actually delivered, and what that figure measures. */
  deliveredGrowth: DeliveredGrowth;
  beta: number | null;
  /** Where `beta` came from — home-benchmark regression, Yahoo, or the 1.0 default. */
  betaSource: BetaSource;
  /** Ratio, e.g. 1.45 — already converted from Yahoo's percentage. */
  debtToEquity: number | null;
  wacc: WaccBreakdown;
  /** Default perpetuity growth in percent. */
  terminalGrowth: number;
  /** Annual free cash flow history, oldest first, when available. */
  fcfHistory: { fy: number; value: number }[];
}

const NO_GROWTH: DeliveredGrowth = {
  value: null,
  basis: "none",
  window: null,
  label: "No growth history",
  isProxy: false,
};

/**
 * Derive the delivered-growth figure, preferring measured FCF growth.
 *
 * `cagr()` in lib/statements.ts returns null when either endpoint is non-positive,
 * which is the correct refusal: a company that went from −$1bn to +$2bn of free
 * cash flow has no meaningful compound rate, and inventing one would flow
 * straight into the seeded assumption.
 */
export function deriveDeliveredGrowth(
  statements: FinancialStatements | null,
  ttmRevenueGrowth: number | null,
): DeliveredGrowth {
  const fcf = statements?.freeCashFlow ?? [];
  if (statements?.fcfCagr != null && fcf.length >= 2) {
    const window = `FY${fcf[0].fy}→FY${fcf[fcf.length - 1].fy}`;
    return {
      value: statements.fcfCagr * 100,
      basis: "fcf_cagr",
      window,
      label: `FCF CAGR ${window}`,
      isProxy: false,
    };
  }
  if (ttmRevenueGrowth != null) {
    return {
      value: ttmRevenueGrowth * 100,
      basis: "ttm_revenue",
      window: null,
      label: "TTM revenue growth (proxy)",
      isProxy: true,
    };
  }
  return NO_GROWTH;
}

/** Fetch and normalise everything a valuation needs to begin. */
export async function fetchValuationFacts(symbol: string): Promise<ValuationFacts> {
  // Statements are fetched alongside the quote rather than after it: the growth
  // assumption depends on them, and the Research Hub strip is on a latency
  // budget. Their failure is non-fatal — the TTM proxy covers it.
  // getQuote (the `quote` endpoint) is fetched alongside, purely for price.
  // quoteSummary's `price` module is a DIFFERENT Yahoo endpoint and it goes
  // stale on non-equities: for BTC-USD it served regularMarketPrice 63,925
  // while the live quote was 78,141 — a 22% gap that made the valuation
  // workspace contradict the masthead and the chart on the same screen.
  // getQuote is what every other surface in the app reads, so taking price
  // from it is what keeps them agreeing. Non-fatal: quoteSummary still covers
  // it if the quote call fails.
  // Non-US listings need a home-benchmark beta regression (see resolveBeta):
  // the histories are kicked off with the other fetches when the suffix alone
  // already settles the region, so the common .NS/.BO path pays no extra trip.
  const provisionalRegion = waccRegionFor(symbol, null);
  const historyPromises =
    provisionalRegion === "IN" ? betaHistoryPromises(symbol, provisionalRegion) : null;

  const [summaryResult, statementsResult, quoteResult] = await Promise.allSettled([
    getQuoteSummary(symbol, ["financialData", "defaultKeyStatistics", "price"]),
    getFinancialStatementsYahoo(symbol),
    getQuote(symbol),
  ]);

  if (summaryResult.status === "rejected") throw summaryResult.reason;
  const raw = summaryResult.value as Record<string, unknown>;
  const statements = statementsResult.status === "fulfilled" ? statementsResult.value : null;
  const livePrice = quoteResult.status === "fulfilled" ? num(quoteResult.value?.price) : null;

  const fd = (raw.financialData ?? {}) as Record<string, unknown>;
  const ks = (raw.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const pr = (raw.price ?? {}) as Record<string, unknown>;

  const currency = ((pr.currency as string | undefined) ?? "USD").toUpperCase();
  const totalDebt = num(fd.totalDebt);
  const totalCash = num(fd.totalCash);
  const debtToEquity = debtToEquityFromYahoo(num(fd.debtToEquity));
  const region = waccRegionFor(symbol, currency);
  const { beta, betaSource } = await resolveBeta(
    symbol,
    region,
    num(ks.beta),
    // Currency-only IN detection (no .NS/.BO suffix) misses the concurrent
    // kick-off above; fetch late rather than use the wrong-index beta.
    historyPromises ?? (region === "IN" ? betaHistoryPromises(symbol, region) : null),
  );

  return {
    symbol,
    name: (pr.longName as string | undefined) ?? (pr.shortName as string | undefined) ?? symbol,
    currency,
    price: livePrice ?? num(pr.regularMarketPrice) ?? num(fd.currentPrice),
    baseFcf: num(fd.freeCashflow),
    sharesOutstanding: num(ks.sharesOutstanding),
    totalDebt,
    totalCash,
    netDebt: totalDebt != null && totalCash != null ? totalDebt - totalCash : null,
    operatingMargins: num(fd.operatingMargins),
    deliveredGrowth: deriveDeliveredGrowth(statements, num(fd.revenueGrowth)),
    beta,
    betaSource,
    debtToEquity,
    wacc: computeWacc({ beta, debtToEquity, region }),
    terminalGrowth: TERMINAL_GROWTH_DEFAULT[region],
    fcfHistory: statements?.freeCashFlow ?? [],
  };
}

/** ~550 calendar days comfortably covers the 252-trading-day beta window. */
const BETA_HISTORY_DAYS = 550;

function betaHistoryPromises(symbol: string, region: "IN") {
  const bench = marketBenchmark(region);
  return {
    asset: getHistory(symbol, BETA_HISTORY_DAYS).catch(() => []),
    benchmark: getHistory(bench.symbol, BETA_HISTORY_DAYS).catch(() => []),
  };
}

/**
 * The beta a CAPM discount rate may actually use.
 *
 * Yahoo's `beta` is S&P 500-relative for EVERY listing, home market or not.
 * For NSE/BSE names that reads 0.15–0.4 where the NIFTY-relative figure is
 * ~1.0 — low enough to push the cost of equity BELOW the Indian risk-free
 * rate (Phase 2 audit; measured TCS 0.164 vs 0.89 true). So for the IN
 * region the vendor figure is never used: beta is regressed against
 * NIFTY 50 from price history, and when the history is too thin the fallback
 * is the 1.0 prior — NOT Yahoo's wrong-index number. US listings keep the
 * Yahoo figure (the S&P 500 IS their home benchmark).
 */
async function resolveBeta(
  symbol: string,
  region: "US" | "IN",
  yahooBeta: number | null,
  histories: { asset: Promise<HistoryPoint[]>; benchmark: Promise<HistoryPoint[]> } | null,
): Promise<{ beta: number | null; betaSource: BetaSource }> {
  if (region !== "IN") {
    return { beta: yahooBeta, betaSource: yahooBeta != null ? "yahoo" : "default" };
  }
  if (histories) {
    const [asset, benchmark] = await Promise.all([histories.asset, histories.benchmark]);
    const computed = betaVsBenchmark(asset, benchmark);
    if (computed != null) return { beta: computed, betaSource: "benchmark_regression" };
  }
  // null → computeWacc's DEFAULT_BETA (1.0) applies; label it as the default.
  return { beta: null, betaSource: "default" };
}

/**
 * Whether a discounted-cash-flow case can be built at all.
 *
 * The valuation framework is deliberately FCF-based, so it applies to
 * cash-generating operating businesses. An ETF, a bond fund or a token has no
 * free cash flow of its own and is handled by the per-class frameworks in
 * lib/compare/ instead — see `unvaluableReason` for the message shown.
 */
export function canValue(facts: ValuationFacts): boolean {
  return (
    facts.baseFcf != null && facts.baseFcf > 0 &&
    facts.sharesOutstanding != null && facts.sharesOutstanding > 0
  );
}

/** Why a DCF case cannot be built, phrased for the user. Null when it can. */
export function unvaluableReason(facts: ValuationFacts): string | null {
  if (canValue(facts)) return null;
  if (facts.baseFcf == null) {
    return "No free cash flow is reported for this symbol. The valuation case is a discounted cash flow model, so it only applies to cash-generating operating companies — funds, bonds and crypto are covered by Compare instead.";
  }
  if (facts.baseFcf <= 0) {
    return "Trailing free cash flow is negative, so a discounted cash flow model cannot be anchored on it. Override the starting FCF with a normalised figure if you want to value this name.";
  }
  return "No share count is reported for this symbol, so a per-share value cannot be derived.";
}
