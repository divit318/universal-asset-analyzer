/**
 * Crypto. Yahoo's CRYPTOCURRENCY screener covers ~8,000 pairs and returns
 * market cap, 24h volume and — crucially — `circulatingSupply`, `totalSupply`
 * and `maxSupply`, which is enough to compute fully-diluted valuation and the
 * circulating share of supply for real.
 *
 * What is NOT here, and why it matters: TVL, staking yield, active addresses,
 * developer activity, exchange inflows, whale concentration and token unlock
 * schedules are all on-chain/off-market data. UAA has no on-chain provider
 * wired (no DeFiLlama, CoinGecko, Glassnode or Dune), so all seven are
 * declared `unavailable` with the provider each would need. They are not
 * silently zeroed and they are not filterable — a screener that let you filter
 * on a TVL it cannot see would return an empty table and call it a result.
 *
 * The one honest partial substitute: `mcapToFdv` (circulating market cap over
 * fully-diluted value) is the standard read on *dilution overhang* — a token
 * at 0.2 has 80% of its supply still to be unlocked. That is the economic
 * substance most people actually want from a "token unlocks" filter, and
 * unlike an unlock calendar it is fully derivable from the supply fields Yahoo
 * already returns.
 */

import type { AssetClassDefinition, MetricDef } from "./types";
import { CRYPTO_SECTORS, CRYPTO_SECTORS_AS_OF } from "./reference/crypto-sectors";

const NEEDS_ONCHAIN =
  "An on-chain data provider. None is wired into UAA today — this would need DeFiLlama (TVL), a staking API (yields), or Glassnode/Dune (addresses, flows, holder concentration). Yahoo's crypto feed is market data only.";

const metrics: MetricDef[] = [
  {
    key: "marketCap",
    label: "Market Cap",
    description: "Circulating supply × price. Entered in billions.",
    group: "Valuation",
    unit: "$B",
    availability: "live",
    source: "yahoo",
    better: null,
    scale: 1e9,
  },
  {
    key: "fdv",
    label: "FDV",
    description: "Fully-diluted valuation — what the token is worth if every coin that will ever exist were circulating today.",
    group: "Valuation",
    unit: "$B",
    availability: "derived",
    source: "yahoo",
    formula: "price × (maxSupply, or totalSupply when the token has no hard cap)",
    better: null,
    scale: 1e9,
  },
  {
    key: "mcapToFdv",
    label: "Market Cap / FDV",
    description:
      "Share of the eventual supply that is already circulating. Low values mean heavy future dilution as locked tokens vest — the honest read on unlock overhang.",
    group: "Valuation",
    unit: "x",
    availability: "derived",
    source: "yahoo",
    formula: "marketCap / fdv",
    better: "higher",
    step: 0.05,
  },

  {
    key: "sector",
    label: "Sector",
    description: "Layer 1, DeFi, AI, and so on — from UAA's curated token classification.",
    group: "Classification",
    unit: "",
    availability: "reference",
    source: "platform",
    asOf: CRYPTO_SECTORS_AS_OF,
    better: null,
    options: CRYPTO_SECTORS,
  },

  {
    key: "volume24h",
    label: "24h Volume",
    description: "Dollar volume traded in the last 24 hours. Entered in billions.",
    group: "Liquidity",
    unit: "$B",
    availability: "live",
    source: "yahoo",
    better: "higher",
    scale: 1e9,
  },
  {
    key: "volumeToMcap",
    label: "Volume / Market Cap",
    description: "Turnover. Very low means illiquid; extremely high often means a token is being churned rather than held.",
    group: "Liquidity",
    unit: "x",
    availability: "derived",
    source: "yahoo",
    formula: "volume24h / marketCap",
    better: "higher",
    step: 0.01,
  },

  {
    key: "return90d",
    label: "90-Day Return",
    description: "Price change over the last quarter.",
    group: "Momentum",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "price change over the trailing 90 sessions",
    better: "higher",
  },
  {
    key: "oneYearReturn",
    label: "1-Year Return",
    description: "Trailing 12-month price return.",
    group: "Momentum",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "price change over the trailing 365 days of daily history",
    better: "higher",
  },
  {
    key: "distanceFrom52WkHigh",
    label: "Distance from 52W High",
    description: "How far below the 52-week high the price sits (negative). Crypto routinely runs 70%+ below a cycle high.",
    group: "Momentum",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
  },

  {
    key: "volatility",
    label: "Volatility (ann.)",
    description: "Annualised standard deviation of daily returns.",
    group: "Risk",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "stddev(daily returns) × √365 × 100 (crypto trades every day, so the annualisation factor is 365, not 252)",
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

  // Declared-but-unscreenable — the on-chain dimension.
  {
    key: "tvl",
    label: "TVL",
    description: "Total value locked in the protocol.",
    group: "On-Chain",
    unit: "$B",
    availability: "unavailable",
    source: null,
    requires: NEEDS_ONCHAIN,
    better: "higher",
  },
  {
    key: "stakingYield",
    label: "Staking Yield",
    description: "Annualised reward rate for staking the token.",
    group: "On-Chain",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires: NEEDS_ONCHAIN,
    better: "higher",
  },
  {
    key: "activeAddresses",
    label: "Active Addresses",
    description: "Distinct addresses transacting per day — the closest thing to a user count.",
    group: "On-Chain",
    unit: "",
    availability: "unavailable",
    source: null,
    requires: NEEDS_ONCHAIN,
    better: "higher",
  },
  {
    key: "developerActivity",
    label: "Developer Activity",
    description: "Commit and contributor counts across the protocol's repositories.",
    group: "On-Chain",
    unit: "",
    availability: "unavailable",
    source: null,
    requires:
      "A GitHub-derived developer metric (Electric Capital's dataset, or a direct GitHub API crawl per protocol). Not wired.",
    better: "higher",
  },
  {
    key: "exchangeInflows",
    label: "Exchange Inflows",
    description: "Net token flow onto exchanges — often read as sell-side pressure.",
    group: "On-Chain",
    unit: "$B",
    availability: "unavailable",
    source: null,
    requires: NEEDS_ONCHAIN,
    better: "lower",
  },
  {
    key: "whaleConcentration",
    label: "Whale Concentration",
    description: "Share of supply held by the largest addresses.",
    group: "On-Chain",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires: NEEDS_ONCHAIN,
    better: "lower",
  },
  {
    key: "tokenUnlocks",
    label: "Token Unlocks (90d)",
    description: "Value of tokens vesting into circulation over the next 90 days.",
    group: "On-Chain",
    unit: "$B",
    availability: "unavailable",
    source: null,
    requires:
      "A vesting-schedule feed (TokenUnlocks, CryptoRank). `mcapToFdv` above measures the same economic risk — total dilution still to come — without needing the calendar.",
    better: "lower",
  },
];

export const cryptoClass: AssetClassDefinition = {
  id: "crypto",
  label: "Crypto",
  noun: "tokens",
  description: "Digital assets, ranked on valuation, liquidity, momentum and dilution.",
  icon: "Bitcoin",
  accent: "orange",
  assetClass: "crypto",
  taskType: "crypto-research",
  markets: ["Global"],
  exchanges: ["CCC"],
  identifiers: ["ticker", "pair", "chain"],
  providers: ["yahoo", "platform"],
  aliases: ["crypto", "coins", "tokens", "digital assets", "cryptocurrency"],
  validate: (s) => /-USD$/i.test(s),
  capabilities: ["screen", "research", "compare", "portfolio", "watchlist", "chart", "news"],

  metrics,
  filterGroups: ["Valuation", "Classification", "Liquidity", "Momentum", "Risk", "On-Chain"],

  rank: [
    { metric: "marketCap", weight: 2, direction: "higher" },
    { metric: "volumeToMcap", weight: 1 },
    { metric: "mcapToFdv", weight: 1 },
    { metric: "return90d", weight: 1 },
  ],

  templates: [
    {
      id: "layer-1",
      name: "Layer 1",
      tagline: "Base-layer chains with real liquidity",
      filters: {
        sector: { kind: "select", value: "Layer 1" },
        marketCap: { kind: "range", min: 250e6, max: null },
      },
      rank: [
        { metric: "marketCap", weight: 2, direction: "higher" },
        { metric: "volumeToMcap", weight: 2 },
        { metric: "return90d", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "defi",
      name: "DeFi",
      tagline: "Decentralised finance protocols",
      filters: {
        sector: { kind: "select", value: "DeFi" },
        marketCap: { kind: "range", min: 50e6, max: null },
      },
      rank: [
        { metric: "volumeToMcap", weight: 2 },
        { metric: "mcapToFdv", weight: 2 },
        { metric: "return90d", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "ai-tokens",
      name: "AI Tokens",
      tagline: "Compute, inference and agent networks",
      filters: {
        sector: { kind: "select", value: "AI" },
        marketCap: { kind: "range", min: 25e6, max: null },
      },
      rank: [
        { metric: "return90d", weight: 2 },
        { metric: "marketCap", weight: 2, direction: "higher" },
        { metric: "volumeToMcap", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "high-staking-yield",
      name: "High Staking Yield",
      tagline: "Proof-of-stake chains — ranked on liquidity and dilution, not yield",
      // Deliberately does NOT filter on stakingYield: we have no staking feed
      // (see the metric's `requires`). Filtering on a metric that is null for
      // every row would return nothing at all. This screens the proof-of-stake
      // sectors where staking is the norm and ranks them on what we can see,
      // and the UI flags the missing yield column rather than inventing it.
      filters: {
        sector: { kind: "multiselect", values: ["Layer 1", "Layer 2"] },
        marketCap: { kind: "range", min: 100e6, max: null },
      },
      rank: [
        { metric: "mcapToFdv", weight: 2 },
        { metric: "marketCap", weight: 2, direction: "higher" },
        { metric: "volatility", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "undervalued",
      name: "Undervalued",
      tagline: "Most of the supply already circulating, well off the highs, still liquid",
      filters: {
        mcapToFdv: { kind: "range", min: 0.7, max: null },
        distanceFrom52WkHigh: { kind: "range", min: null, max: -35 },
        volume24h: { kind: "range", min: 10e6, max: null },
      },
      rank: [
        { metric: "mcapToFdv", weight: 2 },
        { metric: "volumeToMcap", weight: 2 },
        { metric: "marketCap", weight: 1, direction: "higher" },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "high-growth",
      name: "High Growth",
      tagline: "Strongest 90-day momentum with liquidity to back it",
      filters: {
        return90d: { kind: "range", min: 25, max: null },
        volume24h: { kind: "range", min: 25e6, max: null },
      },
      rank: [
        { metric: "return90d", weight: 3 },
        { metric: "volumeToMcap", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
  ],

  columns: [
    { key: "rankScore", label: "Match", align: "right" },
    { key: "marketCap", label: "Mkt Cap", align: "right" },
    { key: "fdv", label: "FDV", align: "right" },
    { key: "mcapToFdv", label: "MC/FDV", align: "right" },
    { key: "volume24h", label: "24h Vol", align: "right" },
    { key: "return90d", label: "90D", align: "right" },
    { key: "oneYearReturn", label: "1Y", align: "right" },
    { key: "volatility", label: "Vol", align: "right" },
    { key: "sector", label: "Sector", align: "left" },
  ],
  defaultSort: { key: "rankScore", dir: "desc" },

  aiPrompt: {
    role: "a digital-asset analyst",
    focus:
      "dilution overhang from locked supply, whether volume is real liquidity or wash-traded churn, and the fact that no on-chain fundamentals (TVL, users, staking) are available to this screen — say so rather than inferring them",
  },

  chart: { lookbackDays: 730, logScale: true },

  warnings: [
    {
      id: "heavy-dilution",
      label: "Heavy dilution ahead — most supply is still locked",
      test: (m) => m.mcapToFdv != null && m.mcapToFdv < 0.4,
    },
    {
      id: "illiquid",
      label: "Thin liquidity relative to size",
      test: (m) => m.volumeToMcap != null && m.volumeToMcap < 0.01,
    },
    {
      id: "extreme-volatility",
      label: "Extreme volatility",
      test: (m) => m.volatility != null && m.volatility > 120,
    },
    {
      id: "stablecoin",
      label: "Stablecoin — price momentum is not a signal here",
      test: (_m, a) => a.sector === "Stablecoin",
    },
    {
      id: "unclassified",
      label: "Not in UAA's token classification — treat sector as unknown",
      test: (_m, a) => a.sector === "Other",
    },
  ],
};
