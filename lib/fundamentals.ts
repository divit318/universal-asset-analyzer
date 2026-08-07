import { getQuoteSummary } from "./yahoo";
import type {
  AnalystConsensus,
  EarningsData,
  EarningsPoint,
  FundamentalsSnapshot,
  InsiderActivity,
  InsiderTransaction,
  InsiderTxType,
  InstitutionalHolder,
  OwnershipData,
} from "./types";

/** Exported so callers needing the fundamentals fetch's cache freshness (not just its data) can ask for the same cache key via getQuoteSummaryMeta. */
export const MODULES = [
  "assetProfile",
  "financialData",
  "summaryDetail",
  "defaultKeyStatistics",
  "recommendationTrend",
  "earningsTrend",
  "earningsHistory",
  "insiderTransactions",
  "calendarEvents",
  "majorHoldersBreakdown",
  "institutionOwnership",
];

/* -------------------------------------------------------------------------- */
/* Raw Yahoo shapes (validateResult: false — fields may be missing or wrapped) */
/* -------------------------------------------------------------------------- */

/** Unwrap Yahoo's `{ raw, fmt }` wrapper OR accept a bare number. */
const r = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && v !== null && "raw" in v) {
    const rv = (v as { raw?: number }).raw;
    return rv != null && Number.isFinite(rv) ? rv : null;
  }
  return null;
};

const n = (v: number | undefined | null): number | null =>
  v == null || Number.isNaN(v) ? null : v;

interface RawFinancialData {
  currentPrice?: number;
  targetMeanPrice?: number;
  targetHighPrice?: number;
  targetLowPrice?: number;
  recommendationKey?: string;
  numberOfAnalystOpinions?: number;
  returnOnEquity?: number;
  returnOnAssets?: number;
  grossMargins?: number;
  operatingMargins?: number;
  profitMargins?: number;
  ebitdaMargins?: number;
  revenueGrowth?: number;
  earningsGrowth?: number;
  debtToEquity?: number;
  currentRatio?: number;
  quickRatio?: number;
  freeCashflow?: number;
  operatingCashflow?: number;
  totalCash?: number;
  totalDebt?: number;
  ebitda?: number;
  /** Currency the financialData figures are reported in (differs from the
   * trading currency for ADRs, e.g. TSM: TWD figures on a USD listing). */
  financialCurrency?: string;
}

interface RawTrendPoint {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

interface RawEarningsTrendPoint {
  period: string;
  epsEstimate?: unknown;
  epsRevisions?: { upLast30days?: number | null; downLast30days?: number | null };
}

interface RawEarningsHistoryItem {
  quarter?: Date | string | null;
  epsActual?: unknown;
  epsEstimate?: unknown;
  surprisePercent?: unknown;
  period?: string;
}

interface RawInsiderTx {
  filerName?: string;
  transactionText?: string;
  shares?: number;
  value?: number;
  startDate?: string | Date;
}

interface RawInstitutionHolder {
  organization?: string;
  pctHeld?: unknown;
  shares?: unknown;
  value?: unknown;
}

interface RawSummary {
  assetProfile?: { sector?: string; industry?: string };
  financialData?: RawFinancialData;
  summaryDetail?: { trailingPE?: number; forwardPE?: number; dividendYield?: number; priceToSalesTrailing12Months?: number };
  defaultKeyStatistics?: {
    forwardPE?: number;
    pegRatio?: number;
    priceToBook?: number;
    bookValue?: number;
    sharesOutstanding?: number;
    netIncomeToCommon?: number;
    shortPercentOfFloat?: unknown;
    shortRatio?: unknown;
    sharesShort?: unknown;
    trailingEps?: unknown;
    forwardEps?: unknown;
    enterpriseToEbitda?: number;
    enterpriseToRevenue?: number;
  };
  recommendationTrend?: { trend?: RawTrendPoint[] };
  earningsTrend?: { trend?: RawEarningsTrendPoint[] };
  earningsHistory?: { history?: RawEarningsHistoryItem[] };
  insiderTransactions?: { transactions?: RawInsiderTx[] };
  calendarEvents?: {
    earnings?: {
      earningsDate?: (Date | string | null)[];
    };
  };
  majorHoldersBreakdown?: {
    institutionsPercentHeld?: unknown;
    insidersPercentHeld?: unknown;
    institutionsCount?: number;
  };
  institutionOwnership?: {
    ownershipList?: RawInstitutionHolder[];
  };
}

/* -------------------------------------------------------------------------- */
/* Mappers                                                                    */
/* -------------------------------------------------------------------------- */

/** FundamentalsSnapshot plus the currency its financialData figures carry. */
export interface FundamentalsSnapshotWithCurrency extends FundamentalsSnapshot {
  financialCurrency: string | null;
}

export function mapSnapshot(symbol: string, raw: RawSummary): FundamentalsSnapshotWithCurrency {
  const fd = raw.financialData ?? {};
  const sd = raw.summaryDetail ?? {};
  const ks = raw.defaultKeyStatistics ?? {};
  return {
    symbol,
    financialCurrency: typeof fd.financialCurrency === "string" ? fd.financialCurrency : null,
    price: n(fd.currentPrice),
    sector: raw.assetProfile?.sector ?? null,
    industry: raw.assetProfile?.industry ?? null,
    trailingPE: n(sd.trailingPE),
    forwardPE: n(sd.forwardPE ?? ks.forwardPE),
    pegRatio: n(ks.pegRatio),
    priceToBook: n(ks.priceToBook),
    dividendYield: n(sd.dividendYield),
    // ROE fallback: Yahoo omits financialData.returnOnEquity for some
    // non-US listings (observed: KOTAKBANK.NS) while still reporting net
    // income and book value in defaultKeyStatistics — both in the same
    // reporting currency, so the ratio is safe. ROA has no such fallback
    // (total assets are not in any fetched module) and stays deliberately
    // unavailable rather than approximated.
    returnOnEquity: (() => {
      if (fd.returnOnEquity != null) return n(fd.returnOnEquity);
      if (ks.netIncomeToCommon != null && ks.bookValue != null && ks.sharesOutstanding != null) {
        const bookEq = ks.bookValue * ks.sharesOutstanding;
        if (bookEq > 0) return ks.netIncomeToCommon / bookEq;
      }
      return null;
    })(),
    returnOnAssets: n(fd.returnOnAssets),
    grossMargins: n(fd.grossMargins),
    operatingMargins: n(fd.operatingMargins),
    profitMargins: n(fd.profitMargins),
    ebitdaMargins: n(fd.ebitdaMargins),
    revenueGrowth: n(fd.revenueGrowth),
    earningsGrowth: n(fd.earningsGrowth),
    // D/E fallback for financial stocks (banks, insurance): Yahoo omits debtToEquity
    // for these sectors. Derive it from book value per share × shares outstanding.
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
    currentRatio: n(fd.currentRatio),
    quickRatio: n(fd.quickRatio),
    freeCashflow: n(fd.freeCashflow),
    operatingCashflow: n(fd.operatingCashflow),
    totalCash: n(fd.totalCash),
    totalDebt: n(fd.totalDebt),
    ebitda: n(fd.ebitda),
    enterpriseToEbitda: n(ks.enterpriseToEbitda),
    priceToSalesTrailing12Months: n(sd.priceToSalesTrailing12Months),
  };
}

export function mapAnalyst(raw: RawSummary): AnalystConsensus {
  const fd = raw.financialData ?? {};
  const trend = raw.recommendationTrend?.trend?.[0];
  const current = raw.earningsTrend?.trend?.find((t) => t.period === "0q");
  const price = fd.currentPrice ?? null;
  const target = fd.targetMeanPrice ?? null;

  // Yahoo's `numberOfAnalystOpinions` (price-target sample) and the rating
  // distribution routinely disagree by one or two (e.g. "23 analysts" over a
  // 4+12+8 = 24 breakdown). Every rendered count derives from ONE source: the
  // distribution when it exists, the financialData figure only as a fallback.
  const distributionTotal =
    (trend?.strongBuy ?? 0) + (trend?.buy ?? 0) + (trend?.hold ?? 0) +
    (trend?.sell ?? 0) + (trend?.strongSell ?? 0);

  return {
    targetMean: n(target),
    targetHigh: n(fd.targetHighPrice),
    targetLow: n(fd.targetLowPrice),
    upsidePercent: price && target ? ((target - price) / price) * 100 : null,
    recommendationKey: fd.recommendationKey ?? null,
    numberOfOpinions: distributionTotal > 0 ? distributionTotal : n(fd.numberOfAnalystOpinions),
    strongBuy: trend?.strongBuy ?? 0,
    buy: trend?.buy ?? 0,
    hold: trend?.hold ?? 0,
    sell: trend?.sell ?? 0,
    strongSell: trend?.strongSell ?? 0,
    epsRevisionsUp30d: n(current?.epsRevisions?.upLast30days),
    epsRevisionsDown30d: n(current?.epsRevisions?.downLast30days),
    epsSurprises: (raw.earningsHistory?.history ?? [])
      .map((h) => r(h.surprisePercent))
      .filter((s): s is number => s != null),
  };
}

/**
 * Classify a Yahoo insider transaction from its text.
 *
 * Order matters: compensation events (awards/grants/gifts, option exercises,
 * conversions, tax withholding) are checked FIRST, because SEC Form 4 codes
 * A/M/F/G are not open-market sells even when the text also mentions a price.
 * Miscounting director equity grants as disposals is exactly how a header once
 * claimed "33 sells" over a table of eight identical 789-share grants.
 */
export function classifyTx(text: string): InsiderTxType {
  const t = text.toLowerCase();
  if (
    t.includes("award") || t.includes("grant") || t.includes("gift") ||
    t.includes("exercise") || t.includes("conversion") || t.includes("tax")
  ) return "other";
  if (t.includes("sale") || t.includes("sell") || t.includes("sold")) return "sell";
  if (t.includes("purchase") || t.includes("buy") || t.includes("bought")) return "buy";
  return "other";
}

/** How many transactions ship to the client. Header totals are computed over
 *  EXACTLY this set, so the summary line always reconciles with the table. */
const INSIDER_TX_LIMIT = 20;

export function mapInsider(raw: RawSummary): InsiderActivity {
  const txs = (raw.insiderTransactions?.transactions ?? [])
    .map((t): InsiderTransaction => {
      const text = t.transactionText ?? "";
      return {
        name: t.filerName ?? "—",
        type: classifyTx(text),
        shares: n(t.shares),
        value: n(t.value),
        date: t.startDate ? new Date(t.startDate).toISOString().slice(0, 10) : "",
        text,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, INSIDER_TX_LIMIT);

  // Invariant (asserted in tests/fundamentals-mappers.test.ts): these totals
  // are computed from the same `transactions` array that renders as the table.
  let netValue = 0;
  let buyCount = 0;
  let sellCount = 0;
  for (const t of txs) {
    if (t.type === "buy") { buyCount++; netValue += t.value ?? 0; }
    else if (t.type === "sell") { sellCount++; netValue -= t.value ?? 0; }
  }
  return { transactions: txs, netValue, buyCount, sellCount };
}

function quarterLabel(d: Date): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const yr = String(d.getUTCFullYear()).slice(-2);
  return `Q${q} '${yr}`;
}

export function mapEarnings(raw: RawSummary): EarningsData {
  const history: EarningsPoint[] = (raw.earningsHistory?.history ?? [])
    .map((h): EarningsPoint | null => {
      if (!h.quarter) return null;
      const d = new Date(h.quarter as string | Date);
      return {
        date: d.toISOString().slice(0, 10),
        quarter: quarterLabel(d),
        epsActual: r(h.epsActual),
        epsEstimate: r(h.epsEstimate),
        surprisePercent: r(h.surprisePercent),
      };
    })
    .filter((x): x is EarningsPoint => x !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Next earnings date from calendarEvents (Yahoo returns a [start, end] window).
  const earningsDates = raw.calendarEvents?.earnings?.earningsDate ?? [];
  const nextDate = earningsDates[0]
    ? new Date(earningsDates[0] as string | Date).toISOString().slice(0, 10)
    : null;
  const nextDateEnd = earningsDates[1]
    ? new Date(earningsDates[1] as string | Date).toISOString().slice(0, 10)
    : null;

  // Forward EPS from current-year earnings trend.
  const ks = raw.defaultKeyStatistics ?? {};
  const trend0y = raw.earningsTrend?.trend?.find((t) => t.period === "0y");
  const forwardEps = r(ks.forwardEps) ?? r(trend0y?.epsEstimate);
  const trailingEps = r(ks.trailingEps);

  return { history, nextDate, nextDateEnd, trailingEps, forwardEps };
}

export function mapOwnership(raw: RawSummary): OwnershipData {
  const mh = raw.majorHoldersBreakdown ?? {};
  const ks = raw.defaultKeyStatistics ?? {};
  const list = raw.institutionOwnership?.ownershipList ?? [];

  const topHolders: InstitutionalHolder[] = list
    .slice(0, 10)
    .map((h): InstitutionalHolder => ({
      name: h.organization ?? "—",
      pctHeld: r(h.pctHeld),
      shares: r(h.shares),
      value: r(h.value),
    }));

  return {
    institutionsPctHeld: r(mh.institutionsPercentHeld),
    insidersPctHeld: r(mh.insidersPercentHeld),
    institutionsCount: mh.institutionsCount ?? null,
    shortPctOfFloat: r(ks.shortPercentOfFloat),
    shortRatio: r(ks.shortRatio),
    sharesShort: r(ks.sharesShort),
    topHolders,
  };
}

/* -------------------------------------------------------------------------- */
/* Public interface                                                            */
/* -------------------------------------------------------------------------- */

export interface FundamentalsParts {
  snapshot: FundamentalsSnapshotWithCurrency;
  analyst: AnalystConsensus;
  insider: InsiderActivity;
  earnings: EarningsData;
  ownership: OwnershipData;
}

export async function getFundamentals(symbol: string): Promise<FundamentalsParts> {
  const raw = (await getQuoteSummary(symbol, MODULES)) as RawSummary;
  return {
    snapshot: mapSnapshot(symbol, raw),
    analyst: mapAnalyst(raw),
    insider: mapInsider(raw),
    earnings: mapEarnings(raw),
    ownership: mapOwnership(raw),
  };
}
