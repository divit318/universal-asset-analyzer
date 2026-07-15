/**
 * Pattern Insight — the "why it matters" paragraph for a single curated
 * technical signal (see lib/pattern-signals.ts), generated on demand only
 * when a user opens that signal's Analysis Panel. Never runs in a loop over
 * multiple patterns and never fires on page load.
 *
 * Mirrors lib/ai-financial-insight.ts's convention exactly: a small prompt
 * builder, runPromptWithMeta() on the existing "quick-summary" task (already
 * registered for short, low-stakes single-field summaries — no new
 * task-registry entry needed), cached via scanner_cache so re-opening the
 * same pattern's panel is instant.
 */

import { runPromptWithMeta } from "./ai";
import { getScannerCache, putScannerCache } from "./db";
import { defaultPatternInsight, type TechnicalSignal } from "./pattern-signals";

export interface PatternInsightInput {
  symbol: string;
  signal: TechnicalSignal;
}

export interface PatternInsightResult {
  insight: string;
  model: string;
}

const CACHE_PREFIX = "pattern-insight";

export function buildPatternInsightPrompt(input: PatternInsightInput): string {
  const { symbol, signal } = input;
  const confirmations = signal.confirmations.length > 0
    ? signal.confirmations.map((c) => `- ${c.label} (${c.detail})`).join("\n")
    : "- None flagged";

  return `You are a technical analyst writing a 2-sentence note on why THIS specific occurrence of a chart pattern matters for ${symbol}. Use ONLY the data below — do not invent price levels, dates, or figures not given.

PATTERN: ${signal.name} (${signal.direction})
DATE: ${signal.date}
CONFIDENCE: ${signal.confidence}%
PATTERN DEFINITION: ${signal.description}
CONFIRMING SIGNALS:
${confirmations}

Explain specifically why this occurrence — not the pattern in the abstract — is notable, referencing the confirming signals above where relevant. Maximum 2 sentences. Return plain text, no markdown, no preamble.`;
}

/** Generate (or return the cached) insight for one symbol+pattern+date occurrence. */
export async function generatePatternInsight(input: PatternInsightInput): Promise<PatternInsightResult> {
  const { symbol, signal } = input;
  const cacheKey = `${CACHE_PREFIX}:${symbol}:${signal.name}:${signal.date}`;
  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as PatternInsightResult;
    } catch {
      // fall through and regenerate
    }
  }

  let model = "unavailable";
  let insight: string;
  try {
    const { text: raw, model: usedModel } = await runPromptWithMeta(
      "quick-summary",
      buildPatternInsightPrompt(input),
      { maxTokens: 150 },
    );
    model = usedModel;
    insight = raw.trim();
  } catch {
    insight = defaultPatternInsight(signal);
  }

  const result: PatternInsightResult = { insight, model };
  putScannerCache(cacheKey, JSON.stringify(result));
  return result;
}
