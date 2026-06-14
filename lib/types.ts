/**
 * Core domain types for the asset analyzer.
 *
 * An "asset" is anything the user feeds in — a file, image, or raw blob.
 * Analyzers turn an asset into a structured, displayable result.
 */

export type AssetKind = "image" | "text" | "binary" | "unknown";

export interface Asset {
  name: string;
  /** MIME type as reported by the source, if known. */
  mimeType: string;
  /** Size in bytes. */
  size: number;
  kind: AssetKind;
}

export interface AnalysisInsight {
  label: string;
  value: string;
}

export interface AnalysisResult {
  asset: Asset;
  insights: AnalysisInsight[];
  analyzedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Market / finance domain                                                    */
/* -------------------------------------------------------------------------- */

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  marketCap: number | null;
  peRatio: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  exchange: string | null;
}

export interface HistoryPoint {
  date: string; // ISO date
  close: number;
}

export interface Filing {
  form: string;
  filedAt: string; // ISO date
  description: string;
  accessionNumber: string;
  documentUrl: string;
}

export interface ResearchData {
  quote: Quote;
  history: HistoryPoint[];
  filings: Filing[];
  /** Non-fatal EDGAR failure, surfaced so the page can still render the quote. */
  edgarError: string | null;
}

export interface AiAnalysis {
  model: string;
  analysis: string;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  addedAt: string; // ISO timestamp
}

export interface ScreenerCriteria {
  sector?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minChangePercent?: number | null;
  maxChangePercent?: number | null;
  minMarketCap?: number | null; // in dollars
}

export interface ScreenerRow {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
  marketCap: number | null;
}

export interface Sp500Constituent {
  symbol: string;
  name: string;
  sector: string;
}

/* -------------------------------------------------------------------------- */
/* Fundamentals — financial statements (EDGAR)                                */
/* -------------------------------------------------------------------------- */

export interface AnnualPoint {
  fy: number;
  value: number;
}

export interface FinancialStatements {
  symbol: string;
  fiscalYears: number[];
  revenue: AnnualPoint[];
  grossProfit: AnnualPoint[];
  operatingIncome: AnnualPoint[];
  netIncome: AnnualPoint[];
  freeCashFlow: AnnualPoint[]; // operating cash flow − capex
  grossMargin: AnnualPoint[];
  operatingMargin: AnnualPoint[];
  netMargin: AnnualPoint[];
  revenueCagr: number | null;
  fcfCagr: number | null;
}

/* -------------------------------------------------------------------------- */
/* Fundamentals — Yahoo snapshot, analyst, insider                            */
/* -------------------------------------------------------------------------- */

export interface FundamentalsSnapshot {
  symbol: string;
  price: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  dividendYield: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  grossMargins: number | null;
  operatingMargins: number | null;
  profitMargins: number | null;
  ebitdaMargins: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  debtToEquity: number | null; // normalized to a ratio (e.g. 0.79)
  currentRatio: number | null;
  quickRatio: number | null;
  freeCashflow: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  ebitda: number | null;
}

export interface AnalystConsensus {
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  upsidePercent: number | null;
  recommendationKey: string | null;
  numberOfOpinions: number | null;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  epsRevisionsUp30d: number | null;
  epsRevisionsDown30d: number | null;
  epsSurprises: number[];
}

export type InsiderTxType = "buy" | "sell" | "other";

export interface InsiderTransaction {
  name: string;
  type: InsiderTxType;
  shares: number | null;
  value: number | null;
  date: string;
  text: string;
}

export interface InsiderActivity {
  transactions: InsiderTransaction[];
  netValue: number; // buy value − sell value across returned window
  buyCount: number;
  sellCount: number;
}

/* -------------------------------------------------------------------------- */
/* Scoring + risk                                                             */
/* -------------------------------------------------------------------------- */

export interface ScoreFactor {
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface ScoreBucket {
  name: string;
  points: number;
  max: number;
  factors: ScoreFactor[];
}

export type Recommendation = "BUY" | "HOLD" | "SELL";

export interface ScoreResult {
  total: number; // 0-100
  buckets: ScoreBucket[];
  recommendation: Recommendation;
  confidence: number; // 0-100
  rationale: string;
}

export type RiskLevel = "low" | "medium" | "high";

export interface RiskItem {
  category: string;
  level: RiskLevel;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Peer comparison                                                            */
/* -------------------------------------------------------------------------- */

export interface PeerMetricSet {
  pe: number | null;
  roe: number | null;
  revenueGrowth: number | null;
  debtToEquity: number | null;
}

export interface PeerComparison {
  sector: string;
  peerCount: number;
  target: PeerMetricSet;
  median: PeerMetricSet;
}

/** Combined payload served by /api/fundamentals. */
export interface FundamentalsData {
  snapshot: FundamentalsSnapshot;
  statements: FinancialStatements | null;
  statementsError: string | null;
  analyst: AnalystConsensus;
  insider: InsiderActivity;
  score: ScoreResult;
  risks: RiskItem[];
}
