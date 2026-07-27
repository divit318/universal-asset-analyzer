/**
 * ETFs. Backed by Yahoo's ETF screener (netExpenseRatio, netAssets,
 * dividendYield, ytdReturn come back inline on the screener row) plus a
 * quoteSummary enrichment pass for the holdings-level fields — the same
 * `topHoldings` / `fundProfile` modules lib/yahoo.ts#getFundProfile already
 * uses for the Fund research engine, so no new provider is introduced.
 *
 * On the three metrics we can't do: country exposure, tracking error and fund
 * flows are genuinely absent from every free Yahoo endpoint. Rather than fake
 * them, note that Yahoo's Morningstar-style `categoryName` ("China Region",
 * "Japan Stock", "Technology", "Large Growth") already encodes geography,
 * sector and style — so `region`, `focus` and `style` below are derived from
 * it and give the Country/Sector/Thematic templates something real to bite on.
 * Tracking error and fund flow stay declared-but-unavailable.
 */

import type { AssetClassDefinition, MetricDef } from "./types";

export const ETF_REGIONS = [
  "US",
  "Global",
  "Developed ex-US",
  "Emerging Markets",
  "Europe",
  "Japan",
  "China",
  "India",
  "Latin America",
  "Other",
] as const;

export const ETF_STYLES = ["Value", "Blend", "Growth", "Sector", "Thematic", "Income", "Other"] as const;

export const ETF_FOCUS = [
  "Broad Market",
  "Technology",
  "Healthcare",
  "Financials",
  "Energy",
  "Real Estate",
  "Utilities",
  "Industrials",
  "Consumer",
  "Materials",
  "Communication",
  "Commodities",
  "Other",
] as const;

const metrics: MetricDef[] = [
  {
    key: "expenseRatio",
    label: "Expense Ratio",
    description: "Annual fee. The single most reliable predictor of long-run net return.",
    group: "Cost & Size",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "lower",
    step: 0.01,
  },
  {
    key: "aum",
    label: "AUM",
    description: "Net assets. Below ~$100M, closure and spread risk rise sharply. Entered in billions.",
    group: "Cost & Size",
    unit: "$B",
    availability: "live",
    source: "yahoo",
    better: "higher",
    scale: 1e9,
  },
  {
    key: "avgVolume",
    label: "Avg Volume",
    description: "3-month average daily share volume — the practical read on liquidity.",
    group: "Cost & Size",
    unit: "",
    availability: "live",
    source: "yahoo",
    better: "higher",
  },

  {
    key: "dividendYield",
    label: "Dividend Yield",
    description: "Trailing 12-month distribution yield.",
    group: "Income & Return",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 0.1,
  },
  {
    key: "ytdReturn",
    label: "YTD Return",
    description: "Year-to-date total return.",
    group: "Income & Return",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
  },
  {
    key: "oneYearReturn",
    label: "1-Year Return",
    description: "Trailing 12-month price return.",
    group: "Income & Return",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "price change over the trailing 252 sessions of daily history",
    better: "higher",
  },

  {
    key: "volatility",
    label: "Volatility (ann.)",
    description: "Annualised standard deviation of daily returns over the last year.",
    group: "Risk",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "stddev(daily returns) × √252 × 100",
    better: "lower",
  },
  {
    key: "maxDrawdown",
    label: "Max Drawdown",
    description: "Worst peak-to-trough decline over the fetched window (negative).",
    group: "Risk",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "lib/portfolio-analytics.ts#maxDrawdown over daily closes",
    better: "higher",
  },
  {
    key: "top10Concentration",
    label: "Top-10 Concentration",
    description: "Combined weight of the ten largest holdings. High values mean the fund is a bet on a handful of names.",
    group: "Risk",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "sum of the top 10 holdingPercent values from the topHoldings module",
    better: "lower",
  },
  {
    key: "topSectorWeight",
    label: "Top Sector Weight",
    description: "Weight of the fund's single largest sector — a direct read on sector concentration.",
    group: "Risk",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "max(sectorWeightings) from the topHoldings module",
    better: "lower",
  },

  {
    key: "region",
    label: "Region",
    description: "Geographic focus, read from the fund's Morningstar-style category.",
    group: "Exposure",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "mapped from fundProfile.categoryName (e.g. 'China Region' → China)",
    better: null,
    options: ETF_REGIONS,
  },
  {
    key: "focus",
    label: "Sector Focus",
    description: "Sector the fund concentrates in, from its category and largest sector weight.",
    group: "Exposure",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "mapped from fundProfile.categoryName, falling back to the largest sectorWeightings entry",
    better: null,
    options: ETF_FOCUS,
  },
  {
    key: "style",
    label: "Style",
    description: "Value / blend / growth / thematic tilt, from the fund's category.",
    group: "Exposure",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "mapped from fundProfile.categoryName",
    better: null,
    options: ETF_STYLES,
  },
  {
    key: "equityWeight",
    label: "Equity Weight",
    description: "Share of the portfolio in stocks (vs bonds/cash) — separates equity funds from allocation funds.",
    group: "Exposure",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: null,
  },

  // Declared-but-unscreenable.
  {
    key: "trackingError",
    label: "Tracking Error",
    description: "Standard deviation of the fund's return minus its benchmark's.",
    group: "Risk",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires:
      "Per-fund benchmark index identity plus that index's daily NAV series. Yahoo exposes neither; this needs a fund-data vendor (Morningstar/FactSet) or the issuer's own index feed.",
    better: "lower",
  },
  {
    key: "fundFlow",
    label: "Fund Flow (3M)",
    description: "Net creations minus redemptions — where the money is actually going.",
    group: "Cost & Size",
    unit: "$B",
    availability: "unavailable",
    source: null,
    requires:
      "A creations/redemptions feed (issuer daily flow files, or a vendor like ETF.com / Morningstar). Not derivable from price and AUM alone, because AUM moves with the market too.",
    better: "higher",
  },
  {
    key: "countryExposure",
    label: "Country Exposure",
    description: "Precise country-level weights of the underlying holdings.",
    group: "Exposure",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires:
      "Holding-level domicile data. Yahoo's topHoldings gives sector weights but no country breakdown. The `region` metric above is the honest approximation available today.",
    better: null,
  },
];

export const etfClass: AssetClassDefinition = {
  id: "etf",
  label: "ETFs",
  noun: "funds",
  description: "Exchange-traded funds, ranked on cost, size, concentration and risk.",
  icon: "Layers",
  accent: "violet",
  assetClass: "fund",
  taskType: "fund-research",
  markets: ["US"],
  exchanges: ["NYSE Arca", "NASDAQ", "BATS"],
  identifiers: ["ticker", "isin"],
  providers: ["yahoo"],
  aliases: ["etf", "etfs", "funds", "index funds", "trackers"],
  capabilities: ["screen", "research", "compare", "portfolio", "watchlist", "chart", "news"],

  metrics,
  filterGroups: ["Cost & Size", "Income & Return", "Risk", "Exposure"],

  rank: [
    { metric: "expenseRatio", weight: 3 },
    { metric: "aum", weight: 2 },
    { metric: "oneYearReturn", weight: 1 },
  ],

  templates: [
    {
      id: "low-cost",
      name: "Low Cost",
      tagline: "Cheap, large and liquid — the core-holding screen",
      filters: {
        expenseRatio: { kind: "range", min: null, max: 0.15 },
        aum: { kind: "range", min: 1e9, max: null },
      },
      rank: [
        { metric: "expenseRatio", weight: 3 },
        { metric: "aum", weight: 2 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "dividend-etfs",
      name: "Dividend ETFs",
      tagline: "Income without paying up in fees",
      filters: {
        dividendYield: { kind: "range", min: 2.5, max: null },
        expenseRatio: { kind: "range", min: null, max: 0.6 },
        aum: { kind: "range", min: 250e6, max: null },
      },
      rank: [
        { metric: "dividendYield", weight: 3 },
        { metric: "expenseRatio", weight: 2 },
        { metric: "aum", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "thematic",
      name: "Thematic ETFs",
      tagline: "Concentrated single-theme bets — read the top-10 weight carefully",
      filters: {
        style: { kind: "select", value: "Thematic" },
        aum: { kind: "range", min: 100e6, max: null },
      },
      rank: [
        { metric: "oneYearReturn", weight: 3 },
        { metric: "aum", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "country-exposure",
      name: "Country Exposure",
      tagline: "Single-country and regional funds, by cost",
      filters: {
        aum: { kind: "range", min: 100e6, max: null },
        equityWeight: { kind: "range", min: 80, max: null },
      },
      rank: [
        { metric: "expenseRatio", weight: 2 },
        { metric: "aum", weight: 2 },
        { metric: "oneYearReturn", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "sector-exposure",
      name: "Sector Exposure",
      tagline: "Pure sector plays — high top-sector weight, real size",
      filters: {
        topSectorWeight: { kind: "range", min: 60, max: null },
        aum: { kind: "range", min: 100e6, max: null },
      },
      rank: [
        { metric: "topSectorWeight", weight: 2 },
        { metric: "oneYearReturn", weight: 2 },
        { metric: "expenseRatio", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "low-volatility",
      name: "Low Volatility",
      tagline: "Shallow drawdowns, diversified, cheap",
      filters: {
        volatility: { kind: "range", min: null, max: 15 },
        maxDrawdown: { kind: "range", min: -25, max: null },
        aum: { kind: "range", min: 250e6, max: null },
      },
      rank: [
        { metric: "volatility", weight: 3 },
        { metric: "maxDrawdown", weight: 2 },
        { metric: "expenseRatio", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
  ],

  columns: [
    { key: "rankScore", label: "Match", align: "right" },
    { key: "expenseRatio", label: "Expense", align: "right" },
    { key: "aum", label: "AUM", align: "right" },
    { key: "dividendYield", label: "Yield", align: "right" },
    { key: "ytdReturn", label: "YTD", align: "right" },
    { key: "oneYearReturn", label: "1Y", align: "right" },
    { key: "volatility", label: "Vol", align: "right" },
    { key: "top10Concentration", label: "Top-10", align: "right" },
    { key: "region", label: "Region", align: "left" },
    { key: "focus", label: "Focus", align: "left" },
  ],
  defaultSort: { key: "rankScore", dir: "desc" },

  aiPrompt: {
    role: "a fund analyst",
    focus:
      "total cost of ownership, whether size and volume make the fund actually tradeable, hidden concentration in the top holdings, and whether two funds in the list are really the same exposure wearing different tickers",
  },

  chart: { lookbackDays: 365, logScale: false },

  warnings: [
    {
      id: "tiny-fund",
      label: "Small fund — closure and spread risk",
      test: (m) => m.aum != null && m.aum < 50e6,
    },
    {
      id: "expensive",
      label: "High fee for a passive vehicle",
      test: (m) => m.expenseRatio != null && m.expenseRatio > 0.75,
    },
    {
      id: "concentrated",
      label: "Highly concentrated — top 10 hold most of the fund",
      test: (m) => m.top10Concentration != null && m.top10Concentration > 60,
    },
    {
      id: "illiquid",
      label: "Thin volume",
      test: (m) => m.avgVolume != null && m.avgVolume < 50_000,
    },
  ],
};
