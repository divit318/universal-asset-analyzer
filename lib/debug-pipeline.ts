/**
 * TEMPORARY pipeline instrumentation — active only when DEBUG_PIPELINE=1.
 *
 * Emits newline-delimited JSON to data/debug-pipeline.ndjson (override with
 * DEBUG_PIPELINE_LOG). Captures per-stage timing, per-AI-call timing and
 * payload sizes, and a 5s heartbeat naming every in-flight call plus event
 * loop lag, so a stalled pipeline can be diagnosed from the log alone.
 *
 * Zero-cost when the flag is off: every entry point returns immediately.
 * To be removed (or folded into permanent structured logging) after the
 * pipeline-stall investigation.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const LOG_PATH =
  process.env.DEBUG_PIPELINE_LOG ?? join(process.cwd(), "data", "debug-pipeline.ndjson");

export function pipelineDebugEnabled(): boolean {
  return process.env.DEBUG_PIPELINE === "1";
}

let dirReady = false;

export function logPipeline(event: Record<string, unknown>): void {
  if (!pipelineDebugEnabled()) return;
  try {
    if (!dirReady) {
      mkdirSync(dirname(LOG_PATH), { recursive: true });
      dirReady = true;
    }
    appendFileSync(
      LOG_PATH,
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...event }) + "\n",
    );
  } catch {
    /* instrumentation must never break the pipeline */
  }
}

/** Rough token estimate (~4 chars/token) for payload-size logging. */
export function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

/* ----------------------------- in-flight registry ----------------------------- */

interface InFlightCall {
  desc: string;
  startedAt: number;
}

const inFlight = new Map<number, InFlightCall>();
let nextId = 1;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastBeatAt = 0;

const HEARTBEAT_MS = 5_000;

function beat(): void {
  const now = Date.now();
  const eventLoopLagMs = Math.max(0, now - lastBeatAt - HEARTBEAT_MS);
  lastBeatAt = now;
  logPipeline({
    type: "heartbeat",
    eventLoopLagMs,
    inFlightCount: inFlight.size,
    inFlight: [...inFlight.values()].map((c) => ({
      desc: c.desc,
      elapsedMs: now - c.startedAt,
    })),
  });
}

/** Register an in-flight external call; returns a handle for {@link endCall}. */
export function beginCall(desc: string): number {
  if (!pipelineDebugEnabled()) return 0;
  const id = nextId++;
  inFlight.set(id, { desc, startedAt: Date.now() });
  if (!heartbeatTimer) {
    lastBeatAt = Date.now();
    heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
    heartbeatTimer.unref?.();
  }
  return id;
}

export function endCall(id: number): void {
  if (id === 0) return;
  inFlight.delete(id);
  if (inFlight.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** Time an async stage, logging start/end/duration and item counts. */
export async function timeStage<T>(
  scope: string,
  stage: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  if (!pipelineDebugEnabled()) return fn();
  const startedAt = Date.now();
  logPipeline({ type: "stage_start", scope, stage, ...meta });
  const handle = beginCall(`${scope}:${stage}`);
  try {
    const result = await fn();
    logPipeline({
      type: "stage_end",
      scope,
      stage,
      durationMs: Date.now() - startedAt,
      ...(Array.isArray(result) ? { resultCount: result.length } : {}),
    });
    return result;
  } catch (err) {
    logPipeline({
      type: "stage_error",
      scope,
      stage,
      durationMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    endCall(handle);
  }
}
