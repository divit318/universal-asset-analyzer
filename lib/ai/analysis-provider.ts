/**
 * Analysis Provider — the seam that decides HOW a structured analysis runs.
 *
 * Two runtimes implement it, and since 2026-08-02 BOTH are Devin-primary:
 *
 *   "chain"    — one completion through the Router's provider chain
 *                (lib/ai/providers/chain-analysis.ts). The chain leads with
 *                the hosted Devin CLI models and falls back to local Ollama
 *                (AI_PROVIDER_ORDER; per-task models in TASK_MODEL_PINS).
 *                4-25s. This is the default for anything a human waits on.
 *   "sessions" — one Devin sessions-API run per analysis
 *                (lib/ai/providers/devin/provider.ts): platform-validated
 *                structured output, a corrective turn, tag-idempotency,
 *                per-session ACU caps, unbounded fan-out. ~20-50s. The
 *                default for background pipelines, where those guarantees
 *                are worth more than the extra seconds.
 *
 * Selection (resolveProvider):
 *   1. AI_TASK_<NAME>_PROVIDER env pin — "chain" | "sessions"
 *      (legacy aliases accepted: "ollama"→chain, "devin"→sessions)
 *   2. the task registry's `provider` field
 *   3. default policy: latency:"background" → sessions; everything else → chain
 *
 * The old AI_PROVIDER global flag is RETIRED (it predates the chain and its
 * two meanings — seam choice vs local-only — kept colliding). Local-only is
 * AI_PROVIDER_ORDER=ollama; seam choice is per task.
 */

import type { z } from "zod";
import { TASK_REGISTRY, type TaskType } from "./task-registry";

export type AnalysisProviderId = "chain" | "sessions";

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

function normalizeProviderId(raw: string | undefined): AnalysisProviderId | null {
  switch (raw) {
    case "chain":
    case "ollama": // legacy alias from the pre-chain flag vocabulary
      return "chain";
    case "sessions":
    case "devin": // legacy alias
      return "sessions";
    default:
      return null;
  }
}

/** Which runtime should run this task right now. Pure of I/O; env-driven. */
export function resolveProvider(taskType: TaskType): AnalysisProviderId {
  const pinned = normalizeProviderId(
    process.env[`AI_TASK_${taskType.toUpperCase().replace(/-/g, "_")}_PROVIDER`],
  );
  if (pinned) return pinned;

  const task = TASK_REGISTRY[taskType];
  const declared = normalizeProviderId(task.provider === "auto" ? undefined : task.provider);
  if (declared) return declared;

  // Background pipelines get the sessions runtime's guarantees (validated
  // output, corrective turn, fan-out, ACU caps); everything a human waits on
  // gets the chain's 4-25s completions. Both are Devin-primary.
  return task.latency === "background" ? "sessions" : "chain";
}
