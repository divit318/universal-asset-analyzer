/**
 * OllamaAnalysisProvider — the existing local stack behind the analysis seam.
 *
 * A thin adapter: `runTask` (orchestrator → router → OllamaProvider) exactly
 * as every call site uses it today, then the shared JSON extraction, then the
 * caller's Zod schema. Nothing below this file changes — the Router, model
 * registry, health tracking, and streaming paths are untouched, which is what
 * keeps AI_PROVIDER=ollama bit-for-bit equivalent to the pre-migration app.
 */

import type { AnalysisProvider, AnalysisRequest, AnalysisResult } from "../analysis-provider";
import { runTask } from "../orchestrator";
import { checkHealth } from "../ollama";
import { extractJson } from "../../json-extract";

export class OllamaAnalysisError extends Error {
  constructor(
    public category: "invalid_response" | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "OllamaAnalysisError";
  }
}

export class OllamaAnalysisProvider implements AnalysisProvider {
  readonly id = "ollama" as const;

  async healthCheck(): Promise<{ reachable: boolean; detail?: string }> {
    const h = await checkHealth();
    return { reachable: h.reachable, detail: h.reachable ? undefined : "Ollama daemon unreachable" };
  }

  async run<T>(req: AnalysisRequest<T>): Promise<AnalysisResult<T>> {
    const t0 = Date.now();
    const textMode = req.output === "text";
    const response = await runTask(req.taskType, req.prompt, {
      // Text-mode call sites (financial insight, calendar brief) never asked
      // Ollama for JSON pre-migration; forcing it would change their output.
      // ollamaJsonMode preserves the same discipline for the one JSON call
      // site (home brief) that historically ran unconstrained.
      json: !textMode && (req.ollamaJsonMode ?? true),
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
        throw new OllamaAnalysisError("invalid_response", "model response contained no parseable JSON");
      }
    }
    // Schemas encode the small-model tolerances (defaults, coercions) that
    // extractJsonObject used to provide per call site — see lib/ai/schemas/.
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new OllamaAnalysisError("invalid_response", `model output failed schema validation: ${issues}`);
    }
    return {
      data: parsed.data,
      provider: "ollama",
      meta: { model: response.model, durationMs: Date.now() - t0 },
    };
  }
}

export const ollamaAnalysisProvider = new OllamaAnalysisProvider();
