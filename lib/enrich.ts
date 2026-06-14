import { getFundamentalsTimeSeries, getQuoteSummary } from "./yahoo";
import type { StockFundamentals } from "./types";

/**
 * Turns Yahoo's quoteSummary + annual time series into the cached, price-
 * independent fundamentals for one company. Price-dependent figures (FCF yield,
 * market cap) are layered on later from a live quote, so this slice can be
 * cached for hours. Everything here is best-effort: any missing input maps to
 * `null` rather than throwing, so one sparse field never sinks a whole row.
 */

const MODULES = [
  "assetProfile",
  "summaryDetail",
  "financialData",
  "defaultKeyStatistics",
  "majorHoldersBreakdown",
  "earningsHistory",
];

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Compound annual growth rate over `years`, as a percent. Null when invalid. */
function cagr(series: (number | null)[], years: number): number | null {
  const xs = series.filter((x): x is number => x != null);
  if (xs.length < years + 1) return null;
  const last = xs[xs.length - 1];
  const base = xs[xs.length - 1 - years];
  if (base == null || base <= 0 || last <= 0) return null;
  return ((last / base) ** (1 / years) - 1) * 100;
}

interface RawProfile {
  sector?: string;
  industry?: string;
}
interface RawFinancialData {
  totalRevenue?: number;
  ebitda?: number;
  grossMargins?: number;
  operatingMargins?: number;
  returnOnEquity?: number;
  revenueGrowth?: number;
  earningsGrowth?: number;
  freeCashflow?: number;
  totalDebt?: number;
  totalCash?: number;
  debtToEquity?: number;
  currentRatio?: number;
}
interface RawSummary {
  assetProfile?: RawProfile;
  summaryDetail?: { dividendYield?: number; forwardPE?: number };
  financialData?: RawFinancialData;
  defaultKeyStatistics?: {
    enterpriseToEbitda?: number;
    forwardPE?: number;
    sharesOutstanding?: number;
  };
  majorHoldersBreakdown?: { institutionsPercentHeld?: number };
  earningsHistory?: { history?: { surprisePercent?: number | null }[] };
}

/** Pull a chronological numeric series for one field out of the time series. */
function series(rows: Record<string, unknown>[], field: string): (number | null)[] {
  return rows.map((r) => num(r[field]));
}

export function mapFundamentals(
  symbol: string,
  name: string,
  raw: RawSummary,
  ts: Record<string, unknown>[],
): StockFundamentals {
  const fd = raw.financialData ?? {};
  const ks = raw.defaultKeyStatistics ?? {};
  const sd = raw.summaryDetail ?? {};
  const pct = (v: number | null | undefined) => (v == null ? null : v * 100);

  // Time-series derived (latest = last element).
  const revenue = series(ts, "totalRevenue");
  const eps = series(ts, "dilutedEPS");
  const fcf = series(ts, "freeCashFlow");
  const shares = series(ts, "dilutedAverageShares");
  const opIncome = series(ts, "operatingIncome");
  const invested = series(ts, "investedCapital");
  const netDebt = series(ts, "netDebt");
  const taxRate = series(ts, "taxRateForCalcs");
  const last = <T>(xs: (T | null)[]): T | null => {
    for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return xs[i];
    return null;
  };

  // ROIC = NOPAT / invested capital, using the company's own effective tax rate.
  const oi = last(opIncome);
  const ic = last(invested);
  const tax = last(taxRate) ?? 0.21;
  const roic = oi != null && ic != null && ic !== 0 ? ((oi * (1 - tax)) / ic) * 100 : null;

  // Net debt / EBITDA (net debt from the balance sheet, EBITDA from Yahoo).
  const nd = last(netDebt);
  const netDebtToEbitda = nd != null && fd.ebitda != null && fd.ebitda !== 0 ? nd / fd.ebitda : null;

  // FCF margin & 1-year FCF growth.
  const fcfLast = last(fcf);
  const revLast = last(revenue);
  const fcfMargin = fcfLast != null && revLast != null && revLast !== 0 ? (fcfLast / revLast) * 100 : null;
  const fcfPair = fcf.filter((x): x is number => x != null);
  const fcfGrowthYoY =
    fcfPair.length >= 2 && fcfPair.at(-2)! > 0
      ? (fcfPair.at(-1)! / fcfPair.at(-2)! - 1) * 100
      : null;

  // Buyback yield ≈ 1-year reduction in diluted share count.
  const sh = shares.filter((x): x is number => x != null);
  const buybackYield =
    sh.length >= 2 && sh.at(-2)! > 0 ? ((sh.at(-2)! - sh.at(-1)!) / sh.at(-2)!) * 100 : null;

  const surprises = raw.earningsHistory?.history ?? [];
  const latestSurprise = surprises.length ? surprises.at(-1)!.surprisePercent : null;

  return {
    symbol,
    name,
    sector: raw.assetProfile?.sector ?? null,
    industry: raw.assetProfile?.industry ?? null,

    forwardPE: num(ks.forwardPE) ?? num(sd.forwardPE),
    evToEbitda: num(ks.enterpriseToEbitda),

    revenueGrowthYoY: pct(num(fd.revenueGrowth)),
    revenueCagr3y: cagr(revenue, 3),
    epsGrowthYoY: pct(num(fd.earningsGrowth)),
    epsCagr3y: cagr(eps, 3),

    roic,
    roe: pct(num(fd.returnOnEquity)),
    grossMargin: pct(num(fd.grossMargins)),
    operatingMargin: pct(num(fd.operatingMargins)),

    // Yahoo reports debt/equity as a percentage (79.5 = 0.795x).
    debtToEquity: fd.debtToEquity != null ? fd.debtToEquity / 100 : null,
    netDebtToEbitda,
    currentRatio: num(fd.currentRatio),

    fcfMargin,
    fcfGrowthYoY,

    dividendYield: pct(num(sd.dividendYield)),
    buybackYield,

    institutionalOwnership: pct(num(raw.majorHoldersBreakdown?.institutionsPercentHeld)),
    earningsSurprisePct: latestSurprise != null ? latestSurprise * 100 : null,

    // Extra raw figures kept for the live price layer (FCF yield needs market cap).
    ebitda: num(fd.ebitda),
    freeCashflow: num(fd.freeCashflow),
  };
}

/** Fetch + map the cached fundamentals for one symbol. */
export async function enrichSymbol(symbol: string, name: string): Promise<StockFundamentals> {
  const [raw, ts] = await Promise.all([
    getQuoteSummary(symbol, MODULES) as Promise<RawSummary>,
    getFundamentalsTimeSeries(symbol).catch(() => [] as Record<string, unknown>[]),
  ]);
  return mapFundamentals(symbol, name, raw, ts);
}
