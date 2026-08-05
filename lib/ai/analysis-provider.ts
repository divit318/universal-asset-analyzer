/**
 * Analysis Provider — the seam where Ollama and Devin are interchangeable.
 *
 * The unit of work here is one STRUCTURED ANALYSIS (task + dossier prompt +
 * Zod schema), not one model completion. That is deliberate: Devin has no
 * completion endpoint — its sessions return schema-validated objects — while
 * Ollama's token-level machinery (lib/ai/provider.ts, the Router, model
 * scoring) stays untouched underneath the Ollama adapter. See
 * ai-migration/03-architecture.md §1.
 *
 * Provider selection (resolveProvider):
 *   1. AI_TASK_<NAME>_PROVIDER env pin        (mirrors the model-pin convention)
 *   2. the task registry's `provider` field   (a task can declare its home)
 *   3. AI_PROVIDER global default             (ollama | devin; default ollama)
 * GUARDRAIL: under AI_PROVIDER=devin, tasks declared latency:"interactive"
 * stay on Ollama unless explicitly pinned (rule 1/2). A human watching a
 * sub-10s spinner must never be handed a VM-backed agent session.
 */

import type { z } from "zod";
import { TASK_REGISTRY, type TaskType } from "./task-registry";

export type AnalysisProviderId = "ollama" | "devin";

export interface AnalysisRequest<T> {
  taskType: TaskType;
  /** "AAPL", "portfolio:default", "theme:grid-storage", … */
  subjectKey: string;
  /** The dossier: computed facts pushed in. House style lives in the playbook. */
  prompt: string;
  /** Tolerant PARSE schema — both providers' outputs run through this. */
  schema: z.ZodType<T>;
  /**
   * Clean constraint-carrying schema converted to Draft 7 for Devin's
   * structured_output_schema. Transforms/catches are unrepresentable in JSON
   * Schema, so a parse schema with tolerances cannot be converted — supply a
   * wire view when the parse view has them. Defaults to `schema`.
   */
  wireSchema?: z.ZodType<unknown>;
  schemaVersion: number;
  /**
   * "json" (default): the model must emit the schema's JSON.
   * "text": the task's prompt asks for prose (the pre-migration behavior of
   * free-text call sites). The Ollama adapter runs WITHOUT json mode and
   * wraps the answer as { text }, keeping those prompts byte-identical;
   * Devin still delivers through structured output using the wire schema
   * (canonically lib/ai/schemas/text.ts).
   */
  output?: "json" | "text";
  /**
   * Ollama-adapter-only: whether to request grammar-constrained JSON
   * (`format:"json"`) for a JSON-output task. Defaults to true. Exists for
   * exactly one reason: the home brief historically called `runPrompt`
   * WITHOUT the json flag and mopped up with extractJson — and "the Ollama
   * path is byte-identical" is the migration discipline, so that quirk is
   * preserved rather than silently "fixed". Meaningless to Devin, which
   * enforces the wire schema server-side either way.
   */
  ollamaJsonMode?: boolean;
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

function envProviderPin(taskType: TaskType): AnalysisProviderId | null {
  const raw = process.env[`AI_TASK_${taskType.toUpperCase().replace(/-/g, "_")}_PROVIDER`];
  return raw === "ollama" || raw === "devin" ? raw : null;
}

/** Which provider should run this task right now. Pure of I/O; env-driven. */
export function resolveProvider(taskType: TaskType): AnalysisProviderId {
  const pinned = envProviderPin(taskType);
  if (pinned) return pinned;

  const declared = TASK_REGISTRY[taskType].provider;
  if (declared && declared !== "auto") return declared;

  const global = process.env.AI_PROVIDER === "devin" ? "devin" : "ollama";
  if (global === "devin" && TASK_REGISTRY[taskType].latency === "interactive") {
    return "ollama"; // the guardrail — see module doc
  }
  return global;
}
