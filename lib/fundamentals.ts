import { getQuoteSummary } from "./yahoo";
import type {
  AnalystConsensus,
  FundamentalsSnapshot,
  InsiderActivity,
  InsiderTransaction,
  InsiderTxType,
} from "./types";

const MODULES = [
  "financialData",
  "summaryDetail",
  "defaultKeyStatistics",
  "recommendationTrend",
  "earningsTrend",
  "earningsHistory",
  "insiderTransactions",
];

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
  totalCash?: number;
  totalDebt?: number;
  ebitda?: number;
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
  epsRevisions?: { upLast30days?: number | null; downLast30days?: number | null };
}
interface RawInsiderTx {
  filerName?: string;
  transactionText?: string;
  shares?: number;
  value?: number;
  startDate?: string | Date;
}
interface RawSummary {
  financialData?: RawFinancialData;
  summaryDetail?: { trailingPE?: number; forwardPE?: number; dividendYield?: number };
  defaultKeyStatistics?: { forwardPE?: number; pegRatio?: number; priceToBook?: number };
  recommendationTrend?: { trend?: RawTrendPoint[] };
  earningsTrend?: { trend?: RawEarningsTrendPoint[] };
  earningsHistory?: { history?: { surprisePercent?: number | null }[] };
  insiderTransactions?: { transactions?: RawInsiderTx[] };
}

const n = (v: number | undefined | null): number | null =>
  v == null || Number.isNaN(v) ? null : v;

export function mapSnapshot(symbol: string, raw: RawSummary): FundamentalsSnapshot {
  const fd = raw.financialData ?? {};
  const sd = raw.summaryDetail ?? {};
  const ks = raw.defaultKeyStatistics ?? {};
  return {
    symbol,
    price: n(fd.currentPrice),
    trailingPE: n(sd.trailingPE),
    forwardPE: n(sd.forwardPE ?? ks.forwardPE),
    pegRatio: n(ks.pegRatio),
    priceToBook: n(ks.priceToBook),
    dividendYield: n(sd.dividendYield),
    returnOnEquity: n(fd.returnOnEquity),
    returnOnAssets: n(fd.returnOnAssets),
    grossMargins: n(fd.grossMargins),
    operatingMargins: n(fd.operatingMargins),
    profitMargins: n(fd.profitMargins),
    ebitdaMargins: n(fd.ebitdaMargins),
    revenueGrowth: n(fd.revenueGrowth),
    earningsGrowth: n(fd.earningsGrowth),
    // Yahoo reports debt/equity as a percentage (e.g. 79.5 = 0.795x).
    debtToEquity: fd.debtToEquity != null ? fd.debtToEquity / 100 : null,
    currentRatio: n(fd.currentRatio),
    quickRatio: n(fd.quickRatio),
    freeCashflow: n(fd.freeCashflow),
    totalCash: n(fd.totalCash),
    totalDebt: n(fd.totalDebt),
    ebitda: n(fd.ebitda),
  };
}

export function mapAnalyst(raw: RawSummary): AnalystConsensus {
  const fd = raw.financialData ?? {};
  const trend = raw.recommendationTrend?.trend?.[0];
  const current = raw.earningsTrend?.trend?.find((t) => t.period === "0q");
  const price = fd.currentPrice ?? null;
  const target = fd.targetMeanPrice ?? null;

  return {
    targetMean: n(target),
    targetHigh: n(fd.targetHighPrice),
    targetLow: n(fd.targetLowPrice),
    upsidePercent:
      price && target ? ((target - price) / price) * 100 : null,
    recommendationKey: fd.recommendationKey ?? null,
    numberOfOpinions: n(fd.numberOfAnalystOpinions),
    strongBuy: trend?.strongBuy ?? 0,
    buy: trend?.buy ?? 0,
    hold: trend?.hold ?? 0,
    sell: trend?.sell ?? 0,
    strongSell: trend?.strongSell ?? 0,
    epsRevisionsUp30d: n(current?.epsRevisions?.upLast30days),
    epsRevisionsDown30d: n(current?.epsRevisions?.downLast30days),
    epsSurprises: (raw.earningsHistory?.history ?? [])
      .map((h) => h.surprisePercent)
      .filter((s): s is number => s != null),
  };
}

function classifyTx(text: string): InsiderTxType {
  const t = text.toLowerCase();
  if (t.includes("sale") || t.includes("sell") || t.includes("sold")) return "sell";
  if (t.includes("purchase") || t.includes("buy") || t.includes("bought")) {
    return "buy";
  }
  return "other"; // grants, awards, conversions
}

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
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  let netValue = 0;
  let buyCount = 0;
  let sellCount = 0;
  for (const t of txs) {
    if (t.type === "buy") {
      buyCount++;
      netValue += t.value ?? 0;
    } else if (t.type === "sell") {
      sellCount++;
      netValue -= t.value ?? 0;
    }
  }

  return { transactions: txs.slice(0, 10), netValue, buyCount, sellCount };
}

export interface FundamentalsParts {
  snapshot: FundamentalsSnapshot;
  analyst: AnalystConsensus;
  insider: InsiderActivity;
}

export async function getFundamentals(symbol: string): Promise<FundamentalsParts> {
  const raw = (await getQuoteSummary(symbol, MODULES)) as RawSummary;
  return {
    snapshot: mapSnapshot(symbol, raw),
    analyst: mapAnalyst(raw),
    insider: mapInsider(raw),
  };
}
