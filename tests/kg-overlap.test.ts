import { describe, expect, it } from "vitest";
import { computeLookThrough, canonicalizeListing, type FundHolding } from "@/lib/knowledge-graph/overlap";

const pos = (symbol: string, weight: number, isFund = false) => ({ symbol, name: symbol, weight, isFund });

describe("computeLookThrough", () => {
  it("adds fund contributions on top of a direct position", () => {
    const holdings = new Map<string, FundHolding[]>([
      ["VOO", [{ symbol: "AAPL", name: "Apple", weight: 0.07 }]],
    ]);
    const result = computeLookThrough([pos("AAPL", 0.05), pos("VOO", 0.2, true)], holdings);
    expect(result.exposures).toHaveLength(1);
    const aapl = result.exposures[0];
    expect(aapl.symbol).toBe("AAPL");
    expect(aapl.directWeight).toBeCloseTo(0.05, 6);
    expect(aapl.effectiveWeight).toBeCloseTo(0.05 + 0.2 * 0.07, 6);
    expect(aapl.routeCount).toBe(2);
    expect(aapl.routes[0]).toMatchObject({ via: "VOO", contribution: 0.2 * 0.07 });
  });

  it("finds exposure reached only through two funds (no direct position)", () => {
    const holdings = new Map<string, FundHolding[]>([
      ["VOO", [{ symbol: "MSFT", name: "Microsoft", weight: 0.06 }]],
      ["VTI", [{ symbol: "MSFT", name: "Microsoft", weight: 0.05 }]],
    ]);
    const result = computeLookThrough([pos("VOO", 0.3, true), pos("VTI", 0.2, true)], holdings);
    const msft = result.exposures.find((e) => e.symbol === "MSFT");
    expect(msft).toBeDefined();
    expect(msft!.directWeight).toBe(0);
    expect(msft!.effectiveWeight).toBeCloseTo(0.3 * 0.06 + 0.2 * 0.05, 6);
    expect(msft!.routeCount).toBe(2);
  });

  it("excludes single-route holdings (a fund holding something once is not a finding)", () => {
    const holdings = new Map<string, FundHolding[]>([
      ["VOO", [{ symbol: "XOM", name: "Exxon", weight: 0.01 }]],
    ]);
    const result = computeLookThrough([pos("VOO", 0.3, true), pos("NVDA", 0.1)], holdings);
    expect(result.exposures).toHaveLength(0);
  });

  it("ranks by effective weight, strongest routes first within an exposure", () => {
    const holdings = new Map<string, FundHolding[]>([
      ["A", [{ symbol: "X", name: "X", weight: 0.1 }, { symbol: "Y", name: "Y", weight: 0.02 }]],
      ["B", [{ symbol: "X", name: "X", weight: 0.02 }, { symbol: "Y", name: "Y", weight: 0.2 }]],
    ]);
    const result = computeLookThrough([pos("A", 0.5, true), pos("B", 0.1, true)], holdings);
    expect(result.exposures[0].symbol).toBe("X"); // 0.05 + 0.002 > 0.01 + 0.02
    expect(result.exposures[0].routes[0].via).toBe("A");
  });

  it("ignores holdings with no ticker or zero weight (never guesses identity)", () => {
    const holdings = new Map<string, FundHolding[]>([
      ["A", [
        { symbol: null, name: "Cash & Other", weight: 0.1 },
        { symbol: "Z", name: "Z", weight: 0 },
        { symbol: "K", name: "K", weight: 0.05 },
      ]],
      ["B", [{ symbol: "K", name: "K", weight: 0.05 }]],
    ]);
    const result = computeLookThrough([pos("A", 0.5, true), pos("B", 0.5, true)], holdings);
    expect(result.exposures.map((e) => e.symbol)).toEqual(["K"]);
  });

  it("reports fund pairs sharing 2+ disclosed holdings with mean shared weight", () => {
    const holdings = new Map<string, FundHolding[]>([
      ["A", [
        { symbol: "X", name: "X", weight: 0.1 },
        { symbol: "Y", name: "Y", weight: 0.1 },
        { symbol: "Q", name: "Q", weight: 0.05 },
      ]],
      ["B", [
        { symbol: "X", name: "X", weight: 0.2 },
        { symbol: "Y", name: "Y", weight: 0.1 },
      ]],
    ]);
    const result = computeLookThrough([pos("A", 0.5, true), pos("B", 0.5, true)], holdings);
    expect(result.fundOverlaps).toHaveLength(1);
    expect(result.fundOverlaps[0]).toMatchObject({ fundA: "A", fundB: "B", sharedSymbols: ["X", "Y"] });
    // mean of (0.1+0.1) and (0.2+0.1) = 0.25
    expect(result.fundOverlaps[0].sharedWeight).toBeCloseTo(0.25, 3);
  });

  it("does not pair funds sharing fewer than 2 holdings", () => {
    const holdings = new Map<string, FundHolding[]>([
      ["A", [{ symbol: "X", name: "X", weight: 0.1 }, { symbol: "P", name: "P", weight: 0.1 }]],
      ["B", [{ symbol: "X", name: "X", weight: 0.2 }, { symbol: "R", name: "R", weight: 0.1 }]],
    ]);
    expect(computeLookThrough([pos("A", 0.5, true), pos("B", 0.5, true)], holdings).fundOverlaps).toHaveLength(0);
  });

  it("carries the disclosure-floor caveat in basis", () => {
    const result = computeLookThrough([], new Map());
    expect(result.basis).toContain("floors");
  });

  it("matches a direct ADR position against a fund's local-listing disclosure via the identity map", () => {
    // What VXUS actually discloses is 2330.TW; the book holds the ADR TSM.
    const holdings = new Map<string, FundHolding[]>([
      ["VXUS", [{ symbol: canonicalizeListing("2330.TW"), name: "Taiwan Semiconductor", weight: 0.0425 }]],
    ]);
    const result = computeLookThrough([pos("TSM", 0.03), pos("VXUS", 0.1, true)], holdings);
    expect(result.exposures).toHaveLength(1);
    expect(result.exposures[0].symbol).toBe("TSM");
    expect(result.exposures[0].effectiveWeight).toBeCloseTo(0.03 + 0.1 * 0.0425, 6);
  });
});

describe("canonicalizeListing", () => {
  it("maps known local listings to their US ADR", () => {
    expect(canonicalizeListing("2330.TW")).toBe("TSM");
    expect(canonicalizeListing("7203.T")).toBe("TM");
  });
  it("passes unknown listings through unchanged (under-report, never guess)", () => {
    expect(canonicalizeListing("1299.HK")).toBe("1299.HK");
    expect(canonicalizeListing("AAPL")).toBe("AAPL");
  });
});
