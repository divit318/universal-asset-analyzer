/**
 * Side-by-side AI comparison of two stocks.
 *
 * Fetches full fundamentals for both symbols in parallel, then runs a
 * structured comparison prompt that produces a delta analysis: which is
 * cheaper, which has better quality, which has better growth, and a verdict.
 */

import { runPrompt, getActiveModelName } from "./ai";
import { getFundamentals } from "./fundamentals";
import { getFinancialStatements } from "./statements";
import { getHistory, getQuote } from "./yahoo";
import { computeScore, computeMomentum, assessRisks } from "./scoring";
import { formatCurrency, formatPercent, formatMarketCap } from "./format";
import type { FundamentalsData, Quote } from "./types";

export interface CompareStock {
  symbol: string;
  quote: Quote;
  fundamentals: FundamentalsData;
}

export interface ComparisonResult {
  model: string;
  symbolA: string;
  symbolB: string;
  sections: {
    overview: string;
    valuation: string;
    quality: string;
    growth: string;
    financialHealth: string;
    momentum: string;
    verdict: string;
  };
  winner: string | null; // symbol of the better overall pick, or null if too close
  winnerRationale: string;
  metricTable: CompareMetricRow[];
}

export interface CompareMetricRow {
  metric: string;
  a: string;
  b: string;
  better: "a" | "b" | "tie";
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
    },
  };
}

const fmt = {
  pct: (v: number | null) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`),
  x: (v: number | null) => (v == null ? "n/a" : `${v.toFixed(1)}x`),
  score: (v: number | null) => (v == null ? "n/a" : `${v}/100`),
};

function buildComparePrompt(a: CompareStock, b: CompareStock): string {
  const row = (label: string, va: string, vb: string) => `  ${label.padEnd(24)} ${va.padEnd(14)} ${vb}`;

  const header = `${"Metric".padEnd(24)} ${a.symbol.padEnd(14)} ${b.symbol}`;
  const divider = "-".repeat(55);

  const sa = a.fundamentals.snapshot;
  const sb = b.fundamentals.snapshot;
  const scorea = a.fundamentals.score;
  const scoreb = b.fundamentals.score;
  const moma = a.fundamentals.momentum;
  const momb = b.fundamentals.momentum;

  const table = [
    header,
    divider,
    row("Price", formatCurrency(a.quote.price, a.quote.currency), formatCurrency(b.quote.price, b.quote.currency)),
    row("Mkt Cap", formatMarketCap(a.quote.marketCap), formatMarketCap(b.quote.marketCap)),
    row("Today chg", formatPercent(a.quote.changePercent), formatPercent(b.quote.changePercent)),
    divider,
    row("Composite score", fmt.score(scorea.composite), fmt.score(scoreb.composite)),
    row("Recommendation", scorea.recommendation, scoreb.recommendation),
    row("Confidence", `${scorea.confidence}%`, `${scoreb.confidence}%`),
    divider,
    row("Trailing P/E", fmt.x(sa.trailingPE), fmt.x(sb.trailingPE)),
    row("Forward P/E", fmt.x(sa.forwardPE), fmt.x(sb.forwardPE)),
    row("PEG", fmt.x(sa.pegRatio), fmt.x(sb.pegRatio)),
    row("P/B", fmt.x(sa.priceToBook), fmt.x(sb.priceToBook)),
    row("Analyst upside", fmt.pct(a.fundamentals.analyst.upsidePercent), fmt.pct(b.fundamentals.analyst.upsidePercent)),
    divider,
    row("ROE", fmt.pct(sa.returnOnEquity ? sa.returnOnEquity * 100 : null), fmt.pct(sb.returnOnEquity ? sb.returnOnEquity * 100 : null)),
    row("Operating margin", fmt.pct(sa.operatingMargins ? sa.operatingMargins * 100 : null), fmt.pct(sb.operatingMargins ? sb.operatingMargins * 100 : null)),
    row("Revenue growth", fmt.pct(sa.revenueGrowth ? sa.revenueGrowth * 100 : null), fmt.pct(sb.revenueGrowth ? sb.revenueGrowth * 100 : null)),
    row("Earnings growth", fmt.pct(sa.earningsGrowth ? sa.earningsGrowth * 100 : null), fmt.pct(sb.earningsGrowth ? sb.earningsGrowth * 100 : null)),
    divider,
    row("Debt / Equity", fmt.x(sa.debtToEquity), fmt.x(sb.debtToEquity)),
    row("Current ratio", fmt.x(sa.currentRatio), fmt.x(sb.currentRatio)),
    row("Dividend yield", fmt.pct(sa.dividendYield ? sa.dividendYield * 100 : null), fmt.pct(sb.dividendYield ? sb.dividendYield * 100 : null)),
    divider,
    row("Momentum score", fmt.score(moma?.score ?? null), fmt.score(momb?.score ?? null)),
    row("Momentum trend", moma?.trend ?? "n/a", momb?.trend ?? "n/a"),
    row("vs 200d SMA", fmt.pct(moma?.vsSma200 ?? null), fmt.pct(momb?.vsSma200 ?? null)),
  ].join("\n");

  const risksA = a.fundamentals.risks.map((r) => `${r.category}[${r.level}]`).join(", ");
  const risksB = b.fundamentals.risks.map((r) => `${r.category}[${r.level}]`).join(", ");

  return `You are a senior equity research analyst. Compare ${a.symbol} vs ${b.symbol} using ONLY the data below.

${table}

${a.symbol} risks: ${risksA}
${b.symbol} risks: ${risksB}

Write a structured comparison. Be specific — cite numbers. Return as JSON:
{
  "overview": "2-3 sentences: what kind of companies are these and what is the core comparison thesis",
  "valuation": "Which is cheaper and why — cite P/E, PEG, P/B, analyst upside specifically",
  "quality": "Which has better quality — cite ROE, margins, earnings growth",
  "growth": "Which is growing faster — cite revenue growth, earnings growth, CAGR if available",
  "financialHealth": "Which has a stronger balance sheet — cite D/E, current ratio, FCF",
  "momentum": "Which has better price momentum — cite trend, SMA position, score",
  "verdict": "One clear paragraph: given all the above, which is the better pick right now and why. Be decisive.",
  "winner": "${a.symbol} or ${b.symbol} or null if too close to call",
  "winnerRationale": "One sentence max explaining the winner choice"
}`;
}

function buildMetricTable(a: CompareStock, b: CompareStock): CompareMetricRow[] {
  const sa = a.fundamentals.snapshot;
  const sb = b.fundamentals.snapshot;

  type Better = "a" | "b" | "tie";

  const lowerBetter = (va: number | null, vb: number | null): Better => {
    if (va == null && vb == null) return "tie";
    if (va == null) return "b";
    if (vb == null) return "a";
    if (Math.abs(va - vb) < 0.05 * Math.max(Math.abs(va), Math.abs(vb))) return "tie";
    return va < vb ? "a" : "b";
  };

  const higherBetter = (va: number | null, vb: number | null): Better => {
    if (va == null && vb == null) return "tie";
    if (va == null) return "b";
    if (vb == null) return "a";
    if (Math.abs(va - vb) < 0.05 * Math.max(Math.abs(va), Math.abs(vb))) return "tie";
    return va > vb ? "a" : "b";
  };



  return [
    { metric: "Composite score", a: fmt.score(a.fundamentals.score.composite), b: fmt.score(b.fundamentals.score.composite), better: higherBetter(a.fundamentals.score.composite, b.fundamentals.score.composite) },
    { metric: "Forward P/E", a: fmt.x(sa.forwardPE), b: fmt.x(sb.forwardPE), better: lowerBetter(sa.forwardPE, sb.forwardPE) },
    { metric: "PEG ratio", a: fmt.x(sa.pegRatio), b: fmt.x(sb.pegRatio), better: lowerBetter(sa.pegRatio, sb.pegRatio) },
    { metric: "ROE", a: fmt.pct(sa.returnOnEquity ? sa.returnOnEquity * 100 : null), b: fmt.pct(sb.returnOnEquity ? sb.returnOnEquity * 100 : null), better: higherBetter(sa.returnOnEquity, sb.returnOnEquity) },
    { metric: "Operating margin", a: fmt.pct(sa.operatingMargins ? sa.operatingMargins * 100 : null), b: fmt.pct(sb.operatingMargins ? sb.operatingMargins * 100 : null), better: higherBetter(sa.operatingMargins, sb.operatingMargins) },
    { metric: "Revenue growth", a: fmt.pct(sa.revenueGrowth ? sa.revenueGrowth * 100 : null), b: fmt.pct(sb.revenueGrowth ? sb.revenueGrowth * 100 : null), better: higherBetter(sa.revenueGrowth, sb.revenueGrowth) },
    { metric: "Analyst upside", a: fmt.pct(a.fundamentals.analyst.upsidePercent), b: fmt.pct(b.fundamentals.analyst.upsidePercent), better: higherBetter(a.fundamentals.analyst.upsidePercent, b.fundamentals.analyst.upsidePercent) },
    { metric: "Debt / Equity", a: fmt.x(sa.debtToEquity), b: fmt.x(sb.debtToEquity), better: lowerBetter(sa.debtToEquity, sb.debtToEquity) },
    { metric: "Dividend yield", a: fmt.pct(sa.dividendYield ? sa.dividendYield * 100 : null), b: fmt.pct(sb.dividendYield ? sb.dividendYield * 100 : null), better: higherBetter(sa.dividendYield, sb.dividendYield) },
    { metric: "Momentum score", a: fmt.score(a.fundamentals.momentum?.score ?? null), b: fmt.score(b.fundamentals.momentum?.score ?? null), better: higherBetter(a.fundamentals.momentum?.score ?? null, b.fundamentals.momentum?.score ?? null) },
  ];
}

export async function compareStocks(
  symbolA: string,
  symbolB: string,
): Promise<ComparisonResult> {
  const [resultA, resultB] = await Promise.allSettled([
    loadStock(symbolA.toUpperCase()),
    loadStock(symbolB.toUpperCase()),
  ]);

  if (resultA.status === "rejected") throw resultA.reason as Error;
  if (resultB.status === "rejected") throw resultB.reason as Error;

  const a = resultA.value;
  const b = resultB.value;

  const prompt = buildComparePrompt(a, b);
  const model = getActiveModelName();

  type FlatAI = {
    overview?: string; valuation?: string; quality?: string; growth?: string;
    financialHealth?: string; momentum?: string; verdict?: string;
    winner?: string | null; winnerRationale?: string;
    sections?: ComparisonResult["sections"];
  };

  let flat: FlatAI = {};
  try {
    const raw = await runPrompt(prompt, { maxTokens: 1500, json: true });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    flat = JSON.parse(cleaned) as FlatAI;
  } catch {
    // AI unavailable — metric table still works
  }

  // The prompt returns a flat object; normalise into sections shape.
  const sections: ComparisonResult["sections"] = flat.sections ?? {
    overview: flat.overview ?? (Object.keys(flat).length === 0 ? "AI analysis unavailable. Set OLLAMA_API_KEY or ANTHROPIC_API_KEY to enable." : ""),
    valuation: flat.valuation ?? "",
    quality: flat.quality ?? "",
    growth: flat.growth ?? "",
    financialHealth: flat.financialHealth ?? "",
    momentum: flat.momentum ?? "",
    verdict: flat.verdict ?? "",
  };

  return {
    model,
    symbolA: a.symbol,
    symbolB: b.symbol,
    sections,
    winner: flat.winner ?? null,
    winnerRationale: flat.winnerRationale ?? "",
    metricTable: buildMetricTable(a, b),
  };
}
