/**
 * AI façade for single-shot inference — the app-wide entry point.
 *
 * UAA's AI runs 100% on local Ollama by policy (see AGENTS.md): there is
 * deliberately no code path to any hosted/paid provider today. Every call
 * routes through the Orchestrator (lib/ai/orchestrator.ts), which asks the
 * Router (lib/ai/task-registry.ts + lib/ai/router.ts) which model best fits
 * the given TaskType and falls back automatically if it's unavailable —
 * feature code never names a model or talks to Ollama directly.
 *
 * Env vars:
 *   OLLAMA_HOST   — local Ollama host (default: http://localhost:11434)
 */

import type { AiAnalysis } from "./types";
import type { AnalysisInput } from "./ollama";
import { buildAnalysisPrompt } from "./ollama";
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
  opts: { maxTokens?: number; json?: boolean; model?: string; timeoutMs?: number } = {},
): Promise<string> {
  // maxTokens is accepted for call-site compatibility but not forwarded:
  // capping num_predict mid-generation truncates JSON output from small models.
  return runTaskText(taskType, prompt, { json: opts.json, model: opts.model, timeoutMs: opts.timeoutMs });
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
