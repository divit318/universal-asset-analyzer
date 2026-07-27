/**
 * Commodities. Universe is the curated front-month contract list in
 * ./reference/commodities.ts; price, history and the dated contracts behind
 * the futures curve all come from Yahoo.
 *
 * The one genuinely novel piece of data here is the curve. Yahoo quotes dated
 * contracts (CLQ26.NYM, CLU26.NYM, …), so fetching the next several expiries
 * for a root and regressing price against time to expiry gives the real slope:
 * a positive slope is contango (later delivery costs more — a roll *cost* for
 * a long), a negative slope is backwardation (a roll *yield*). That is a first-
 * class input for a commodity screen and it is computed, not asserted.
 *
 * Seasonality is likewise real and derived: with several years of daily
 * history we can measure how this contract has actually behaved in the current
 * calendar month, historically.
 *
 * Inventories and the supply/demand balance are the notable gap — those live
 * with the EIA (energy), USDA (ags) and LME/WBMS (metals), none of which is
 * wired. They are declared unavailable rather than guessed.
 */

import type { AssetClassDefinition, MetricDef } from "./types";
import { COMMODITIES_AS_OF, COMMODITY_SECTORS } from "./reference/commodities";

const metrics: MetricDef[] = [
  {
    key: "price",
    label: "Front-Month Price",
    description: "Price of the nearest futures contract. Not a spot price — commodities have no single spot.",
    group: "Price & Trend",
    unit: "$",
    availability: "live",
    source: "yahoo",
    better: null,
  },
  {
    key: "sector",
    label: "Sector",
    description: "Energy, metals, agriculture, livestock or softs.",
    group: "Price & Trend",
    unit: "",
    availability: "reference",
    source: "platform",
    asOf: COMMODITIES_AS_OF,
    better: null,
    options: COMMODITY_SECTORS,
  },
  {
    key: "return1m",
    label: "1-Month Return",
    description: "Price change over the last month.",
    group: "Price & Trend",
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
    group: "Price & Trend",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "price change over the trailing 252 sessions",
    better: "higher",
  },
  {
    key: "trendScore",
    label: "Trend Score",
    description:
      "Where price sits relative to its own moving averages. 100 = above both the 50- and 200-day and the 50 is above the 200 (a clean uptrend); 0 = the mirror image.",
    group: "Price & Trend",
    unit: "score",
    availability: "derived",
    source: "yahoo",
    formula: "50 × (price > 50dma) + 30 × (price > 200dma) + 20 × (50dma > 200dma)",
    better: "higher",
  },
  {
    key: "distanceFrom52WkHigh",
    label: "Distance from 52W High",
    description: "How far below the 52-week high the price sits (negative).",
    group: "Price & Trend",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
  },

  {
    key: "curveSlope",
    label: "Curve Slope (annualised)",
    description:
      "Slope of the futures curve. Positive = contango, and holding a long position bleeds on every roll. Negative = backwardation, and the roll pays you.",
    group: "Futures Curve",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula:
      "(far contract price / front contract price − 1) annualised by the months between their expiries, using dated contracts fetched from the contract root",
    better: "lower",
    step: 0.5,
  },
  {
    key: "rollYield",
    label: "Roll Yield (annualised)",
    description: "What the curve pays (or costs) a long position each year, before any price move. The inverse of curve slope.",
    group: "Futures Curve",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "−curveSlope",
    better: "higher",
    step: 0.5,
  },

  {
    key: "seasonalityScore",
    label: "Seasonality (this month)",
    description:
      "How this contract has historically performed in the current calendar month, as a percentile against its other months. 100 = this is its strongest month.",
    group: "Seasonality",
    unit: "score",
    availability: "derived",
    source: "yahoo",
    formula:
      "mean return in the current calendar month across all years of available daily history, ranked against the same statistic for the other eleven months",
    better: "higher",
  },
  {
    key: "seasonalAvgReturn",
    label: "Avg Return (this month, history)",
    description: "The mean return this contract has produced in the current calendar month across the years we have history for.",
    group: "Seasonality",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "mean of the per-year returns for the current calendar month",
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
    formula: "stddev(daily returns) × √252 × 100",
    better: "lower",
  },
  {
    key: "geopoliticalExposure",
    label: "Geopolitical Exposure",
    description: "Whether supply is concentrated in fragile regions. A structural property of where the commodity is produced.",
    group: "Risk",
    unit: "",
    availability: "reference",
    source: "platform",
    asOf: COMMODITIES_AS_OF,
    better: null,
    options: ["Low", "Medium", "High"],
  },

  // Declared-but-unscreenable.
  {
    key: "inventoryLevel",
    label: "Inventory Level",
    description: "Stocks on hand versus the five-year average.",
    group: "Supply & Demand",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires:
      "An inventories feed: EIA weekly petroleum/gas stocks, USDA WASDE for ags, LME/WBMS for metals. None is wired into UAA. The futures curve above is the market's own read on tightness and is the best available substitute — deep backwardation usually means physically tight inventories.",
    better: null,
  },
  {
    key: "supplyDemandBalance",
    label: "Supply / Demand Balance",
    description: "Projected surplus or deficit for the current season.",
    group: "Supply & Demand",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires: "The same agency balance sheets as inventories (WASDE, EIA STEO, IEA OMR). Not wired.",
    better: null,
  },
];

export const commodityClass: AssetClassDefinition = {
  id: "commodity",
  label: "Commodities",
  noun: "contracts",
  description: "Futures on energy, metals and agriculture — trend, curve and seasonality.",
  icon: "Flame",
  accent: "rose",
  assetClass: "commodity",
  taskType: "commodity-research",
  markets: ["US"],
  exchanges: ["NYMEX", "COMEX", "CBOT", "CME", "ICE"],
  identifiers: ["ticker", "contract"],
  providers: ["yahoo", "platform"],
  aliases: ["commodities", "futures", "oil", "gold", "metals", "grains"],
  validate: (s) => /=F$/i.test(s),
  capabilities: ["screen", "research", "compare", "watchlist", "chart", "news"],

  metrics,
  filterGroups: ["Price & Trend", "Futures Curve", "Seasonality", "Risk", "Supply & Demand"],

  rank: [
    { metric: "trendScore", weight: 2 },
    { metric: "rollYield", weight: 2 },
    { metric: "return1m", weight: 1 },
  ],

  templates: [
    {
      id: "trend-following",
      name: "Trend Following",
      tagline: "Above both moving averages, with the curve not fighting you",
      filters: {
        trendScore: { kind: "range", min: 70, max: null },
        return1m: { kind: "range", min: 0, max: null },
      },
      rank: [
        { metric: "trendScore", weight: 3 },
        { metric: "return1m", weight: 2 },
        { metric: "rollYield", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "inflation-hedge",
      name: "Inflation Hedge",
      tagline: "Energy and metals in backwardation — the classic real-asset hedge",
      filters: {
        sector: { kind: "multiselect", values: ["Energy", "Precious Metals", "Industrial Metals"] },
        rollYield: { kind: "range", min: 0, max: null },
      },
      rank: [
        { metric: "rollYield", weight: 3 },
        { metric: "trendScore", weight: 2 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "energy",
      name: "Energy",
      tagline: "Crude, gas and refined products",
      filters: { sector: { kind: "select", value: "Energy" } },
      rank: [
        { metric: "rollYield", weight: 2 },
        { metric: "trendScore", weight: 2 },
        { metric: "seasonalityScore", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "precious-metals",
      name: "Precious Metals",
      tagline: "Gold, silver, platinum, palladium",
      filters: { sector: { kind: "select", value: "Precious Metals" } },
      rank: [
        { metric: "trendScore", weight: 2 },
        { metric: "return1y", weight: 2 },
        { metric: "volatility", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "agricultural",
      name: "Agricultural",
      tagline: "Grains, softs and livestock — where seasonality actually bites",
      filters: {
        sector: { kind: "multiselect", values: ["Agriculture", "Livestock", "Softs"] },
      },
      rank: [
        { metric: "seasonalityScore", weight: 3 },
        { metric: "trendScore", weight: 2 },
        { metric: "rollYield", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
  ],

  columns: [
    { key: "rankScore", label: "Match", align: "right" },
    { key: "price", label: "Price", align: "right" },
    { key: "return1m", label: "1M", align: "right" },
    { key: "return1y", label: "1Y", align: "right" },
    { key: "trendScore", label: "Trend", align: "right" },
    { key: "rollYield", label: "Roll Yld", align: "right" },
    { key: "seasonalityScore", label: "Season", align: "right" },
    { key: "volatility", label: "Vol", align: "right" },
    { key: "sector", label: "Sector", align: "left" },
  ],
  defaultSort: { key: "rankScore", dir: "desc" },

  aiPrompt: {
    role: "a commodities strategist",
    focus:
      "the shape of the futures curve and what it implies about physical tightness, the roll cost of actually holding the position, seasonality, and the fact that no inventory data is available to this screen",
  },

  chart: { lookbackDays: 730, logScale: false },

  warnings: [
    {
      id: "contango",
      label: "In contango — rolling a long position costs you",
      test: (m) => m.curveSlope != null && m.curveSlope > 3,
    },
    {
      id: "steep-contango",
      label: "Steep contango — the roll will eat a large part of any gain",
      test: (m) => m.curveSlope != null && m.curveSlope > 10,
    },
    {
      id: "high-geopolitical",
      label: "Supply concentrated in geopolitically fragile regions",
      test: (_m, a) => a.geopoliticalExposure === "High",
    },
    {
      id: "weak-seasonal",
      label: "Historically a weak month for this contract",
      test: (m) => m.seasonalityScore != null && m.seasonalityScore < 25,
    },
    {
      id: "extreme-volatility",
      label: "Extreme volatility",
      test: (m) => m.volatility != null && m.volatility > 60,
    },
  ],
};
