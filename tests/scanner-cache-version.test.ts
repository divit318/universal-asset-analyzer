/**
 * Methodology-versioned scanner cache (lib/db.ts).
 *
 * scanner_cache rows store opaque JSON that can embed canonical scoring
 * outputs (a cached ScannerResult carries every opportunity's verdict). A
 * SCORING_METHODOLOGY_VERSION bump must therefore be a cache MISS: serving a
 * pre-bump verdict for the remainder of a 15-minute TTL would show the old
 * bands beside UI recomputed on the new ones. These tests prove the
 * invalidation path with a real (temp) SQLite database.
 */
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-scan-cache-version-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// Imported AFTER DB_PATH is set, so lib/db.ts's lazy getDb() opens the temp file.
const {
  putScannerCache,
  getScannerCache,
  getScannerCacheAt,
  putScannerSnapshot,
  getScannerSnapshot,
  putPortfolioIntelligenceSnapshot,
  getPortfolioIntelligenceSnapshot,
} = await import("../lib/db");
const { SCORING_METHODOLOGY_VERSION } = await import("../lib/recommendation");

describe("scanner_cache methodology versioning", () => {
  it("round-trips through the versioned key", () => {
    putScannerCache("vtest:roundtrip", "payload-1");
    expect(getScannerCache("vtest:roundtrip")).toBe("payload-1");
    expect(getScannerCacheAt("vtest:roundtrip")).not.toBeNull();
  });

  it("physically stores the key under the CURRENT methodology version", () => {
    putScannerCache("vtest:stored-key", "payload-2");
    const raw = new DatabaseSync(process.env.DB_PATH!, { readOnly: true });
    const row = raw
      .prepare("SELECT cache_key FROM scanner_cache WHERE cache_key LIKE '%vtest:stored-key'")
      .get() as { cache_key: string } | undefined;
    raw.close();
    expect(row?.cache_key).toBe(`m${SCORING_METHODOLOGY_VERSION}:vtest:stored-key`);
  });

  it("a row written under a PREVIOUS methodology version is unreachable (the invalidation path)", () => {
    // Simulate an entry left behind by the version before a bump: same logical
    // key, older version prefix, fresh timestamp (well inside TTL).
    const raw = new DatabaseSync(process.env.DB_PATH!);
    raw
      .prepare("INSERT INTO scanner_cache (cache_key, result, created_at) VALUES (?, ?, ?)")
      .run("m0000-00.0:vtest:old-version", "stale-verdicts", Date.now());
    raw.close();

    // The caller asks with the logical key it has always used — and misses,
    // despite the stale row being fresh by timestamp.
    expect(getScannerCache("vtest:old-version")).toBeNull();
    expect(getScannerCacheAt("vtest:old-version")).toBeNull();

    // Writing under the current version then serves the NEW result.
    putScannerCache("vtest:old-version", "fresh-verdicts");
    expect(getScannerCache("vtest:old-version")).toBe("fresh-verdicts");
  });

  it("unversioned legacy rows (pre-versioning deployments) are also unreachable", () => {
    const raw = new DatabaseSync(process.env.DB_PATH!);
    raw
      .prepare("INSERT INTO scanner_cache (cache_key, result, created_at) VALUES (?, ?, ?)")
      .run("vtest:legacy", "legacy-payload", Date.now());
    raw.close();
    expect(getScannerCache("vtest:legacy")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Long-lived snapshots: stamped on write, flagged (never blanked) on read    */
/* -------------------------------------------------------------------------- */

describe("snapshot methodology stamping (ruling 2026-08-17)", () => {
  it("scanner_snapshot: current write reads back non-stale; legacy/foreign versions read back STALE but intact", () => {
    putScannerSnapshot('{"scannedAt":"2026-08-17"}', "2026-08-17T10:00:00Z");
    const fresh = getScannerSnapshot();
    expect(fresh).not.toBeNull();
    expect(fresh!.methodologyStale).toBe(false);
    expect(fresh!.result).toBe('{"scannedAt":"2026-08-17"}');

    // Simulate a row from a previous methodology (or NULL: pre-versioning).
    const raw = new DatabaseSync(process.env.DB_PATH!);
    raw.prepare("UPDATE scanner_snapshot SET methodology_version = '0000-00.0' WHERE id = 1").run();
    raw.close();
    const stale = getScannerSnapshot();
    // The snapshot is STILL SERVED — flagged, never blanked, never deleted.
    expect(stale).not.toBeNull();
    expect(stale!.methodologyStale).toBe(true);
    expect(stale!.result).toBe('{"scannedAt":"2026-08-17"}');

    const raw2 = new DatabaseSync(process.env.DB_PATH!);
    raw2.prepare("UPDATE scanner_snapshot SET methodology_version = NULL WHERE id = 1").run();
    raw2.close();
    expect(getScannerSnapshot()!.methodologyStale).toBe(true);
  });

  it("portfolio_intelligence_snapshot: same contract", () => {
    putPortfolioIntelligenceSnapshot('{"weights":{}}', "2026-08-17T10:00:00Z");
    expect(getPortfolioIntelligenceSnapshot()!.methodologyStale).toBe(false);

    const raw = new DatabaseSync(process.env.DB_PATH!);
    raw.prepare("UPDATE portfolio_intelligence_snapshot SET methodology_version = NULL WHERE id = 1").run();
    raw.close();
    const legacy = getPortfolioIntelligenceSnapshot();
    expect(legacy).not.toBeNull();
    expect(legacy!.methodologyStale).toBe(true);
    expect(legacy!.data).toBe('{"weights":{}}');
  });

  it("a rewrite under the current version clears the staleness", () => {
    putScannerSnapshot('{"scannedAt":"2026-08-18"}', "2026-08-18T10:00:00Z");
    expect(getScannerSnapshot()!.methodologyStale).toBe(false);
    expect(getScannerSnapshot()!.generatedAt).toBe("2026-08-18T10:00:00Z");
    // And the stamp physically stored is the current version.
    const raw = new DatabaseSync(process.env.DB_PATH!, { readOnly: true });
    const row = raw.prepare("SELECT methodology_version FROM scanner_snapshot WHERE id = 1").get() as {
      methodology_version: string;
    };
    raw.close();
    expect(row.methodology_version).toBe(SCORING_METHODOLOGY_VERSION);
  });
});
