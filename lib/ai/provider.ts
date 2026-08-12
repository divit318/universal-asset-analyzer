/**
 * AI Provider Interface — the contract every inference backend implements.
 *
 * The Router (./router.ts) only ever talks to this interface, never to a
 * concrete backend. Adding a future provider (a different local runtime, or
 * a hosted API) means writing one class that implements this and registering
 * it in ./providers — no changes to the Router, Orchestrator, or any feature.
 */

export interface ProviderChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * An image travelling with a request (multimodal input). Kept as raw base64 +
 * media type — the lowest common denominator every vision-capable wire format
 * (Anthropic image blocks, OpenAI data-URL image_url, Gemini inline_data)
 * builds from. Providers attach images to the FINAL user turn; the platform
 * deliberately has no per-turn image placement, because no feature needs it
 * and the flattened single-prompt providers couldn't honor it anyway.
 */
export interface ProviderImageAttachment {
  /** e.g. "image/png", "image/jpeg", "image/webp". */
  mediaType: string;
  /** Raw base64 payload (no `data:` prefix). */
  base64: string;
}

/**
 * Token accounting for one completion, as reported by the provider.
 *
 * The cache fields follow Anthropic's billing split: `promptTokens` is the
 * UNCACHED input, `cacheCreationTokens` were written to the prompt cache
 * (billed at the cache-write rate), and `cacheReadTokens` were served from it
 * (billed at ~10% of the input rate). Providers without a prompt cache simply
 * leave the cache fields undefined.
 */
export interface ProviderTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface ProviderCompleteRequest {
  model: string;
  messages: ProviderChatTurn[];
  /**
   * Images attached to the final user turn (vision input). Only routed to a
   * provider that declares {@link AIProvider.supportsImages} AND a model
   * carrying the "vision" capability — the Router gates on both, so a
   * text-only provider never receives this field populated.
   */
  images?: ProviderImageAttachment[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Ask the model to respond with JSON only. */
  json?: boolean;
  /**
   * JSON Schema for NATIVE structured outputs (constrained decoding), when the
   * provider supports it. Stronger than `json`: the wire format guarantees the
   * response parses against this schema instead of asking nicely in the
   * prompt. Providers without the capability ignore it — `json` + the prompt's
   * own directives remain the portable fallback, so the two are sent together.
   */
  jsonSchema?: Record<string, unknown>;
  /**
   * Toggle chain-of-thought on a reasoning model. `undefined` = the model has no
   * reasoning channel, so don't send the flag at all. The Router forces `false`
   * under `json` — the two cannot be combined (see router.ts:resolveThinking).
   */
  thinking?: boolean;
  /** Context window to allocate. Omit to accept the provider's default. */
  numCtx?: number;
  /**
   * How long the provider should keep the model resident after answering.
   * Provider-agnostic hint for LOCAL runtimes (a daemon's `keep_alive`);
   * hosted providers ignore it. Omit for the provider's default.
   */
  keepAlive?: string;
  /**
   * True when this request belongs to a BACKGROUND task (task registry
   * `latency: "background"` — the scanner, IC agents, cache warmers). A hint
   * for providers whose transport consumes real local resources per call: the
   * Devin CLI's print mode spawns a full CLI subprocess per completion, and a
   * background fan-out of 6-8 of them starved interactive requests on this
   * host (Phase 1: scanner storms, 300s budgets stretching to 620-980s of
   * wall clock in the queue). Background requests are capped to a smaller
   * slice of the subprocess pool and queue BEHIND interactive ones. Hosted
   * HTTP providers ignore it.
   */
  background?: boolean;
  signal?: AbortSignal;
  /**
   * Streaming only: called once, at end of stream, with the completion's token
   * usage. `complete()` reports usage on its result instead; a generator has no
   * result object to carry it, hence the callback. Best-effort — a provider
   * that doesn't track usage never calls it.
   */
  onUsage?: (usage: ProviderTokenUsage) => void;
}

/** An installed model and what it costs to run. */
export interface ProviderModelInfo {
  id: string;
  /** Weights size in GB. The Router gates on this — a model bigger than RAM thrashes. */
  sizeGb: number;
}

export interface ProviderCompleteResult {
  /** Answer text, with any provider-specific reasoning markup already stripped. */
  content: string;
  /** Chain-of-thought trace, when the model emits one and the provider can segregate it. */
  reasoning: string;
  /** Token usage, when the provider reports it. */
  tokenUsage?: ProviderTokenUsage;
}

export interface ProviderHealth {
  reachable: boolean;
  models: string[];
}

/** A backend capable of running chat completions against one or more models. */
export interface AIProvider {
  /** Stable id used in registry/router logs and the normalized response ("provider" field). */
  readonly id: string;
  /**
   * Whether this backend can carry image attachments to the model. Absent =
   * false. The Router skips a provider for image-carrying requests when this
   * is not true, regardless of the model's own capabilities — "model can see"
   * and "this path to the model can see" are separate gates (e.g. a local
   * daemon serving a text-only build of an otherwise multimodal family).
   */
  readonly supportsImages?: boolean;
  /** Models currently available to run, best-effort (empty array, not a throw, when unreachable). */
  listModels(): Promise<ProviderModelInfo[]>;
  /** Cheap reachability probe used by the Router to skip a dead provider before trying models. */
  healthCheck(): Promise<ProviderHealth>;
  /**
   * Best-effort: is `model` already resident, or would this call have to
   * cold-load it first? Optional — a provider that can't answer this simply
   * omits the method, and the Router falls back to assuming every attempt is
   * warm (today's behavior unchanged). Only meaningful for a local runtime
   * that cold-loads weights; lets the Router widen the timeout budget for
   * a suspected cold load instead of killing a legitimate one prematurely.
   */
  isModelWarm?(model: string): Promise<boolean>;
  /** Single-shot completion. */
  complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult>;
  /** Token-streamed completion; yields answer text deltas (reasoning is routed separately). */
  stream(
    request: ProviderCompleteRequest,
    onReasoning?: (delta: string) => void,
  ): AsyncGenerator<string, void, unknown>;
}
