/**
 * Core domain types for the asset analyzer.
 *
 * An "asset" is anything the user feeds in — a file, image, or raw blob.
 * Analyzers turn an asset into a structured, displayable result.
 */

import type { OpportunityProfile } from "./opportunity-engine";

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
  /** Yahoo Finance quoteType: "EQUITY", "ETF", "CRYPTOCURRENCY", "MUTUALFUND", etc. */
  assetType?: string | null;
}

export interface HistoryPoint {
  date: string; // ISO date
  open?: number;       // opening price
  high?: number;       // intraday high
  low?: number;        // intraday low
  close: number;       // raw (unadjusted) closing price
  adjClose?: number;   // dividend + split-adjusted close (for total return)
  volume?: number;
}

/** A single autocomplete hit for the symbol search typeahead. */
export interface SymbolSuggestion {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null; // "Equity", "ETF", "Cryptocurrency", …
  /** Listing country (code + flag), or null for instruments not tied to one country (crypto, FX, indices). */
  country: { code: string; flag: string } | null;
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
  benchmarks?: {
    spy: HistoryPoint[];
    sectorEtf: string | null;
    sector: HistoryPoint[];
  };
  /** Recent company news for the "What Changed" / Latest Intelligence section. */
  news?: NewsItem[];
  /** When the quote/filings store entries last resolved — feeds the masthead's
   * and the SEC Filings section's <DataProvenance> freshness badges. */
  quoteUpdatedAt: number | null;
  filingsUpdatedAt: number | null;
}

export interface AiAnalysis {
  model: string;
  analysis: string;
}

/**
 * The Idea lifecycle stage (§4.5). A single `stage` on every tracked symbol
 * turns Watchlist + Portfolio + Journal into three views of one pipeline.
 * Descriptive, never a gate — a stage records where an idea is, it never blocks
 * or warns against any action.
 */
export type IdeaStage = "surfaced" | "researching" | "thesis" | "owned" | "passed" | "exited";

export interface WatchlistItem {
  symbol: string;
  name: string;
  addedAt: string; // ISO timestamp
  targetPrice: number | null;
  alertPctDrop: number | null;
  notes: string | null;
  /** Idea lifecycle stage. Defaults to "surfaced" for every row (§4.5). */
  stage: IdeaStage;
  /** Epoch-ms when the stage last changed; null for rows predating the migration. */
  stageChangedAt: number | null;
  /** Joined from fundamentals_cache by /api/watchlist (null if never screened). */
  sector?: string | null;
  dividendYield?: number | null;
}

export interface ResearchNote {
  id: number;
  symbol: string;
  content: string;
  createdAt: string; // ISO timestamp
}

/** A persisted chart drawing row. `data` is a JSON-serialized DrawingObject payload (points/style/locked/hidden/metadata) — see app/research/_components/chart-workspace/types.ts. */
export interface ChartDrawingRecord {
  id: number;
  symbol: string;
  timeframe: string;
  type: string;
  data: string;
  createdAt: number; // Unix ms
  updatedAt: number; // Unix ms
}

export interface PortfolioPosition {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number; // per share, in USD
  addedAt: string; // ISO timestamp
}

/**
 * One transaction in a position's ledger. A position's aggregate shares/avgCost
 * are DERIVED from its lots (average-cost method) — see lib/portfolio-lots.ts.
 * This is the foundation for real performance analytics (realized P&L, XIRR,
 * benchmark-relative return) in Phase 1.
 */
export interface PortfolioLot {
  id: number;
  symbol: string;
  name: string;
  shares: number; // positive quantity transacted
  price: number; // per-share transaction price
  kind: "buy" | "sell";
  fees: number; // transaction costs (capitalized into basis on buy; net against realized on sell)
  tradeDate: string; // ISO date the trade occurred (drives time-weighted return later)
  createdAt: string; // ISO timestamp the row was recorded
}

/** A logged investment decision — the unit of the decision journal / track
 *  record (see lib/decision-journal.ts). Captures the thesis, conviction, and
 *  the IOS portfolio-fit at decision time so outcomes can be measured against
 *  them later. */
export type DecisionAction = "buy" | "sell" | "hold" | "avoid" | "watch";
export type DecisionHorizon = "short" | "medium" | "long";

export interface Decision {
  id: number;
  symbol: string;
  name: string | null;
  action: DecisionAction;
  conviction: number; // 1 (low) .. 5 (high)
  thesis: string | null;
  priceAt: number | null; // price when the decision was logged
  currency: string | null;
  targetPrice: number | null;
  horizon: DecisionHorizon | null;
  /** IOS portfolio-fit score/tier at decision time (nullable — the loop with the fit spine). */
  fitScore: number | null;
  fitTier: string | null;
  status: "open" | "closed";
  closePrice: number | null;
  closedAt: string | null;
  createdAt: string;
}

/** A delivered alert in the notification center (see lib/alerts.ts + lib/db.ts). */
export interface Notification {
  id: number;
  dedupKey: string;
  symbol: string | null;
  kind: string;
  severity: "info" | "warning";
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
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
  /**
   * Raw net debt in dollars (totalDebt - totalCash). Kept alongside the ratio
   * because netDebtToEbitda is null whenever EBITDA is (e.g. mortgage REITs,
   * whose spread-income model has no EBITDA line at all) — the dollar figure
   * has no such dependency and is the honest "Net Debt" column REIT/equity
   * leverage screens actually want when the ratio can't be formed.
   */
  netDebt: number | null; // $
  currentRatio: number | null;

  // Cash flow
  fcfMargin: number | null; // %
  fcfGrowthYoY: number | null; // %
  /**
   * Trailing operating cash flow. Carried for REIT screening, where it stands
   * in for FFO — a REIT's earnings are swamped by depreciation, so P/E is
   * meaningless and P/FFO is the real yardstick. See lib/assets/reit.ts.
   *
   * Optional because rows cached before this field existed deserialize without
   * it, and because the composite scorer (lib/composite.ts) neither reads nor
   * needs it — requiring it would force every caller that builds a metrics
   * object to supply cash-flow data the scorer ignores.
   */
  operatingCashflow?: number | null; // $
  ocfGrowthYoY?: number | null; // % (the FFO-growth proxy)

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
> & { ebitda: number | null; freeCashflow: number | null; exchange: string | null; beta: number | null };

/* -------------------------------------------------------------------------- */
/* Fund fundamentals (ETF / mutual fund / closed-end fund)                     */
/* -------------------------------------------------------------------------- */

export interface FundHolding {
  symbol: string;
  name: string;
  weightPercent: number; // 0-100
}

export interface FundSectorWeight {
  sector: string;
  weightPercent: number; // 0-100
}

/** Fund-shaped fundamentals — deliberately not a StockFundamentals variant: a
 * fund has no P/E-driven valuation, no financial statements, no EPS. This is
 * the fund research engine's own parallel type, mirroring how India's
 * ScreenerInCompany is its own type rather than a StockFundamentals subset. */
export interface FundProfileData {
  family: string | null;
  category: string | null;
  legalType: string | null;
  expenseRatio: number | null; // fraction, e.g. 0.0009 = 0.09%
  turnoverPercent: number | null; // fraction
  totalNetAssets: number | null; // raw dollars (Yahoo reports in millions; converted at the mapping layer)
  holdings: FundHolding[];
  sectorWeights: FundSectorWeight[];
  assetAllocation: { stock: number | null; bond: number | null; cash: number | null; other: number | null }; // percentage-points, e.g. 60 = 60%
  trailingReturns: { ytd: number | null; oneYear: number | null; threeYear: number | null; fiveYear: number | null }; // percentage-points, e.g. 22.2 = 22.2%
  // Fund return minus its Yahoo category's return, in percentage-points — a
  // relative-performance signal that doesn't require picking a benchmark ticker.
  categoryRelativeReturns: { oneYear: number | null; threeYear: number | null };
  risk: { beta: number | null; alpha: number | null; stdDev: number | null; sharpeRatio: number | null } | null;
}

/* -------------------------------------------------------------------------- */
/* Crypto (market-data only — no on-chain/tokenomics provider yet)            */
/* -------------------------------------------------------------------------- */

/** Deliberately thin: crypto research today is market-data only (price/
 * volatility/drawdown vs BTC). Extend with tokenomics/on-chain fields here
 * once a data provider for those is chosen — see lib/research-engines/crypto/. */
export interface CryptoProfileData {
  symbol: string;
  btcHistory: HistoryPoint[];
}

/* -------------------------------------------------------------------------- */
/* Commodities (market-data only — supply/demand is AI+news, not a scorer)   */
/* -------------------------------------------------------------------------- */

/** Same shape/rationale as CryptoProfileData — DBC (commodity index ETF) is
 * commodities' de facto benchmark, the same role BTC plays for crypto. */
export interface CommodityProfileData {
  benchmarkHistory: HistoryPoint[];
}

/* -------------------------------------------------------------------------- */
/* Forex (market-data only — central bank/macro is AI+news, not a scorer)    */
/* -------------------------------------------------------------------------- */

/** Same shape/rationale as CommodityProfileData — the US Dollar Index (DXY)
 * is forex's de facto benchmark for USD pairs, same role BTC/DBC play for
 * crypto/commodities. */
export interface ForexProfileData {
  symbol: string;
  benchmarkHistory: HistoryPoint[];
}

/* -------------------------------------------------------------------------- */
/* Derivatives (options chain) — additive module on equity/fund underlyings, */
/* not a distinct detected asset class. See lib/derivatives-analysis.ts.     */
/* -------------------------------------------------------------------------- */

export interface OptionContract {
  contractSymbol: string;
  strike: number;
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null; // decimal, e.g. 0.28 = 28%
  inTheMoney: boolean;
}

export interface OptionsExpirationChain {
  expirationDate: string; // ISO date
  calls: OptionContract[];
  puts: OptionContract[];
}

export interface OptionsChainData {
  underlyingSymbol: string;
  underlyingPrice: number;
  expirationDates: string[]; // all available, ISO, ascending
  chains: OptionsExpirationChain[]; // the near-term + (if available) a farther-dated expiration
}

/** A live price snapshot merged onto the cached fundamentals at screen time. */
export interface PriceSnapshot {
  symbol: string;
  price: number | null;
  marketCap: number | null;
  oneYearReturn: number | null;
  distanceFrom52WkHigh: number | null;
}

/** Inclusive numeric range filter; either bound may be null/absent. */
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
  sector?: string | null;
  industry?: string | null;
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
  /** Cash from operations. Backs the REIT P/FFO proxy (marketCap ÷ OCF) — see lib/assets/reit.ts. */
  operatingCashflow: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  ebitda: number | null;
  enterpriseToEbitda: number | null;
  priceToSalesTrailing12Months: number | null;
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
  /** 0-100, from the Capital Allocation bucket. Null when computeScore() wasn't given the inputs to score it meaningfully differently from n/a. */
  capitalAllocation?: number | null;
  /** 0-100, from the Sector Rotation bucket. Null when no sector rotation entry was passed to computeScore(). */
  sectorRotation?: number | null;
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

/* -------------------------------------------------------------------------- */
/* Earnings history                                                           */
/* -------------------------------------------------------------------------- */

export interface EarningsPoint {
  date: string;               // ISO quarter-end date
  quarter: string;            // display label, e.g. "Q1 '24"
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePercent: number | null;
}

export interface EarningsData {
  history: EarningsPoint[];   // up to last 4 quarters, ascending
  nextDate: string | null;    // ISO date of next expected report
  nextDateEnd: string | null; // upper bound of the window
  trailingEps: number | null;
  forwardEps: number | null;
}

/* -------------------------------------------------------------------------- */
/* Institutional ownership & short interest                                   */
/* -------------------------------------------------------------------------- */

export interface InstitutionalHolder {
  name: string;
  pctHeld: number | null;  // 0–1 fraction
  shares: number | null;
  value: number | null;
}

export interface OwnershipData {
  institutionsPctHeld: number | null;  // 0–1 fraction
  insidersPctHeld: number | null;      // 0–1 fraction
  institutionsCount: number | null;
  shortPctOfFloat: number | null;      // 0–1 fraction
  shortRatio: number | null;           // days to cover
  sharesShort: number | null;
  topHolders: InstitutionalHolder[];
}

/* -------------------------------------------------------------------------- */
/* Valuation history                                                          */
/* -------------------------------------------------------------------------- */

export interface ValuationPoint {
  year: number;
  peRatio: number | null;
  psRatio: number | null;
}

/* -------------------------------------------------------------------------- */
/* Investment personality — permanent identity tag, not a transient AI take   */
/* -------------------------------------------------------------------------- */

export type InvestmentPersonalityTag =
  | "Compounder"
  | "Cyclical"
  | "Turnaround"
  | "High Growth"
  | "Income"
  | "Deep Value"
  | "Defensive"
  | "High Quality";

export interface InvestmentPersonality {
  tag: InvestmentPersonalityTag;
  explanation: string;
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
  earnings: EarningsData;
  ownership: OwnershipData;
  valuation: ValuationPoint[];
  personality: InvestmentPersonality;
}

/* -------------------------------------------------------------------------- */
/* News-driven market scanner                                                 */
/* -------------------------------------------------------------------------- */

export interface NewsItem {
  headline: string;
  source: string;
  url: string;
  publishedAt: string; // ISO
  /** Tickers explicitly mentioned or returned by the news source. */
  tickers: string[];
  summary: string | null;
}

export type SignalDirection = "bullish" | "bearish" | "neutral";
export type SignalTimeframe = "short" | "medium" | "long";

export interface EventSignal {
  ticker: string;
  name: string;
  direction: SignalDirection;
  /** 0-100 AI confidence in this signal. */
  confidence: number;
  /** Human-readable macro theme, e.g. "RBI rate pause". */
  theme: string;
  /** 1-2 sentence rationale. */
  rationale: string;
  timeframe: SignalTimeframe;
  /** Live quote at scan time; null if fetch failed. */
  quote: Quote | null;
  /** Fundamental score from scoring engine; null if unavailable. */
  fundamentalScore: number | null;
}

export interface ScanResult {
  scannedAt: string; // ISO
  /** Top macro/sector themes extracted from news. */
  themes: string[];
  /** Ranked actionable signals. */
  signals: EventSignal[];
  /** Source news items used for the scan. */
  newsItems: NewsItem[];
  /** Plain-English summary of the scan. */
  aiSummary: string;
}

/* -------------------------------------------------------------------------- */
/* Scanner v2 — multi-stage intelligence pipeline types                       */
/* -------------------------------------------------------------------------- */

export type SignalCategory =
  | "macro"
  | "company"
  | "market"
  | "commodity"
  | "geopolitics"
  | "policy"
  | "sentiment";

export interface CausalEffect {
  order: 1 | 2;
  description: string;
  direction: SignalDirection;
  affectedSectors: string[];
  affectedTickers: string[];
}

export interface MarketEvent {
  id: string;
  category: SignalCategory;
  headline: string;
  summary: string;
  publishedAt: string; // ISO
  sources: { headline: string; source: string; url: string }[];
  affectedTickers: string[];
  affectedSectors: string[];
  affectedThemes: string[];
  causalChain: CausalEffect[];
}

export interface SectorImpact {
  sector: string;
  /** Broad ETF ticker used for live price context (e.g. XLK, XLF). */
  etfTicker: string | null;
  direction: SignalDirection;
  strength: number; // 0-100
  rationale: string;
  keyBeneficiaries: string[]; // generic company names (not tickers)
  keyLosers: string[];        // generic company names
  drivingEvents: string[];    // MarketEvent ids
}

export interface OpportunityScore {
  catalystStrength: number;   // 0-100
  fundamentalQuality: number; // 0-100
  valuation: number;          // 0-100
  momentum: number;           // 0-100
  composite: number;          // 0-100 weighted blend
  verdict: "exceptional" | "strong" | "moderate" | "weak";
}

export interface InvestmentThesis {
  headline: string;
  summary: string;
  bullCase: string[];
  bearCase: string[];
  keyCatalysts: string[];
  keyRisks: string[];
  timeHorizon: "days" | "weeks" | "months" | "quarters" | "years";
  confidence: number; // 0-100
  potentialWinners: string[]; // generic names
  potentialLosers: string[];  // generic names
}

export interface ScannerOpportunity {
  id: string;
  ticker: string;
  name: string;
  isIndian: boolean;
  direction: SignalDirection;
  theme: string;
  category: SignalCategory;
  rationale: string;
  timeframe: SignalTimeframe;
  quote: Quote | null;
  compositeScores: CompositeScores | null;
  opportunityScore: OpportunityScore;
  thesis: InvestmentThesis | null; // generated only for high-conviction
  sourceEventIds: string[];
  dividendYieldPct: number | null;
  /** Shared Opportunity Engine output — categories, conviction, horizon, narrative. Set by opportunity-scorer.ts. */
  profile: OpportunityProfile | null;
}

export interface EmergingTheme {
  name: string;
  description: string;
  momentum: number;  // 0-100
  drivingEvents: string[];
  topTickers: string[];
  thematicResearchUrl: string; // deep-link to /thematic?theme=...
}

export interface RiskAlert {
  id: string;
  headline: string;
  severity: "high" | "medium" | "low";
  affectedSectors: string[];
  affectedTickers: string[];
  rationale: string;
}

export interface MarketRegime {
  trend: "risk-on" | "risk-off" | "neutral";
  breadthPct: number | null; // % of sectors/stocks advancing
  dominantSectors: string[];
  dominantThemes: string[];
  summary: string;
}

export interface MacroSignal {
  ticker: string;  // e.g. "^TNX", "GC=F", "CL=F"
  name: string;    // e.g. "10Y Treasury Yield", "Gold", "Crude Oil"
  price: number | null;
  changePercent: number | null;
  trend: "rising" | "falling" | "flat";
}

/** Pipeline progress event streamed from /api/scanner/v2 */
export type ScannerStage =
  | "init"
  | "collecting"
  | "deduplicating"
  | "classifying"
  | "theme_detection"
  | "causal_reasoning"
  | "sector_impact"
  | "company_impact"
  | "fundamental_gate"
  | "opportunity_scoring"
  | "thesis_building"
  | "assembling"
  | "done"
  | "error";

export interface ScannerProgressEvent {
  stage: ScannerStage;
  message: string;
  pct: number; // 0-100 progress
}

/**
 * A ScannerResult field that's ready before the full pipeline finishes.
 * Streamed from /api/scanner/v2 as {type:"partial", key, data} alongside the
 * existing progress events, so sections can render as their own data lands
 * instead of waiting for the final {type:"result"} at Assembly. `opportunities`
 * and `highConviction` are each emitted twice — once after Opportunity Scoring
 * (no theses yet) and again after Thesis Building (theses attached) — the
 * second arrival replaces the first via the same `opp.id`, not a duplicate.
 */
export type ScannerPartialKey =
  | "newsItems"
  | "macroSignals"
  | "marketRegime"
  | "emergingThemes"
  | "events"
  | "riskAlerts"
  | "sectorImpacts"
  | "opportunities"
  | "highConviction"
  | "developing";

export interface ScannerPartialEvent<K extends ScannerPartialKey = ScannerPartialKey> {
  key: K;
  data: ScannerResult[K];
}

export interface ScannerResult {
  scannedAt: string; // ISO
  pipelineVersion: 2;
  marketRegime: MarketRegime;
  macroSignals: MacroSignal[];
  sectorImpacts: SectorImpact[];
  emergingThemes: EmergingTheme[];
  events: MarketEvent[];
  opportunities: ScannerOpportunity[];
  /** Subset of opportunities with composite >= 70 */
  highConviction: ScannerOpportunity[];
  /** Subset of opportunities with composite 40-69 */
  developing: ScannerOpportunity[];
  riskAlerts: RiskAlert[];
  newsItems: NewsItem[];
  aiSummary: string;
}

/* -------------------------------------------------------------------------- */
/* Sector Rotation Engine                                                     */
/* -------------------------------------------------------------------------- */

export type RotationWindow = "1w" | "1m" | "3m" | "6m";
export type RotationClass = "leading" | "strengthening" | "weakening" | "lagging";

export interface SectorRotationEntry {
  sector: string;
  etfTicker: string;
  returns: Record<RotationWindow, number | null>;
  /** Primary-window return minus the equal-weight average return across all sectors. */
  relativeStrength: number;
  /** Acceleration proxy: change in relative strength vs. the prior snapshot. */
  momentum: number;
  rank: number; // 1 = strongest relative strength
  rankChange: number | null; // positive = moved up in rank since prior snapshot
  classification: RotationClass;
}

export interface SectorRotationSnapshot {
  asOf: string; // ISO date (YYYY-MM-DD)
  primaryWindow: RotationWindow;
  sectors: SectorRotationEntry[];
  leaders: string[];
  laggards: string[];
  leadershipChanges: { sector: string; fromRank: number; toRank: number }[];
}

/* -------------------------------------------------------------------------- */
/* Movement Explainer                                                          */
/* -------------------------------------------------------------------------- */

export type MovementSubjectKind = "symbol" | "sector" | "portfolio";

export interface MovementDriver {
  category: "earnings" | "analyst" | "macro" | "sector" | "valuation" | "news" | "technical" | "volume" | "sentiment" | "other";
  description: string;
  evidence: string;
  direction: SignalDirection;
}

export interface MovementExplanation {
  subject: string; // symbol, sector name, or "portfolio"
  subjectKind: MovementSubjectKind;
  asOf: string; // ISO
  observedMove: { changePercent: number | null; windowDays: number };
  summary: string;
  drivers: MovementDriver[];
  confidence: number; // 0-100
  persistence: "transient" | "short-term" | "durable";
}

/* -------------------------------------------------------------------------- */
/* Watchlist Intelligence                                                     */
/* -------------------------------------------------------------------------- */

export type WatchlistAlertType =
  | "new_opportunity"
  | "deteriorating"
  | "breakout"
  | "sector_leadership"
  | "valuation";

export interface WatchlistAlert {
  type: WatchlistAlertType;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  action: string;
  symbol: string;
}

/* -------------------------------------------------------------------------- */
/* Investment Timeline                                                        */
/* -------------------------------------------------------------------------- */

export type TimelineScope = "symbol" | "portfolio" | "watchlist" | "sector";

export type TimelineEventCategory =
  | "earnings"
  | "guidance"
  | "product_launch"
  | "acquisition"
  | "divestiture"
  | "ceo_change"
  | "executive_departure"
  | "share_buyback"
  | "dividend"
  | "regulatory_action"
  | "lawsuit"
  | "macro_event"
  | "industry_event"
  | "ai_developments"
  | "partnership"
  | "capacity_expansion"
  | "margin_expansion"
  | "margin_compression"
  | "demand_shift"
  | "competitive_threat"
  | "analyst_upgrade"
  | "analyst_downgrade"
  | "insider_buying"
  | "insider_selling"
  | "valuation_inflection"
  | "technical_breakout"
  | "sector_rotation"
  | "portfolio_impact";

export type TimelineImpact = "bullish" | "bearish" | "neutral";
export type ThesisDirection = "strengthened" | "weakened" | "unchanged";
export type CatalystStatus = "pending" | "realized" | "invalidated" | "not_catalyst";

export type TimelineSourceKind =
  | "news"
  | "filing"
  | "earnings_calendar"
  | "scanner"
  | "sector_rotation"
  | "watchlist_alert"
  | "portfolio_alert";

export interface TimelineEventSource {
  kind: TimelineSourceKind;
  url: string | null;
  description: string;
}

export interface TimelineEvent {
  id: string;
  symbol: string;
  timestamp: string; // ISO
  title: string;
  category: TimelineEventCategory;
  importanceScore: number; // 0-100, deterministic
  confidenceScore: number; // 0-100, deterministic (source reliability / data completeness)
  impact: TimelineImpact;
  affectedSegment: string | null;
  relatedMetrics: string[];
  source: TimelineEventSource;
  thesisImpact: ThesisDirection | null;
  catalystStatus: CatalystStatus;
}

export interface TimelineEventDetail {
  eventId: string;
  executiveSummary: string;
  background: string;
  rootCause: string;
  immediateReaction: string;
  longTermImplications: string;
  supportingEvidence: string[];
  bullCase: string[];
  bearCase: string[];
  historicalContext: string;
  currentRelevance: string;
  investmentTakeaway: string;
  confidence: number; // 0-100, AI-reported
  relatedEventIds: string[];
  generatedAt: string;
}

export interface ThesisEvolutionPoint {
  eventId: string;
  timestamp: string;
  title: string;
  direction: ThesisDirection;
  reason: string;
  thesisConfidence: number; // running 0-100 score after this event
}

export interface ThesisEvolution {
  symbol: string;
  points: ThesisEvolutionPoint[];
  currentConfidence: number;
  currentStance: ThesisDirection;
}

export interface WhatChangedResult {
  fromEventId: string;
  subsequentEvents: TimelineEvent[];
  assumptionsValidated: string[];
  assumptionsFailed: string[];
  managementExecution: string;
  stockResponsePercent: number | null;
  currentRelevance: string;
  generatedAt: string;
}

export interface TimelineFilters {
  fromDate?: string;
  toDate?: string;
  categories?: TimelineEventCategory[];
  minImportance?: number;
  minConfidence?: number;
  impact?: TimelineImpact;
  affectedSegment?: string;
  relatedMetric?: string;
  catalystOnly?: boolean;
  openThesisOnly?: boolean;
}

/**
 * The fullscreen chart workspace's AI dock context — everything needed to
 * answer one free-text question about the current chart state. Built fresh
 * client-side on every submit (see
 * app/research/_components/chart-workspace/build-chart-context.ts) and never
 * persisted or cached, since a free-text question isn't a stable cache key.
 * Deliberately plain/JSON-serializable and free of any chart-workspace UI
 * types (DrawingToolId/DrawingStyle live under app/, and lib/ never imports
 * from app/) — the drawing-specific fields below are structurally
 * equivalent, just typed with plain strings instead of those unions.
 */
export type ChartQASelectionKind = "overview" | "drawing" | "pattern" | "candle";

export interface ChartQACandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface ChartQASelection {
  kind: ChartQASelectionKind;
  /** The context-indicator text, e.g. "Chart Overview", "Trend Line", "Pattern · Bullish Engulfing", "Candle". */
  label: string;
  /** Present only when kind === "drawing". */
  drawing?: {
    type: string;
    points: { timestamp: number; value: number }[];
    style: { color: string; opacity: number; thickness: number; lineStyle: string; textSize: number };
  };
  /** Present only when kind === "pattern". Structurally matches lib/pattern-signals.ts's TechnicalSignal — not
   *  imported directly to avoid a circular import (pattern-signals.ts already imports HistoryPoint from here). */
  signal?: {
    name: string;
    direction: "bullish" | "bearish" | "neutral";
    description: string;
    date: string;
    confidence: number;
    confirmations: { label: string; detail: string }[];
  };
  /** Present when kind === "pattern" or "candle" — the hovered bar's OHLCV. */
  candle?: ChartQACandle;
}

export interface ChartQAOtherDrawing {
  type: string;
  label: string;
}

export interface ChartQANewsItem {
  headline: string;
  source: string;
  publishedAt: string;
}

export interface ChartQAContext {
  symbol: string;
  periodKey: string;
  candleInterval: string;
  indicatorsEnabled: string[];
  visibleCandleCount: number;
  visibleDateRange: { from: string; to: string };
  visiblePriceRange: { low: number; high: number };
  /** Deterministic, e.g. "+12.4% over the visible range; price above SMA50 and SMA200". */
  trendSummary: string;
  /** Deterministic, e.g. "latest bar 1.4x its 20-bar average volume". */
  volumeSummary: string;
  selection: ChartQASelection;
  otherDrawings: ChartQAOtherDrawing[];
  nearbyNews: ChartQANewsItem[];
}

export interface TimelineFeed {
  scope: TimelineScope;
  id: string;
  symbols: string[];
  events: TimelineEvent[];
  thesisEvolution: ThesisEvolution | null;
  generatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Manual assets — Real Estate / Private Markets / Alternatives / Structured  */
/* Products. No ticker, no API: user-entered facts + computed metrics (see   */
/* lib/manual-asset-analysis.ts). Standalone from Portfolio's aggregate      */
/* analytics for now (see project decisions) — its own ledger + research     */
/* view inside the Research Hub.                                             */
/* -------------------------------------------------------------------------- */

export type ManualAssetCategory = "real_estate" | "private_market" | "alternative" | "structured_product";

export interface RealEstateDetails {
  propertyType: string; // "Single-family", "Multi-family", "Commercial", "Land", ...
  address: string | null;
  annualRentalIncome: number | null;
  annualExpenses: number | null; // property tax + insurance + maintenance + HOA, combined
  outstandingMortgage: number | null;
  mortgageRatePercent: number | null; // annual, e.g. 6.5 = 6.5%
}

export interface PrivateMarketDetails {
  companyName: string;
  round: string | null; // "Seed", "Series A", "Secondary", ...
  ownershipPercent: number | null;
  lastRoundValuation: number | null; // company's total valuation at its most recent round, if known
}

export interface AlternativeDetails {
  subcategory: string; // "Art", "Wine", "Watches", "Collectibles", "Other", ...
  condition: string | null;
  provenance: string | null;
}

export type StructuredProductType = "barrier_reverse_convertible" | "principal_protected_note" | "autocallable" | "other";

export interface StructuredProductDetails {
  productType: StructuredProductType;
  underlyingSymbols: string[]; // e.g. ["AAPL"], or multiple for a worst-of structure
  initialLevels: Record<string, number>; // underlying symbol -> price at issuance
  barrierPercent: number | null; // e.g. 70 = 70% of the initial level
  couponRatePercent: number | null; // annual, e.g. 8 = 8%/year
  participationRatePercent: number | null; // upside participation for principal-protected notes, e.g. 100 = 1:1
  principalProtectionPercent: number | null; // e.g. 100 = fully protected, null = not protected
  maturityDate: string; // ISO date
}

interface ManualAssetBase {
  id: string;
  name: string;
  acquisitionDate: string; // ISO date
  acquisitionCost: number;
  currentValue: number | null; // user's latest estimate
  currentValueAsOf: string | null; // ISO date of that estimate
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ManualAsset =
  | (ManualAssetBase & { category: "real_estate"; details: RealEstateDetails })
  | (ManualAssetBase & { category: "private_market"; details: PrivateMarketDetails })
  | (ManualAssetBase & { category: "alternative"; details: AlternativeDetails })
  | (ManualAssetBase & { category: "structured_product"; details: StructuredProductDetails });
