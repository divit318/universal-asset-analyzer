/**
 * The Forex research engine — Phase 4 of the Research Hub's multi-asset-
 * class expansion. Market-data only, same reasoning as Commodities (Phase
 * 3): momentum, relative strength vs the US Dollar Index, risk-adjusted
 * return, and drawdown, all from Yahoo price history. Central bank policy/
 * inflation/GDP/rate-differential context — the qualitative dimension this
 * asset class needs — is handled by the AI insight layer grounded in news,
 * not by this scorer.
 */

import type { ResearchEngine, ResearchModule } from "../types";
import type { ForexProfileData } from "../../types";
import { getHistory } from "../../yahoo";
import { computeForexScore, DOLLAR_INDEX_SYMBOL } from "../../forex-scoring";

export const FOREX_MODULES: ResearchModule[] = [
  { id: "forex-score", tab: "conviction", title: "Forex Score" },
  { id: "forex-ai-insight", tab: "analysis", title: "AI Forex Insight" },
  { id: "forex-relative-strength", tab: "financials", title: "Relative Strength vs Dollar Index" },
  { id: "forex-risk-profile", tab: "financials", title: "Risk Profile" },
  { id: "forex-macro-context", tab: "financials", title: "Macro Context" },
];

async function fetchForexData(symbol: string): Promise<ForexProfileData> {
  const isDxy = symbol.toUpperCase() === DOLLAR_INDEX_SYMBOL.toUpperCase();
  const benchmarkHistory = isDxy ? [] : await getHistory(DOLLAR_INDEX_SYMBOL, 730);
  return { symbol, benchmarkHistory };
}

export const forexEngine: ResearchEngine<ForexProfileData> = {
  assetClass: "forex",
  taskType: "forex-research",
  modules: FOREX_MODULES,
  fetchData: fetchForexData,
  score: (data, history) => {
    const result = computeForexScore(data.symbol, history, data.benchmarkHistory.length > 0 ? data.benchmarkHistory : null);
    return {
      value: result.composite,
      recommendation: result.recommendation,
      confidence: result.confidence,
      rationale: result.rationale,
    };
  },
};
