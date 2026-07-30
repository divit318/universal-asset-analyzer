/**
 * The facts a valuation starts from, in one place.
 *
 * Both /api/dcf (assumption field hints) and the ValuationCase seeder need the
 * same figures. Mapping them twice is how the app ended up with three WACCs, so
 * the mapping lives here and the routes are thin.
 *
 * Everything is in the symbol's reporting currency, and `currency` says which.
 */

import { getQuoteSummary } from "../yahoo";
import { getFinancialStatementsYahoo } from "../statements";
import type { FinancialStatements } from "../types";
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
  const [summaryResult, statementsResult] = await Promise.allSettled([
    getQuoteSummary(symbol, ["financialData", "defaultKeyStatistics", "price"]),
    getFinancialStatementsYahoo(symbol),
  ]);

  if (summaryResult.status === "rejected") throw summaryResult.reason;
  const raw = summaryResult.value as Record<string, unknown>;
  const statements = statementsResult.status === "fulfilled" ? statementsResult.value : null;

  const fd = (raw.financialData ?? {}) as Record<string, unknown>;
  const ks = (raw.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const pr = (raw.price ?? {}) as Record<string, unknown>;

  const currency = ((pr.currency as string | undefined) ?? "USD").toUpperCase();
  const totalDebt = num(fd.totalDebt);
  const totalCash = num(fd.totalCash);
  const beta = num(ks.beta);
  const debtToEquity = debtToEquityFromYahoo(num(fd.debtToEquity));
  const region = waccRegionFor(symbol, currency);

  return {
    symbol,
    name: (pr.longName as string | undefined) ?? (pr.shortName as string | undefined) ?? symbol,
    currency,
    price: num(fd.currentPrice) ?? num(pr.regularMarketPrice),
    baseFcf: num(fd.freeCashflow),
    sharesOutstanding: num(ks.sharesOutstanding),
    totalDebt,
    totalCash,
    netDebt: totalDebt != null && totalCash != null ? totalDebt - totalCash : null,
    operatingMargins: num(fd.operatingMargins),
    deliveredGrowth: deriveDeliveredGrowth(statements, num(fd.revenueGrowth)),
    beta,
    debtToEquity,
    wacc: computeWacc({ beta, debtToEquity, region }),
    terminalGrowth: TERMINAL_GROWTH_DEFAULT[region],
    fcfHistory: statements?.freeCashFlow ?? [],
  };
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
