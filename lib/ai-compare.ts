/**
 * Side-by-side AI comparison of 2-5 stocks.
 *
 * Fetches full fundamentals for every symbol in parallel, then runs a
 * structured comparison prompt that produces a delta analysis across ALL of
 * them at once: which is cheaper, which has better quality, which has better
 * growth, and an overall verdict naming one winner among the full set.
 */

import { runPromptWithMeta } from "./ai";
import { getFundamentals } from "./fundamentals";
import { getFinancialStatements } from "./statements";
import { getHistory, getQuote } from "./yahoo";
import { computeScore, computeMomentum, assessRisks, classifyInvestmentPersonality } from "./scoring";
import { formatCurrency, formatPercent, formatMarketCap } from "./format";
import { extractJson } from "./json-extract";
import { verifyGrounding, collectClaimText, type GroundingReport } from "./ai/grounding";
import type { FundamentalsData, Quote } from "./types";

export interface CompareStock {
  symbol: string;
  quote: Quote;
  fundamentals: FundamentalsData;
}

export interface ComparisonResult {
  model: string;
  /** All compared symbols, in the order they were requested (2-5). */
  symbols: string[];
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
  winner: string | null; // symbol of the better overall pick, or null if too close
  winnerRationale: string;
  /** One-paragraph "which is better and why", for the top-of-page executive summary. */
  executiveSummary: string;
  /** What would have to change for the recommendation to flip. */
  conditionsForChange: string;
  /** 0-100 confidence in the winner call. */
  confidenceScore: number;
  metricTable: CompareMetricRow[];
  /** Verification that the written comparison's figures trace to the metric
   *  table it was given. Absent when the AI was unavailable. */
  grounding?: GroundingReport;
}

export interface CompareMetricRow {
  metric: string;
  /** Formatted display value per symbol. */
  values: Record<string, string>;
  /** Symbol with the best value, "tie" when within 5% of each other, or null when no symbol has data. */
  best: string | "tie" | null;
}

async function loadStock(symbol: string): Promise<CompareStock> {
  const [quote, fp, history, statementsResult] = await Promise.allSettled([
    getQuote(symbol),
    getFundamentals(symbol),
    getHistory(symbol, 420),
    getFinancialStatements(symbol),
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

  return {
    symbol,
    quote: q,
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

Write a structured comparison covering all ${n} stocks. Be specific — cite numbers. Return as JSON:
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
  "verdict": "One clear paragraph: given all the above, rank all ${n} and say which is the best pick right now and why. Be decisive.",
  "winner": "one of: ${symbolList} — or null if too close to call",
  "winnerRationale": "One sentence max explaining the winner choice among all ${n}",
  "executiveSummary": "2-3 sentences for a top-of-page summary covering ALL ${n} stocks: which is the best investment and why, written for someone who will only read this one paragraph",
  "conditionsForChange": "One sentence: what would have to change for this recommendation to flip to a different one of the ${n} stocks",
  "confidenceScore": "<0-100 integer — how confident are you in the winner call given the data available>"
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

function buildMetricTable(stocks: CompareStock[]): CompareMetricRow[] {
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
    return {
      metric: row.label,
      values,
      best: winner === null ? null : winner === "tie" ? "tie" : stocks[winner].symbol,
    };
  });
}

/** Compare 2-5 stocks together. Every input symbol must load successfully. */
export async function compareStocks(symbols: string[]): Promise<ComparisonResult> {
  const upper = [...new Set(symbols.map((s) => s.toUpperCase()))];
  if (upper.length < 2) throw new Error("At least two distinct symbols are required");
  if (upper.length > 5) throw new Error("At most 5 symbols can be compared at once");

  const settled = await Promise.allSettled(upper.map((s) => loadStock(s)));
  const firstFailure = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (firstFailure) throw firstFailure.reason as Error;
  const stocks = settled.map((r) => (r as PromiseFulfilledResult<CompareStock>).value);

  const { prompt, evidence } = buildComparePrompt(stocks);
  let model = "unavailable";

  type FlatAI = {
    overview?: string; valuation?: string; quality?: string; growth?: string;
    financialHealth?: string; momentum?: string; verdict?: string;
    capitalAllocation?: string; competitivePositioning?: string; riskComparison?: string;
    winner?: string | null; winnerRationale?: string;
    executiveSummary?: string; conditionsForChange?: string; confidenceScore?: number;
    sections?: ComparisonResult["sections"];
  };

  let flat: FlatAI = {};
  try {
    const { text: raw, model: usedModel } = await runPromptWithMeta("comparison", prompt, {
      maxTokens: 1800,
      json: true,
    });
    model = usedModel;
    flat = extractJson<FlatAI>(raw);
  } catch {
    // AI unavailable — metric table still works
  }

  const aiUnavailable = Object.keys(flat).length === 0;

  // The prompt returns a flat object; normalise into sections shape.
  const sections: ComparisonResult["sections"] = flat.sections ?? {
    overview: flat.overview ?? (aiUnavailable ? "AI analysis unavailable — run `ollama serve` to enable the written comparison. The metric table below is always computed." : ""),
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

  // Verify the written comparison against the metric table it was handed: every
  // P/E, margin, and growth figure the prose cites must trace to the data.
  const grounding = aiUnavailable
    ? undefined
    : verifyGrounding(
        collectClaimText([
          sections.overview, sections.valuation, sections.quality, sections.growth,
          sections.financialHealth, sections.momentum, sections.verdict,
          sections.capitalAllocation, sections.competitivePositioning, sections.riskComparison,
          flat.executiveSummary, flat.winnerRationale, flat.conditionsForChange,
        ]),
        evidence,
      );

  // Only trust a winner the model actually named one of the compared symbols.
  const winnerSymbol = flat.winner?.toUpperCase().trim();
  const winner = winnerSymbol && upper.includes(winnerSymbol) ? winnerSymbol : null;

  return {
    model,
    symbols: stocks.map((s) => s.symbol),
    sections,
    winner,
    winnerRationale: flat.winnerRationale ?? "",
    executiveSummary: flat.executiveSummary ?? (aiUnavailable ? sections.overview : ""),
    conditionsForChange: flat.conditionsForChange ?? "",
    confidenceScore: typeof flat.confidenceScore === "number"
      ? Math.max(0, Math.min(100, Math.round(flat.confidenceScore)))
      : Math.min(...stocks.map((s) => s.fundamentals.score.confidence)),
    metricTable: buildMetricTable(stocks),
    grounding,
  };
}
