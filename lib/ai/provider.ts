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

export interface ProviderCompleteRequest {
  model: string;
  messages: ProviderChatTurn[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Ask the model to respond with JSON only. */
  json?: boolean;
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
   * Provider-agnostic hint; Ollama maps it to `keep_alive`. Omit for the
   * provider's default.
   */
  keepAlive?: string;
  signal?: AbortSignal;
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
  tokenUsage?: { promptTokens?: number; completionTokens?: number };
}

export interface ProviderHealth {
  reachable: boolean;
  models: string[];
}

/** A backend capable of running chat completions against one or more models. */
export interface AIProvider {
  /** Stable id used in registry/router logs and the normalized response ("provider" field). */
  readonly id: string;
  /** Models currently available to run, best-effort (empty array, not a throw, when unreachable). */
  listModels(): Promise<ProviderModelInfo[]>;
  /** Cheap reachability probe used by the Router to skip a dead provider before trying models. */
  healthCheck(): Promise<ProviderHealth>;
  /** Single-shot completion. */
  complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult>;
  /** Token-streamed completion; yields answer text deltas (reasoning is routed separately). */
  stream(
    request: ProviderCompleteRequest,
    onReasoning?: (delta: string) => void,
  ): AsyncGenerator<string, void, unknown>;
}
