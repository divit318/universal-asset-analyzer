import type { FundamentalScreenerCriteria, StockMetrics } from "@/lib/types";

/** A single filterable metric (maps to a key on FundamentalScreenerCriteria). */
export interface FieldDef {
  key: string;
  label: string;
  /** Hint for the input suffix / formatting. */
  unit?: "%" | "x" | "$B" | "";
  step?: string;
}

export interface SectionDef {
  title: string;
  blurb: string;
  fields: FieldDef[];
  defaultOpen?: boolean;
}

/**
 * Filter sections. Each metric earns its place in an investment decision; we
 * deliberately keep the list tight rather than exhaustive.
 */
export const SECTIONS: SectionDef[] = [
  {
    title: "Valuation",
    blurb: "How cheap is the business relative to earnings and cash flow?",
    fields: [
      { key: "forwardPE", label: "Forward P/E", unit: "x", step: "0.5" },
      { key: "evToEbitda", label: "EV / EBITDA", unit: "x", step: "0.5" },
      { key: "fcfYield", label: "FCF Yield", unit: "%", step: "0.5" },
    ],
  },
  {
    title: "Growth",
    blurb: "Is the top and bottom line compounding?",
    fields: [
      { key: "revenueGrowthYoY", label: "Revenue Growth YoY", unit: "%" },
      { key: "revenueCagr3y", label: "Revenue CAGR 3Y", unit: "%" },
      { key: "epsGrowthYoY", label: "EPS Growth YoY", unit: "%" },
      { key: "epsCagr3y", label: "EPS CAGR 3Y", unit: "%" },
    ],
  },
  {
    title: "Quality",
    blurb: "Does the business earn high returns on capital?",
    fields: [
      { key: "roic", label: "ROIC", unit: "%" },
      { key: "roe", label: "ROE", unit: "%" },
      { key: "grossMargin", label: "Gross Margin", unit: "%" },
      { key: "operatingMargin", label: "Operating Margin", unit: "%" },
    ],
  },
  {
    title: "Financial Strength",
    blurb: "Can the balance sheet weather a downturn?",
    fields: [
      { key: "debtToEquity", label: "Debt / Equity", unit: "x", step: "0.1" },
      { key: "netDebtToEbitda", label: "Net Debt / EBITDA", unit: "x", step: "0.1" },
      { key: "currentRatio", label: "Current Ratio", unit: "x", step: "0.1" },
    ],
  },
  {
    title: "Cash Flow",
    blurb: "Quality and trajectory of free cash flow.",
    fields: [
      { key: "fcfMargin", label: "FCF Margin", unit: "%" },
      { key: "fcfGrowthYoY", label: "FCF Growth YoY", unit: "%" },
    ],
  },
  {
    title: "Shareholder Returns",
    blurb: "Cash returned via dividends and buybacks.",
    fields: [
      { key: "dividendYield", label: "Dividend Yield", unit: "%", step: "0.1" },
      { key: "buybackYield", label: "Buyback Yield", unit: "%", step: "0.1" },
    ],
  },
  {
    title: "Momentum",
    blurb: "Price trend and proximity to the 52-week high.",
    fields: [
      { key: "oneYearReturn", label: "1-Year Return", unit: "%" },
      { key: "distanceFrom52WkHigh", label: "Distance from 52W High", unit: "%" },
    ],
  },
  {
    title: "Market Factors",
    blurb: "Institutional conviction and earnings execution.",
    fields: [
      { key: "institutionalOwnership", label: "Institutional Ownership", unit: "%" },
      { key: "earningsSurprisePct", label: "Earnings Surprise", unit: "%" },
    ],
  },
];

/** Composite-score floors (0-100), shown as their own prominent section. */
export const SCORE_FIELDS: FieldDef[] = [
  { key: "overallScore", label: "Overall" },
  { key: "valueScore", label: "Value" },
  { key: "growthScore", label: "Growth" },
  { key: "qualityScore", label: "Quality" },
  { key: "financialHealthScore", label: "Financial Health" },
];

/** Result table columns beyond the fixed symbol/name/sector. */
export interface ColumnDef {
  key: string;
  label: string;
  kind: "score" | "mcap" | "ratio" | "pct";
  get: (m: StockMetrics) => number | null;
}

export const COLUMNS: ColumnDef[] = [
  { key: "overallScore", label: "Overall", kind: "score", get: (m) => m.scores.overall },
  { key: "valueScore", label: "Value", kind: "score", get: (m) => m.scores.value },
  { key: "growthScore", label: "Growth", kind: "score", get: (m) => m.scores.growth },
  { key: "qualityScore", label: "Quality", kind: "score", get: (m) => m.scores.quality },
  { key: "financialHealthScore", label: "Health", kind: "score", get: (m) => m.scores.financialHealth },
  { key: "marketCap", label: "Mkt Cap", kind: "mcap", get: (m) => m.marketCap },
  { key: "forwardPE", label: "Fwd P/E", kind: "ratio", get: (m) => m.forwardPE },
  { key: "revenueGrowthYoY", label: "Rev Gr", kind: "pct", get: (m) => m.revenueGrowthYoY },
  { key: "roic", label: "ROIC", kind: "pct", get: (m) => m.roic },
  { key: "fcfYield", label: "FCF Yld", kind: "pct", get: (m) => m.fcfYield },
  { key: "dividendYield", label: "Div", kind: "pct", get: (m) => m.dividendYield },
];

/** One-click strategies that set sensible filters + sort for common goals. */
export interface Preset {
  name: string;
  tagline: string;
  criteria: Partial<FundamentalScreenerCriteria>;
}

export const PRESETS: Preset[] = [
  {
    name: "Quality Compounders",
    tagline: "High returns on capital, still growing",
    criteria: {
      qualityScore: { min: 70 },
      revenueGrowthYoY: { min: 8 },
      sortField: "overallScore",
      sortDir: "desc",
    },
  },
  {
    name: "Undervalued Growth",
    tagline: "Cheap relative to the growth on offer",
    criteria: {
      valueScore: { min: 55 },
      growthScore: { min: 60 },
      sortField: "overallScore",
      sortDir: "desc",
    },
  },
  {
    name: "Deep Value",
    tagline: "Lowest valuations, decent balance sheets",
    criteria: {
      valueScore: { min: 70 },
      financialHealthScore: { min: 50 },
      sortField: "valueScore",
      sortDir: "desc",
    },
  },
  {
    name: "Dividend Payers",
    tagline: "Durable income with a healthy balance sheet",
    criteria: {
      dividendYield: { min: 2.5 },
      financialHealthScore: { min: 60 },
      sortField: "dividendYield",
      sortDir: "desc",
    },
  },
  {
    name: "Fortress Balance Sheet",
    tagline: "Minimal leverage, strong liquidity",
    criteria: {
      financialHealthScore: { min: 78 },
      sortField: "financialHealthScore",
      sortDir: "desc",
    },
  },
  {
    name: "Momentum Leaders",
    tagline: "Strong 1-year trend near highs",
    criteria: {
      oneYearReturn: { min: 20 },
      qualityScore: { min: 55 },
      sortField: "oneYearReturn",
      sortDir: "desc",
    },
  },
];
