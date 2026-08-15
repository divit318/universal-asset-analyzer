import type { Filing, Quote } from "./types";
import { formatCompactCurrency, formatCurrency, formatPercent } from "./format";

export interface AnalysisInput {
  quote: Quote;
  filings: Filing[];
}

/**
 * Build the LLM prompt from structured market data. Pure so it can be tested
 * without contacting a model.
 */
export function buildAnalysisPrompt({ quote, filings }: AnalysisInput): string {
  const recentFilings =
    filings.length > 0
      ? filings
          .slice(0, 5)
          .map((f) => `- ${f.form} filed ${f.filedAt}: ${f.description}`)
          .join("\n")
      : "No recent SEC filings available.";

  return [
    "You are a concise equity research assistant. Analyze the asset below using ONLY the data provided.",
    "Do not invent numbers. If data is missing, say so. Keep the response under 200 words.",
    "",
    `Symbol: ${quote.symbol} (${quote.name})`,
    `Price: ${formatCurrency(quote.price, quote.currency)} (${formatPercent(quote.changePercent)} today)`,
    `Market cap: ${formatCompactCurrency(quote.marketCap, quote.currency)}`,
    `P/E ratio: ${quote.peRatio ?? "n/a"}`,
    `52-week range: ${formatCurrency(quote.fiftyTwoWeekLow, quote.currency)} – ${formatCurrency(quote.fiftyTwoWeekHigh, quote.currency)}`,
    "",
    "Recent SEC filings:",
    recentFilings,
    "",
    "Provide: (1) a one-sentence summary, (2) 2-3 notable observations, (3) one risk to watch.",
  ].join("\n");
}

// Inference lives behind the AI platform (lib/ai/); the analyzeAsset entry
// point is lib/ai.ts. This module only builds the prompt.
