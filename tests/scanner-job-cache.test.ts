/**
 * Degraded-aware scan cache reads (lib/scanner/job.ts readCachedScan).
 *
 * The failure this pins down (2026-08-07): a scan whose every LLM call died
 * on an exhausted provider quota completed — degraded, near-empty — in
 * seconds, was cached exactly like a clean run, and the Wire kept re-serving
 * it as "Cached" for the full 15-minute TTL after the provider had already
 * recovered. A degraded result may bridge a quick reload, never outlive one.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ScannerResult } from "../lib/types";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-scan-cache-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  vi.useRealTimers();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Imported AFTER DB_PATH is set, so lib/db.ts's lazy getDb() opens the temp file.
const { putScannerCache } = await import("../lib/db");
const { readCachedScan, DEGRADED_SCAN_TTL_MS } = await import("../lib/scanner/job");

function scanResult(overrides: Partial<ScannerResult> = {}): ScannerResult {
  return {
    scannedAt: new Date().toISOString(),
    pipelineVersion: 2,
    marketRegime: {
      trend: "neutral",
      breadthPct: null,
      dominantSectors: [],
      dominantThemes: [],
      summary: "Mixed.",
    },
    macroSignals: [],
    sectorImpacts: [],
    emergingThemes: [],
    events: [],
    opportunities: [],
    highConviction: [],
    developing: [],
    riskAlerts: [],
    newsItems: [],
    aiSummary: "Mixed.",
    stageFailures: [],
    ...overrides,
  };
}

describe("readCachedScan (isolated test database)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("serves a clean result for the standard TTL", () => {
    putScannerCache("v2:clean:true:true", JSON.stringify(scanResult()));
    expect(readCachedScan("v2:clean:true:true")).not.toBeNull();
  });

  it("misses entirely for an absent key and an unparseable row", () => {
    expect(readCachedScan("v2:absent:true:true")).toBeNull();
    putScannerCache("v2:garbled:true:true", "not json{");
    expect(readCachedScan("v2:garbled:true:true")).toBeNull();
  });

  it("still serves a fresh degraded result — a reload right after the scan must re-attach, not re-run", () => {
    const degraded = scanResult({
      stageFailures: [{ stage: "classifying", reason: "quota exhausted" }],
    });
    putScannerCache("v2:degraded-fresh:true:true", JSON.stringify(degraded));
    const read = readCachedScan("v2:degraded-fresh:true:true");
    expect(read).not.toBeNull();
    expect(read?.stageFailures).toHaveLength(1);
  });

  it("treats a degraded result past its short TTL as a miss, while a clean one would still be served", () => {
    vi.useFakeTimers();
    const degraded = scanResult({
      stageFailures: [{ stage: "classifying", reason: "quota exhausted" }],
    });
    putScannerCache("v2:degraded-stale:true:true", JSON.stringify(degraded));
    putScannerCache("v2:clean-aged:true:true", JSON.stringify(scanResult()));

    vi.advanceTimersByTime(DEGRADED_SCAN_TTL_MS + 1_000);

    // The degraded row is gone from the caller's view…
    expect(readCachedScan("v2:degraded-stale:true:true")).toBeNull();
    // …but the SAME age on a clean row is still comfortably inside its TTL.
    expect(readCachedScan("v2:clean-aged:true:true")).not.toBeNull();
  });
});
