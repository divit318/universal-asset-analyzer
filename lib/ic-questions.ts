/**
 * IC Pipeline — Stage 2: Question Generation Engine
 *
 * Converts detected signals into investigative questions.
 * Each question is assigned to one or more agents that should answer it.
 * This is the "moat" — generating the right analytical questions, not just
 * summarising what the data shows.
 */

import type { DetectedSignal, SignalCategory } from "./ic-signals";

export type AgentDomain =
  | "business"
  | "industry"
  | "competition"
  | "management"
  | "capitalAllocation"
  | "accounting"
  | "valuation"
  | "governance"
  | "risk";

export interface InvestigativeQuestion {
  id: string;
  question: string;
  /** Which agents should attempt to answer this question */
  assignedAgents: AgentDomain[];
  /** The signal(s) that generated this question */
  sourceSignals: string[];
  priority: "high" | "medium" | "low";
}

/* -------------------------------------------------------------------------- */
/* Signal → question templates                                               */
/* -------------------------------------------------------------------------- */

const TEMPLATES: Record<
  SignalCategory,
  (signal: DetectedSignal) => InvestigativeQuestion[]
> = {
  MARGIN_COMPRESSION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Operating margins are under pressure (${s.dataPoints.join(", ")}). Is this structural due to competitive pricing, or temporary due to cost inflation or ramp-up costs?`,
      assignedAgents: ["business", "competition", "management"],
      sourceSignals: [s.id],
      priority: s.severity === "high" ? "high" : "medium",
    },
    {
      id: `${s.id}-q2`,
      question: `What is management's guidance on margin recovery? Has management explained the compression in recent commentary?`,
      assignedAgents: ["management", "accounting"],
      sourceSignals: [s.id],
      priority: "medium",
    },
  ],

  REVENUE_DECELERATION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Revenue growth is decelerating (${s.dataPoints.join(", ")}). What explains this — market saturation, macro headwinds, or competitive share loss?`,
      assignedAgents: ["business", "industry", "competition"],
      sourceSignals: [s.id],
      priority: "high",
    },
    {
      id: `${s.id}-q2`,
      question: `Is deceleration uniform across all business segments or concentrated in one division? Are new growth vectors being built?`,
      assignedAgents: ["business", "management"],
      sourceSignals: [s.id],
      priority: "medium",
    },
  ],

  ROCE_DROP: (s) => [
    {
      id: `${s.id}-q1`,
      question: `ROCE has declined (${s.description}). Is this due to a temporary capex cycle, debt-funded acquisition, or permanent deterioration in business economics?`,
      assignedAgents: ["business", "capitalAllocation", "accounting"],
      sourceSignals: [s.id],
      priority: "high",
    },
    {
      id: `${s.id}-q2`,
      question: `At what ROCE level does this business generate economic value above its cost of capital? Is the current level sustainable?`,
      assignedAgents: ["valuation", "capitalAllocation"],
      sourceSignals: [s.id],
      priority: "medium",
    },
  ],

  INVENTORY_SPIKE: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Inventory days spiked (${s.description}). Does this indicate demand weakness, strategic commodity stocking, or potential channel stuffing?`,
      assignedAgents: ["business", "accounting", "industry"],
      sourceSignals: [s.id],
      priority: s.severity === "high" ? "high" : "medium",
    },
  ],

  DEBT_INCREASE: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Leverage is elevated (${s.dataPoints.join(", ")}). Was this debt taken on for value-creating capex/acquisitions, or to fund operating losses?`,
      assignedAgents: ["capitalAllocation", "accounting", "risk"],
      sourceSignals: [s.id],
      priority: "high",
    },
    {
      id: `${s.id}-q2`,
      question: `What is the debt maturity profile and interest coverage? Is refinancing risk a concern given current rates?`,
      assignedAgents: ["risk", "accounting"],
      sourceSignals: [s.id],
      priority: "medium",
    },
  ],

  CAPEX_SURGE: (s) => [
    {
      id: `${s.id}-q1`,
      question: `${s.description}. Is this capex offensive (capacity expansion, new markets) or defensive (maintenance, regulatory compliance)?`,
      assignedAgents: ["business", "capitalAllocation", "management"],
      sourceSignals: [s.id],
      priority: "medium",
    },
  ],

  FII_SELLING: (s) => [
    {
      id: `${s.id}-q1`,
      question: `FII holding has declined (${s.description}). Is this driven by macro outflows from the sector/country, or company-specific concerns?`,
      assignedAgents: ["governance", "industry", "risk"],
      sourceSignals: [s.id],
      priority: s.severity === "high" ? "high" : "medium",
    },
  ],

  DII_BUYING: (s) => [
    {
      id: `${s.id}-q1`,
      question: `DII buying is increasing (${s.description}). Does this reflect domestic mutual fund mandate-driven flows or genuine value identification?`,
      assignedAgents: ["governance", "valuation"],
      sourceSignals: [s.id],
      priority: "low",
    },
  ],

  SHARE_DILUTION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `${s.description}. Is equity issuance funding value-creating growth or plugging balance sheet holes? What is the dilution impact on per-share metrics?`,
      assignedAgents: ["capitalAllocation", "governance", "valuation"],
      sourceSignals: [s.id],
      priority: "high",
    },
  ],

  GUIDANCE_CUT: (s) => [
    {
      id: `${s.id}-q1`,
      question: `${s.description}. Is the guidance cut a kitchen-sink reset (buying future upside) or the start of a sustained downgrade cycle?`,
      assignedAgents: ["management", "business", "risk"],
      sourceSignals: [s.id],
      priority: "high",
    },
  ],

  MARKET_SHARE_LOSS: (s) => [
    {
      id: `${s.id}-q1`,
      question: `${s.description}. Is the company losing share to a structural competitive threat, or is this temporary due to pricing/capacity decisions?`,
      assignedAgents: ["competition", "business", "industry"],
      sourceSignals: [s.id],
      priority: "high",
    },
  ],

  WORKING_CAPITAL_DETERIORATION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Working capital is lengthening (${s.description}). Does this indicate weakening bargaining power with customers/suppliers, or a deliberate shift in business mix?`,
      assignedAgents: ["business", "accounting", "competition"],
      sourceSignals: [s.id],
      priority: "medium",
    },
  ],

  ROYALTY_INCREASE: (s) => [
    {
      id: `${s.id}-q1`,
      question: `${s.description}. Are royalty payments to the parent creating a structural earnings drain? Does the royalty rate reflect fair market value?`,
      assignedAgents: ["governance", "accounting", "valuation"],
      sourceSignals: [s.id],
      priority: "high",
    },
  ],

  RELATED_PARTY_EXPANSION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `${s.description}. Are related-party transactions at arm's length? Do they create or destroy value for minority shareholders?`,
      assignedAgents: ["governance", "accounting", "risk"],
      sourceSignals: [s.id],
      priority: "high",
    },
  ],

  INSIDER_SELLING: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Net insider selling of ${s.dataPoints.find((d) => d.startsWith("Net"))}. Is this diversification/liquidity selling or a signal that insiders see limited upside from here?`,
      assignedAgents: ["governance", "management", "risk"],
      sourceSignals: [s.id],
      priority: s.severity === "high" ? "high" : "medium",
    },
  ],

  FCF_DETERIORATION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Free cash flow is deteriorating (${s.description}). Is earnings quality eroding — higher accruals, aggressive revenue recognition, or rising receivables?`,
      assignedAgents: ["accounting", "business", "risk"],
      sourceSignals: [s.id],
      priority: "high",
    },
  ],

  VALUATION_STRETCH: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Valuation is stretched (${s.dataPoints.join(", ")}). What growth and margin assumptions are required to justify the current price? How sensitive is the valuation to a growth miss?`,
      assignedAgents: ["valuation", "risk"],
      sourceSignals: [s.id],
      priority: "medium",
    },
  ],

  EARNINGS_MISS_STREAK: (s) => [
    {
      id: `${s.id}-q1`,
      question: `The company has missed EPS estimates ${s.dataPoints.filter((d) => d.includes("-")).length}+ times recently. Is consensus still too optimistic? What are the key estimation errors analysts keep making?`,
      assignedAgents: ["management", "accounting", "valuation"],
      sourceSignals: [s.id],
      priority: "high",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Baseline questions always generated (not signal-dependent)                */
/* -------------------------------------------------------------------------- */

function baselineQuestions(companyName: string, symbol: string): InvestigativeQuestion[] {
  return [
    {
      id: "base-business-model",
      question: `What is the core business model of ${companyName} (${symbol})? How does it earn money, and what are the key unit economics?`,
      assignedAgents: ["business"],
      sourceSignals: [],
      priority: "high",
    },
    {
      id: "base-competitive-moat",
      question: `What is the competitive moat? Is it cost leadership, switching costs, network effects, brand, or IP? How durable is it?`,
      assignedAgents: ["business", "competition"],
      sourceSignals: [],
      priority: "high",
    },
    {
      id: "base-industry-dynamics",
      question: `What are the key industry growth drivers and headwinds over the next 3-5 years? Where is the industry in its lifecycle?`,
      assignedAgents: ["industry"],
      sourceSignals: [],
      priority: "high",
    },
    {
      id: "base-management-quality",
      question: `How has management allocated capital historically? Have they created or destroyed value through acquisitions, buybacks, and capex cycles?`,
      assignedAgents: ["management", "capitalAllocation"],
      sourceSignals: [],
      priority: "medium",
    },
    {
      id: "base-key-risks",
      question: `What are the top 3 risks that could cause a permanent impairment of intrinsic value? Which risks are underappreciated by the market?`,
      assignedAgents: ["risk"],
      sourceSignals: [],
      priority: "high",
    },
    {
      id: "base-valuation-context",
      question: `Is the current market price above or below your estimate of intrinsic value? What does the market appear to be pricing in?`,
      assignedAgents: ["valuation"],
      sourceSignals: [],
      priority: "high",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Main function                                                              */
/* -------------------------------------------------------------------------- */

export function generateQuestions(
  signals: DetectedSignal[],
  companyName: string,
  symbol: string,
): InvestigativeQuestion[] {
  const questions: InvestigativeQuestion[] = [...baselineQuestions(companyName, symbol)];

  for (const signal of signals) {
    const template = TEMPLATES[signal.category];
    if (template) {
      questions.push(...template(signal));
    }
  }

  // Deduplicate by id and sort: high priority first
  const seen = new Set<string>();
  return questions
    .filter((q) => {
      if (seen.has(q.id)) return false;
      seen.add(q.id);
      return true;
    })
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });
}

/** Group questions by agent domain for parallel dispatch. */
export function groupByAgent(
  questions: InvestigativeQuestion[],
): Map<AgentDomain, InvestigativeQuestion[]> {
  const map = new Map<AgentDomain, InvestigativeQuestion[]>();
  for (const q of questions) {
    for (const agent of q.assignedAgents) {
      if (!map.has(agent)) map.set(agent, []);
      map.get(agent)!.push(q);
    }
  }
  return map;
}
