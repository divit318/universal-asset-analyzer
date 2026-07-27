import type { CashAllocationItem, AlternativeConsidered, RejectedOpportunity, MarginalBenefitPoint, HeldCashReason } from "@/lib/portfolio/engines/cash";
import type { Objective } from "@/lib/portfolio/engines/optimize";
import type { WhyExplanation } from "@/lib/portfolio/engines/decision";
import type { PortfolioEvaluation } from "@/lib/portfolio/engines/simulate";
import type { ScenarioResult } from "@/lib/portfolio/engines/scenario";

export interface NarratedAlternative extends AlternativeConsidered {
  reasonLabel: string;
}

export interface NarratedItem extends Omit<CashAllocationItem, "alternatives"> {
  impactSentence: string;
  alternatives: NarratedAlternative[];
}

export interface NarratedRejection extends RejectedOpportunity {
  reasonLabel: string;
  sentence: string;
}

export interface RiskComparisonSide {
  annualizedVolatility: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  var95Pct: number | null;
  cvar95Pct: number | null;
  hhi: number;
  topHoldingWeight: number;
  topSectorWeight: number;
  illiquidPct: number;
  avgCorrelation: number | null;
}

/** The full JSON shape POST /api/portfolio/allocate-cash returns. */
export interface CashPlanResponse {
  cashAmount: number;
  objective: Objective;
  items: NarratedItem[];
  heldAsCash: number;
  heldAsCashReason: HeldCashReason;
  heldAsCashSentence: string;
  totalHealthDelta: number;
  marginalBenefit: MarginalBenefitPoint[];
  rejectedOpportunities: NarratedRejection[];
  before: PortfolioEvaluation;
  after: PortfolioEvaluation;
  summary: string;
  why: WhyExplanation;
  scenarios: { before: ScenarioResult[]; after: ScenarioResult[] };
  riskComparison: { before: RiskComparisonSide; after: RiskComparisonSide };
}
