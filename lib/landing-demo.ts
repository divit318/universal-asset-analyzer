/**
 * Landing-page demo analysis: the deterministic path behind the Try It
 * section. One symbol in, one normalized `DemoAnalysis` out, computed by the
 * SAME shipped engines the app uses (lib/scoring.ts via buildFundamentalsData,
 * lib/fund-scoring.ts, lib/crypto-scoring.ts, lib/commodity-scoring.ts,
 * lib/forex-scoring.ts). No AI anywhere on this path: every figure is
 * computed, none generated. That is the demo's entire argument, so this
 * module must never fabricate, estimate, or hand-write a number.
 *
 * The payload is pre-formatted server-side (labels, units, sources) so the
 * landing component stays dumb and the formatting stays consistent with
 * lib/format.ts everywhere else in the app.
 */

import { getQuote, getHistory, getFundProfile } from "./yahoo";
import { buildFundamentalsData } from "./fundamentals-data";
import { computeFundScore } from "./fund-scoring";
import { computeCryptoScore } from "./crypto-scoring";
import { computeCommodityScore } from "./commodity-scoring";
import { computeForexScore, DOLLAR_INDEX_SYMBOL } from "./forex-scoring";
import { COMMODITY_BENCHMARK_SYMBOL } from "./research-engines/commodity";
import { detectAssetClass, ASSET_CLASS_LABEL, type AssetClass } from "./asset-class";
import { detectMarket, normalizeSymbol } from "./market";
import { RECOMMENDATION_LABEL } from "./recommendation";
import {
  formatCompactCurrency,
  formatPerShare,
  formatPercent,
  formatRatio,
  formatNumber,
} from "./format";
import type { Quote, Recommendation, ScoreResult } from "./types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type DemoAssetClass = "equity" | "fund" | "crypto" | "commodity" | "forex";

export interface DemoMetric {
  label: string;
  value: string;
  /** Where the figure came from. Every number carries its provenance. */
  source: string;
}

export interface DemoFactor {
  label: string;
  detail: string;
  points: number;
  max: number;
}

export interface DemoBucket {
  name: string;
  points: number;
  max: number;
  factors: DemoFactor[];
}

export interface DemoSignal {
  label: string;
  value: number; // 0-100
}

export interface DemoAnalysis {
  symbol: string;
  name: string;
  assetClass: DemoAssetClass;
  /** e.g. "Equity · NSE", "ETF · NYSE Arca", "Commodity · COMEX". */
  assetClassLabel: string;
  currency: string;
  price: number | null;
  priceDisplay: string;
  /** ISO timestamp of the last trade this price describes. */
  priceAsOf: string | null;
  composite: number; // 0-100
  recommendation: Recommendation;
  recommendationLabel: string;
  confidence: number | null; // 0-100, equity engine only
  /** Blended decision signals (equity engine only). */
  signals: DemoSignal[];
  buckets: DemoBucket[];
  metrics: DemoMetric[];
  sources: string[];
  /** ISO timestamp of when the engines computed this result. */
  computedAt: string;
}

export interface DemoStageEvent {
  id: "quote" | "data" | "score";
  label: string;
  ms: number;
}

export type DemoErrorCode =
  | "invalid_symbol"
  | "unknown_symbol"
  | "unsupported"
  | "no_data"
  | "source_down";

export class DemoError extends Error {
  code: DemoErrorCode;
  status: number;
  constructor(code: DemoErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* -------------------------------------------------------------------------- */
/* Formatting helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Unsigned percent from a FRACTION (0.749 -> "74.9%"): margins, ratios-of. */
function pctFromFraction(value: number | null | undefined, digits = 1): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${(value * 100).toFixed(digits)}%`;
}

const EXCHANGE_NAMES: Record<string, string> = {
  NSI: "NSE",
  BSE: "BSE",
  NMS: "NASDAQ",
  NGM: "NASDAQ",
  NAS: "NASDAQ",
  NASDAQ: "NASDAQ",
  NASDAQGS: "NASDAQ",
  NASDAQGM: "NASDAQ",
  NASDAQCM: "NASDAQ",
  NYQ: "NYSE",
  NYSE: "NYSE",
  PCX: "NYSE Arca",
  NYSEARCA: "NYSE Arca",
  ASE: "NYSE American",
  BTS: "BATS",
  CMX: "COMEX",
  COMEX: "COMEX",
  NYM: "NYMEX",
  CBT: "CBOT",
  CCY: "ICE",
};

function exchangeName(quote: Quote): string | null {
  const sym = quote.symbol.toUpperCase();
  if (sym.endsWith(".NS")) return "NSE";
  if (sym.endsWith(".BO")) return "BSE";
  const code = quote.exchange?.toUpperCase() ?? "";
  return EXCHANGE_NAMES[code] ?? quote.exchange ?? null;
}

function classLabel(assetClass: AssetClass, quote: Quote): string {
  if (assetClass === "crypto") return "Crypto";
  const base =
    quote.assetType === "ETF"
      ? "ETF"
      : quote.assetType === "MUTUALFUND"
        ? "Mutual fund"
        : ASSET_CLASS_LABEL[assetClass];
  const exch = exchangeName(quote);
  return exch ? `${base} · ${exch}` : base;
}

function toDemoBuckets(score: ScoreResult): DemoBucket[] {
  return score.buckets.map((b) => ({
    name: b.name,
    points: b.points,
    max: b.max,
    factors: b.factors.map((f) => ({ label: f.label, detail: f.detail, points: f.points, max: f.max })),
  }));
}

/* -------------------------------------------------------------------------- */
/* Per-class analysis                                                          */
/* -------------------------------------------------------------------------- */

const YAHOO = "Yahoo Finance";

async function analyzeEquity(symbol: string, quote: Quote): Promise<Omit<DemoAnalysis, "computedAt">> {
  const data = await buildFundamentalsData(symbol);
  const { snapshot, analyst, momentum, score } = data;
  const market = detectMarket(quote);
  const currency = quote.currency;

  const candidates: (DemoMetric | null)[] = [
    quote.marketCap != null
      ? { label: "Market cap", value: formatCompactCurrency(quote.marketCap, quote.currency), source: `${YAHOO} quote` }
      : null,
    snapshot.trailingPE != null
      ? { label: "P/E (TTM)", value: formatRatio(snapshot.trailingPE, 1), source: `${YAHOO} fundamentals` }
      : null,
    snapshot.forwardPE != null
      ? { label: "Forward P/E", value: formatRatio(snapshot.forwardPE, 1), source: `${YAHOO} fundamentals` }
      : null,
    snapshot.revenueGrowth != null
      ? { label: "Revenue growth YoY", value: formatPercent(snapshot.revenueGrowth * 100, 1), source: `${YAHOO} fundamentals` }
      : null,
    snapshot.returnOnEquity != null
      ? { label: "Return on equity", value: pctFromFraction(snapshot.returnOnEquity)!, source: `${YAHOO} fundamentals` }
      : null,
    snapshot.operatingMargins != null
      ? { label: "Operating margin", value: pctFromFraction(snapshot.operatingMargins)!, source: `${YAHOO} fundamentals` }
      : null,
    snapshot.debtToEquity != null
      ? { label: "Debt / equity", value: formatRatio(snapshot.debtToEquity, 2), source: `${YAHOO} fundamentals` }
      : null,
    analyst.targetMean != null && analyst.numberOfOpinions
      ? {
          label: "Analyst target",
          value: `${formatPerShare(analyst.targetMean, currency)} (${formatPercent(analyst.upsidePercent, 1)})`,
          source: `${YAHOO} consensus · ${analyst.numberOfOpinions} analysts`,
        }
      : null,
    momentum?.return3m != null
      ? { label: "3-month return", value: formatPercent(momentum.return3m, 1), source: "Computed from daily closes" }
      : null,
    momentum?.vsSma200 != null
      ? { label: "vs 200-day average", value: formatPercent(momentum.vsSma200, 1), source: "Computed from daily closes" }
      : null,
  ];

  const signals: DemoSignal[] = [
    { label: "Fundamentals", value: score.signals.fundamentals },
    ...(score.signals.analysts != null ? [{ label: "Analysts", value: score.signals.analysts }] : []),
    ...(score.signals.momentum != null ? [{ label: "Momentum", value: score.signals.momentum }] : []),
    ...(score.signals.capitalAllocation != null
      ? [{ label: "Capital allocation", value: score.signals.capitalAllocation }]
      : []),
    ...(score.signals.sectorRotation != null
      ? [{ label: "Sector rotation", value: score.signals.sectorRotation }]
      : []),
  ];

  return {
    symbol,
    name: quote.name,
    assetClass: "equity",
    assetClassLabel: classLabel("equity", quote),
    currency: quote.currency,
    price: quote.price,
    priceDisplay: formatPerShare(quote.price, quote.currency),
    priceAsOf: quote.regularMarketTime ?? null,
    composite: score.composite,
    recommendation: score.recommendation,
    recommendationLabel: RECOMMENDATION_LABEL[score.recommendation],
    confidence: score.confidence,
    signals,
    buckets: toDemoBuckets(score),
    metrics: candidates.filter((m): m is DemoMetric => m !== null).slice(0, 8),
    sources: [
      `${YAHOO}: quote, fundamentals, analyst consensus`,
      market === "US"
        ? "Financial statements: Yahoo Finance, SEC EDGAR fallback"
        : "Financial statements: Yahoo Finance",
      "Momentum: computed from 5 years of daily closes",
      `Scoring: lib/scoring.ts decision engine${market === "IN" ? " (India weight profile)" : ""}`,
    ],
  };
}

async function analyzeFund(symbol: string, quote: Quote): Promise<Omit<DemoAnalysis, "computedAt">> {
  const [fund, history] = await Promise.all([getFundProfile(symbol), getHistory(symbol, 730)]);

  const degraded =
    fund.expenseRatio == null && fund.trailingReturns.oneYear == null && fund.holdings.length === 0;
  if (degraded) {
    throw new DemoError(
      "no_data",
      422,
      `Yahoo Finance doesn't publish a fund profile for ${symbol} (common for India-listed ETFs and mutual funds), so the fund engine has nothing honest to score. Try the US-listed equivalent, or an NSE equity like RELIANCE.NS.`,
    );
  }

  const score = computeFundScore(fund, history);
  const top10 = fund.holdings.slice(0, 10).reduce((s, h) => s + h.weightPercent, 0);

  const candidates: (DemoMetric | null)[] = [
    fund.expenseRatio != null
      ? {
          label: "Expense ratio",
          value: pctFromFraction(fund.expenseRatio, 2)!,
          source: fund.expenseRatioSource === "amfi" ? "AMFI TER table" : `${YAHOO} fund profile`,
        }
      : null,
    fund.totalNetAssets != null
      ? { label: "Net assets", value: formatCompactCurrency(fund.totalNetAssets, fund.currency ?? quote.currency), source: `${YAHOO} fund profile` }
      : null,
    fund.trailingReturns.oneYear != null
      ? { label: "1-year return", value: formatPercent(fund.trailingReturns.oneYear, 1), source: `${YAHOO} fund profile` }
      : null,
    fund.trailingReturns.threeYear != null
      ? { label: "3-year return (ann.)", value: formatPercent(fund.trailingReturns.threeYear, 1), source: `${YAHOO} fund profile` }
      : null,
    fund.risk?.sharpeRatio != null
      ? { label: "Sharpe ratio (3y)", value: formatNumber(fund.risk.sharpeRatio, 2), source: `Morningstar risk via ${YAHOO}` }
      : null,
    fund.risk?.beta != null
      ? { label: "Beta (3y)", value: formatNumber(fund.risk.beta, 2), source: `Morningstar risk via ${YAHOO}` }
      : null,
    fund.holdings.length > 0
      ? { label: "Top-10 concentration", value: `${top10.toFixed(1)}%`, source: "Computed from reported holdings" }
      : null,
    fund.turnoverPercent != null
      ? { label: "Portfolio turnover", value: pctFromFraction(fund.turnoverPercent)!, source: `${YAHOO} fund profile` }
      : null,
  ];

  return {
    symbol,
    name: quote.name,
    assetClass: "fund",
    assetClassLabel: classLabel("fund", quote),
    currency: quote.currency,
    price: quote.price,
    priceDisplay: formatPerShare(quote.price, quote.currency),
    priceAsOf: quote.regularMarketTime ?? null,
    composite: score.composite,
    recommendation: score.recommendation,
    recommendationLabel: RECOMMENDATION_LABEL[score.recommendation],
    confidence: null,
    signals: [],
    buckets: toDemoBuckets(score),
    metrics: candidates.filter((m): m is DemoMetric => m !== null).slice(0, 8),
    sources: [
      `${YAHOO}: fund profile, holdings, trailing returns`,
      ...(fund.expenseRatioSource === "amfi" ? ["AMFI: official monthly TER table"] : []),
      "Score: lib/fund-scoring.ts (cost, diversification, performance, risk-adjusted)",
    ],
  };
}

async function analyzeMarketOnly(
  symbol: string,
  quote: Quote,
  assetClass: "crypto" | "commodity" | "forex",
): Promise<Omit<DemoAnalysis, "computedAt">> {
  const benchmarkSymbol =
    assetClass === "crypto"
      ? "BTC-USD"
      : assetClass === "commodity"
        ? COMMODITY_BENCHMARK_SYMBOL
        : DOLLAR_INDEX_SYMBOL;
  const isBenchmark = symbol.toUpperCase().startsWith(benchmarkSymbol.toUpperCase());

  const [history, benchmarkHistory] = await Promise.all([
    getHistory(symbol, 730),
    isBenchmark ? Promise.resolve([]) : getHistory(benchmarkSymbol, 730),
  ]);
  if (history.length === 0) {
    throw new DemoError(
      "no_data",
      422,
      `Yahoo Finance returned no price history for ${symbol}, and the ${ASSET_CLASS_LABEL[assetClass].toLowerCase()} engine scores from history alone.`,
    );
  }

  const benchmark = benchmarkHistory.length > 0 ? benchmarkHistory : null;
  const score =
    assetClass === "crypto"
      ? computeCryptoScore(symbol, history, benchmark)
      : assetClass === "commodity"
        ? computeCommodityScore(history, benchmark)
        : computeForexScore(symbol, history, benchmark);

  const candidates: (DemoMetric | null)[] = [
    {
      label: "Day change",
      value: formatPercent(quote.changePercent, 2),
      source: `${YAHOO} quote`,
    },
    quote.fiftyTwoWeekHigh != null
      ? { label: "52-week high", value: formatPerShare(quote.fiftyTwoWeekHigh, quote.currency), source: `${YAHOO} quote` }
      : null,
    quote.fiftyTwoWeekLow != null
      ? { label: "52-week low", value: formatPerShare(quote.fiftyTwoWeekLow, quote.currency), source: `${YAHOO} quote` }
      : null,
    quote.volume != null
      ? { label: "Volume", value: quote.volume.toLocaleString("en-US"), source: `${YAHOO} quote` }
      : null,
  ];

  const benchmarkNote = isBenchmark
    ? []
    : [`Benchmark: ${benchmarkSymbol} relative strength over the same window`];

  return {
    symbol,
    name: quote.name,
    assetClass,
    assetClassLabel: classLabel(assetClass, quote),
    currency: quote.currency,
    price: quote.price,
    priceDisplay: formatPerShare(quote.price, quote.currency),
    priceAsOf: quote.regularMarketTime ?? null,
    composite: score.composite,
    recommendation: score.recommendation,
    recommendationLabel: RECOMMENDATION_LABEL[score.recommendation],
    confidence: null,
    signals: [],
    buckets: toDemoBuckets(score),
    metrics: candidates.filter((m): m is DemoMetric => m !== null),
    sources: [
      `${YAHOO}: quote and 2 years of daily closes`,
      ...benchmarkNote,
      `Sharpe, Sortino, drawdown, volatility: computed from daily returns (lib/${assetClass}-scoring.ts)`,
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

function dataStageLabel(assetClass: DemoAssetClass, symbol: string): string {
  if (assetClass === "equity") return "Fundamentals, statements, 5y prices";
  if (assetClass === "fund") return "Fund profile, holdings, 2y prices";
  const benchmark =
    assetClass === "crypto" ? "BTC" : assetClass === "commodity" ? "DBC" : "DXY";
  const isBenchmark =
    (assetClass === "crypto" && symbol.startsWith("BTC-USD")) ||
    (assetClass === "commodity" && symbol === COMMODITY_BENCHMARK_SYMBOL) ||
    (assetClass === "forex" && symbol === DOLLAR_INDEX_SYMBOL.toUpperCase());
  return isBenchmark ? "2y daily closes" : `2y daily closes + ${benchmark} benchmark`;
}

/**
 * Run the deterministic engines on one symbol for the landing demo.
 * `onStage` fires as each real unit of work completes, with its measured
 * duration, so the loading UI shows genuine progress, not a theatrical timer.
 */
export async function analyzeForDemo(
  rawSymbol: string,
  onStage?: (stage: DemoStageEvent) => void,
): Promise<DemoAnalysis> {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) {
    throw new DemoError(
      "invalid_symbol",
      400,
      "That doesn't look like a ticker. Try RELIANCE.NS, SPY, or BTC-USD.",
    );
  }

  const t0 = Date.now();
  let quote: Quote;
  try {
    quote = await getQuote(symbol);
  } catch {
    throw new DemoError(
      "unknown_symbol",
      404,
      `No listing found for ${symbol}. NSE listings need the .NS suffix (RELIANCE.NS), BSE listings .BO, crypto pairs -USD (BTC-USD).`,
    );
  }
  onStage?.({ id: "quote", label: "Quote & asset class", ms: Date.now() - t0 });

  // Indices fall through detectAssetClass's equity default (Yahoo types
  // ^GSPC and friends as INDEX), but an index run through the single-name
  // equity engine yields an all-neutral non-answer. Refuse honestly instead.
  if (symbol.startsWith("^") || quote.assetType === "INDEX") {
    throw new DemoError(
      "unsupported",
      422,
      `${symbol} is an index. Indices have no fundamentals to score. The engines analyze the instruments you can actually hold: equities, ETFs, mutual funds, crypto, commodities, and currency pairs.`,
    );
  }

  const detected = detectAssetClass(quote);
  const assetClass: DemoAssetClass | null =
    detected === "equity" || detected === "fund" || detected === "crypto" || detected === "commodity" || detected === "forex"
      ? detected
      : null;
  if (!assetClass) {
    throw new DemoError(
      "unsupported",
      422,
      `${symbol} is ${/^[aeiou]/i.test(ASSET_CLASS_LABEL[detected]) ? "an" : "a"} ${ASSET_CLASS_LABEL[detected].toLowerCase()} symbol. The demo engines score equities, ETFs, mutual funds, crypto, commodities, and currency pairs, not this asset type yet.`,
    );
  }

  const t1 = Date.now();
  let analysis: Omit<DemoAnalysis, "computedAt">;
  try {
    analysis =
      assetClass === "equity"
        ? await analyzeEquity(symbol, quote)
        : assetClass === "fund"
          ? await analyzeFund(symbol, quote)
          : await analyzeMarketOnly(symbol, quote, assetClass);
  } catch (err) {
    if (err instanceof DemoError) throw err;
    throw new DemoError(
      "source_down",
      502,
      "The market data source didn't answer. That's the feed, not the engines. Try again in a few seconds.",
    );
  }
  onStage?.({ id: "data", label: dataStageLabel(assetClass, symbol), ms: Date.now() - t1 });
  onStage?.({ id: "score", label: "Deterministic score", ms: 0 });

  return { ...analysis, computedAt: new Date().toISOString() };
}
