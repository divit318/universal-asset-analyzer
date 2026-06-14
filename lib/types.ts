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
