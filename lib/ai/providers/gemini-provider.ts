/**
 * Gemini Provider — direct Google Generative Language API inference.
 *
 * Fetch-based like the OpenAI-compatible providers (no SDK dependency), and
 * dormant until the user configures a key (Settings, or GEMINI_API_KEY /
 * GOOGLE_API_KEY). Health is key presence; the first real request surfaces
 * auth failures as typed errors.
 *
 * Wire mapping:
 *   - system messages → `systemInstruction`
 *   - user/assistant turns → `contents` with roles user/model
 *   - `json` → `generationConfig.responseMimeType: "application/json"`
 *   - `jsonSchema` → `generationConfig.responseJsonSchema` (native constrained
 *     decoding; requires the JSON mime type as well)
 *   - streaming → `:streamGenerateContent?alt=sse` (SSE `data:` frames)
 *
 * The key rides in the `x-goog-api-key` HEADER, never the query string, so it
 * cannot leak into a logged URL. `temperature` is accepted and ignored, same
 * documented policy as the other hosted providers.
 */

import { registryModelsFor } from "../models";
import {
  ProviderKeyInvalidError,
  ProviderKeyMissingError,
  resolveProviderKey,
} from "../keys";
import type {
  AIProvider,
  ProviderChatTurn,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
  ProviderModelInfo,
  ProviderTokenUsage,
} from "../provider";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface WireUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface WireResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: WireUsage;
}

function usageFrom(usage: WireUsage | undefined): ProviderTokenUsage | undefined {
  if (!usage) return undefined;
  return { promptTokens: usage.promptTokenCount, completionTokens: usage.candidatesTokenCount };
}

function textOf(body: WireResponse): string {
  return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

function buildBody(request: ProviderCompleteRequest): Record<string, unknown> {
  const system = request.messages
    .filter((m: ProviderChatTurn) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  if (contents.length === 0) contents.push({ role: "user", parts: [{ text: system || "Hello." }] });

  const wantsJson = Boolean(request.json || request.jsonSchema);
  return {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      ...(wantsJson ? { responseMimeType: "application/json" } : {}),
      ...(request.jsonSchema ? { responseJsonSchema: request.jsonSchema } : {}),
      ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
    },
  };
}

function throwHttpError(status: number, detail: string): never {
  if (status === 400 && /API key|API_KEY/i.test(detail)) throw new ProviderKeyInvalidError("gemini");
  if (status === 401 || status === 403) throw new ProviderKeyInvalidError("gemini");
  if (status === 429) {
    throw Object.assign(new Error("Gemini API rate limit hit (429)."), {
      code: "rate_limited" as const,
    });
  }
  throw new Error(`Gemini API error (${status}): ${detail.slice(0, 300)}`);
}

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;

  private catalogue: { ids: Set<string>; fetchedAt: number } | null = null;
  private static readonly CATALOGUE_TTL_MS = 10 * 60_000;

  private headers(key: string): Record<string, string> {
    return { "x-goog-api-key": key, "Content-Type": "application/json" };
  }

  private requestSignal(request: ProviderCompleteRequest): AbortSignal | undefined {
    const deadline = request.timeoutMs ? AbortSignal.timeout(request.timeoutMs) : undefined;
    if (request.signal && deadline) return AbortSignal.any([request.signal, deadline]);
    return request.signal ?? deadline;
  }

  /** The live catalogue (`models/<id>` names, prefix stripped), cached briefly. */
  private async liveCatalogue(key: string): Promise<Set<string>> {
    if (this.catalogue && Date.now() - this.catalogue.fetchedAt < GeminiProvider.CATALOGUE_TTL_MS) {
      return this.catalogue.ids;
    }
    try {
      const res = await fetch(`${BASE_URL}/models?pageSize=200`, {
        headers: this.headers(key),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return new Set();
      const body = (await res.json()) as { models?: { name?: string }[] };
      const ids = new Set(
        (body.models ?? []).map((m) => (m.name ?? "").replace(/^models\//, "")).filter(Boolean),
      );
      this.catalogue = { ids, fetchedAt: Date.now() };
      return ids;
    } catch {
      return new Set();
    }
  }

  /** Registry ∩ live catalogue — the registry is the policy, the catalogue the availability check. */
  async listModels(): Promise<ProviderModelInfo[]> {
    const key = resolveProviderKey("gemini");
    if (!key) return [];
    const live = await this.liveCatalogue(key);
    return registryModelsFor("gemini")
      .filter((m) => live.has(m.id))
      .map((m) => ({ id: m.id, sizeGb: 0 }));
  }

  /** Key presence, not a paid round trip. */
  async healthCheck(): Promise<ProviderHealth> {
    const key = resolveProviderKey("gemini");
    if (!key) return { reachable: false, models: [] };
    return { reachable: true, models: (await this.listModels()).map((m) => m.id) };
  }

  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    const key = resolveProviderKey("gemini");
    if (!key) throw new ProviderKeyMissingError("gemini");

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/models/${encodeURIComponent(request.model)}:generateContent`, {
        method: "POST",
        headers: this.headers(key),
        body: JSON.stringify(buildBody(request)),
        signal: this.requestSignal(request),
      });
    } catch (err) {
      throw networkError(err);
    }
    if (!res.ok) throwHttpError(res.status, await res.text().catch(() => ""));

    const body = (await res.json()) as WireResponse;
    return { content: textOf(body), reasoning: "", tokenUsage: usageFrom(body.usageMetadata) };
  }

  async *stream(request: ProviderCompleteRequest): AsyncGenerator<string, void, unknown> {
    const key = resolveProviderKey("gemini");
    if (!key) throw new ProviderKeyMissingError("gemini");

    let res: Response;
    try {
      res = await fetch(
        `${BASE_URL}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: this.headers(key),
          body: JSON.stringify(buildBody(request)),
          signal: this.requestSignal(request),
        },
      );
    } catch (err) {
      throw networkError(err);
    }
    if (!res.ok) throwHttpError(res.status, await res.text().catch(() => ""));
    if (!res.body) throw new Error("Gemini API returned no response body for a stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: ProviderTokenUsage | undefined;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const data = line.startsWith("data:") ? line.slice(5).trim() : null;
          if (!data) continue;
          let parsed: WireResponse;
          try {
            parsed = JSON.parse(data) as WireResponse;
          } catch {
            continue; // partial frame straddling a chunk boundary
          }
          const delta = textOf(parsed);
          if (delta) yield delta;
          const u = usageFrom(parsed.usageMetadata);
          if (u) usage = u;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (usage) request.onUsage?.(usage);
  }
}

function networkError(err: unknown): unknown {
  if (err instanceof DOMException) return err;
  return Object.assign(new Error("Could not reach the Gemini API (network error)."), {
    code: "network" as const,
  });
}
