/**
 * AI research prompts for funds (ETF / mutual fund / closed-end fund),
 * grounded in FundProfileData (lib/yahoo.ts getFundProfile + lib/fund-scoring.ts).
 * Mirrors the shape of lib/ai-research.ts's Indian-equity section-insight +
 * chat pair (the live pattern, not the removed one-shot deepAnalysis) —
 * a quick "so what" per tab, plus freeform Q&A grounded only in fund data.
 */

import { runPromptWithMeta } from "./ai";
import type { FundProfileData, ScoreResult } from "./types";
import type { ChatMessage } from "./ai-research";

function fundDataBlock(symbol: string, name: string, fund: FundProfileData, score: ScoreResult): string {
  const topHoldings = fund.holdings
    .slice(0, 8)
    .map((h) => `  ${h.symbol} (${h.name}): ${h.weightPercent.toFixed(1)}%`)
    .join("\n");
  const sectors = fund.sectorWeights
    .slice(0, 6)
    .map((s) => `  ${s.sector}: ${s.weightPercent.toFixed(1)}%`)
    .join("\n");

  return `FUND: ${symbol} — ${name}
Category: ${fund.category ?? "n/a"} (family: ${fund.family ?? "n/a"})
Expense ratio: ${fund.expenseRatio != null ? `${(fund.expenseRatio * 100).toFixed(2)}%` : "n/a"}
Portfolio turnover: ${fund.turnoverPercent != null ? `${(fund.turnoverPercent * 100).toFixed(0)}%` : "n/a"}
Total net assets: ${fund.totalNetAssets != null ? `$${(fund.totalNetAssets / 1e9).toFixed(1)}B` : "n/a"}

TOP HOLDINGS:
${topHoldings || "  not available"}

SECTOR ALLOCATION:
${sectors || "  not available"}

ASSET ALLOCATION: stock ${fund.assetAllocation.stock?.toFixed(0) ?? "n/a"}%, bond ${fund.assetAllocation.bond?.toFixed(0) ?? "n/a"}%, cash ${fund.assetAllocation.cash?.toFixed(0) ?? "n/a"}%

PERFORMANCE: 1yr ${fund.trailingReturns.oneYear?.toFixed(1) ?? "n/a"}%, 3yr ${fund.trailingReturns.threeYear?.toFixed(1) ?? "n/a"}%, 5yr ${fund.trailingReturns.fiveYear?.toFixed(1) ?? "n/a"}%
VS CATEGORY: 1yr ${fund.categoryRelativeReturns.oneYear != null ? `${fund.categoryRelativeReturns.oneYear >= 0 ? "+" : ""}${fund.categoryRelativeReturns.oneYear.toFixed(1)}pp` : "n/a"}
RISK: beta ${fund.risk?.beta?.toFixed(2) ?? "n/a"}, alpha ${fund.risk?.alpha?.toFixed(1) ?? "n/a"}, Sharpe ${fund.risk?.sharpeRatio?.toFixed(2) ?? "n/a"}

FUND SCORE: ${score.composite}/100 → ${score.recommendation} (${score.confidence}% confidence)`;
}

export type FundInsightSection = "holdings" | "allocation" | "performance" | "cost";

export interface FundSectionInsightInput {
  section: FundInsightSection;
  symbol: string;
  name: string;
  fund: FundProfileData;
  score: ScoreResult;
}

export async function fundSectionInsight(
  input: FundSectionInsightInput,
): Promise<{ insight: string; model: string }> {
  const { section, symbol, name, fund, score } = input;

  let focus: string;
  if (section === "holdings") {
    focus = "Interpret the top holdings and concentration. Is this fund diversified or concentrated in a few names/sectors? What does that imply for risk?";
  } else if (section === "allocation") {
    focus = "Interpret the sector and asset-class allocation. What macro/market exposure does this give an investor, and what's the biggest concentration risk?";
  } else if (section === "performance") {
    focus = "Interpret the fund's performance relative to its category. Is it outperforming, underperforming, or tracking its category, and what does the risk profile (beta/alpha/Sharpe) say about how it got there?";
  } else {
    focus = "Interpret the fund's cost structure (expense ratio, turnover) relative to typical funds in its category. Is this fund cheap, average, or expensive, and does the performance justify the cost?";
  }

  const prompt = `You are a fund analyst. In 2-3 sentences, ${focus}

${fundDataBlock(symbol, name, fund, score)}

Be direct and cite specific numbers from the data above.`;

  const { text: raw, model } = await runPromptWithMeta("fund-research", prompt, { maxTokens: 250 });
  return { insight: raw.trim(), model };
}

export interface FundChatInput {
  symbol: string;
  name: string;
  fund: FundProfileData;
  score: ScoreResult;
  history: ChatMessage[];
  question: string;
}

export async function fundChatWithData(input: FundChatInput): Promise<{ answer: string; model: string }> {
  const { symbol, name, fund, score, history, question } = input;

  const system = `You are an expert fund analyst. Using ONLY the structured data below, answer the user's question about this fund. Be precise, cite specific numbers. If data is missing, say so clearly. Keep answers concise (3-6 sentences unless the question requires more).

DATA:
${fundDataBlock(symbol, name, fund, score)}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const fullPrompt = conversationHistory
    ? `${system}\n\nConversation so far:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;

  const { text: answer, model } = await runPromptWithMeta("fund-research", fullPrompt, { maxTokens: 800 });
  return { answer: answer.trim(), model };
}
