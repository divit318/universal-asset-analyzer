/**
 * Adaptive ETA estimation for the Scanner pipeline's progress UI.
 *
 * Not hardcoded: blends two signals that both improve as more scans run —
 *   1. Live extrapolation from the current run's elapsed time / pct complete.
 *   2. A rolling average of past completed-scan durations (persisted client-side).
 * Early in a run (low pct), the historical average dominates since live
 * extrapolation is noisy; as pct climbs, live extrapolation takes over.
 */

const STORAGE_KEY = "uaa_scanner_scan_durations_v1";
const MAX_HISTORY = 10;
/** Bootstrap-only fallback, used solely before pct > 0 and before any history exists. */
const BOOTSTRAP_ESTIMATE_MS = 90_000;

export function loadScanHistory(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number" && n > 0) : [];
  } catch {
    return [];
  }
}

export function recordScanDuration(totalMs: number): void {
  if (typeof window === "undefined" || totalMs <= 0) return;
  try {
    const history = [totalMs, ...loadScanHistory()].slice(0, MAX_HISTORY);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage unavailable (private browsing, quota) — non-fatal, ETA just falls back to live extrapolation.
  }
}

export function averageHistoricalDuration(history: number[]): number | null {
  if (history.length === 0) return null;
  return history.reduce((a, b) => a + b, 0) / history.length;
}

export function estimateRemainingMs(params: {
  elapsedMs: number;
  pct: number; // 0-100
  historicalAvgMs: number | null;
}): number {
  const { elapsedMs, historicalAvgMs } = params;
  const fraction = Math.min(Math.max(params.pct, 0), 100) / 100;

  let totalEstimate: number;
  if (fraction <= 0) {
    totalEstimate = historicalAvgMs ?? BOOTSTRAP_ESTIMATE_MS;
  } else {
    const liveEstimate = elapsedMs / fraction;
    totalEstimate = historicalAvgMs == null
      ? liveEstimate
      : historicalAvgMs * (1 - fraction) + liveEstimate * fraction;
  }
  return Math.max(0, Math.round(totalEstimate - elapsedMs));
}
