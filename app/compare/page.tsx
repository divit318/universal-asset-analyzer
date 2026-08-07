"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CompareLanding } from "./_components/landing/compare-landing";
import { HoverSymbolProvider, useHoverSymbol, useHoverHandlers, useSymbolEmphasis, emphasisClassName, type SymbolEmphasis } from "./_components/hover-symbol-context";
import { BackgroundDepth } from "./_components/background-depth";
import { Collapsible } from "./_components/collapsible-section";
import { CountUp } from "@/app/_components/count-up";
import { AiBadge } from "@/app/_components/ai-badge";
import { useTheme } from "@/app/_components/theme";
import type { CompareEntry } from "@/app/api/compare/route";
import type { GroundingReport } from "@/lib/ai/types";
import { downloadBlob } from "@/lib/download";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { GroundingBadge } from "@/app/_components/grounding-badge";
import { useBootReady } from "@/app/_components/boot-context";
import { LoadingMark } from "@/app/_components/loading-mark";
import { Reveal } from "@/app/_components/reveal";
import { DataProvenance } from "@/app/_components/data-provenance";
import { getAssetClass, listAssetClasses } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import type { ClassCompareEntry } from "@/lib/compare/types";
import type { UniverseStatus } from "@/lib/screener/types";
import type { ComparisonResult, RankedAsset } from "@/lib/ai-compare";
import type { PeerBenchmark } from "@/lib/compare/benchmarks";
import { useFocusSafe } from "@/lib/focus-context";

// Recharts is heavy; load the chart chunks only once the user has ≥2 stocks to
// compare rather than shipping them in the initial /compare bundle.
const chartFallback = (
  <Skeleton height="h-64" radius="rounded-card" className="border border-border" />
);
const CompareChart = dynamic(
  () => import("./_components/compare-chart").then((m) => m.CompareChart),
  { ssr: false, loading: () => chartFallback },
);
const CompareRadar = dynamic(
  () => import("./_components/radar-chart").then((m) => m.CompareRadar),
  { ssr: false, loading: () => chartFallback },
);
const ClassCompareView = dynamic(
  () => import("./_components/class-compare-view").then((m) => m.ClassCompareView),
  { ssr: false, loading: () => chartFallback },
);
import { formatCurrency, formatMarketCap, formatPercent, ordinal, roundForDisplay } from "@/lib/format";
import { metricApplicability, resolveRowHighlights, zeroAsMissing, type MetricDirection, type RowHighlights } from "@/lib/compare/metrics";
import { useIOSSafe } from "@/lib/ios-context";
import { PortfolioFitBadge } from "@/app/_components/portfolio-fit-badge";
import { PageShell, Skeleton } from "@/app/_components/ui";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";

const NON_EQUITY_CLASSES = listAssetClasses().filter((c) => c.id !== "equity");

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const MAX = 5;
/* Categorical identity palette for compared symbols. Deliberately avoids
   green/red — those already mean positive/negative (price change, score
   deltas) elsewhere on this page — so categorical stock identity can't be
   misread as a gain/loss signal. Five hues of comparable saturation and
   luminance (violet, sky, teal, amber, pink): the previous set ended in
   slate, which made the 5th symbol read as disabled/deselected, and put
   near-identical purple and pink on symbols 1 and 4. Everything on this page
   that colors a symbol goes through colorForSymbol, so cards, chips, charts,
   and the metric table always agree. */
const COLORS_DARK: string[] = ["#a78bfa", "#38bdf8", "#2dd4bf", "#fbbf24", "#f472b6"];
/* Same five hues, deepened for a white canvas — the 400-weight dark-theme set
   sits near 2.5:1 on white, well short of AA. Chosen per-hue at ~600/700
   weight, mirroring how chart-theme.ts swaps its steel for light mode. */
const COLORS_LIGHT: string[] = ["#7c3aed", "#0284c7", "#0f766e", "#b45309", "#be185d"];
const COLOR_BG = [
  "bg-violet-500/10 border-violet-500/30",
  "bg-sky-500/10 border-sky-500/30",
  "bg-teal-500/10 border-teal-500/30",
  "bg-amber-500/10 border-amber-500/30",
  "bg-pink-500/10 border-pink-500/30",
];

/** Asset-class tab: tactile without being animated — a 2-3% scale, 2px lift,
 * brighter surface/border and a soft brand glow, all within 200ms. Shared by
 * the Equities tab and the NON_EQUITY_CLASSES map below so both stay in sync. */
function assetTabClass(active: boolean): string {
  const base = "rounded-lg border px-3 py-1.5 text-sm transform-gpu transition-[transform,background-color,border-color,box-shadow,color] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.025]";
  return active
    ? `${base} border-brand bg-brand/10 font-medium text-brand hover:shadow-glow-brand`
    : `${base} border-border bg-surface text-muted hover:border-brand/50 hover:bg-surface-2 hover:text-foreground hover:shadow-glow-brand`;
}

/* -------------------------------------------------------------------------- */
/* Metric definitions                                                          */
/* -------------------------------------------------------------------------- */

interface MetricDef {
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

interface SectionDef {
  title: string;
  metrics: MetricDef[];
}

function bucketPct(score: NonNullable<CompareEntry["score"]>, name: string): number {
  const b = score.buckets.find((bk) => bk.name === name);
  return b ? Math.round((b.points / b.max) * 100) : 50;
}

/* Signed-zero-safe formatters: rounding happens BEFORE the sign is chosen,
   so -0.04% renders "0.0%", never "-0.0%". */
const pctSigned = (v: number) => {
  const r = roundForDisplay(v, 1);
  return `${r > 0 ? "+" : ""}${r.toFixed(1)}%`;
};
const pctAbs = (v: number) => `${roundForDisplay(v, 1).toFixed(1)}%`;
const xRatio = (v: number) => `${roundForDisplay(v, 1).toFixed(1)}x`;
const integer = (v: number) => Math.round(v).toString();
const score100 = (v: number) => `${Math.round(v)}`;

const SECTIONS: SectionDef[] = [
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
      { id: "financialHealthScore", label: "Financial Health Score", description: "Balance-sheet strength relative to its own scoring bands.", getValue: (e) => (e.score ? bucketPct(e.score, "Financial Health") : null), format: score100, direction: "higher_is_better" },
      { id: "momentumSignal", label: "Momentum Signal", description: "Price trend strength — how the stock has been trading recently.", getValue: (e) => e.score?.signals.momentum ?? null, format: score100, direction: "higher_is_better" },
      { id: "analystSignal", label: "Analyst Signal", description: "Consensus analyst sentiment, distilled into a single score.", getValue: (e) => e.score?.signals.analysts ?? null, format: score100, direction: "higher_is_better" },
      { id: "confidence", label: "Confidence", description: "How much underlying data supports this stock's Conviction score — lower when data is sparse.", getValue: (e) => e.score?.confidence ?? null, format: score100, direction: "higher_is_better" },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function recLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function recColor(key: string | null | undefined): string {
  if (!key) return "text-muted bg-surface-2";
  const k = key.toLowerCase();
  if (k === "strong_buy") return "text-positive bg-positive/15";
  if (k === "buy") return "text-positive bg-positive/10";
  if (k === "hold") return "text-warning bg-warning/10";
  if (k === "sell") return "text-negative bg-negative/10";
  if (k === "strong_sell") return "text-negative bg-negative/15";
  return "text-muted bg-surface-2";
}

/** Score/conviction tier → green (high), amber (medium), red (low). */
function convictionColor(conviction: string | null | undefined): string {
  const c = (conviction ?? "").toLowerCase();
  if (c === "high") return "border-positive/30 bg-positive/10 text-positive";
  if (c === "medium") return "border-warning/30 bg-warning/10 text-warning";
  if (c === "low") return "border-negative/30 bg-negative/10 text-negative";
  return "border-border bg-surface-2 text-muted";
}

/**
 * Cell values for one metric row, with sector applicability applied — a cell
 * that is not applicable for its entry's sector contributes null to the
 * comparison (never a best/worst candidate) but remembers why for the UI.
 */
function rowValues(metric: MetricDef, entries: CompareEntry[]): { value: number | null; naReason: string | null }[] {
  return entries.map((e) => {
    if (e.error) return { value: null, naReason: null };
    const app = metricApplicability(metric.id, e.snapshot?.sector);
    if (!app.applicable) return { value: null, naReason: app.reason };
    return { value: metric.getValue(e), naReason: null };
  });
}

/**
 * Progressive status copy for the AI verdict's loading state, keyed by how
 * long it's been running. A single static "Running analysis..." used to sit
 * on screen unchanged whether the answer was 5 seconds or 5 minutes away,
 * which reads as broken/stuck well before a long generation actually
 * finishes. None of this requires the backend to report real-time phase —
 * it's calibrated to the router's documented timings so the copy stays honest
 * without new plumbing.
 */
function aiLoadingLabel(elapsedMs: number): string {
  if (elapsedMs < 8_000) return "Preparing AI — routing to the right effort tier…";
  if (elapsedMs < 30_000) return "Analyzing — typically well under a minute…";
  if (elapsedMs < 90_000) return "Still working — a deep comparison earns a longer reasoning budget…";
  return "Still reasoning — a large comparison can take a few minutes. The metric table above is already complete either way.";
}

/** Streamed flat-field keys (see lib/ai-compare.ts's streamComparisonFields) that map directly onto an `AiComparison` field of the same name. */
const AI_FIELD_KEYS = new Set([
  "rankings", "noClearWinner", "tradeoffSummary", "executiveSummary",
  "conditionsForChange", "confidenceScore", "capitalAllocation",
  "competitivePositioning", "riskComparison",
]);
/** Streamed flat-field keys that map onto a MetricSection's `sectionCommentary` slot instead. */
const AI_SECTION_TITLES: Record<string, string> = {
  valuation: "Valuation", growth: "Growth", quality: "Quality",
  financialHealth: "Financial Health", momentum: "Momentum",
};

/* -------------------------------------------------------------------------- */
/* Main page                                                                   */
/* -------------------------------------------------------------------------- */

interface AiComparison {
  rankings?: RankedAsset[];
  noClearWinner?: boolean;
  tradeoffSummary?: string;
  error?: string;
  executiveSummary?: string;
  conditionsForChange?: string;
  confidenceScore?: number;
  capitalAllocation?: string;
  competitivePositioning?: string;
  riskComparison?: string;
  grounding?: GroundingReport;
  /** Per-category AI commentary — generated by lib/ai-compare.ts alongside
   * the ranked verdict, keyed by the matching metric-table section title so
   * MetricSection can surface it inline. Previously computed on every
   * request (costing model tokens/latency) but never rendered anywhere. */
  sectionCommentary?: Partial<Record<string, string>>;
  /** Requested symbols the AI verdict couldn't load — the ranking still ran on whoever's left. */
  droppedSymbols?: { symbol: string; reason: string }[];
}

interface CategoryWinner {
  category: string;
  symbol: string;
  color: string;
}

/** Aggregate metric-level winners within a section into one category winner — no AI, purely derived from already-rendered data. `colorFor` resolves a symbol's canonical color (its position among ALL requested symbols, including any that failed to load) so this badge never disagrees with the header cards' color for the same symbol. */
function computeCategoryWinners(sections: SectionDef[], entries: CompareEntry[], colorFor: (symbol: string) => string): CategoryWinner[] {
  const out: CategoryWinner[] = [];
  for (const section of sections) {
    const winCounts = entries.map(() => 0);
    for (const metric of section.metrics) {
      if (metric.direction === "neutral") continue;
      const values = rowValues(metric, entries).map((c) => c.value);
      const w = resolveRowHighlights(values, metric.direction, metric.format);
      // A shared win still counts for everyone tied at the top.
      for (const i of w?.best ?? []) winCounts[i]++;
    }
    const maxWins = Math.max(...winCounts);
    if (maxWins === 0) continue;
    const idx = winCounts.indexOf(maxWins);
    out.push({ category: section.title, symbol: entries[idx].symbol, color: colorFor(entries[idx].symbol) });
  }
  return out;
}

export default function ComparePage() {
  const focus = useFocusSafe();
  // Theme-aware categorical palette (see COLORS_DARK/COLORS_LIGHT above).
  const { theme } = useTheme();
  const COLORS = theme === "light" ? COLORS_LIGHT : COLORS_DARK;
  const [symbols, setSymbols] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<CompareEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["Portfolio Fit", "Valuation", "Growth", "Quality", "Financial Health", "Momentum", "Analyst Consensus", "Composite Scores"]),
  );
  const [aiResult, setAiResult] = useState<AiComparison | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiAutoTriggered = useRef<string>("");
  // Guards against two real races, not just belt-and-suspenders:
  //   1. Stale response overwriting fresh state — the AI verdict can take
  //      minutes on a cold model (see lib/ai/router.ts's cold-start budget),
  //      so a user who removes/adds a symbol before it resolves used to have
  //      whichever request finished LAST win, even if it was the older one.
  //   2. A genuinely abandoned request never gets cancelled — the previous
  //      fetch kept running server-side (and occupying the AI backend, which
  //      serializes generations) even though nothing was still listening.
  // `aiGen` increments on every new request; a response only gets applied if
  // it's still current when it resolves. `aiAbortRef` lets a superseded
  // request actually cancel — through Next.js's `request.signal` all the way
  // to the in-flight AI call (see app/api/compare/route.ts).
  const aiGen = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [aiLoadingStartedAt, setAiLoadingStartedAt] = useState<number | null>(null);
  const [aiLoadingElapsedMs, setAiLoadingElapsedMs] = useState(0);

  // Progressive status while aiLoading is true — ticks every second so the
  // copy can escalate ("Analyzing" → "still warming up") instead of one
  // static string sitting on screen for however long a cold model takes.
  useEffect(() => {
    if (aiLoadingStartedAt == null) return;
    const id = setInterval(() => setAiLoadingElapsedMs(Date.now() - aiLoadingStartedAt), 1000);
    return () => clearInterval(id);
  }, [aiLoadingStartedAt]);

  // Non-equity asset classes (ETF, REIT, Crypto, Commodity, Bond, Forex) run
  // through a parallel, simpler state slice and API — see class-compare-view.tsx.
  const [assetClass, setAssetClass] = useState<AssetClassId>("equity");
  const [classSymbols, setClassSymbols] = useState<string[]>([]);
  const [classInput, setClassInput] = useState("");
  const [classEntries, setClassEntries] = useState<ClassCompareEntry[]>([]);
  const [classLoading, setClassLoading] = useState(false);
  const [classFetchError, setClassFetchError] = useState<string | null>(null);
  // Live universe-build progress, polled while classLoading is true — a cold
  // ETF/REIT/crypto/etc. universe can take a while on first use; this turns
  // that wait from a generic spinner into "building — 140/237" so it never
  // reads as hung. Purely cosmetic: fetch failures here are swallowed.
  const [universeStatus, setUniverseStatus] = useState<UniverseStatus | null>(null);

  useBootReady(!loading && !classLoading, "compare");

  // Always-current snapshot for save-on-unmount
  const _s = useRef({ symbols, entries, aiResult });
  _s.current = { symbols, entries, aiResult };

  // Dynamic page title
  useEffect(() => {
    if (symbols.length > 0) {
      document.title = `${symbols.join(" vs ")} · Compare · UAA`;
    } else {
      document.title = "Compare · UAA";
    }
    return () => { document.title = "Universal Asset Analyzer"; };
  }, [symbols]);

  // URL deep-link or session restore on mount.
  // URL params (?symbols=A,B,C or ?a=TICKER) take priority over session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const singleTicker = params.get("a")?.trim().toUpperCase();
    const urlSyms = singleTicker
      ? [singleTicker]
      : (params.get("symbols")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) ?? []);

    if (urlSyms.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSymbols(urlSyms);
      for (const s of urlSyms) focus?.recordFocus(s);
    } else {
      // No URL params — restore from session (cleared on tab close)
      try {
        const raw = sessionStorage.getItem("uaa_compare_state");
        if (raw) {
          // Note: older sessions may still carry a `market` field — harmless, just ignored.
          const st = JSON.parse(raw) as { symbols?: string[]; entries?: CompareEntry[]; aiResult?: AiComparison };
          if (st.symbols?.length) setSymbols(st.symbols);
          if (st.entries?.length) setEntries(st.entries);
          if (st.aiResult) setAiResult(st.aiResult);
        }
      } catch { /* ignore corrupt storage */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefill the add-symbol box from the focus spine when Compare opens empty
  // (§4.4). Seeds the input only — the user still adds it; a URL param or an
  // existing/restored comparison wins.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !focus?.mostRecent) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("symbols") || params.get("a") || symbols.length > 0 || input) {
      prefilledRef.current = true;
      return;
    }
    prefilledRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInput(focus.mostRecent);
  }, [focus?.mostRecent, symbols.length, input]);

  // Save to session immediately when comparison data loads (survives navigation and reload)
  useEffect(() => {
    if (!entries.length) return;
    try { sessionStorage.setItem("uaa_compare_state", JSON.stringify(_s.current)); } catch { /* ignore */ }
  }, [entries, aiResult]);

  const fetchCompare = useCallback(async (syms: string[]) => {
    if (syms.length === 0) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/compare?symbols=${syms.join(",")}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Compare failed");
      setEntries((json.entries as CompareEntry[]).sort(
        (a, b) => syms.indexOf(a.symbol) - syms.indexOf(b.symbol),
      ));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync URL and fetch whenever symbols change.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (symbols.length > 0) url.searchParams.set("symbols", symbols.join(","));
    else url.searchParams.delete("symbols");
    window.history.replaceState({}, "", url.toString());
    // fetchCompare only sets state after an await, so this is safe to call here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCompare(symbols);
  }, [symbols, fetchCompare]);

  const fetchClassCompare = useCallback(async (cls: AssetClassId, syms: string[]) => {
    if (syms.length === 0) return;
    setClassLoading(true);
    setClassFetchError(null);
    setUniverseStatus(null);
    try {
      const res = await fetch(`/api/compare/class?assetClass=${cls}&symbols=${syms.join(",")}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Compare failed");
      setClassEntries((json.entries as ClassCompareEntry[]).sort(
        (a, b) => syms.indexOf(a.symbol) - syms.indexOf(b.symbol),
      ));
    } catch (err) {
      setClassFetchError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setClassLoading(false);
    }
  }, []);

  // While a non-equity compare is loading, poll the universe's build status
  // so a cold first-use isn't just a spinner with no explanation. peekStatus
  // never blocks, so this is cheap and independent of the main fetch above.
  useEffect(() => {
    if (!classLoading || assetClass === "equity") return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/compare/class/status?assetClass=${assetClass}`);
        const json = await res.json() as { status?: UniverseStatus };
        if (!cancelled) setUniverseStatus(json.status ?? null);
      } catch { /* purely cosmetic — a failed poll just leaves the generic spinner */ }
    }
    void poll();
    const interval = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [classLoading, assetClass]);

  // Fetch whenever the class symbol list changes.
  useEffect(() => {
    if (assetClass === "equity" || classSymbols.length === 0) return;
    // fetchClassCompare only sets state after an await, so this is safe to call here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchClassCompare(assetClass, classSymbols);
  }, [assetClass, classSymbols, fetchClassCompare]);

  // Reset auto-trigger when the symbol list changes. Also cancels any AI
  // verdict still in flight for the OLD symbol set — otherwise it kept
  // running server-side against symbols no longer on screen, occupying
  // the generation pipeline for an answer nobody could see.
  useEffect(() => {
    aiAutoTriggered.current = "";
    aiAbortRef.current?.abort();
    aiGen.current += 1; // invalidate any response still in flight
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAiResult(null);
  }, [symbols]);

  // Cancel an in-flight AI verdict if the user navigates away mid-request.
  useEffect(() => () => aiAbortRef.current?.abort(), []);

  // Auto-trigger the AI comparison — across every valid entry, not just the
  // first two — when at least 2 valid entries load for the first time.
  useEffect(() => {
    const valid = entries.filter((e) => !e.error);
    if (valid.length < 2 || aiLoading || loading) return;
    const key = valid.map((e) => e.symbol).sort().join("-");
    if (aiAutoTriggered.current === key) return;
    aiAutoTriggered.current = key;
    void fetchAiVerdict(valid.map((e) => e.symbol));
  }, [entries, aiLoading, loading]);

  async function fetchAiVerdict(syms: string[]) {
    // Supersede, don't stack: a second call to this function (re-analyze
    // click, or the auto-trigger firing again for a new symbol set) cancels
    // whatever this component was previously waiting on rather than leaving
    // it to run to completion and possibly resolve LAST, overwriting a
    // response for the symbols actually on screen right now.
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const myGen = ++aiGen.current;
    const isCurrent = () => aiGen.current === myGen;

    setAiLoading(true);
    setAiResult(null);
    setAiLoadingElapsedMs(0);
    setAiLoadingStartedAt(Date.now());

    // Streamed rather than one blocking POST: on a cold-loading model this
    // used to mean one spinner for however long the load took (observed:
    // several minutes under memory pressure). /api/compare/stream runs the
    // exact same generation (see lib/ai-compare.ts's streamComparisonFields)
    // but emits each field — executiveSummary, then the per-category
    // commentary, then rankings — the instant it closes, so the panel fills
    // in progressively instead of staying blank until everything is done.
    let revealed = false;
    try {
      const res = await fetch("/api/compare/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: syms }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.json().then((j: { error?: string }) => j.error).catch(() => null);
        throw new Error(detail ?? `Comparison failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // NDJSON: complete lines only. A partial trailing line stays buffered.
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line || !isCurrent()) continue;

          let event: { type: "field"; key: string; data: unknown } | { type: "done"; result: ComparisonResult } | { type: "error"; error: string };
          try {
            event = JSON.parse(line);
          } catch {
            continue; // never let one malformed frame kill a good stream
          }

          if (event.type === "field") {
            // The first piece of real content flips off the "nothing yet"
            // skeleton so the panel starts showing what it has — the whole
            // point of streaming this at all.
            if (!revealed) { revealed = true; setAiLoading(false); }
            setAiResult((prev) => {
              const base = prev ?? {};
              if (AI_FIELD_KEYS.has(event.key)) {
                return { ...base, [event.key]: event.data };
              }
              const title = AI_SECTION_TITLES[event.key];
              if (title) {
                return { ...base, sectionCommentary: { ...base.sectionCommentary, [title]: event.data as string } };
              }
              return base; // overview/verdict/sections — not surfaced individually
            });
          } else if (event.type === "done") {
            const r = event.result;
            setAiResult({
              rankings: r.rankings,
              noClearWinner: r.noClearWinner,
              tradeoffSummary: r.tradeoffSummary,
              executiveSummary: r.executiveSummary,
              conditionsForChange: r.conditionsForChange,
              confidenceScore: r.confidenceScore,
              capitalAllocation: r.sections?.capitalAllocation,
              competitivePositioning: r.sections?.competitivePositioning,
              riskComparison: r.sections?.riskComparison,
              grounding: r.grounding,
              // Carried through the streaming path too, not just the blocking one:
              // partial tolerance means a comparison can succeed having dropped a
              // symbol, and the banner saying which is the only thing that
              // distinguishes "ranked 3 of 4" from "you only asked about 3".
              droppedSymbols: r.droppedSymbols,
              sectionCommentary: {
                Valuation: r.sections?.valuation || undefined,
                Growth: r.sections?.growth || undefined,
                Quality: r.sections?.quality || undefined,
                "Financial Health": r.sections?.financialHealth || undefined,
                Momentum: r.sections?.momentum || undefined,
              },
            });
          } else if (event.type === "error") {
            setAiResult((prev) => ({ ...(prev ?? {}), error: event.error }));
          }
        }
      }
    } catch (err) {
      if (!isCurrent()) return;
      // We cancelled this ourselves (superseded by a newer request, or the
      // component unmounted) — that is not a failure worth showing anyone.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAiResult((prev) => ({ ...(prev ?? {}), error: err instanceof Error ? err.message : "AI analysis failed" }));
    } finally {
      // A stale request's own loading/timer state belongs to whichever
      // request superseded it — touching it here would flip aiLoading back
      // to false out from under a still-running newer request.
      if (isCurrent()) {
        setAiLoading(false);
        setAiLoadingStartedAt(null);
      }
    }
  }

  function addSymbol(sym: string) {
    const upper = sym.trim().toUpperCase();
    if (!upper || symbols.length >= MAX) return;
    if (symbols.includes(upper)) return;
    setSymbols((prev) => [...prev, upper]);
    focus?.recordFocus(upper);
    setInput("");
    setAiResult(null);
  }

  function removeSymbol(sym: string) {
    setSymbols((prev) => prev.filter((s) => s !== sym));
    setEntries((prev) => prev.filter((e) => e.symbol !== sym));
  }

  function addClassSymbol(sym: string) {
    const upper = sym.trim().toUpperCase();
    if (!upper || classSymbols.length >= MAX) return;
    if (classSymbols.includes(upper)) return;
    setClassSymbols((prev) => [...prev, upper]);
    setClassInput("");
  }

  function removeClassSymbol(sym: string) {
    setClassSymbols((prev) => prev.filter((s) => s !== sym));
    setClassEntries((prev) => prev.filter((e) => e.symbol !== sym));
  }

  /** Switching classes starts a clean slate — a REIT comparison doesn't carry over when you pick Crypto. */
  function selectAssetClass(id: AssetClassId) {
    if (id === assetClass) return;
    setAssetClass(id);
    setClassSymbols([]);
    setClassInput("");
    setClassEntries([]);
    setClassFetchError(null);
  }

  function toggleSection(title: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function copyUrl() {
    void navigator.clipboard.writeText(window.location.href);
  }

  const validEntries = entries.filter((e) => !e.error);
  const validClassEntries = classEntries.filter((e) => !e.error);
  const reduceMotion = useReducedMotion();

  // Canonical color for a symbol — its index among ALL requested symbols
  // (including any that failed to load), matching the header cards and chips.
  // Deriving colors from a filtered/sorted subset elsewhere (charts, radar,
  // category-winner badges, risk table) previously assigned a *different*
  // color to the same symbol whenever another symbol in the comparison
  // errored out, e.g. comparing AAPL, BADTICKER, MSFT would show MSFT as
  // teal in its header card but orange in the performance chart.
  const colorForSymbol = useCallback(
    (symbol: string) => {
      const idx = entries.findIndex((e) => e.symbol === symbol);
      return COLORS[(idx >= 0 ? idx : 0) % COLORS.length];
    },
    [entries, COLORS],
  );

  // IOS — portfolio fit per entry
  const ios = useIOSSafe();
  const fitScores = useMemo<PortfolioFitAnalysis[]>(() => {
    if (!ios || !ios.profileReady) return [];
    return validEntries.map((e) =>
      ios.getPortfolioFit({
        symbol: e.symbol,
        sector: e.snapshot?.sector ?? null,
        marketCap: e.quote?.marketCap ?? null,
        scoreResult: e.score ?? null,
        dividendYield: e.snapshot?.dividendYield != null ? e.snapshot.dividendYield * 100 : null,
      }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ios?.profile.builtAt, ios?.profileReady, validEntries.length]);

  return (
    <HoverSymbolProvider>
      <BackgroundDepth />
      {/* Compare is a data grid, so it takes the wide (1920px) shell, not the
          default reading width — see the layout conventions in AGENTS.md. */}
      <PageShell py="py-10" width="wide">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Asset Comparison</h1>
            <span className="rounded-full border border-border px-2.5 py-0.5 text-label font-semibold uppercase tracking-widest text-muted">
              Up to {MAX} {getAssetClass(assetClass).noun}
            </span>
          </div>
          <p className="text-sm text-muted">
            {assetClass === "equity"
              ? "Side-by-side valuation, growth, quality, momentum, and analyst consensus. Tinted cells mark each metric's best and worst; click any row for detail."
              : getAssetClass(assetClass).description}
          </p>
        </div>
        {(assetClass === "equity" ? symbols.length > 0 : classSymbols.length > 0) && (
          <div className="flex items-center gap-2">
            {assetClass === "equity"
              ? validEntries.length > 0 && (
                  <button
                    onClick={() => {
                      setExportErr(null);
                      void downloadBlob("/api/export/compare", `compare-${validEntries.map((e) => e.symbol).join("-")}-${new Date().toISOString().slice(0, 10)}.xlsx`, "POST", { entries: validEntries })
                        .catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
                    }}
                    className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-surface-2"
                  >
                    ↓ Export Excel
                  </button>
                )
              : validClassEntries.length > 0 && (
                  <button
                    onClick={() => {
                      setExportErr(null);
                      void downloadBlob("/api/export/compare-class", `compare-${assetClass}-${validClassEntries.map((e) => e.symbol).join("-")}-${new Date().toISOString().slice(0, 10)}.xlsx`, "POST", { assetClass, entries: validClassEntries })
                        .catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
                    }}
                    className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-surface-2"
                  >
                    ↓ Export Excel
                  </button>
                )}
            {exportErr && <span className="text-xs text-negative">{exportErr}</span>}
            <button
              onClick={copyUrl}
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-surface-2"
            >
              Copy link ↗
            </button>
          </div>
        )}
      </div>

      {/* Asset class selector — same tab pattern as the Screener, so switching
          from Equities to REITs swaps the entire comparison experience: metrics,
          composite scores, radar dimensions, and signature chart all change. */}
      <nav className="flex flex-wrap gap-1.5" aria-label="Asset class">
        <button
          type="button"
          onClick={() => selectAssetClass("equity")}
          aria-current={assetClass === "equity"}
          className={assetTabClass(assetClass === "equity")}
        >
          Equities
        </button>
        {NON_EQUITY_CLASSES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => selectAssetClass(c.id)}
            aria-current={assetClass === c.id}
            className={assetTabClass(assetClass === c.id)}
          >
            {c.label}
          </button>
        ))}
      </nav>

      {assetClass === "equity" ? (
        <>
      {/* Symbol input row — global search across every market UAA supports */}
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <SymbolSearch
            value={input}
            onChange={setInput}
            onSelect={addSymbol}
            loading={loading}
            variant="rich"
            placeholder="Search any company worldwide — e.g. Apple, Reliance, Toyota, BMW"
          />
          <button onClick={() => addSymbol(input)} disabled={!input.trim() || symbols.length >= MAX}
            className="shrink-0 rounded-lg bg-brand-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
            Add
          </button>
        </div>
      </div>

      {/* Active symbol chips */}
      {symbols.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {symbols.map((sym, i) => (
            <span
              key={sym}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-mono font-semibold ${COLOR_BG[i % COLOR_BG.length]}`}
              style={{ color: COLORS[i % COLORS.length] }}
            >
              {sym}
              <button
                onClick={() => removeSymbol(sym)}
                className="ml-0.5 opacity-60 hover:opacity-100"
                aria-label={`Remove ${sym}`}
              >
                ✕
              </button>
            </span>
          ))}
          {symbols.length < MAX && (
            <span className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted">
              + add up to {MAX - symbols.length} more
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {fetchError && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {fetchError}
        </div>
      )}

      {/* Landing (no symbols) → loading → results, crossfading rather than
          popping so the empty-state preview "morphs" into the real thing. */}
      <AnimatePresence initial={false} mode={symbols.length === 0 ? "wait" : "sync"}>
        {symbols.length === 0 ? (
          <motion.div
            key="landing"
            exit={reduceMotion ? undefined : { opacity: 0, filter: "blur(4px)" }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <CompareLanding
              assetClass="equity"
              max={MAX}
              onQuickStart={(syms) => syms.forEach((s) => addSymbol(s))}
            />
          </motion.div>
        ) : loading ? (
          <motion.div key="loading" className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <LoadingMark size={20} label="Comparing" />
            {`Comparing ${symbols.join(", ")}…`}
          </motion.div>
        ) : entries.length > 0 ? (
        <motion.div
          key="results"
          initial={reduceMotion ? undefined : { opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col gap-6"
        >
          {/* Incomplete data banner */}
          {entries.some((e) => e.error) && (
            <Reveal index={0} className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm">
              <span className="font-semibold text-yellow-600 dark:text-yellow-400">⚠ Some symbols couldn&apos;t load: </span>
              {entries.filter((e) => e.error).map((e) => (
                <span key={e.symbol} className="mr-2 text-yellow-600 dark:text-yellow-400 font-mono">
                  {e.symbol} ({e.error})
                </span>
              ))}
            </Reveal>
          )}

          {/* Stock header cards — each staggers in rather than popping in together */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}
          >
            {entries.map((e, i) => (
              <Reveal key={e.symbol} index={i + 1}>
                <StockCard entry={e} color={COLORS[i % COLORS.length]} colorBg={COLOR_BG[i % COLOR_BG.length]} />
              </Reveal>
            ))}
          </div>

          {/* Ranked Verdict — auto-triggered on data load. Every asset ranked with its own thesis; no forced single winner. */}
          {validEntries.length >= 2 && (
            <Reveal index={entries.length + 1} className="rounded-xl border border-brand/20 bg-brand/5 p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">Ranked Verdict</h2>
                    <AiBadge />
                  </div>
                  <p className="text-xs text-muted">
                    {validEntries.map((e) => e.symbol).join(" vs ")} — every pick ranked with its own thesis
                  </p>
                </div>
                <button
                  onClick={() => void fetchAiVerdict(validEntries.map((e) => e.symbol))}
                  disabled={aiLoading}
                  className="rounded-lg bg-brand-strong px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {aiLoading ? "Analyzing…" : aiResult ? "Re-analyze" : "Run analysis"}
                </button>
              </div>
              {aiLoading && (
                <div className="mt-4 flex flex-col gap-2">
                  {[80, 60, 90, 50].map((w) => (
                    <Skeleton key={w} height="h-2.5" width="" radius="rounded-full" style={{ width: `${w}%` }} />
                  ))}
                  <p className="mt-1 text-xs text-muted">{aiLoadingLabel(aiLoadingElapsedMs)}</p>
                </div>
              )}
              {!aiLoading && aiResult && (
                <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
                  {aiResult.error ? (
                    <p className="text-sm text-negative">{aiResult.error}</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 flex-wrap">
                        {aiResult.noClearWinner && (
                          <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-warning">
                            Too close to call
                          </span>
                        )}
                        {aiResult.confidenceScore != null && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-label text-muted">
                            {aiResult.confidenceScore}% confidence
                          </span>
                        )}
                      </div>
                      {aiResult.droppedSymbols && aiResult.droppedSymbols.length > 0 && (
                        <p className="text-xs text-warning">
                          ⚠ {aiResult.droppedSymbols.map((d) => d.symbol).join(", ")} couldn&apos;t be analyzed — showing the ranking for the rest.
                        </p>
                      )}
                      {aiResult.executiveSummary && (
                        <p className="text-sm leading-6 text-foreground">{aiResult.executiveSummary}</p>
                      )}

                      {aiResult.rankings && aiResult.rankings.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {aiResult.rankings.map((r) => {
                            const idx = entries.findIndex((e) => e.symbol === r.symbol);
                            const color = idx >= 0 ? COLORS[idx % COLORS.length] : undefined;
                            return <RankedVerdictRow key={r.symbol} r={r} color={color} />;
                          })}
                        </div>
                      )}

                      {aiResult.tradeoffSummary && (
                        <p className="text-sm leading-6 text-muted">
                          <span className="font-semibold text-foreground">
                            {aiResult.noClearWinner ? "Depends on your objective: " : "Why this ranking: "}
                          </span>
                          {aiResult.tradeoffSummary}
                        </p>
                      )}
                      {aiResult.conditionsForChange && (
                        <p className="text-xs leading-5 text-muted">
                          <span className="font-semibold text-foreground">Would change if: </span>
                          {aiResult.conditionsForChange}
                        </p>
                      )}
                      {aiResult.grounding && <GroundingBadge grounding={aiResult.grounding} />}
                      {(aiResult.capitalAllocation || aiResult.competitivePositioning) && (
                        <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
                          {aiResult.capitalAllocation && (
                            <div>
                              <p className="text-label font-semibold uppercase tracking-widest text-muted/60">Capital Allocation</p>
                              <p className="mt-1 text-xs leading-5 text-muted">{aiResult.capitalAllocation}</p>
                            </div>
                          )}
                          {aiResult.competitivePositioning && (
                            <div>
                              <p className="text-label font-semibold uppercase tracking-widest text-muted/60">Competitive Positioning</p>
                              <p className="mt-1 text-xs leading-5 text-muted">{aiResult.competitivePositioning}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {!aiLoading && !aiResult && (
                <p className="mt-3 text-xs text-muted">Analyzing {validEntries.map((e) => e.symbol).join(" vs ")} — ranking every pick with its own thesis, strengths, and weaknesses…</p>
              )}
            </Reveal>
          )}

          {/* Winner by category — deterministic, derived from the metric table below (no AI) */}
          {validEntries.length >= 2 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3">
              <span className="text-label font-semibold uppercase tracking-widest text-muted/60 shrink-0">Winner by category</span>
              {computeCategoryWinners(
                SECTIONS.filter((s) => ["Valuation", "Growth", "Quality", "Financial Health", "Momentum"].includes(s.title)),
                validEntries,
                colorForSymbol,
              ).map((w) => (
                <span key={w.category} className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-caption">
                  <span className="text-muted">{w.category}: </span>
                  <span className="font-mono font-semibold" style={{ color: w.color }}>{w.symbol}</span>
                </span>
              ))}
            </div>
          )}

          {/* Risk comparison */}
          {validEntries.some((e) => e.risks?.length) && (
            <RiskComparisonSection entries={validEntries} colorForSymbol={colorForSymbol} />
          )}

          {/* Performance chart */}
          {validEntries.length >= 2 && (
            <CompareChart
              symbols={validEntries.map((e) => e.symbol)}
              colors={validEntries.map((e) => colorForSymbol(e.symbol))}
              marketCaps={Object.fromEntries(validEntries.map((e) => [e.symbol, e.quote?.marketCap]))}
              entries={validEntries}
            />
          )}

          {/* Radar chart */}
          {validEntries.length >= 2 && <CompareRadar entries={validEntries} colorForSymbol={colorForSymbol} />}

          {/* Portfolio Fit — IOS personalized comparison */}
          {ios?.profileReady && fitScores.length > 0 && !fitScores[0].isGeneric && (
            <PortfolioFitSection
              entries={validEntries}
              fits={fitScores}
              colorForSymbol={colorForSymbol}
              open={openSections.has("Portfolio Fit")}
              onToggle={() => toggleSection("Portfolio Fit")}
              missingSectors={ios.profile.missingSectors}
              overweightSectors={ios.profile.overweightSectors}
              objective={ios.profile.objective}
            />
          )}

          {/* Metric table — one sticky symbol header pinned over every section */}
          <div className="relative flex flex-col gap-3">
            <StickySymbolHeader entries={entries} colorForSymbol={colorForSymbol} />
            {SECTIONS.map((section) => (
              <MetricSection
                key={section.title}
                section={section}
                entries={entries}
                open={openSections.has(section.title)}
                onToggle={() => toggleSection(section.title)}
                aiCommentary={aiResult?.sectionCommentary?.[section.title]}
              />
            ))}
          </div>
        </motion.div>
        ) : null}
      </AnimatePresence>
        </>
      ) : (
        <>
          {/* Symbol input row — scoped to the selected asset class's universe */}
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <SymbolSearch
                value={classInput}
                onChange={setClassInput}
                onSelect={addClassSymbol}
                loading={classLoading}
                placeholder={`Search or type a ${NON_EQUITY_CLASSES.find((c) => c.id === assetClass)?.noun ?? "symbol"} ticker`}
              />
              <button onClick={() => addClassSymbol(classInput)} disabled={!classInput.trim() || classSymbols.length >= MAX}
                className="shrink-0 rounded-lg bg-brand-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
                Add
              </button>
            </div>
          </div>

          {/* Active symbol chips */}
          {classSymbols.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {classSymbols.map((sym, i) => (
                <span
                  key={sym}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-mono font-semibold ${COLOR_BG[i % COLOR_BG.length]}`}
                  style={{ color: COLORS[i % COLORS.length] }}
                >
                  {sym}
                  <button
                    onClick={() => removeClassSymbol(sym)}
                    className="ml-0.5 opacity-60 hover:opacity-100"
                    aria-label={`Remove ${sym}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {classSymbols.length < MAX && (
                <span className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted">
                  + add up to {MAX - classSymbols.length} more
                </span>
              )}
            </div>
          )}

          {classFetchError && (
            <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
              {classFetchError}
            </div>
          )}

          {/* Landing (no symbols) → loading → results, crossfading rather
              than popping so the empty-state preview "morphs" into the real
              comparison. Mirrors the equity branch above. */}
          <AnimatePresence initial={false} mode={classSymbols.length === 0 ? "wait" : "sync"}>
            {classSymbols.length === 0 ? (
              <motion.div
                key="landing"
                exit={reduceMotion ? undefined : { opacity: 0, filter: "blur(4px)" }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <CompareLanding
                  assetClass={assetClass}
                  max={MAX}
                  onQuickStart={(syms) => syms.forEach((s) => addClassSymbol(s))}
                />
              </motion.div>
            ) : classLoading ? (
              <motion.div key="loading" className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted">
                <div className="flex items-center gap-2">
                  <LoadingMark size={20} label="Comparing" />
                  {universeStatus?.stage === "building" && universeStatus.total > 0
                    ? `Building the ${getAssetClass(assetClass).label} universe — ${universeStatus.ready}/${universeStatus.total} (${Math.round((universeStatus.ready / universeStatus.total) * 100)}%)…`
                    : `Comparing ${classSymbols.join(", ")}…`}
                </div>
                {universeStatus?.stage === "building" && universeStatus.total > 0 && (
                  <p className="text-xs text-muted/70">First-time setup for this asset class — later comparisons will be instant.</p>
                )}
              </motion.div>
            ) : classEntries.length > 0 ? (
              <motion.div
                key="results"
                initial={reduceMotion ? undefined : { opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <ClassCompareView assetClass={assetClass} entries={classEntries} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      )}
    </PageShell>
    </HoverSymbolProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Stock header card                                                           */
/* -------------------------------------------------------------------------- */

function StockCard({ entry, color, colorBg }: { entry: CompareEntry; color: string; colorBg: string }) {
  // Hooks must run unconditionally — before the error-state early return below.
  const emphasis = useSymbolEmphasis(entry.symbol);
  const hoverHandlers = useHoverHandlers(entry.symbol);

  if (entry.error) {
    return (
      <div className="rounded-xl border border-negative/30 bg-negative/5 p-4">
        <span className="font-mono font-semibold" style={{ color }}>{entry.symbol}</span>
        <p className="mt-1 text-xs text-negative">{entry.error}</p>
      </div>
    );
  }

  const { quote, score, analyst, opportunity } = entry;
  const pos = (quote?.changePercent ?? 0) >= 0;

  return (
    <div
      {...hoverHandlers}
      className={`overflow-hidden rounded-xl border p-4 ${colorBg} ${emphasisClassName(emphasis)} ${emphasis === "active" ? "shadow-glow-brand" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/research?symbol=${entry.symbol}`}
            className="font-mono text-lg font-bold hover:underline"
            style={{ color }}
          >
            {entry.symbol}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted" title={entry.name}>{entry.name}</p>
          <Link
            href={`/journal?symbol=${encodeURIComponent(entry.symbol)}`}
            className="mt-1 inline-block text-label text-muted underline-offset-2 hover:text-brand hover:underline"
          >
            Open in Journal →
          </Link>
        </div>
        {analyst?.recommendationKey && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${recColor(analyst.recommendationKey)}`}>
            {recLabel(analyst.recommendationKey)}
          </span>
        )}
      </div>

      {opportunity && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-label font-semibold ${convictionColor(opportunity.conviction)}`}>
            {opportunity.opportunityScore}/100 · {opportunity.conviction}
          </span>
          <span className="text-label text-muted">{opportunity.categoryLabel}</span>
        </div>
      )}

      {quote && (
        <div className="mt-3">
          <div className="font-mono text-xl font-semibold">
            {formatCurrency(quote.price, quote.currency)}
          </div>
          <div className={`text-xs font-mono ${pos ? "text-positive" : "text-negative"}`}>
            {formatCurrency(quote.change, quote.currency)} ({formatPercent(quote.changePercent)})
          </div>
          <div className="mt-1 text-xs text-muted">
            {formatMarketCap(quote.marketCap)}
          </div>
        </div>
      )}

      {score && (
        <div className="mt-3 space-y-1.5">
          <ScoreBar label="Conviction" value={score.composite} color={color} />
          <ScoreBar label="Quality" value={entry.score ? bucketPct(entry.score, "Quality") : null} color={color} />
          <ScoreBar label="Growth" value={entry.score ? bucketPct(entry.score, "Growth") : null} color={color} />
          <ScoreBar label="Health" value={entry.score ? bucketPct(entry.score, "Financial Health") : null} color={color} />
        </div>
      )}

      {entry.freshness && (
        <div className="mt-3 flex flex-col gap-0.5 border-t border-border/50 pt-2">
          <DataProvenance source={entry.freshness.price.source} asOf={entry.freshness.price.asOf} ttlHours={0.02} liveLabel />
          <DataProvenance source={entry.freshness.fundamentals.source} asOf={entry.freshness.fundamentals.asOf} ttlHours={4} />
          {entry.freshness.statements && (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              {/* FY badge and separator are the short, fixed part of this
                  line — shrink-0 keeps them intact. The DataProvenance badge
                  is what's left to squeeze in the narrowest cards (5-way
                  comparisons), so it's the one that gets min-w-0 and
                  ellipsizes its own age text instead of the whole row
                  wrapping and leaving a stray "·" on its own line. */}
              <span className="shrink-0 font-medium text-foreground/80">FY{entry.freshness.statements.fiscalYear}</span>
              <span className="shrink-0">·</span>
              <DataProvenance
                className="min-w-0"
                source={entry.freshness.statements.source}
                asOf={entry.freshness.statements.asOf}
                ttlHours={24 * 90}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One ranking card in the AI verdict — part of cross-component focus mode: hovering GOOGL's card or chart line also highlights GOOGL's thesis here. */
function RankedVerdictRow({ r, color }: { r: RankedAsset; color: string | undefined }) {
  const emphasis = useSymbolEmphasis(r.symbol);
  const hoverHandlers = useHoverHandlers(r.symbol);

  return (
    <div
      {...hoverHandlers}
      className={`rounded-lg border p-3 ${emphasis === "active" ? "border-brand/40 bg-surface-2" : "border-border/60 bg-surface"} ${emphasisClassName(emphasis)}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-label font-semibold text-muted">
          {r.rank}
        </span>
        <span className="font-mono text-sm font-semibold" style={{ color }}>{r.symbol}</span>
        {r.bestFor && (
          <span className="text-label text-muted">— best for {r.bestFor}</span>
        )}
      </div>
      {r.thesis && <p className="mt-1.5 text-sm leading-6 text-foreground">{r.thesis}</p>}
      {(r.strengths.length > 0 || r.weaknesses.length > 0) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {r.strengths.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {r.strengths.map((s, i) => (
                <li key={i} className="text-xs leading-5 text-positive">+ {s}</li>
              ))}
            </ul>
          )}
          {r.weaknesses.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {r.weaknesses.map((w, i) => (
                <li key={i} className="text-xs leading-5 text-negative">− {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  if (value == null) return null;
  return (
    <div className="flex items-center gap-2">
      {/* Wide enough for the longest label ("Conviction", 10 chars) — a
          narrower fixed width let it overflow the box and run straight into
          the bar with no gap, while shorter labels (Quality/Growth/Health)
          happened to fit and looked fine, so the misalignment only showed on
          one row. shrink-0 + whitespace-nowrap keep it fixed-width even in
          the narrowest card column (5-stock comparisons). */}
      <span className="w-20 shrink-0 whitespace-nowrap text-right text-xs text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: color, opacity: 0.8 }}
        />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-xs font-semibold" style={{ color }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Metric table section                                                        */
/* -------------------------------------------------------------------------- */

/* Shared column geometry: the metric-label column is fixed-width, symbol
   columns split the rest equally. The sticky header (a CSS grid) and every
   section table (table-fixed + colgroup) use the same numbers, so columns
   align exactly across separate tables and the header can stay pinned while
   sections scroll underneath it. */
const LABEL_COL_PX = 240;

/** One pinned symbol header for the whole metric table — replaces the per-section header rows, so the reader always knows which column is which. */
function StickySymbolHeader({ entries, colorForSymbol }: { entries: CompareEntry[]; colorForSymbol: (symbol: string) => string }) {
  const { hovered, setHovered } = useHoverSymbol();
  // top-14 clears the app header (sticky, 56px, z-40) so the two stack instead of overlapping.
  return (
    <div className="sticky top-14 z-30 overflow-hidden rounded-xl border border-border bg-surface/95 shadow-sm backdrop-blur">
      <div className="grid" style={{ gridTemplateColumns: `${LABEL_COL_PX}px repeat(${entries.length}, minmax(0, 1fr))` }}>
        <span className="px-4 py-2.5 text-label font-semibold uppercase tracking-widest text-muted/60">Metric</span>
        {entries.map((e) => {
          const emphasis: SymbolEmphasis = hovered == null ? "none" : hovered === e.symbol ? "active" : "dimmed";
          return (
            <span
              key={e.symbol}
              onMouseEnter={() => setHovered(e.symbol)}
              onMouseLeave={() => setHovered(null)}
              className={`truncate px-4 py-2.5 text-right font-mono text-xs font-bold ${emphasisClassName(emphasis)}`}
              style={{ color: colorForSymbol(e.symbol) }}
              title={e.symbol}
            >
              {e.symbol}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Sections whose rows are pure engine output — the absence of AI commentary there is deliberate, and said so. */
const DETERMINISTIC_SECTIONS = new Set(["Analyst Consensus", "Conviction & dimensions"]);

function MetricSection({
  section,
  entries,
  open,
  onToggle,
  aiCommentary,
}: {
  section: SectionDef;
  entries: CompareEntry[];
  open: boolean;
  onToggle: () => void;
  /** AI-written ranking rationale for this section (lib/ai-compare.ts). Absent while the AI verdict hasn't run yet or when the AI is unavailable — the deterministic table never depends on it. */
  aiCommentary?: string;
}) {
  const rows = section.metrics.map((metric) => ({ metric, cells: rowValues(metric, entries) }));
  // A row where every loadable cell is sector-inapplicable is dead weight —
  // aggregate those into one caption instead of rendering rows of "n/a".
  const isDead = (cells: { value: number | null; naReason: string | null }[]) =>
    cells.every((c) => c.naReason != null || c.value == null) && cells.some((c) => c.naReason != null);
  const liveRows = rows.filter(({ cells }) => !isDead(cells));
  const deadRows = rows.filter(({ cells }) => isDead(cells));

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* Section header */}
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-b border-border/60 bg-surface-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold uppercase tracking-wide">{section.title}</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={`text-muted transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>

      <Collapsible open={open}>
        {aiCommentary ? (
          <div className="border-b border-border bg-brand/5 px-4 py-3">
            <div className="flex max-w-3xl items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded-full border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-widest text-brand">AI</span>
              <p className="text-xs leading-6 text-foreground/80">{aiCommentary}</p>
            </div>
          </div>
        ) : DETERMINISTIC_SECTIONS.has(section.title) ? (
          <p className="border-b border-border/60 px-4 py-2 text-label text-muted/70">
            Computed directly from the data — no AI commentary for this section.
          </p>
        ) : null}
        {liveRows.length > 0 ? (
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: LABEL_COL_PX }} />
              {entries.map((e) => (
                <col key={e.symbol} />
              ))}
            </colgroup>
            <tbody className="divide-y divide-border">
              {liveRows.map(({ metric, cells }) => (
                <MetricRow key={metric.id} metric={metric} entries={entries} cells={cells} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-3 text-xs text-muted">
            None of this section&apos;s metrics apply to the selected assets.
          </p>
        )}
        {deadRows.length > 0 && (
          <p
            className="border-t border-border/60 px-4 py-2 text-label text-muted/70"
            title={deadRows.map(({ metric, cells }) => `${metric.label}: ${cells.find((c) => c.naReason)?.naReason ?? ""}`).join("\n")}
          >
            Not applicable for these assets: {deadRows.map(({ metric }) => metric.label).join(", ")}
          </p>
        )}
      </Collapsible>
    </div>
  );
}

function MetricRow({
  metric,
  entries,
  cells,
}: {
  metric: MetricDef;
  entries: CompareEntry[];
  cells: { value: number | null; naReason: string | null }[];
}) {
  // Click-to-expand (multiple rows can stay open; state survives sibling
  // toggles and scrolling because it lives on the row itself). Hover does
  // NOTHING to layout — background color only.
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const values = cells.map((c) => c.value);
  const highlights: RowHighlights | null = resolveRowHighlights(values, metric.direction, metric.format);

  const benchmarks = entries.map((e, i) =>
    metric.benchmarkKey && !cells[i].naReason ? e.benchmarks?.[metric.benchmarkKey] : undefined,
  );
  // The sector average is identical text for every column when all entries
  // share a peer group (the common same-sector comparison) — hoist it to the
  // label column once instead of printing it five times. Cross-sector rows
  // keep their per-cell context in the expanded detail + chip tooltip.
  const peerLabels = [...new Set(benchmarks.filter((b): b is PeerBenchmark => b != null).map((b) => b.peerLabel))];
  const sharedPeer = peerLabels.length === 1 ? benchmarks.find((b): b is PeerBenchmark => b != null)! : null;

  function toggle() {
    setExpanded((v) => !v);
  }

  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={toggle}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            toggle();
          }
        }}
        className="cursor-pointer bg-surface transition-colors duration-150 ease-out hover:bg-surface-2/60 motion-reduce:transition-none"
      >
        <td className="px-4 py-2 align-top">
          <div className="flex min-h-10 items-start gap-1.5">
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden
              className={`mt-1 shrink-0 text-muted/70 transition-transform duration-200 ease-out motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
            >
              <path d="M3.5 2l3 3-3 3" />
            </svg>
            <div className="min-w-0">
              <span className="text-xs text-foreground">{metric.label}</span>
              {metric.sub && <p className="text-label text-muted">{metric.sub}</p>}
              {sharedPeer && (
                <p className="text-label leading-tight text-muted/80" title={`Average across ${sharedPeer.peerCount} peers`}>
                  {sharedPeer.peerLabel} avg {metric.format(sharedPeer.peerAverage)}
                </p>
              )}
            </div>
          </div>
        </td>
        {cells.map((cell, i) => {
          const isBest = highlights?.best.includes(i) ?? false;
          const isWorst = highlights?.worst.includes(i) ?? false;
          // Best/worst is a background tint + neutral dot on the cell itself
          // (exact cell bounds — no offset wrapper), never a recolored number
          // and never a directional glyph: a ▲ on the LOWEST P/E read
          // backwards. For lower_is_better metrics the best (smallest) value
          // still gets the positive tint.
          const tint = isBest ? "bg-positive/10" : isWorst ? "bg-negative/10" : "";
          const val = cell.value;
          // Signed value color marks the number's own sign (returns/changes
          // only) — the ONLY place the number itself is colored.
          const signedClass =
            metric.signed && val != null ? (val > 0 ? "text-positive" : val < 0 ? "text-negative" : "") : "";
          const benchmark = benchmarks[i];
          return (
            <td key={i} className={`px-4 py-2 text-right align-top ${tint}`}>
              <div className="flex min-h-10 flex-col items-end gap-0.5">
                {cell.naReason ? (
                  <span className="text-label italic text-muted/60" title={cell.naReason}>
                    n/a
                  </span>
                ) : val == null ? (
                  <span className="text-muted" title="No data available">—</span>
                ) : (
                  <>
                    <span className={`font-mono text-sm tabular-nums ${signedClass}`}>
                      {(isBest || isWorst) && (
                        <>
                          <span
                            aria-hidden
                            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${isBest ? "bg-positive/80" : "bg-negative/80"}`}
                          />
                          <span className="sr-only">{isBest ? "best in row" : "worst in row"}</span>
                        </>
                      )}
                      <CountUp value={val} format={metric.format} />
                      {metric.format === score100 && <span className="ml-1 text-label text-muted">/100</span>}
                    </span>
                    {benchmark && (
                      <span
                        className="rounded-full bg-surface-2 px-1.5 py-px text-micro tabular-nums text-muted"
                        title={`${benchmark.peerLabel} avg ${metric.format(benchmark.peerAverage)} · vs ${benchmark.peerCount} peers`}
                      >
                        {ordinal(benchmark.percentile)} pct
                      </span>
                    )}
                  </>
                )}
              </div>
            </td>
          );
        })}
      </tr>
      {expanded && (
        <tr id={detailId} className="bg-surface-2/40">
          <td colSpan={entries.length + 1} className="px-4 py-2.5">
            {metric.description && <p className="max-w-3xl text-xs leading-5 text-muted">{metric.description}</p>}
            {benchmarks.some((b) => b != null) && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                {entries.map((e, i) => {
                  const b = benchmarks[i];
                  if (!b) return null;
                  return (
                    <span key={e.symbol} className="text-label text-muted">
                      <span className="font-mono font-semibold">{e.symbol}</span>: {ordinal(b.percentile)} pct of {b.peerCount} {b.peerLabel} peers (avg {metric.format(b.peerAverage)})
                    </span>
                  );
                })}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Portfolio Fit section — IOS personalized comparison                        */
/* -------------------------------------------------------------------------- */

function PortfolioFitSection({
  entries,
  fits,
  colorForSymbol,
  open,
  onToggle,
  missingSectors = [],
  overweightSectors = [],
  objective = "",
}: {
  entries: CompareEntry[];
  fits: PortfolioFitAnalysis[];
  /** Canonical color for a symbol (its index among ALL requested symbols) — see colorForSymbol in ComparePage. Falls back to positional coloring within `entries` if omitted. */
  colorForSymbol?: (symbol: string) => string;
  open: boolean;
  onToggle: () => void;
  missingSectors?: string[];
  overweightSectors?: string[];
  objective?: string;
}) {
  const colorOf = colorForSymbol ?? ((symbol: string) => COLORS_DARK[entries.findIndex((e) => e.symbol === symbol) % COLORS_DARK.length]);
  const bestIdx = fits.reduce(
    (best, f, i) => (f.fitScore > (fits[best]?.fitScore ?? -1) ? i : best),
    0,
  );

  const bestFit  = fits[bestIdx];
  const bestEntry = entries[bestIdx];

  // Synthesize a personalized narrative for the winner.
  function buildWinnerNarrative(): string | null {
    if (!bestFit || !bestEntry) return null;
    const parts: string[] = [`${bestEntry.symbol} is your best portfolio fit (${bestFit.fitScore}/100).`];
    if (bestFit.reasons[0]) parts.push(bestFit.reasons[0]);
    const filledSector = missingSectors.find((s) => bestFit.dimensions.sector.score > 65 && bestFit.dimensions.sector.message?.includes(s));
    if (filledSector) parts.push(`Fills your missing ${filledSector} gap.`);
    if (overweightSectors.some((s) => bestFit.dimensions.sector.message?.includes(s))) {
      parts.push(`Note: your portfolio already has concentration in ${overweightSectors[0]}.`);
    }
    if (bestFit.suggestedAllocationPct && bestFit.suggestedAllocationPct > 0) {
      parts.push(`Suggested allocation: ${bestFit.suggestedAllocationPct.toFixed(1)}%.`);
    }
    return parts.join(" ");
  }

  const winnerNarrative = buildWinnerNarrative();

  // Every 8-10s, a single soft shimmer sweep across the recommended asset's
  // callout border — never a pulse, never a loop. Skipped under
  // prefers-reduced-motion entirely rather than firing silently.
  const [shimmer, setShimmer] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const intervalId = setInterval(() => {
      setShimmer(true);
      timeoutId = setTimeout(() => setShimmer(false), 1600);
    }, 9000);
    return () => { clearInterval(intervalId); clearTimeout(timeoutId); };
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-brand/20 bg-brand/3">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between bg-brand/5 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Portfolio Fit</span>
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-brand">
            IOS
          </span>
          <span className="text-caption text-muted">
            {objective ? `${objective.replace(/_/g, " ")} objective · ` : ""}personalised to your portfolio
          </span>
        </div>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={`text-muted transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>

      {/* Winner narrative — always visible when section is rendered */}
      {winnerNarrative && (
        <div className={`m-2 rounded-lg border border-brand/15 bg-brand/5 px-4 py-2.5 ${shimmer ? "animate-border-shimmer" : ""}`}>
          <p className="text-caption text-foreground/80 leading-4">{winnerNarrative}</p>
        </div>
      )}

      {open && (() => {
        /* Generic identical-row collapse: a row whose displayed value is the
           same in every column carries zero comparative information — render
           it once as a shared line above the table instead of n copies.
           Applies to ANY all-identical row, present or future. */
        interface FitRow {
          label: string;
          hint?: string;
          display: (f: PortfolioFitAnalysis) => string;
          render?: (f: PortfolioFitAnalysis, i: number) => ReactNode;
        }
        const scoreTone = (score: number) =>
          score >= 65 ? "text-positive" : score >= 45 ? "text-warning" : "text-negative";
        const fitRows: FitRow[] = [
          {
            label: "Portfolio Fit Score",
            hint: "0-100 · higher = better fit",
            display: (f) => `${f.fitScore}/100`,
            render: (f) => <PortfolioFitBadge score={f.fitScore} tier={f.fitTier} size="sm" />,
          },
          {
            label: "Key Reason",
            display: (f) => f.reasons[0] ?? "—",
            render: (f) => <span className="text-label text-muted">{f.reasons[0] ?? "—"}</span>,
          },
          {
            label: "Suggested Allocation",
            display: (f) => (f.suggestedAllocationPct > 0 ? `${f.suggestedAllocationPct.toFixed(1)}%` : "—"),
            render: (f) => (
              <span className="font-mono text-xs tabular-nums">
                {f.suggestedAllocationPct > 0 ? `${f.suggestedAllocationPct.toFixed(1)}%` : "—"}
              </span>
            ),
          },
          {
            label: "Sector Fit",
            display: (f) => `${f.dimensions.sector.score}/100`,
            render: (f) => (
              <span className="font-mono text-xs tabular-nums">
                <span className={scoreTone(f.dimensions.sector.score)}>{f.dimensions.sector.score}</span>
                <span className="ml-1 text-label text-muted">/100</span>
              </span>
            ),
          },
          {
            label: "Objective Alignment",
            display: (f) => `${f.dimensions.objective.score}/100`,
            render: (f) => (
              <span className="font-mono text-xs tabular-nums">
                <span className={scoreTone(f.dimensions.objective.score)}>{f.dimensions.objective.score}</span>
                <span className="ml-1 text-label text-muted">/100</span>
              </span>
            ),
          },
        ];
        const isShared = (row: FitRow) => fits.length > 1 && new Set(fits.map(row.display)).size === 1;
        const sharedRows = fitRows.filter(isShared);
        const comparedRows = fitRows.filter((r) => !isShared(r));

        return (
          <>
            {sharedRows.length > 0 && (
              <div className="border-t border-border bg-surface px-4 py-2.5">
                {sharedRows.map((row) => (
                  <p key={row.label} className="text-caption text-muted">
                    <span className="font-medium text-foreground/80">{row.label}</span>{" "}
                    {row.display(fits[0])}
                    <span className="text-muted/70"> — identical for all {fits.length}</span>
                  </p>
                ))}
              </div>
            )}
            {comparedRows.length > 0 && (
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col style={{ width: LABEL_COL_PX }} />
                  {entries.map((e) => (
                    <col key={e.symbol} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-t border-border bg-surface">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted">Metric</th>
                    {entries.map((e, i) => (
                      <th
                        key={e.symbol}
                        className="truncate px-4 py-2.5 text-right text-xs font-mono font-bold"
                        style={{ color: colorOf(e.symbol) }}
                      >
                        {e.symbol}
                        {i === bestIdx && <span className="ml-1 text-micro text-brand">★ Best fit</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {comparedRows.map((row) => (
                    <tr key={row.label} className="bg-surface">
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-foreground">{row.label}</span>
                        {row.hint && <p className="text-label text-muted">{row.hint}</p>}
                      </td>
                      {fits.map((f, i) => (
                        <td key={i} className={`px-4 py-2.5 text-right ${row.label === "Portfolio Fit Score" && i === bestIdx ? "bg-positive/5" : ""}`}>
                          {row.render ? row.render(f, i) : <span className="font-mono text-xs tabular-nums">{row.display(f)}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        );
      })()}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Risk comparison — reuses assessRisks() output already computed server-side  */
/* -------------------------------------------------------------------------- */

const RISK_LEVEL_STYLE: Record<string, string> = {
  low: "text-positive",
  medium: "text-warning",
  high: "text-negative",
};

function RiskComparisonSection({ entries, colorForSymbol }: { entries: CompareEntry[]; colorForSymbol: (symbol: string) => string }) {
  const categories = [...new Set(entries.flatMap((e) => (e.risks ?? []).map((r) => r.category)))];

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between bg-surface-2 px-4 py-3">
        <span className="text-sm font-semibold">Risk Comparison</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-t border-border bg-surface">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted w-32">Category</th>
            {entries.map((e) => (
              <th key={e.symbol} className="px-4 py-2.5 text-right text-xs font-mono font-bold" style={{ color: colorForSymbol(e.symbol) }}>
                {e.symbol}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {categories.map((cat) => (
            <tr key={cat} className="bg-surface">
              <td className="px-4 py-2.5 text-xs text-foreground">{cat}</td>
              {entries.map((e) => {
                const r = (e.risks ?? []).find((x) => x.category === cat);
                return (
                  <td key={e.symbol} className="px-4 py-2.5 text-right">
                    {r ? (
                      <span className={`text-caption ${RISK_LEVEL_STYLE[r.level] ?? "text-muted"}`} title={r.reason}>
                        {r.level} — {r.reason}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
