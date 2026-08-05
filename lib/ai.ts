/**
 * AI façade for single-shot inference — the app-wide entry point.
 *
 * The backend is the Anthropic API (claude-opus-5), reached with the user's
 * own key (lib/ai/anthropic-key.ts). Every call routes through the
 * Orchestrator (lib/ai/orchestrator.ts), which asks the Router
 * (lib/ai/task-registry.ts + lib/ai/router.ts) which effort tier best fits
 * the given TaskType and falls back automatically if it's unavailable —
 * feature code never names a model or talks to a backend directly.
 */

import type { AiAnalysis } from "./types";
import type { AnalysisInput } from "./analysis-prompt";
import { buildAnalysisPrompt } from "./analysis-prompt";
import { runTask, runTaskText, type RunTaskOptions } from "./ai/orchestrator";
import type { TaskType } from "./ai/task-registry";

/** Structured asset analysis (quote + filings → narrative). */
export async function analyzeAsset(input: AnalysisInput): Promise<AiAnalysis> {
  const response = await runTask("company-research", buildAnalysisPrompt(input));
  return { model: response.model, analysis: response.content };
}

/** Run a task-routed prompt through the orchestrator. Returns raw answer text. */
export async function runPrompt(
  taskType: TaskType,
  prompt: string,
  opts: { maxTokens?: number; json?: boolean; model?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  // maxTokens is accepted for call-site compatibility but not forwarded:
  // capping num_predict mid-generation truncates JSON output from small models.
  return runTaskText(taskType, prompt, {
    json: opts.json,
    model: opts.model,
    timeoutMs: opts.timeoutMs,
    // Forwarded so a caller that abandons a long multi-stage pipeline (the
    // thematic engine's Cancel button) actually stops the generation instead
    // of leaving the model grinding through work nobody will read.
    signal: opts.signal,
  });
}

/**
 * Like {@link runPrompt}, but also returns which model actually answered —
 * for callers that surface "analyzed by <model>" in their response metadata
 * instead of assuming a single static model name.
 */
export async function runPromptWithMeta(
  taskType: TaskType,
  prompt: string,
  opts: RunTaskOptions = {},
): Promise<{ text: string; model: string }> {
  const response = await runTask(taskType, prompt, opts);
  return { text: response.content, model: response.model };
}
