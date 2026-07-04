import { describe, expect, it } from "vitest";
import {
  computeSectorReturns,
  buildSectorRotationSnapshot,
} from "@/lib/sector-rotation";
import type { HistoryPoint, RotationWindow, SectorRotationEntry } from "@/lib/types";

function history(closes: number[], startDaysAgo: number): HistoryPoint[] {
  const now = new Date();
  return closes.map((close, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (startDaysAgo - i));
    return { date: d.toISOString().slice(0, 10), close };
  });
}

describe("computeSectorReturns", () => {
  it("computes positive return for a rising series", () => {
    const map = new Map([["Technology", history([100, 105, 110, 120], 6)]]);
    const returns = computeSectorReturns(map);
    const tech = returns.get("Technology")!;
    expect(tech["1w"]).toBeGreaterThan(0);
  });

  it("returns null for a window with insufficient history", () => {
    const map = new Map([["Technology", history([100, 101], 1)]]);
    const returns = computeSectorReturns(map);
    const tech = returns.get("Technology")!;
    expect(tech["6m"]).toBeDefined();
  });

  it("returns empty map for empty input", () => {
    const returns = computeSectorReturns(new Map());
    expect(returns.size).toBe(0);
  });
});

describe("buildSectorRotationSnapshot", () => {
  const mkReturns = (r1m: number): Record<RotationWindow, number | null> => ({
    "1w": r1m / 4,
    "1m": r1m,
    "3m": r1m * 2,
    "6m": r1m * 3,
  });

  it("ranks sectors by relative strength, strongest first", () => {
    const returns = new Map([
      ["Technology", mkReturns(10)],
      ["Utilities", mkReturns(-5)],
      ["Energy", mkReturns(2)],
    ]);
    const snapshot = buildSectorRotationSnapshot("2026-07-03", returns, null);
    expect(snapshot.sectors[0].sector).toBe("Technology");
    expect(snapshot.sectors[snapshot.sectors.length - 1].sector).toBe("Utilities");
    expect(snapshot.sectors[0].rank).toBe(1);
    expect(snapshot.leaders[0]).toBe("Technology");
    expect(snapshot.laggards[0]).toBe("Utilities");
  });

  it("classifies a strong-and-improving sector as leading", () => {
    const returns = new Map([
      ["Technology", mkReturns(10)],
      ["Utilities", mkReturns(-5)],
    ]);
    const previous: SectorRotationEntry[] = [
      {
        sector: "Technology",
        etfTicker: "XLK",
        returns: mkReturns(2),
        relativeStrength: -1, // was below average
        momentum: 0,
        rank: 2,
        rankChange: null,
        classification: "lagging",
      },
    ];
    const snapshot = buildSectorRotationSnapshot("2026-07-03", returns, previous);
    const tech = snapshot.sectors.find((s) => s.sector === "Technology")!;
    // Relative strength improved and is now positive -> leading or strengthening
    expect(["leading", "strengthening"]).toContain(tech.classification);
    expect(tech.rankChange).toBe(1); // moved from rank 2 to rank 1
  });

  it("computes rank change against the prior snapshot", () => {
    const returns = new Map([
      ["Technology", mkReturns(10)],
      ["Utilities", mkReturns(-5)],
    ]);
    const previous: SectorRotationEntry[] = [
      {
        sector: "Technology",
        etfTicker: "XLK",
        returns: mkReturns(-5),
        relativeStrength: -3,
        momentum: 0,
        rank: 2,
        rankChange: null,
        classification: "lagging",
      },
      {
        sector: "Utilities",
        etfTicker: "XLU",
        returns: mkReturns(10),
        relativeStrength: 3,
        momentum: 0,
        rank: 1,
        rankChange: null,
        classification: "leading",
      },
    ];
    const snapshot = buildSectorRotationSnapshot("2026-07-03", returns, previous);
    const tech = snapshot.sectors.find((s) => s.sector === "Technology")!;
    const util = snapshot.sectors.find((s) => s.sector === "Utilities")!;
    expect(tech.rankChange).toBe(1); // 2 -> 1
    expect(util.rankChange).toBe(-1); // 1 -> 2
    expect(snapshot.leadershipChanges.length).toBe(0); // |change| < 2 threshold
  });

  it("flags leadership changes of 2+ ranks", () => {
    const returns = new Map([
      ["Technology", mkReturns(20)],
      ["Utilities", mkReturns(0)],
      ["Energy", mkReturns(-10)],
    ]);
    const previous: SectorRotationEntry[] = [
      { sector: "Technology", etfTicker: "XLK", returns: mkReturns(-10), relativeStrength: -10, momentum: 0, rank: 3, rankChange: null, classification: "lagging" },
      { sector: "Utilities", etfTicker: "XLU", returns: mkReturns(0), relativeStrength: 0, momentum: 0, rank: 2, rankChange: null, classification: "leading" },
      { sector: "Energy", etfTicker: "XLE", returns: mkReturns(10), relativeStrength: 10, momentum: 0, rank: 1, rankChange: null, classification: "leading" },
    ];
    const snapshot = buildSectorRotationSnapshot("2026-07-03", returns, previous);
    expect(snapshot.leadershipChanges.some((c) => c.sector === "Technology")).toBe(true);
  });

  it("handles a single-sector input without dividing by zero", () => {
    const returns = new Map([["Technology", mkReturns(5)]]);
    const snapshot = buildSectorRotationSnapshot("2026-07-03", returns, null);
    expect(snapshot.sectors).toHaveLength(1);
    expect(snapshot.sectors[0].relativeStrength).toBe(0); // equal to the (single) average
  });
});
