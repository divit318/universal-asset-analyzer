import { describe, it, expect } from "vitest";
import { buildSymbolContext } from "@/lib/home/symbol-context";

const inputs = {
  heldWeights: new Map([
    ["aapl", 12.4],
    ["MSFT", 8.1],
  ]),
  watchlist: [
    { symbol: "nvda", stage: "researching" as const },
    { symbol: "AAPL", stage: "owned" as const },
  ],
  activity: [
    { kind: "research", ref: "NVDA", at: "2026-07-20T10:00:00.000Z" },
    { kind: "research", ref: "nvda", at: "2026-07-24T10:00:00.000Z" },
    { kind: "screen", ref: "value-screen", at: "2026-07-25T10:00:00.000Z" },
    { kind: "research", ref: "some long non-symbol ref", at: "2026-07-25T10:00:00.000Z" },
  ],
};

describe("buildSymbolContext", () => {
  it("joins held weight, stage, and research recency, normalized to uppercase", () => {
    const ctx = buildSymbolContext(["AAPL", "nvda", "MSFT"], inputs);
    expect(ctx.AAPL).toEqual({
      symbol: "AAPL",
      heldWeightPct: 12.4,
      watchlistStage: "owned",
      lastResearchedAt: null,
    });
    expect(ctx.NVDA.watchlistStage).toBe("researching");
    expect(ctx.MSFT.heldWeightPct).toBe(8.1);
  });

  it("keeps the most recent research visit per symbol", () => {
    const ctx = buildSymbolContext(["NVDA"], inputs);
    expect(ctx.NVDA.lastResearchedAt).toBe("2026-07-24T10:00:00.000Z");
  });

  it("omits symbols the platform knows nothing about", () => {
    const ctx = buildSymbolContext(["ZZZZ"], inputs);
    expect(ctx.ZZZZ).toBeUndefined();
  });

  it("ignores non-research activity and refs that are not symbols", () => {
    const ctx = buildSymbolContext(["VALUE-SCREEN"], inputs);
    // "screen" activity must never masquerade as research history
    expect(ctx["VALUE-SCREEN"]).toBeUndefined();
  });

  it("dedupes repeated symbols and skips blanks", () => {
    const ctx = buildSymbolContext(["AAPL", "aapl", " ", ""], inputs);
    expect(Object.keys(ctx)).toEqual(["AAPL"]);
  });
});
