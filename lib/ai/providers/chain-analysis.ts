/**
 * ChainAnalysisProvider — one completion through the Router's provider chain.
 *
 * A thin adapter: `runTask` (orchestrator → router → the provider chain) then
 * the shared JSON extraction, then the caller's Zod schema. The chain is the
 * Anthropic API today; this adapter neither knows nor cares — the effort tier
 * that answered is in `meta.model`.
 */

import { z } from "zod";
import type { AnalysisProvider, AnalysisRequest, AnalysisResult } from "../analysis-provider";
import { runTask } from "../orchestrator";
import { keyStatus } from "../anthropic-key";
import { extractJson } from "../../json-extract";

/**
 * Compile a request's wire schema (the clean, constraint-carrying Zod view —
 * no transforms/catches) to JSON Schema for native structured outputs.
 *
 * Best-effort by design: a schema Zod cannot represent as JSON Schema, or a
 * request without a wireSchema, returns undefined and the call proceeds
 * exactly as before (JSON prompt directives + extraction + tolerant parse).
 * The tolerant `schema` parse still runs REGARDLESS — constrained decoding
 * guarantees syntax and structure, while the tolerant view also carries the
 * semantic guards (min lengths, ranges) and the defaults old cached rows need.
 */
export function wireJsonSchema(wireSchema: z.ZodType<unknown> | undefined): Record<string, unknown> | undefined {
  if (!wireSchema) return undefined;
  try {
    return z.toJSONSchema(wireSchema) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

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
      // Native structured outputs whenever the call site supplied a clean wire
      // schema. Prompt directives stay in the prompt as the portable fallback.
      jsonSchema: textMode ? undefined : wireJsonSchema(req.wireSchema),
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
