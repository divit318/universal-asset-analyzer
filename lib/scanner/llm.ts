/**
 * Scanner v2 — shared LLM call helper for every pipeline stage.
 *
 * Centralizes three behaviours every stage needs and none should reimplement:
 *
 *   CANCELLATION   The scan's AbortSignal threads into runPrompt, so a
 *                  cancelled job stops the in-flight generation server-side
 *                  instead of leaving Ollama grinding for nobody.
 *
 *   MODEL PINNING  The pipeline resolves its model ONCE (lib/scanner/index.ts)
 *                  and every opportunity-engine call runs on it. Without the
 *                  pin, a health-cooldown mid-scan swapped one 9GB model for
 *                  another (observed 2026-07-31: a 145s cold load, plus the
 *                  original model's own reload after) — a failed call that
 *                  degrades one stage is cheaper than two swaps that slow
 *                  every remaining stage.
 *
 *   RESPONSE CACHE Identical prompts within 60 minutes return the cached
 *                  response instead of re-running minutes of inference. The
 *                  key is a content hash of (task, model, prompt), so any
 *                  change in the inputs — new headlines, different sector
 *                  list — misses naturally. Failures are never cached.
 */

import type { z } from "zod";
import { runAnalysis } from "../ai/analysis";
import { resolveProvider } from "../ai/analysis-provider";
import { LooseObjectSchema } from "../ai/schemas/loose";
import { getScannerCache, putScannerCache } from "../db";
import type { TaskType } from "../ai/task-registry";

/** Sixty minutes — matches how long a market-news snapshot stays "fresh" (lib/provenance.ts). */
const PROMPT_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Off under the test runner (same convention as lib/ai/health.ts): the stage
 * tests drive the same prompts with different scripted responses, and a
 * cache hit would hand test B test A's answer — from the real data/app.db.
 */
const CACHE_ENABLED = process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";

/** Per-scan execution context, threaded from the pipeline runner into every stage. */
export interface ScanRunContext {
  /** Cancels in-flight model calls when the job is cancelled or a stage times out. */
  signal?: AbortSignal;
  /** Model pinned for the scan's opportunity-engine calls; null → auto-route. */
  model?: string | null;
  /** Refine the current stage's work-unit total once the item count is known. */
  setUnits?: (total: number) => void;
  /** Mark one unit of stage work done; optionally name the next in-flight item. */
  tick?: (currentItem?: string) => void;
  /** Name the in-flight item without completing a unit. */
  item?: (label: string) => void;
  /** Report a fallback path taken (LLM failed, degraded output) without aborting. */
  degrade?: (reason: string) => void;
}

/** One-line reason string for degrade() reporting. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** FNV-1a — same fingerprint scheme the AI orchestrator uses for coalescing. */
function contentHash(payload: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${payload.length.toString(36)}:${h.toString(36)}`;
}

/**
 * Run one scanner stage prompt: cached, cancellable, model-pinned.
 * Throws exactly like runPrompt — stages keep their own fallback semantics.
 */
export async function scannerPrompt(
  run: ScanRunContext | undefined,
  taskType: TaskType,
  prompt: string,
  opts: { maxTokens?: number; wire?: z.ZodType<unknown>; stage?: string } = {},
): Promise<string> {
  // The pin is resolved FOR opportunity-engine; other tasks (investment-thesis
  // is `deep` and must keep its reasoning-capable routing) auto-route.
  const model = taskType === "opportunity-engine" ? (run?.model ?? undefined) : undefined;

  const cacheKey = `llm:${taskType}:${model ?? "auto"}:${contentHash(prompt)}`;
  if (CACHE_ENABLED) {
    const cached = getScannerCache(cacheKey, PROMPT_CACHE_TTL_MS);
    if (cached !== null) return cached;
  }

  // Through the analysis seam (tranche 8), keeping this wrapper's STRING
  // contract: the seam's object is re-serialized so every stage's existing
  // extractJsonObject + sanitizer parsing — and every previously cached raw
  // response — keeps working unchanged. The wire schema is what sessions
  // enforce server-side; the token stack ignores it.
  const analysis = await runAnalysis({
    taskType,
    subjectKey: `scanner:${opts.stage ?? taskType}`,
    prompt,
    schema: LooseObjectSchema,
    wireSchema: opts.wire ?? LooseObjectSchema,
    schemaVersion: SCANNER_SEAM_VERSION,
    model,
    signal: run?.signal,
  });
  const raw = JSON.stringify(analysis.data);
  // Never cache a failure — and an empty answer is a failure in JSON mode.
  if (CACHE_ENABLED && raw.trim().length > 0) putScannerCache(cacheKey, raw, PROMPT_CACHE_TTL_MS);
  return raw;
}

/**
 * Version participating in scanner idempotency keys. Bump when the seam-side
 * treatment of scanner responses changes shape.
 */
const SCANNER_SEAM_VERSION = 1;

/**
 * How many per-item calls a stage may run at once. Sequential dispatch exists
 * because Ollama serializes generations (see the pin note above); Devin
 * sessions run genuinely in parallel (validated to 40 concurrent, zero 429s —
 * ai-migration/05 amendment 2), so the loops open up when the pipeline's
 * tasks resolve there.
 */
export function scannerFanout(): number {
  return resolveProvider("opportunity-engine") === "devin"
    ? Math.max(1, Number(process.env.SCANNER_FANOUT) || 8)
    : 1;
}

/**
 * Order-preserving bounded-concurrency map for stage item loops. Results land
 * at their input index regardless of completion order, so downstream logic
 * (and progress totals) see exactly what the sequential loop produced.
 */
export async function mapWithFanout<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
