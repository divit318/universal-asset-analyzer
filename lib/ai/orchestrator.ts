/**
 * AI Orchestrator — the single entry point for every AI request in the app.
 *
 * Feature code never imports a provider or builds provider wire formats
 * directly; it calls `runTask`/`runTaskText` with a {@link TaskType} and gets
 * back a normalized {@link AIResponse} (or just the answer text). Everything
 * else — which model, retry/fallback, response shape — is the Router's job.
 */

import type { ProviderChatTurn } from "./provider";
import { route, routeStream, type RouteOptions } from "./router";
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
  /** Receives reasoning deltas when the routed model is a thinking model. */
  onReasoning?: (delta: string) => void;
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

/**
 * Run a task and stream the answer text.
 *
 * Same routing, same fallback, same task registry as {@link runTask} — streaming
 * is a delivery choice, not a separate AI pipeline. Feature code still never
 * names a model or talks to Ollama directly.
 *
 * Returns the model that answered (via the generator's return value).
 */
export async function* runTaskStream(
  taskType: TaskType,
  prompt: string,
  opts: RunTaskOptions = {},
): AsyncGenerator<string, string, unknown> {
  const messages: ProviderChatTurn[] = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    { role: "user" as const, content: prompt },
  ];
  return yield* runTaskChat(taskType, messages, opts);
}

/**
 * Run a task over a full multi-turn conversation and stream the answer.
 *
 * The general form of {@link runTaskStream}: the caller supplies the whole
 * message array (system + prior turns + the new question) rather than a single
 * prompt string, and may pass `onReasoning` to receive the model's
 * chain-of-thought separately from its answer.
 *
 * This exists because the two features that needed it — the Research Copilot and
 * the Portfolio audit memo — previously reached past the platform and called
 * Ollama's `streamChat()` themselves, since `runTaskStream(prompt, system)` could
 * not express a conversation or a reasoning sink. They got model selection right
 * (both called `pickModel`) but skipped the Router's fallback chain and health
 * tracking entirely. Widening the API deleted the reason to bypass it.
 *
 * Returns the model that answered (via the generator's return value).
 */
export async function* runTaskChat(
  taskType: TaskType,
  messages: ProviderChatTurn[],
  opts: RunTaskOptions = {},
): AsyncGenerator<string, string, unknown> {
  const withSystem: ProviderChatTurn[] =
    opts.system && !messages.some((m) => m.role === "system")
      ? [{ role: "system", content: opts.system }, ...messages]
      : messages;

  const routeOpts: RouteOptions = opts.model ? { model: opts.model } : {};

  return yield* routeStream(
    taskType,
    {
      messages: withSystem,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      json: opts.json,
      onReasoning: opts.onReasoning,
      signal: opts.signal,
    },
    routeOpts,
  );
}
