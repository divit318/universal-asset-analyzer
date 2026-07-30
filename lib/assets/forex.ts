/**
 * Forex. The universe is the 36-pair curated list in ./reference/policy-rates.ts
 * — not a screener result. Yahoo's CURRENCY quoteType returns *zero* rows from
 * the screener endpoint (verified), so there is no universe to page through;
 * but individual pair quotes (EURUSD=X) and their history work fine, and the
 * tradeable FX universe is small enough that enumerating it is the right call
 * anyway.
 *
 * Price, trend and volatility are live/derived from Yahoo. Everything
 * fundamental — rate differential, carry, inflation differential, central bank
 * stance — comes from the shipped policy-rate table and is marked `reference`
 * with an as-of date. Read the warning at the top of that file: those numbers
 * are maintained by hand, not fetched.
 */

import type { AssetClassDefinition, MetricDef } from "./types";
import { PAIR_TYPES, POLICY_RATES_AS_OF } from "./reference/policy-rates";

const metrics: MetricDef[] = [
  {
    key: "pairType",
    label: "Pair Type",
    description: "Major, minor or exotic. Drives spread, liquidity and how violently the pair gaps.",
    group: "Pair",
    unit: "",
    availability: "reference",
    source: "platform",
    asOf: POLICY_RATES_AS_OF,
    better: null,
    options: PAIR_TYPES,
  },
  {
    key: "liquidityTier",
    label: "Liquidity Tier",
    description: "1 = deepest (majors), 3 = thinnest (exotics). Stands in for spread data, which Yahoo does not publish for FX.",
    group: "Pair",
    unit: "",
    availability: "reference",
    source: "platform",
    asOf: POLICY_RATES_AS_OF,
    better: "lower",
    step: 1,
  },

  {
    key: "rateDifferential",
    label: "Interest Rate Differential",
    description:
      "Base currency's policy rate minus the quote currency's. This is the carry you earn (or pay) for holding the pair long.",
    group: "Carry & Policy",
    unit: "%",
    availability: "reference",
    source: "platform",
    asOf: POLICY_RATES_AS_OF,
    better: "higher",
    step: 0.25,
  },
  {
    key: "realRateDifferential",
    label: "Real Rate Differential",
    description: "The rate differential after inflation — the version that actually anchors currencies over long horizons.",
    group: "Carry & Policy",
    unit: "%",
    availability: "derived",
    source: "platform",
    formula: "(base policy rate − base CPI) − (quote policy rate − quote CPI), from the shipped policy-rate table",
    better: "higher",
    step: 0.25,
  },
  {
    key: "inflationDifferential",
    label: "Inflation Differential",
    description: "Base CPI minus quote CPI. Persistent positive values erode the base currency.",
    group: "Carry & Policy",
    unit: "%",
    availability: "reference",
    source: "platform",
    asOf: POLICY_RATES_AS_OF,
    better: "lower",
    step: 0.1,
  },
  {
    key: "policyDivergence",
    label: "Central Bank Divergence",
    description:
      "+2 when the base bank is hiking while the quote bank cuts (the strongest fundamental tailwind a pair can have); −2 for the reverse.",
    group: "Carry & Policy",
    unit: "",
    availability: "derived",
    source: "platform",
    formula: "stance(base) − stance(quote), scoring Hiking=+1, Holding=0, Cutting=−1",
    better: "higher",
    step: 1,
  },
  {
    key: "carryToVol",
    label: "Carry / Volatility",
    description:
      "Rate differential divided by annualised volatility — the risk-adjusted carry, and the metric that separates a real carry trade from picking up pennies in front of a steamroller.",
    group: "Carry & Policy",
    unit: "x",
    availability: "derived",
    source: "platform",
    formula: "rateDifferential / volatility",
    better: "higher",
    step: 0.05,
  },

  {
    key: "trendScore",
    label: "Trend Score",
    description: "Where price sits relative to its 50- and 200-day moving averages. 100 = clean uptrend, 0 = clean downtrend.",
    group: "Trend",
    unit: "score",
    availability: "derived",
    source: "yahoo",
    formula: "50 × (price > 50dma) + 30 × (price > 200dma) + 20 × (50dma > 200dma)",
    better: "higher",
  },
  {
    key: "return1m",
    label: "1-Month Return",
    description: "Price change over the last month.",
    group: "Trend",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "price change over the trailing 21 sessions",
    better: "higher",
  },
  {
    key: "return1y",
    label: "1-Year Return",
    description: "Trailing 12-month price change.",
    group: "Trend",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "price change over the trailing 252 sessions",
    better: "higher",
  },
  {
    key: "distanceFrom52WkHigh",
    label: "Distance from 52W High",
    description: "How far below the 52-week high the pair sits (negative).",
    group: "Trend",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
  },

  {
    key: "volatility",
    label: "Volatility (ann.)",
    description: "Annualised standard deviation of daily returns. Majors typically run 6-10%; exotics far higher.",
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
];

export const forexClass: AssetClassDefinition = {
  id: "forex",
  label: "Forex",
  noun: "pairs",
  description: "Currency pairs, ranked on carry, policy divergence and trend.",
  icon: "ArrowLeftRight",
  accent: "emerald",
  assetClass: "forex",
  taskType: "forex-research",
  markets: ["Global"],
  exchanges: ["OTC"],
  identifiers: ["pair"],
  providers: ["yahoo", "platform"],
  aliases: ["forex", "fx", "currencies", "currency pairs"],
  validate: (s) => /=X$/i.test(s),
  capabilities: ["screen", "research", "compare", "watchlist", "chart", "news"],

  metrics,
  filterGroups: ["Pair", "Carry & Policy", "Trend", "Risk"],

  rank: [
    { metric: "carryToVol", weight: 2 },
    { metric: "policyDivergence", weight: 2 },
    { metric: "trendScore", weight: 1 },
  ],

  templates: [
    {
      id: "major-pairs",
      name: "Major Pairs",
      tagline: "The seven deepest, tightest-spread pairs",
      filters: { pairType: { kind: "select", value: "Major" } },
      rank: [
        { metric: "trendScore", weight: 2 },
        { metric: "carryToVol", weight: 2 },
        { metric: "policyDivergence", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "high-carry",
      name: "High Carry",
      tagline: "Positive rate differential, and enough liquidity to actually hold it",
      filters: {
        rateDifferential: { kind: "range", min: 1.5, max: null },
        liquidityTier: { kind: "range", min: null, max: 2 },
      },
      rank: [
        { metric: "carryToVol", weight: 3 },
        { metric: "rateDifferential", weight: 2 },
        { metric: "realRateDifferential", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "low-volatility",
      name: "Low Volatility",
      tagline: "The quiet pairs — for size, not for thrills",
      filters: {
        volatility: { kind: "range", min: null, max: 9 },
        pairType: { kind: "multiselect", values: ["Major", "Minor"] },
      },
      rank: [
        { metric: "volatility", weight: 3 },
        { metric: "carryToVol", weight: 2 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "trend-following",
      name: "Trend Following",
      tagline: "Trending with the central banks pushing in the same direction",
      filters: {
        trendScore: { kind: "range", min: 70, max: null },
        policyDivergence: { kind: "range", min: 1, max: null },
      },
      rank: [
        { metric: "trendScore", weight: 3 },
        { metric: "policyDivergence", weight: 2 },
        { metric: "return1m", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
  ],

  columns: [
    { key: "rankScore", label: "Match", align: "right" },
    { key: "price", label: "Price", align: "right" },
    { key: "rateDifferential", label: "Carry", align: "right" },
    { key: "carryToVol", label: "Carry/Vol", align: "right" },
    { key: "policyDivergence", label: "CB Div", align: "right" },
    { key: "trendScore", label: "Trend", align: "right" },
    { key: "return1y", label: "1Y", align: "right" },
    { key: "volatility", label: "Vol", align: "right" },
    { key: "pairType", label: "Type", align: "left" },
  ],
  defaultSort: { key: "rankScore", dir: "desc" },

  aiPrompt: {
    role: "an FX strategist",
    focus:
      "whether the carry is being paid for taking real risk (check carry ÷ volatility, not the headline differential), whether central bank divergence supports the trend or fights it, and the fact that the rate table is a static reference that may be out of date",
  },

  chart: { lookbackDays: 730, logScale: false },

  warnings: [
    {
      id: "negative-carry",
      label: "Negative carry — holding this long costs you",
      test: (m) => m.rateDifferential != null && m.rateDifferential < -1,
    },
    {
      id: "carry-trap",
      label: "High carry, high volatility — classic carry trap",
      test: (m) =>
        m.rateDifferential != null && m.rateDifferential > 4 && m.volatility != null && m.volatility > 14,
    },
    {
      id: "exotic",
      label: "Exotic pair — wide spreads and gap risk",
      test: (_m, a) => a.pairType === "Exotic",
    },
    {
      id: "policy-against",
      label: "Central bank divergence works against the pair",
      test: (m) => m.policyDivergence != null && m.policyDivergence < 0,
    },
  ],
};
