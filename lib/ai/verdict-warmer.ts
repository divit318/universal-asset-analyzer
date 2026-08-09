/**
 * Verdict cache warmer — the "precompute" half of the verdict migration
 * (ai-migration/03 §10 step 7; 05 "verdict + cache warming").
 *
 * Iterates the symbols a user demonstrably cares about — watchlist +
 * portfolio — and read-throughs `getVerdict` for each, so the next research
 * page visit is a cache hit instead of a generation the user watches. Writing
 * happens under the platform's `aiVerdict` policy (6h fresh, dependency-aware
 * invalidation), NOT a parallel cache: the warmer produces exactly the rows
 * the route reads.
 *
 * Two deliberate restraints:
 *
 *  1. **Devin-only.** Warming is skipped when the verdict task would resolve
 *     to Ollama: the daemon serializes generations, so a background warm of N
 *     symbols would starve every interactive request for ~N minutes — the
 *     exact failure the scanner scheduler documents. Devin sessions run
 *     genuinely in parallel (no ceiling found to 40; 05 amendment 2), so
 *     warming there is nearly free in wall-clock.
 *  2. **Un-personalized.** Warmed verdicts use empty personalization params —
 *     the generic verdict every anonymous view reads. Personalized variants
 *     (portfolio-aware) still generate on demand; pre-generating per-user
 *     variants is combinatorial and serves nobody until that user shows up.
 *
 * Scheduling mirrors lib/scanner/scheduler.ts (in-process, Symbol.for
 * singleton, never-overlapping ticks): UAA_VERDICT_WARM_INTERVAL_MS, default
 * 6h to match the aiVerdict fresh window, 0 disables, floor 15 min.
 */

import { listWatchlist, listPortfolio } from "../db";
import { buildCompanyContext } from "./context";
import { getVerdict, planVerdict, verdictCacheParams, peekVerdict } from "./verdict";
import { resolveProvider } from "./analysis-provider";

const TICK_KEY = Symbol.for("uaa.verdict-warmer");
const DEFAULT_INTERVAL_MS = 6 * 60 * 60_000; // = aiVerdict's fresh TTL
const CONCURRENCY = Math.max(1, Number(process.env.DEVIN_API_CONCURRENCY) || 4);

export function resolveWarmIntervalMs(rawEnv: string | undefined): number {
  if (rawEnv == null || rawEnv === "") return DEFAULT_INTERVAL_MS;
  const n = Number(rawEnv);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_INTERVAL_MS;
  if (n === 0) return 0; // 0 disables
  return Math.max(n, 15 * 60_000);
}

/** Watchlist ∪ portfolio, deduped, stable order. Exported for tests. */
export function warmCandidates(
  watchlist: { symbol: string }[],
  portfolio: { symbol: string }[],
): string[] {
  return [...new Set([...watchlist, ...portfolio].map((r) => r.symbol.toUpperCase()))];
}

let running = false;

export async function warmVerdicts(): Promise<{ warmed: number; skipped: number; failed: number }> {
  const counts = { warmed: 0, skipped: 0, failed: 0 };
  const symbols = warmCandidates(listWatchlist(), listPortfolio());
  if (symbols.length === 0) return counts;

  // One symbol probes the routing decision for all: every verdict task class
  // resolves the same way under a global flag, and per-task pins are for
  // humans debugging, not the warmer.
  const queue = [...symbols];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const symbol = queue.shift();
      if (!symbol) return;
      try {
        const ctx = await buildCompanyContext(symbol);
        const plan = await planVerdict(ctx, null);
        /* Merge resolution 2026-08-06: restraint 1 gated warming to main's
           "sessions" runtime, whose parallel, capped background runs made it
           nearly free. That runtime is retired on this branch; the one chain
           runtime is interactive (and may be the user's metered key), so
           background warming stays skipped until a runtime that tolerates
           unattended spend exists again. `resolveProvider` is the seam that
           would re-enable it. */
        if ((resolveProvider(plan.task) as string) !== "sessions") {
          counts.skipped += 1; // restraint 1: never occupy the interactive runtime
          continue;
        }
        const params = verdictCacheParams(ctx.symbol, plan.kind);
        if (peekVerdict(params)) {
          counts.skipped += 1; // fresh enough — getDataset would no-op anyway
          continue;
        }
        const { verdict } = await getVerdict(plan, params);
        if (verdict.model === "unavailable") counts.failed += 1;
        else counts.warmed += 1;
      } catch {
        counts.failed += 1; // one bad symbol must not end the sweep
      }
    }
  });
  await Promise.all(workers);
  return counts;
}

async function tick(): Promise<void> {
  if (running) return; // previous sweep still in flight — never overlap
  running = true;
  try {
    const { warmed, skipped, failed } = await warmVerdicts();
    if (warmed + failed > 0) {
      console.log(`[verdict-warmer] sweep done — warmed ${warmed}, skipped ${skipped}, failed ${failed}`);
    }
  } catch (err) {
    console.warn("[verdict-warmer] sweep failed:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

/** Idempotent across Turbopack HMR reloads — same guard as the scanner. */
export function startVerdictWarmer(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[TICK_KEY]) return;
  const interval = resolveWarmIntervalMs(process.env.UAA_VERDICT_WARM_INTERVAL_MS);
  if (interval === 0) return;
  g[TICK_KEY] = setInterval(() => void tick(), interval);
  // First sweep shortly after boot rather than a full interval later — but
  // delayed enough not to compete with the scanner's boot warmup for market
  // data rate limits.
  setTimeout(() => void tick(), 90_000).unref?.();
}
