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

/**
 * Vehicle types. `Plain` is the overwhelming majority and the thing most screens
 * want; the rest exist so they can be excluded on purpose.
 */
export const ETF_STRUCTURES = [
  "Plain",
  "Leveraged",
  "Inverse",
  "Leveraged Inverse",
  "Covered Call",
  "Buffered",
  "Currency Hedged",
] as const;

/**
 * Issuers, canonicalised. These are the *normalised* names produced by
 * `fundIssuer()` in lib/screener/universes/etf.ts, not the raw
 * `fundProfile.family` strings — Yahoo's own spellings ("State Street Investment
 * Management", "Dimensional Fund Advisors") would make a filter that matches
 * nothing. Ordered by real prevalence in the live universe.
 */
export const ETF_ISSUERS = [
  "iShares / BlackRock",
  "Vanguard",
  "State Street",
  "Invesco",
  "First Trust",
  "Dimensional",
  "JPMorgan",
  "Schwab",
  "Fidelity",
  "Global X",
  "Capital Group",
  "Avantis",
  "VanEck",
  "WisdomTree",
  "Franklin Templeton",
  "ProShares",
  "Goldman Sachs",
  "Direxion",
  "Pacer",
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

  /* ---------------------------------------------------------------------- */
  /* Liquidity — the group that decides whether a screen result is usable    */
  /* ---------------------------------------------------------------------- */
  {
    key: "dollarVolume",
    label: "Dollar Volume",
    description:
      "3-month average daily traded value. The practical size limit on a position — share volume alone can't tell you whether a fund trades $2M or $2B a day.",
    group: "Liquidity",
    unit: "$B",
    availability: "derived",
    source: "yahoo",
    formula: "regularMarketPrice × averageDailyVolume3Month",
    better: "higher",
    scale: 1e9,
  },
  {
    key: "liquidityTrend",
    label: "Volume Trend (10d/3m)",
    description:
      "Recent volume against its own 3-month average. Below ~0.5 means interest is draining out of the fund, which tends to precede a closure; above 1.5 means something is happening.",
    group: "Liquidity",
    unit: "x",
    availability: "derived",
    source: "yahoo",
    formula: "averageDailyVolume10Day ÷ averageDailyVolume3Month",
    better: null,
    step: 0.1,
  },

  /* ---------------------------------------------------------------------- */
  /* Structure — the wrapper, not the exposure                               */
  /* ---------------------------------------------------------------------- */
  {
    key: "structure",
    label: "Structure",
    description:
      "The kind of vehicle. Leveraged and inverse funds reset daily and decay along the path, so they are not aggressive versions of the same exposure; covered-call funds pay option premium, not dividends. Exclude them explicitly rather than ranking them alongside plain funds.",
    group: "Structure",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "matched from fundProfile.categoryName + the fund's own name",
    better: null,
    options: ETF_STRUCTURES,
  },
  {
    key: "issuer",
    label: "Issuer",
    description:
      "Fund family. Stands in for the issuer-quality checks an institution runs before allocating: platform scale, product longevity, closure history.",
    group: "Structure",
    unit: "",
    availability: "live",
    source: "yahoo",
    better: null,
    options: ETF_ISSUERS,
  },
  {
    key: "fundAge",
    label: "Fund Age",
    description:
      "Years since first trade. A fund younger than a cycle has no through-cycle behaviour to evaluate, and young small funds are the ones that get closed.",
    group: "Structure",
    unit: "yrs",
    availability: "derived",
    source: "yahoo",
    formula: "now − firstTradeDateMilliseconds",
    better: "higher",
    step: 1,
  },

  /* ---------------------------------------------------------------------- */
  /* Look-through — screening a fund by what it actually holds               */
  /* ---------------------------------------------------------------------- */
  {
    key: "lookThroughPE",
    label: "Holdings P/E",
    description:
      "The weighted trailing P/E of the fund's underlying holdings — valuation of the portfolio rather than of the wrapper. Lets you ask 'which of these index funds is actually cheap right now', which cost and AUM cannot answer.",
    group: "Look-Through",
    unit: "x",
    availability: "live",
    source: "yahoo",
    better: "lower",
    step: 1,
  },
  {
    key: "effectiveSectors",
    label: "Effective Sectors",
    description:
      "Inverse-Herfindahl count of sector weights: how many sectors the fund is *effectively* spread across. Two funds can both hold 11 sectors while one is 80% technology — this separates them.",
    group: "Look-Through",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "1 ÷ Σ(sector weight²) over the topHoldings sectorWeightings",
    better: "higher",
    step: 0.5,
  },
  {
    key: "cashWeight",
    label: "Cash Weight",
    description:
      "Share of the portfolio sitting in cash. Cash drag in an equity fund; collateral in a futures-backed one — read it alongside Structure.",
    group: "Look-Through",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: null,
    step: 1,
  },
  {
    key: "bondWeight",
    label: "Bond Weight",
    description:
      "Share of the portfolio in fixed income. Non-zero here in an equity-classified fund means it is really an allocation product.",
    group: "Look-Through",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: null,
    step: 1,
  },
  {
    key: "threeMonthReturn",
    label: "3-Month Return",
    description: "Trailing three-month total return — the medium-term leg between YTD and 1-year.",
    group: "Income & Return",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
  },
  {
    key: "distanceFrom52WkHigh",
    label: "From 52wk High",
    description:
      "How far below its 52-week high the fund trades, as a negative percentage. Where in its own range you'd be buying.",
    group: "Risk",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "(price − fiftyTwoWeekHigh) ÷ fiftyTwoWeekHigh × 100",
    better: "higher",
  },

  // Declared-but-unscreenable.
  {
    key: "fundFlowDerived",
    label: "Fund Flow (derived)",
    description:
      "Net creations minus redemptions, the standard way: change in shares outstanding × NAV.",
    group: "Cost & Size",
    unit: "$B",
    availability: "unavailable",
    source: null,
    requires:
      "Yahoo's screener row carries `sharesOutstanding` for only ~33% of US ETFs (measured across a live 250-fund page), and the construction needs two observations of it. Storing a shares-outstanding snapshot per universe build would make this real for the covered third after two builds; shipping it today would mean a filter that silently deletes two-thirds of the universe.",
    better: "higher",
  },
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

  /** "Cheap for a bank" ≠ "cheap for a software company" — focus is the fair comparison. */
  peerGroupBy: "focus",

  metrics,
  filterGroups: [
    "Cost & Size",
    "Liquidity",
    "Income & Return",
    "Risk",
    "Exposure",
    "Look-Through",
    "Structure",
  ],

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
      /**
       * The `region` filter is what makes this template its own screen.
       *
       * Without it — size and equity weight alone — it matched 413 of the 456
       * funds in the universe, 311 of them US, i.e. it returned the broad US
       * market under a "single-country and regional" heading. Naming every
       * non-US region is deliberate rather than excluding "US", because `region`
       * is null for funds whose category carries no geography and an exclusion
       * would silently sweep those in too.
       */
      filters: {
        region: {
          kind: "multiselect",
          values: [
            "Global",
            "Developed ex-US",
            "Emerging Markets",
            "Europe",
            "Japan",
            "China",
            "India",
            "Latin America",
          ],
        },
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
      /**
       * `equityWeight` is a floor, not decoration. Ranking on volatility means
       * whatever holds the least equity wins, so this screen filled up with
       * things that are quiet for reasons that have nothing to do with being a
       * good low-volatility fund: money-market funds and bond ladders (now
       * excluded from the class outright), and then variable-rate preferred
       * (VRP, 2.9% vol) and 60/40 allocation funds (AOR), which are legitimate
       * ETFs but are not low-volatility *equity* exposure. An 80% floor keeps
       * the comparison between funds that hold the same kind of asset.
       */
      filters: {
        volatility: { kind: "range", min: null, max: 15 },
        maxDrawdown: { kind: "range", min: -25, max: null },
        aum: { kind: "range", min: 250e6, max: null },
        equityWeight: { kind: "range", min: 80, max: null },
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
