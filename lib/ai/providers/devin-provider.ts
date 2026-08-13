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
 *
 * ## Images ride on a scoped read (2026-08-10)
 * Print mode has no image argument, but the CLI forwards an image file the
 * agent READS as real multimodal input. So a request's images are written to
 * per-call files inside the workspace's images directory, the prompt tells
 * the agent to read them, and a vision variant of the inference config allows
 * `Read()` on exactly that directory and nothing else (see
 * ../devin-cli.ts:visionInferenceConfig — verified end-to-end against a
 * brokerage screenshot). This keeps the keyless default able to serve the
 * screenshot-import path.
 */

import { acpEnabled, DevinAcpError, streamViaDevinAcp, warmDevinAcp } from "../devin-acp";
import { checkDevinHealth, cleanDevinOutput, generateViaDevin, listAllowedModelIds } from "../devin-cli";
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
  /** Via workspace files + a scoped Read() allow — see the header note. */
  readonly supportsImages = true;

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
    // A health check means an interactive surface is about to talk to us —
    // pre-warm the ACP connection so the first streamed turn skips the ~1s
    // process spawn+initialize. Fire-and-forget, quiet on failure.
    if (reachable) warmDevinAcp();
    const registered = new Set(registryModelsFor("devin").map((m) => m.id));
    return { reachable, models: models.filter((id) => registered.has(id)) };
  }

  /**
   * Blocking completion — over the persistent ACP connection, buffered.
   *
   * Print mode (`devin -p`) used to be this method's only transport, and it
   * taxed every single blocking AI call in the app: a fresh CLI subprocess
   * (~2s spawn), no session or prompt-cache reuse, and no usage reporting.
   * Ledger evidence (2026-08-11, same task + model + prompt class):
   * fund-research 22.6s via print vs 14.1s via ACP; explain-movement,
   * portfolio-intelligence, the daily brief and the assistant all carried the
   * same tax on every click. ACP is the same authenticated backend with none
   * of it — so the buffered path now rides it too, and print mode remains
   * exactly what it is for the streaming path: the fallback for transport
   * failures and the only channel that can carry images.
   *
   * Background requests keep their concurrency cap on either transport (the
   * shared Devin work pool — see devin-cli.ts:acquireDevinSlot).
   */
  async complete(request: ProviderCompleteRequest): Promise<ProviderCompleteResult> {
    // DEVIN_ACP_DISABLED=1 means "use print mode", not "fail the provider" —
    // checked here rather than surfaced as a thrown DevinUnavailableError.
    const canAcp = acpEnabled() && (request.images?.length ?? 0) === 0;
    if (canAcp) {
      try {
        let content = "";
        let tokenUsage: ProviderCompleteResult["tokenUsage"];
        for await (const delta of streamViaDevinAcp(request.messages, {
          model: request.model,
          json: request.json,
          timeoutMs: request.timeoutMs,
          background: request.background,
          signal: request.signal,
          onUsage: (u) => {
            tokenUsage = u;
          },
        })) {
          content += delta;
        }
        // Same sanitation the print path applies (fence unwrap in json mode,
        // whitespace) — buffered consumers parse the STRING, so they must see
        // the same shape regardless of which transport produced it.
        return { content: cleanDevinOutput(content, { json: request.json }), reasoning: "", tokenUsage };
      } catch (err) {
        // Only transport-level ACP failures degrade to print mode. A caller
        // abort, timeout, or provider-side refusal is a real outcome the
        // Router must see — retrying it on a slower transport would just
        // double the wait on a request that already failed honestly.
        if (!(err instanceof DevinAcpError)) throw err;
      }
    }
    const content = await generateViaDevin(request.messages, {
      model: request.model,
      json: request.json,
      images: request.images,
      timeoutMs: request.timeoutMs,
      background: request.background,
      signal: request.signal,
    });
    return { content, reasoning: "" };
  }

  /**
   * REAL token streaming via the persistent `devin acp` connection (see
   * ../devin-acp.ts) — answer chunks as they generate, reasoning on its own
   * channel, token usage (incl. cache hits) at end of stream. Before
   * 2026-08-10 this buffered the whole print-mode answer into one chunk,
   * which made every streaming surface's TTFT equal its total latency.
   *
   * Image requests and ACP transport failures fall back to the buffered
   * print-mode path — worse latency, same correctness — so a broken ACP
   * server degrades to exactly the old behavior rather than to an error.
   */
  async *stream(
    request: ProviderCompleteRequest,
    onReasoning?: (delta: string) => void,
  ): AsyncGenerator<string, void, unknown> {
    const canAcp = acpEnabled() && (request.images?.length ?? 0) === 0;
    if (canAcp) {
      let yielded = false;
      try {
        for await (const delta of streamViaDevinAcp(request.messages, {
          model: request.model,
          json: request.json,
          timeoutMs: request.timeoutMs,
          background: request.background,
          signal: request.signal,
          onReasoning,
          onUsage: request.onUsage,
        })) {
          yielded = true;
          yield delta;
        }
        return;
      } catch (err) {
        // Only transport-level ACP failures degrade to print mode, and only
        // when nothing streamed yet — replaying a partial answer buffered
        // would duplicate content. A caller abort, timeout, or provider-side
        // refusal is a real outcome the Router must see.
        if (!(err instanceof DevinAcpError) || yielded) throw err;
      }
    }
    const { content } = await this.complete(request);
    if (content) yield content;
  }
}
