/**
 * OpenAI-compatible providers — direct chat-completions inference over fetch.
 *
 * One implementation serves two registered backends, because they speak the
 * same wire format:
 *
 *   - OpenAIProvider     → https://api.openai.com/v1
 *   - OpenRouterProvider → https://openrouter.ai/api/v1
 *
 * Deliberately fetch-based, no SDK dependency: the chat-completions contract
 * is small and stable, and every added dependency is supply-chain surface.
 * Both providers are dormant until the user configures a key (Settings, or
 * OPENAI_API_KEY / OPENROUTER_API_KEY) — health is key presence, exactly like
 * the Anthropic provider, and the first real request surfaces auth failures
 * as typed errors.
 *
 * ## What is deliberately NOT sent
 * - `temperature`: several current reasoning models reject non-default
 *   temperatures outright; the Router's computed value is accepted and
 *   ignored, mirroring the Anthropic provider's documented behaviour.
 * - Token caps: runPrompt() already drops maxTokens app-wide (capping
 *   mid-generation truncates JSON); when a caller does pass one it is
 *   forwarded as `max_completion_tokens`, the field modern OpenAI models
 *   accept (OpenRouter accepts both).
 *
 * `jsonSchema` maps to native structured outputs
 * (`response_format: {type: "json_schema"}`); plain `json` maps to
 * `{type: "json_object"}` with the prompt directive as the portable fallback.
 */

import { registryModelsFor, type ProviderId } from "../models";
import {
  ProviderKeyInvalidError,
  ProviderKeyMissingError,
  resolveProviderKey,
  type KeyedProviderId,
} from "../keys";
import type {
  AIProvider,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
  ProviderModelInfo,
  ProviderTokenUsage,
} from "../provider";

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

function usageFrom(usage: WireUsage | undefined | null): ProviderTokenUsage | undefined {
  if (!usage) return undefined;
  return { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };
}

/** Map an HTTP failure onto the platform's duck-typed error codes. */
function throwHttpError(provider: KeyedProviderId, status: number, detail: string): never {
  if (status === 401 || status === 403) throw new ProviderKeyInvalidError(provider);
  if (status === 429) {
    throw Object.assign(new Error(`${provider} API rate limit hit (429).`), {
      code: "rate_limited" as const,
    });
  }
  // Detail is the API's own error message — status-derived, never the key.
  throw new Error(`${provider} API error (${status}): ${detail.slice(0, 300)}`);
}

abstract class OpenAiCompatibleProvider implements AIProvider {
  abstract readonly id: KeyedProviderId & ProviderId;
  /** The chat-completions format carries images as data-URL `image_url` parts. */
  readonly supportsImages = true;
  /** Base URL up to and including the version segment, no trailing slash. */
  protected abstract baseUrl(): string;
  /** Extra headers (OpenRouter attribution). */
  protected extraHeaders(): Record<string, string> {
    return {};
  }

  private catalogue: { ids: Set<string>; fetchedAt: number } | null = null;
  private static readonly CATALOGUE_TTL_MS = 10 * 60_000;

  private headers(key: string): Record<string, string> {
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...this.extraHeaders(),
    };
  }

  /** The live model catalogue, cached briefly. Best-effort: [] on any failure. */
  private async liveCatalogue(key: string): Promise<Set<string>> {
    if (
      this.catalogue &&
      Date.now() - this.catalogue.fetchedAt < OpenAiCompatibleProvider.CATALOGUE_TTL_MS
    ) {
      return this.catalogue.ids;
    }
    try {
      const res = await fetch(`${this.baseUrl()}/models`, {
        headers: this.headers(key),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return new Set();
      const body = (await res.json()) as { data?: { id?: string }[] };
      const ids = new Set((body.data ?? []).map((m) => m.id ?? "").filter(Boolean));
      this.catalogue = { ids, fetchedAt: Date.now() };
      return ids;
    } catch {
      return new Set();
    }
  }

  /**
   * Registry ∩ live catalogue, exactly like the Devin provider: the registry
   * is the policy, the catalogue is the availability check, and a stale
   * registry id can never be routed to. Explicit model overrides and
   * AI_TASK_* env pins can still reach any live catalogue id.
   */
  async listModels(): Promise<ProviderModelInfo[]> {
    const key = resolveProviderKey(this.id);
    if (!key) return [];
    const live = await this.liveCatalogue(key);
    return registryModelsFor(this.id)
      .filter((m) => live.has(m.id))
      .map((m) => ({ id: m.id, sizeGb: 0 }));
  }

  /** Key presence, not a paid round trip — same policy as the Anthropic provider. */
  async healthCheck(): Promise<ProviderHealth> {
    const key = resolveProviderKey(this.id);
    if (!key) return { reachable: false, models: [] };
    return { reachable: true, models: (await this.listModels()).map((m) => m.id) };
  }

  private buildBody(request: ProviderCompleteRequest, stream: boolean): Record<string, unknown> {
    const responseFormat = request.jsonSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: "response", schema: request.jsonSchema, strict: true },
          },
        }
      : request.json
        ? { response_format: { type: "json_object" } }
        : {};
    // Vision input: images become data-URL `image_url` parts ahead of the
    // FINAL user turn's text — the turn that asks about them.
    const lastUserIdx = request.images?.length
      ? request.messages.reduce((acc, m, i) => (m.role === "user" ? i : acc), -1)
      : -1;
    const messages = request.messages.map((m, i) =>
      i === lastUserIdx
        ? {
            role: m.role,
            content: [
              ...(request.images ?? []).map((img) => ({
                type: "image_url" as const,
                image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
              })),
              { type: "text" as const, text: m.content },
            ],
          }
        : { role: m.role, content: m.content },
    );
    return {
      model: request.model,
      messages,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(request.maxTokens ? { max_completion_tokens: request.maxTokens } : {}),
      ...responseFormat,
    };
  }

  private requestSignal(request: ProviderCompleteRequest): AbortSignal | undefined {
    const deadline = request.timeoutMs ? AbortSignal.timeout(request.timeoutMs) : undefined;
    if (request.signal && deadline) return AbortSignal.any([request.signal, deadline]);
    return request.signal ?? deadline;
  }

  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    const key = resolveProviderKey(this.id);
    if (!key) throw new ProviderKeyMissingError(this.id);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}/chat/completions`, {
        method: "POST",
        headers: this.headers(key),
        body: JSON.stringify(this.buildBody(request, false)),
        signal: this.requestSignal(request),
      });
    } catch (err) {
      throw this.networkError(err);
    }
    if (!res.ok) throwHttpError(this.id, res.status, await res.text().catch(() => ""));

    const body = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: WireUsage;
    };
    return {
      content: body.choices?.[0]?.message?.content ?? "",
      reasoning: "",
      tokenUsage: usageFrom(body.usage),
    };
  }

  async *stream(request: ProviderCompleteRequest): AsyncGenerator<string, void, unknown> {
    const key = resolveProviderKey(this.id);
    if (!key) throw new ProviderKeyMissingError(this.id);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}/chat/completions`, {
        method: "POST",
        headers: this.headers(key),
        body: JSON.stringify(this.buildBody(request, true)),
        signal: this.requestSignal(request),
      });
    } catch (err) {
      throw this.networkError(err);
    }
    if (!res.ok) throwHttpError(this.id, res.status, await res.text().catch(() => ""));
    if (!res.body) throw new Error(`${this.id} API returned no response body for a stream.`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: ProviderTokenUsage | undefined;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are newline-delimited `data: {...}` lines.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const data = line.startsWith("data:") ? line.slice(5).trim() : null;
          if (!data || data === "[DONE]") continue;
          let parsed: {
            choices?: { delta?: { content?: string | null } }[];
            usage?: WireUsage | null;
          };
          try {
            parsed = JSON.parse(data) as typeof parsed;
          } catch {
            continue; // partial frame straddling a chunk boundary; the buffer keeps it
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
          const u = usageFrom(parsed.usage);
          if (u) usage = u;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (usage) request.onUsage?.(usage);
  }

  private networkError(err: unknown): unknown {
    // AbortSignal.timeout / caller aborts pass through for the platform's
    // abort classification; anything else is a connectivity failure.
    if (err instanceof DOMException) return err;
    return Object.assign(new Error(`Could not reach the ${this.id} API (network error).`), {
      code: "network" as const,
    });
  }
}

export class OpenAIProvider extends OpenAiCompatibleProvider {
  readonly id = "openai" as const;
  protected baseUrl(): string {
    return "https://api.openai.com/v1";
  }
}

export class OpenRouterProvider extends OpenAiCompatibleProvider {
  readonly id = "openrouter" as const;
  protected baseUrl(): string {
    return "https://openrouter.ai/api/v1";
  }
  protected extraHeaders(): Record<string, string> {
    // OpenRouter attribution headers — optional, never carry user data.
    return { "X-Title": "Universal Asset Analyzer" };
  }
}
