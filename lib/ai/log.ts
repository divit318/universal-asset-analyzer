/**
 * Structured AI Event Log — one machine-parseable line per routing outcome.
 *
 * Before this, a failed AI call was either silently swallowed (an empty
 * catch block commented "AI unavailable" in ai-compare.ts and friends) or
 * logged as a raw `console.error(err)` — a stack trace with no way to tell,
 * from the server log alone, whether a given failure was an environment
 * problem (Ollama unreachable, a model still cold-loading under memory
 * pressure), an application bug (a response that didn't parse), or expected
 * degraded service (every candidate model exhausted). Grepping "AI" told you
 * something happened; it never told you what kind of thing.
 *
 * Every category here maps 1:1 to {@link import("./errors").AiErrorCategory}
 * so a log line and the user-facing message for the same failure always agree.
 */

import { logPipeline } from "../debug-pipeline";

export type AiLogCategory =
  | "start"
  | "success"
  | "cancelled"
  | "timeout"
  | "network"
  | "model_missing"
  | "all_models_failed"
  | "invalid_response"
  | "grounding"
  | "unknown";

export interface AiLogEvent {
  category: AiLogCategory;
  /** The TaskType (e.g. "comparison") or a feature-level label when there's no TaskType (e.g. "grounding"). */
  taskType: string;
  model?: string;
  /** Whether the model had to cold-load before answering — see lib/ai/ollama.ts's isModelResident. */
  coldStart?: boolean;
  durationMs?: number;
  /** Time spent waiting at the generation gate before the attempt began — see lib/ai/gate.ts. */
  queueMs?: number;
  /** Short, human-readable detail — an error message, not a stack trace. */
  message?: string;
}

/** Categories that represent a real problem worth a server operator's attention. */
const ERROR_LEVEL = new Set<AiLogCategory>(["all_models_failed", "invalid_response", "unknown"]);
/** Categories that are informative but expected in normal operation (a slow host, a cold model). */
const WARN_LEVEL = new Set<AiLogCategory>(["timeout", "network", "model_missing", "grounding"]);

/**
 * Emit one structured line. Deliberately synchronous `console.*` (no queue,
 * no external sink) — this is a debugging aid for `next dev`/server logs, not
 * a telemetry pipeline. JSON so it can still be grepped/parsed either way.
 */
export function logAiEvent(event: AiLogEvent): void {
  const line = { at: new Date().toISOString(), scope: "ai", ...event };
  if (ERROR_LEVEL.has(event.category)) console.error("[ai]", JSON.stringify(line));
  else if (WARN_LEVEL.has(event.category)) console.warn("[ai]", JSON.stringify(line));
  else console.log("[ai]", JSON.stringify(line));
  // TEMPORARY (DEBUG_PIPELINE): mirror per-attempt routing outcomes into the
  // pipeline NDJSON log so model choice/cold-start/fallback are inspectable
  // alongside stage timings.
  logPipeline({ type: "ai_attempt", ...event });
}
