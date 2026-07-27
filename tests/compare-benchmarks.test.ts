import { describe, it, expect } from "vitest";
import { peerGroupOf, computeMetricBenchmark, computeEntryBenchmarks, type BenchmarkUniverseEntry } from "@/lib/compare/benchmarks";

/**
 * Unit tests for the Compare engine's sector/category benchmark layer.
 * Pure, no I/O — exercises the percentile math and the "gracefully omit
 * rather than fabricate" rule directly.
 */

function candidate(symbol: string, sector: string, value: number | null): BenchmarkUniverseEntry {
  return { symbol, attributes: { sector }, metrics: { forwardPE: value } };
}

describe("peerGroupOf", () => {
  it("returns the peer attribute for a known asset class", () => {
    expect(peerGroupOf("equity", { sector: "Technology" })).toBe("Technology");
  });

  it("returns null when the attribute is missing or blank", () => {
    expect(peerGroupOf("equity", { sector: null })).toBeNull();
    expect(peerGroupOf("equity", { sector: "  " })).toBeNull();
  });

  it("returns null for an asset class with no defined peer grouping (forex)", () => {
    expect(peerGroupOf("forex", { pairType: "major" })).toBeNull();
  });
});

describe("computeMetricBenchmark", () => {
  const peers: BenchmarkUniverseEntry[] = [
    candidate("A", "Technology", 10),
    candidate("B", "Technology", 20),
    candidate("C", "Technology", 30),
    candidate("D", "Technology", 40),
    candidate("E", "Technology", 50),
  ];

  it("omits the benchmark when there are fewer than MIN_PEERS with data", () => {
    const thin = peers.slice(0, 3);
    const result = computeMetricBenchmark("equity", "forwardPE", "SUBJECT", 25, "Technology", thin);
    expect(result).toBeNull();
  });

  it("computes a peer average and a direction-aware percentile with enough peers", () => {
    const result = computeMetricBenchmark("equity", "forwardPE", "SUBJECT", 45, "Technology", peers);
    expect(result).not.toBeNull();
    expect(result!.peerAverage).toBe(30); // (10+20+30+40+50)/5
    expect(result!.peerCount).toBe(5);
    // forwardPE is "lower is better" — 45 sits above every peer, so it should rank near the bottom.
    expect(result!.percentile).toBeLessThan(30);
  });

  it("returns null when the subject has no value", () => {
    expect(computeMetricBenchmark("equity", "forwardPE", "SUBJECT", null, "Technology", peers)).toBeNull();
  });

  it("returns null when the asset class has no peer grouping defined", () => {
    expect(computeMetricBenchmark("forex", "volatility", "EURUSD", 5, "major", peers)).toBeNull();
  });

  it("returns null when there is no peer group value at all", () => {
    expect(computeMetricBenchmark("equity", "forwardPE", "SUBJECT", 25, null, peers)).toBeNull();
  });
});

describe("computeEntryBenchmarks", () => {
  it("only includes metrics that clear the minimum-peer bar, never fabricating the rest", () => {
    const peers: BenchmarkUniverseEntry[] = [
      { symbol: "A", attributes: { sector: "Technology" }, metrics: { forwardPE: 20, roe: null } },
      { symbol: "B", attributes: { sector: "Technology" }, metrics: { forwardPE: 25, roe: null } },
      { symbol: "C", attributes: { sector: "Technology" }, metrics: { forwardPE: 30, roe: null } },
      { symbol: "D", attributes: { sector: "Technology" }, metrics: { forwardPE: 35, roe: null } },
      { symbol: "E", attributes: { sector: "Technology" }, metrics: { forwardPE: 40, roe: null } },
    ];
    const out = computeEntryBenchmarks(
      "equity",
      ["forwardPE", "roe"],
      "SUBJECT",
      { forwardPE: 28, roe: 15 },
      "Technology",
      peers,
    );
    expect(out.forwardPE).toBeDefined();
    expect(out.roe).toBeUndefined(); // no peer has real ROE data — must not fabricate an average
  });
});
