/**
 * AI research prompts for crypto assets, grounded in market-data-only
 * CryptoProfileData (lib/yahoo.ts quote/history + lib/crypto-scoring.ts).
 * Mirrors lib/ai-fund-research.ts's shape: a quick "so what" per tab, plus
 * freeform Q&A grounded only in the price/risk data actually available —
 * no tokenomics/on-chain claims, since that data isn't wired up yet.
 */

import { runPromptWithMeta } from "./ai";
import type { ScoreResult } from "./types";
import type { ChatMessage } from "./ai-research";

interface CryptoFacts {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  changePercent: number;
  marketCap: number | null;
}

function cryptoDataBlock(facts: CryptoFacts, score: ScoreResult): string {
  return `CRYPTO ASSET: ${facts.symbol} — ${facts.name}
Price: ${facts.price} ${facts.currency} (${facts.changePercent >= 0 ? "+" : ""}${facts.changePercent.toFixed(2)}% today)
Market cap: ${facts.marketCap != null ? `$${(facts.marketCap / 1e9).toFixed(1)}B` : "n/a"}

CRYPTO SCORE: ${score.composite}/100 → ${score.recommendation} (${score.confidence}% confidence)
Score breakdown: ${score.buckets.map((b) => `${b.name}=${Math.round((b.points / b.max) * 100)}%`).join(", ")}
${score.buckets.map((b) => `  ${b.name}: ${b.factors.map((f) => f.detail).filter((d) => d && d !== "n/a").join("; ") || "insufficient data"}`).join("\n")}

NOTE: this analysis is market-data only (price/volatility/drawdown history). No tokenomics, on-chain, or developer-activity data is available yet — do not invent figures for those.`;
}

export type CryptoInsightSection = "momentum" | "risk" | "relative-strength";

export interface CryptoSectionInsightInput {
  section: CryptoInsightSection;
  facts: CryptoFacts;
  score: ScoreResult;
}

export async function cryptoSectionInsight(
  input: CryptoSectionInsightInput,
): Promise<{ insight: string; model: string }> {
  const { section, facts, score } = input;

  let focus: string;
  if (section === "momentum") {
    focus = "Interpret the price momentum: recent trend and position relative to its recent high. What does the momentum picture suggest for near-term risk/reward?";
  } else if (section === "relative-strength") {
    focus = "Interpret performance relative to Bitcoin (the crypto market's de facto benchmark). Is this asset outperforming or underperforming the broader crypto market, and what might explain that?";
  } else {
    focus = "Interpret the risk profile: volatility, drawdown, and risk-adjusted return (Sharpe/Sortino). Is the return being earned adequate for the risk taken?";
  }

  const prompt = `You are a crypto markets analyst. In 2-3 sentences, ${focus}

${cryptoDataBlock(facts, score)}

Be direct and cite specific numbers from the data above. Do not speculate about tokenomics, on-chain activity, or fundamentals not present in the data.`;

  const { text: raw, model } = await runPromptWithMeta("crypto-research", prompt, { maxTokens: 250 });
  return { insight: raw.trim(), model };
}

export interface CryptoChatInput {
  facts: CryptoFacts;
  score: ScoreResult;
  history: ChatMessage[];
  question: string;
}

/** The chat prompt, exported so the streaming route can send the SAME prompt
 * through the platform's streaming path (runTaskStream) instead of buffering. */
export function cryptoChatPrompt(input: CryptoChatInput): string {
  const { facts, score, history, question } = input;

  const system = `You are an expert crypto markets analyst. Using ONLY the structured data below, answer the user's question about this crypto asset. Be precise, cite specific numbers. If asked about tokenomics, on-chain activity, or anything not in the data, say clearly that data isn't available yet rather than guessing. Keep answers concise (3-6 sentences unless the question requires more).

DATA:
${cryptoDataBlock(facts, score)}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  return conversationHistory
    ? `${system}\n\nConversation so far:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;
}

export async function cryptoChatWithData(input: CryptoChatInput): Promise<{ answer: string; model: string }> {
  const { text: answer, model } = await runPromptWithMeta("crypto-research", cryptoChatPrompt(input), { maxTokens: 800 });
  return { answer: answer.trim(), model };
}
