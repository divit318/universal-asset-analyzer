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
const { putScannerCache, getScannerCache, getScannerCacheAt } = await import("../lib/db");
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
