/**
 * Side-by-side AI comparison of 2-5 stocks.
 *
 * Fetches full fundamentals for every symbol in parallel, then runs a
 * structured comparison prompt that produces a delta analysis across ALL of
 * them at once: which is cheaper, which has better quality, which has better
 * growth — and a ranked verdict (every asset ranked with a thesis, strengths,
 * weaknesses, and the investor it suits) rather than one forced winner.
 */

import { runPromptWithMeta } from "./ai";
import { runTaskStream } from "./ai/orchestrator";
import { classifyAiError, type AiErrorCategory, type ClassifiedAiError } from "./ai/errors";
import { logAiEvent } from "./ai/log";
import { JsonFieldStreamer } from "./ai/streaming-json";
import { getFundamentals, MODULES } from "./fundamentals";
import { getFinancialStatements } from "./statements";
import { getHistory, getQuote, getQuoteMeta, getQuoteSummaryMeta } from "./yahoo";
import { computeScore, computeMomentum, assessRisks, classifyInvestmentPersonality } from "./scoring";
import { formatCurrency, formatPercent, formatMarketCap } from "./format";
import { extractJsonObject } from "./json-extract";
import { verifyGrounding, collectClaimText, type GroundingReport } from "./ai/grounding";
import { computeEntryBenchmarks, peerGroupOf, loadBenchmarkUniverse, type PeerBenchmark } from "./compare/benchmarks";
import type { EntryFreshness } from "./compare/types";
import type { FundamentalsData, Quote } from "./types";
import { AI_NARRATIVE_UNAVAILABLE, AI_RECOVERY_HINT } from "./ai/availability";

export interface CompareStock {
  symbol: string;
  quote: Quote;
  fundamentals: FundamentalsData;
  freshness: EntryFreshness;
}

/** One ranked asset in the verdict — never a forced single winner. */
export interface RankedAsset {
  rank: number;
  symbol: string;
  thesis: string;
  strengths: string[];
  weaknesses: string[];
  /** The kind of investor this pick suits best, e.g. "income-focused, low-turnover investors". */
  bestFor: string;
}

export interface ComparisonResult {
  model: string;
  /** All compared symbols, in the order they were requested (2-5). */
  symbols: string[];
  /**
   * Why the written comparison is degraded or absent — undefined when the AI
   * answered normally. Lets the Compare page show an accurate, specific
   * status ("no API key", "can't reach the AI service") instead of one generic
   * failure message for every possible cause. See lib/ai/errors.ts.
   */
  aiStatus?: AiErrorCategory;
  sections: {
    overview: string;
    valuation: string;
    quality: string;
    growth: string;
    financialHealth: string;
    momentum: string;
    verdict: string;
    capitalAllocation: string;
    competitivePositioning: string;
    riskComparison: string;
  };
  /** Every compared asset ranked 1..n, each with its own thesis — no forced single winner. */
  rankings: RankedAsset[];
  /** True when the model judged the field too close to call and said so instead of forcing an order. */
  noClearWinner: boolean;
  /** Why the ranking landed this way (or why it's a genuine toss-up dependent on the investor's objective). */
  tradeoffSummary: string;
  /** One-paragraph summary for the top-of-page executive summary. */
  executiveSummary: string;
  /** What would have to change for the ranking to shift. */
  conditionsForChange: string;
  /** 0-100 confidence in the ranking. */
  confidenceScore: number;
  metricTable: CompareMetricRow[];
  /** Verification that the written comparison's figures trace to the metric
   *  table it was given. Absent when the AI was unavailable. */
  grounding?: GroundingReport;
  freshness: Record<string, EntryFreshness>;
  /** Symbols that were requested but couldn't be loaded for this analysis —
   *  the comparison still runs on whoever's left, rather than failing
   *  outright over one bad symbol. Absent when every requested symbol loaded. */
  droppedSymbols?: { symbol: string; reason: string }[];
}

export interface CompareMetricRow {
  metric: string;
  /** Formatted display value per symbol. */
  values: Record<string, string>;
  /** Symbol with the best value, "tie" when within 5% of each other, or null when no symbol has data. */
  best: string | "tie" | null;
  /** Sector-peer benchmark per symbol, present only where a reliable peer group exists. */
  benchmarks?: Record<string, PeerBenchmark>;
}

async function loadStock(symbol: string): Promise<CompareStock> {
  const [quote, fp, history, statementsResult, quoteMeta, fundamentalsMeta] = await Promise.allSettled([
    getQuote(symbol),
    getFundamentals(symbol),
    getHistory(symbol, 420),
    getFinancialStatements(symbol),
    getQuoteMeta(symbol),
    getQuoteSummaryMeta(symbol, MODULES),
  ]);

  if (quote.status === "rejected") throw new Error(`Could not load quote for ${symbol}`);
  if (fp.status === "rejected") throw new Error(`Could not load fundamentals for ${symbol}`);

  const q = quote.value;
  const parts = fp.value;
  const hist = history.status === "fulfilled" ? history.value : [];
  const statements = statementsResult.status === "fulfilled" ? statementsResult.value : null;
  const momentum = computeMomentum(hist);
  const score = computeScore(parts.snapshot, statements, parts.analyst, momentum);
  const risks = assessRisks(parts.snapshot, statements, parts.analyst, parts.insider);

  const latestFiscalYear = statements?.fiscalYears.length ? statements.fiscalYears[statements.fiscalYears.length - 1] : null;
  const freshness: EntryFreshness = {
    price: { asOf: quoteMeta.status === "fulfilled" ? quoteMeta.value.fetchedAt : Date.now(), source: "yahoo" },
    fundamentals: { asOf: fundamentalsMeta.status === "fulfilled" ? fundamentalsMeta.value.fetchedAt : Date.now(), source: "yahoo" },
    statements: latestFiscalYear != null ? { asOf: `${latestFiscalYear}-12-31`, source: "sec_edgar", fiscalYear: latestFiscalYear } : null,
  };

  return {
    symbol,
    quote: q,
    freshness,
    fundamentals: {
      snapshot: parts.snapshot,
      statements,
      statementsError: statementsResult.status === "rejected" ? "EDGAR unavailable" : null,
      analyst: parts.analyst,
      insider: parts.insider,
      score,
      risks,
      momentum,
      earnings: parts.earnings,
      ownership: parts.ownership,
      valuation: [],
      personality: classifyInvestmentPersonality(score, parts.snapshot, momentum),
    },
  };
}

const fmt = {
  pct: (v: number | null) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`),
  x: (v: number | null) => (v == null ? "n/a" : `${v.toFixed(1)}x`),
  score: (v: number | null) => (v == null ? "n/a" : `${v}/100`),
};

type FlatAI = {
  overview?: string; valuation?: string; quality?: string; growth?: string;
  financialHealth?: string; momentum?: string; verdict?: string;
  capitalAllocation?: string; competitivePositioning?: string; riskComparison?: string;
  rankings?: unknown[]; noClearWinner?: boolean; tradeoffSummary?: string;
  executiveSummary?: string; conditionsForChange?: string; confidenceScore?: number;
  sections?: ComparisonResult["sections"];
};

/** Exported for unit testing — pure, no I/O. */
export function parseCompareResponse(raw: string): FlatAI {
  const flat = extractJsonObject<FlatAI>(raw, {
    overview: "", valuation: "", quality: "", growth: "",
    financialHealth: "", momentum: "", verdict: "",
    capitalAllocation: "", competitivePositioning: "", riskComparison: "",
    rankings: [], noClearWinner: false, tradeoffSummary: "",
    executiveSummary: "", conditionsForChange: "", confidenceScore: undefined,
    sections: undefined,
  });
  // extractJsonObject does not recurse — guard the one nested-object field
  // against the model returning a non-object (every other field is a plain
  // string/number already tolerated by the `??`/typeof checks in compareStocks).
  if (flat.sections && (typeof flat.sections !== "object" || Array.isArray(flat.sections))) {
    flat.sections = undefined;
  }
  return flat;
}

/** Validate one raw `rankings[]` element against the compared symbol set, dropping anything malformed rather than letting a half-shaped object reach the UI. */
function sanitizeRanking(item: unknown, validSymbols: Set<string>): RankedAsset | null {
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  const symbol = typeof r.symbol === "string" ? r.symbol.toUpperCase().trim() : null;
  if (!symbol || !validSymbols.has(symbol)) return null;
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    rank: typeof r.rank === "number" ? r.rank : 0,
    symbol,
    thesis: typeof r.thesis === "string" ? r.thesis : "",
    strengths: asStringArray(r.strengths),
    weaknesses: asStringArray(r.weaknesses),
    bestFor: typeof r.bestFor === "string" ? r.bestFor : "",
  };
}

/**
 * Turn the model's raw rankings into a clean, ordered, deduplicated list — one
 * entry per compared symbol, in rank order. Falls back to composite-score
 * order (a real, already-computed number, never a fabricated one) for any
 * symbol the model omitted or mis-shaped, so the ranked verdict never shows
 * fewer assets than were actually compared.
 */
function normalizeRankings(raw: unknown[], stocks: CompareStock[]): RankedAsset[] {
  const validSymbols = new Set(stocks.map((s) => s.symbol));
  const bySymbol = new Map<string, RankedAsset>();
  for (const item of raw) {
    const r = sanitizeRanking(item, validSymbols);
    if (r && !bySymbol.has(r.symbol)) bySymbol.set(r.symbol, r);
  }

  const fallbackOrder = [...stocks].sort(
    (a, b) => (b.fundamentals.score.composite ?? 0) - (a.fundamentals.score.composite ?? 0),
  );
  for (const s of fallbackOrder) {
    if (!bySymbol.has(s.symbol)) {
      bySymbol.set(s.symbol, {
        rank: 0, symbol: s.symbol, thesis: "", strengths: [], weaknesses: [],
        bestFor: "",
      });
    }
  }

  return fallbackOrder
    .map((s) => bySymbol.get(s.symbol)!)
    .sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return 0;
    })
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function buildComparePrompt(stocks: CompareStock[]): { prompt: string; evidence: string } {
  const symbols = stocks.map((s) => s.symbol);
  const symbolList = symbols.join(", ");
  const colWidth = 14;

  const row = (label: string, values: string[]) =>
    `  ${label.padEnd(22)} ${values.map((v) => v.padEnd(colWidth)).join(" ")}`;
  const header = `${"Metric".padEnd(24)} ${symbols.map((s) => s.padEnd(colWidth)).join(" ")}`;
  const divider = "-".repeat(24 + (colWidth + 1) * symbols.length);

  const snaps = stocks.map((s) => s.fundamentals.snapshot);
  const scores = stocks.map((s) => s.fundamentals.score);
  const moms = stocks.map((s) => s.fundamentals.momentum);

  const table = [
    header,
    divider,
    row("Price", stocks.map((s) => formatCurrency(s.quote.price, s.quote.currency))),
    row("Mkt Cap", stocks.map((s) => formatMarketCap(s.quote.marketCap))),
    row("Today chg", stocks.map((s) => formatPercent(s.quote.changePercent))),
    divider,
    row("Composite score", scores.map((sc) => fmt.score(sc.composite))),
    row("Recommendation", scores.map((sc) => sc.recommendation)),
    row("Confidence", scores.map((sc) => `${sc.confidence}%`)),
    divider,
    row("Trailing P/E", snaps.map((s) => fmt.x(s.trailingPE))),
    row("Forward P/E", snaps.map((s) => fmt.x(s.forwardPE))),
    row("PEG", snaps.map((s) => fmt.x(s.pegRatio))),
    row("P/B", snaps.map((s) => fmt.x(s.priceToBook))),
    row("Analyst upside", stocks.map((s) => fmt.pct(s.fundamentals.analyst.upsidePercent))),
    divider,
    row("ROE", snaps.map((s) => fmt.pct(s.returnOnEquity != null ? s.returnOnEquity * 100 : null))),
    row("Operating margin", snaps.map((s) => fmt.pct(s.operatingMargins != null ? s.operatingMargins * 100 : null))),
    row("Revenue growth", snaps.map((s) => fmt.pct(s.revenueGrowth != null ? s.revenueGrowth * 100 : null))),
    row("Earnings growth", snaps.map((s) => fmt.pct(s.earningsGrowth != null ? s.earningsGrowth * 100 : null))),
    divider,
    row("Debt / Equity", snaps.map((s) => fmt.x(s.debtToEquity))),
    row("Current ratio", snaps.map((s) => fmt.x(s.currentRatio))),
    row("Dividend yield", snaps.map((s) => fmt.pct(s.dividendYield != null ? s.dividendYield * 100 : null))),
    divider,
    row("Momentum score", moms.map((m) => fmt.score(m?.score ?? null))),
    row("Momentum trend", moms.map((m) => m?.trend ?? "n/a")),
    row("vs 200d SMA", moms.map((m) => fmt.pct(m?.vsSma200 ?? null))),
  ].join("\n");

  const risksLines = stocks
    .map((s) => `${s.symbol} risks: ${s.fundamentals.risks.map((r) => `${r.category}[${r.level}]`).join(", ") || "none flagged"}`)
    .join("\n");

  const evidence = `${table}\n\n${risksLines}`;
  const n = symbols.length;

  const prompt = `You are a senior equity research analyst. Compare ALL ${n} of the following stocks together using ONLY the data below: ${symbolList}. Every section below must address all ${n} stocks — never limit the analysis to just two of them.

${table}

${risksLines}

Write a structured comparison covering all ${n} stocks. Be specific — cite numbers. Do NOT force a single "winner" — rank every stock and give each its own thesis; if the field is genuinely close, say so explicitly instead of picking one arbitrarily. Return as JSON:
{
  "overview": "2-3 sentences: what kind of companies these ${n} are and how they stack up against each other overall",
  "valuation": "Rank all ${n} from cheapest to most expensive and why — cite P/E, PEG, P/B, analyst upside specifically",
  "quality": "Rank all ${n} by quality — cite ROE, margins, earnings growth",
  "growth": "Rank all ${n} by growth — cite revenue growth, earnings growth, CAGR if available",
  "financialHealth": "Rank all ${n} by balance sheet strength — cite D/E, current ratio, FCF",
  "momentum": "Rank all ${n} by price momentum — cite trend, SMA position, score",
  "capitalAllocation": "Compare capital allocation across all ${n} — cite FCF conversion, buybacks/dilution, reinvestment discipline from the data given",
  "competitivePositioning": "Compare competitive position across all ${n} — infer from margin trends, growth durability, and market cap/scale in the data given",
  "riskComparison": "Compare the risk profiles of all ${n} directly — cite the risk categories/levels listed above for each symbol",
  "verdict": "One paragraph synthesizing the comparison as a whole, tying the sections above together",
  "rankings": [
    { "rank": 1, "symbol": "<one of: ${symbolList}>", "thesis": "1-2 sentences: the investment case for this pick specifically", "strengths": ["<short phrase, cite a number>", "..."], "weaknesses": ["<short phrase, cite a number>", "..."], "bestFor": "the type of investor this pick suits best, e.g. 'income-focused investors' or 'high-risk-tolerance growth investors'" }
    // one entry per stock, rank 1..${n}, best first
  ],
  "noClearWinner": "<true if the field is genuinely close and the ranking shouldn't be read as decisive, false otherwise>",
  "tradeoffSummary": "One paragraph: why the ranking landed this way, OR — if noClearWinner — why the right pick depends on the investor's own objective (income vs growth, risk tolerance, time horizon) rather than a factual edge",
  "executiveSummary": "2-3 sentences for a top-of-page summary covering ALL ${n} stocks, written for someone who will only read this one paragraph",
  "conditionsForChange": "One sentence: what would have to change for the ranking order to shift",
  "confidenceScore": "<0-100 integer — how confident are you in this ranking given the data available>"
}`;

  return { prompt, evidence };
}

/** Best index among values (5%-tolerance tie, matching the deterministic category-winner logic on the Compare page). */
export function bestIndex(values: (number | null)[], higherIsBetter: boolean): number | "tie" | null {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null);
  if (present.length === 0) return null;
  const best = present.reduce((a, b) =>
    (higherIsBetter ? b.v > a.v : b.v < a.v) ? b : a,
  );
  const tied = present.filter(
    (x) => Math.abs(x.v - best.v) < 0.05 * Math.max(Math.abs(x.v), Math.abs(best.v), 1e-9),
  );
  return tied.length > 1 ? "tie" : best.i;
}

/** Registry metric key for the rows that have a like-for-like universe-wide equivalent to benchmark against — see lib/compare/benchmarks.ts. Composite/Analyst/Momentum rows are this file's own scoring, not directly comparable to the Screener universe's numbers, so they're deliberately left unbenchmarked. */
const BENCHMARK_KEY: Partial<Record<string, string>> = {
  "Forward P/E": "forwardPE",
  "PEG ratio": "pegRatio",
  "ROE": "roe",
  "Operating margin": "operatingMargin",
  "Revenue growth": "revenueGrowthYoY",
  "Debt / Equity": "debtToEquity",
  "Dividend yield": "dividendYield",
};

function buildMetricTable(
  stocks: CompareStock[],
  benchmarksBySymbol: Map<string, Record<string, PeerBenchmark>>,
): CompareMetricRow[] {
  interface Row {
    label: string;
    higherBetter: boolean;
    get: (s: CompareStock) => number | null;
    format: (v: number | null) => string;
  }

  const rows: Row[] = [
    { label: "Composite score", higherBetter: true, get: (s) => s.fundamentals.score.composite, format: fmt.score },
    { label: "Forward P/E", higherBetter: false, get: (s) => s.fundamentals.snapshot.forwardPE, format: fmt.x },
    { label: "PEG ratio", higherBetter: false, get: (s) => s.fundamentals.snapshot.pegRatio, format: fmt.x },
    { label: "ROE", higherBetter: true, get: (s) => (s.fundamentals.snapshot.returnOnEquity != null ? s.fundamentals.snapshot.returnOnEquity * 100 : null), format: fmt.pct },
    { label: "Operating margin", higherBetter: true, get: (s) => (s.fundamentals.snapshot.operatingMargins != null ? s.fundamentals.snapshot.operatingMargins * 100 : null), format: fmt.pct },
    { label: "Revenue growth", higherBetter: true, get: (s) => (s.fundamentals.snapshot.revenueGrowth != null ? s.fundamentals.snapshot.revenueGrowth * 100 : null), format: fmt.pct },
    { label: "Analyst upside", higherBetter: true, get: (s) => s.fundamentals.analyst.upsidePercent, format: fmt.pct },
    { label: "Debt / Equity", higherBetter: false, get: (s) => s.fundamentals.snapshot.debtToEquity, format: fmt.x },
    { label: "Dividend yield", higherBetter: true, get: (s) => (s.fundamentals.snapshot.dividendYield != null ? s.fundamentals.snapshot.dividendYield * 100 : null), format: fmt.pct },
    { label: "Momentum score", higherBetter: true, get: (s) => s.fundamentals.momentum?.score ?? null, format: fmt.score },
  ];

  return rows.map((row) => {
    const raw = stocks.map((s) => row.get(s));
    const winner = bestIndex(raw, row.higherBetter);
    const values: Record<string, string> = {};
    stocks.forEach((s, i) => { values[s.symbol] = row.format(raw[i]); });

    const benchmarkKey = BENCHMARK_KEY[row.label];
    let benchmarks: Record<string, PeerBenchmark> | undefined;
    if (benchmarkKey) {
      for (const s of stocks) {
        const b = benchmarksBySymbol.get(s.symbol)?.[benchmarkKey];
        if (b) {
          benchmarks ??= {};
          benchmarks[s.symbol] = b;
        }
      }
    }

    return {
      metric: row.label,
      values,
      best: winner === null ? null : winner === "tie" ? "tie" : stocks[winner].symbol,
      benchmarks,
    };
  });
}

/** Which registry metric key each snapshot field corresponds to, matching BENCHMARK_KEY above — used to build the per-symbol value map computeEntryBenchmarks needs. */
function benchmarkValuesFor(s: CompareStock): Record<string, number | null> {
  const snap = s.fundamentals.snapshot;
  return {
    forwardPE: snap.forwardPE,
    pegRatio: snap.pegRatio,
    roe: snap.returnOnEquity != null ? snap.returnOnEquity * 100 : null,
    operatingMargin: snap.operatingMargins != null ? snap.operatingMargins * 100 : null,
    revenueGrowthYoY: snap.revenueGrowth != null ? snap.revenueGrowth * 100 : null,
    debtToEquity: snap.debtToEquity,
    dividendYield: snap.dividendYield != null ? snap.dividendYield * 100 : null,
  };
}

export interface ComparisonSetup {
  stocks: CompareStock[];
  benchmarksBySymbol: Map<string, Record<string, PeerBenchmark>>;
  prompt: string;
  evidence: string;
  /**
   * Symbols that failed to load. Determined during setup but reported on the
   * finished result, so it has to travel between the two — the blocking and
   * streaming paths share one `finalizeComparison`, and a dropped symbol is a
   * property of the data-gathering step, not of the model's answer.
   */
  droppedSymbols: { symbol: string; reason: string }[];
}

/**
 * Everything a comparison needs BEFORE the AI call: load every stock, compute
 * peer benchmarks, and build the prompt. Shared by the blocking path
 * ({@link compareStocks}) and the streaming path ({@link streamComparisonFields})
 * so the two can never drift into asking the model two different questions
 * about the same symbols.
 */
export async function prepareComparison(
  symbols: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<ComparisonSetup> {
  const upper = [...new Set(symbols.map((s) => s.toUpperCase()))];
  if (upper.length < 2) throw new Error("At least two distinct symbols are required");
  if (upper.length > 5) throw new Error("At most 5 symbols can be compared at once");

  // KNOWN LIMITATION: loadStock()'s underlying Yahoo/EDGAR fetches (getQuote,
  // getFundamentals, getHistory, getFinancialStatements — all routed through
  // the shared Platform Data Layer used by every feature in the app) do not
  // themselves accept an AbortSignal, so a cancellation here cannot stop
  // network calls already in flight. What IS honored: once this phase
  // settles, a caller that already walked away is not made to pay for the
  // (far more expensive) prompt-building and AI phase that follows — see the
  // check right after this Promise.all. Threading cancellation through the
  // data layer itself would touch ~48 call sites shared by Research,
  // Screener, Portfolio, and Scanner; out of proportion to fix here.
  const [settled, equityUniverse] = await Promise.all([
    Promise.allSettled(upper.map((s) => loadStock(s))),
    loadBenchmarkUniverse("equity"),
  ]);
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  // One bad symbol (transient rate limit, a bad ticker) used to fail the
  // entire ranked verdict even when the rest loaded fine — the same partial-
  // tolerance class-ai-compare.ts already applies. Drop failures and proceed
  // with whoever's left; only give up if fewer than two remain to compare.
  // `settled` is index-aligned with `upper` by construction (Promise.allSettled
  // over upper.map(...)), so a rejection at index i belongs to upper[i].
  const stocks: CompareStock[] = [];
  const droppedSymbols: { symbol: string; reason: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") stocks.push(r.value);
    else droppedSymbols.push({ symbol: upper[i], reason: r.reason instanceof Error ? r.reason.message : "Failed to load" });
  });
  if (stocks.length < 2) {
    const reason = droppedSymbols[0]?.reason ?? "Failed to load symbols";
    throw new Error(
      stocks.length === 0
        ? reason
        : `Only ${stocks.length} of ${upper.length} symbols loaded (${droppedSymbols.map((d) => d.symbol).join(", ")} failed) — at least two are required.`,
    );
  }

  const benchmarksBySymbol = new Map<string, Record<string, PeerBenchmark>>();
  for (const s of stocks) {
    const peerGroup = peerGroupOf("equity", { sector: s.fundamentals.snapshot.sector });
    benchmarksBySymbol.set(
      s.symbol,
      computeEntryBenchmarks("equity", Object.keys(BENCHMARK_KEY).map((l) => BENCHMARK_KEY[l]!), s.symbol, benchmarkValuesFor(s), peerGroup, equityUniverse),
    );
  }

  const { prompt, evidence } = buildComparePrompt(stocks);
  return { stocks, benchmarksBySymbol, prompt, evidence, droppedSymbols };
}

/**
 * Assemble the final {@link ComparisonResult} from whatever the model
 * returned (or failed to). Used identically by the blocking and streaming
 * paths so a streamed comparison's final object is byte-for-byte the same
 * one the blocking route would have produced — streaming only changes WHEN
 * the pieces arrive, never what they are.
 */
export function finalizeComparison(
  setup: ComparisonSetup,
  model: string,
  flat: FlatAI,
  aiFailure: ClassifiedAiError | undefined,
): ComparisonResult {
  const { stocks, benchmarksBySymbol, evidence, droppedSymbols } = setup;

  // `model` only stays "unavailable" when the AI call itself failed (service
  // down, no key, timed out, etc); see `aiFailure` for why. A connected-but-garbage
  // response still gets a real `model` and falls through to the field
  // defaults below.
  const aiUnavailable = model === "unavailable";

  const sections: ComparisonResult["sections"] = flat.sections ?? {
    overview:
      flat.overview ??
      // A classified failure carries the specific cause, which is strictly more
      // actionable than the generic copy; the generic line is the fallback for
      // "unavailable with no classified error". Both now end in the recovery
      // hint, which names the hosted AND local paths (see lib/ai/availability).
      (aiFailure
        ? `${aiFailure.message} ${AI_RECOVERY_HINT}`
        : aiUnavailable
          ? `${AI_NARRATIVE_UNAVAILABLE} ${AI_RECOVERY_HINT}`
          : ""),
    valuation: flat.valuation ?? "",
    quality: flat.quality ?? "",
    growth: flat.growth ?? "",
    financialHealth: flat.financialHealth ?? "",
    momentum: flat.momentum ?? "",
    verdict: flat.verdict ?? "",
    capitalAllocation: flat.capitalAllocation ?? "",
    competitivePositioning: flat.competitivePositioning ?? "",
    riskComparison: flat.riskComparison ?? "",
  };

  const rankings = normalizeRankings(Array.isArray(flat.rankings) ? flat.rankings : [], stocks);
  const rankingClaimText = rankings.flatMap((r) => [r.thesis, r.bestFor, ...r.strengths, ...r.weaknesses]);

  // Verify the written comparison against the metric table it was handed: every
  // P/E, margin, and growth figure the prose cites must trace to the data.
  const grounding = aiUnavailable
    ? undefined
    : verifyGrounding(
        collectClaimText([
          sections.overview, sections.valuation, sections.quality, sections.growth,
          sections.financialHealth, sections.momentum, sections.verdict,
          sections.capitalAllocation, sections.competitivePositioning, sections.riskComparison,
          flat.executiveSummary, flat.tradeoffSummary, flat.conditionsForChange,
          ...rankingClaimText,
        ]),
        evidence,
      );

  const freshness: Record<string, EntryFreshness> = {};
  for (const s of stocks) freshness[s.symbol] = s.freshness;

  return {
    model,
    symbols: stocks.map((s) => s.symbol),
    sections,
    aiStatus: aiFailure?.category,
    rankings,
    // Local models occasionally emit "true"/"false" as a string rather than a
    // JSON boolean — coerce leniently rather than let a stringified true read
    // as falsy and silently drop the "too close to call" signal.
    noClearWinner: flat.noClearWinner === true || (flat.noClearWinner as unknown) === "true",
    tradeoffSummary: flat.tradeoffSummary ?? "",
    executiveSummary: flat.executiveSummary ?? (aiUnavailable ? sections.overview : ""),
    conditionsForChange: flat.conditionsForChange ?? "",
    confidenceScore: typeof flat.confidenceScore === "number"
      ? Math.max(0, Math.min(100, Math.round(flat.confidenceScore)))
      : Math.min(...stocks.map((s) => s.fundamentals.score.confidence)),
    metricTable: buildMetricTable(stocks, benchmarksBySymbol),
    grounding,
    freshness,
    droppedSymbols: droppedSymbols.length ? droppedSymbols : undefined,
  };
}

/** Same field defaults `parseCompareResponse` applies via `extractJsonObject`, for the streaming path's already-parsed fields (each one already syntactically valid JSON, so no coercion is needed — just filling in whatever hasn't arrived yet). */
const FLAT_AI_DEFAULTS: FlatAI = {
  overview: "", valuation: "", quality: "", growth: "",
  financialHealth: "", momentum: "", verdict: "",
  capitalAllocation: "", competitivePositioning: "", riskComparison: "",
  rankings: [], noClearWinner: false, tradeoffSummary: "",
  executiveSummary: "", conditionsForChange: "", confidenceScore: undefined,
  sections: undefined,
};

/** Merge whatever fields a {@link JsonFieldStreamer} has parsed so far (or at the end) with the same defaults the blocking path's `parseCompareResponse` guarantees, so `finalizeComparison` never has to special-case "streamed vs blocking". */
export function flatFromStreamedFields(fields: Record<string, unknown>): FlatAI {
  const flat: FlatAI = { ...FLAT_AI_DEFAULTS, ...fields };
  if (flat.sections && (typeof flat.sections !== "object" || Array.isArray(flat.sections))) {
    flat.sections = undefined;
  }
  return flat;
}

/** Compare 2-5 stocks together. Every input symbol must load successfully. */
export async function compareStocks(
  symbols: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<ComparisonResult> {
  const setup = await prepareComparison(symbols, opts);
  let model = "unavailable";

  let flat: FlatAI = {};
  // Populated only when the AI call itself failed. Drives both the fallback
  // narrative text and the machine-readable `aiStatus` the Compare page uses
  // to show an accurate status ("no API key" vs "can't reach the AI service")
  // instead of one generic message for every cause.
  let aiFailure: ClassifiedAiError | undefined;
  try {
    const { text: raw, model: usedModel } = await runPromptWithMeta("comparison", setup.prompt, {
      maxTokens: 1800,
      json: true,
      signal: opts.signal,
    });
    model = usedModel;
    flat = parseCompareResponse(raw);
  } catch (err) {
    aiFailure = classifyAiError(err);
    logAiEvent({
      category: aiFailure.category,
      taskType: "comparison",
      message: err instanceof Error ? err.message : String(err),
    });
    // A caller abort means nobody is waiting for this result at all — the
    // metric table isn't worth assembling either. Every other AI failure
    // still degrades gracefully (metric table intact, narrative absent).
    if (aiFailure.category === "cancelled") throw err;
  }

  return finalizeComparison(setup, model, flat, aiFailure);
}

/**
 * Streamed counterpart to {@link compareStocks}: same setup, same prompt,
 * same model — the only difference is that fields are yielded the instant
 * each one closes rather than the caller waiting for the whole object.
 *
 * Yields `{ key, value }` for every top-level field as the model finishes it
 * (headline/section-style, e.g. `executiveSummary` typically closes in
 * seconds while `rankings` closes near the end), then a final event carrying
 * the fully assembled {@link ComparisonResult} — the exact same object
 * {@link compareStocks} would have returned for identical input, so a
 * consumer that only wants the finished thing can ignore every yielded field
 * and just await the return value.
 */
export async function* streamComparisonFields(
  symbols: string[],
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<{ key: string; value: unknown }, ComparisonResult, unknown> {
  const setup = await prepareComparison(symbols, opts);
  const parser = new JsonFieldStreamer();
  let model = "unavailable";
  let aiFailure: ClassifiedAiError | undefined;

  try {
    const generation = runTaskStream("comparison", setup.prompt, {
      json: true,
      signal: opts.signal,
    });
    for (;;) {
      const next = await generation.next();
      if (next.done) {
        model = next.value ?? model;
        break;
      }
      for (const field of parser.push(next.value)) yield field;
    }
    for (const field of parser.end()) yield field;
  } catch (err) {
    aiFailure = classifyAiError(err);
    logAiEvent({
      category: aiFailure.category,
      taskType: "comparison",
      message: err instanceof Error ? err.message : String(err),
    });
    if (aiFailure.category === "cancelled") throw err;
  }

  const flat = flatFromStreamedFields(parser.result());
  return finalizeComparison(setup, model, flat, aiFailure);
}
