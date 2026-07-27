/**
 * Bonds.
 *
 * ── What this screens, and why ────────────────────────────────────────────
 * Individual bonds are not screenable here, and lib/asset-class.ts already
 * says why: there is no free numeric feed for corporate or treasury bond
 * pricing anywhere in UAA's provider set. No CUSIP-level quotes, no per-issue
 * spreads, no call schedules. Building a "bond screener" on top of nothing
 * would mean inventing the data.
 *
 * What *is* real, and is what this class screens, is the fund-level fixed
 * income universe. Yahoo's ETF screener supports a `categoryname` operand, so
 * the bond categories can be paged directly (59 funds in "Intermediate Core
 * Bond" alone), and each fund's `topHoldings` module returns — verified
 * against AGG, TLT and HYG — a real `bondHoldings.duration`, a real
 * `bondHoldings.maturity`, and a full `bondRatings` breakdown across
 * AAA/AA/A/BBB/BB/B/below-B/US-government. That is genuine duration, maturity
 * and credit-quality data, and it is what actually drives a fixed income
 * decision.
 *
 * So: yield, duration, maturity, credit quality, issuer type and expense are
 * all real. Spread is derived against the live Treasury curve (^IRX/^FVX/
 * ^TNX/^TYX, already fetched by lib/macro-analysis.ts) at the fund's own
 * maturity point, which is the correct comparison. Coupon and callable status
 * are security-level attributes that do not survive aggregation into a fund,
 * and are declared unavailable rather than faked.
 */

import type { AssetClassDefinition, MetricDef } from "./types";

/**
 * Morningstar-style categories Yahoo recognises on the `categoryname` operand.
 * This list *is* the bond universe definition — the screener pages each one.
 */
export const BOND_CATEGORIES = [
  "Ultrashort Bond",
  "Short-Term Bond",
  "Short Government",
  "Intermediate Core Bond",
  "Intermediate Core-Plus Bond",
  "Intermediate Government",
  "Long-Term Bond",
  "Long Government",
  "Corporate Bond",
  "High Yield Bond",
  "Bank Loan",
  "Multisector Bond",
  "Nontraditional Bond",
  "Inflation-Protected Bond",
  "Emerging Markets Bond",
  "Global Bond",
  "World Bond-USD Hedged",
  "Muni National Short",
  "Muni National Interm",
  "Muni National Long",
  "High Yield Muni",
] as const;

export const ISSUER_TYPES = [
  "Government",
  "Corporate",
  "High Yield",
  "Municipal",
  "Inflation-Protected",
  "Emerging Markets",
  "Global",
  "Bank Loan",
  "Multisector",
] as const;

export const CREDIT_RATINGS = ["AAA", "AA", "A", "BBB", "BB", "B", "Below B"] as const;

export const RISK_LEVELS = ["Very Low", "Low", "Moderate", "High", "Very High"] as const;

const metrics: MetricDef[] = [
  {
    key: "yield",
    label: "Yield",
    description: "Trailing 12-month distribution yield. Not a yield-to-maturity — a fund has no single maturity.",
    group: "Yield & Spread",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: "higher",
    step: 0.1,
  },
  {
    key: "spread",
    label: "Spread vs Treasury",
    description:
      "Yield pickup over a Treasury of comparable maturity. This is the compensation you are being paid for credit risk — the whole question in fixed income.",
    group: "Yield & Spread",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula:
      "fund yield − the live Treasury yield at the fund's own average maturity, interpolated across ^IRX (13w), ^FVX (5y), ^TNX (10y) and ^TYX (30y)",
    better: "higher",
    step: 0.1,
  },

  {
    key: "duration",
    label: "Duration",
    description:
      "Sensitivity to rates: a duration of 6 means roughly a 6% price fall for a 1% rise in yields. The single most important number in a bond fund.",
    group: "Rate Risk",
    unit: "yrs",
    availability: "live",
    source: "yahoo",
    better: null,
    step: 0.5,
  },
  {
    key: "maturity",
    label: "Avg Maturity",
    description: "Weighted average maturity of the underlying bonds.",
    group: "Rate Risk",
    unit: "yrs",
    availability: "live",
    source: "yahoo",
    better: null,
    step: 0.5,
  },
  {
    key: "rateSensitivity",
    label: "Loss if Rates +1%",
    description: "Approximate price impact of a one-point rise in yields — duration, restated as the money it costs you.",
    group: "Rate Risk",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "−duration (the first-order approximation; ignores convexity)",
    better: "higher",
  },

  {
    key: "investmentGradePct",
    label: "Investment Grade %",
    description: "Share of the portfolio rated BBB or better, including US government paper.",
    group: "Credit",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "sum of the aaa, aa, a, bbb and us_government weights from the fund's bondRatings breakdown",
    better: "higher",
  },
  {
    key: "highYieldPct",
    label: "High Yield %",
    description: "Share rated BB or below — the part of the portfolio that defaults in a recession.",
    group: "Credit",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "sum of the bb, b and below_b weights from bondRatings",
    better: "lower",
  },
  {
    key: "govtPct",
    label: "Government %",
    description: "Share in US government paper — the part that rallies when everything else sells off.",
    group: "Credit",
    unit: "%",
    availability: "live",
    source: "yahoo",
    better: null,
  },
  {
    key: "avgRating",
    label: "Average Credit Rating",
    description: "Weighted average rating of the portfolio.",
    group: "Credit",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "weight-averaged numeric rating across the bondRatings buckets, mapped back to the nearest rating band",
    better: null,
    options: CREDIT_RATINGS,
  },

  {
    key: "issuerType",
    label: "Issuer Type",
    description: "Who is actually borrowing the money.",
    group: "Classification",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "mapped from the fund's Morningstar category (e.g. 'High Yield Bond' → High Yield)",
    better: null,
    options: ISSUER_TYPES,
  },
  {
    key: "riskLevel",
    label: "Risk Level",
    description: "Combined read on rate risk and credit risk — the two ways a bond fund loses money.",
    group: "Classification",
    unit: "",
    availability: "derived",
    source: "yahoo",
    formula: "banded from duration and high-yield share: long duration or heavy sub-investment-grade exposure raises the level",
    better: null,
    options: RISK_LEVELS,
  },

  {
    key: "expenseRatio",
    label: "Expense Ratio",
    description: "Annual fee. On a 4%-yielding fund, 50bp of fee is an eighth of your income.",
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
    description: "Net assets. Entered in billions.",
    group: "Cost & Size",
    unit: "$B",
    availability: "live",
    source: "yahoo",
    better: "higher",
    scale: 1e9,
  },
  {
    key: "oneYearReturn",
    label: "1-Year Return",
    description: "Trailing 12-month price return (excludes distributions).",
    group: "Cost & Size",
    unit: "%",
    availability: "derived",
    source: "yahoo",
    formula: "price change over the trailing 252 sessions",
    better: "higher",
  },

  // Declared-but-unscreenable.
  {
    key: "coupon",
    label: "Coupon",
    description: "The stated interest rate on the bond.",
    group: "Security Detail",
    unit: "%",
    availability: "unavailable",
    source: null,
    requires:
      "A security-level bond feed. Coupon is a property of an individual bond; Yahoo publishes no weighted-average coupon for funds, and averaging it across a portfolio would be a different number than the one people mean. Duration and yield above capture the economics.",
    better: "higher",
  },
  {
    key: "callable",
    label: "Callable",
    description: "Whether the issuer can redeem the bond early.",
    group: "Security Detail",
    unit: "",
    availability: "unavailable",
    source: null,
    requires:
      "Security-level terms (FINRA TRACE, Bloomberg, or an issuer prospectus parser). Callability does not aggregate meaningfully to fund level anyway — a fund is not callable, its holdings are.",
    better: null,
  },
];

export const bondClass: AssetClassDefinition = {
  id: "bond",
  label: "Bonds",
  noun: "bond funds",
  description: "Fixed income via bond funds — real duration, maturity and credit-quality data.",
  icon: "Landmark",
  accent: "slate",
  // Detection-level: these instruments *are* funds (Yahoo quoteType ETF). The
  // registry keeps "bond" as its own screening domain because the questions
  // you ask of a bond fund have nothing in common with those you ask of an
  // equity ETF — but symbol detection correctly resolves them as funds.
  assetClass: "fund",
  taskType: "fund-research",
  markets: ["US"],
  exchanges: ["NYSE Arca", "NASDAQ"],
  identifiers: ["ticker", "isin", "cusip"],
  providers: ["yahoo"],
  aliases: ["bonds", "fixed income", "credit", "treasuries", "bond funds"],
  capabilities: ["screen", "research", "compare", "portfolio", "watchlist", "chart"],

  metrics,
  filterGroups: ["Yield & Spread", "Rate Risk", "Credit", "Classification", "Cost & Size", "Security Detail"],

  rank: [
    { metric: "spread", weight: 2 },
    { metric: "yield", weight: 2 },
    { metric: "expenseRatio", weight: 1 },
  ],

  templates: [
    {
      id: "high-yield",
      name: "High Yield",
      tagline: "Credit risk, taken deliberately and paid for",
      filters: {
        issuerType: { kind: "select", value: "High Yield" },
        aum: { kind: "range", min: 100e6, max: null },
      },
      rank: [
        { metric: "spread", weight: 3 },
        { metric: "yield", weight: 2 },
        { metric: "expenseRatio", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "investment-grade",
      name: "Investment Grade",
      tagline: "BBB and better — income without the default cycle",
      filters: {
        investmentGradePct: { kind: "range", min: 90, max: null },
        aum: { kind: "range", min: 100e6, max: null },
      },
      rank: [
        { metric: "yield", weight: 2 },
        { metric: "investmentGradePct", weight: 2 },
        { metric: "expenseRatio", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "short-duration",
      name: "Short Duration",
      tagline: "Cash-like — barely moves when rates do",
      filters: {
        duration: { kind: "range", min: null, max: 3 },
        investmentGradePct: { kind: "range", min: 80, max: null },
      },
      rank: [
        { metric: "yield", weight: 3 },
        { metric: "expenseRatio", weight: 2 },
        { metric: "investmentGradePct", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "long-duration",
      name: "Long Duration",
      tagline: "Maximum leverage to falling rates — and to rising ones",
      filters: {
        duration: { kind: "range", min: 7, max: null },
      },
      rank: [
        { metric: "duration", weight: 2, direction: "higher" },
        { metric: "yield", weight: 2 },
        { metric: "expenseRatio", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
    {
      id: "income-focused",
      name: "Income Focused",
      tagline: "The most yield per unit of duration and fee",
      filters: {
        yield: { kind: "range", min: 4, max: null },
        expenseRatio: { kind: "range", min: null, max: 0.5 },
        aum: { kind: "range", min: 250e6, max: null },
      },
      rank: [
        { metric: "yield", weight: 3 },
        { metric: "spread", weight: 2 },
        { metric: "expenseRatio", weight: 1 },
      ],
      sort: { key: "rankScore", dir: "desc" },
    },
  ],

  columns: [
    { key: "rankScore", label: "Match", align: "right" },
    { key: "yield", label: "Yield", align: "right" },
    { key: "spread", label: "Spread", align: "right" },
    { key: "duration", label: "Duration", align: "right" },
    { key: "maturity", label: "Maturity", align: "right" },
    { key: "investmentGradePct", label: "IG %", align: "right" },
    { key: "avgRating", label: "Rating", align: "left" },
    { key: "expenseRatio", label: "Expense", align: "right" },
    { key: "aum", label: "AUM", align: "right" },
    { key: "issuerType", label: "Issuer", align: "left" },
  ],
  defaultSort: { key: "rankScore", dir: "desc" },

  aiPrompt: {
    role: "a fixed income analyst",
    focus:
      "whether the spread compensates for the credit risk being taken, how much of the yield is simply duration risk in disguise, and the fact that these are funds rather than individual bonds — so there is no yield-to-maturity or call schedule to speak of",
  },

  chart: { lookbackDays: 730, logScale: false },

  warnings: [
    {
      id: "long-duration",
      label: "Long duration — a 1% rate rise hurts",
      test: (m) => m.duration != null && m.duration > 8,
    },
    {
      id: "junk-heavy",
      label: "Majority sub-investment-grade",
      test: (m) => m.highYieldPct != null && m.highYieldPct > 50,
    },
    {
      id: "thin-spread",
      label: "Thin spread — barely paid for the credit risk",
      test: (m) =>
        m.spread != null && m.spread < 0.5 && m.highYieldPct != null && m.highYieldPct > 20,
    },
    {
      id: "expensive",
      label: "High fee relative to the yield on offer",
      test: (m) =>
        m.expenseRatio != null && m.yield != null && m.yield > 0 && m.expenseRatio / m.yield > 0.15,
    },
  ],
};
