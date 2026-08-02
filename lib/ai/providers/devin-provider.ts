/**
 * Devin Provider — hosted inference through the Devin CLI.
 *
 * Wraps the process layer (../devin-cli.ts) behind the provider-agnostic
 * {@link AIProvider} interface, exactly as OllamaProvider wraps ../ollama.ts.
 * The Router does not know these models run in a subprocess against a hosted
 * API rather than against a daemon on localhost.
 *
 * ## Two honest gaps versus OllamaProvider
 *
 *   1. **No temperature / maxTokens / numCtx.** `devin -p` exposes no sampling
 *      controls. They are accepted and ignored rather than faked. In practice
 *      the tasks that cared were the JSON ones (nl-screener pins temperature
 *      0.1 for determinism), and the frontier models return clean JSON at
 *      their defaults — but this is a real behavioural difference, not a
 *      formality, and it belongs in the diff rather than in a surprise later.
 *   2. **No token streaming.** Print mode buffers the whole answer, so
 *      `stream()` yields exactly one chunk. That is a deliberate trade: the
 *      full answer arrives in 4-8s against 28-115s for Ollama's *first* token,
 *      so every streaming caller still gets its content sooner, just without
 *      the typewriter effect. `devin acp` (JSON-RPC over stdio) is the upgrade
 *      path if the UX turns out to need real deltas.
 *
 * Reasoning is likewise not exposed: the hosted models' chain-of-thought never
 * reaches stdout, so `reasoning` is always "". Callers already treat it as
 * optional (see normalizeResponse), and returning an empty string is honest
 * where fabricating a summary from the answer would not be.
 */

import {
  checkDevinHealth,
  generateViaDevin,
  listAllowedModelIds,
} from "../devin-cli";
import { MODEL_REGISTRY } from "../models";
import type {
  AIProvider,
  ProviderCompleteRequest,
  ProviderCompleteResult,
  ProviderHealth,
  ProviderModelInfo,
} from "../provider";

export class DevinProvider implements AIProvider {
  readonly id = "devin" as const;

  /**
   * Models this provider will route to: the curated registry entries that the
   * account is actually allowed to run.
   *
   * Deliberately an intersection rather than the raw catalogue. `devin models
   * list` returns ~170 variants across 37 families; handing all of them to the
   * Router would mean scoring 170 models — nearly all of which resolve to
   * genericSpec (quality 3, no capabilities) — on every request. Routing would
   * become both slow and arbitrary. The registry is the policy; the catalogue
   * is the availability check.
   *
   * `sizeGb: 0` is meaningful, not a placeholder: it is how a hosted model
   * declares itself exempt from the Router's memory gate (see fitsInMemory).
   */
  async listModels(): Promise<ProviderModelInfo[]> {
    const allowed = new Set(await listAllowedModelIds());
    if (allowed.size === 0) return [];
    return MODEL_REGISTRY.filter((m) => m.provider === "devin" && allowed.has(m.id)).map((m) => ({
      id: m.id,
      sizeGb: 0,
    }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    const { reachable, models } = await checkDevinHealth();
    const registered = new Set(MODEL_REGISTRY.filter((m) => m.provider === "devin").map((m) => m.id));
    return { reachable, models: models.filter((id) => registered.has(id)) };
  }

  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    const content = await generateViaDevin(request.messages, {
      model: request.model,
      json: request.json,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
    });
    return { content, reasoning: "" };
  }

  /**
   * Single-chunk "stream". See the gap note at the top of this file — print
   * mode has no incremental output, so the choice is one chunk at the end or
   * no Devin support for streaming callers at all.
   */
  async *stream(request: ProviderCompleteRequest): AsyncGenerator<string, void, unknown> {
    const { content } = await this.complete(request);
    if (content) yield content;
  }
}
