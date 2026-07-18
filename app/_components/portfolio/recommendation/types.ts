import type { PositionSizingPlan, SizeScenario } from "@/lib/portfolio/engines/position-size";
import type { WhyExplanation } from "@/lib/portfolio/engines/decision";

export interface SellSuggestion {
  holdingId: string;
  symbol: string | null;
  name: string;
  amount: number;
  rationale: string;
}

/** The full JSON shape POST /api/portfolio/buy/recommendation returns. */
export interface BuyRecommendationResponse extends PositionSizingPlan {
  cashAvailable: number;
  fundingShortfall: number;
  fundingFullyCoveredByCash: boolean;
  sellSuggestions: SellSuggestion[];
  sellSuggestionsCoverShortfall: boolean;
  why: WhyExplanation;
  aiExplanation: string;
  summary: string;
}

export type FundingSource = "cash" | "sell_holdings" | "optimizer_decides";

export type { SizeScenario };
