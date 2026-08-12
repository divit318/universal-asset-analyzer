/**
 * AI research prompts for the Treasury yield curve, grounded in
 * MacroSummary (lib/macro-analysis.ts) plus recent news for the qualitative
 * inflation/GDP/employment layer — same honest news-grounding pattern as
 * commodities' supply-demand and forex's macro-context sections. No hard
 * numeric feed exists for CPI/GDP/payrolls here, so that section is
 * explicit about being a news-derived narrative, not sourced data.
 */

import { runPromptWithMeta } from "./ai";
import type { MacroSummary } from "./macro-analysis";
import type { NewsItem } from "./types";
import type { ChatMessage } from "./ai-research";

function macroDataBlock(summary: MacroSummary): string {
  const curveLines = summary.curve
    .map((p) => `  ${p.label} (${p.symbol}): ${p.yieldPercent != null ? `${p.yieldPercent.toFixed(2)}%` : "n/a"}`)
    .join("\n");

  return `US TREASURY YIELD CURVE:
${curveLines}

10-Year minus 3-Month spread: ${summary.tenYearMinusThreeMonth != null ? `${summary.tenYearMinusThreeMonth >= 0 ? "+" : ""}${summary.tenYearMinusThreeMonth.toFixed(2)}pp` : "n/a"}
Curve shape: ${summary.shape ?? "n/a"}
Curve trend (vs ~20 trading days ago): ${summary.curveTrend ?? "n/a"}

NOTE: An inverted curve (10-year yield below 3-month) has historically preceded US recessions, though with variable lag. This is market-data only — no CPI, GDP, payrolls, or Fed policy-decision data is available; do not invent figures for those.`;
}

function newsBlock(news: NewsItem[]): string {
  if (news.length === 0) return "RECENT NEWS: none available";
  return `RECENT NEWS:\n${news.slice(0, 8).map((n) => `  - ${n.headline}${n.summary ? ` — ${n.summary}` : ""}`).join("\n")}`;
}

export type MacroInsightSection = "curve" | "macro-context";

export interface MacroSectionInsightInput {
  section: MacroInsightSection;
  summary: MacroSummary;
  news: NewsItem[];
}

export async function macroSectionInsight(
  input: MacroSectionInsightInput,
): Promise<{ insight: string; model: string }> {
  const { section, summary, news } = input;

  let prompt: string;
  if (section === "macro-context") {
    prompt = `You are a macroeconomics analyst. In 2-3 sentences, summarize what the recent news suggests about inflation, GDP, employment, or Federal Reserve policy. Base this ONLY on the headlines below — if they don't mention these, say the news doesn't provide that context rather than inventing it.

${newsBlock(news)}

${macroDataBlock(summary)}`;
  } else {
    prompt = `You are a macroeconomics analyst. In 2-3 sentences, interpret the US Treasury yield curve's shape and recent trend. What does the current curve shape (and whether it's steepening or flattening) typically signal about growth/recession expectations?

${macroDataBlock(summary)}

Be direct and cite specific numbers from the data above.`;
  }

  const { text: raw, model } = await runPromptWithMeta("macro-research", prompt, { maxTokens: 250 });
  return { insight: raw.trim(), model };
}

export interface MacroChatInput {
  summary: MacroSummary;
  news: NewsItem[];
  history: ChatMessage[];
  question: string;
}

/** The chat prompt, exported so the streaming route can send the SAME prompt
 * through the platform's streaming path (runTaskStream) instead of buffering. */
export function macroChatPrompt(input: MacroChatInput): string {
  const { summary, news, history, question } = input;

  const system = `You are an expert macroeconomics analyst. Using ONLY the structured data and news below, answer the user's question about the yield curve or macro environment. Be precise, cite specific numbers or headlines. If asked about CPI, GDP, payrolls, or Fed decisions not present in the data, say clearly that data isn't available yet rather than guessing. Keep answers concise (3-6 sentences unless the question requires more).

DATA:
${macroDataBlock(summary)}

${newsBlock(news)}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  return conversationHistory
    ? `${system}\n\nConversation so far:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;
}

export async function macroChatWithData(input: MacroChatInput): Promise<{ answer: string; model: string }> {
  const { text: answer, model } = await runPromptWithMeta("macro-research", macroChatPrompt(input), { maxTokens: 800 });
  return { answer: answer.trim(), model };
}
