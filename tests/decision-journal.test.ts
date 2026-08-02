import { describe, it, expect } from "vitest";
import { evaluateDecision, computeTrackRecord } from "@/lib/decision-journal";
import type { Decision } from "@/lib/types";

let nextId = 1;
function dec(o: Partial<Decision> & { action: Decision["action"] }): Decision {
  return {
    id: nextId++,
    symbol: "AAPL",
    name: "Apple",
    conviction: 3,
    thesis: null,
    priceAt: 100,
    currency: "USD",
    targetPrice: null,
    horizon: "medium",
    fitScore: null,
    fitTier: null,
    status: "open",
    closePrice: null,
    closedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    caseVersion: null,
    ...o,
  };
}

describe("evaluateDecision", () => {
  it("scores a winning buy as a hit", () => {
    const o = evaluateDecision(dec({ action: "buy", priceAt: 100 }), 120);
    expect(o.returnPct).toBeCloseTo(0.2, 6);
    expect(o.directionalReturnPct).toBeCloseTo(0.2, 6);
    expect(o.hit).toBe(true);
  });

  it("scores a buy that fell as a miss", () => {
    const o = evaluateDecision(dec({ action: "buy", priceAt: 100 }), 80);
    expect(o.hit).toBe(false);
    expect(o.directionalReturnPct).toBeCloseTo(-0.2, 6);
  });

  it("inverts direction for avoid/sell (correct when price falls)", () => {
    const o = evaluateDecision(dec({ action: "avoid", priceAt: 100 }), 80);
    expect(o.directionalReturnPct).toBeCloseTo(0.2, 6); // avoiding a -20% stock was right
    expect(o.hit).toBe(true);
  });

  it("treats hold as neutral (no directional score)", () => {
    const o = evaluateDecision(dec({ action: "hold", priceAt: 100 }), 130);
    expect(o.directionalReturnPct).toBeNull();
    expect(o.hit).toBeNull();
  });

  it("uses the recorded close price for closed decisions", () => {
    const o = evaluateDecision(
      dec({ action: "buy", priceAt: 100, status: "closed", closePrice: 150 }),
      9999, // live price ignored when closed
    );
    expect(o.markPrice).toBe(150);
    expect(o.directionalReturnPct).toBeCloseTo(0.5, 6);
  });

  it("reports target hit for a bullish decision", () => {
    const o = evaluateDecision(dec({ action: "buy", priceAt: 100, targetPrice: 120 }), 125);
    expect(o.targetHit).toBe(true);
  });

  it("returns nulls when price data is missing", () => {
    const o = evaluateDecision(dec({ action: "buy", priceAt: null }), 120);
    expect(o.returnPct).toBeNull();
    expect(o.hit).toBeNull();
  });
});

describe("computeTrackRecord", () => {
  const decisions: Decision[] = [
    dec({ symbol: "AAPL", action: "buy", conviction: 5, priceAt: 100, fitTier: "excellent" }),
    dec({ symbol: "MSFT", action: "buy", conviction: 5, priceAt: 100, fitTier: "excellent" }),
    dec({ symbol: "TSLA", action: "buy", conviction: 1, priceAt: 100, fitTier: "poor" }),
    dec({ symbol: "HOLDCO", action: "hold", conviction: 3, priceAt: 100 }), // excluded from hit rate
  ];
  const prices = new Map([
    ["AAPL", 130], // +30% win
    ["MSFT", 110], // +10% win
    ["TSLA", 70], // -30% loss
    ["HOLDCO", 200],
  ]);

  it("computes overall hit rate and avg return over scored decisions only", () => {
    const tr = computeTrackRecord(decisions, prices);
    expect(tr.total).toBe(4);
    expect(tr.scored).toBe(3); // hold excluded
    expect(tr.hitRate).toBeCloseTo(2 / 3, 6);
    expect(tr.avgReturnPct).toBeCloseTo((0.3 + 0.1 - 0.3) / 3, 6);
  });

  it("breaks out calibration by conviction and by fit tier", () => {
    const tr = computeTrackRecord(decisions, prices);
    const conv5 = tr.byConviction.find((g) => g.key === "5")!;
    expect(conv5.count).toBe(2);
    expect(conv5.hitRate).toBe(1); // both conviction-5 calls won
    const excellent = tr.byFitTier.find((g) => g.key === "excellent")!;
    expect(excellent.hitRate).toBe(1);
    const poor = tr.byFitTier.find((g) => g.key === "poor")!;
    expect(poor.hitRate).toBe(0);
  });

  it("identifies best and worst calls", () => {
    const tr = computeTrackRecord(decisions, prices);
    expect(tr.best?.symbol).toBe("AAPL");
    expect(tr.worst?.symbol).toBe("TSLA");
  });
});
