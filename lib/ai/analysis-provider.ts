/**
 * Analysis Provider — the seam a structured analysis runs behind.
 *
 * One runtime implements it today:
 *
 *   "chain" — one completion through the Router's provider chain
 *             (lib/ai/providers/chain-analysis.ts), i.e. the Anthropic API at
 *             the effort tier the task's pin selects. This is the default for
 *             everything.
 *
 * The seam itself (AnalysisRequest/AnalysisResult, cache keys, idempotency)
 * outlives any particular runtime: the ai_result cache, the job rows, and the
 * per-request single-flight all key off it. The former "sessions" runtime
 * (Devin sessions API) was removed with that provider; cached rows written by
 * it are still readable (lib/ai/analysis.ts maps legacy provider ids).
 *
 * (AI_TASK_<NAME>_PROVIDER and the old AI_PROVIDER flag are retired along
 * with the second runtime; stale values in .env.local are ignored.)
 *
 * Merge resolution (origin/main → f22/day-change, 2026-08-06): main still
 * carried the two-runtime version of this header and resolver; this branch's
 * single-runtime contract wins because the sessions provider code no longer
 * exists here (tests/ai-analysis-provider.test.ts pins this).
 */

import type { z } from "zod";
import type { TaskType } from "./task-registry";

export type AnalysisProviderId = "chain";

export interface AnalysisRequest<T> {
  taskType: TaskType;
  /** "AAPL", "portfolio:default", "theme:grid-storage", … */
  subjectKey: string;
  /** The dossier: computed facts pushed in. House style lives in the playbook. */
  prompt: string;
  /** Tolerant PARSE schema — both providers' outputs run through this. */
  schema: z.ZodType<T>;
  /**
   * Clean constraint-carrying schema converted to Draft 7 for the sessions
   * API's structured_output_schema. Transforms/catches are unrepresentable in
   * JSON Schema, so a parse schema with tolerances cannot be converted —
   * supply a wire view when the parse view has them. Defaults to `schema`.
   */
  wireSchema?: z.ZodType<unknown>;
  schemaVersion: number;
  /**
   * "json" (default): the model must emit the schema's JSON.
   * "text": the task's prompt asks for prose. The chain adapter runs WITHOUT
   * json mode and wraps the answer as { text }; the sessions provider still
   * delivers { text } through structured output (lib/ai/schemas/text.ts).
   */
  output?: "json" | "text";
  /**
   * Explicit model override, forwarded to the Router (skips auto-routing).
   * Merge resolution 2026-08-06: main's call sites (IC agents/synthesis/
   * thesis, valuation inputs) pass this; the chain adapter forwards it to
   * runTask's existing `model` option.
   */
  model?: string;
  /** Defaults to hash(taskType, subjectKey, inputHash, schemaVersion). */
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AnalysisMeta {
  model?: string;
  sessionId?: string;
  sessionUrl?: string;
  durationMs: number;
  acus?: number | null;
}

export interface AnalysisResult<T> {
  data: T;
  provider: AnalysisProviderId;
  meta: AnalysisMeta;
}

export interface AnalysisProvider {
  readonly id: AnalysisProviderId;
  run<T>(req: AnalysisRequest<T>): Promise<AnalysisResult<T>>;
  healthCheck(): Promise<{ reachable: boolean; detail?: string }>;
}

/** FNV-1a — same family as the orchestrator's coalescing fingerprint. */
export function fnv1a(payload: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function analysisInputHash(prompt: string): string {
  return `${prompt.length.toString(36)}-${fnv1a(prompt)}`;
}

export function analysisIdempotencyKey(
  taskType: TaskType,
  subjectKey: string,
  inputHash: string,
  schemaVersion: number,
): string {
  return `ai:${taskType}:${fnv1a(`${subjectKey}\u0000${inputHash}\u0000${schemaVersion}`)}`;
}

/**
 * Which runtime runs this task. One answer today — kept as a function (with
 * its TaskType parameter) because analysis.ts records the resolved id on job
 * rows and cached results, and a second runtime would slot back in here.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function resolveProvider(_taskType: TaskType): AnalysisProviderId {
  return "chain";
}
