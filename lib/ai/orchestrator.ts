/**
 * AI Orchestrator — the single entry point for every AI request in the app.
 *
 * Feature code never imports a provider or builds provider wire formats
 * directly; it calls `runTask`/`runTaskText` with a {@link TaskType} and gets
 * back a normalized {@link AIResponse} (or just the answer text). Everything
 * else — which model, retry/fallback, response shape — is the Router's job.
 */

import type { AIProvider, ProviderChatTurn } from "./provider";
import { route, routeStream, type RouteOptions } from "./router";
import type { AIResponse } from "./response";
import type { TaskType } from "./task-registry";
import { dedupe } from "../platform/dedup";
import {
  beginCall,
  endCall,
  estimateTokens,
  logPipeline,
  pipelineDebugEnabled,
} from "../debug-pipeline";

export interface RunTaskOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Ask the model to respond with JSON only. */
  json?: boolean;
  /** JSON Schema for native structured outputs — see ProviderCompleteRequest.jsonSchema. */
  jsonSchema?: Record<string, unknown>;
  /** Explicit model override (e.g. a user-picked model in the copilot UI). Skips auto-routing/fallback. */
  model?: string;
  /** Receives reasoning deltas when the routed model is a thinking model. */
  onReasoning?: (delta: string) => void;
  signal?: AbortSignal;
  /**
   * Test/DI hook: override which providers are considered. Mirrors the Router's
   * own `providers` option so orchestrator-level behaviour (coalescing) can be
   * tested without a live provider.
   */
  providers?: AIProvider[];
}

/**
 * A stable fingerprint of the work a request represents.
 *
 * Only the inputs that change the *output* participate: the task (which picks
 * the model), the explicit model override, JSON mode, temperature, and the
 * message content. Timeouts and abort signals do not — two callers asking the
 * same question with different patience are still asking the same question.
 *
 * FNV-1a rather than node:crypto so this module stays importable anywhere.
 */
function fingerprint(taskType: TaskType, messages: ProviderChatTurn[], opts: RunTaskOptions): string {
  const payload = JSON.stringify([
    taskType,
    opts.model ?? "",
    opts.json ?? false,
    // A different wire schema is different work, even over identical messages.
    opts.jsonSchema ?? null,
    opts.temperature ?? "",
    messages.map((m) => [m.role, m.content]),
  ]);

  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `ai:${taskType}:${payload.length.toString(36)}:${h.toString(36)}`;
}

/**
 * Run a task and get the full normalized response (confidence, timing, model used, etc.).
 *
 * Identical concurrent work is **coalesced**: if the same task with the same
 * messages is already generating, this attaches to it rather than starting a
 * second inference. That matters far more here than for a normal HTTP cache,
 * a duplicate inference is pure spend — and on a serializing local backend it
 * used to double the wall-clock wait for everyone
 * queued behind it. The research page alone was firing duplicate movement and
 * financial-insight generations that the verdict then had to wait behind.
 */
export async function runTask(
  taskType: TaskType,
  prompt: string,
  opts: RunTaskOptions = {},
): Promise<AIResponse> {
  const messages: ProviderChatTurn[] = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    { role: "user" as const, content: prompt },
  ];
  const routeOpts: RouteOptions = {
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.providers ? { providers: opts.providers } : {}),
  };

  const run = (signal?: AbortSignal) =>
    route(
      taskType,
      {
        messages,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        timeoutMs: opts.timeoutMs,
        json: opts.json,
        jsonSchema: opts.jsonSchema,
        signal,
      },
      routeOpts,
    );

  const execute = () => {
    // A reasoning sink is per-caller, so coalescing would silently drop one
    // caller's deltas. Those requests run on their own.
    if (opts.onReasoning) return run(opts.signal);
    return dedupe(fingerprint(taskType, messages, opts), run, { signal: opts.signal });
  };

  // TEMPORARY (DEBUG_PIPELINE): per-logical-call timing + payload sizes.
  if (!pipelineDebugEnabled()) return execute();

  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  const promptHead = prompt.slice(0, 100).replace(/\s+/g, " ");
  const startedAt = Date.now();
  const handle = beginCall(`ai:${taskType} ~${estimateTokens(prompt)}tok "${promptHead}"`);
  logPipeline({
    type: "ai_call_start",
    taskType,
    promptChars,
    promptTokensEst: Math.round(promptChars / 4),
    promptHead,
    json: opts.json ?? false,
    modelOverride: opts.model ?? null,
    timeoutMs: opts.timeoutMs ?? null,
  });
  try {
    const response = await execute();
    logPipeline({
      type: "ai_call_end",
      taskType,
      durationMs: Date.now() - startedAt,
      model: response.model,
      responseChars: response.content.length,
      responseTokensEst: estimateTokens(response.content),
      tokenUsage: response.tokenUsage ?? null,
      fallbackErrors: response.errors.length,
    });
    return response;
  } catch (err) {
    logPipeline({
      type: "ai_call_error",
      taskType,
      durationMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    endCall(handle);
  }
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
 * names a model or talks to a provider directly.
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
 * the provider's streaming layer themselves, since `runTaskStream(prompt, system)` could
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

  const routeOpts: RouteOptions = {
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.providers ? { providers: opts.providers } : {}),
  };

  return yield* routeStream(
    taskType,
    {
      messages: withSystem,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      json: opts.json,
      jsonSchema: opts.jsonSchema,
      onReasoning: opts.onReasoning,
      signal: opts.signal,
    },
    routeOpts,
  );
}
