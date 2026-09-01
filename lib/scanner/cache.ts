/**
 * Scanner v2 — shared reader for the last default-parameter auto-scan.
 *
 * Replaces a local `getCachedScannerResult()` that used to be duplicated
 * verbatim in lib/opportunity-map.ts and lib/knowledge-graph/build.ts, both
 * reading the generic, 15-minute-TTL `scanner_cache` table under the single
 * hardcoded key "v2::true:true" — a table whose every write (from unrelated
 * features: market-summary, movement-explainer, per-scope KG cache, timeline
 * sync markers) prunes all rows older than 15 minutes, so a real ScannerResult
 * stored there could never survive more than 15 minutes regardless of read-side
 * logic. This module reads/writes the dedicated `scanner_snapshot` singleton
 * row instead, which isn't subject to that prune.
 */

import { getScannerSnapshot, putScannerSnapshot } from "../db";
import { freshness, type Freshness } from "../provenance";
import type { ScannerResult } from "../types";

export interface ScannerSnapshot {
  result: ScannerResult;
  generatedAt: string;
  freshness: Freshness;
  /**
   * True when the snapshot predates the current SCORING_METHODOLOGY_VERSION
   * (its opportunity verdicts were banded under older rules). Surfaces must
   * still render it — it is the user's last real scan — but with a visible
   * staleness note and a rerun action, never a blank (ruling 2026-08-17).
   */
  methodologyStale: boolean;
}

/** Best-effort — never triggers a live pipeline run; Scanner itself owns that (heavy, multi-minute) workflow. */
export function getLatestScannerSnapshot(): ScannerSnapshot | null {
  const row = getScannerSnapshot();
  if (!row) return null;
  try {
    const result = JSON.parse(row.result) as ScannerResult;
    return {
      result,
      generatedAt: row.generatedAt,
      freshness: freshness(row.generatedAt, 1),
      methodologyStale: row.methodologyStale,
    };
  } catch {
    return null;
  }
}

/** Called only after a successful default-parameter (no custom query) auto-scan. */
export function persistScannerSnapshot(result: ScannerResult): void {
  putScannerSnapshot(JSON.stringify(result), result.scannedAt);
}
