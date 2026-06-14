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

/** A single autocomplete hit for the symbol search typeahead. */
export interface SymbolSuggestion {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null; // "Equity", "ETF", "Cryptocurrency", …
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

export type ScreenerSortField =
  | "marketCap"
  | "changePercent"
  | "price"
  | "volume"
  | "peRatio";

export interface ScreenerCriteria {
  sector?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minChangePercent?: number | null;
  maxChangePercent?: number | null;
  minMarketCap?: number | null; // in dollars
  maxMarketCap?: number | null; // in dollars
  minPE?: number | null;
  maxPE?: number | null;
  minVolume?: number | null;
  sortField?: ScreenerSortField | null;
  sortDir?: "asc" | "desc" | null;
}

export interface ScreenerRow {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
  marketCap: number | null;
  peRatio: number | null;
  volume: number | null;
}

export interface Sp500Constituent {
  symbol: string;
  name: string;
  sector: string;
}

/* -------------------------------------------------------------------------- */
/* Fundamental screener — rich per-company metrics + composite scores         */
/* -------------------------------------------------------------------------- */

/** The five proprietary composite scores, each 0-100 (null when too sparse). */
export interface CompositeScores {
  value: number | null;
  growth: number | null;
  quality: number | null;
  financialHealth: number | null;
  momentum: number | null;
  overall: number | null;
}

/**
 * A single investable company with every screener metric.
 * Percentages are stored in percent units (e.g. 16.6 means 16.6%); ratios are
 * stored as ratios (e.g. D/E 0.8, EV/EBITDA 14.2). `null` means unavailable.
 */
export interface StockMetrics {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;

  // Company / price (the live layer, refreshed per screen)
  price: number | null;
  marketCap: number | null;

  // Valuation
  forwardPE: number | null;
  evToEbitda: number | null;
  fcfYield: number | null; // %

  // Growth
  revenueGrowthYoY: number | null; // %
  revenueCagr3y: number | null; // %
  epsGrowthYoY: number | null; // %
  epsCagr3y: number | null; // %

  // Quality
  roic: number | null; // % (estimate)
  roe: number | null; // %
  grossMargin: number | null; // %
  operatingMargin: number | null; // %

  // Financial strength
  debtToEquity: number | null; // ratio
  netDebtToEbitda: number | null; // ratio
  currentRatio: number | null;

  // Cash flow
  fcfMargin: number | null; // %
  fcfGrowthYoY: number | null; // %

  // Shareholder returns
  dividendYield: number | null; // %
  buybackYield: number | null; // % (net; negative = dilution)

  // Momentum
  oneYearReturn: number | null; // %
  distanceFrom52WkHigh: number | null; // % (negative = below the high)

  // Market factors
  institutionalOwnership: number | null; // %
  earningsSurprisePct: number | null; // %

  scores: CompositeScores;
}

/**
 * The fundamentals-only slice that gets cached. Excludes everything derived
 * from the live price layer (price, market cap, FCF yield, momentum) and the
 * scores, which are recomputed after the price merge.
 */
export type StockFundamentals = Omit<
  StockMetrics,
  | "price"
  | "marketCap"
  | "fcfYield"
  | "oneYearReturn"
  | "distanceFrom52WkHigh"
  | "scores"
> & { ebitda: number | null; freeCashflow: number | null };

/** A live price snapshot merged onto the cached fundamentals at screen time. */
export interface PriceSnapshot {
  symbol: string;
  price: number | null;
  marketCap: number | null;
  oneYearReturn: number | null;
  distanceFrom52WkHigh: number | null;
}

/** Inclusive numeric range filter; either bound may be null/absent. */
export interface Range {
  min?: number | null;
  max?: number | null;
}

/** Every filterable dimension. All ranges are optional. */
export interface FundamentalScreenerCriteria {
  sector?: string | null;
  industry?: string | null;
  marketCap?: Range; // in dollars
  forwardPE?: Range;
  evToEbitda?: Range;
  fcfYield?: Range;
  revenueGrowthYoY?: Range;
  revenueCagr3y?: Range;
  epsGrowthYoY?: Range;
  epsCagr3y?: Range;
  roic?: Range;
  roe?: Range;
  grossMargin?: Range;
  operatingMargin?: Range;
  debtToEquity?: Range;
  netDebtToEbitda?: Range;
  currentRatio?: Range;
  fcfMargin?: Range;
  fcfGrowthYoY?: Range;
  dividendYield?: Range;
  buybackYield?: Range;
  oneYearReturn?: Range;
  distanceFrom52WkHigh?: Range;
  institutionalOwnership?: Range;
  earningsSurprisePct?: Range;
  // Composite-score floors
  valueScore?: Range;
  growthScore?: Range;
  qualityScore?: Range;
  financialHealthScore?: Range;
  overallScore?: Range;
  sortField?: string | null;
  sortDir?: "asc" | "desc" | null;
}

export type DatasetStage = "empty" | "building" | "ready" | "error";

export interface DatasetStatus {
  stage: DatasetStage;
  total: number; // universe size
  ready: number; // enriched so far
  builtAt: string | null; // ISO
  error?: string | null;
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

export type Recommendation =
  | "STRONG_BUY"
  | "BUY"
  | "HOLD"
  | "SELL"
  | "STRONG_SELL";

/** Price/technical momentum signal derived from the daily price history. */
export interface MomentumSignal {
  score: number; // 0-100
  pctFrom52WkHigh: number | null; // negative = below the high
  pctFrom52WkLow: number | null; // positive = above the low
  vsSma50: number | null; // % above/below the 50-day SMA
  vsSma200: number | null; // % above/below the 200-day SMA
  return3m: number | null; // % over ~63 trading days
  trend: "up" | "down" | "flat";
}

/** The three independent decision signals that drive the recommendation. */
export interface DecisionSignals {
  fundamentals: number; // 0-100 (== total)
  analysts: number | null; // 0-100
  momentum: number | null; // 0-100
}

export interface ScoreResult {
  total: number; // fundamental score, 0-100
  composite: number; // blended decision score, 0-100
  buckets: ScoreBucket[];
  recommendation: Recommendation;
  confidence: number; // 0-100
  rationale: string;
  signals: DecisionSignals;
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
  momentum: MomentumSignal | null;
}
