/**
 * Scanner auto-refresh — keeps the homepage Radar (and Mission Control,
 * Timeline, Knowledge Graph, Opportunity Map, all of which read the last
 * cached auto-scan) reading a recent scan without anyone visiting /scanner
 * and clicking "run".
 *
 * The pipeline itself is heavy — "many sequential local-model calls" per
 * lib/scanner/index.ts — and Ollama serializes requests, so a scan in
 * flight makes every other AI feature (copilot, verdict, IC report) queue
 * behind it. Ticks therefore check freshness first: if the last snapshot is
 * still within its TTL, the tick is a no-op. Default interval matches the
 * 1h "fresh" window in lib/provenance.ts, so between ticks the snapshot
 * never ages past "fresh".
 */

import { runScannerPipeline } from "./index";
import { getLatestScannerSnapshot, persistScannerSnapshot } from "./cache";
import { putScannerCache } from "../db";

const TICK_KEY = Symbol.for("uaa.scanner.scheduler");

// Same key app/api/scanner/v2/route.ts's buildCacheKey() produces for the
// default (no query, india+global) auto-scan — keeping this warm is what
// lets Timeline/Knowledge Graph/Opportunity Map read a recent scan too.
const DEFAULT_CACHE_KEY = "v2::true:true";

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
  if (snapshot && snapshot.freshness.level === "fresh") return; // still current — skip the heavy pipeline

  running = true;
  try {
    const result = await runScannerPipeline({ india: true, global: true });
    persistScannerSnapshot(result);
    try {
      putScannerCache(DEFAULT_CACHE_KEY, JSON.stringify(result));
    } catch {
      // best-effort — Timeline/Knowledge Graph/Opportunity Map just fall back to their empty states
    }
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
