/**
 * POST /api/scanner/v2
 *
 * Streams pipeline progress as newline-delimited JSON (NDJSON).
 * Each line is either a ScannerProgressEvent or the final ScannerResult.
 *
 * Event types:
 *   { type: "progress", stage, message, pct }
 *   { type: "result",   data: ScannerResult }
 *   { type: "error",    message }
 *   { type: "cached",   data: ScannerResult }
 *
 * GET /api/scanner/v2 — runs auto-scan with default settings (no streaming).
 */

import { NextResponse } from "next/server";
import { runScannerPipeline } from "@/lib/scanner/index";
import { getScannerCache, putScannerCache } from "@/lib/db";
import type { ScannerProgressEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ScanRequest {
  query?: string;
  india?: boolean;
  global?: boolean;
  noCache?: boolean;
}

function buildCacheKey(req: ScanRequest): string {
  const { query = "", india = true, global: glob = true } = req;
  return `v2:${query.toLowerCase().trim()}:${india}:${glob}`;
}

export async function POST(request: Request) {
  let body: ScanRequest = {};
  try {
    body = await request.json();
  } catch {
    // Empty body — use defaults
  }

  const cacheKey = buildCacheKey(body);

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

  const { query, india = true, global: glob = true } = body;

  // Stream the pipeline progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendLine(obj: object) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      }

      function onProgress(event: ScannerProgressEvent) {
        sendLine({ type: "progress", ...event });
      }

      try {
        const result = await runScannerPipeline({
          query,
          india,
          global: glob,
          onProgress,
        });

        // Persist to server-side cache
        try {
          putScannerCache(cacheKey, JSON.stringify(result));
        } catch {
          // Cache failure is non-fatal
        }

        sendLine({ type: "result", data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Pipeline failed";
        sendLine({ type: "error", message });
      } finally {
        controller.close();
      }
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
  const cacheKey = buildCacheKey({ india: true, global: true });

  const cached = getScannerCache(cacheKey);
  if (cached) {
    return NextResponse.json({ ...JSON.parse(cached), fromCache: true });
  }

  try {
    const result = await runScannerPipeline({ india: true, global: true });
    putScannerCache(cacheKey, JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
