/**
 * AI Orchestrator — the single entry point for every AI request in the app.
 *
 * Feature code never imports a provider or builds provider wire formats
 * directly; it calls `runTask`/`runTaskText` with a {@link TaskType} and gets
 * back a normalized {@link AIResponse} (or just the answer text). Everything
 * else — which model, retry/fallback, response shape — is the Router's job.
 */

import type { ProviderChatTurn } from "./provider";
import { route, type RouteOptions } from "./router";
import type { AIResponse } from "./response";
import type { TaskType } from "./task-registry";

export interface RunTaskOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Ask the model to respond with JSON only. */
  json?: boolean;
  /** Explicit model override (e.g. a user-picked model in the copilot UI). Skips auto-routing/fallback. */
  model?: string;
  signal?: AbortSignal;
}

/** Run a task and get the full normalized response (confidence, timing, model used, etc.). */
export async function runTask(
  taskType: TaskType,
  prompt: string,
  opts: RunTaskOptions = {},
): Promise<AIResponse> {
  const messages: ProviderChatTurn[] = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    { role: "user" as const, content: prompt },
  ];
  const routeOpts: RouteOptions = opts.model ? { model: opts.model } : {};
  return route(
    taskType,
    {
      messages,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      json: opts.json,
      signal: opts.signal,
    },
    routeOpts,
  );
}

/** Run a task and get just the answer text — the common case for single-shot feature prompts. */
export async function runTaskText(
  taskType: TaskType,
  prompt: string,
  opts: RunTaskOptions = {},
): Promise<string> {
  const response = await runTask(taskType, prompt, opts);
  return response.content;
}
