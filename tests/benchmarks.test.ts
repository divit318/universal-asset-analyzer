import { describe, it, expect } from "vitest";
import { benchmarkForSymbol, indiaSectorIndex, marketBenchmark } from "@/lib/benchmarks";

describe("benchmarkForSymbol", () => {
  it("gives NSE/BSE listings the NIFTY 50, never the S&P 500", () => {
    expect(benchmarkForSymbol("RELIANCE.NS")).toEqual({ symbol: "^NSEI", label: "NIFTY 50" });
    expect(benchmarkForSymbol("RELIANCE.BO")).toEqual({ symbol: "^NSEI", label: "NIFTY 50" });
    expect(benchmarkForSymbol("hdfcbank.ns").symbol).toBe("^NSEI");
  });

  it("keeps US listings on the S&P 500", () => {
    expect(benchmarkForSymbol("AAPL")).toEqual({ symbol: "SPY", label: "S&P 500" });
    expect(benchmarkForSymbol("BRK-B").symbol).toBe("SPY");
  });

  it("maps other suffixed markets to their home index", () => {
    expect(benchmarkForSymbol("7203.T").symbol).toBe("^N225");
    expect(benchmarkForSymbol("0700.HK").symbol).toBe("^HSI");
    expect(benchmarkForSymbol("BHP.AX").symbol).toBe("^AXJO");
  });
});

describe("marketBenchmark", () => {
  it("resolves per region", () => {
    expect(marketBenchmark("IN").label).toBe("NIFTY 50");
    expect(marketBenchmark("US").label).toBe("S&P 500");
  });
});

describe("indiaSectorIndex", () => {
  it("maps Yahoo sectors onto NIFTY sectoral indices", () => {
    expect(indiaSectorIndex("Financial Services")).toEqual({ symbol: "^NSEBANK", label: "NIFTY Bank" });
    expect(indiaSectorIndex("Technology")?.label).toBe("NIFTY IT");
    expect(indiaSectorIndex("Consumer Defensive")?.label).toBe("NIFTY FMCG");
    expect(indiaSectorIndex("Healthcare")?.label).toBe("NIFTY Pharma");
    expect(indiaSectorIndex("Energy")?.label).toBe("NIFTY Energy");
    expect(indiaSectorIndex("Real Estate")?.label).toBe("NIFTY Realty");
  });

  it("returns null (no overlay) rather than guessing", () => {
    expect(indiaSectorIndex("Communication Services")).toBeNull();
    expect(indiaSectorIndex(null)).toBeNull();
  });
});

import { dominantBenchmark, riskFreeRate } from "@/lib/benchmarks";

describe("dominantBenchmark", () => {
  it("benchmarks an all-India book against NIFTY 50", () => {
    expect(dominantBenchmark(["RELIANCE.NS", "HDFCBANK.NS", "TCS.NS"]).symbol).toBe("^NSEI");
  });
  it("keeps an all-US book on SPY", () => {
    expect(dominantBenchmark(["AAPL", "MSFT"]).symbol).toBe("SPY");
  });
  it("uses the majority market for mixed books", () => {
    expect(dominantBenchmark(["RELIANCE.NS", "TCS.NS", "AAPL"]).symbol).toBe("^NSEI");
    expect(dominantBenchmark(["AAPL", "MSFT", "TCS.NS"]).symbol).toBe("SPY");
  });
  it("defaults to SPY for an empty book", () => {
    expect(dominantBenchmark([]).symbol).toBe("SPY");
  });
});

describe("riskFreeRate", () => {
  it("uses the GOI rate for India and the T-bill for the US", () => {
    expect(riskFreeRate("IN")).toBe(0.065);
    expect(riskFreeRate("US")).toBe(0.0425);
  });
});
