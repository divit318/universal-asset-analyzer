/**
 * Indian equities — the ~500 largest NSE listings, screened as their own
 * class rather than mixed into the US universe.
 *
 * A separate class (not a region toggle inside `equity`) for two hard
 * reasons:
 *   1. Currency. Metrics here are INR-native (market cap in ₹, entered in
 *      ₹ Cr). Mixing raw INR and USD values into one universe would corrupt
 *      every ranking percentile and every market-cap filter.
 *   2. Data honesty. Yahoo's NSE coverage is thinner than its US coverage in
 *      specific, systematic ways (ROE for non-financials, FCF, current
 *      ratio). The metric declarations below say so per-field, and the
 *      filter engine's "missing = excluded, with a visible count" semantics
 *      do the rest. Indian-specific fields (ROCE, promoter holding, NPA) are
 *      declared `unavailable` — honestly specced for the next data provider
 *      rather than faked from the wrong source.
 *
 * Coverage boundary, stated plainly: NSE mainboard names above ~₹1,000 Cr
 * market cap (~500 companies) — not "all Indian stocks". BSE-only listings
 * and micro caps are out of scope for now.
 */

import type { AssetClassDefinition, MetricDef } from "./types";
import { SCREENER_SECTORS } from "../yahoo-screener";

const metrics: MetricDef[] = [
  // Size & Sector
  {
    key: "marketCap",
    label: "Market Cap",
    description: "Total equity value in ₹ crores (₹1 Cr = ₹10 million). SEBI-style buckets: large ≈ top-100 (~₹1,00,000 Cr+), mid ≈ 101–250.",
    group: "Size & Sector",
    unit: "₹Cr",
    availability: "live",
    source: "yahoo",
    better: null,
    scale: 1e7,
  },
  {
    key: "sector",
    label: "Sector",
    description: "Yahoo's 11-sector taxonomy, applied to NSE listings.",
    group: "Size & Sector",
    unit: "",
    availability: "live",
    source: "yahoo",
    better: null,
    options: SCREENER_SECTORS,
  },

  // Valuation
  {
    key: "forwardPE",
    label: "Forward P/E",
    description: "Price relative to next year's expected earnings.",
    group: "Valuation",
    unit: "x",
    availability: "live",
    source: "yahoo",
    better: "lower",
    step: 0.5,
  },
  {
    key: "pegRatio",
    label: "PEG Ratio",
    description: "Forward P/E divided by EPS growth — below 1x is the classic 'growth at a reasonable price' line.",
    group: "Valuation",
    unit: "x",
    availability: "derived",
    source: "yahoo",
    formula: "forwardPE / epsGrowthYoY (only when both are positive)",
    better: "lower",
    step: 0.1,
  },
  {
    key: "evToEbitda",
    label: "EV / EBITDA",
    description: "Capital-structure-neutral valuation. Not meaningful for banks/NBFCs (EBITDA is undefined for lenders) — treat financial-sector rows as expected gaps.",
    group: "Valuation",
    unit: "x",
    availability: "live",
    source: "yahoo",
    better: "lower",
    step: 0.5,
  },
  {
    key: "qualityPerPrice",
    label: "Quality per Price",
    description: "Earnings yield × ROIC: compounding per unit of price — the 'cheap AND good' screen as one number.",
    group: "Valuation",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "(100 / forwardPE) × (ROIC / 100)",
    better: "higher",
    step: 0.1,
  },

  // Growth
  {
    key: "revenueGrowthYoY",
    label: "Revenue Growth (YoY)",
    description: "Most recent fiscal-year revenue growth (Indian fiscal year, Apr–Mar).",
    group: "Growth",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 1,
  },
  {
    key: "revenueCagr3y",
    label: "Revenue CAGR (3y)",
    description: "Three-year compound revenue growth.",
    group: "Growth",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "(revenue_t / revenue_t-3)^(1/3) − 1 over fiscal years",
    better: "higher",
    step: 1,
  },
  {
    key: "epsGrowthYoY",
    label: "EPS Growth (YoY)",
    description: "Most recent fiscal-year EPS growth.",
    group: "Growth",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 1,
  },
  {
    key: "epsCagr3y",
    label: "EPS CAGR (3y)",
    description: "Three-year compound EPS growth.",
    group: "Growth",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "(eps_t / eps_t-3)^(1/3) − 1 over fiscal years",
    better: "higher",
    step: 1,
  },

  // Quality
  {
    key: "roic",
    label: "ROIC",
    description: "Return on invested capital — the closest available proxy for the ROCE figure Indian investors use. Computed from operating income and invested capital.",
    group: "Quality",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "NOPAT / (total debt + book equity); falls back to an ROE/leverage estimate",
    better: "higher",
    step: 1,
  },
  {
    key: "roe",
    label: "ROE",
    description: "Return on equity. Yahoo's TTM figure where reported; otherwise screener.in's latest-fiscal-year figure (coverage grows in the background). Filtering excludes names with neither.",
    group: "Quality",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 1,
  },
  {
    key: "operatingMargin",
    label: "Operating Margin",
    description: "Operating income over revenue (TTM).",
    group: "Quality",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 1,
  },
  {
    key: "grossMargin",
    label: "Gross Margin",
    description: "Not meaningful for banks/NBFCs (reported as 0 by the provider for lenders).",
    group: "Quality",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 1,
  },

  // Financial Strength
  {
    key: "debtToEquity",
    label: "Debt / Equity",
    description: "Total debt over book equity. For banks/NBFCs borrowing IS the business — a high value is not distress; screen lenders on ROE and P/B instead.",
    group: "Financial Strength",
    unit: "x",
    availability: "live",
    source: "yahoo",
    better: "lower",
    step: 0.1,
  },
  {
    key: "netDebtToEbitda",
    label: "Net Debt / EBITDA",
    description: "Leverage against cash generation. Undefined for lenders.",
    group: "Financial Strength",
    unit: "x",
    availability: "derived",
    source: "yahoo",
    formula: "(total debt − cash) / EBITDA",
    better: "lower",
    step: 0.5,
  },

  // Cash Flow
  {
    key: "fcfYield",
    label: "FCF Yield",
    description: "Free cash flow over market cap. Yahoo's FCF coverage for NSE names is partial — expect gaps, especially for financials.",
    group: "Cash Flow",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "free cash flow / market cap",
    better: "higher",
    step: 0.5,
  },
  {
    key: "fcfMargin",
    label: "FCF Margin",
    description: "Free cash flow over revenue.",
    group: "Cash Flow",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "free cash flow / revenue",
    better: "higher",
    step: 1,
  },

  // Shareholder Returns
  {
    key: "dividendYield",
    label: "Dividend Yield",
    description: "Trailing dividends over price.",
    group: "Shareholder Returns",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 0.25,
  },

  // Momentum
  {
    key: "oneYearReturn",
    label: "1-Year Return",
    description: "Trailing 12-month price return.",
    group: "Momentum",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 5,
  },
  {
    key: "distanceFrom52WkHigh",
    label: "From 52-Wk High",
    description: "How far below the 52-week high the price sits (negative %).",
    group: "Momentum",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 5,
  },

  // Composite Scores
  {
    key: "overallScore",
    label: "Overall Score",
    description: "The composite of value, growth, quality and financial health.",
    group: "Composite Scores",
    unit: "score",
    availability: "derived",
    source: "platform",
    formula: "weighted blend of the four dimension scores (lib/composite.ts)",
    better: "higher",
    step: 5,
  },
  {
    key: "valueScore",
    label: "Value Score",
    description: "Cheapness across P/E, EV/EBITDA and FCF yield, normalized 0–100.",
    group: "Composite Scores",
    unit: "score",
    availability: "derived",
    source: "platform",
    formula: "normalized valuation blend (lib/composite.ts)",
    better: "higher",
    step: 5,
  },
  {
    key: "growthScore",
    label: "Growth Score",
    description: "Revenue and EPS growth, normalized 0–100.",
    group: "Composite Scores",
    unit: "score",
    availability: "derived",
    source: "platform",
    formula: "normalized growth blend (lib/composite.ts)",
    better: "higher",
    step: 5,
  },
  {
    key: "qualityScore",
    label: "Quality Score",
    description: "Returns on capital and margins, normalized 0–100.",
    group: "Composite Scores",
    unit: "score",
    availability: "derived",
    source: "platform",
    formula: "normalized quality blend (lib/composite.ts)",
    better: "higher",
    step: 5,
  },
  {
    key: "financialHealthScore",
    label: "Financial Health",
    description: "Leverage and liquidity, normalized 0–100.",
    group: "Composite Scores",
    unit: "score",
    availability: "derived",
    source: "platform",
    formula: "normalized balance-sheet blend (lib/composite.ts)",
    better: "higher",
    step: 5,
  },

  // Indian-specific metrics from screener.in extracts (lib/india-ownership.ts).
  // Populated by a bounded background trickle + research visits; a name
  // without data is excluded from these filters, never assumed.
  {
    key: "roce",
    label: "ROCE",
    description: "Return on capital employed as screener.in reports it (latest fiscal year, the company's primary reporting basis). The figure Indian investors actually screen on.",
    group: "Quality",
    unit: "%",
    availability: "live",
    source: "screener_in",
    better: "higher",
    step: 1,
  },
  {
    key: "promoterHolding",
    label: "Promoter Holding",
    description: "Promoter stake as of the latest disclosed quarter (SEBI shareholding pattern via screener.in). Zero is a real value — many widely-held companies (e.g. HDFC Bank, ICICI Bank) have no promoter.",
    group: "Ownership",
    unit: "%",
    availability: "live",
    source: "screener_in",
    better: null,
    step: 5,
  },
  {
    key: "fiiHolding",
    label: "FII Holding",
    description: "Foreign institutional investor stake as of the latest disclosed quarter.",
    group: "Ownership",
    unit: "%",
    availability: "live",
    source: "screener_in",
    better: null,
    step: 1,
  },
  {
    key: "diiHolding",
    label: "DII Holding",
    description: "Domestic institutional investor stake as of the latest disclosed quarter.",
    group: "Ownership",
    unit: "%",
    availability: "live",
    source: "screener_in",
    better: null,
    step: 1,
  },
  {
    key: "promoterChangeQoQ",
    label: "Promoter Change (QoQ)",
    description: "Percentage-POINT change in promoter stake vs the previous disclosed quarter (e.g. +1.4 = 50.1% → 51.5%). Null when the company has no promoter or either quarter is undisclosed.",
    group: "Ownership",
    unit: "pp",
    availability: "derived",
    source: "screener_in",
    formula: "latest disclosed quarter minus previous disclosed quarter, in percentage points",
    better: "higher",
    step: 0.25,
  },
  {
    key: "fiiChangeQoQ",
    label: "FII Change (QoQ)",
    description: "Percentage-point change in FII stake vs the previous disclosed quarter — positive = foreign accumulation.",
    group: "Ownership",
    unit: "pp",
    availability: "derived",
    source: "screener_in",
    formula: "latest disclosed quarter minus previous disclosed quarter, in percentage points",
    better: "higher",
    step: 0.25,
  },
  {
    key: "diiChangeQoQ",
    label: "DII Change (QoQ)",
    description: "Percentage-point change in DII stake vs the previous disclosed quarter — positive = domestic institutional accumulation.",
    group: "Ownership",
    unit: "pp",
    availability: "derived",
    source: "screener_in",
    formula: "latest disclosed quarter minus previous disclosed quarter, in percentage points",
    better: "higher",
    step: 0.25,
  },
  // Multi-quarter trends over up to 12 disclosed quarters (Phase 7). Streaks
  // are SIGNED counts of consecutive disclosed QoQ steps ≥0.05pp in one
  // direction; 4Q changes need five real disclosures — no interpolation.
  {
    key: "fiiStreak",
    label: "FII Streak (qtrs)",
    description: "Consecutive disclosed quarters of FII movement in one direction: +3 = accumulated three quarters running; −2 = sold for two. 0 = latest quarter flat. Null without enough disclosed history.",
    group: "Ownership",
    unit: "",
    availability: "derived",
    source: "screener_in",
    formula: "signed run-length of QoQ steps ≥0.05pp in one direction over the disclosed series",
    better: "higher",
    step: 1,
  },
  {
    key: "diiStreak",
    label: "DII Streak (qtrs)",
    description: "Consecutive disclosed quarters of DII movement in one direction (signed, as for FII streak).",
    group: "Ownership",
    unit: "",
    availability: "derived",
    source: "screener_in",
    formula: "signed run-length of QoQ steps ≥0.05pp in one direction over the disclosed series",
    better: "higher",
    step: 1,
  },
  {
    key: "promoterStreak",
    label: "Promoter Streak (qtrs)",
    description: "Consecutive disclosed quarters of promoter stake movement in one direction (signed). Null for companies with no promoter.",
    group: "Ownership",
    unit: "",
    availability: "derived",
    source: "screener_in",
    formula: "signed run-length of QoQ steps ≥0.05pp in one direction over the disclosed series",
    better: "higher",
    step: 1,
  },
  {
    key: "fiiChange4Q",
    label: "FII Change (4 qtrs)",
    description: "Percentage-point change in FII stake over the last 4 disclosed quarters (both endpoints are real disclosures).",
    group: "Ownership",
    unit: "pp",
    availability: "derived",
    source: "screener_in",
    formula: "latest disclosed quarter minus the quarter four disclosures earlier, in percentage points",
    better: "higher",
    step: 0.5,
  },
  {
    key: "diiChange4Q",
    label: "DII Change (4 qtrs)",
    description: "Percentage-point change in DII stake over the last 4 disclosed quarters.",
    group: "Ownership",
    unit: "pp",
    availability: "derived",
    source: "screener_in",
    formula: "latest disclosed quarter minus the quarter four disclosures earlier, in percentage points",
    better: "higher",
    step: 0.5,
  },
  {
    key: "promoterChange4Q",
    label: "Promoter Change (4 qtrs)",
    description: "Percentage-point change in promoter stake over the last 4 disclosed quarters — a sustained decline is a classic Indian risk flag.",
    group: "Ownership",
    unit: "pp",
    availability: "derived",
    source: "screener_in",
    formula: "latest disclosed quarter minus the quarter four disclosures earlier, in percentage points",
    better: "higher",
    step: 0.5,
  },
  {
    key: "promoterPledge",
    label: "Promoter Pledge",
    description: "Share of the promoter stake pledged as collateral — a key Indian risk signal.",
    group: "Ownership",
    unit: "%",
    availability: "unavailable",
    source: null,
    // Investigated 2026-08 (twice): NSE's free corporate-pledgedata endpoint
    // exists but fails the provenance bar — its percPromoterShares /
    // percSharesPledged fields disagree with each other, most rows carry null
    // disclosure dates (some stamped 2015–2021), and values could not be
    // verified against known pledge positions. BSE's api.bseindia.com
    // shareholding/pledge endpoints return HTML error pages to non-browser
    // clients (no stable public JSON). Shipping an ambiguous number as
    // "pledge %" is worse than the gap; screener.in's public pages do not
    // carry pledge either.
    requires: "A pledge source with verifiable field semantics and as-of dates (NSE corporate-pledgedata: ambiguous/undated; BSE API: not publicly accessible)",
    better: "lower",
  },
  {
    key: "netNpaPercent",
    label: "Net NPA",
    description: "Bank/NBFC asset quality.",
    group: "Financial Strength",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires: "NSE results-filing extraction across the universe (available per-bank on research pages)",
    better: "lower",
  },
];

export const indiaEquityClass: AssetClassDefinition = {
  id: "indiaEquity",
  label: "India",
  noun: "stocks",
  description: "The ~500 largest NSE-listed companies (₹1,000 Cr+ market cap), ranked on fundamentals. Values in ₹.",
  icon: "TrendingUp",
  accent: "amber",
  assetClass: "equity",
  // A geography-scoped equity universe, not a distinct asset class: this is
  // what keeps "India" off asset-class taxonomies (Compare's tab row) while
  // the Screener keeps its dedicated NSE universe. See types.ts.
  marketVariantOf: "equity",
  taskType: "company-research",
  markets: ["IN"],
  exchanges: ["NSE"],
  identifiers: ["ticker"],
  providers: ["yahoo", "screener_in"],
  aliases: ["india", "indian stocks", "nse", "nifty", "sensex", "bse"],
  capabilities: ["screen", "research", "compare", "portfolio", "watchlist", "chart", "news", "fundamentals"],

  peerGroupBy: "sector",

  metrics,
  filterGroups: [
    "Composite Scores",
    "Size & Sector",
    "Valuation",
    "Growth",
    "Quality",
    "Financial Strength",
    "Cash Flow",
    "Shareholder Returns",
    "Momentum",
    "Ownership",
  ],

  rank: [
    { metric: "overallScore", weight: 3 },
    { metric: "qualityScore", weight: 1 },
    { metric: "valueScore", weight: 1 },
  ],

  templates: [
    {
      id: "large-cap-quality",
      name: "Large-Cap Quality",
      tagline: "₹1,00,000 Cr+ names earning well above their cost of capital",
      filters: {
        marketCap: { kind: "range", min: 1e12, max: null },   // ₹1,00,000 Cr
        roic: { kind: "range", min: 15, max: null },
      },
      rank: [
        { metric: "qualityScore", weight: 3 },
        { metric: "roic", weight: 2 },
        { metric: "overallScore", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "compounders",
      name: "Low-Debt Compounders",
      tagline: "High returns on capital with a conservative balance sheet",
      filters: {
        roic: { kind: "range", min: 15, max: null },
        debtToEquity: { kind: "range", min: null, max: 0.5 },
      },
      rank: [
        { metric: "roic", weight: 3 },
        { metric: "revenueCagr3y", weight: 2 },
        { metric: "qualityScore", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "growth",
      name: "High Growth",
      tagline: "Top and bottom line compounding fast",
      filters: {
        revenueGrowthYoY: { kind: "range", min: 15, max: null },
        epsGrowthYoY: { kind: "range", min: 10, max: null },
      },
      rank: [
        { metric: "growthScore", weight: 3 },
        { metric: "revenueCagr3y", weight: 2 },
        { metric: "epsCagr3y", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "dividend",
      name: "Dividend Payers",
      tagline: "Meaningful yield from companies that can afford it",
      filters: {
        dividendYield: { kind: "range", min: 1.5, max: null },
        financialHealthScore: { kind: "range", min: 50, max: null },
      },
      rank: [
        { metric: "dividendYield", weight: 3 },
        { metric: "financialHealthScore", weight: 2 },
        { metric: "qualityScore", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "value",
      name: "Value",
      tagline: "Cheap on earnings without a broken balance sheet",
      filters: {
        forwardPE: { kind: "range", min: null, max: 18 },
        financialHealthScore: { kind: "range", min: 45, max: null },
      },
      rank: [
        { metric: "valueScore", weight: 3 },
        { metric: "forwardPE", weight: 1 },
        { metric: "financialHealthScore", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "promoter-accumulation",
      name: "Promoter Accumulation",
      tagline: "Promoters raised their own stake last quarter — skin in the game rising",
      filters: {
        promoterChangeQoQ: { kind: "range", min: 0.3, max: null },
      },
      rank: [
        { metric: "promoterChangeQoQ", weight: 3 },
        { metric: "qualityScore", weight: 1 },
        { metric: "overallScore", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "fii-accumulation",
      name: "FII Accumulation",
      tagline: "Foreign institutions added ≥0.5pp last quarter",
      filters: {
        fiiChangeQoQ: { kind: "range", min: 0.5, max: null },
      },
      rank: [
        { metric: "fiiChangeQoQ", weight: 3 },
        { metric: "overallScore", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "sustained-fii-accumulation",
      name: "Sustained FII Buying",
      tagline: "FIIs added in 3+ consecutive disclosed quarters",
      filters: {
        fiiStreak: { kind: "range", min: 3, max: null },
      },
      rank: [
        { metric: "fiiStreak", weight: 3 },
        { metric: "fiiChange4Q", weight: 2 },
        { metric: "overallScore", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "promoter-reduction",
      name: "Promoter Reduction",
      tagline: "Promoter stake down >2pp over 4 disclosed quarters — alignment risk screen",
      filters: {
        promoterChange4Q: { kind: "range", min: null, max: -2 },
      },
      rank: [
        { metric: "promoterChange4Q", weight: 3 },
        { metric: "oneYearReturn", weight: 1 },
      ],
      sort: { key: "promoterChange4Q", dir: "asc" },
    },
    {
      id: "institutional-selling",
      name: "Institutional Selling",
      tagline: "FIIs cut ≥1pp last quarter — names under distribution",
      filters: {
        fiiChangeQoQ: { kind: "range", min: null, max: -1 },
      },
      rank: [
        { metric: "fiiChangeQoQ", weight: 3 },
        { metric: "oneYearReturn", weight: 1 },
      ],
      sort: { key: "fiiChangeQoQ", dir: "asc" },
    },
    {
      id: "owned-and-compounding",
      name: "Strong Ownership + Fundamentals",
      tagline: "Majority promoter stake with high returns on capital",
      filters: {
        promoterHolding: { kind: "range", min: 50, max: null },
        roce: { kind: "range", min: 15, max: null },
      },
      rank: [
        { metric: "roce", weight: 3 },
        { metric: "promoterHolding", weight: 1 },
        { metric: "qualityScore", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "mid-small-growth",
      name: "Mid/Small-Cap Growth",
      tagline: "Sub-₹50,000 Cr names growing revenue 15%+",
      filters: {
        marketCap: { kind: "range", min: null, max: 5e11 },   // ₹50,000 Cr
        revenueGrowthYoY: { kind: "range", min: 15, max: null },
      },
      rank: [
        { metric: "growthScore", weight: 3 },
        { metric: "revenueGrowthYoY", weight: 2 },
        { metric: "roic", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
  ],

  columns: [
    { key: "rankScore", label: "Match", align: "right" },
    { key: "overallScore", label: "Overall", align: "right" },
    { key: "marketCap", label: "Mkt Cap", align: "right" },
    { key: "forwardPE", label: "Fwd P/E", align: "right" },
    { key: "revenueGrowthYoY", label: "Rev Gr", align: "right" },
    { key: "roce", label: "ROCE", align: "right" },
    { key: "roe", label: "ROE", align: "right" },
    { key: "promoterHolding", label: "Promoter", align: "right" },
    { key: "dividendYield", label: "Div", align: "right" },
    { key: "oneYearReturn", label: "1Y", align: "right" },
  ],
  defaultSort: { key: "rankScore", dir: "desc" },

  aiPrompt: {
    role: "an equity analyst covering Indian listed companies",
    focus:
      "business quality, valuation versus growth on Indian market norms, balance-sheet risk (remembering that leverage is structural for banks and NBFCs), and whether the screen's top names share a common driver or are a grab-bag",
  },

  chart: {
    lookbackDays: 365,
    logScale: false,
  },

  warnings: [
    {
      id: "lender-leverage",
      label: "Lender — D/E not comparable",
      test: (m, a) =>
        (a.sector ?? "") === "Financial Services" && m.debtToEquity != null && m.debtToEquity > 2,
    },
    {
      id: "far-from-high",
      label: "40%+ below 52-wk high",
      test: (m) => m.distanceFrom52WkHigh != null && m.distanceFrom52WkHigh < -40,
    },
    {
      id: "negative-eps-growth",
      label: "Earnings shrinking",
      test: (m) => m.epsGrowthYoY != null && m.epsGrowthYoY < -20,
    },
  ],
};
