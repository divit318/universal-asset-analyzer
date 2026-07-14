/**
 * The Commodity research engine — Phase 3 of the Research Hub's multi-asset-
 * class expansion. Market-data only, same reasoning as Crypto (Phase 2):
 * momentum, relative strength vs a commodity index (DBC), risk-adjusted
 * return, and drawdown, all from Yahoo price history. Supply/demand/
 * geopolitical context — the qualitative dimension this asset class needs —
 * is handled by the AI insight layer grounded in news, not by this scorer.
 */

import type { ResearchEngine, ResearchModule } from "../types";
import type { CommodityProfileData } from "../../types";
import { getHistory } from "../../yahoo";
import { computeCommodityScore } from "../../commodity-scoring";

export const COMMODITY_BENCHMARK_SYMBOL = "DBC";

export const COMMODITY_MODULES: ResearchModule[] = [
  { id: "commodity-score", tab: "conviction", title: "Commodity Score" },
  { id: "commodity-ai-insight", tab: "analysis", title: "AI Commodity Insight" },
  { id: "commodity-relative-strength", tab: "financials", title: "Relative Strength vs Commodity Index" },
  { id: "commodity-risk-profile", tab: "financials", title: "Risk Profile" },
  { id: "commodity-supply-demand", tab: "financials", title: "Supply & Demand Context" },
];

async function fetchCommodityData(): Promise<CommodityProfileData> {
  const benchmarkHistory = await getHistory(COMMODITY_BENCHMARK_SYMBOL, 730);
  return { benchmarkHistory };
}

export const commodityEngine: ResearchEngine<CommodityProfileData> = {
  assetClass: "commodity",
  taskType: "commodity-research",
  modules: COMMODITY_MODULES,
  fetchData: fetchCommodityData,
  score: (data, history) => {
    const result = computeCommodityScore(history, data.benchmarkHistory.length > 0 ? data.benchmarkHistory : null);
    return {
      value: result.composite,
      recommendation: result.recommendation,
      confidence: result.confidence,
      rationale: result.rationale,
    };
  },
};
