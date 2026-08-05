/**
 * AI Telemetry — the persistent ledger behind every routing decision.
 *
 * One row per provider ATTEMPT (success or failure), written by the Router at
 * the same moments it emits a log line. Where lib/ai/log.ts answers "what just
 * happened" on a scrolling console, this answers the questions a policy is
 * tuned against: what does each task cost, how often does the prompt cache
 * hit, what is p95 latency per model, how deep does the fallback chain run.
 *
 * Costs are ESTIMATES — registry pricing × provider-reported usage — for
 * review and tuning, never billing truth. The console remains the operator's
 * real-time view; this is the instrument panel (/dev/ai reads it).
 *
 * Recording must never break an AI call: every write is wrapped, and a ledger
 * failure degrades to a warn line. Vitest runs skip recording unless a test
 * opts in (AI_TELEMETRY_IN_TESTS=1) so router tests that never set DB_PATH
 * cannot write to a developer's real database.
 */

import { insertAiCall, listAiCalls, type AiCallRecord } from "../db";
import { specForInstalled, type ModelPricing } from "./models";
import type { ProviderTokenUsage } from "./provider";
import type { AiLogCategory } from "./log";

export interface AiCallEvent {
  taskType: string;
  provider: string;
  model: string;
  outcome: AiLogCategory;
  streamed: boolean;
  /** 1-based position in the fallback chain (1 = first-choice model). */
  attempt: number;
  durationMs?: number;
  queueMs?: number;
  ttftMs?: number;
  usage?: ProviderTokenUsage;
  message?: string;
}

/**
 * Estimated wire cost of one completion in USD, or null when the model has no
 * registry pricing or the provider reported no usage. Pure — unit-testable
 * without a database.
 */
export function estimateCostUsd(model: string, usage: ProviderTokenUsage | undefined): number | null {
  if (!usage) return null;
  const pricing: ModelPricing | undefined = specForInstalled(model).pricing;
  if (!pricing) return null;
  const { promptTokens = 0, completionTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0 } = usage;
  if (promptTokens + completionTokens + cacheCreationTokens + cacheReadTokens === 0) return null;
  return (
    (promptTokens * pricing.inputPerMTok +
      completionTokens * pricing.outputPerMTok +
      cacheCreationTokens * pricing.cacheWritePerMTok +
      cacheReadTokens * pricing.cacheReadPerMTok) /
    1_000_000
  );
}

/** See the module comment — tests must opt in so they can't write a real DB. */
function recordingEnabled(): boolean {
  if (process.env.VITEST && process.env.AI_TELEMETRY_IN_TESTS !== "1") return false;
  return process.env.AI_TELEMETRY !== "off";
}

/** Persist one attempt. Never throws — a ledger failure must not fail the call. */
export function recordAiCall(event: AiCallEvent): void {
  if (!recordingEnabled()) return;
  try {
    insertAiCall({
      at: Date.now(),
      taskType: event.taskType,
      provider: event.provider,
      model: event.model,
      outcome: event.outcome,
      streamed: event.streamed,
      attempt: event.attempt,
      durationMs: event.durationMs,
      queueMs: event.queueMs,
      ttftMs: event.ttftMs,
      promptTokens: event.usage?.promptTokens,
      completionTokens: event.usage?.completionTokens,
      cacheCreationTokens: event.usage?.cacheCreationTokens,
      cacheReadTokens: event.usage?.cacheReadTokens,
      costUsd: estimateCostUsd(event.model, event.usage) ?? undefined,
      message: event.message,
    });
  } catch (err) {
    console.warn("[ai] telemetry write failed:", err instanceof Error ? err.message : String(err));
  }
}

/* ────────────────────────── aggregation (for /dev/ai) ─────────────────── */

export interface AiUsageSlice {
  key: string;
  calls: number;
  failures: number;
  p50Ms: number | null;
  p95Ms: number | null;
  /** Streaming attempts only; null when the slice had none. */
  p50TtftMs: number | null;
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Share of input tokens served from the prompt cache, 0–1. Null = no input tokens seen. */
  cacheHitRate: number | null;
  costUsd: number;
}

export interface AiTelemetrySummary {
  windowMs: number;
  totals: AiUsageSlice;
  byModel: AiUsageSlice[];
  byTask: AiUsageSlice[];
  /** Attempts that were fallbacks (attempt > 1), as a share of all attempts. */
  fallbackRate: number | null;
  recentFailures: AiCallRecord[];
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function sliceOf(key: string, rows: AiCallRecord[]): AiUsageSlice {
  const durations = rows.map((r) => r.durationMs).filter((d): d is number => d != null).sort((a, b) => a - b);
  const ttfts = rows.filter((r) => r.streamed).map((r) => r.ttftMs).filter((t): t is number => t != null).sort((a, b) => a - b);
  const sum = (f: (r: AiCallRecord) => number | undefined) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);
  const promptTokens = sum((r) => r.promptTokens);
  const cacheCreationTokens = sum((r) => r.cacheCreationTokens);
  const cacheReadTokens = sum((r) => r.cacheReadTokens);
  const inputTotal = promptTokens + cacheCreationTokens + cacheReadTokens;
  return {
    key,
    calls: rows.length,
    failures: rows.filter((r) => r.outcome !== "success").length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p50TtftMs: percentile(ttfts, 50),
    promptTokens,
    completionTokens: sum((r) => r.completionTokens),
    cacheCreationTokens,
    cacheReadTokens,
    cacheHitRate: inputTotal > 0 ? cacheReadTokens / inputTotal : null,
    costUsd: sum((r) => r.costUsd),
  };
}

function groupBy(rows: AiCallRecord[], key: (r: AiCallRecord) => string): AiUsageSlice[] {
  const groups = new Map<string, AiCallRecord[]>();
  for (const r of rows) {
    const k = key(r);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.entries()]
    .map(([k, list]) => sliceOf(k, list))
    .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

/** Aggregate the ledger over a trailing window (default 7 days). */
export function summarizeAiTelemetry(windowMs = 7 * 24 * 60 * 60 * 1000): AiTelemetrySummary {
  const rows = listAiCalls({ sinceMs: Date.now() - windowMs });
  return summarizeRows(rows, windowMs);
}

/** Pure aggregation core, exported for tests. */
export function summarizeRows(rows: AiCallRecord[], windowMs: number): AiTelemetrySummary {
  return {
    windowMs,
    totals: sliceOf("all", rows),
    byModel: groupBy(rows, (r) => r.model),
    byTask: groupBy(rows, (r) => r.taskType),
    fallbackRate: rows.length > 0 ? rows.filter((r) => r.attempt > 1).length / rows.length : null,
    recentFailures: rows.filter((r) => r.outcome !== "success").slice(0, 20),
  };
}
