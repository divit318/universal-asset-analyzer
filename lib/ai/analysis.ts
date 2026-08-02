/**
 * Analysis façade — what migrated feature code calls.
 *
 *   runAnalysis(req, { maxAgeMs })   blocking: cache → provider → cache
 *   enqueueAnalysis(req, opts)       async: job row → provider → cache; poll
 *                                    /api/ai/jobs/[id] for pending→ready UIs
 *
 * Provider choice is resolveProvider's job (env flag + guardrail); caching is
 * the ai_result table keyed (analysis_type, subject, input_hash,
 * schema_version); in-process single-flight is lib/platform/dedup.ts — the
 * same coalescer the orchestrator uses, so a concurrent identical request
 * attaches rather than re-running. After every Devin run the session sweeper
 * gets a (self-rate-limited) kick — amendment 1's backstop.
 */

import {
  analysisIdempotencyKey,
  analysisInputHash,
  resolveProvider,
  type AnalysisProvider,
  type AnalysisRequest,
  type AnalysisResult,
} from "./analysis-provider";
import { chainAnalysisProvider } from "./providers/chain-analysis";
import { devinAnalysisProvider } from "./providers/devin/provider";
import { sweepStaleSessions } from "./providers/devin/sweeper";
import { dedupe } from "../platform/dedup";
import {
  getAiJob, getAiResult, putAiResult, updateAiJob, upsertAiJob,
  type AiJobRow,
} from "../db";
import type { AnalysisProviderId } from "./analysis-provider";

export interface RunAnalysisOptions {
  /** Freshness window for the ai_result cache. Omit to skip cache reads. */
  maxAgeMs?: number;
  /** Test/DI hook. */
  providers?: Partial<Record<AnalysisProviderId, AnalysisProvider>>;
}

function providerFor(id: AnalysisProviderId, opts?: RunAnalysisOptions): AnalysisProvider {
  return opts?.providers?.[id] ?? (id === "sessions" ? devinAnalysisProvider : chainAnalysisProvider);
}

function cacheKeyOf<T>(req: AnalysisRequest<T>) {
  return {
    analysisType: req.taskType,
    subjectKey: req.subjectKey,
    inputHash: analysisInputHash(req.prompt),
    schemaVersion: req.schemaVersion,
  };
}

/** Cache read that re-validates through the request's schema — a row written
 * under a looser older parser must never crash today's consumer. */
export function readCachedAnalysis<T>(
  req: AnalysisRequest<T>,
  maxAgeMs: number,
): AnalysisResult<T> | null {
  const row = getAiResult(cacheKeyOf(req), maxAgeMs);
  if (!row) return null;
  try {
    const parsed = req.schema.safeParse(JSON.parse(row.resultJson));
    if (!parsed.success) return null;
    const meta = row.metaJson ? (JSON.parse(row.metaJson) as AnalysisResult<T>["meta"]) : { durationMs: 0 };
    // Rows written before the 2026-08-02 rename carry the legacy ids; map them.
    const provider: AnalysisProviderId =
      row.provider === "devin" || row.provider === "sessions" ? "sessions" : "chain";
    return { data: parsed.data, provider, meta };
  } catch {
    return null;
  }
}

async function execute<T>(req: AnalysisRequest<T>, opts?: RunAnalysisOptions): Promise<AnalysisResult<T>> {
  const providerId = resolveProvider(req.taskType);
  const provider = providerFor(providerId, opts);
  try {
    const result = await provider.run(req);
    putAiResult(cacheKeyOf(req), {
      provider: result.provider,
      metaJson: JSON.stringify(result.meta),
      resultJson: JSON.stringify(result.data),
    });
    return result;
  } finally {
    if (providerId === "sessions") void sweepStaleSessions().catch(() => {});
  }
}

/** Blocking run: fresh cache hit → provider → persist. */
export async function runAnalysis<T>(
  req: AnalysisRequest<T>,
  opts: RunAnalysisOptions = {},
): Promise<AnalysisResult<T>> {
  if (opts.maxAgeMs != null) {
    const cached = readCachedAnalysis(req, opts.maxAgeMs);
    if (cached) return cached;
  }
  const key = req.idempotencyKey ?? analysisIdempotencyKey(req.taskType, req.subjectKey, analysisInputHash(req.prompt), req.schemaVersion);
  // Single-flight: a concurrent identical request attaches, it does not re-run.
  return dedupe(key, (signal) => execute({ ...req, signal: req.signal ?? signal }, opts), { signal: req.signal });
}

export interface JobHandle {
  jobId: string;
  status: AiJobRow["status"];
}

/**
 * Async-first entry: record a durable job row, kick the work off in-process
 * (attached to the platform job registry), return immediately. UIs poll
 * GET /api/ai/jobs/[jobId]. Restart recovery: a `running` row whose driver
 * died re-executes on the next enqueue with the same idempotency key — the
 * Devin provider then re-attaches to the live tagged session instead of
 * creating a second one.
 */
export function enqueueAnalysis<T>(req: AnalysisRequest<T>, opts: RunAnalysisOptions = {}): JobHandle {
  const inputHash = analysisInputHash(req.prompt);
  const jobId = req.idempotencyKey ?? analysisIdempotencyKey(req.taskType, req.subjectKey, inputHash, req.schemaVersion);

  if (opts.maxAgeMs != null && readCachedAnalysis(req, opts.maxAgeMs)) {
    return { jobId, status: "succeeded" };
  }
  const existing = getAiJob(jobId);
  if (existing && (existing.status === "pending" || existing.status === "running")) {
    // Durable single-flight: dedupe coalesces in-process; if the driver died
    // with a previous process, this re-kicks it and the Devin provider
    // re-attaches to the live tagged session instead of creating a second.
    void dedupe(jobId, () => driveJob(jobId, req, opts)).catch(() => {});
    return { jobId, status: existing.status };
  }

  const providerId = resolveProvider(req.taskType);
  upsertAiJob({
    id: jobId, taskType: req.taskType, subjectKey: req.subjectKey,
    inputHash, schemaVersion: req.schemaVersion, provider: providerId, status: "pending",
  });
  void dedupe(jobId, () => driveJob(jobId, req, opts)).catch(() => {});
  return { jobId, status: "pending" };
}

async function driveJob<T>(jobId: string, req: AnalysisRequest<T>, opts: RunAnalysisOptions): Promise<void> {
  updateAiJob(jobId, { status: "running" });
  try {
    const result = await execute(req, opts);
    updateAiJob(jobId, {
      status: "succeeded",
      sessionId: result.meta.sessionId ?? null,
      sessionUrl: result.meta.sessionUrl ?? null,
      acus: result.meta.acus ?? null,
      error: null,
      finished: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const category = (err as { category?: string }).category;
    const sessionUrl = (err as { sessionUrl?: string }).sessionUrl ?? null;
    updateAiJob(jobId, {
      status: category === "timeout" ? "timeout" : category === "cancelled" ? "cancelled" : "failed",
      error: message,
      sessionUrl,
      finished: true,
    });
  }
}
