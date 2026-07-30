/**
 * The engine-prior read path, against a throwaway priors file.
 *
 * The point of this module is that reading a prior costs no subprocess, so the
 * tests assert the parse, the mtime cache, and the graceful degradation — not the
 * Python backfill, which only runs on a cold DuckDB.
 *
 * VALUATION_PRIORS_PATH is set before the module is first imported, so this never
 * reads the real data/valuation_priors.json.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-priors-test-"));
const priorsPath = path.join(tmpDir, "valuation_priors.json");
process.env.VALUATION_PRIORS_PATH = priorsPath;

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

const { enginePriors, getEnginePrior, hasEnginePriors } = await import("../lib/valuation/engine-prior");

function write(payload: unknown, mtimeSeconds?: number) {
  writeFileSync(priorsPath, JSON.stringify(payload));
  // Bump mtime explicitly: two writes inside the same millisecond would
  // otherwise look unchanged to the cache.
  if (mtimeSeconds != null) utimesSync(priorsPath, mtimeSeconds, mtimeSeconds);
}

const AAPL = {
  p10: 83.13, p25: 117.81, p50: 174.86, p75: 258.34, p90: 366.73,
  wacc: 0.0726, terminalGrowth: 0.03, asOf: "2026-07-16",
};

beforeEach(() => {
  rmSync(priorsPath, { force: true });
});

describe("enginePriors", () => {
  it("degrades to an empty map when the engine has never published", () => {
    expect(hasEnginePriors()).toBe(false);
    expect(enginePriors().priors.size).toBe(0);
    expect(getEnginePrior("AAPL")).toBeNull();
  });

  it("reads a published map and normalises the symbol", () => {
    write({ generatedAt: "2026-07-16T00:00:00Z", runDate: "2026-07-16", priors: { AAPL } }, 1_760_000_000);
    const prior = getEnginePrior("aapl");
    expect(prior?.symbol).toBe("AAPL");
    expect(prior?.p50).toBeCloseTo(174.86, 6);
    expect(prior?.wacc).toBeCloseTo(0.0726, 6);
    expect(prior?.asOf).toBe("2026-07-16");
    expect(enginePriors().runDate).toBe("2026-07-16");
  });

  it("picks up a newer map without a restart", () => {
    write({ priors: { AAPL } }, 1_760_000_000);
    expect(getEnginePrior("AAPL")?.p50).toBeCloseTo(174.86, 6);

    write({ priors: { AAPL: { ...AAPL, p50: 200 } } }, 1_760_000_100);
    expect(getEnginePrior("AAPL")?.p50).toBe(200);
  });

  it("drops entries with no median, since a prior without one is not a prior", () => {
    write({ priors: { AAPL, JUNK: { p10: 1, p90: 2 } } }, 1_760_000_200);
    expect(getEnginePrior("JUNK")).toBeNull();
    expect(getEnginePrior("AAPL")).not.toBeNull();
  });

  it("keeps partial percentiles rather than discarding the whole entry", () => {
    write({ priors: { AAPL: { p50: 100, wacc: null, asOf: null } } }, 1_760_000_300);
    const prior = getEnginePrior("AAPL");
    expect(prior?.p50).toBe(100);
    expect(prior?.p10).toBeNull();
    expect(prior?.wacc).toBeNull();
  });

  it("survives a malformed map instead of throwing into the page", () => {
    writeFileSync(priorsPath, "{ not json");
    utimesSync(priorsPath, 1_760_000_400, 1_760_000_400);
    expect(() => enginePriors()).not.toThrow();
    expect(enginePriors().priors.size).toBe(0);
  });

  it("ignores non-numeric values rather than trusting them", () => {
    write({ priors: { AAPL: { p50: "174.86" } } }, 1_760_000_500);
    expect(getEnginePrior("AAPL")).toBeNull();
  });
});
