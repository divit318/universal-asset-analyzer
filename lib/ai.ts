/**
 * AI façade for single-shot inference — local Ollama only.
 *
 * UAA's AI runs 100% on local Ollama by policy (see AGENTS.md): there is
 * deliberately no code path to any hosted/paid provider. All HTTP plumbing
 * (retry, typed errors, timeouts) lives in lib/ai/ollama.ts; this module just
 * adapts it to the `runPrompt`/`analyzeAsset` call shape used across the app.
 *
 * Env vars:
 *   OLLAMA_HOST   — local Ollama host (default: http://localhost:11434)
 *   OLLAMA_MODEL  — default model name (default: llama3.2)
 */

import type { AiAnalysis } from "./types";
import type { AnalysisInput } from "./ollama";
import { buildAnalysisPrompt } from "./ollama";
import { DEFAULT_MODEL, generate } from "./ai/ollama";

/** Model name recorded in response metadata. */
export function getActiveModelName(): string {
  return DEFAULT_MODEL;
}

/** Structured asset analysis (quote + filings → narrative). */
export async function analyzeAsset(input: AnalysisInput): Promise<AiAnalysis> {
  const analysis = await generate(buildAnalysisPrompt(input));
  return { model: DEFAULT_MODEL, analysis };
}

/** Run an arbitrary prompt through local Ollama. Returns raw text. */
export async function runPrompt(
  prompt: string,
  opts: { maxTokens?: number; json?: boolean; model?: string } = {},
): Promise<string> {
  // maxTokens is accepted for call-site compatibility but not forwarded:
  // capping num_predict mid-generation truncates JSON output from small models.
  return generate(prompt, { json: opts.json, model: opts.model });
}
