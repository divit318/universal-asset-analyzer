import { describe, it, expect } from "vitest";
import { computeAttribution, attributionResidual } from "@/lib/portfolio/engines/attribution";
import type { Holding, PortfolioAssetClass } from "@/lib/portfolio/model/types";

/**
 * A holding with a known cost basis and current value. `weight` is set by the
 * caller because attribution reads it but never derives it.
 */
function h(o: {
  id: string;
  value: number;
  cost: number;
  weight: number;
  assetClass?: PortfolioAssetClass;
  sector?: string | null;
}): Holding {
  const pl = o.cost > 0 ? o.value - o.cost : null;
  return {
    id: o.id,
    assetClass: o.assetClass ?? "equity",
    symbol: o.id,
    name: o.id,
    currency: "USD",
    quantity: 1,
    unit: "shares",
    costBasis: o.cost,
    costBasisBase: o.cost,
    acquiredAt: "2025-01-01",
    valuation: {
      mode: "market",
      value: o.value,
      valueBase: o.value,
      fxRate: 1,
      source: "yahoo",
      asOf: "2025-06-01",
      stale: false,
    },
    weight: o.weight,
    unrealizedPL: pl,
    unrealizedPct: o.cost > 0 ? ((o.value - o.cost) / o.cost) * 100 : null,
    liquidity: "t0",
    income: null,
    factors: {},
    metrics: {},
    attributes: { sector: o.sector === undefined ? "Technology" : o.sector },
    score: null,
    meta: {},
  };
}

describe("computeAttribution — additivity", () => {
  it("contributions sum exactly to the total return", () => {
    const a = computeAttribution([
      h({ id: "A", value: 12_000, cost: 10_000, weight: 40 }),
      h({ id: "B", value: 9_000, cost: 10_000, weight: 30 }),
      h({ id: "C", value: 10_500, cost: 10_000, weight: 30 }),
    ])!;

    // Total: 31,500 on 30,000 cost = +5.0%.
    expect(a.totalReturnPct).toBeCloseTo(5, 10);
    expect(a.totalPnl).toBeCloseTo(1_500, 10);
    // The property that makes the decomposition checkable rather than trusted.
    expect(attributionResidual(a)).toBeCloseTo(0, 10);
  });

  it("carries the audit trail the UI drill-down shows: cost, value, and the shared denominator", () => {
    const a = computeAttribution([
      h({ id: "A", value: 12_000, cost: 10_000, weight: 40 }),
      h({ id: "B", value: 9_000, cost: 10_000, weight: 30 }),
    ])!;

    // The denominator every contribution is divided by — the attributable set's cost.
    expect(a.totalCostBase).toBeCloseTo(20_000, 10);

    const A = a.contributors.find((c) => c.id === "A")!;
    expect(A.costBase).toBeCloseTo(10_000, 10);
    expect(A.valueBase).toBeCloseTo(12_000, 10);
    // The arithmetic the expanded row spells out must actually hold:
    // contribution = pnl ÷ totalCostBase.
    expect(A.contributionPct).toBeCloseTo((A.pnl / a.totalCostBase) * 100, 10);
  });

  it("uses the portfolio's own cost as the denominator, not each position's", () => {
    const a = computeAttribution([
      h({ id: "BIG", value: 101_000, cost: 100_000, weight: 90 }),
      h({ id: "TINY", value: 2_000, cost: 1_000, weight: 10 }),
    ])!;

    const big = a.contributors.find((c) => c.id === "BIG")!;
    const tiny = a.contributors.find((c) => c.id === "TINY")!;

    // TINY doubled — a +100% position — but on 1% of the capital, so it moved the
    // portfolio by ~0.99pp. BIG gained only 1% but on 99% of the capital, so it
    // moved it by ~0.99pp too. Ranking by own-return would put TINY 100x ahead;
    // contribution correctly says they mattered about the same.
    expect(tiny.ownReturnPct).toBeCloseTo(100, 6);
    expect(big.ownReturnPct).toBeCloseTo(1, 6);
    expect(tiny.contributionPct).toBeCloseTo(big.contributionPct, 6);
    expect(attributionResidual(a)).toBeCloseTo(0, 10);
  });

  it("still adds up when some holdings have no cost basis", () => {
    const a = computeAttribution([
      h({ id: "A", value: 12_000, cost: 10_000, weight: 45 }),
      h({ id: "B", value: 9_000, cost: 10_000, weight: 45 }),
      // No basis: an UNKNOWN contribution, not a zero one.
      h({ id: "GIFT", value: 5_000, cost: 0, weight: 10 }),
    ])!;

    expect(a.excluded.map((e) => e.name)).toEqual(["GIFT"]);
    // The decomposition describes the attributable set, and sums over it exactly.
    expect(a.totalReturnPct).toBeCloseTo(5, 10);
    expect(attributionResidual(a)).toBeCloseTo(0, 10);
  });

  it("returns null when nothing is attributable rather than a zeroed shell", () => {
    expect(computeAttribution([h({ id: "X", value: 100, cost: 0, weight: 100 })])).toBeNull();
    expect(computeAttribution([])).toBeNull();
  });
});

describe("computeAttribution — carrying vs dragging", () => {
  const book = () => [
    h({ id: "WIN1", value: 15_000, cost: 10_000, weight: 30 }),
    h({ id: "WIN2", value: 11_000, cost: 10_000, weight: 22 }),
    h({ id: "LOSE1", value: 7_000, cost: 10_000, weight: 14 }),
    h({ id: "FLAT", value: 10_000, cost: 10_000, weight: 20 }),
  ];

  it("splits contributors by sign and orders each side by magnitude", () => {
    const a = computeAttribution(book())!;
    expect(a.carrying.map((c) => c.id)).toEqual(["WIN1", "WIN2"]);
    expect(a.dragging.map((c) => c.id)).toEqual(["LOSE1"]);
    // A flat position is neither, and must not pad either list.
    expect([...a.carrying, ...a.dragging].map((c) => c.id)).not.toContain("FLAT");
  });

  it("counts winners and losers, excluding flat positions", () => {
    const a = computeAttribution(book())!;
    expect(a.winners).toBe(2);
    expect(a.losers).toBe(1);
  });

  it("orders dragging most-negative first", () => {
    const a = computeAttribution([
      h({ id: "SMALL_LOSS", value: 9_500, cost: 10_000, weight: 50 }),
      h({ id: "BIG_LOSS", value: 4_000, cost: 10_000, weight: 50 }),
    ])!;
    expect(a.dragging.map((c) => c.id)).toEqual(["BIG_LOSS", "SMALL_LOSS"]);
  });
});

describe("computeAttribution — concentration of return", () => {
  it("reports a single-driver result as ~1 effective driver", () => {
    const a = computeAttribution([
      h({ id: "HERO", value: 20_000, cost: 10_000, weight: 50 }),
      h({ id: "FLAT1", value: 10_000, cost: 10_000, weight: 25 }),
      h({ id: "FLAT2", value: 10_000, cost: 10_000, weight: 25 }),
    ])!;

    // One name produced 100% of the movement. A +33% return that is entirely one
    // position is a different portfolio from a +33% return spread over twenty.
    expect(a.top3SharePct).toBeCloseTo(100, 6);
    expect(a.effectiveDrivers).toBeCloseTo(1, 6);
  });

  it("reports a broad result as many effective drivers", () => {
    // Ten names each up exactly 10% on equal capital.
    const a = computeAttribution(
      Array.from({ length: 10 }, (_, i) =>
        h({ id: `N${i}`, value: 11_000, cost: 10_000, weight: 10 }),
      ),
    )!;
    expect(a.effectiveDrivers).toBeCloseTo(10, 6);
    expect(a.top3SharePct).toBeCloseTo(30, 6);
  });

  it("measures GROSS movement, so offsetting winners and losers are both drivers", () => {
    // Net return is exactly zero; two positions were extremely active.
    const a = computeAttribution([
      h({ id: "UP", value: 15_000, cost: 10_000, weight: 50 }),
      h({ id: "DOWN", value: 5_000, cost: 10_000, weight: 50 }),
    ])!;

    expect(a.totalReturnPct).toBeCloseTo(0, 10);
    // Netting to zero would report "no drivers" — the opposite of the truth.
    expect(a.effectiveDrivers).toBeCloseTo(2, 6);
    expect(a.top3SharePct).toBeCloseTo(100, 6);
  });

  it("reports zero gross movement, so 'nothing moved' is not read as 'evenly spread'", () => {
    // A brand-new portfolio: every position still exactly at cost. `top3SharePct`
    // is 0 here for the same reason it is 0 for a perfectly even spread, and the
    // broad/narrow bands alone reported this as a green "Broad result" with "0.0
    // effective drivers" that was "broadly sourced" — zero drivers described as
    // diversification, and the first thing a new user would have seen.
    const a = computeAttribution([
      h({ id: "A", value: 10_000, cost: 10_000, weight: 50 }),
      h({ id: "B", value: 10_000, cost: 10_000, weight: 50 }),
    ])!;

    expect(a.grossMovement).toBe(0);
    expect(a.totalReturnPct).toBe(0);
    expect(a.winners).toBe(0);
    expect(a.losers).toBe(0);
    // The panel branches on grossMovement, so these staying 0 is fine — but the
    // flag has to exist for it to branch on.
    expect(a.top3SharePct).toBe(0);
    expect(a.effectiveDrivers).toBe(0);
  });

  it("reports positive gross movement as soon as anything has moved", () => {
    const a = computeAttribution([
      h({ id: "A", value: 10_001, cost: 10_000, weight: 50 }),
      h({ id: "B", value: 10_000, cost: 10_000, weight: 50 }),
    ])!;
    expect(a.grossMovement).toBeCloseTo(1, 6);
  });

  it("counts offsetting moves in gross movement rather than netting them away", () => {
    const a = computeAttribution([
      h({ id: "UP", value: 15_000, cost: 10_000, weight: 50 }),
      h({ id: "DOWN", value: 5_000, cost: 10_000, weight: 50 }),
    ])!;
    // Net return is zero, but $10,000 of movement genuinely happened.
    expect(a.totalReturnPct).toBeCloseTo(0, 10);
    expect(a.grossMovement).toBeCloseTo(10_000, 6);
  });

  it("is not fooled into calling a dust position a driver", () => {
    const a = computeAttribution([
      h({ id: "REAL", value: 120_000, cost: 100_000, weight: 99 }),
      h({ id: "DUST", value: 12, cost: 10, weight: 1 }),
    ])!;
    const dust = a.contributors.find((c) => c.id === "DUST")!;
    expect(dust.shareOfMovementPct).toBeLessThan(0.02);
    expect(a.effectiveDrivers).toBeCloseTo(1, 3);
  });
});

describe("computeAttribution — grouping", () => {
  it("asset-class contributions sum to the total return", () => {
    const a = computeAttribution([
      h({ id: "STK", value: 12_000, cost: 10_000, weight: 40, assetClass: "equity" }),
      h({ id: "BND", value: 9_800, cost: 10_000, weight: 30, assetClass: "bond" }),
      h({ id: "GLD", value: 11_000, cost: 10_000, weight: 30, assetClass: "commodity" }),
    ])!;

    const sum = a.byAssetClass.reduce((s, g) => s + g.contributionPct, 0);
    expect(sum).toBeCloseTo(a.totalReturnPct, 10);
    // Ordered best-contributing first.
    expect(a.byAssetClass[0].key).toBe("equity");
    expect(a.byAssetClass.at(-1)!.key).toBe("bond");
  });

  it("omits unsectored holdings from the sector view without corrupting it", () => {
    const a = computeAttribution([
      h({ id: "TECH", value: 12_000, cost: 10_000, weight: 50, sector: "Technology" }),
      // Bonds and cash have no sector; they must not become a phantom group.
      h({ id: "BND", value: 10_500, cost: 10_000, weight: 50, sector: null }),
    ])!;

    expect(a.bySector.map((g) => g.key)).toEqual(["Technology"]);
    // The sector view covers only part of the book, so it sums to LESS than the
    // total — which is correct, and why the UI labels it as a partial view.
    const sum = a.bySector.reduce((s, g) => s + g.contributionPct, 0);
    expect(sum).toBeLessThan(a.totalReturnPct);
    expect(sum).toBeCloseTo(10, 6); // 2,000 / 20,000
  });
});
