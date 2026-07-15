/**
 * AI research prompts for commodity futures, grounded in market-data-only
 * scoring (lib/commodity-scoring.ts) plus recent news headlines for the one
 * genuinely qualitative dimension this asset class needs: supply/demand and
 * geopolitical context. There's no free numeric feed for inventories or
 * production data, so — rather than fabricate a fake "supply score" — the
 * supply-demand section is explicitly framed as a news-grounded narrative,
 * honest about what it is and isn't.
 */

import { runPromptWithMeta } from "./ai";
import type { NewsItem, ScoreResult } from "./types";
import type { ChatMessage } from "./ai-research";

interface CommodityFacts {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  changePercent: number;
}

function commodityDataBlock(facts: CommodityFacts, score: ScoreResult): string {
  return `COMMODITY: ${facts.symbol} — ${facts.name}
Price: ${facts.price} ${facts.currency} (${facts.changePercent >= 0 ? "+" : ""}${facts.changePercent.toFixed(2)}% today)

COMMODITY SCORE: ${score.composite}/100 → ${score.recommendation} (${score.confidence}% confidence)
Score breakdown: ${score.buckets.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ")}
${score.buckets.map((b) => `  ${b.name}: ${b.factors.map((f) => f.detail).filter((d) => d && d !== "n/a").join("; ") || "insufficient data"}`).join("\n")}

NOTE: this score is market-data only (price/volatility/drawdown history). No supply, inventory, production, or futures-curve data is available — do not invent figures for those.`;
}

function newsBlock(news: NewsItem[]): string {
  if (news.length === 0) return "RECENT NEWS: none available";
  return `RECENT NEWS:\n${news.slice(0, 8).map((n) => `  - ${n.headline}${n.summary ? ` — ${n.summary}` : ""}`).join("\n")}`;
}

export type CommodityInsightSection = "momentum" | "risk" | "relative-strength" | "supply-demand";

export interface CommoditySectionInsightInput {
  section: CommodityInsightSection;
  facts: CommodityFacts;
  score: ScoreResult;
  news: NewsItem[];
}

export async function commoditySectionInsight(
  input: CommoditySectionInsightInput,
): Promise<{ insight: string; model: string }> {
  const { section, facts, score, news } = input;

  let prompt: string;
  if (section === "supply-demand") {
    prompt = `You are a commodities markets analyst. In 2-3 sentences, summarize what the recent news suggests about supply, demand, and geopolitical factors affecting ${facts.name} (${facts.symbol}). Base this ONLY on the headlines below — if they don't mention supply/demand/geopolitical drivers, say the news doesn't provide that context rather than inventing it.

${newsBlock(news)}

${commodityDataBlock(facts, score)}`;
  } else {
    let focus: string;
    if (section === "momentum") {
      focus = "Interpret the price momentum: recent trend and position relative to its recent high. What does the momentum picture suggest for near-term risk/reward?";
    } else if (section === "relative-strength") {
      focus = "Interpret performance relative to the broad commodity index (DBC). Is this commodity outperforming or underperforming commodities broadly, and what might explain that?";
    } else {
      focus = "Interpret the risk profile: volatility, drawdown, and risk-adjusted return (Sharpe/Sortino). Is the return being earned adequate for the risk taken?";
    }
    prompt = `You are a commodities markets analyst. In 2-3 sentences, ${focus}

${commodityDataBlock(facts, score)}

Be direct and cite specific numbers from the data above. Do not speculate about supply, inventories, or production levels not present in the data.`;
  }

  const { text: raw, model } = await runPromptWithMeta("commodity-research", prompt, { maxTokens: 250 });
  return { insight: raw.trim(), model };
}

export interface CommodityChatInput {
  facts: CommodityFacts;
  score: ScoreResult;
  news: NewsItem[];
  history: ChatMessage[];
  question: string;
}

export async function commodityChatWithData(input: CommodityChatInput): Promise<{ answer: string; model: string }> {
  const { facts, score, news, history, question } = input;

  const system = `You are an expert commodities markets analyst. Using ONLY the structured data and news below, answer the user's question about this commodity. Be precise, cite specific numbers or headlines. If asked about inventories, production, or futures-curve structure not present in the data, say clearly that data isn't available yet rather than guessing. Keep answers concise (3-6 sentences unless the question requires more).

DATA:
${commodityDataBlock(facts, score)}

${newsBlock(news)}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const fullPrompt = conversationHistory
    ? `${system}\n\nConversation so far:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;

  const { text: answer, model } = await runPromptWithMeta("commodity-research", fullPrompt, { maxTokens: 800 });
  return { answer: answer.trim(), model };
}
