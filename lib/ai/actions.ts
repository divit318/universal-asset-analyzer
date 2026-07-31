/**
 * Research Tools Layer — the predefined, one-click research actions.
 *
 * Each action is a named research request: the user-facing label, the
 * instruction the model receives, the dominant intent (so the retrieval layer
 * pulls the right evidence), whether it should follow the full institutional
 * report structure, and the follow-up questions to suggest afterward.
 */

import type { ResearchIntent } from "./types";

export interface ResearchAction {
  id: string;
  label: string;
  /** The instruction injected as the user turn for this action. */
  instruction: string;
  intents: ResearchIntent[];
  /** Use the full 9-section report structure (vs. a focused answer). */
  structured: boolean;
  /** Deterministic follow-up suggestions offered after the answer. */
  followUps: string[];
}

export const RESEARCH_ACTIONS: ResearchAction[] = [
  {
    id: "summary",
    label: "Company Summary",
    instruction:
      "Give a concise institutional overview of this company: what it does, how it makes money, its scale, and where it sits competitively.",
    intents: ["general", "competitive"],
    structured: false,
    followUps: ["Is this company undervalued?", "What are the key risks?", "Explain the business model in depth."],
  },
  {
    id: "thesis",
    label: "Investment Thesis",
    instruction:
      "Build the full investment thesis for this stock as a buy-side analyst. Weigh valuation, growth, quality, and risk, and conclude with a clear stance and the assumptions it depends on.",
    intents: ["thesis", "valuation", "growth", "risks"],
    structured: true,
    followUps: ["What assumptions would break this thesis?", "What growth does the current price imply?", "Would Buffett invest in this company?"],
  },
  {
    id: "bull",
    label: "Bull Case",
    instruction:
      "Make the strongest evidence-based bull case for this stock. What has to go right, and what could double it over five years?",
    intents: ["catalysts", "growth"],
    structured: false,
    followUps: ["Now give me the bear case.", "What are the growth catalysts?", "What could cause the stock to double?"],
  },
  {
    id: "bear",
    label: "Bear Case",
    instruction:
      "Make the strongest evidence-based bear case for this stock. What could cause a 30% decline, and what would break the investment thesis?",
    intents: ["risks"],
    structured: false,
    followUps: ["Now give me the bull case.", "What could cause a 30% decline?", "How leveraged is the balance sheet?"],
  },
  {
    id: "valuation",
    label: "Valuation Analysis",
    instruction:
      // Deliberately does not estimate a value: the intrinsic value belongs to the
      // ValuationCase (lib/valuation/), which is persisted and correctable. A
      // copilot number would be a second, unfalsifiable answer that evaporates
      // when the chat scrolls away.
      "Assess valuation using observable evidence only: multiples versus the company's own history and its peers, what the current price implies about expected growth, and analyst targets as a third-party fact. Do NOT produce your own intrinsic value or price target — point the user to the Valuation workspace for that, and instead say which assumptions the current price depends on.",
    intents: ["valuation", "comparison"],
    structured: true,
    followUps: ["What assumptions justify the current price?", "How does valuation compare to peers?", "What is the bear case on valuation?"],

  },
  {
    id: "growth",
    label: "Growth Analysis",
    instruction:
      "Analyze the company's growth: historical trajectory, current drivers, durability, and the key growth catalysts ahead.",
    intents: ["growth", "catalysts"],
    structured: false,
    followUps: ["Is the growth profitable?", "What could accelerate growth?", "How does growth compare to peers?"],
  },
  {
    id: "competitive",
    label: "Competitive Analysis",
    instruction:
      "Analyze competitive positioning: the moat and durable advantages, the competitive threats, and how the company compares to sector peers and historical leaders.",
    intents: ["competitive", "comparison"],
    structured: false,
    followUps: ["Compare this company to its closest competitor.", "How wide is the moat?", "What competitive threats are emerging?"],
  },
  {
    id: "management",
    label: "Management Analysis",
    instruction:
      "Evaluate management quality and capital allocation: leadership track record, insider alignment, and how well capital is deployed.",
    intents: ["management", "capitalAllocation"],
    structured: false,
    followUps: ["How good is capital allocation?", "Are insiders buying or selling?", "Is management aligned with shareholders?"],
  },
  {
    id: "risk",
    label: "Risk Analysis",
    instruction:
      "Identify and rank the material risks to this investment — business, financial, valuation, and execution — and what would signal each is materializing.",
    intents: ["risks", "financialHealth"],
    structured: false,
    followUps: ["What could cause a 30% decline?", "How strong is the balance sheet?", "What is the bear case?"],
  },
  {
    id: "health",
    label: "Financial Health Analysis",
    instruction:
      "Assess balance-sheet strength and financial health: leverage, liquidity, cash generation, and resilience through a downturn.",
    intents: ["financialHealth"],
    structured: false,
    followUps: ["Can it service its debt?", "How strong is free cash flow?", "What are the financial risks?"],
  },
  {
    id: "capital",
    label: "Capital Allocation Analysis",
    instruction:
      "Evaluate capital allocation: reinvestment, buybacks, dividends, and M&A. Is management creating or destroying value with the cash it generates?",
    intents: ["capitalAllocation", "financialHealth"],
    structured: false,
    followUps: ["Are buybacks accretive at this price?", "Is the dividend safe?", "How is management allocating capital?"],
  },
  {
    id: "earnings",
    label: "Earnings Summary",
    instruction:
      "Summarize the most recent earnings picture: revenue and EPS trajectory, margins, surprises versus expectations, and analyst reaction.",
    intents: ["earnings", "growth"],
    structured: false,
    followUps: ["Did they beat or miss expectations?", "Are margins expanding or compressing?", "What is the guidance outlook?"],
  },
  {
    id: "filings",
    label: "Filing Summary",
    instruction:
      "Summarize what the recent SEC filings tell an investor. Identify the most decision-relevant disclosures and what to read next.",
    intents: ["filings"],
    structured: false,
    followUps: ["Anything concerning in the latest 10-K?", "Summarize the latest 8-K.", "What are the disclosed risk factors?"],
  },
  {
    id: "news",
    label: "News Summary",
    instruction:
      "Summarize the recent news flow and what it means for the investment thesis. Separate signal from noise.",
    intents: ["news"],
    structured: false,
    followUps: ["Does any of this change the thesis?", "What are the key risks right now?", "What catalysts are coming up?"],
  },
  {
    id: "technical",
    label: "Technical Analysis",
    instruction:
      "Conduct a technical analysis of this stock. Describe the current trend (using moving average alignment and price structure), momentum (RSI and MACD signals), volatility context (Bollinger Band positioning), key support and resistance levels, and any notable candlestick pattern setups visible in recent price action. Conclude with what the technical picture suggests about near-term risk/reward — and where the technical view aligns with or diverges from the fundamental thesis.",
    intents: ["technical", "risks", "catalysts"],
    structured: false,
    followUps: [
      "Is the stock technically overbought or oversold?",
      "What price level would confirm a breakout?",
      "How does the technical setup compare to the fundamental valuation?",
    ],
  },
  {
    id: "compare",
    label: "Compare Competitors",
    instruction:
      "Compare this company to its sector peers on valuation, growth, profitability, and balance-sheet strength, and say where it ranks and why.",
    intents: ["comparison", "competitive", "valuation"],
    structured: true,
    followUps: ["Which peer is the better investment?", "Where does it rank on valuation?", "What explains the valuation gap?"],
  },
];

const BY_ID = new Map(RESEARCH_ACTIONS.map((a) => [a.id, a]));

export function getAction(id: string | undefined): ResearchAction | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/** Default follow-ups for free-text questions (no action), by intent. */
const INTENT_FOLLOWUPS: Partial<Record<ResearchIntent, string[]>> = {
  valuation: ["What growth does the current price imply?", "How does valuation compare to peers?", "What is the bear case?"],
  growth: ["Is the growth durable?", "What are the growth catalysts?", "How does growth compare to peers?"],
  risks: ["What could cause a 30% decline?", "What is the bull case?", "How strong is the balance sheet?"],
  thesis: ["What assumptions would break the thesis?", "Would Buffett invest here?", "What is the bear case?"],
  competitive: ["How wide is the moat?", "Compare to the closest competitor.", "What are the competitive threats?"],
  earnings: ["Did they beat expectations?", "Are margins expanding?", "What is the growth outlook?"],
};

/**
 * Suggest follow-up questions after a turn. Action follow-ups win; otherwise we
 * derive from the question's dominant intent. Deterministic — no extra LLM call.
 * Pure / testable.
 */
export function suggestFollowUps(
  intents: ResearchIntent[],
  action: ResearchAction | null,
): string[] {
  if (action) return action.followUps;
  for (const intent of intents) {
    const fu = INTENT_FOLLOWUPS[intent];
    if (fu) return fu;
  }
  return ["Is this a good long-term investment?", "What are the key risks?", "What is the bull case?"];
}
