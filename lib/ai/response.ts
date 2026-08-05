/**
 * Response Normalizer — every provider's output is coerced into this one
 * shape before it reaches feature code. Nothing downstream of the Router
 * should ever branch on which provider or model answered.
 */

import type { ProviderTokenUsage } from "./provider";

export type ResponseConfidence = "high" | "medium" | "low";

export interface AIResponse {
  /** The answer text, reasoning markup already stripped. */
  content: string;
  /** Heuristic confidence — providers don't expose logprobs here, so this is a coarse signal, not a probability. */
  confidence: ResponseConfidence;
  /** Truncated chain-of-thought trace, when the model produced one. Null when none. */
  reasoningSummary: string | null;
  executionTimeMs: number;
  model: string;
  provider: string;
  tokenUsage?: ProviderTokenUsage;
  /** Non-fatal issues surfaced during routing (e.g. "fell back from qwen3: timeout"). Empty when the first choice succeeded. */
  errors: string[];
  metadata: Record<string, unknown>;
}

const REASONING_SUMMARY_MAX_CHARS = 500;

function estimateConfidence(content: string, reasoning: string, fallbackCount: number): ResponseConfidence {
  if (!content.trim()) return "low";
  if (fallbackCount > 0) return "medium"; // preferred model wasn't available; still an answer
  if (reasoning.trim().length > 0 && content.trim().length > 40) return "high";
  if (content.trim().length < 20) return "low";
  return "medium";
}

export function normalizeResponse(opts: {
  content: string;
  reasoning: string;
  model: string;
  provider: string;
  startedAt: number;
  tokenUsage?: ProviderTokenUsage;
  /** Errors from models that were tried and skipped before this one succeeded. */
  fallbackErrors?: string[];
  metadata?: Record<string, unknown>;
}): AIResponse {
  const errors = opts.fallbackErrors ?? [];
  return {
    content: opts.content,
    confidence: estimateConfidence(opts.content, opts.reasoning, errors.length),
    reasoningSummary: opts.reasoning.trim()
      ? opts.reasoning.trim().slice(0, REASONING_SUMMARY_MAX_CHARS)
      : null,
    executionTimeMs: Date.now() - opts.startedAt,
    model: opts.model,
    provider: opts.provider,
    tokenUsage: opts.tokenUsage,
    errors,
    metadata: opts.metadata ?? {},
  };
}
