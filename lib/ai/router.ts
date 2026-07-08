/**
 * AI Router — turns a TaskType into a model choice and runs it, falling back
 * silently through the task's preferred-model list on failure.
 *
 * This is the only module that knows about both the Task Registry and the
 * Model Registry at once. Everything above it (the Orchestrator, feature
 * code) speaks in TaskType; everything below it (providers) speaks in raw
 * model ids. Swapping/adding a provider means changing {@link DEFAULT_PROVIDERS}
 * here — no other module changes.
 */

import { isHealthy, markFailure, markSuccess } from "./health";
import { MODEL_REGISTRY, specForInstalled, type ModelCapability } from "./models";
import { OllamaProvider } from "./providers/ollama-provider";
import type { AIProvider, ProviderChatTurn } from "./provider";
import { normalizeResponse, type AIResponse } from "./response";
import { TASK_REGISTRY, type TaskConfig, type TaskType } from "./task-registry";

const DEFAULT_PROVIDERS: AIProvider[] = [new OllamaProvider()];

export interface RouteRequest {
  messages: ProviderChatTurn[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  json?: boolean;
  signal?: AbortSignal;
}

export interface RouteOptions {
  /** Explicit model id — honored strictly (no auto-fallback substitution) when set. */
  model?: string;
  /** Test/DI hook: override which providers are considered. Defaults to the real Ollama provider. */
  providers?: AIProvider[];
}

export class AllModelsFailedError extends Error {
  code = "all_models_failed" as const;
  constructor(taskType: TaskType, attempts: string[]) {
    super(`All compatible models failed for task "${taskType}": ${attempts.join("; ")}`);
    this.name = "AllModelsFailedError";
  }
}

/**
 * Match a registry id like "qwen3" against an installed `:`-tagged variant
 * such as "qwen3:30b-a3b". Exact base equality only — NOT a loose
 * `startsWith` in either direction, which would incorrectly match an
 * unrelated model like "qwen3-coder" to the "qwen3" preference just because
 * the string starts the same, silently routing general tasks to a
 * coding-specialized (and often slower/larger) model.
 */
function resolveInstalledId(registryId: string, installed: string[]): string | undefined {
  return installed.find((id) => {
    const base = id.split(":")[0].toLowerCase();
    return id === registryId || base === registryId;
  });
}

function isEnabled(installedId: string): boolean {
  return specForInstalled(installedId).enabled;
}

function hasCapabilities(installedId: string, required?: ModelCapability[]): boolean {
  if (!required || required.length === 0) return true;
  const spec = specForInstalled(installedId);
  return required.every((cap) => spec.capabilities.includes(cap));
}

/**
 * Ordered, installed, enabled, currently-healthy model ids for a task — best
 * candidate first. `requiredCapabilities` is enforced within the preferred
 * list (so e.g. a coding task never gets a non-coding model), but every
 * fallback tier below it ignores capability/registry membership — an
 * imperfect answer beats a hard failure just because the ideal model hasn't
 * been pulled, or isn't a model this registry has ever heard of.
 */
export function candidateModels(taskConfig: TaskConfig, installed: string[]): string[] {
  const preferred = taskConfig.preferredModels
    .map((id) => resolveInstalledId(id, installed))
    .filter((id): id is string => Boolean(id))
    .filter((id) => isEnabled(id) && hasCapabilities(id, taskConfig.requiredCapabilities));

  const seen = new Set(preferred);
  const healthy = preferred.filter((id) => isHealthy(id));
  const unhealthyButPresent = preferred.filter((id) => !isHealthy(id));

  if (healthy.length > 0) return [...healthy, ...unhealthyButPresent];
  if (preferred.length > 0) return preferred; // everything preferred is cooling down — try anyway, better than nothing

  // Nothing preferred (capability-matching) is installed: offer any other
  // installed, enabled, *registered* model as a second-tier fallback...
  const registryFallback = [...MODEL_REGISTRY]
    .sort((a, b) => a.priority - b.priority)
    .map((spec) => resolveInstalledId(spec.id, installed))
    .filter((id): id is string => id != null && !seen.has(id))
    .filter((id) => isEnabled(id));

  if (registryFallback.length > 0) return registryFallback;

  // ...and if even that's empty (every installed model is unknown to the
  // registry, e.g. a model like "devstral" nothing above fuzzy-matches),
  // fall back to whatever is installed at all rather than failing the task.
  return installed.filter((id) => isEnabled(id));
}

/**
 * Which model would be used for a task right now, without running anything —
 * for callers (like the copilot's streaming chat route) that need the model
 * id up front rather than a full completion.
 */
export async function pickModel(
  taskType: TaskType,
  opts: { providers?: AIProvider[]; installed?: string[] } = {},
): Promise<string | null> {
  const installed = opts.installed ?? (await (opts.providers ?? DEFAULT_PROVIDERS)[0].listModels());
  const candidates = candidateModels(TASK_REGISTRY[taskType], installed);
  return candidates[0] ?? installed[0] ?? null;
}

/**
 * Route a task to a model and run it, retrying the next compatible model on
 * failure. Throws {@link AllModelsFailedError} only when every candidate
 * failed — a single bad model is invisible to the caller.
 */
export async function route(
  taskType: TaskType,
  request: RouteRequest,
  opts: RouteOptions = {},
): Promise<AIResponse> {
  const provider = (opts.providers ?? DEFAULT_PROVIDERS)[0];
  const taskConfig = TASK_REGISTRY[taskType];
  const startedAt = Date.now();

  const installed = await provider.listModels();
  const candidates = opts.model ? [opts.model] : candidateModels(taskConfig, installed);

  if (candidates.length === 0) {
    throw new AllModelsFailedError(taskType, ["no compatible model is installed"]);
  }

  const attemptErrors: string[] = [];
  for (const model of candidates) {
    try {
      const result = await provider.complete({
        model,
        messages: request.messages,
        temperature: request.temperature ?? taskConfig.temperature,
        maxTokens: request.maxTokens ?? taskConfig.maxTokens,
        timeoutMs: request.timeoutMs ?? taskConfig.timeoutMs,
        json: request.json ?? taskConfig.jsonMode,
        signal: request.signal,
      });
      markSuccess(model);
      return normalizeResponse({
        content: result.content,
        reasoning: result.reasoning,
        model,
        provider: provider.id,
        startedAt,
        tokenUsage: result.tokenUsage,
        fallbackErrors: attemptErrors,
        metadata: { taskType, candidatesConsidered: candidates.length },
      });
    } catch (err) {
      markFailure(model);
      const message = err instanceof Error ? err.message : String(err);
      attemptErrors.push(`${model}: ${message}`);
    }
  }

  throw new AllModelsFailedError(taskType, attemptErrors);
}
