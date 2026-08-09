/**
 * THE Compare metric registry: which metrics appear in which section, their
 * direction, formatting, applicability id, and benchmark key. Shared by the
 * /compare page and the /api/export/compare Excel route so the spreadsheet
 * can never drift from the screen (it previously carried its own copy with a
 * duplicate Analyst Upside row, an unscaled EPS surprise, and an inverted
 * from-52W-high direction).
 *
 * Pure and client-safe: types + lib/compare/metrics + lib/format only.
 */

import type { CompareEntry } from "@/app/api/compare/route";
import { roundForDisplay } from "../format";
import { metricApplicability, zeroAsMissing, type MetricDirection } from "./metrics";

/* -------------------------------------------------------------------------- */
/* Metric definitions                                                          */
/* -------------------------------------------------------------------------- */

export interface MetricDef {
  /** Stable metric id — keys the sector-applicability layer (lib/compare/metrics.ts) and matches the benchmark key where one exists. */
  id: string;
  label: string;
  sub?: string;
  /** One line, shown when the row is expanded — what the metric means, not just how to read its direction (that's `sub`). */
  description?: string;
  getValue: (e: CompareEntry) => number | null;
  format: (v: number) => string;
  /** Explicit comparison direction. `neutral` metrics (counts, descriptive stats) never receive a best/worst treatment. */
  direction: MetricDirection;
  /** The value itself is a signed return/change — the ONLY case where the number is colored green/red. */
  signed?: boolean;
  /** Registry metric key for sector-benchmark lookup in entry.benchmarks — omitted where no like-for-like universe metric exists. */
  benchmarkKey?: string;
}

export interface SectionDef {
  title: string;
  metrics: MetricDef[];
}

export function bucketPct(score: NonNullable<CompareEntry["score"]>, name: string): number {
  // Defensive on buckets: the export route feeds this from a client-supplied
  // JSON payload, where a partial `score` object may legally arrive.
  const b = score.buckets?.find((bk) => bk.name === name);
  return b ? Math.round((b.points / b.max) * 100) : 50;
}

/* Signed-zero-safe formatters: rounding happens BEFORE the sign is chosen,
   so -0.04% renders "0.0%", never "-0.0%". */
export const pctSigned = (v: number) => {
  const r = roundForDisplay(v, 1);
  return `${r > 0 ? "+" : ""}${r.toFixed(1)}%`;
};
export const pctAbs = (v: number) => `${roundForDisplay(v, 1).toFixed(1)}%`;
export const xRatio = (v: number) => `${roundForDisplay(v, 1).toFixed(1)}x`;
export const integer = (v: number) => Math.round(v).toString();
export const score100 = (v: number) => `${Math.round(v)}`;

export const SECTIONS: SectionDef[] = [
  {
    title: "Valuation",
    metrics: [
      { id: "forwardPE", label: "Forward P/E", sub: "lower = cheaper", description: "Price relative to next year's expected earnings.", getValue: (e) => e.snapshot?.forwardPE ?? null, format: xRatio, direction: "lower_is_better", benchmarkKey: "forwardPE" },
      { id: "trailingPE", label: "Trailing P/E", description: "Price relative to the last twelve months of earnings.", getValue: (e) => e.snapshot?.trailingPE ?? null, format: xRatio, direction: "lower_is_better" },
      { id: "pegRatio", label: "PEG Ratio", sub: "P/E ÷ growth", description: "P/E adjusted for growth — under 1x is often considered cheap for the growth on offer.", getValue: (e) => e.snapshot?.pegRatio ?? null, format: xRatio, direction: "lower_is_better", benchmarkKey: "pegRatio" },
      { id: "priceToBook", label: "Price / Book", description: "Price relative to net asset value on the balance sheet.", getValue: (e) => e.snapshot?.priceToBook ?? null, format: xRatio, direction: "lower_is_better" },
      // Analyst Target Upside used to be duplicated here — it lives in Analyst Consensus, where it belongs.
      { id: "fcfYield", label: "FCF Yield", sub: "higher = more value", description: "Free cash flow as a percentage of market cap — the cash-based answer to \"is it cheap?\"", getValue: (e) => e.fcfYieldPct ?? null, format: pctAbs, direction: "higher_is_better", benchmarkKey: "fcfYield" },
    ],
  },
  {
    title: "Growth",
    metrics: [
      { id: "revenueGrowthYoY", label: "Revenue Growth YoY", description: "Year-over-year revenue increase.", getValue: (e) => e.snapshot?.revenueGrowth != null ? e.snapshot.revenueGrowth * 100 : null, format: pctSigned, direction: "higher_is_better", signed: true, benchmarkKey: "revenueGrowthYoY" },
      { id: "earningsGrowthYoY", label: "Earnings Growth YoY", description: "Year-over-year net income increase.", getValue: (e) => e.snapshot?.earningsGrowth != null ? e.snapshot.earningsGrowth * 100 : null, format: pctSigned, direction: "higher_is_better", signed: true },
      { id: "revenueCagr3y", label: "Revenue CAGR 3Y", description: "Compound annual revenue growth over the last 3 fiscal years.", getValue: (e) => e.statements?.revenueCagr != null ? e.statements.revenueCagr * 100 : null, format: pctSigned, direction: "higher_is_better", signed: true },
      { id: "fcfCagr3y", label: "FCF CAGR 3Y", description: "Compound annual free cash flow growth over the last 3 fiscal years.", getValue: (e) => e.statements?.fcfCagr != null ? e.statements.fcfCagr * 100 : null, format: pctSigned, direction: "higher_is_better", signed: true },
    ],
  },
  {
    title: "Quality",
    metrics: [
      { id: "roe", label: "Return on Equity", description: "Net income as a percentage of shareholder equity — how efficiently the company compounds capital.", getValue: (e) => e.snapshot?.returnOnEquity != null ? e.snapshot.returnOnEquity * 100 : null, format: pctAbs, direction: "higher_is_better", benchmarkKey: "roe" },
      { id: "roa", label: "Return on Assets", description: "Net income as a percentage of total assets.", getValue: (e) => e.snapshot?.returnOnAssets != null ? e.snapshot.returnOnAssets * 100 : null, format: pctAbs, direction: "higher_is_better" },
      // Provider sends a literal 0 for unreported margins (every bank) — zeroAsMissing keeps fabricated "0.0%" off the screen.
      { id: "grossMargin", label: "Gross Margin", description: "Revenue left after cost of goods sold.", getValue: (e) => zeroAsMissing(e.snapshot?.grossMargins) != null ? e.snapshot!.grossMargins! * 100 : null, format: pctAbs, direction: "higher_is_better", benchmarkKey: "grossMargin" },
      { id: "operatingMargin", label: "Operating Margin", description: "Revenue left after operating expenses — core profitability before interest and tax.", getValue: (e) => zeroAsMissing(e.snapshot?.operatingMargins) != null ? e.snapshot!.operatingMargins! * 100 : null, format: pctAbs, direction: "higher_is_better", benchmarkKey: "operatingMargin" },
      { id: "netProfitMargin", label: "Net Profit Margin", description: "Revenue left after all expenses, interest and tax.", getValue: (e) => e.snapshot?.profitMargins != null ? e.snapshot.profitMargins * 100 : null, format: pctAbs, direction: "higher_is_better" },
      { id: "ebitdaMargin", label: "EBITDA Margin", description: "Earnings before interest, tax, depreciation and amortization, as a share of revenue.", getValue: (e) => zeroAsMissing(e.snapshot?.ebitdaMargins) != null ? e.snapshot!.ebitdaMargins! * 100 : null, format: pctAbs, direction: "higher_is_better" },
    ],
  },
  {
    title: "Financial Health",
    metrics: [
      { id: "debtToEquity", label: "Debt / Equity", sub: "lower = safer", description: "Total debt relative to shareholder equity — leverage on the balance sheet.", getValue: (e) => e.snapshot?.debtToEquity ?? null, format: xRatio, direction: "lower_is_better", benchmarkKey: "debtToEquity" },
      { id: "netDebtToEbitda", label: "Net Debt / EBITDA", description: "Debt net of cash, relative to a year of earnings — how many years to pay it off.", getValue: (e) => e.netDebtToEbitda ?? null, format: xRatio, direction: "lower_is_better" },
      { id: "currentRatio", label: "Current Ratio", sub: "higher = more liquid", description: "Current assets divided by current liabilities — short-term liquidity.", getValue: (e) => e.snapshot?.currentRatio ?? null, format: xRatio, direction: "higher_is_better" },
      { id: "quickRatio", label: "Quick Ratio", description: "Current assets excluding inventory, divided by current liabilities — a stricter liquidity test.", getValue: (e) => e.snapshot?.quickRatio ?? null, format: xRatio, direction: "higher_is_better" },
      { id: "dividendYield", label: "Dividend Yield", description: "Trailing annual dividend as a percentage of the current price.", getValue: (e) => e.snapshot?.dividendYield != null ? e.snapshot.dividendYield * 100 : null, format: pctAbs, direction: "higher_is_better", benchmarkKey: "dividendYield" },
    ],
  },
  {
    title: "Momentum",
    metrics: [
      { id: "oneYearReturn", label: "1-Year Return", description: "Trailing twelve-month total return (dividend-adjusted).", getValue: (e) => e.oneYearReturn ?? null, format: pctSigned, direction: "higher_is_better", signed: true, benchmarkKey: "oneYearReturn" },
      { id: "return3m", label: "3-Month Return", description: "Trailing three-month price return.", getValue: (e) => e.momentum?.return3m ?? null, format: pctSigned, direction: "higher_is_better", signed: true },
      { id: "vsSma200", label: "vs SMA 200", sub: "% above/below", description: "Distance above or below the 200-day moving average — the long-term trend line.", getValue: (e) => e.momentum?.vsSma200 ?? null, format: pctSigned, direction: "higher_is_better", signed: true },
      { id: "vsSma50", label: "vs SMA 50", description: "Distance above or below the 50-day moving average — the medium-term trend line.", getValue: (e) => e.momentum?.vsSma50 ?? null, format: pctSigned, direction: "higher_is_better", signed: true },
      { id: "distanceFrom52WkHigh", label: "From 52W High", sub: "0 = at the high", description: "Distance below the 52-week high — 0% means it's at the high right now.", getValue: (e) => e.momentum?.pctFrom52WkHigh ?? null, format: pctSigned, direction: "higher_is_better", signed: true, benchmarkKey: "distanceFrom52WkHigh" },
    ],
  },
  {
    title: "Analyst Consensus",
    metrics: [
      { id: "targetUpside", label: "Target Upside %", description: "Consensus price target versus the current price.", getValue: (e) => e.analyst?.upsidePercent ?? null, format: pctSigned, direction: "higher_is_better", signed: true },
      { id: "numAnalysts", label: "# Analysts", description: "Number of analysts covering the stock — coverage breadth, not a judgment.", getValue: (e) => e.analyst?.numberOfOpinions ?? null, format: integer, direction: "neutral" },
      { id: "strongBuyBuy", label: "Strong Buy + Buy", description: "Analysts rating the stock a buy or strong buy.", getValue: (e) => e.analyst ? e.analyst.strongBuy + e.analyst.buy : null, format: integer, direction: "higher_is_better" },
      { id: "holdRatings", label: "Hold", description: "Analysts rating the stock a hold — descriptive, neither good nor bad on its own.", getValue: (e) => e.analyst?.hold ?? null, format: integer, direction: "neutral" },
      { id: "sellRatings", label: "Sell + Strong Sell", description: "Analysts rating the stock a sell or strong sell.", getValue: (e) => e.analyst ? e.analyst.sell + e.analyst.strongSell : null, format: integer, direction: "lower_is_better" },
      {
        id: "avgEpsSurprise",
        label: "Avg EPS Surprise",
        description: "Average earnings beat or miss versus estimates, across recent quarters.",
        getValue: (e) => {
          const s = e.analyst?.epsSurprises;
          if (!s || s.length === 0) return null;
          // Provider reports surprise as a FRACTION (0.07 = beat by 7%) — scale to percent units like every other % metric here.
          return (s.reduce((a, b) => a + b, 0) / s.length) * 100;
        },
        format: pctSigned,
        direction: "higher_is_better",
        signed: true,
      },
      {
        id: "epsRevisions30d",
        label: "EPS Revisions (30d)",
        sub: "up − down",
        description: "Net analyst estimate revisions in the last 30 days — up-revisions minus down.",
        getValue: (e) => {
          const up = e.analyst?.epsRevisionsUp30d;
          const down = e.analyst?.epsRevisionsDown30d;
          if (up == null && down == null) return null;
          return (up ?? 0) - (down ?? 0);
        },
        format: (v) => (v >= 0 ? `+${Math.round(v)}` : String(Math.round(v))),
        direction: "higher_is_better",
        signed: true,
      },
    ],
  },
  {
    title: "Conviction & dimensions",
    metrics: [
      // Named "Conviction" because it IS /research's Conviction score — same
      // engine, and now the same inputs. "Overall Score" gave a reader no way to
      // tell it apart from the Screener's Overall, which is a different engine.
      { id: "conviction", label: "Conviction", description: "The same Conviction score /research shows — blended across every dimension below.", getValue: (e) => e.score?.composite ?? null, format: score100, direction: "higher_is_better" },
      { id: "fundamentalScore", label: "Fundamental Score", description: "Composite of valuation, growth, quality and financial health — excludes momentum and analyst signals.", getValue: (e) => e.score?.total ?? null, format: score100, direction: "higher_is_better" },
      { id: "valuationScore", label: "Valuation Score", description: "How cheap the stock is relative to its own scoring bands.", getValue: (e) => (e.score ? bucketPct(e.score, "Valuation") : null), format: score100, direction: "higher_is_better" },
      { id: "growthScore", label: "Growth Score", description: "How fast the business is growing relative to its own scoring bands.", getValue: (e) => (e.score ? bucketPct(e.score, "Growth") : null), format: score100, direction: "higher_is_better" },
      { id: "qualityScore", label: "Quality Score", description: "Profitability and capital efficiency relative to its own scoring bands.", getValue: (e) => (e.score ? bucketPct(e.score, "Quality") : null), format: score100, direction: "higher_is_better" },
      { id: "financialHealthScore", label: "Financial Health Score", description: "Balance-sheet strength relative to its own scoring bands. For banks this blends leverage and operating efficiency; regulatory capital and asset-quality figures (CAR, GNPA) are not in the dataset.", getValue: (e) => (e.score ? bucketPct(e.score, "Financial Health") : null), format: score100, direction: "higher_is_better" },
      { id: "momentumSignal", label: "Momentum Signal", description: "Price trend strength — how the stock has been trading recently.", getValue: (e) => e.score?.signals?.momentum ?? null, format: score100, direction: "higher_is_better" },
      { id: "analystSignal", label: "Analyst Signal", description: "Consensus analyst sentiment, distilled into a single score.", getValue: (e) => e.score?.signals?.analysts ?? null, format: score100, direction: "higher_is_better" },
      { id: "confidence", label: "Confidence", description: "How much underlying data supports this stock's Conviction score — lower when data is sparse.", getValue: (e) => e.score?.confidence ?? null, format: score100, direction: "higher_is_better" },
    ],
  },
];

/**
 * Cell values for one metric row, with sector applicability applied — a cell
 * that is not applicable for its entry's sector contributes null to the
 * comparison (never a best/worst candidate) but remembers why for the UI.
 */
export function rowValues(metric: MetricDef, entries: CompareEntry[]): { value: number | null; naReason: string | null }[] {
  return entries.map((e) => {
    if (e.error) return { value: null, naReason: null };
    const app = metricApplicability(metric.id, e.snapshot?.sector);
    if (!app.applicable) return { value: null, naReason: app.reason };
    return { value: metric.getValue(e), naReason: null };
  });
}
