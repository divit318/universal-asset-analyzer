"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CompareLanding } from "./_components/landing/compare-landing";
import { HoverSymbolProvider, useHoverSymbol, useHoverHandlers, useSymbolEmphasis, emphasisClassName, type SymbolEmphasis } from "./_components/hover-symbol-context";
import { BackgroundDepth } from "./_components/background-depth";
import { Collapsible } from "./_components/collapsible-section";
import { CountUp } from "@/app/_components/count-up";
import { useInViewOnce } from "@/app/_components/use-in-view-once";
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
import { formatCurrency, formatMarketCap, formatPercent } from "@/lib/format";
import { useIOSSafe } from "@/lib/ios-context";
import { PortfolioFitBadge } from "@/app/_components/portfolio-fit-badge";
import { PageShell, Skeleton } from "@/app/_components/ui";
import { CHART_SERIES } from "@/app/_components/chart-theme";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";

const NON_EQUITY_CLASSES = listAssetClasses().filter((c) => c.id !== "equity");

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const MAX = 5;
/* Single source of truth (CHART_SERIES) so the cards, radar chart, and line
   chart never drift out of sync. Deliberately avoids green/red — those
   already mean positive/negative (price change, score deltas) elsewhere on
   this page — so categorical stock identity can't be misread as a gain/loss
   signal. Order: purple, orange, teal, brown, slate. */
const COLORS: string[] = [...CHART_SERIES];
const COLOR_BG = [
  "bg-purple-500/10 border-purple-500/30",
  "bg-orange-500/10 border-orange-500/30",
  "bg-teal-500/10 border-teal-500/30",
  "bg-[#b5651d]/10 border-[#b5651d]/30",
  "bg-slate-500/10 border-slate-500/30",
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
  label: string;
  sub?: string;
  /** One line, revealed on row hover — what the metric means, not just how to read its direction (that's `sub`). */
  description?: string;
  getValue: (e: CompareEntry) => number | null;
  format: (v: number) => string;
  higherBetter: boolean | null;
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

const pctSigned = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const pctAbs = (v: number) => `${v.toFixed(1)}%`;
const xRatio = (v: number) => `${v.toFixed(1)}x`;
const integer = (v: number) => Math.round(v).toString();
const score100 = (v: number) => `${Math.round(v)}`;

const SECTIONS: SectionDef[] = [
  {
    title: "Valuation",
    metrics: [
      { label: "Forward P/E", sub: "lower = cheaper", description: "Price relative to next year's expected earnings.", getValue: (e) => e.snapshot?.forwardPE ?? null, format: xRatio, higherBetter: false, benchmarkKey: "forwardPE" },
      { label: "Trailing P/E", description: "Price relative to the last twelve months of earnings.", getValue: (e) => e.snapshot?.trailingPE ?? null, format: xRatio, higherBetter: false },
      { label: "PEG Ratio", sub: "P/E ÷ growth", description: "P/E adjusted for growth — under 1x is often considered cheap for the growth on offer.", getValue: (e) => e.snapshot?.pegRatio ?? null, format: xRatio, higherBetter: false, benchmarkKey: "pegRatio" },
      { label: "Price / Book", description: "Price relative to net asset value on the balance sheet.", getValue: (e) => e.snapshot?.priceToBook ?? null, format: xRatio, higherBetter: false },
      { label: "FCF Yield", sub: "higher = more value", description: "Free cash flow as a percentage of market cap — the cash-based answer to \"is it cheap?\"", getValue: (e) => e.fcfYieldPct ?? null, format: pctAbs, higherBetter: true, benchmarkKey: "fcfYield" },
      { label: "Analyst Target Upside", description: "Consensus price target versus the current price.", getValue: (e) => e.analyst?.upsidePercent ?? null, format: pctSigned, higherBetter: true },
    ],
  },
  {
    title: "Growth",
    metrics: [
      { label: "Revenue Growth YoY", description: "Year-over-year revenue increase.", getValue: (e) => e.snapshot?.revenueGrowth != null ? e.snapshot.revenueGrowth * 100 : null, format: pctSigned, higherBetter: true, benchmarkKey: "revenueGrowthYoY" },
      { label: "Earnings Growth YoY", description: "Year-over-year net income increase.", getValue: (e) => e.snapshot?.earningsGrowth != null ? e.snapshot.earningsGrowth * 100 : null, format: pctSigned, higherBetter: true },
      { label: "Revenue CAGR 3Y", description: "Compound annual revenue growth over the last 3 fiscal years.", getValue: (e) => e.statements?.revenueCagr != null ? e.statements.revenueCagr * 100 : null, format: pctSigned, higherBetter: true },
      { label: "FCF CAGR 3Y", description: "Compound annual free cash flow growth over the last 3 fiscal years.", getValue: (e) => e.statements?.fcfCagr != null ? e.statements.fcfCagr * 100 : null, format: pctSigned, higherBetter: true },
    ],
  },
  {
    title: "Quality",
    metrics: [
      { label: "Return on Equity", description: "Net income as a percentage of shareholder equity — how efficiently the company compounds capital.", getValue: (e) => e.snapshot?.returnOnEquity != null ? e.snapshot.returnOnEquity * 100 : null, format: pctAbs, higherBetter: true, benchmarkKey: "roe" },
      { label: "Return on Assets", description: "Net income as a percentage of total assets.", getValue: (e) => e.snapshot?.returnOnAssets != null ? e.snapshot.returnOnAssets * 100 : null, format: pctAbs, higherBetter: true },
      { label: "Gross Margin", description: "Revenue left after cost of goods sold.", getValue: (e) => e.snapshot?.grossMargins != null ? e.snapshot.grossMargins * 100 : null, format: pctAbs, higherBetter: true, benchmarkKey: "grossMargin" },
      { label: "Operating Margin", description: "Revenue left after operating expenses — core profitability before interest and tax.", getValue: (e) => e.snapshot?.operatingMargins != null ? e.snapshot.operatingMargins * 100 : null, format: pctAbs, higherBetter: true, benchmarkKey: "operatingMargin" },
      { label: "Net Profit Margin", description: "Revenue left after all expenses, interest and tax.", getValue: (e) => e.snapshot?.profitMargins != null ? e.snapshot.profitMargins * 100 : null, format: pctAbs, higherBetter: true },
      { label: "EBITDA Margin", description: "Earnings before interest, tax, depreciation and amortization, as a share of revenue.", getValue: (e) => e.snapshot?.ebitdaMargins != null ? e.snapshot.ebitdaMargins * 100 : null, format: pctAbs, higherBetter: true },
    ],
  },
  {
    title: "Financial Health",
    metrics: [
      { label: "Debt / Equity", sub: "lower = safer", description: "Total debt relative to shareholder equity — leverage on the balance sheet.", getValue: (e) => e.snapshot?.debtToEquity ?? null, format: xRatio, higherBetter: false, benchmarkKey: "debtToEquity" },
      { label: "Net Debt / EBITDA", description: "Debt net of cash, relative to a year of earnings — how many years to pay it off.", getValue: (e) => e.netDebtToEbitda ?? null, format: xRatio, higherBetter: false },
      { label: "Current Ratio", sub: "higher = more liquid", description: "Current assets divided by current liabilities — short-term liquidity.", getValue: (e) => e.snapshot?.currentRatio ?? null, format: xRatio, higherBetter: true },
      { label: "Quick Ratio", description: "Current assets excluding inventory, divided by current liabilities — a stricter liquidity test.", getValue: (e) => e.snapshot?.quickRatio ?? null, format: xRatio, higherBetter: true },
      { label: "Dividend Yield", description: "Trailing annual dividend as a percentage of the current price.", getValue: (e) => e.snapshot?.dividendYield != null ? e.snapshot.dividendYield * 100 : null, format: pctAbs, higherBetter: true, benchmarkKey: "dividendYield" },
    ],
  },
  {
    title: "Momentum",
    metrics: [
      { label: "1-Year Return", description: "Trailing twelve-month price return.", getValue: (e) => e.oneYearReturn ?? null, format: pctSigned, higherBetter: true, benchmarkKey: "oneYearReturn" },
      { label: "3-Month Return", description: "Trailing three-month price return.", getValue: (e) => e.momentum?.return3m ?? null, format: pctSigned, higherBetter: true },
      { label: "vs SMA 200", sub: "% above/below", description: "Distance above or below the 200-day moving average — the long-term trend line.", getValue: (e) => e.momentum?.vsSma200 ?? null, format: pctSigned, higherBetter: true },
      { label: "vs SMA 50", description: "Distance above or below the 50-day moving average — the medium-term trend line.", getValue: (e) => e.momentum?.vsSma50 ?? null, format: pctSigned, higherBetter: true },
      { label: "From 52W High", sub: "0 = at the high", description: "Distance below the 52-week high — 0% means it's at the high right now.", getValue: (e) => e.momentum?.pctFrom52WkHigh ?? null, format: pctSigned, higherBetter: true, benchmarkKey: "distanceFrom52WkHigh" },
    ],
  },
  {
    title: "Analyst Consensus",
    metrics: [
      { label: "Target Upside %", description: "Consensus price target versus the current price.", getValue: (e) => e.analyst?.upsidePercent ?? null, format: pctSigned, higherBetter: true },
      { label: "# Analysts", description: "Number of analysts covering the stock.", getValue: (e) => e.analyst?.numberOfOpinions ?? null, format: integer, higherBetter: null },
      { label: "Strong Buy + Buy", description: "Analysts rating the stock a buy or strong buy.", getValue: (e) => e.analyst ? e.analyst.strongBuy + e.analyst.buy : null, format: integer, higherBetter: true },
      { label: "Hold", description: "Analysts rating the stock a hold.", getValue: (e) => e.analyst?.hold ?? null, format: integer, higherBetter: null },
      { label: "Sell + Strong Sell", description: "Analysts rating the stock a sell or strong sell.", getValue: (e) => e.analyst ? e.analyst.sell + e.analyst.strongSell : null, format: integer, higherBetter: false },
      {
        label: "Avg EPS Surprise",
        description: "Average earnings beat or miss versus estimates, across recent quarters.",
        getValue: (e) => {
          const s = e.analyst?.epsSurprises;
          if (!s || s.length === 0) return null;
          return s.reduce((a, b) => a + b, 0) / s.length;
        },
        format: pctSigned,
        higherBetter: true,
      },
      {
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
        higherBetter: true,
      },
    ],
  },
  {
    title: "Conviction & dimensions",
    metrics: [
      // Named "Conviction" because it IS /research's Conviction score — same
      // engine, and now the same inputs. "Overall Score" gave a reader no way to
      // tell it apart from the Screener's Overall, which is a different engine.
      { label: "Conviction", description: "The same Conviction score /research shows — blended across every dimension below.", getValue: (e) => e.score?.composite ?? null, format: score100, higherBetter: true },
      { label: "Fundamental Score", description: "Composite of valuation, growth, quality and financial health — excludes momentum and analyst signals.", getValue: (e) => e.score?.total ?? null, format: score100, higherBetter: true },
      { label: "Valuation Score", description: "How cheap the stock is relative to its own scoring bands.", getValue: (e) => (e.score ? bucketPct(e.score, "Valuation") : null), format: score100, higherBetter: true },
      { label: "Growth Score", description: "How fast the business is growing relative to its own scoring bands.", getValue: (e) => (e.score ? bucketPct(e.score, "Growth") : null), format: score100, higherBetter: true },
      { label: "Quality Score", description: "Profitability and capital efficiency relative to its own scoring bands.", getValue: (e) => (e.score ? bucketPct(e.score, "Quality") : null), format: score100, higherBetter: true },
      { label: "Financial Health Score", description: "Balance-sheet strength relative to its own scoring bands.", getValue: (e) => (e.score ? bucketPct(e.score, "Financial Health") : null), format: score100, higherBetter: true },
      { label: "Momentum Signal", description: "Price trend strength — how the stock has been trading recently.", getValue: (e) => e.score?.signals.momentum ?? null, format: score100, higherBetter: true },
      { label: "Analyst Signal", description: "Consensus analyst sentiment, distilled into a single score.", getValue: (e) => e.score?.signals.analysts ?? null, format: score100, higherBetter: true },
      { label: "Confidence", description: "How much underlying data supports this stock's Conviction score — lower when data is sparse.", getValue: (e) => e.score?.confidence ?? null, format: score100, higherBetter: true },
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

interface WinnerInfo {
  /** null when the leading (or trailing) values are within tie tolerance of
   * each other — no entry gets a decisive best/worst badge for a wash. */
  bestIdx: number | null;
  worstIdx: number | null;
}

/** Two values are a "tie" within 5% of each other — same tolerance
 * lib/ai-compare.ts's `bestIndex` uses for the AI-generated metric table, so
 * the deterministic table and the AI verdict never disagree about whether a
 * metric was close. Without this, e.g. a 20.0x vs 20.05x P/E rendered one
 * side green and the other red for a difference that isn't meaningful. */
function isTie(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05 * Math.max(Math.abs(a), Math.abs(b), 1e-9);
}

function findWinners(values: (number | null)[], higherBetter: boolean | null): WinnerInfo | null {
  if (higherBetter == null) return null;
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null);
  if (valid.length < 2) return null;
  const sorted = [...valid].sort((a, b) => (higherBetter ? b.v - a.v : a.v - b.v));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const bestTied = sorted.filter((x) => isTie(x.v, best.v)).length > 1;
  const worstTied = sorted.filter((x) => isTie(x.v, worst.v)).length > 1;
  return {
    bestIdx: bestTied ? null : best.i,
    worstIdx: worstTied ? null : worst.i,
  };
}

/**
 * Progressive status copy for the AI verdict's loading state, keyed by how
 * long it's been running. A single static "Running Ollama analysis..." used
 * to sit on screen unchanged whether the answer was 5 seconds or 5 minutes
 * away, which reads as broken/stuck well before a cold-loaded model
 * (observed: up to several minutes under memory pressure — see
 * lib/ai/router.ts's cold-start budget) actually finishes. None of this
 * requires the backend to report real-time phase — it's calibrated to the
 * router's own documented timings (a model typically answers in seconds once
 * warm; a cold load is the multi-minute case) so the copy stays honest
 * without new plumbing.
 */
function aiLoadingLabel(elapsedMs: number): string {
  if (elapsedMs < 8_000) return "Preparing AI — routing to the best local model…";
  if (elapsedMs < 30_000) return "Analyzing — typically ~30s once the model is warm…";
  if (elapsedMs < 90_000) return "Still working — this model may be loading for the first time (cold start)…";
  return "Model warming up under load — this can take a few minutes on a busy machine. The metric table above is already complete either way.";
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
      if (metric.higherBetter == null) continue;
      const values = entries.map((e) => (e.error ? null : metric.getValue(e)));
      const w = findWinners(values, metric.higherBetter);
      if (w?.bestIdx != null) winCounts[w.bestIdx]++;
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
  //      fetch kept running server-side (and occupying Ollama, which
  //      serializes generations) even though nothing was still listening.
  // `aiGen` increments on every new request; a response only gets applied if
  // it's still current when it resolves. `aiAbortRef` lets a superseded
  // request actually cancel — through Next.js's `request.signal` all the way
  // to the in-flight Ollama call (see app/api/compare/route.ts).
  const aiGen = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);
  // Sorted key of a comparison restored from sessionStorage this mount, if
  // any. Consumed (once) by the [symbols] effects so a session restore
  // re-renders the saved comparison instead of refetching entries and
  // wiping/re-running the AI verdict — the whole point of saving it.
  const restoredKeyRef = useRef<string | null>(null);
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
          // The [symbols] effects below fire for this restore exactly as they
          // would for a user edit — which used to null the restored aiResult
          // and re-trigger both fetches on every revisit. Record what was
          // restored so those effects can tell "navigated back" from "changed
          // the comparison" (see restoredKeyRef consumers below).
          if (st.symbols?.length && (st.entries?.length || st.aiResult)) {
            restoredKeyRef.current = [...st.symbols].sort().join("-");
          }
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
    // A session restore already carries the entries for exactly these
    // symbols — keep rendering them rather than replacing the whole
    // comparison with a "Comparing…" spinner to refetch what we have.
    // (restoredKeyRef is cleared by the reset effect below, which runs after
    // this one; a later genuine symbol edit therefore always fetches.)
    const restored = _s.current.entries;
    if (
      restoredKeyRef.current != null &&
      restoredKeyRef.current === [...symbols].sort().join("-") &&
      restored.length > 0 &&
      restored.map((e) => e.symbol).sort().join("-") === [...symbols].sort().join("-")
    ) {
      return;
    }
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
  // Ollama's serialized generation queue for an answer nobody could see.
  //
  // Two exemptions, both "nothing actually changed":
  //   - the mount run (symbols is still its initial []) — there is nothing in
  //     flight to cancel, and resetting here raced the session-restore effect
  //     and nulled the aiResult it had just restored;
  //   - the restore run (symbols just became the restored comparison) — the
  //     saved verdict is FOR these symbols; wiping it and re-triggering a
  //     generation on every navigation back to this page was the bug.
  const prevSymbolsRef = useRef<string[] | null>(null);
  useEffect(() => {
    const prev = prevSymbolsRef.current;
    prevSymbolsRef.current = symbols;
    if (prev === null) return; // mount — nothing in flight, nothing to reset

    const restoredKey = restoredKeyRef.current;
    restoredKeyRef.current = null; // one-shot: any later change is a real edit
    if (restoredKey != null && restoredKey === [...symbols].sort().join("-")) {
      // Mark the restored set as already analyzed so the auto-trigger effect
      // doesn't immediately regenerate what we just put back on screen.
      aiAutoTriggered.current = _s.current.entries
        .filter((e) => !e.error)
        .map((e) => e.symbol)
        .sort()
        .join("-");
      return;
    }

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

  async function fetchAiVerdict(syms: string[], opts: { noCache?: boolean } = {}) {
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
        // Re-analyze passes noCache so an explicit click always regenerates;
        // the auto-trigger accepts a recent stored comparison (server-side
        // replay — see app/api/compare/stream/route.ts).
        body: JSON.stringify({ symbols: syms, noCache: opts.noCache || undefined }),
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
    [entries],
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
              ? "Side-by-side valuation, growth, quality, momentum, and analyst consensus. Green = best on metric, red = worst."
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
                    <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-brand">Local AI</span>
                  </div>
                  <p className="text-xs text-muted">
                    {validEntries.map((e) => e.symbol).join(" vs ")} — every pick ranked with its own thesis
                  </p>
                </div>
                <button
                  onClick={() => void fetchAiVerdict(validEntries.map((e) => e.symbol), { noCache: Boolean(aiResult) })}
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

          {/* Metric table */}
          <div className="flex flex-col gap-3">
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
  /** AI-written ranking rationale for this section (lib/ai-compare.ts), e.g. "Rank all N by quality — cite ROE, margins...". Absent while the AI verdict hasn't run yet or when Ollama is unavailable — the deterministic table above never depends on it. */
  aiCommentary?: string;
}) {
  const { hovered, setHovered } = useHoverSymbol();
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* Section header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-surface-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold">{section.title}</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={`text-muted transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>

      <Collapsible open={open}>
        {aiCommentary && (
          <p className="border-t border-border bg-brand/5 px-4 py-2.5 text-xs leading-5 text-foreground/80">
            <span className="mr-1.5 rounded-full border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-widest text-brand">AI</span>
            {aiCommentary}
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-border bg-surface">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted w-44">Metric</th>
              {entries.map((e, i) => {
                const emphasis: SymbolEmphasis = hovered == null ? "none" : hovered === e.symbol ? "active" : "dimmed";
                return (
                  <th
                    key={e.symbol}
                    onMouseEnter={() => setHovered(e.symbol)}
                    onMouseLeave={() => setHovered(null)}
                    className={`px-4 py-2.5 text-right text-xs font-mono font-bold ${emphasisClassName(emphasis)}`}
                    style={{ color: COLORS[i % COLORS.length] }}
                  >
                    {e.symbol}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {section.metrics.map((metric) => (
              <MetricRow key={metric.label} metric={metric} entries={entries} />
            ))}
          </tbody>
        </table>
      </Collapsible>
    </div>
  );
}

/** e.g. "Technology sector avg 29.4x · 73rd pct" — omitted entirely when no reliable peer benchmark exists for this cell. */
function BenchmarkNote({ benchmark, format }: { benchmark: PeerBenchmark; format: (v: number) => string }) {
  return (
    <p className="mt-0.5 text-label leading-tight text-muted" title={`vs ${benchmark.peerCount} peers`}>
      {benchmark.peerLabel} avg {format(benchmark.peerAverage)} · {benchmark.percentile}th pct
    </p>
  );
}

function MetricRow({ metric, entries }: { metric: MetricDef; entries: CompareEntry[] }) {
  const values = entries.map((e) => (e.error ? null : metric.getValue(e)));
  const winners = findWinners(values, metric.higherBetter);
  // Scroll-triggered reveal: the row starts neutral and only plays its
  // gray→green/red "highlighter" pass once, the first time it enters the
  // viewport — never on every render, never a second time on re-scroll.
  const [rowRef, revealed] = useInViewOnce<HTMLTableRowElement>(0.4);

  return (
    <tr ref={rowRef} className="group bg-surface transition-colors duration-200 ease-out hover:bg-surface-2/60">
      <td className="relative px-4 py-2.5">
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-4 w-0.5 origin-center -translate-y-1/2 scale-y-0 rounded-full bg-brand transition-transform duration-200 ease-out group-hover:scale-y-100"
        />
        <span className="text-xs text-foreground transition-transform duration-200 ease-out group-hover:translate-x-1">{metric.label}</span>
        {metric.sub && <p className="text-label text-muted">{metric.sub}</p>}
        {metric.description && (
          <p className="max-h-0 overflow-hidden text-label leading-tight text-muted/80 opacity-0 transition-[max-height,opacity,margin-top] duration-200 ease-out group-hover:mt-1 group-hover:max-h-6 group-hover:opacity-100">
            {metric.description}
          </p>
        )}
      </td>
      {values.map((val, i) => {
        const isBest = winners?.bestIdx === i;
        const isWorst = winners?.worstIdx === i;
        const benchmark = metric.benchmarkKey ? entries[i].benchmarks?.[metric.benchmarkKey] : undefined;

        /* Rank-only color coding — matches the page's own legend ("Green =
           best on metric, red = worst") exactly, with nothing else tinted.
           Mixing this with an absolute positive/negative sign color used to
           let a cell end up with a green background and red text at once
           (e.g. the "best" value in an all-negative row) and colored
           non-best/worst values that weren't actually flagged as anything —
           both unreadable. Background, triangle, and text now always move
           together as a single "best" or "worst" signal, or not at all.
           The color itself only plays once this row has been seen. */
        const revealClass = !revealed ? "" : isBest ? "animate-winner-positive" : isWorst ? "animate-winner-negative" : "";

        return (
          <td key={i} className={`px-4 py-2.5 text-right font-mono text-sm ${revealClass}`}>
            {val == null ? (
              <span className="text-muted">—</span>
            ) : (
              <>
                <span className={revealed ? "" : "text-foreground"}>
                  {revealed && isBest && <span className="mr-1 text-label">▲</span>}
                  {revealed && isWorst && <span className="mr-1 text-label">▼</span>}
                  <CountUp value={val} format={metric.format} />
                  {section_is_scores(metric) && (
                    <span className="ml-1 text-label text-muted">/100</span>
                  )}
                </span>
                {benchmark && <BenchmarkNote benchmark={benchmark} format={metric.format} />}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function section_is_scores(metric: MetricDef): boolean {
  return metric.format === score100;
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
  const colorOf = colorForSymbol ?? ((symbol: string) => COLORS[entries.findIndex((e) => e.symbol === symbol) % COLORS.length]);
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
        <span className="text-muted">{open ? "−" : "+"}</span>
      </button>

      {/* Winner narrative — always visible when section is rendered */}
      {winnerNarrative && (
        <div className={`m-2 rounded-lg border border-brand/15 bg-brand/5 px-4 py-2.5 ${shimmer ? "animate-border-shimmer" : ""}`}>
          <p className="text-caption text-foreground/80 leading-4">{winnerNarrative}</p>
        </div>
      )}

      {open && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-border bg-surface">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted w-44">Metric</th>
              {entries.map((e, i) => (
                <th
                  key={e.symbol}
                  className="px-4 py-2.5 text-right text-xs font-mono font-bold"
                  style={{ color: colorOf(e.symbol) }}
                >
                  {e.symbol}
                  {i === bestIdx && (
                    <span className="ml-1 text-micro text-brand">★ Best fit</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Fit score row */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Portfolio Fit Score</span>
                <p className="text-label text-muted">0-100 · higher = better fit</p>
              </td>
              {fits.map((f, i) => (
                <td key={i} className={`px-4 py-2.5 text-right ${i === bestIdx ? "bg-positive/5" : ""}`}>
                  <PortfolioFitBadge score={f.fitScore} tier={f.fitTier} size="sm" />
                </td>
              ))}
            </tr>
            {/* Top reason row */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Key Reason</span>
              </td>
              {fits.map((f, i) => (
                <td key={i} className="px-4 py-2.5 text-right text-label text-muted max-w-[160px]">
                  {f.reasons[0] ?? "—"}
                </td>
              ))}
            </tr>
            {/* Suggested allocation row */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Suggested Allocation</span>
              </td>
              {fits.map((f, i) => (
                <td key={i} className="px-4 py-2.5 text-right font-mono text-xs">
                  {f.suggestedAllocationPct > 0 ? `${f.suggestedAllocationPct.toFixed(1)}%` : "—"}
                </td>
              ))}
            </tr>
            {/* Sector dimension */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Sector Fit</span>
              </td>
              {fits.map((f, i) => (
                <td key={i} className="px-4 py-2.5 text-right font-mono text-xs">
                  <span className={f.dimensions.sector.score >= 65 ? "text-positive" : f.dimensions.sector.score >= 45 ? "text-warning" : "text-negative"}>
                    {f.dimensions.sector.score}
                  </span>
                  <span className="ml-1 text-label text-muted">/100</span>
                </td>
              ))}
            </tr>
            {/* Objective alignment */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Objective Alignment</span>
              </td>
              {fits.map((f, i) => (
                <td key={i} className="px-4 py-2.5 text-right font-mono text-xs">
                  <span className={f.dimensions.objective.score >= 65 ? "text-positive" : f.dimensions.objective.score >= 45 ? "text-warning" : "text-negative"}>
                    {f.dimensions.objective.score}
                  </span>
                  <span className="ml-1 text-label text-muted">/100</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
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
