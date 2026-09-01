/**
 * Scanner auto-refresh — keeps the homepage Radar (and Mission Control,
 * Timeline, Knowledge Graph, Opportunity Map, all of which read the last
 * cached auto-scan) reading a recent scan without anyone visiting /scanner
 * and clicking "run".
 *
 * The pipeline itself is heavy — "many sequential local-model calls" per
 * lib/scanner/index.ts — and a duplicate scan is pure duplicate spend, so a scan in
 * flight makes every other AI feature (copilot, verdict, IC report) queue
 * behind it. Ticks therefore check freshness first: if the last snapshot is
 * still within its TTL, the tick is a no-op. Default interval matches the
 * 1h "fresh" window in lib/provenance.ts, so between ticks the snapshot
 * never ages past "fresh".
 */

import { getLatestScannerSnapshot } from "./cache";
import { scanJobResult, startScanJob } from "./job";
import { hasRunningJob } from "../platform/jobs";

const TICK_KEY = Symbol.for("uaa.scanner.scheduler");

/** exported for tests */
export function resolveScannerIntervalMs(rawEnv: string | undefined): number {
  const DEFAULT = 60 * 60_000; // 1h — matches the "fresh" TTL in lib/provenance.ts
  if (rawEnv == null || rawEnv === "") return DEFAULT;
  const n = Number(rawEnv);
  if (!Number.isFinite(n) || n < 0) return DEFAULT;
  if (n === 0) return 0; // 0 disables
  return Math.max(n, 5 * 60_000); // floor 5 min — this pipeline takes minutes, not seconds
}

let running = false;

async function tick(): Promise<void> {
  if (running) return; // previous run still in flight — never overlap
  const snapshot = getLatestScannerSnapshot();
  // Still current — skip the heavy pipeline. A methodology-stale snapshot is
  // never "current" regardless of age: its verdicts were banded under older
  // rules, so the scheduler is the automatic rerun path (ruling 2026-08-17).
  if (snapshot && snapshot.freshness.level === "fresh" && !snapshot.methodologyStale) return;

  // A user-triggered scan (any parameters) is already occupying the local
  // model, which serializes generations — piling the auto-scan on top would
  // only slow the scan a human is actually watching. Measured 2026-07-31:
  // the boot-warmup tick racing a /wire page scan made every queued call of
  // the losing scan burn its whole 300s timeout waiting its turn. The next
  // hourly tick refreshes the snapshot instead.
  if (hasRunningJob("scanner:")) return;

  running = true;
  try {
    // startScanJob persists the snapshot + default cache key on completion;
    // detached so it never depends on subscribers. If a user starts the same
    // default scan meanwhile, they attach to THIS job rather than racing it.
    const result = await scanJobResult(
      startScanJob({ india: true, global: true }, { detached: true }),
    );
    console.log(
      `[scanner] auto-scan complete — ${result.highConviction.length} high-conviction, ${result.developing.length} developing`,
    );
  } catch (err) {
    console.warn("[scanner] auto-scan tick failed:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

/** Start the in-process scanner auto-refresh. Idempotent across dev hot-reloads. */
export function startScannerScheduler(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[TICK_KEY]) return; // already scheduled (hot reload / double register)

  const intervalMs = resolveScannerIntervalMs(process.env.UAA_SCANNER_INTERVAL_MS);
  if (intervalMs === 0) return; // explicitly disabled

  const t = setInterval(() => void tick(), intervalMs);
  t.unref?.(); // never keep the process alive just for the timer
  g[TICK_KEY] = t;

  // Check shortly after boot too: if there's no snapshot yet, or it already
  // aged past "fresh" while the server was down, don't make the user find
  // the Scanner page and click run — a fresh scan starts within seconds.
  const warmup = setTimeout(() => void tick(), 5_000);
  warmup.unref?.();
}
