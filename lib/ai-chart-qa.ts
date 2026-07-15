/**
 * Chart Q&A — the fullscreen chart workspace's single AI input. Answers one
 * free-text question about whatever the ChartQAContext (built client-side by
 * build-chart-context.ts from the live chart state) says is currently
 * selected/visible. Not cached like lib/ai-pattern-insight.ts's "why it
 * matters" note — a free-text question isn't a stable cache key the way a
 * fixed pattern occurrence is.
 *
 * JSON parsing follows lib/movement-explainer.ts's convention (extractJson +
 * manual defensive coercion) rather than lib/json-extract.ts's
 * extractJsonObject, since the response has nested optional fields
 * (`reasoning`, `relatedContext`) a shallow default-merge can't express.
 */

import { runPromptWithMeta } from "./ai";
import { extractJson } from "./json-extract";
import type { ChartQAContext } from "./types";

export interface ChartQAReasoning {
  observation?: string;
  interpretation?: string;
  supportingEvidence?: string;
  bullCase?: string;
  bearCase?: string;
  invalidation?: string;
}

export type ChartQARelatedTarget = "earnings" | "analysis" | "copilot";

export interface ChartQARelatedContext {
  target: ChartQARelatedTarget;
  label: string;
  reason: string;
}

export interface ChartQAResult {
  answer: string;
  /** Present ONLY for an interpretive judgment — never for an objective/factual statement. */
  confidence?: "high" | "moderate" | "low";
  /** Present only if at least one sub-field is non-empty. */
  reasoning?: ChartQAReasoning;
  relatedContext?: ChartQARelatedContext[];
  model: string;
}

const REASONING_KEYS = ["observation", "interpretation", "supportingEvidence", "bullCase", "bearCase", "invalidation"] as const;
const RELATED_TARGETS: ChartQARelatedTarget[] = ["earnings", "analysis", "copilot"];

function describeSelection(context: ChartQAContext): string {
  const { selection } = context;
  switch (selection.kind) {
    case "drawing": {
      const d = selection.drawing!;
      return [
        `SELECTED DRAWING: ${selection.label}`,
        `Points: ${JSON.stringify(d.points)}`,
        `Style: color ${d.style.color}, thickness ${d.style.thickness}, line ${d.style.lineStyle}`,
      ].join("\n");
    }
    case "pattern": {
      const s = selection.signal!;
      const c = selection.candle!;
      const confirmations = s.confirmations.length > 0
        ? s.confirmations.map((x) => `${x.label} (${x.detail})`).join("; ")
        : "none flagged";
      return [
        `SELECTED PATTERN: ${s.name} (${s.direction}), curated confidence ${s.confidence}%, formed on ${s.date}`,
        `Pattern definition: ${s.description}`,
        `Confirming signals: ${confirmations}`,
        `Candle: open ${c.open}, high ${c.high}, low ${c.low}, close ${c.close}, volume ${c.volume ?? "n/a"}`,
      ].join("\n");
    }
    case "candle": {
      const c = selection.candle!;
      return `SELECTED CANDLE: ${c.date} — open ${c.open}, high ${c.high}, low ${c.low}, close ${c.close}, volume ${c.volume ?? "n/a"}`;
    }
    case "overview":
    default:
      return "SELECTED: nothing specific — this is a general question about the chart as a whole.";
  }
}

export function buildChartQAPrompt(context: ChartQAContext, question: string): string {
  const otherDrawings = context.otherDrawings.length > 0
    ? context.otherDrawings.map((d) => d.label).join(", ")
    : "none";
  const nearbyNews = context.nearbyNews.length > 0
    ? context.nearbyNews.map((n) => `- [${n.publishedAt.slice(0, 10)}] ${n.headline} (${n.source})`).join("\n")
    : "none";

  return `You are an experienced technical analyst sitting beside a trader, looking at the same chart they are. Explain, educate, and gently challenge assumptions when warranted — you never predict prices and never tell the user what to buy or sell. Be calm, precise, and honest about uncertainty; never sensational, never overconfident.

CHART: ${context.symbol}, ${context.candleInterval} candles, ${context.periodKey} range
VISIBLE: ${context.visibleCandleCount} candles from ${context.visibleDateRange.from} to ${context.visibleDateRange.to}, price range ${context.visiblePriceRange.low}–${context.visiblePriceRange.high}
INDICATORS ON: ${context.indicatorsEnabled.length > 0 ? context.indicatorsEnabled.join(", ") : "none"}
TREND: ${context.trendSummary}
VOLUME: ${context.volumeSummary}

${describeSelection(context)}

OTHER DRAWINGS ON CHART: ${otherDrawings}

NEARBY NEWS: ${nearbyNews}

USER QUESTION: "${question}"

Instructions:
- Answer in 3-5 sentences, directly addressing the question, using ONLY the data given above. Never invent price levels, dates, figures, or news not present above.
- Set "confidence" ONLY when you are making an interpretive judgment call (e.g. whether a setup is valid, whether a level will hold) — never for an objective fact already stated above (e.g. "volume increased 22%" needs no confidence). Use exactly "high", "moderate", or "low" — never a percentage. Omit the field entirely for factual answers.
- "reasoning" is entirely optional — include only sub-fields that add real value beyond the main answer (observation, interpretation, supportingEvidence, bullCase, bearCase, invalidation); omit the rest. Never fabricate a bull or bear case unsupported by the data above.
- "relatedContext" — include an entry ONLY when the news, earnings, or sector context above is directly relevant to the answer. One-sentence reason, plus a "target" of "earnings", "analysis", or "copilot". Omit entirely if nothing above is relevant. Never invent a headline not listed above, and never restate the news in full — the target is where the user goes to read it.

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "answer": "<3-5 sentences>",
  "confidence": "high" | "moderate" | "low" (optional),
  "reasoning": { "observation": "...", "interpretation": "...", "supportingEvidence": "...", "bullCase": "...", "bearCase": "...", "invalidation": "..." } (all optional, omit unused keys),
  "relatedContext": [{ "target": "earnings" | "analysis" | "copilot", "label": "...", "reason": "..." }] (optional, 0-2 items)
}`;
}

function sanitizeConfidence(value: unknown): ChartQAResult["confidence"] {
  return value === "high" || value === "moderate" || value === "low" ? value : undefined;
}

function sanitizeReasoning(value: unknown): ChartQAReasoning | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const src = value as Record<string, unknown>;
  const out: ChartQAReasoning = {};
  for (const key of REASONING_KEYS) {
    const v = src[key];
    if (typeof v === "string" && v.trim().length > 0) out[key] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeRelatedContext(value: unknown): ChartQARelatedContext[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ChartQARelatedContext[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") continue;
    const { target, label, reason } = item as Record<string, unknown>;
    if (
      typeof target === "string" && RELATED_TARGETS.includes(target as ChartQARelatedTarget) &&
      typeof label === "string" && label.trim().length > 0 &&
      typeof reason === "string" && reason.trim().length > 0
    ) {
      out.push({ target: target as ChartQARelatedTarget, label: label.trim(), reason: reason.trim() });
    }
    if (out.length >= 2) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Built entirely from already-computed deterministic fields — never a broken/blank UI state. */
function deterministicFallback(context: ChartQAContext): string {
  return `I couldn't reach the analysis model just now. Based on what's on screen: ${context.selection.label} — ${context.trendSummary}`;
}

export async function runChartQA(context: ChartQAContext, question: string): Promise<ChartQAResult> {
  try {
    const { text: raw, model } = await runPromptWithMeta("chart-qa", buildChartQAPrompt(context, question));
    const parsed = extractJson<Partial<ChartQAResult>>(raw);
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    if (!answer) throw new Error("empty answer");
    return {
      answer,
      confidence: sanitizeConfidence(parsed.confidence),
      reasoning: sanitizeReasoning(parsed.reasoning),
      relatedContext: sanitizeRelatedContext(parsed.relatedContext),
      model,
    };
  } catch {
    return { answer: deterministicFallback(context), model: "unavailable" };
  }
}
