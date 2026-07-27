import type { AssetClassId } from "@/lib/assets/types";
import type { ClassCompareEntry } from "@/lib/compare/types";
import { formatCompact } from "@/lib/format";
import { getMetric } from "@/lib/assets/registry";

/**
 * The metric-table definitions for every non-equity Compare framework —
 * the direct implementation of the approved comparison-framework spec's
 * per-class sections, at the same shape and depth as equity's own SECTIONS
 * (app/compare/page.tsx). Kept as pure data so the metric table renderer
 * is registry-driven instead of branching per asset class.
 */
export interface ClassMetricDef {
  label: string;
  sub?: string;
  /** Numeric metric key (entry.metrics) or, for categorical rows, an attribute key prefixed "attr:". */
  key: string;
  format: (v: number) => string;
  /** null = categorical / no direction (shown, never ranked best/worst). */
  higherBetter: boolean | null;
  /** One line, revealed on row hover — resolved from the registry's own MetricDef.description (see classSections()), never hand-duplicated here. */
  description?: string;
  /**
   * Set when the registry declares this metric `availability: "unavailable"`
   * (lib/assets/*.ts) — no provider is wired up for it yet. Rendered as an
   * honest "not available" row with this reason, never a fabricated number.
   * The metric is still listed, per the registry's own "declared but
   * unscreenable" philosophy: an honest gap, not a silently dropped feature.
   */
  unavailableReason?: string;
}

export interface ClassSectionDef {
  title: string;
  metrics: ClassMetricDef[];
}

const pctSigned = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const pctAbs = (v: number) => `${v.toFixed(1)}%`;
const xRatio = (v: number) => `${v.toFixed(1)}x`;
const yrs = (v: number) => `${v.toFixed(1)}y`;
const usd = (v: number) => formatCompact(v);
const price = (v: number) => `$${v.toFixed(2)}`;
const score100 = (v: number) => `${Math.round(v)}`;
const tier = (v: number) => (v === 1 ? "1 · Deepest" : v === 2 ? "2 · Moderate" : v === 3 ? "3 · Thinnest" : `${v}`);

/** Resolves each metric's hover description from the registry (lib/assets/*.ts), so class-sections.ts never hand-duplicates the ~60 descriptions already written there. Composite-score rows ("score:x") have no registry entry and are simply left without one. */
export function classSections(assetClass: AssetClassId): ClassSectionDef[] {
  return rawClassSections(assetClass).map((section) => ({
    ...section,
    metrics: section.metrics.map((metric) => {
      if (metric.description || metric.unavailableReason) return metric;
      const registryKey = metric.key.startsWith("attr:") ? metric.key.slice(5) : metric.key.startsWith("score:") ? null : metric.key;
      const description = registryKey ? getMetric(assetClass, registryKey)?.description : undefined;
      return description ? { ...metric, description } : metric;
    }),
  }));
}

function rawClassSections(assetClass: AssetClassId): ClassSectionDef[] {
  switch (assetClass) {
    case "etf":
      return [
        {
          title: "Cost & Size",
          metrics: [
            { label: "Expense Ratio", sub: "lower = cheaper", key: "expenseRatio", format: pctAbs, higherBetter: false },
            { label: "AUM", key: "aum", format: usd, higherBetter: true },
            { label: "Avg Daily Volume", key: "avgVolume", format: (v) => v.toLocaleString("en-US"), higherBetter: true },
            {
              label: "Fund Flow (3M)",
              sub: "net creations − redemptions",
              key: "fundFlow",
              format: usd,
              higherBetter: true,
              unavailableReason: "Needs a creations/redemptions feed (issuer flow files or a vendor like ETF.com/Morningstar) — not derivable from price and AUM alone, since AUM moves with the market too.",
            },
          ],
        },
        {
          title: "Income & Return",
          metrics: [
            { label: "Dividend Yield", key: "dividendYield", format: pctAbs, higherBetter: true },
            { label: "YTD Return", key: "ytdReturn", format: pctSigned, higherBetter: true },
            { label: "1-Year Return", key: "oneYearReturn", format: pctSigned, higherBetter: true },
          ],
        },
        {
          title: "Risk & Concentration",
          metrics: [
            { label: "Volatility (ann.)", key: "volatility", format: pctAbs, higherBetter: false },
            { label: "Max Drawdown", key: "maxDrawdown", format: pctSigned, higherBetter: true },
            { label: "Top-10 Concentration", key: "top10Concentration", format: pctAbs, higherBetter: false },
            { label: "Top Sector Weight", key: "topSectorWeight", format: pctAbs, higherBetter: false },
            {
              label: "Tracking Error",
              sub: "stdev of fund − benchmark return",
              key: "trackingError",
              format: pctAbs,
              higherBetter: false,
              unavailableReason: "Needs the fund's benchmark index identity plus that index's daily NAV series — Yahoo exposes neither. Requires a fund-data vendor (Morningstar/FactSet) or the issuer's own index feed.",
            },
          ],
        },
        {
          title: "Exposure",
          metrics: [
            { label: "Region", key: "attr:region", format: (v) => String(v), higherBetter: null },
            { label: "Sector Focus", key: "attr:focus", format: (v) => String(v), higherBetter: null },
            { label: "Style", key: "attr:style", format: (v) => String(v), higherBetter: null },
            { label: "Equity Weight", key: "equityWeight", format: pctAbs, higherBetter: null },
            {
              label: "Country Exposure",
              sub: "precise country-level weights",
              key: "countryExposure",
              format: pctAbs,
              higherBetter: null,
              unavailableReason: "Needs holding-level domicile data. Yahoo's topHoldings gives sector weights but no country breakdown — Region above is the honest approximation available today.",
            },
          ],
        },
      ];

    case "reit":
      return [
        {
          title: "Size & Classification",
          metrics: [
            { label: "Market Cap", key: "marketCap", format: usd, higherBetter: null },
            { label: "Property Type", key: "attr:propertyType", format: (v) => String(v), higherBetter: null },
          ],
        },
        {
          title: "Valuation",
          metrics: [
            { label: "P/FFO", sub: "approx. — see help", key: "pFfo", format: xRatio, higherBetter: false },
            { label: "FFO Yield", sub: "approx.", key: "ffoYield", format: pctAbs, higherBetter: true },
            { label: "EV / EBITDA", key: "evToEbitda", format: xRatio, higherBetter: false },
          ],
        },
        {
          title: "Income",
          metrics: [
            { label: "Dividend Yield", key: "dividendYield", format: pctAbs, higherBetter: true },
            { label: "Payout Ratio", sub: "of FFO proxy", key: "payoutRatio", format: pctAbs, higherBetter: false },
          ],
        },
        {
          title: "Growth",
          metrics: [
            { label: "Revenue Growth YoY", key: "revenueGrowthYoY", format: pctSigned, higherBetter: true },
            { label: "FFO Growth YoY", sub: "approx.", key: "ffoGrowthYoY", format: pctSigned, higherBetter: true },
          ],
        },
        {
          title: "Leverage",
          metrics: [
            { label: "Debt / Equity", key: "debtToEquity", format: xRatio, higherBetter: false },
            { label: "Net Debt / EBITDA", key: "netDebtToEbitda", format: xRatio, higherBetter: false },
            { label: "Net Debt", key: "netDebt", format: usd, higherBetter: false },
          ],
        },
        {
          title: "Momentum",
          metrics: [
            { label: "1-Year Return", key: "oneYearReturn", format: pctSigned, higherBetter: true },
            { label: "Distance from 52W High", key: "distanceFrom52WkHigh", format: pctSigned, higherBetter: true },
          ],
        },
      ];

    case "crypto":
      return [
        {
          title: "Valuation & Supply",
          metrics: [
            { label: "Market Cap", key: "marketCap", format: usd, higherBetter: null },
            { label: "FDV", sub: "fully-diluted valuation", key: "fdv", format: usd, higherBetter: null },
            { label: "Market Cap / FDV", sub: "higher = less dilution ahead", key: "mcapToFdv", format: xRatio, higherBetter: true },
          ],
        },
        {
          title: "Classification & Liquidity",
          metrics: [
            { label: "Sector", key: "attr:sector", format: (v) => String(v), higherBetter: null },
            { label: "24h Volume", key: "volume24h", format: usd, higherBetter: true },
            { label: "Volume / Market Cap", key: "volumeToMcap", format: (v) => v.toFixed(3) + "x", higherBetter: true },
          ],
        },
        {
          title: "Momentum & Risk",
          metrics: [
            { label: "90-Day Return", key: "return90d", format: pctSigned, higherBetter: true },
            { label: "1-Year Return", key: "oneYearReturn", format: pctSigned, higherBetter: true },
            { label: "Distance from 52W High", key: "distanceFrom52WkHigh", format: pctSigned, higherBetter: true },
            { label: "Volatility (ann.)", key: "volatility", format: pctAbs, higherBetter: false },
            { label: "Max Drawdown", key: "maxDrawdown", format: pctSigned, higherBetter: true },
          ],
        },
      ];

    case "commodity":
      return [
        {
          title: "Price & Trend",
          metrics: [
            { label: "Front-Month Price", key: "price", format: price, higherBetter: null },
            { label: "Sector", key: "attr:sector", format: (v) => String(v), higherBetter: null },
            { label: "1-Month Return", key: "return1m", format: pctSigned, higherBetter: true },
            { label: "1-Year Return", key: "return1y", format: pctSigned, higherBetter: true },
            { label: "Trend Score", key: "trendScore", format: score100, higherBetter: true },
            { label: "Distance from 52W High", key: "distanceFrom52WkHigh", format: pctSigned, higherBetter: true },
          ],
        },
        {
          title: "Futures Curve",
          metrics: [
            { label: "Curve Slope (ann.)", sub: "positive = contango", key: "curveSlope", format: pctSigned, higherBetter: false },
            { label: "Roll Yield (ann.)", key: "rollYield", format: pctSigned, higherBetter: true },
          ],
        },
        {
          title: "Seasonality",
          metrics: [
            { label: "Seasonality (this month)", key: "seasonalityScore", format: score100, higherBetter: true },
            { label: "Avg Return (this month, history)", key: "seasonalAvgReturn", format: pctSigned, higherBetter: true },
          ],
        },
        {
          title: "Risk",
          metrics: [
            { label: "Volatility (ann.)", key: "volatility", format: pctAbs, higherBetter: false },
            { label: "Geopolitical Exposure", key: "attr:geopoliticalExposure", format: (v) => String(v), higherBetter: null },
          ],
        },
      ];

    case "bond":
      return [
        {
          title: "Yield & Spread",
          metrics: [
            { label: "Yield", key: "yield", format: pctAbs, higherBetter: true },
            { label: "Spread vs Treasury", key: "spread", format: pctSigned, higherBetter: true },
          ],
        },
        {
          title: "Rate Risk",
          metrics: [
            { label: "Duration", sub: "no universal direction", key: "duration", format: yrs, higherBetter: null },
            { label: "Avg Maturity", key: "maturity", format: yrs, higherBetter: null },
            { label: "Loss if Rates +1%", key: "rateSensitivity", format: pctSigned, higherBetter: true },
          ],
        },
        {
          title: "Credit Quality",
          metrics: [
            { label: "Investment Grade %", key: "investmentGradePct", format: pctAbs, higherBetter: true },
            { label: "High Yield %", key: "highYieldPct", format: pctAbs, higherBetter: false },
            { label: "Government %", key: "govtPct", format: pctAbs, higherBetter: null },
            { label: "Average Rating", key: "attr:avgRating", format: (v) => String(v), higherBetter: null },
          ],
        },
        {
          title: "Classification & Cost",
          metrics: [
            { label: "Issuer Type", key: "attr:issuerType", format: (v) => String(v), higherBetter: null },
            { label: "Risk Level", key: "attr:riskLevel", format: (v) => String(v), higherBetter: null },
            { label: "Expense Ratio", key: "expenseRatio", format: pctAbs, higherBetter: false },
            { label: "AUM", key: "aum", format: usd, higherBetter: true },
            { label: "1-Year Return", key: "oneYearReturn", format: pctSigned, higherBetter: true },
          ],
        },
      ];

    case "forex":
      return [
        {
          title: "Pair Classification",
          metrics: [
            { label: "Pair Type", key: "attr:pairType", format: (v) => String(v), higherBetter: null },
            { label: "Liquidity Tier", key: "liquidityTier", format: tier, higherBetter: false },
          ],
        },
        {
          title: "Carry & Policy",
          metrics: [
            { label: "Interest Rate Differential", key: "rateDifferential", format: pctSigned, higherBetter: true },
            { label: "Real Rate Differential", key: "realRateDifferential", format: pctSigned, higherBetter: true },
            { label: "Inflation Differential", key: "inflationDifferential", format: pctSigned, higherBetter: false },
            { label: "Central Bank Divergence", key: "policyDivergence", format: (v) => (v >= 0 ? `+${v}` : `${v}`), higherBetter: true },
            { label: "Carry / Volatility", key: "carryToVol", format: xRatio, higherBetter: true },
          ],
        },
        {
          title: "Trend & Risk",
          metrics: [
            { label: "Trend Score", key: "trendScore", format: score100, higherBetter: true },
            { label: "1-Month Return", key: "return1m", format: pctSigned, higherBetter: true },
            { label: "1-Year Return", key: "return1y", format: pctSigned, higherBetter: true },
            { label: "Distance from 52W High", key: "distanceFrom52WkHigh", format: pctSigned, higherBetter: true },
            { label: "Volatility (ann.)", key: "volatility", format: pctAbs, higherBetter: false },
            { label: "Max Drawdown", key: "maxDrawdown", format: pctSigned, higherBetter: true },
          ],
        },
      ];

    default:
      return [];
  }
}

/** Pulls a metric's raw numeric or categorical value off an entry — "attr:x" for categoricals, "score:x" (or "score:overall") for composite-score axes, else a plain metrics key. */
export function getRawValue(entry: ClassCompareEntry, key: string): number | string | null {
  if (key.startsWith("attr:")) return entry.attributes[key.slice(5)] ?? null;
  if (key === "score:overall") return entry.scores.overall;
  if (key.startsWith("score:")) return entry.scores.axes.find((a) => a.key === key.slice(6))?.value ?? null;
  return entry.metrics[key] ?? null;
}

/**
 * A "Composite Scores" table section, built dynamically from whatever axes
 * this class's composite-scores.ts actually computed (lib/compare/composite-scores.ts)
 * rather than a hand-maintained per-class list — so adding/renaming an axis
 * there never requires a matching edit here. Mirrors equity's own Composite
 * Scores section (app/compare/page.tsx SECTIONS).
 */
export function compositeScoreSection(entries: ClassCompareEntry[]): ClassSectionDef | null {
  const axes = entries.find((e) => !e.error)?.scores.axes ?? [];
  if (axes.length === 0) return null;
  return {
    title: "Composite Scores",
    metrics: [
      { label: "Overall Score", key: "score:overall", format: score100, higherBetter: true },
      ...axes.map((a): ClassMetricDef => ({ label: a.label, key: `score:${a.key}`, format: score100, higherBetter: true })),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Summary-card "key facts" — a short, class-specific glance list (2-3 raw    */
/* metrics) so the header cards stay scannable instead of listing every axis. */
/* -------------------------------------------------------------------------- */

export interface ClassKeyFact {
  label: string;
  key: string;
  format: (v: number) => string;
}

export function classKeyFacts(assetClass: AssetClassId): ClassKeyFact[] {
  switch (assetClass) {
    case "etf":
      return [
        { label: "Expense", key: "expenseRatio", format: pctAbs },
        { label: "AUM", key: "aum", format: usd },
        { label: "Yield", key: "dividendYield", format: pctAbs },
      ];
    case "reit":
      return [
        { label: "Mkt Cap", key: "marketCap", format: usd },
        { label: "Div Yield", key: "dividendYield", format: pctAbs },
        { label: "P/FFO", key: "pFfo", format: xRatio },
      ];
    case "crypto":
      return [
        { label: "Mkt Cap", key: "marketCap", format: usd },
        { label: "24h Vol", key: "volume24h", format: usd },
        { label: "Mcap/FDV", key: "mcapToFdv", format: xRatio },
      ];
    case "commodity":
      return [
        { label: "Price", key: "price", format: price },
        { label: "1Y Return", key: "return1y", format: pctSigned },
      ];
    case "bond":
      return [
        { label: "Yield", key: "yield", format: pctAbs },
        { label: "Duration", key: "duration", format: yrs },
        { label: "AUM", key: "aum", format: usd },
      ];
    case "forex":
      return [
        { label: "Carry/Vol", key: "carryToVol", format: xRatio },
        { label: "Trend", key: "trendScore", format: score100 },
      ];
    default:
      return [];
  }
}

/** Attribute keys shown as small tag pills on the summary card, e.g. ETF's Focus/Region. */
export function classTagAttrs(assetClass: AssetClassId): string[] {
  switch (assetClass) {
    case "etf": return ["focus", "region"];
    case "reit": return ["propertyType"];
    case "crypto": return ["sector"];
    case "commodity": return ["sector"];
    case "bond": return ["issuerType"];
    case "forex": return ["pairType"];
    default: return [];
  }
}
