import { describe, expect, it } from "vitest";
import { computeWatchlistAlerts } from "@/lib/ai-watchlist";
import type { WatchlistStockSummary } from "@/lib/ai-watchlist";

// Use a fictitious sector name so findSectorRotationEntry() reliably returns
// null regardless of real persisted sector-rotation state — keeps these
// assertions independent of whatever snapshot happens to be in data/app.db.
const NO_ROTATION_SECTOR = "NotARealSector";

function summary(o: Partial<WatchlistStockSummary> = {}): WatchlistStockSummary {
  return {
    symbol: "TEST",
    name: "Test Co",
    quote: null,
    fundamentalScore: null,
    recommendation: null,
    topRisk: null,
    analystUpside: null,
    sector: NO_ROTATION_SECTOR,
    momentumTrend: null,
    ...o,
  };
}

describe("computeWatchlistAlerts", () => {
  it("flags a new_opportunity for a high-scoring symbol not in the portfolio", () => {
    const alerts = computeWatchlistAlerts([summary({ symbol: "NVDA", fundamentalScore: 82, recommendation: "Buy" })]);
    expect(alerts.some((a) => a.type === "new_opportunity" && a.symbol === "NVDA")).toBe(true);
  });

  it("does not flag new_opportunity for a low score", () => {
    const alerts = computeWatchlistAlerts([summary({ symbol: "WEAK", fundamentalScore: 45 })]);
    expect(alerts.some((a) => a.type === "new_opportunity")).toBe(false);
  });

  it("escalates severity to high when the opportunity fills a missing sector", () => {
    const alerts = computeWatchlistAlerts(
      [summary({ symbol: "GAP", fundamentalScore: 75, sector: "Healthcare" })],
      { objective: "improve_diversification", holdingSymbols: [], sectorWeights: [], missingSectors: ["Healthcare"], overweightSectors: [] },
    );
    const a = alerts.find((x) => x.symbol === "GAP")!;
    expect(a.severity).toBe("high");
  });

  it("flags deteriorating for a low score with negative momentum, escalated if held", () => {
    const notHeld = computeWatchlistAlerts([summary({ symbol: "SICK", fundamentalScore: 30, momentumTrend: "down" })]);
    expect(notHeld.find((a) => a.symbol === "SICK")?.severity).toBe("medium");

    const held = computeWatchlistAlerts(
      [summary({ symbol: "SICK", fundamentalScore: 30, momentumTrend: "down" })],
      { objective: "reduce_risk", holdingSymbols: ["SICK"], sectorWeights: [], missingSectors: [], overweightSectors: [] },
    );
    expect(held.find((a) => a.symbol === "SICK")?.severity).toBe("high");
  });

  it("flags a breakout on strong positive momentum and a big daily move", () => {
    const alerts = computeWatchlistAlerts([
      summary({
        symbol: "MOVE",
        momentumTrend: "up",
        quote: { symbol: "MOVE", price: 100, changePercent: 7.5 } as WatchlistStockSummary["quote"],
      }),
    ]);
    expect(alerts.some((a) => a.type === "breakout" && a.symbol === "MOVE")).toBe(true);
  });

  it("flags valuation when analyst upside is large", () => {
    const alerts = computeWatchlistAlerts([summary({ symbol: "CHEAP", analystUpside: 25 })]);
    expect(alerts.some((a) => a.type === "valuation" && a.symbol === "CHEAP")).toBe(true);
  });

  it("sorts by severity (high, medium, low) and caps at 8", () => {
    const many: WatchlistStockSummary[] = Array.from({ length: 12 }, (_, i) =>
      summary({ symbol: `S${i}`, fundamentalScore: 75 }),
    );
    const alerts = computeWatchlistAlerts(many);
    expect(alerts.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < alerts.length; i++) {
      const order = { high: 0, medium: 1, low: 2 };
      expect(order[alerts[i - 1].severity]).toBeLessThanOrEqual(order[alerts[i].severity]);
    }
  });

  it("returns no alerts for a quiet, unremarkable stock", () => {
    const alerts = computeWatchlistAlerts([summary({ symbol: "QUIET", fundamentalScore: 55, momentumTrend: "flat" })]);
    expect(alerts).toHaveLength(0);
  });
});
