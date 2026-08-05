/**
 * POST /api/scanner/v2
 *
 * Streams pipeline progress as newline-delimited JSON (NDJSON).
 * Each line is either a ScannerProgressEvent or the final ScannerResult.
 *
 * Event types:
 *   { type: "progress", stage, message, pct, currentItem?, unitsDone?, unitsTotal? }
 *   { type: "partial",  key, data }   — a ScannerResult field ready before Assembly
 *   { type: "stage_failed", stage, reason } — a stage degraded; the scan continues
 *   { type: "stall",   stage, stalledMs, currentItem } — no progress for a while, still working
 *   { type: "result",  data: ScannerResult }
 *   { type: "error",   message }
 *   { type: "cancelled" }
 *   { type: "cached",  data: ScannerResult }
 *
 * Scans are SINGLE-FLIGHT per parameter set (lib/platform/jobs.ts): a second
 * request while one is running attaches to it — replaying its history, then
 * following live — instead of starting a competing pipeline. Two concurrent
 * scans serialized behind one backend were how every queued call burned its
 * whole timeout budget waiting (measured 2026-07-31). Disconnecting the last
 * subscriber cancels the job server-side after a short grace window, so a
 * user's Cancel genuinely stops the model, while a quick reload re-attaches.
 *
 * GET /api/scanner/v2 — runs auto-scan with default settings (no streaming).
 */

import { NextResponse } from "next/server";
import { getScannerCache } from "@/lib/db";
import { scanCacheKey, scanJobResult, startScanJob } from "@/lib/scanner/job";
import { logPipeline } from "@/lib/debug-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Only enforced on Vercel (build-time metadata, a no-op for `next dev`/self-hosted).
// This pipeline makes many sequential local-model calls (dedup, classify,
// causal chains per event, sector/company impact, thesis per opportunity) —
// 120s was far short of realistic end-to-end time on modest hardware.
export const maxDuration = 300;

interface ScanRequest {
  query?: string;
  india?: boolean;
  global?: boolean;
  noCache?: boolean;
}

const TERMINAL_TYPES = new Set(["result", "error", "cancelled"]);

export async function POST(request: Request) {
  let body: ScanRequest = {};
  try {
    body = await request.json();
  } catch {
    // Empty body — use defaults
  }

  const cacheKey = scanCacheKey(body);

  // Check server-side cache first (unless explicitly bypassed)
  if (!body.noCache) {
    const cached = getScannerCache(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify({ type: "cached", data: JSON.parse(cached) }) + "\n",
        {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-store",
          },
        },
      );
    }
  }

  const job = startScanJob(body);
  logPipeline({
    type: "scan_request_start",
    jobId: job.id,
    attached: job.attached,
    cacheKey,
    noCache: body.noCache ?? false,
  });

  const encoder = new TextEncoder();
  let detach: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        detach?.();
        try {
          controller.close();
        } catch {
          // Already errored/cancelled — nothing left to close.
        }
      };

      detach = job.subscribe((event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Client is gone — stop delivering; the registry's grace timer
          // decides whether the job itself should be cancelled.
          finish();
          return;
        }
        if (TERMINAL_TYPES.has((event as { type?: string }).type ?? "")) finish();
      });

      // Detaching on disconnect is what lets the registry cancel abandoned
      // work: last subscriber out starts the grace timer.
      request.signal.addEventListener("abort", () => {
        logPipeline({ type: "scan_client_disconnected", jobId: job.id });
        finish();
      });
    },
    cancel() {
      detach?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** GET — auto-scan, returns ScannerResult directly (non-streaming, for simple clients). */
export async function GET() {
  const cached = getScannerCache(scanCacheKey({ india: true, global: true }));
  if (cached) {
    return NextResponse.json({ ...JSON.parse(cached), fromCache: true });
  }

  try {
    // Detached: a simple client polling GET must not cancel a scan other
    // subscribers (or the scheduler) are relying on by disconnecting.
    const job = startScanJob({ india: true, global: true }, { detached: true });
    return NextResponse.json(await scanJobResult(job));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
