/**
 * AI research prompts for currency pairs, grounded in market-data-only
 * scoring (lib/forex-scoring.ts) plus recent news headlines for the one
 * genuinely qualitative dimension this asset class needs: central bank
 * policy, inflation, GDP, and interest-rate differentials — the actual
 * drivers of currency moves. There's no free numeric feed for policy-rate
 * decisions or macro releases, so — rather than fabricate a fake "macro
 * score" — the macro-context section is explicitly framed as a news-
 * grounded narrative, honest about what it is and isn't.
 */

import { runPromptWithMeta } from "./ai";
import type { NewsItem, ScoreResult } from "./types";
import type { ChatMessage } from "./ai-research";

interface ForexFacts {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  changePercent: number;
}

function forexDataBlock(facts: ForexFacts, score: ScoreResult): string {
  return `CURRENCY PAIR: ${facts.symbol} — ${facts.name}
Rate: ${facts.price} (${facts.changePercent >= 0 ? "+" : ""}${facts.changePercent.toFixed(2)}% today)

FOREX SCORE: ${score.composite}/100 → ${score.recommendation} (${score.confidence}% confidence)
Score breakdown: ${score.buckets.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ")}
${score.buckets.map((b) => `  ${b.name}: ${b.factors.map((f) => f.detail).filter((d) => d && d !== "n/a").join("; ") || "insufficient data"}`).join("\n")}

NOTE: this score is market-data only (price/volatility/drawdown history). No central bank policy, inflation, GDP, or interest-rate data is available — do not invent figures for those.`;
}

function newsBlock(news: NewsItem[]): string {
  if (news.length === 0) return "RECENT NEWS: none available";
  return `RECENT NEWS:\n${news.slice(0, 8).map((n) => `  - ${n.headline}${n.summary ? ` — ${n.summary}` : ""}`).join("\n")}`;
}

export type ForexInsightSection = "momentum" | "risk" | "relative-strength" | "macro-context";

export interface ForexSectionInsightInput {
  section: ForexInsightSection;
  facts: ForexFacts;
  score: ScoreResult;
  news: NewsItem[];
}

export async function forexSectionInsight(
  input: ForexSectionInsightInput,
): Promise<{ insight: string; model: string }> {
  const { section, facts, score, news } = input;

  let prompt: string;
  if (section === "macro-context") {
    prompt = `You are a currency markets analyst. In 2-3 sentences, summarize what the recent news suggests about central bank policy, inflation, GDP, or interest-rate differentials affecting ${facts.name} (${facts.symbol}). Base this ONLY on the headlines below — if they don't mention these macro drivers, say the news doesn't provide that context rather than inventing it.

${newsBlock(news)}

${forexDataBlock(facts, score)}`;
  } else {
    let focus: string;
    if (section === "momentum") {
      focus = "Interpret the price momentum: recent trend and position relative to its recent high. What does the momentum picture suggest for near-term risk/reward?";
    } else if (section === "relative-strength") {
      focus = "Interpret performance relative to the US Dollar Index (DXY). Is this pair's move being driven by broad dollar strength/weakness or something specific to the other currency?";
    } else {
      focus = "Interpret the risk profile: volatility, drawdown, and risk-adjusted return (Sharpe/Sortino). Is the return being earned adequate for the risk taken?";
    }
    prompt = `You are a currency markets analyst. In 2-3 sentences, ${focus}

${forexDataBlock(facts, score)}

Be direct and cite specific numbers from the data above. Do not speculate about central bank policy, inflation, or rate decisions not present in the data.`;
  }

  const { text: raw, model } = await runPromptWithMeta("forex-research", prompt, { maxTokens: 250 });
  return { insight: raw.trim(), model };
}

export interface ForexChatInput {
  facts: ForexFacts;
  score: ScoreResult;
  news: NewsItem[];
  history: ChatMessage[];
  question: string;
}

export async function forexChatWithData(input: ForexChatInput): Promise<{ answer: string; model: string }> {
  const { facts, score, news, history, question } = input;

  const system = `You are an expert currency markets analyst. Using ONLY the structured data and news below, answer the user's question about this currency pair. Be precise, cite specific numbers or headlines. If asked about central bank policy, interest rates, inflation, or GDP data not present in the data, say clearly that data isn't available yet rather than guessing. Keep answers concise (3-6 sentences unless the question requires more).

DATA:
${forexDataBlock(facts, score)}

${newsBlock(news)}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const fullPrompt = conversationHistory
    ? `${system}\n\nConversation so far:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;

  const { text: answer, model } = await runPromptWithMeta("forex-research", fullPrompt, { maxTokens: 800 });
  return { answer: answer.trim(), model };
}
