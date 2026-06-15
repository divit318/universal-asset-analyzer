/**
 * AI watchlist digest.
 *
 * Given a list of symbols with their live quotes + a quick fundamental fetch,
 * produces a ranked digest: which to watch, which to research deeper, any
 * concentration risks, and a portfolio-level summary.
 */

import { runPrompt } from "./ai";
import { getQuote } from "./yahoo";
import { getFundamentals } from "./fundamentals";
import { computeScore, computeMomentum, assessRisks } from "./scoring";
import { getHistory } from "./yahoo";
import type { Quote, WatchlistItem } from "./types";
import { formatCurrency, formatPercent, formatMarketCap } from "./format";

export interface WatchlistStockSummary {
  symbol: string;
  name: string;
  quote: Quote | null;
  fundamentalScore: number | null;
  recommendation: string | null;
  topRisk: string | null;
  analystUpside: number | null;
}

export interface WatchlistDigest {
  model: string;
  summary: string;
  actionItems: string[];
  concentrationRisks: string[];
  topPicks: string[];
  topConcerns: string[];
  stockSummaries: WatchlistStockSummary[];
  generatedAt: string;
}

/** Fetch lightweight data for one symbol — quote + fast fundamental score. */
async function summariseOne(item: WatchlistItem): Promise<WatchlistStockSummary> {
  try {
    const [quote, fundamentalParts, history] = await Promise.allSettled([
      getQuote(item.symbol),
      getFundamentals(item.symbol),
      getHistory(item.symbol, 420),
    ]);

    const q = quote.status === "fulfilled" ? quote.value : null;
    const fp = fundamentalParts.status === "fulfilled" ? fundamentalParts.value : null;
    const hist = history.status === "fulfilled" ? history.value : [];
    const momentum = computeMomentum(hist);
    const score = fp
      ? computeScore(fp.snapshot, null, fp.analyst, momentum)
      : null;
    const risks = fp && q
      ? assessRisks(fp.snapshot, null, fp.analyst, fp.insider)
      : [];

    return {
      symbol: item.symbol,
      name: item.name,
      quote: q,
      fundamentalScore: score?.composite ?? null,
      recommendation: score?.recommendation ?? null,
      topRisk: risks.find((r) => r.level === "high")?.category
        ?? risks.find((r) => r.level === "medium")?.category
        ?? null,
      analystUpside: fp?.analyst.upsidePercent ?? null,
    };
  } catch {
    return {
      symbol: item.symbol,
      name: item.name,
      quote: null,
      fundamentalScore: null,
      recommendation: null,
      topRisk: null,
      analystUpside: null,
    };
  }
}

function buildDigestPrompt(summaries: WatchlistStockSummary[]): string {
  const lines = summaries.map((s) => {
    const price = s.quote ? formatCurrency(s.quote.price, s.quote.currency) : "n/a";
    const chg = s.quote ? formatPercent(s.quote.changePercent) : "";
    const mcap = s.quote ? formatMarketCap(s.quote.marketCap) : "n/a";
    const upside = s.analystUpside != null
      ? `${s.analystUpside >= 0 ? "+" : ""}${s.analystUpside.toFixed(0)}% analyst upside`
      : "no analyst target";
    return `- ${s.symbol} (${s.name}): price ${price} ${chg}, mkt cap ${mcap}, composite score ${s.fundamentalScore ?? "n/a"}/100, recommendation ${s.recommendation ?? "n/a"}, ${upside}, top risk: ${s.topRisk ?? "none flagged"}`;
  });

  return `You are a portfolio strategist reviewing a personal watchlist. Using ONLY the data below, produce a concise digest.

WATCHLIST (${summaries.length} stocks):
${lines.join("\n")}

Produce a JSON response:
{
  "summary": "2-3 sentence overall portfolio health summary — be specific about the mix of buy/hold/sell signals and overall risk profile",
  "actionItems": ["Specific actionable item for 1-2 highest-priority stocks", "..."],
  "concentrationRisks": ["Any obvious sector/theme concentration risks visible from this list"],
  "topPicks": ["Top 2-3 symbols to research further with one-line reason each, e.g. 'AAPL: strong buy signal, +18% analyst upside'"],
  "topConcerns": ["Top 2-3 stocks with concerning signals and why, e.g. 'XYZ: SELL signal, high valuation risk'"]
}

Rules: cite symbol names and specific numbers. If fewer than 2 stocks, simplify. Keep each item under 15 words.`;
}

/** Run the AI watchlist digest across all items. Fetches data in parallel. */
export async function generateWatchlistDigest(
  items: WatchlistItem[],
): Promise<WatchlistDigest> {
  if (items.length === 0) {
    return {
      model: "n/a",
      summary: "Watchlist is empty.",
      actionItems: [],
      concentrationRisks: [],
      topPicks: [],
      topConcerns: [],
      stockSummaries: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // Fetch all summaries in parallel (capped at 10 to avoid hammering Yahoo).
  const capped = items.slice(0, 10);
  const summaries = await Promise.all(capped.map(summariseOne));

  const prompt = buildDigestPrompt(summaries);
  const model = process.env.AI_PROVIDER === "ollama"
    ? (process.env.OLLAMA_MODEL ?? "mistral")
    : (process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6");

  let parsed: {
    summary: string;
    actionItems: string[];
    concentrationRisks: string[];
    topPicks: string[];
    topConcerns: string[];
  };

  try {
    const raw = await runPrompt(prompt, { maxTokens: 1000, json: true });
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {
      summary: "AI digest unavailable. Check AI_PROVIDER configuration.",
      actionItems: [],
      concentrationRisks: [],
      topPicks: [],
      topConcerns: [],
    };
  }

  return {
    model,
    ...parsed,
    stockSummaries: summaries,
    generatedAt: new Date().toISOString(),
  };
}
