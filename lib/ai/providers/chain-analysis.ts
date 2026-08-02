/**
 * ChainAnalysisProvider — one completion through the Router's provider chain.
 *
 * A thin adapter: `runTask` (orchestrator → router → the provider chain) then
 * the shared JSON extraction, then the caller's Zod schema. Since the chain
 * default became hosted-first (2026-08-02), the completion this runs is
 * normally served by a Devin CLI model from TASK_MODEL_PINS, falling back to
 * local Ollama when hosted is unreachable — this adapter neither knows nor
 * cares; the model that answered is in `meta.model`.
 */

import type { AnalysisProvider, AnalysisRequest, AnalysisResult } from "../analysis-provider";
import { runTask } from "../orchestrator";
import { checkHealth } from "../ollama";
import { checkDevinHealth } from "../devin-cli";
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
    const [devin, ollama] = await Promise.all([checkDevinHealth(), checkHealth()]);
    const reachable = devin.reachable || ollama.reachable;
    return {
      reachable,
      detail: reachable ? undefined : "neither the Devin CLI nor the Ollama daemon is reachable",
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
