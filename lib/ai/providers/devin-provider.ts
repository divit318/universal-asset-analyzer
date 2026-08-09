/**
 * Devin Provider — hosted inference through the Devin CLI (`devin -p`).
 *
 * Wraps the process layer (../devin-cli.ts) behind the provider-agnostic
 * {@link AIProvider} interface. The Router does not know these models run in
 * a subprocess against Cognition's hosted API rather than over HTTPS.
 *
 * ## Why this provider exists (restored 2026-08-06)
 * It needs NO API key: authentication is the user's own `devin login`, so AI
 * works out of the box on any machine with the CLI installed — the default
 * head of the provider chain (lib/ai/config.ts). The Claude effort tiers the
 * task pins name (`claude-opus-5-low|medium|high`) exist in Devin's own
 * catalogue under the same uids, so the pins resolve through Devin first and
 * fall back to the direct Anthropic API only when a key is configured.
 *
 * ## Two honest gaps versus the API providers
 *
 *   1. **No sampling controls, no native structured outputs.** `devin -p`
 *      exposes no temperature/maxTokens and no schema-constrained decoding.
 *      They are accepted and ignored rather than faked; `json` rides on the
 *      prompt directive (../devin-cli.ts:flattenMessages), and the platform's
 *      tolerant parse + Zod validation remain the guarantee.
 *   2. **No token streaming.** Print mode buffers the whole answer, so
 *      `stream()` yields exactly one chunk. Deliberate trade: the full answer
 *      arrives in seconds (measured 8.9s for a light JSON task, 2026-08-06),
 *      so streaming callers still get their content promptly, just without
 *      the typewriter effect.
 *
 * Reasoning is likewise not exposed: hosted chain-of-thought never reaches
 * stdout, so `reasoning` is always "". Token usage is not reported (Devin
 * bills ACUs, not tokens) — telemetry records the call with null cost.
 */

import { checkDevinHealth, generateViaDevin, listAllowedModelIds } from "../devin-cli";
import { registryModelsFor } from "../models";
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
   * Models this provider will route to: the curated registry entries (its own
   * plus the `alsoServedBy: ["devin"]` Claude tiers) that the account's live
   * catalogue actually allows.
   *
   * Deliberately an intersection rather than the raw catalogue. `devin models
   * list` returns ~170 variants across dozens of families; handing all of
   * them to the Router would mean scoring 170 models — nearly all resolving
   * to genericSpec (quality 3, no capabilities) — on every request. The
   * registry is the policy; the catalogue is the availability check. An
   * explicit user/env model override can still name any live catalogue id.
   *
   * `sizeGb: 0` is meaningful, not a placeholder: it is how a hosted model
   * declares itself exempt from the Router's memory gate (see fitsInMemory).
   */
  async listModels(): Promise<ProviderModelInfo[]> {
    const allowed = new Set(await listAllowedModelIds());
    if (allowed.size === 0) return [];
    return registryModelsFor("devin")
      .filter((m) => allowed.has(m.id))
      .map((m) => ({ id: m.id, sizeGb: 0 }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    const { reachable, models } = await checkDevinHealth();
    const registered = new Set(registryModelsFor("devin").map((m) => m.id));
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
