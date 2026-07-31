/**
 * Scanner v2 — single-flight scan jobs.
 *
 * The one place a scan is started. Both entry points (the /api/scanner/v2
 * route and the background scheduler) go through startScanJob, so identical
 * parameter sets share ONE running pipeline via the platform job registry
 * (lib/platform/jobs.ts) instead of racing each other for the local model.
 */

import { runScannerPipeline } from "./index";
import { persistScannerSnapshot } from "./cache";
import { putScannerCache } from "../db";
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
        onProgress: (event) => emit({ type: "progress", ...event }),
        onPartial: (event) => emit({ type: "partial", ...event }),
        onStageEvent: (event) => emit(event), // already carries its own type tag
      });
      // Persist once per job, not per subscriber.
      try {
        putScannerCache(cacheKey, JSON.stringify(result));
        // Only the default (no custom query) auto-scan updates the
        // long-lived snapshot other features (Mission Control, Knowledge
        // Graph) read as "the last general market scan."
        if (!query) persistScannerSnapshot(result);
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
