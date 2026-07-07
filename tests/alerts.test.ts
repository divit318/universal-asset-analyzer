import { describe, it, expect } from "vitest";
import {
  evaluateWatchlistAlerts,
  evaluatePortfolioAlerts,
  evaluateAlerts,
  type QuoteLite,
} from "@/lib/alerts";

const q = (price: number, changePercent: number, currency = "USD"): QuoteLite => ({
  price,
  changePercent,
  currency,
});

describe("evaluateWatchlistAlerts", () => {
  it("fires a price target when the price falls to or below it", () => {
    const items = [{ symbol: "AAPL", name: "Apple", targetPrice: 200, alertPctDrop: null }];
    const quotes = new Map([["AAPL", q(195, -1)]]);
    const alerts = evaluateWatchlistAlerts(items, quotes);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("price_target");
    expect(alerts[0].dedupKey).toBe("wt:AAPL:target");
  });

  it("does not fire a price target while the price is above it", () => {
    const items = [{ symbol: "AAPL", name: "Apple", targetPrice: 200, alertPctDrop: null }];
    expect(evaluateWatchlistAlerts(items, new Map([["AAPL", q(210, 1)]]))).toEqual([]);
  });

  it("fires a drop alert when today's decline breaches the threshold", () => {
    const items = [{ symbol: "TSLA", name: "Tesla", targetPrice: null, alertPctDrop: 10 }];
    const alerts = evaluateWatchlistAlerts(items, new Map([["TSLA", q(180, -12)]]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("drop_alert");
    expect(alerts[0].severity).toBe("warning");
  });

  it("does not fire a drop alert for a smaller decline", () => {
    const items = [{ symbol: "TSLA", name: "Tesla", targetPrice: null, alertPctDrop: 10 }];
    expect(evaluateWatchlistAlerts(items, new Map([["TSLA", q(180, -8)]]))).toEqual([]);
  });

  it("ignores items with no quote and no thresholds", () => {
    const items = [
      { symbol: "NONE", name: "No Quote", targetPrice: 10, alertPctDrop: 5 },
      { symbol: "AAPL", name: "Apple", targetPrice: null, alertPctDrop: null },
    ];
    expect(evaluateWatchlistAlerts(items, new Map([["AAPL", q(195, -20)]]))).toEqual([]);
  });

  it("can fire both a target and a drop for the same symbol", () => {
    const items = [{ symbol: "AAPL", name: "Apple", targetPrice: 200, alertPctDrop: 5 }];
    const alerts = evaluateWatchlistAlerts(items, new Map([["AAPL", q(190, -6)]]));
    expect(alerts.map((a) => a.kind).sort()).toEqual(["drop_alert", "price_target"]);
  });
});

describe("evaluatePortfolioAlerts", () => {
  it("fires a big-move alert past the default 7% threshold, up or down", () => {
    const positions = [
      { symbol: "NVDA", name: "Nvidia" },
      { symbol: "MSFT", name: "Microsoft" },
    ];
    const quotes = new Map([
      ["NVDA", q(200, 9)], // up big
      ["MSFT", q(400, -8)], // down big
    ]);
    const alerts = evaluatePortfolioAlerts(positions, quotes);
    expect(alerts).toHaveLength(2);
    expect(alerts.find((a) => a.symbol === "NVDA")!.severity).toBe("info");
    expect(alerts.find((a) => a.symbol === "MSFT")!.severity).toBe("warning");
  });

  it("respects a custom threshold and ignores small moves", () => {
    const positions = [{ symbol: "AAPL", name: "Apple" }];
    expect(evaluatePortfolioAlerts(positions, new Map([["AAPL", q(200, 4)]]))).toEqual([]);
    expect(evaluatePortfolioAlerts(positions, new Map([["AAPL", q(200, 4)]]), { bigMovePct: 3 })).toHaveLength(1);
  });
});

describe("evaluateAlerts", () => {
  it("combines watchlist and portfolio sources", () => {
    const alerts = evaluateAlerts({
      watchlist: [{ symbol: "AAPL", name: "Apple", targetPrice: 200, alertPctDrop: null }],
      positions: [{ symbol: "NVDA", name: "Nvidia" }],
      quotes: new Map([
        ["AAPL", q(199, -1)],
        ["NVDA", q(200, 9)],
      ]),
    });
    expect(alerts.map((a) => a.kind).sort()).toEqual(["big_move", "price_target"]);
  });
});
