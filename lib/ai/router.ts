/**
 * AI Router — turns a TaskType into a model choice and runs it, falling back
 * through the remaining candidates on failure.
 *
 * This is the only module that knows about the Task Registry and the Model
 * Registry at once. Everything above it (Orchestrator, feature code) speaks in
 * TaskType; everything below it (providers) speaks in raw model ids.
 *
 * ## How a model is chosen
 *
 *   1. ELIGIBILITY (hard gates — a model either can do the job or it cannot)
 *        installed ∧ enabled ∧ not-disabled ∧ FITS IN MEMORY ∧ has required caps
 *   2. SCORE (soft ranking)
 *        quality and speed, weighted by the task's own declared complexity and
 *        latency sensitivity
 *   3. TIEBREAK
 *        registry priority, then model id — so the order is fully deterministic
 *
 * A config pin (./config.ts) short-circuits 2 and 3 entirely.
 *
 * Memory is a *gate*, not a scoring penalty, and that is deliberate: a model
 * whose weights exceed RAM does not return a worse answer, it thrashes — 0.9
 * tok/s, 302s for a single completion, measured. Ranking it low would still let
 * it be selected whenever the good models are in health cooldown, which is
 * precisely when you least want a five-minute request.
 */

import { disabledModels, pinnedModels, providerOrder } from "./config";
import { classifyAiError } from "./errors";
import { acquireGenerationSlot } from "./gate";
import { isHealthy, markFailure, markSuccess, recentSuccessWithinMs } from "./health";
import { logAiEvent } from "./log";
import {
  fitsInMemory,
  isHostedProvider,
  specForInstalled,
  type ModelCapability,
  type ModelSpec,
  type ProviderId,
} from "./models";
import { isCallerAbort, isTimeout } from "./ollama";
import { DevinProvider } from "./providers/devin-provider";
import { OllamaProvider } from "./providers/ollama-provider";
import type { AIProvider, ProviderChatTurn, ProviderModelInfo } from "./provider";
import { normalizeResponse, type AIResponse } from "./response";
import {
  TASK_REGISTRY,
  type Complexity,
  type LatencySensitivity,
  type TaskConfig,
  type TaskType,
} from "./task-registry";

const PROVIDER_FACTORIES: Record<ProviderId, () => AIProvider> = {
  devin: () => new DevinProvider(),
  ollama: () => new OllamaProvider(),
};

let providerCache: { key: string; providers: AIProvider[] } | null = null;

/**
 * The provider chain, best first. Order comes from config so it is an env
 * change, not a code change (AI_PROVIDER_ORDER).
 *
 * Instances are cached because providers hold caches of their own — Devin's
 * model catalogue in particular costs a process spawn to populate, and a fresh
 * instance per request would throw that away every time.
 */
export function defaultProviders(): AIProvider[] {
  const order = providerOrder();
  const key = order.join(",");
  if (!providerCache || providerCache.key !== key) {
    providerCache = { key, providers: order.map((id) => PROVIDER_FACTORIES[id]()) };
  }
  return providerCache.providers;
}

/** Test hook: drop cached provider instances so an env change takes effect. */
export function resetProvidersForTests(): void {
  providerCache = null;
}

export interface RouteRequest {
  messages: ProviderChatTurn[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  json?: boolean;
  signal?: AbortSignal;
  /** Receives reasoning deltas when the chosen model is thinking. */
  onReasoning?: (delta: string) => void;
}

export interface RouteOptions {
  /** Explicit model id — honored strictly (no auto-fallback substitution) when set. */
  model?: string;
  /** Test/DI hook: override which providers are considered. */
  providers?: AIProvider[];
}

export class AllModelsFailedError extends Error {
  code = "all_models_failed" as const;
  constructor(taskType: TaskType, attempts: string[]) {
    super(`All compatible models failed for task "${taskType}": ${attempts.join("; ")}`);
    this.name = "AllModelsFailedError";
  }
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How heavily a task's reasoning demand weights model quality. A `deep` task (a
 * thesis, a 10-K risk review) *is* the product — a faster but shallower answer
 * is worth nothing. A `light` task (parsing a search box) has no research
 * quality to protect at all.
 */
const QUALITY_WEIGHT: Record<Complexity, number> = {
  deep: 1.0,
  standard: 0.75,
  light: 0.25,
};

/**
 * How heavily a task's latency demand weights model speed. `background` work
 * (the scanner, IC agents) is not being watched; `interactive` work has a human
 * staring at a spinner, where 7s versus 17s is the entire experience.
 */
const SPEED_WEIGHT: Record<LatencySensitivity, number> = {
  interactive: 1.0,
  standard: 0.35,
  background: 0.1,
};

/** Capabilities a task cannot be served without. */
export function requiredCapabilities(taskType: TaskType, task: TaskConfig): ModelCapability[] {
  const caps: ModelCapability[] = [];
  // A model that can't reliably emit JSON-only silently poisons every
  // downstream parse, so this is a gate rather than a scoring input.
  if (task.jsonMode) caps.push("structured-json");
  if (task.complexity === "deep") caps.push("reasoning");
  if (taskType === "coding") caps.push("coding");
  return caps;
}

/**
 * Rank models for a task. Pure and deterministic: the same inputs always produce
 * the same order, with no randomness anywhere.
 *
 * Speed is normalized against the fastest *eligible* model rather than an
 * absolute scale, so the ranking stays meaningful on any hardware — what matters
 * is the trade-off among the options actually available here.
 */
export function scoreModels(task: TaskConfig, specs: ModelSpec[]): ModelSpec[] {
  const fastest = Math.max(...specs.map((s) => s.tokensPerSecond), 1);
  const qw = QUALITY_WEIGHT[task.complexity];
  const sw = SPEED_WEIGHT[task.latency];

  return specs
    .map((spec) => ({
      spec,
      score: qw * (spec.quality / 10) + sw * (spec.tokensPerSecond / fastest),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.spec.priority - b.spec.priority ||
        a.spec.id.localeCompare(b.spec.id),
    )
    .map((s) => s.spec);
}

/** Push recently-failed models to the back of the order without excluding them. */
function orderByHealth(ids: string[]): string[] {
  return [...ids.filter((id) => isHealthy(id)), ...ids.filter((id) => !isHealthy(id))];
}

/**
 * Ordered model ids to try for a task, best first.
 *
 * Eligibility relaxes in tiers rather than failing hard: an imperfect answer
 * beats no answer merely because the ideal model hasn't been pulled. The one
 * gate never relaxed until the true last resort is memory — see the note at the
 * top of this file.
 */
export function candidateModels(
  taskType: TaskType,
  task: TaskConfig,
  installed: ProviderModelInfo[],
): string[] {
  const off = disabledModels();
  const usable = installed.filter((m) => !off.has(m.id));
  const present = new Map(usable.map((m) => [m.id, m]));

  // A config pin overrides scoring entirely — but it cannot conjure a model that
  // isn't installed, and it cannot smuggle one past the memory gate.
  const pins = pinnedModels(taskType);
  if (pins) {
    const pinned = pins.filter(
      (id) => present.has(id) && fitsInMemory(specForInstalled(id), present.get(id)?.sizeGb),
    );
    if (pinned.length > 0) return orderByHealth(pinned);
  }

  const withSpec = usable.map((m) => ({ info: m, spec: specForInstalled(m.id) }));
  const fits = withSpec.filter((m) => fitsInMemory(m.spec, m.info.sizeGb));
  const enabled = fits.filter((m) => m.spec.enabled);

  const required = requiredCapabilities(taskType, task);
  const capable = enabled.filter(
    (m) =>
      required.every((cap) => m.spec.capabilities.includes(cap)) &&
      (task.contextTokens ?? 0) <= m.spec.contextWindow,
  );

  // Fully-capable models first (best-scored), then the rest as degraded
  // fallbacks. The tail matters: only qwen3:14b carries the `reasoning`
  // capability here, so a capability-only candidate list would leave every deep
  // task with exactly ONE model and no recovery — a single timeout would hard-
  // fail an IC report rather than falling back to a weaker but working answer.
  // Ranked strictly below the capable set, so it changes nothing on the happy
  // path.
  const capableIds = scoreModels(task, capable.map((m) => m.spec)).map((s) => s.id);
  const degradedIds = scoreModels(
    task,
    enabled.filter((m) => !capable.includes(m)).map((m) => m.spec),
  ).map((s) => s.id);

  if (capableIds.length > 0 || degradedIds.length > 0) {
    return orderByHealth([...capableIds, ...degradedIds]);
  }
  // Nothing enabled — any model that fits at all.
  if (fits.length > 0) {
    return orderByHealth(fits.map((m) => m.spec.id));
  }
  // True last resort: every installed model is over the memory budget. A slow
  // answer still beats a hard failure, so try anyway rather than refuse.
  return orderByHealth(usable.map((m) => m.id));
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether to let a reasoning model think on this call.
 *
 * JSON is an absolute veto, not a preference: qwen3 under `format: "json"` with
 * thinking on returns the literal two-token string `{}` — 0/3 valid across
 * trials versus 3/3 with thinking off. `{}` *parses*, so this failed completely
 * silently: every JSON task received an empty object and quietly rendered its
 * fallback state. This one line is the fix for the platform's worst bug.
 */
function resolveThinking(
  task: TaskConfig,
  spec: ModelSpec,
  json: boolean | undefined,
): boolean | undefined {
  if (spec.thinking === "none") return undefined; // no reasoning channel; don't send the flag
  if (json) return false;
  return task.thinking ?? false;
}

/**
 * Generation settings for a (task, model) pair — the single place task config,
 * model defaults, and per-call overrides are reconciled.
 */
function settingsFor(task: TaskConfig, model: string, request: RouteRequest) {
  const spec = specForInstalled(model);
  const json = request.json ?? task.jsonMode;
  return {
    temperature: request.temperature ?? task.temperature ?? spec.temperature,
    maxTokens: request.maxTokens ?? task.maxTokens,
    timeoutMs: request.timeoutMs ?? task.timeoutMs ?? spec.timeoutMs,
    json,
    // Only pay for a large KV cache on tasks that declared they need one;
    // otherwise let Ollama use its default window. On a memory-tight host an
    // unnecessary 32k context is real RAM taken from the weights.
    numCtx: task.contextTokens ? Math.min(task.contextTokens, spec.contextWindow) : undefined,
    thinking: resolveThinking(task, spec, json),
    keepAlive: keepAliveFor(task),
  };
}

/**
 * Cap on how much extra budget a suspected cold load earns an attempt, and
 * the multiplier applied to the model's own configured timeout to get there.
 *
 * Every model's `timeoutMs` in the registry is already sized generously for
 * an ordinary cold load (300s for qwen3:14b, measured against a healthy
 * host). What it does NOT budget for is a host under unusual memory
 * pressure — observed once at exactly 300s: qwen3:14b's cold load alone ate
 * the entire deadline with zero time left to generate, so the request died
 * at the worst possible moment (load complete, about to answer) instead of
 * either failing fast or succeeding. Widening the budget specifically for a
 * *detected* cold start (never for a warm one — a warm model that's still
 * slow after this many seconds is a different, more concerning problem) is a
 * bounded, one-time allowance for exactly that scenario.
 */
const COLD_START_MULTIPLIER = 1.5;
const COLD_START_MAX_MS = 480_000; // 8 minutes — a firm ceiling for any model with no measured value

/**
 * Prefers a model's own measured `coldStartTimeoutMs` (see lib/ai/models.ts)
 * when the registry has one; otherwise falls back to a generic multiplier of
 * the model's base timeout, still capped. The generic path exists so an
 * unmeasured or unknown model degrades safely rather than getting an
 * arbitrary hardcoded number — measuring and recording a real value for it
 * (the way `tokensPerSecond`/`quality` already are) is the intended next step,
 * not a permanent state.
 */
function widenForColdStart(model: string, timeoutMs: number): number {
  const measured = specForInstalled(model).coldStartTimeoutMs;
  if (measured != null) return measured;
  return Math.min(Math.round(timeoutMs * COLD_START_MULTIPLIER), COLD_START_MAX_MS);
}

/** How recent a local success has to be to override a "cold" probe result — just under Ollama's 5-minute default `keep_alive`, so it can't outlive the window the model is actually likely to still be resident. */
const RECENT_SUCCESS_WINDOW_MS = 4 * 60_000;

/**
 * Is `model` already resident? Combines two independent signals rather than
 * trusting either alone:
 *
 *   1. The provider's best-effort probe (Ollama's `/api/ps`) — one HTTP
 *      round trip at one instant.
 *   2. Whether THIS process itself completed a call to this exact model
 *      very recently (see health.ts's `recentSuccessWithinMs`) — free, and
 *      immune to the probe racing a genuinely concurrent use or lagging
 *      Ollama's own bookkeeping by a beat.
 *
 * "Assume warm" (`true`) whenever there's no real information at all — no
 * provider capability, or the probe itself failed — which is also what the
 * FakeProvider used in tests gets by default, so every existing
 * timeout/timing assertion keeps its original meaning unless a test opts in
 * by implementing {@link AIProvider.isModelWarm}.
 */
async function isWarm(provider: AIProvider, model: string): Promise<boolean> {
  if (!provider.isModelWarm) return true;
  let probe: boolean;
  try {
    probe = await provider.isModelWarm(model);
  } catch {
    return true; // probe unavailable — no signal either way
  }
  if (probe) return true;
  // The probe says cold; a very recent local success is stronger, cheaper
  // evidence than a second network round trip, so it gets the final say.
  return recentSuccessWithinMs(model, RECENT_SUCCESS_WINDOW_MS);
}

/**
 * How long to keep the model resident after answering.
 *
 * Cold load, not generation, is what makes a local model feel broken: measured
 * on this host, a 4.4GB model took 69.6s to load and 0.4s to answer. Ollama
 * evicts after five idle minutes by default, so a task the user reaches
 * occasionally pays that load almost every time — and an `interactive` task,
 * whose entire budget is 45s, then cannot finish however small the question.
 *
 * So the tasks a human is actively waiting on hold the model; `background` work
 * accepts its own eviction rather than pinning ~10GB for a scheduled job that
 * runs once an hour. This is the reason a warm assistant answers in ~1s.
 *
 * Background/standard work now holds the model for 10 minutes rather than
 * accepting Ollama's 5-minute default: a multi-stage pipeline (the Wire scan,
 * an IC report) issues its calls back-to-back, but a single interleaved
 * interactive request on a memory-tight host evicts the pipeline's model and
 * the next stage pays a cold load mid-scan (observed 2026-07-31: a mid-scan
 * model swap cost 145s). Ten minutes comfortably outlives any gap between a
 * pipeline's own calls without pinning the model for hours.
 */
function keepAliveFor(task: TaskConfig): string | undefined {
  return task.latency === "interactive" ? "30m" : "10m";
}

/**
 * The ordered (provider, model) attempts for a task.
 *
 * A generator, and that is the point: enumerating a provider costs a round
 * trip — Ollama's `/api/tags` has a 4s timeout, Devin's catalogue a process
 * spawn — and the whole reason Devin is first is that we want to *not* pay
 * Ollama's when Devin answers. Building the full list eagerly would charge
 * every request for a daemon that, on a working setup, is never used.
 *
 * An explicit `model` override is still honored strictly: it is matched
 * against each provider in order and, if no provider claims it, attempted on
 * the first provider anyway rather than silently substituted.
 */
async function* attemptOrder(
  taskType: TaskType,
  task: TaskConfig,
  providers: AIProvider[],
  explicitModel?: string,
): AsyncGenerator<{ provider: AIProvider; model: string }, void, unknown> {
  if (explicitModel) {
    for (const provider of providers) {
      const installed = await provider.listModels();
      if (installed.some((m) => m.id === explicitModel)) {
        yield { provider, model: explicitModel };
        return;
      }
    }
    if (providers[0]) yield { provider: providers[0], model: explicitModel };
    return;
  }

  for (const provider of providers) {
    const installed = await provider.listModels();
    for (const model of candidateModels(taskType, task, installed)) {
      yield { provider, model };
    }
  }
}

/**
 * Which model would be used for a task right now, without running anything —
 * for callers that need the model id up front (e.g. to label output).
 */
export async function pickModel(
  taskType: TaskType,
  opts: { providers?: AIProvider[]; installed?: ProviderModelInfo[] } = {},
): Promise<string | null> {
  const task = TASK_REGISTRY[taskType];
  if (opts.installed) {
    return candidateModels(taskType, task, opts.installed)[0] ?? opts.installed[0]?.id ?? null;
  }

  const providers = opts.providers ?? defaultProviders();
  for await (const { model } of attemptOrder(taskType, task, providers)) return model;

  // No provider offered a candidate. Fall back to naming *something* installed
  // so callers that label output ("analyzed by …") don't render a blank.
  for (const provider of providers) {
    const installed = await provider.listModels();
    if (installed[0]) return installed[0].id;
  }
  return null;
}

/**
 * Route a task to a model and run it, retrying the next candidate on failure.
 * Throws {@link AllModelsFailedError} only when every candidate failed — a
 * single bad model is invisible to the caller.
 */
export async function route(
  taskType: TaskType,
  request: RouteRequest,
  opts: RouteOptions = {},
): Promise<AIResponse> {
  const providers = opts.providers ?? defaultProviders();
  const task = TASK_REGISTRY[taskType];
  const startedAt = Date.now();

  const attemptErrors: string[] = [];
  // A cold-start timeout earns the chain exactly one extra candidate — not
  // an unbounded walk. Without a cap, a genuinely overloaded host would cold-
  // time-out on every candidate in turn and multiply the wait by the full
  // candidate count, which is precisely the failure mode the original "never
  // fall back after a timeout" rule existed to prevent. This keeps that
  // protection while still recovering the one case it was too strict for: a
  // single unlucky cold load, with a smaller/faster model waiting right behind it.
  let coldTimeoutFallbacksUsed = 0;
  const MAX_COLD_TIMEOUT_FALLBACKS = 1;
  let considered = 0;

  for await (const { provider, model } of attemptOrder(taskType, task, providers, opts.model)) {
    considered += 1;
    // An abort is the caller's decision, not a model failure. Retrying the
    // next candidate would keep spending on work nobody is waiting for.
    if (request.signal?.aborted) break;

    // Everything below that queues for a generation slot, probes residency or
    // widens a deadline is a consequence of the weights sitting in LOCAL RAM
    // behind a daemon that serializes generation. A hosted provider has no
    // load phase to widen a budget for and runs genuinely parallel, so it
    // takes none of it — applying it there would be wrong, not just redundant.
    const local = !isHostedProvider(provider.id);
    const settings = settingsFor(task, model, request);
    const queuedAt = Date.now();
    let warm = true;
    let attemptStartedAt = queuedAt;
    try {
      // Wait for the generation gate BEFORE starting the attempt's clock:
      // Ollama serializes generations, so a deadline that starts at enqueue
      // races the queue rather than the model — measured burning a full 300s
      // budget while waiting, then aborting having never generated a token.
      const release = local ? await acquireGenerationSlot(request.signal) : null;
      try {
        // Detected once per attempt, right before using it — a model can warm
        // up or get evicted while this request was queued at the gate.
        if (local) warm = await isWarm(provider, model);
        const timeoutMs = warm ? settings.timeoutMs : widenForColdStart(model, settings.timeoutMs);
        attemptStartedAt = Date.now();
        const result = await provider.complete({
          model,
          messages: request.messages,
          signal: request.signal,
          ...settings,
          timeoutMs,
        });
        markSuccess(model);
        logAiEvent({
          category: "success",
          taskType,
          model,
          coldStart: !warm,
          durationMs: Date.now() - attemptStartedAt,
          queueMs: attemptStartedAt - queuedAt,
        });
        return normalizeResponse({
          content: result.content,
          reasoning: result.reasoning,
          model,
          provider: provider.id,
          startedAt,
          tokenUsage: result.tokenUsage,
          fallbackErrors: attemptErrors,
          metadata: { taskType, candidatesConsidered: considered, coldStart: !warm },
        });
      } finally {
        release?.();
      }
    } catch (err) {
      const classified = classifyAiError(err);
      logAiEvent({
        category: classified.category === "cancelled" ? "cancelled" : classified.category,
        taskType,
        model,
        coldStart: !warm,
        durationMs: Date.now() - attemptStartedAt,
        queueMs: attemptStartedAt - queuedAt,
        message: err instanceof Error ? err.message : String(err),
      });

      // A caller abort says nothing about the model — the request was
      // withdrawn, not refused. It must never count against the model's
      // health (a cooldown here would penalize a perfectly good model for
      // the user having changed their mind) and never fall back (nobody is
      // waiting for any answer any more, and continuing would just occupy
      // Ollama, which serializes generations and so delays everyone else's
      // queue behind a zombie request).
      if (isCallerAbort(err)) throw err;

      markFailure(model);
      // Qualified by provider: the same model id can now be reached two ways,
      // and "which provider failed" is the first thing you need to know.
      attemptErrors.push(`${provider.id}/${model}: ${err instanceof Error ? err.message : String(err)}`);

      // Fall back on a model that FAILED, never on a LOCAL one that ran out of
      // time while WARM. A warm local model timing out says something about
      // this host's current load, not about the model, and the next local
      // candidate faces the same host: retrying just multiplies the wait the
      // user already gave up on — 45s became 2m15s across three candidates,
      // measured. A model that was COLD already got a widened budget above for
      // the load phase; if it still timed out, the fallback is usually
      // smaller/faster to load, so it's worth ONE more try (capped above).
      //
      // None of that reasoning survives the hop to a HOSTED provider: its
      // timeout implies nothing about local memory pressure, and the next
      // candidate is a different machine entirely. Stopping the chain there
      // would defeat the whole point of having a fallback provider, so a
      // hosted timeout falls through like any other failure.
      if (isTimeout(err) && local) {
        if (warm || coldTimeoutFallbacksUsed >= MAX_COLD_TIMEOUT_FALLBACKS) throw err;
        coldTimeoutFallbacksUsed += 1;
      }
    }
  }

  if (attemptErrors.length === 0) {
    throw new AllModelsFailedError(taskType, ["no compatible model is available"]);
  }
  throw new AllModelsFailedError(taskType, attemptErrors);
}

/**
 * Streaming counterpart to {@link route}: same selection, same fallback chain,
 * but yields answer-text deltas.
 *
 * Fallback can only happen *before* the first token — once output is flowing we
 * never silently switch models mid-answer and splice two models' prose together.
 */
export async function* routeStream(
  taskType: TaskType,
  request: RouteRequest,
  opts: RouteOptions = {},
): AsyncGenerator<string, string, unknown> {
  const providers = opts.providers ?? defaultProviders();
  const task = TASK_REGISTRY[taskType];

  const attemptErrors: string[] = [];
  let coldTimeoutFallbacksUsed = 0;
  const MAX_COLD_TIMEOUT_FALLBACKS = 1;

  for await (const { provider, model } of attemptOrder(taskType, task, providers, opts.model)) {
    if (request.signal?.aborted) break;
    let started = false;
    // Local-only, exactly as in route(): the gate, the residency probe and the
    // widened cold budget all describe a local daemon's constraints.
    const local = !isHostedProvider(provider.id);
    const settings = settingsFor(task, model, request);
    const queuedAt = Date.now();
    let warm = true;
    let attemptStartedAt = queuedAt;
    try {
      // Same gate as route(): the deadline must race the model, not the queue.
      // The slot is held for the whole stream — Ollama is busy until the last
      // token, so releasing earlier would only let a second request pile up
      // behind this one inside Ollama where its timeout can't see the queue.
      const release = local ? await acquireGenerationSlot(request.signal) : null;
      try {
        if (local) warm = await isWarm(provider, model);
        const timeoutMs = warm ? settings.timeoutMs : widenForColdStart(model, settings.timeoutMs);
        attemptStartedAt = Date.now();
        const stream = provider.stream(
          {
            model,
            messages: request.messages,
            signal: request.signal,
            ...settings,
            timeoutMs,
          },
          request.onReasoning,
        );

        for await (const delta of stream) {
          started = true;
          yield delta;
        }

        markSuccess(model);
        logAiEvent({
          category: "success",
          taskType,
          model,
          coldStart: !warm,
          durationMs: Date.now() - attemptStartedAt,
          queueMs: attemptStartedAt - queuedAt,
        });
        return model;
      } finally {
        release?.();
      }
    } catch (err) {
      const classified = classifyAiError(err);
      logAiEvent({
        category: classified.category,
        taskType,
        model,
        coldStart: !warm,
        durationMs: Date.now() - attemptStartedAt,
        message: err instanceof Error ? err.message : String(err),
      });

      // A caller abort is withdrawal, not a model failure — see route()'s
      // identical reasoning. Never health-penalized, never a candidate for
      // fallback (no fallback is possible for the SAME reason: nobody is
      // waiting, so starting another model's generation would be pure waste).
      if (isCallerAbort(err)) throw err;

      markFailure(model);
      attemptErrors.push(`${provider.id}/${model}: ${err instanceof Error ? err.message : String(err)}`);

      // Mid-stream failure: the consumer already has partial output from THIS
      // model. Retrying another would append a second model's answer to the
      // first one's. Fail honestly instead.
      if (started) throw new AllModelsFailedError(taskType, attemptErrors);

      // Same policy as route(): a warm LOCAL timeout stops the chain; a cold
      // one earns exactly one more candidate before it does too. A hosted
      // timeout says nothing about this host, so it falls through.
      if (isTimeout(err) && local) {
        if (warm || coldTimeoutFallbacksUsed >= MAX_COLD_TIMEOUT_FALLBACKS) throw err;
        coldTimeoutFallbacksUsed += 1;
      }
    }
  }

  if (attemptErrors.length === 0) {
    throw new AllModelsFailedError(taskType, ["no compatible model is available"]);
  }
  throw new AllModelsFailedError(taskType, attemptErrors);
}
