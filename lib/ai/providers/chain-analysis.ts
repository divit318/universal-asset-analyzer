/**
 * ChainAnalysisProvider — one completion through the Router's provider chain.
 *
 * A thin adapter: `runTask` (orchestrator → router → the provider chain) then
 * the shared JSON extraction, then the caller's Zod schema. The chain is the
 * Anthropic API today; this adapter neither knows nor cares — the effort tier
 * that answered is in `meta.model`.
 */

import type { AnalysisProvider, AnalysisRequest, AnalysisResult } from "../analysis-provider";
import { runTask } from "../orchestrator";
import { keyStatus } from "../anthropic-key";
import { extractJson } from "../../json-extract";

export class ChainAnalysisError extends Error {
  constructor(
    public category: "invalid_response" | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "ChainAnalysisError";
  }
}

export class ChainAnalysisProvider implements AnalysisProvider {
  readonly id = "chain" as const;

  async healthCheck(): Promise<{ reachable: boolean; detail?: string }> {
    // Key presence, not a paid round trip — the same policy as the provider's
    // own healthCheck (see anthropic-provider.ts): the first real request
    // surfaces auth/network failures with a far better error than a probe.
    const { configured } = keyStatus();
    return {
      reachable: configured,
      detail: configured ? undefined : "no Anthropic API key is configured (add one in Settings)",
    };
  }

  async run<T>(req: AnalysisRequest<T>): Promise<AnalysisResult<T>> {
    const t0 = Date.now();
    const textMode = req.output === "text";
    const response = await runTask(req.taskType, req.prompt, {
      // Text-mode call sites (financial insight, calendar brief) never asked
      // for JSON pre-migration; forcing it would change their output.
      json: !textMode,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
    });

    let raw: unknown;
    if (textMode) {
      raw = { text: response.content.trim() };
    } else {
      try {
        raw = extractJson<unknown>(response.content);
      } catch {
        throw new ChainAnalysisError("invalid_response", "model response contained no parseable JSON");
      }
    }
    // Schemas encode the small-model tolerances (defaults, coercions) that
    // extractJsonObject used to provide per call site — see lib/ai/schemas/.
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ChainAnalysisError("invalid_response", `model output failed schema validation: ${issues}`);
    }
    return {
      data: parsed.data,
      provider: "chain",
      meta: { model: response.model, durationMs: Date.now() - t0 },
    };
  }
}

export const chainAnalysisProvider = new ChainAnalysisProvider();
