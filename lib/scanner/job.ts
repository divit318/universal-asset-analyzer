/**
 * Scanner v2 — single-flight scan jobs.
 *
 * The one place a scan is started. Both entry points (the /api/scanner/v2
 * route and the background scheduler) go through startScanJob, so identical
 * parameter sets share ONE running pipeline via the platform job registry
 * (lib/platform/jobs.ts) instead of racing each other for the same result.
 */

import { runScannerPipeline } from "./index";
import { persistScannerSnapshot } from "./cache";
import { getScannerCache, putScannerCache } from "../db";
import { startOrAttachJob, type JobHandle } from "../platform/jobs";
import type { ScannerResult } from "../types";

export interface ScanParams {
  query?: string;
  india?: boolean;
  global?: boolean;
}

/** Same key for the route's cache rows and the registry's job identity. */
export function scanCacheKey(params: ScanParams): string {
  const { query = "", india = true, global: glob = true } = params;
  return `v2:${query.toLowerCase().trim()}:${india}:${glob}`;
}

/**
 * How long a DEGRADED scan result may be served from cache. Long enough that
 * a reload right after the scan re-attaches to the same answer instead of
 * launching a second multi-minute pipeline; short enough that the failure is
 * re-tested promptly. A clean result keeps the standard 15-minute TTL.
 *
 * This asymmetry is the fix for a measured failure (2026-08-07): a scan whose
 * every LLM call died on an exhausted provider quota completed — degraded —
 * in seconds, was cached like a clean run, and kept being re-served for 15
 * minutes after the provider had already recovered.
 */
export const DEGRADED_SCAN_TTL_MS = 60_000;

/**
 * Read a cached ScannerResult, applying the degraded-aware TTL. Returns null
 * (a cache miss) for an unparseable row or a degraded row past its short TTL.
 */
export function readCachedScan(cacheKey: string): ScannerResult | null {
  const raw = getScannerCache(cacheKey);
  if (!raw) return null;
  let result: ScannerResult;
  try {
    result = JSON.parse(raw) as ScannerResult;
  } catch {
    return null;
  }
  if ((result.stageFailures?.length ?? 0) === 0) return result;
  return getScannerCache(cacheKey, DEGRADED_SCAN_TTL_MS) !== null ? result : null;
}

/** Start (or attach to) the single-flight scan job for these parameters. */
export function startScanJob(params: ScanParams, opts: { detached?: boolean } = {}): JobHandle {
  const cacheKey = scanCacheKey(params);
  const { query, india = true, global: glob = true } = params;
  return startOrAttachJob<ScannerResult>(
    `scanner:${cacheKey}`,
    async (signal, emit) => {
      const result = await runScannerPipeline({
        query,
        india,
        global: glob,
        signal,
        // Detached = nobody is watching: run gently so the batch never
        // competes with interactive surfaces for the host (see
        // ScannerPipelineOptions.background). A user attaching later still
        // gets the shared job's replay, just from a slower-walking scan.
        background: opts.detached === true,
        onProgress: (event) => emit({ type: "progress", ...event }),
        onPartial: (event) => emit({ type: "partial", ...event }),
        onStageEvent: (event) => emit(event), // already carries its own type tag
      });
      // Persist once per job, not per subscriber.
      try {
        putScannerCache(cacheKey, JSON.stringify(result));
        // Only the default (no custom query) auto-scan updates the
        // long-lived snapshot other features (Mission Control, Knowledge
        // Graph) read as "the last general market scan" — and only a CLEAN
        // one. A degraded result (empty opportunities/themes/impacts) must
        // not clobber the last good snapshot those features depend on.
        if (!query && (result.stageFailures?.length ?? 0) === 0) persistScannerSnapshot(result);
      } catch {
        // Cache failure is non-fatal
      }
      return result;
    },
    (result) => ({ type: "result", data: result }),
    (message, cancelled) => (cancelled ? { type: "cancelled" } : { type: "error", message }),
    { detached: opts.detached },
  );
}

/** Await a job's terminal event as a plain promise (for non-streaming callers). */
export function scanJobResult(job: JobHandle): Promise<ScannerResult> {
  return new Promise<ScannerResult>((resolve, reject) => {
    job.subscribe((event) => {
      const e = event as { type?: string; data?: ScannerResult; message?: string };
      if (e.type === "result" && e.data) resolve(e.data);
      else if (e.type === "error") reject(new Error(e.message ?? "Scan failed"));
      else if (e.type === "cancelled") reject(new Error("Scan cancelled"));
    });
  });
}
