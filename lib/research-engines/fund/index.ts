/**
 * The Fund research engine — Phase 1 of the Research Hub's multi-asset-class
 * expansion. Covers ETFs, mutual funds, index funds, and closed-end funds
 * (Yahoo quoteType ETF/MUTUALFUND/CLOSEDENDFUND, see lib/asset-class.ts).
 *
 * Chosen as Phase 1 because it needs zero new external data provider — the
 * same Yahoo quoteSummary endpoint the equity path already calls exposes
 * fundProfile/topHoldings/fundPerformance for these quoteTypes (lib/yahoo.ts
 * getFundProfile) — so this engine validates the whole
 * detect→registry→fetch→score→render pattern without conflating
 * architecture risk with new-data-source risk.
 */

import type { ResearchEngine, ResearchModule } from "../types";
import type { FundProfileData } from "../../types";
import { getFundProfile } from "../../yahoo";
import { computeFundScore } from "../../fund-scoring";

export const FUND_MODULES: ResearchModule[] = [
  { id: "fund-score", tab: "conviction", title: "Fund Score" },
  { id: "fund-ai-insight", tab: "analysis", title: "AI Fund Insight" },
  { id: "fund-holdings", tab: "financials", title: "Top Holdings" },
  { id: "fund-sector-allocation", tab: "financials", title: "Sector Allocation" },
  { id: "fund-performance", tab: "financials", title: "Performance vs Category" },
  { id: "fund-profile", tab: "details", title: "Fund Profile" },
];

export const fundEngine: ResearchEngine<FundProfileData> = {
  assetClass: "fund",
  taskType: "fund-research",
  modules: FUND_MODULES,
  fetchData: getFundProfile,
  score: (data, history) => {
    const result = computeFundScore(data, history);
    return {
      value: result.composite,
      recommendation: result.recommendation,
      confidence: result.confidence,
      rationale: result.rationale,
    };
  },
};
