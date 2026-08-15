/**
 * AI research prompts for an underlying's options chain, grounded in
 * DerivativesSummary (lib/derivatives-analysis.ts). Unlike commodities/forex,
 * this doesn't need a news-grounded qualitative layer — the options chain
 * itself (IV, term structure, open-interest positioning, Greeks) already is
 * the qualitative signal; the AI's job here is interpreting real numbers,
 * not filling a data gap.
 */

import { runPromptWithMeta } from "./ai";
import type { DerivativesSummary } from "./derivatives-analysis";
import { formatPerShare } from "./format";
import type { ChatMessage } from "./ai-research";

function derivativesDataBlock(underlyingName: string, summary: DerivativesSummary, currency: string | null): string {
  // Strikes are struck in the underlying's LISTING currency; the model
  // narrates whatever symbol appears here, so a hardcoded dollar would have
  // it describing non-USD strikes as dollars. Unknown currency → bare number.
  const fmtStrikes = (rows: { strike: number; openInterest: number }[]) =>
    rows.map((r) => `${formatPerShare(r.strike, currency, r.strike % 1 === 0 ? 0 : 2)} (${r.openInterest.toLocaleString()} OI)`).join(", ") || "none available";

  return `UNDERLYING: ${summary.underlyingSymbol} — ${underlyingName}
Price: ${summary.underlyingPrice}${currency ? ` ${currency}` : ""}

OPTIONS CHAIN:
  Nearest expiration: ${summary.nearestExpiration ?? "n/a"}
  Further expiration: ${summary.farExpiration ?? "n/a (only one expiration listed)"}
  ATM implied volatility (near-term): ${summary.atmIV != null ? `${summary.atmIV.toFixed(1)}%` : "n/a"}
  ATM implied volatility (further-dated): ${summary.atmIVFar != null ? `${summary.atmIVFar.toFixed(1)}%` : "n/a"}
  Volatility term structure: ${summary.termStructure ?? "n/a"}
  Put/Call open-interest ratio: ${summary.putCallOIRatio != null ? summary.putCallOIRatio.toFixed(2) : "n/a"}
  Top call strikes by open interest: ${fmtStrikes(summary.topCallStrikes)}
  Top put strikes by open interest: ${fmtStrikes(summary.topPutStrikes)}
  ATM strike: ${summary.atmStrike ?? "n/a"}
  ATM call Greeks: ${summary.atmCallGreeks ? `Delta ${summary.atmCallGreeks.delta.toFixed(2)}, Gamma ${summary.atmCallGreeks.gamma.toFixed(4)}, Theta ${summary.atmCallGreeks.theta.toFixed(3)}/day, Vega ${summary.atmCallGreeks.vega.toFixed(3)}` : "n/a"}
  ATM put Greeks: ${summary.atmPutGreeks ? `Delta ${summary.atmPutGreeks.delta.toFixed(2)}, Gamma ${summary.atmPutGreeks.gamma.toFixed(4)}, Theta ${summary.atmPutGreeks.theta.toFixed(3)}/day, Vega ${summary.atmPutGreeks.vega.toFixed(3)}` : "n/a"}

NOTE: Greeks are computed via Black-Scholes from the chain's implied volatility, not sourced directly from Yahoo. This is options-market positioning data, not a directional recommendation on the underlying.`;
}

export type DerivativesInsightSection = "volatility" | "positioning";

export interface DerivativesSectionInsightInput {
  section: DerivativesInsightSection;
  underlyingName: string;
  summary: DerivativesSummary;
  /** Listing currency of the underlying (Quote.currency) — strikes are struck in it. */
  currency?: string | null;
}

export async function derivativesSectionInsight(
  input: DerivativesSectionInsightInput,
): Promise<{ insight: string; model: string }> {
  const { section, underlyingName, summary, currency } = input;

  const focus = section === "volatility"
    ? "Interpret the implied volatility level and term structure. Is the market pricing elevated near-term uncertainty (backwardation) or a normal upward-sloping curve (contango)? What might explain the current IV level?"
    : "Interpret the open-interest positioning: the put/call ratio and where the largest strikes are concentrated. What do the high-OI strikes suggest about where the market expects support/resistance, or where a large move could accelerate (gamma exposure)?";

  const prompt = `You are an options markets analyst. In 2-3 sentences, ${focus}

${derivativesDataBlock(underlyingName, summary, currency ?? null)}

Be direct and cite specific numbers from the data above. Do not make a directional recommendation on the underlying stock/fund itself — stay focused on what the options market is pricing.`;

  const { text: raw, model } = await runPromptWithMeta("derivatives-research", prompt, { maxTokens: 250 });
  return { insight: raw.trim(), model };
}

export interface DerivativesChatInput {
  underlyingName: string;
  summary: DerivativesSummary;
  history: ChatMessage[];
  question: string;
  /** Listing currency of the underlying (Quote.currency) — strikes are struck in it. */
  currency?: string | null;
}

export async function derivativesChatWithData(input: DerivativesChatInput): Promise<{ answer: string; model: string }> {
  const { underlyingName, summary, history, question, currency } = input;

  const system = `You are an expert options markets analyst. Using ONLY the structured data below, answer the user's question about this underlying's options chain. Be precise, cite specific numbers. If asked about something not in the data (e.g. a specific far-dated strike not listed), say so clearly rather than guessing. Keep answers concise (3-6 sentences unless the question requires more).

DATA:
${derivativesDataBlock(underlyingName, summary, currency ?? null)}`;

  const conversationHistory = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const fullPrompt = conversationHistory
    ? `${system}\n\nConversation so far:\n${conversationHistory}\n\nUser: ${question}`
    : `${system}\n\nUser: ${question}`;

  const { text: answer, model } = await runPromptWithMeta("derivatives-research", fullPrompt, { maxTokens: 800 });
  return { answer: answer.trim(), model };
}
