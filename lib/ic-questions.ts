/**
 * IC Pipeline — Stage 2: Question Generation Engine.
 *
 * Converts detected signals into investigative questions and adds a small,
 * explicitly-labelled baseline set. Every question carries its kind
 * ("signal" questions are genuinely derived — they embed the signal's own
 * numbers; "baseline" questions are the standing IC checklist and say so).
 *
 * Every one of the 9 agent domains always receives at least one question, so
 * the advertised agent count is the actual agent count on every run
 * (Phase 3.1): AGENT_COUNT is the single source for every surface.
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

export const AGENT_DOMAINS: AgentDomain[] = [
  "business",
  "industry",
  "competition",
  "management",
  "capitalAllocation",
  "accounting",
  "valuation",
  "governance",
  "risk",
];

/** One constant, one source, every surface (Phase 3.1). */
export const AGENT_COUNT = AGENT_DOMAINS.length;

/** Display labels for agent domains — the single source for every surface
 * (UI, exports, prompts). Domain keys are identifiers, not labels. */
export const AGENT_LABELS: Record<AgentDomain, string> = {
  business: "Business Analyst",
  industry: "Industry Analyst",
  competition: "Competitive Intelligence Analyst",
  management: "Management Quality Analyst",
  capitalAllocation: "Capital Allocation Analyst",
  accounting: "Forensic Accounting Analyst",
  valuation: "Valuation Analyst",
  governance: "Governance & Ownership Analyst",
  risk: "Risk Analyst",
};

/** Questions handed to a single agent are capped to keep prompts bounded. */
export const MAX_QUESTIONS_PER_AGENT = 6;

export interface InvestigativeQuestion {
  id: string;
  question: string;
  /** Which agents should attempt to answer this question */
  assignedAgents: AgentDomain[];
  /** The signal(s) that generated this question */
  sourceSignals: string[];
  /** "signal": derived from a fired detector. "baseline": standing checklist. */
  kind: "signal" | "baseline";
  priority: "high" | "medium" | "low";
}

/* -------------------------------------------------------------------------- */
/* Signal → question templates                                                */
/* -------------------------------------------------------------------------- */

const TEMPLATES: Record<SignalCategory, (signal: DetectedSignal) => InvestigativeQuestion[]> = {
  MARGIN_COMPRESSION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Operating margins are under pressure (${s.dataPoints.join(", ")}). Is this structural due to competitive pricing, or temporary due to cost inflation or ramp-up costs?`,
      assignedAgents: ["business", "competition", "management"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: s.severity === "high" ? "high" : "medium",
    },
    {
      id: `${s.id}-q2`,
      question: `What does the margin trend (${s.dataPoints.join(", ")}) imply for earnings quality: is the compression flowing through to cash conversion, or absorbed by accruals?`,
      assignedAgents: ["accounting"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "medium",
    },
  ],

  REVENUE_DECELERATION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Revenue growth is decelerating (${s.dataPoints.join(", ")}). What explains this: market saturation, macro headwinds, or competitive share loss?`,
      assignedAgents: ["business", "industry", "competition"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "high",
    },
    {
      id: `${s.id}-q2`,
      question: `Given the deceleration (${s.dataPoints.join(", ")}), what growth rate should the valuation carry, and what does the current price imply the market believes?`,
      assignedAgents: ["valuation"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "medium",
    },
  ],

  ROCE_DROP: (s) => [
    {
      id: `${s.id}-q1`,
      question: `ROCE has declined (${s.description}). Is this a temporary capex cycle, a debt-funded acquisition, or permanent deterioration in business economics?`,
      assignedAgents: ["business", "capitalAllocation", "accounting"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "high",
    },
  ],

  INVENTORY_SPIKE: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Inventory days spiked (${s.description}). Does this indicate demand weakness, strategic commodity stocking, or potential channel stuffing?`,
      assignedAgents: ["business", "accounting", "industry"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: s.severity === "high" ? "high" : "medium",
    },
  ],

  DEBT_INCREASE: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Leverage is elevated (${s.dataPoints.join(", ")}). Was this debt taken on for value-creating capex/acquisitions, or to fund operating losses?`,
      assignedAgents: ["capitalAllocation", "accounting", "risk"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "high",
    },
    {
      id: `${s.id}-q2`,
      question: `With leverage at ${s.dataPoints[0] ?? "the current level"}, what is the refinancing risk and interest coverage headroom if rates stay elevated?`,
      assignedAgents: ["risk"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "medium",
    },
  ],

  FII_SELLING: (s) => [
    {
      id: `${s.id}-q1`,
      question: `FII holding has declined (${s.description}). Is this driven by macro outflows from the sector/country, or company-specific concerns?`,
      assignedAgents: ["governance", "industry", "risk"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: s.severity === "high" ? "high" : "medium",
    },
  ],

  DII_BUYING: (s) => [
    {
      id: `${s.id}-q1`,
      question: `DII buying is increasing (${s.description}). Does this reflect domestic mutual fund mandate-driven flows or genuine value identification?`,
      assignedAgents: ["governance", "valuation"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "low",
    },
  ],

  WORKING_CAPITAL_DETERIORATION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Working capital is lengthening (${s.description}). Does this indicate weakening bargaining power with customers/suppliers, or a deliberate shift in business mix?`,
      assignedAgents: ["business", "accounting", "competition"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "medium",
    },
  ],

  INSIDER_SELLING: (s) => [
    {
      id: `${s.id}-q1`,
      question: `There is net insider selling (${s.dataPoints.find((d) => d.startsWith("Net")) ?? s.description}). Is this diversification/liquidity selling or a signal that insiders see limited upside from here?`,
      assignedAgents: ["governance", "management", "risk"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: s.severity === "high" ? "high" : "medium",
    },
  ],

  FCF_DETERIORATION: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Free cash flow is deteriorating (${s.description}). Is earnings quality eroding: higher accruals, aggressive revenue recognition, or rising receivables?`,
      assignedAgents: ["accounting", "business", "risk"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "high",
    },
  ],

  VALUATION_STRETCH: (s) => [
    {
      id: `${s.id}-q1`,
      question: `Valuation is stretched (${s.dataPoints.join(", ")}). What growth and margin assumptions are required to justify the current price? How sensitive is the valuation to a growth miss?`,
      assignedAgents: ["valuation", "risk"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "medium",
    },
  ],

  EARNINGS_MISS_STREAK: (s) => [
    {
      id: `${s.id}-q1`,
      question: `The company has missed EPS estimates repeatedly (${s.description}). Is consensus still too optimistic? What are the estimation errors analysts keep making?`,
      assignedAgents: ["management", "accounting", "valuation"],
      sourceSignals: [s.id],
      kind: "signal",
      priority: "high",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Baseline questions — the standing IC checklist, one per domain minimum     */
/* -------------------------------------------------------------------------- */

function baselineQuestions(companyName: string, symbol: string): InvestigativeQuestion[] {
  const base = (id: string, question: string, assignedAgents: AgentDomain[], priority: InvestigativeQuestion["priority"]): InvestigativeQuestion =>
    ({ id, question, assignedAgents, sourceSignals: [], kind: "baseline", priority });

  return [
    base("base-business-model", `What is the core business model of ${companyName} (${symbol})? How does it earn money, and what are the key unit economics?`, ["business"], "high"),
    base("base-competitive-moat", `What is the competitive moat? Is it cost leadership, switching costs, network effects, brand, or IP? How durable is it?`, ["competition"], "high"),
    base("base-industry-dynamics", `What are the key industry growth drivers and headwinds over the next 3-5 years? Where is the industry in its lifecycle?`, ["industry"], "high"),
    base("base-management-quality", `What does the delivery record show: has management done what it said (guidance, product timelines, capital plans)?`, ["management"], "medium"),
    base("base-capital-allocation", `Where has capital actually gone (capex, M&A, buybacks, dividends) and at what incremental return? Did those choices create or destroy per-share value?`, ["capitalAllocation"], "medium"),
    base("base-earnings-quality", `How closely does reported profit convert to cash? Are accruals, working capital swings or one-offs flattering the earnings number?`, ["accounting"], "medium"),
    base("base-valuation-context", `What growth, margin and return assumptions does the current price embed, and are they demanding or conservative against the delivered history?`, ["valuation"], "high"),
    base("base-governance", `Who controls the company, how aligned are they with minority shareholders, and are there related-party or structure red flags?`, ["governance"], "medium"),
    base("base-key-risks", `What are the top 3 risks that could cause a permanent impairment of intrinsic value? Which risks are underappreciated by the market?`, ["risk"], "high"),
  ];
}

/* -------------------------------------------------------------------------- */
/* Main functions                                                             */
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

/**
 * Group questions by agent domain for dispatch. Every domain is present —
 * baseline questions guarantee it — so the map always has AGENT_COUNT keys.
 */
export function groupByAgent(
  questions: InvestigativeQuestion[],
): Map<AgentDomain, InvestigativeQuestion[]> {
  const map = new Map<AgentDomain, InvestigativeQuestion[]>();
  for (const domain of AGENT_DOMAINS) map.set(domain, []);
  for (const q of questions) {
    for (const agent of q.assignedAgents) {
      map.get(agent)!.push(q);
    }
  }
  return map;
}
