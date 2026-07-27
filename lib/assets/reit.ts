/**
 * REITs. A REIT is not a distinct Yahoo quoteType — it's an EQUITY with
 * sector "Real Estate" (871 US names as of this writing), so the universe
 * reuses the equity enrichment path wholesale and this class exists to give
 * that slice REIT-appropriate *metrics, ranking and templates* rather than
 * judging a landlord by a software company's yardsticks (a REIT's P/E is
 * meaningless — depreciation swamps it — which is exactly why FFO exists).
 *
 * On FFO/AFFO: neither is a Yahoo field. FFO's definition is net income plus
 * real-estate depreciation, less gains on sales — and the closest honest
 * proxy available from Yahoo's `financialData` is operating cash flow, which
 * for a REIT is FFO before working-capital swings. So `pFfo` below is
 * marketCap / operatingCashflow, declared `derived` with that formula stated,
 * and named "P/FFO (approx.)" everywhere it surfaces. It is a good ratio and
 * a bad substitute for the real thing; occupancy, cap rate, NOI growth and
 * same-store metrics have no free feed at all and stay unavailable.
 */

import type { AssetClassDefinition, MetricDef } from "./types";

/**
 * Yahoo's `industry` for a Real Estate sector name is already a property-type
 * taxonomy ("REIT - Retail", "REIT - Industrial", …). We strip the "REIT - "
 * prefix and screen on it directly — real data, no guessing.
 */
export const PROPERTY_TYPES = [
  "Retail",
  "Residential",
  "Industrial",
  "Office",
  "Healthcare Facilities",
  "Hotel & Motel",
  "Specialty",
  "Diversified",
  "Mortgage",
  "Real Estate Services",
] as const;

const metrics: MetricDef[] = [
  {
    key: "marketCap",
    label: "Market Cap",
    description: "Total equity value. Entered in billions.",
    group: "Size & Type",
    unit: "$B",
    availability: "live",
    source: "yahoo",
    better: null,
    scale: 1e9,
  },
  {
    key: "propertyType",
    label: "Property Type",
    description: "What the REIT actually owns — the single biggest driver of its cycle.",
    group: "Size & Type",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "Yahoo `industry` with the 'REIT - ' prefix stripped",
    better: null,
    options: PROPERTY_TYPES,
  },

  {
    key: "dividendYield",
    label: "Dividend Yield",
    description: "The reason most people own REITs. REITs must distribute 90% of taxable income.",
    group: "Income",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 0.1,
  },
  {
    key: "payoutRatio",
    label: "Payout Ratio",
    description: "Dividend as a share of cash flow. Above 100% means the distribution is being funded from somewhere other than operations.",
    group: "Income",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "dividendYield ÷ (operatingCashflow / marketCap × 100) — i.e. the dividend as a share of the FFO proxy",
    better: "lower",
  },

  {
    key: "pFfo",
    label: "P/FFO (approx.)",
    description:
      "Price to funds from operations — the REIT equivalent of a P/E. Approximated with operating cash flow. Blank for mortgage REITs and real-estate services companies, where that approximation does not hold.",
    group: "Valuation",
    unit: "x",
    availability: "derived",
    source: "yahoo",
    formula:
      "marketCap / operatingCashflow (OCF stands in for FFO — it is FFO before working-capital movements). Null for mortgage REITs and real-estate services, whose cash flows are not rents, and outside a 3-100x plausibility band.",
    better: "lower",
    step: 0.5,
  },
  {
    key: "ffoYield",
    label: "FFO Yield (approx.)",
    description: "The inverse of P/FFO — cash earnings as a percentage of price.",
    group: "Valuation",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "operatingCashflow / marketCap × 100",
    better: "higher",
    step: 0.5,
  },
  {
    key: "evToEbitda",
    label: "EV / EBITDA",
    description: "Standard REIT valuation yardstick, neutral to how the portfolio is financed.",
    group: "Valuation",
    unit: "x",
    availability: "live",
    source: "yahoo",
    better: "lower",
    step: 0.5,
  },
  {
    key: "revenueGrowthYoY",
    label: "Revenue Growth YoY",
    description: "Top-line growth — rent escalators plus acquisitions.",
    group: "Growth",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
  },
  {
    key: "ffoGrowthYoY",
    label: "FFO Growth YoY (approx.)",
    description: "Growth in the cash-flow proxy for FFO.",
    group: "Growth",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "year-over-year growth in operating cash flow",
    better: "higher",
  },

  {
    key: "debtToEquity",
    label: "Debt / Equity",
    description: "REITs are levered by design; the question is how much.",
    group: "Leverage",
    unit: "x",
    availability: "live",
    source: "yahoo",
    better: "lower",
    step: 0.1,
  },
  {
    key: "netDebtToEbitda",
    label: "Net Debt / EBITDA",
    description: "The covenant metric lenders actually watch. Above ~7x is stretched for a REIT.",
    group: "Leverage",
    unit: "x",
    availability: "derived",
    source: "yahoo",
    formula:
      "netDebt / ebitda. Null whenever ebitda is — which is nearly always for Mortgage REITs, whose spread-income business has no EBITDA line at all. See netDebt below for the ratio-independent figure.",
    better: "lower",
    step: 0.1,
  },
  {
    key: "netDebt",
    label: "Net Debt",
    description: "Total debt minus cash. Entered in billions.",
    group: "Leverage",
    unit: "$B",
    availability: "derived",
    source: "yahoo",
    formula:
      "totalDebt − totalCash (financialData), preferring the annual balance-sheet netDebt time series when Yahoo reports it directly. Unlike netDebtToEbitda, has no EBITDA dependency, so it is populated for Mortgage REITs too.",
    better: "lower",
    scale: 1e9,
  },

  {
    key: "oneYearReturn",
    label: "1-Year Return",
    description: "Trailing 12-month price return.",
    group: "Momentum",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
  },
  {
    key: "distanceFrom52WkHigh",
    label: "Distance from 52W High",
    description: "How far below the 52-week high the price sits (negative).",
    group: "Momentum",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
  },

  // Declared-but-unscreenable. These four are the heart of real REIT analysis
  // and none of them exist in any free feed — they live in supplemental
  // packages (quarterly PDFs/XLS), not in structured market data.
  {
    key: "capRate",
    label: "Cap Rate",
    description: "Net operating income divided by property value.",
    group: "Property Fundamentals",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires:
      "Portfolio-level NOI and appraised asset value. Published only in REIT supplemental disclosures (quarterly PDF/XLS), not in Yahoo or any structured free feed. Would need an EDGAR supplemental parser or a CRE data vendor (Green Street, CoStar).",
    better: "higher",
  },
  {
    key: "occupancy",
    label: "Occupancy",
    description: "Percentage of leasable space currently let.",
    group: "Property Fundamentals",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires: "REIT supplemental disclosures. Same gap as cap rate — no structured free source.",
    better: "higher",
  },
  {
    key: "noiGrowth",
    label: "Same-Store NOI Growth",
    description: "Growth in net operating income on a like-for-like property basis.",
    group: "Property Fundamentals",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires:
      "Same-store NOI is a REIT-defined, non-GAAP figure disclosed only in supplementals. `ffoGrowthYoY` above is the nearest available signal, but it is company-wide and includes acquisitions.",
    better: "higher",
  },
  {
    key: "geography",
    label: "Geography",
    description: "Which metros/regions the portfolio sits in.",
    group: "Property Fundamentals",
    unit: "",
    availability: "unavailable",
    source: null,
    requires:
      "Property-level location data from supplementals. Yahoo gives the REIT's HQ state, which is not where its buildings are and would be actively misleading to screen on.",
    better: null,
  },
];

export const reitClass: AssetClassDefinition = {
  id: "reit",
  label: "REITs",
  noun: "REITs",
  description: "Listed real estate, judged on FFO and distributions rather than P/E.",
  icon: "Building2",
  accent: "amber",
  assetClass: "equity",
  taskType: "company-research",
  markets: ["US"],
  exchanges: ["NYSE", "NASDAQ"],
  identifiers: ["ticker"],
  providers: ["yahoo", "sec_edgar"],
  aliases: ["reit", "reits", "real estate", "property", "landlords"],
  capabilities: ["screen", "research", "compare", "portfolio", "watchlist", "chart", "news", "fundamentals"],

  metrics,
  filterGroups: ["Size & Type", "Income", "Valuation", "Growth", "Leverage", "Momentum", "Property Fundamentals"],

  rank: [
    { metric: "dividendYield", weight: 2 },
    { metric: "ffoYield", weight: 2 },
    { metric: "netDebtToEbitda", weight: 1 },
  ],

  templates: [
    {
      id: "high-yield",
      name: "High Yield",
      tagline: "Big distributions that the cash flow can actually cover",
      filters: {
        dividendYield: { kind: "range", min: 5, max: null },
        payoutRatio: { kind: "range", min: null, max: 100 },
      },
      rank: [
        { metric: "dividendYield", weight: 3 },
        { metric: "payoutRatio", weight: 2 },
        { metric: "netDebtToEbitda", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "growth-reits",
      name: "Growth REITs",
      tagline: "Compounding rents and FFO, not just collecting them",
      filters: {
        ffoGrowthYoY: { kind: "range", min: 5, max: null },
        revenueGrowthYoY: { kind: "range", min: 5, max: null },
      },
      rank: [
        { metric: "ffoGrowthYoY", weight: 3 },
        { metric: "revenueGrowthYoY", weight: 2 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "commercial",
      name: "Commercial",
      tagline: "Offices, retail and industrial — the classic commercial book",
      filters: {
        propertyType: { kind: "multiselect", values: ["Office", "Retail", "Industrial"] },
      },
      rank: [
        { metric: "ffoYield", weight: 2 },
        { metric: "dividendYield", weight: 2 },
        { metric: "netDebtToEbitda", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "residential",
      name: "Residential",
      tagline: "Apartments, single-family rentals and manufactured housing",
      filters: {
        propertyType: { kind: "multiselect", values: ["Residential"] },
      },
      rank: [
        { metric: "ffoGrowthYoY", weight: 2 },
        { metric: "dividendYield", weight: 2 },
        { metric: "netDebtToEbitda", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "conservative-balance-sheet",
      name: "Conservative Balance Sheet",
      tagline: "The ones that survive a refinancing window",
      filters: {
        netDebtToEbitda: { kind: "range", min: null, max: 5.5 },
        debtToEquity: { kind: "range", min: null, max: 1.2 },
        payoutRatio: { kind: "range", min: null, max: 90 },
      },
      rank: [
        { metric: "netDebtToEbitda", weight: 3 },
        { metric: "payoutRatio", weight: 2 },
        { metric: "dividendYield", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
  ],

  columns: [
    { key: "rankScore", label: "Match", align: "right" },
    { key: "dividendYield", label: "Yield", align: "right" },
    { key: "pFfo", label: "P/FFO", align: "right" },
    { key: "ffoGrowthYoY", label: "FFO Gr", align: "right" },
    { key: "payoutRatio", label: "Payout", align: "right" },
    { key: "netDebtToEbitda", label: "ND/EBITDA", align: "right" },
    { key: "netDebt", label: "Net Debt", align: "right" },
    { key: "marketCap", label: "Mkt Cap", align: "right" },
    { key: "propertyType", label: "Type", align: "left" },
  ],
  defaultSort: { key: "rankScore", dir: "desc" },

  aiPrompt: {
    role: "a real estate securities analyst",
    focus:
      "distribution coverage from FFO rather than earnings, leverage against the refinancing calendar, and whether the property type is cyclically out of favour for a good reason",
  },

  chart: { lookbackDays: 365, logScale: false },

  warnings: [
    {
      id: "uncovered-dividend",
      label: "Distribution may not be covered by cash flow",
      test: (m) => m.payoutRatio != null && m.payoutRatio > 100,
    },
    {
      id: "stretched-leverage",
      label: "Stretched leverage for a REIT",
      test: (m) => m.netDebtToEbitda != null && m.netDebtToEbitda > 7,
    },
    {
      id: "yield-trap",
      label: "Very high yield — the market is pricing in a cut",
      test: (m) => m.dividendYield != null && m.dividendYield > 10,
    },
    {
      id: "office-exposure",
      label: "Office exposure — structural demand risk",
      test: (_m, a) => a.propertyType === "Office",
    },
    {
      // Explains the blank FFO/payout columns, rather than leaving the user to
      // wonder whether the data is missing or the company is odd. It's the
      // latter: an mREIT owns loans, not buildings, so FFO doesn't apply and
      // its risk is interest-rate spread, not occupancy.
      id: "mortgage-reit",
      label: "Mortgage REIT — owns loans, not property; FFO and payout coverage don't apply",
      test: (_m, a) => a.propertyType === "Mortgage",
    },
    {
      id: "not-a-landlord",
      label: "Real-estate services company, not a rent-collecting REIT",
      test: (_m, a) => a.propertyType === "Real Estate Services",
    },
  ],
};
