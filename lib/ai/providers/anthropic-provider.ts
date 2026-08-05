/**
 * Anthropic Provider — direct Claude API inference (claude-opus-5).
 *
 * The single hosted backend behind the provider-agnostic {@link AIProvider}
 * interface. It replaces the Devin CLI (a third-party coding agent shelling
 * out to hosted models — a ToS liability and an install burden) and the
 * Ollama tier (dropped): one provider, one model, real streaming, and the
 * user's own key.
 *
 * ## Egress guarantee
 * The client is constructed with an explicit `baseURL` of api.anthropic.com,
 * so a stray ANTHROPIC_BASE_URL in the environment cannot redirect prompts to
 * another host. The key comes from lib/ai/anthropic-key.ts (env, or the
 * user's local key file) and is never logged.
 *
 * ## Effort tiers ride on the model id
 * The Router routes model *ids*; per-task depth is expressed by registering
 * `claude-opus-5-low|-medium|-high` as distinct routable ids (see
 * models.ts / config.ts pins). This provider strips the suffix into
 * `output_config.effort` and always calls the real model `claude-opus-5`.
 * The normalized response reports the true model id, so badges stay honest.
 *
 * ## API shape notes (claude-opus-5)
 * - `temperature` is not accepted by the model — the request field is
 *   accepted by this provider and deliberately ignored.
 * - Thinking is on by default (adaptive). `thinking: false` maps to
 *   `{type: "disabled"}`, which the API only accepts at effort ≤ high — all
 *   our tiers. Reasoning summaries stream via `display: "summarized"` when a
 *   caller listens for them.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_BASE_URL, resolveApiKey } from "../anthropic-key";
import type {
  AIProvider,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
  ProviderModelInfo,
  ProviderTokenUsage,
} from "../provider";
import { MODEL_REGISTRY } from "../models";

export const ANTHROPIC_MODEL = "claude-opus-5";

export class AnthropicKeyMissingError extends Error {
  code = "anthropic_key_missing" as const;
  constructor() {
    super("No Anthropic API key is configured.");
    this.name = "AnthropicKeyMissingError";
  }
}

/** The key was presented and rejected (invalid/revoked) — a different fix than "add a key". */
export class AnthropicKeyInvalidError extends Error {
  code = "anthropic_key_invalid" as const;
  constructor() {
    // Static message on purpose: never echo anything derived from the key.
    super("The Anthropic API rejected the configured API key (invalid or revoked).");
    this.name = "AnthropicKeyInvalidError";
  }
}

/**
 * How many times the SDK retries a retryable failure (429, 408/409, 5xx,
 * connection errors) with exponential backoff BEFORE we ever see the error.
 * Explicit rather than the SDK default so the policy is visible and pinned.
 */
const SDK_MAX_RETRIES = 3;

/**
 * Map an SDK failure onto the platform's duck-typed error codes
 * (lib/ai/errors.ts classifies on `.code`), with messages that are safe to
 * render: static or SDK-status-derived, never containing the key.
 *
 *   401/403        → AnthropicKeyInvalidError  (fix: replace the key in Settings)
 *   429            → code "rate_limited"       (retries already exhausted; wait)
 *   connection     → code "network"            (offline / DNS / TLS)
 *   anything else  → rethrown as-is (the Router logs message text only)
 */
function normalizeSdkError(err: unknown): never {
  if (err instanceof Anthropic.APIConnectionError) {
    throw Object.assign(new Error("Could not reach api.anthropic.com (network error)."), {
      code: "network" as const,
    });
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (status === 401 || status === 403) throw new AnthropicKeyInvalidError();
    if (status === 429) {
      throw Object.assign(
        new Error(
          `Anthropic API rate limit hit — ${SDK_MAX_RETRIES} automatic retries with backoff were exhausted.`,
        ),
        { code: "rate_limited" as const },
      );
    }
  }
  throw err;
}

type Effort = "low" | "medium" | "high";

/**
 * Map the SDK's usage block onto the platform's provider-agnostic shape.
 * `input_tokens` is the UNCACHED input; cache writes/reads are billed at
 * their own rates and reported separately so telemetry can price them.
 */
function usageFromMessage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}): ProviderTokenUsage {
  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? undefined,
    cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
  };
}

/** "claude-opus-5-medium" → { model: "claude-opus-5", effort: "medium" }. */
export function parseModelId(id: string): { model: string; effort: Effort } {
  const m = id.match(/^(.*)-(low|medium|high)$/);
  if (m) return { model: m[1], effort: m[2] as Effort };
  return { model: id, effort: "high" };
}

/** Escape hatch for benchmarking the cache's own effect. On unless "off". */
function promptCacheEnabled(): boolean {
  return process.env.AI_PROMPT_CACHE !== "off";
}

const EPHEMERAL = { type: "ephemeral" as const };

type WireTextBlock = { type: "text"; text: string; cache_control?: typeof EPHEMERAL };
type WireTurn = { role: "user" | "assistant"; content: string | WireTextBlock[] };

/**
 * Prompt-cache placement — the wire shape for system + turns, with up to two
 * of the four allowed cache breakpoints:
 *
 *   1. The SYSTEM block, always. Below the API's cacheable minimum (~1024
 *      tokens) a marked block is simply not cached — no write premium, so the
 *      marker is free insurance; above it, one 1.25× write buys 0.1×-priced
 *      reads for every request sharing the prefix within the TTL.
 *   2. The LAST ASSISTANT turn, only in a real multi-turn conversation
 *      (≥3 turns). In the Copilot layout (dossier → ack → history → question)
 *      that pins the entire stable prefix — system, dossier, prior turns —
 *      so each subsequent turn re-reads it at a tenth of the price instead of
 *      re-paying prefill for the whole session. One-shot calls get NO turn
 *      breakpoint: their prompts never recur, and a cache write with no
 *      reader is a pure +25% on the written tokens.
 *
 * Marking never changes a single prompt byte — placement only. Exported for
 * tests.
 */
export function buildCachedPrompt(messages: ProviderCompleteRequest["messages"]): {
  system: WireTextBlock[] | undefined;
  turns: WireTurn[];
} {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns: WireTurn[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  if (turns.length === 0 || turns[0].role !== "user") {
    turns.unshift({ role: "user", content: systemText ? "Proceed." : "Hello." });
  }

  if (!promptCacheEnabled()) {
    return { system: systemText ? [{ type: "text", text: systemText }] : undefined, turns };
  }

  const system: WireTextBlock[] | undefined = systemText
    ? [{ type: "text", text: systemText, cache_control: EPHEMERAL }]
    : undefined;

  if (turns.length >= 3) {
    // Last assistant turn = end of the conversation's stable prefix (the final
    // turn is the new question and changes every call).
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn.role === "assistant" && typeof turn.content === "string") {
        turns[i] = {
          role: "assistant",
          content: [{ type: "text", text: turn.content, cache_control: EPHEMERAL }],
        };
        break;
      }
    }
  }

  return { system, turns };
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;

  private clientFor(key: string): Anthropic {
    // Explicit baseURL: prompts go to api.anthropic.com and nowhere else.
    // maxRetries: the SDK retries 429/408/409/5xx/connection failures with
    // exponential backoff before normalizeSdkError ever sees them.
    return new Anthropic({ apiKey: key, baseURL: ANTHROPIC_BASE_URL, maxRetries: SDK_MAX_RETRIES });
  }

  /** All registry tiers are routable whenever a key exists; none when not. */
  async listModels(): Promise<ProviderModelInfo[]> {
    if (!resolveApiKey()) return [];
    // sizeGb 0 = hosted; exempt from the Router's memory gate (fitsInMemory).
    return MODEL_REGISTRY.filter((m) => m.provider === "anthropic").map((m) => ({
      id: m.id,
      sizeGb: 0,
    }));
  }

  /**
   * Key presence, not a paid round trip: the Router health-checks providers on
   * hot paths, and the first real request surfaces auth/network failures with
   * a far better error than a probe would.
   */
  async healthCheck(): Promise<ProviderHealth> {
    const key = resolveApiKey();
    if (!key) return { reachable: false, models: [] };
    return { reachable: true, models: (await this.listModels()).map((m) => m.id) };
  }

  private buildParams(request: ProviderCompleteRequest) {
    const { model, effort } = parseModelId(request.model);
    // Prompt-cache breakpoints ride on the wire shape; see buildCachedPrompt.
    const { system, turns } = buildCachedPrompt(request.messages);

    return {
      model,
      max_tokens: request.maxTokens ?? 16000,
      ...(system ? { system } : {}),
      messages: turns,
      output_config: { effort },
      // Thinking is adaptive by default on claude-opus-5. An explicit false
      // disables it (valid at effort ≤ high); otherwise ask for summarized
      // display so reasoning-listening callers get real deltas.
      ...(request.thinking === false
        ? { thinking: { type: "disabled" as const } }
        : { thinking: { type: "adaptive" as const, display: "summarized" as const } }),
    };
  }

  private requestOptions(request: ProviderCompleteRequest) {
    return {
      ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    };
  }

  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    const key = resolveApiKey();
    if (!key) throw new AnthropicKeyMissingError();
    const client = this.clientFor(key);
    const params = this.buildParams(request);

    // Stream under the hood and accumulate: keeps long generations inside the
    // HTTP timeout regardless of maxTokens (SDK guidance), one code path.
    let final: Awaited<ReturnType<ReturnType<typeof client.messages.stream>["finalMessage"]>>;
    try {
      const stream = client.messages.stream(params, this.requestOptions(request));
      final = await stream.finalMessage();
    } catch (err) {
      normalizeSdkError(err);
    }

    if (final.stop_reason === "refusal") {
      throw new Error("The model declined this request (safety classifier refusal).");
    }

    let content = "";
    let reasoning = "";
    for (const block of final.content) {
      if (block.type === "text") content += block.text;
      else if (block.type === "thinking" && block.thinking) reasoning += block.thinking;
    }

    return {
      content,
      reasoning,
      tokenUsage: usageFromMessage(final.usage),
    };
  }

  async *stream(
    request: ProviderCompleteRequest,
    onReasoning?: (delta: string) => void,
  ): AsyncGenerator<string, void, unknown> {
    const key = resolveApiKey();
    if (!key) throw new AnthropicKeyMissingError();
    const client = this.clientFor(key);
    const params = this.buildParams(request);

    try {
      const stream = client.messages.stream(params, this.requestOptions(request));
      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            yield event.delta.text;
          } else if (event.delta.type === "thinking_delta" && onReasoning) {
            onReasoning(event.delta.thinking);
          }
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        throw new Error("The model declined this request (safety classifier refusal).");
      }
      request.onUsage?.(usageFromMessage(final.usage));
    } catch (err) {
      // Pre-first-token failures (auth, rate limit, network) normalize to the
      // platform's typed codes; the Router's "no fallback once output flows"
      // rule is unaffected because a mid-stream error still throws here.
      if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) {
        normalizeSdkError(err);
      }
      throw err;
    }
  }
}
