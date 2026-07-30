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
  "price",
  "summaryDetail",
  "financialData",
  "defaultKeyStatistics",
  "majorHoldersBreakdown",
  "earningsHistory",
];

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Keep a value only when it falls inside a plausible band, else null. Guards
 * against Yahoo's ADR data quirks (e.g. a foreign EPS vs USD price giving a
 * "P/E of 1"), which would otherwise fake a deep-value signal. */
const sane = (v: number | null, lo: number, hi: number): number | null =>
  v != null && v > lo && v < hi ? v : null;

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
  operatingCashflow?: number;
  totalDebt?: number;
  totalCash?: number;
  debtToEquity?: number;
  currentRatio?: number;
  /* Analyst consensus. Already present in every response this module fetches —
   * `financialData` is in MODULES — so reading it costs nothing extra. */
  targetMeanPrice?: number;
  targetHighPrice?: number;
  targetLowPrice?: number;
  numberOfAnalystOpinions?: number;
}
interface RawSummary {
  assetProfile?: RawProfile;
  price?: { exchangeName?: string; fullExchangeName?: string };
  summaryDetail?: { dividendYield?: number; forwardPE?: number; beta?: number };
  financialData?: RawFinancialData;
  defaultKeyStatistics?: {
    enterpriseToEbitda?: number;
    forwardPE?: number;
    sharesOutstanding?: number;
    bookValue?: number;
    beta?: number;
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
  const roicDirect = oi != null && ic != null && ic !== 0 ? ((oi * (1 - tax)) / ic) * 100 : null;
  // Fallback: estimate ROIC ≈ ROE / (1 + D/E) when time-series data is absent.
  // Derivation: ROIC = Net Income / (Equity + Debt) = (Net Income / Equity) / (1 + D/E)
  // This is a rough approximation (ignores interest tax shield) but much better than null.
  const roicEstimate =
    roicDirect == null && fd.returnOnEquity != null && fd.debtToEquity != null
      ? (fd.returnOnEquity / (1 + fd.debtToEquity / 100)) * 100
      : null;
  const roic = roicDirect ?? roicEstimate;

  // Net debt / EBITDA. Prefer the time-series balance-sheet netDebt value; fall
  // back to computing it from Yahoo's financialData (totalDebt - totalCash) when
  // the time series doesn't include that field (common for ADRs and new listings).
  const ndTs = last(netDebt);
  const ndFallback =
    fd.totalDebt != null && fd.totalCash != null ? fd.totalDebt - fd.totalCash : null;
  const nd = ndTs ?? ndFallback;
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

  // Operating cash flow + its growth. Carried purely for the REIT screener,
  // where OCF is the FFO proxy (see lib/assets/reit.ts). Prefer the annual time
  // series; fall back to financialData's TTM figure when the series is absent.
  const ocf = series(ts, "operatingCashFlow");
  const ocfPair = ocf.filter((x): x is number => x != null);
  const ocfGrowthYoY =
    ocfPair.length >= 2 && ocfPair.at(-2)! > 0
      ? (ocfPair.at(-1)! / ocfPair.at(-2)! - 1) * 100
      : null;
  const operatingCashflow = last(ocf) ?? num(fd.operatingCashflow);

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

    // summaryDetail.forwardPE is reliable for ADRs; defaultKeyStatistics often
    // divides a local-currency EPS by the USD price (giving a "P/E of 1").
    forwardPE: sane(num(sd.forwardPE) ?? num(ks.forwardPE), 2, 250),
    // Upper bound raised to 500: high-growth names (Tesla, Nvidia at peak) trade
    // at 100-300× EV/EBITDA; the old cap of 100 silently nulled ~20% of universe.
    evToEbitda: sane(num(ks.enterpriseToEbitda), 2, 500),

    revenueGrowthYoY: pct(num(fd.revenueGrowth)),
    revenueCagr3y: cagr(revenue, 3),
    epsGrowthYoY: pct(num(fd.earningsGrowth)),
    epsCagr3y: cagr(eps, 3),

    roic,
    roe: pct(num(fd.returnOnEquity)),
    grossMargin: pct(num(fd.grossMargins)),
    operatingMargin: pct(num(fd.operatingMargins)),

    // Yahoo reports debt/equity as a percentage (79.5 = 0.795x).
    // D/E fallback for financial stocks: derive from book value × shares when Yahoo omits it.
    // Cap at 30x: ADR stocks have a currency mismatch (totalDebt in local currency,
    // bookValue in USD) that produces absurdly high ratios — the cap discards those.
    debtToEquity: (() => {
      if (fd.debtToEquity != null) return fd.debtToEquity / 100;
      if (fd.totalDebt != null && ks.bookValue != null && ks.sharesOutstanding != null) {
        const bookEq = ks.bookValue * ks.sharesOutstanding;
        if (bookEq > 0) {
          const ratio = fd.totalDebt / bookEq;
          return ratio < 30 ? ratio : null;
        }
      }
      return null;
    })(),
    netDebtToEbitda,
    netDebt: nd,
    currentRatio: num(fd.currentRatio),

    fcfMargin,
    fcfGrowthYoY,
    operatingCashflow,
    ocfGrowthYoY,

    dividendYield: pct(num(sd.dividendYield)),
    buybackYield,

    institutionalOwnership: pct(num(raw.majorHoldersBreakdown?.institutionsPercentHeld)),
    earningsSurprisePct: latestSurprise != null ? latestSurprise * 100 : null,

    // Extra raw figures kept for the live price layer (FCF yield needs market cap).
    ebitda: num(fd.ebitda),
    // financialData.freeCashflow (Yahoo's TTM figure) is frequently absent for
    // financials, foreign filers and recent IPOs. Falling back to the latest
    // annual figure from the time series (fcfLast, already fetched above for
    // fcfMargin/fcfGrowthYoY) recovers FCF yield for those names using data
    // this call already pulled, rather than leaving it null when Yahoo simply
    // hasn't computed the TTM roll-up yet.
    freeCashflow: num(fd.freeCashflow) ?? fcfLast,
    exchange: raw.price?.exchangeName ?? raw.price?.fullExchangeName ?? null,
    // Market beta (best-effort). Bounded to a sane band; ADR/thin names can
    // report garbage. Feeds risk-oriented objectives in the fit scorer.
    beta: sane(num(sd.beta) ?? num(raw.defaultKeyStatistics?.beta), -1, 5),

    // Analyst consensus, straight out of the response already in hand. Not
    // sanity-banded against price here: the watchlist compares it to a live
    // quote and can judge plausibility with both numbers in view, whereas a
    // band applied blind would silently drop legitimate targets on volatile
    // names. Only opinion-backed targets are kept — a "consensus" of zero
    // analysts is Yahoo echoing a stale field, not a view.
    analystTargetMean: (fd.numberOfAnalystOpinions ?? 0) > 0 ? num(fd.targetMeanPrice) : null,
    analystTargetHigh: (fd.numberOfAnalystOpinions ?? 0) > 0 ? num(fd.targetHighPrice) : null,
    analystTargetLow: (fd.numberOfAnalystOpinions ?? 0) > 0 ? num(fd.targetLowPrice) : null,
    analystOpinions: num(fd.numberOfAnalystOpinions),
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
