/**
 * The Crypto research engine — Phase 2 of the Research Hub's multi-asset-
 * class expansion. Market-data only for this phase: momentum, relative
 * strength vs BTC, risk-adjusted return, and drawdown risk, all computed
 * from Yahoo price history (the same source the equity/fund paths already
 * use) — no new external provider, matching how Funds (Phase 1) validated
 * the pattern before any phase reaches for tokenomics/on-chain data.
 */

import type { ResearchEngine, ResearchModule } from "../types";
import type { CryptoProfileData } from "../../types";
import { getHistory } from "../../yahoo";
import { computeCryptoScore } from "../../crypto-scoring";

export const CRYPTO_MODULES: ResearchModule[] = [
  { id: "crypto-score", tab: "conviction", title: "Crypto Score" },
  { id: "crypto-ai-insight", tab: "analysis", title: "AI Crypto Insight" },
  { id: "crypto-relative-strength", tab: "financials", title: "Relative Strength vs BTC" },
  { id: "crypto-risk-profile", tab: "financials", title: "Risk Profile" },
];

async function fetchCryptoData(symbol: string): Promise<CryptoProfileData> {
  const isBtc = symbol.toUpperCase().startsWith("BTC-USD");
  const btcHistory = isBtc ? [] : await getHistory("BTC-USD", 730);
  return { symbol, btcHistory };
}

export const cryptoEngine: ResearchEngine<CryptoProfileData> = {
  assetClass: "crypto",
  taskType: "crypto-research",
  modules: CRYPTO_MODULES,
  fetchData: fetchCryptoData,
  score: (data, history) => {
    const result = computeCryptoScore(data.symbol, history, data.btcHistory.length > 0 ? data.btcHistory : null);
    return {
      value: result.composite,
      recommendation: result.recommendation,
      confidence: result.confidence,
      rationale: result.rationale,
    };
  },
};
