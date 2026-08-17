import { describe, it, expect } from "vitest";
import type { Holding, PortfolioAssetClass } from "@/lib/portfolio/model/types";
import type { PortfolioAllocation, AllocationView } from "@/lib/portfolio/engines/allocation";
import type { UniversalRisk } from "@/lib/portfolio/engines/risk";
import type { HealthScore } from "@/lib/portfolio/engines/health";
import type { FundLookThrough, IntelligenceInput } from "@/lib/portfolio/intelligence/types";
import {
  computeEffectiveExposures,
  fundPairOverlap,
  lookThroughSectors,
  lookThroughCoverage,
  correlationClusters,
} from "@/lib/portfolio/intelligence/lookthrough";
import { runDetectors } from "@/lib/portfolio/intelligence/detectors";
import { diffSnapshots, snapshotOf } from "@/lib/portfolio/intelligence/engine";

/**
 * Portfolio Intelligence is a critic, and a critic that fabricates is worse
 * than none. The behaviours pinned here are the honesty properties:
 *
 *   1. Look-through exposure is exact arithmetic over the constituent weights —
 *      and a fund WITHOUT constituent data contributes nothing (unknown ≠ zero,
 *      but unknown is also never invented into exposure).
 *   2. Detectors emit nothing on a genuinely diversified book (`allClear` is a
 *      reachable state, not a decoration).
 *   3. The what-changed diff reports exactly what differs between two runs.
 */

/* ────────────────────────── Fixtures ────────────────────────── */

function h(o: {
  id: string;
  value: number;
  cost?: number;
  weight: number;
  assetClass?: PortfolioAssetClass;
  sector?: string | null;
  acquiredAt?: string;
  factors?: Holding["factors"];
}): Holding {
  const cost = o.cost ?? o.value;
  return {
    id: o.id,
    assetClass: o.assetClass ?? "equity",
    symbol: o.id,
    name: o.id,
    currency: "USD",
    quantity: 1,
    unit: "shares",
    costBasis: cost,
    costBasisBase: cost,
    acquiredAt: o.acquiredAt ?? "2025-01-01",
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
    unrealizedPL: cost > 0 ? o.value - cost : null,
    unrealizedPct: cost > 0 ? ((o.value - cost) / cost) * 100 : null,
    liquidity: "t0",
    income: null,
    factors: o.factors ?? {},
    metrics: {},
    attributes: { sector: o.sector === undefined ? "Technology" : o.sector },
    score: null,
    meta: {},
  };
}

function view(dimension: string, slices: { label: string; weight: number }[]): AllocationView {
  return {
    dimension,
    slices: slices.map((s) => ({
      key: s.label.toLowerCase(),
      label: s.label,
      value: s.weight * 1000,
      weight: s.weight,
      count: 1,
      avgScore: null,
    })),
    hhi: 0,
    unclassifiedPct: Math.max(0, 100 - slices.reduce((a, s) => a + s.weight, 0)),
  };
}

function allocation(over: Partial<PortfolioAllocation> = {}): PortfolioAllocation {
  return {
    byAssetClass: view("assetClass", [{ label: "Equity", weight: 100 }]),
    bySector: view("sector", [{ label: "Technology", weight: 40 }]),
    byGeography: view("geography", [{ label: "United States", weight: 50 }, { label: "Japan", weight: 30 }]),
    byCurrency: view("currency", [{ label: "USD", weight: 100 }]),
    byLiquidity: view("liquidity", [{ label: "T+0", weight: 100 }]),
    byFactor: [],
    ...over,
  };
}

function risk(over: Partial<UniversalRisk> = {}): UniversalRisk {
  return {
    annualizedVolatility: 12,
    beta: 1,
    benchmarkLabel: null,
    sharpeRatio: null,
    sortinoRatio: null,
    maxDrawdown: null,
    var95Pct: null,
    var95Dollar: null,
    cvar95Pct: null,
    cvar95Dollar: null,
    duration: null,
    creditSensitivity: null,
    foreignCurrencyPct: 0,
    fxExposurePct: 0,
    illiquidPct: 0,
    illiquidHoldings: 0,
    inflationSensitivity: null,
    positionHhi: 800,
    topHoldingWeight: 10,
    topAssetClassWeight: 60,
    topSectorWeight: 30,
    concentrationRisk: "low",
    coverage: {
      observedPct: 100,
      proxiedPct: 0,
      unmodelledPct: 0,
      holdingsObserved: 10,
      holdingsProxied: 0,
      holdingsUnmodelled: 0,
    },
    correlation: null,
    ...over,
  };
}

function health(): HealthScore {
  return { total: 75, totalExact: 75, grade: "B", dimensions: [], summary: "", coveragePct: 100 };
}

function fund(symbol: string, tops: [string, number][], over: Partial<FundLookThrough> = {}): FundLookThrough {
  return {
    symbol,
    topHoldings: tops.map(([s, w]) => ({ symbol: s, name: s, weightPercent: w })),
    top10Pct: tops.reduce((a, [, w]) => a + w, 0),
    sectorWeights: null,
    category: null,
    equityWeightPct: 99,
    ...over,
  };
}

function input(holdings: Holding[], funds: Map<string, FundLookThrough>, over: Partial<IntelligenceInput> = {}): IntelligenceInput {
  const totalValue = holdings.reduce((s, x) => s + x.valuation.valueBase, 0);
  return {
    holdings,
    totalValue,
    allocation: allocation(),
    risk: risk(),
    health: health(),
    attribution: null,
    baseCurrency: "USD",
    funds,
    ...over,
  };
}

/* ────────────────────────── Look-through arithmetic ────────────────────────── */

describe("computeEffectiveExposures", () => {
  it("sums direct and per-fund constituent slices exactly", () => {
    // NVDA: 6% direct + 12% QQQ × 9% + 5% SMH × 20% = 6 + 1.08 + 1.0 = 8.08%.
    const holdings = [
      h({ id: "NVDA", value: 6_000, weight: 6 }),
      h({ id: "QQQ", value: 12_000, weight: 12, assetClass: "etf" }),
      h({ id: "SMH", value: 5_000, weight: 5, assetClass: "etf" }),
    ];
    const funds = new Map([
      ["QQQ", fund("QQQ", [["NVDA", 9], ["AAPL", 8]])],
      ["SMH", fund("SMH", [["NVDA", 20], ["TSM", 12]])],
    ]);
    const exposures = computeEffectiveExposures(input(holdings, funds));
    const nvda = exposures.find((e) => e.symbol === "NVDA")!;

    expect(nvda.directPct).toBeCloseTo(6, 6);
    expect(nvda.indirectPct).toBeCloseTo(2.08, 6);
    expect(nvda.totalPct).toBeCloseTo(8.08, 6);
    // Sources carry the audit trail the finding renders.
    expect(nvda.sources.map((s) => s.via).sort()).toEqual(["QQQ", "SMH", "direct"]);
  });

  it("a fund with no constituent data contributes NOTHING — unknown is never invented into exposure", () => {
    const holdings = [
      h({ id: "NVDA", value: 6_000, weight: 6 }),
      h({ id: "MYSTERY", value: 50_000, weight: 50, assetClass: "etf" }),
    ];
    const exposures = computeEffectiveExposures(input(holdings, new Map()));
    const nvda = exposures.find((e) => e.symbol === "NVDA")!;
    expect(nvda.totalPct).toBeCloseTo(6, 6);
    expect(nvda.indirectPct).toBe(0);

    const coverage = lookThroughCoverage(input(holdings, new Map()));
    expect(coverage.fundsOpaque).toEqual(["MYSTERY"]);
    expect(coverage.lookThroughPct).toBe(0);
  });

  it("survives a cyclic fund-of-funds payload without looping", () => {
    const holdings = [h({ id: "A", value: 10_000, weight: 10, assetClass: "etf" })];
    const funds = new Map([
      ["A", fund("A", [["B", 50]])],
      ["B", fund("B", [["A", 50], ["NVDA", 10]])],
    ]);
    const exposures = computeEffectiveExposures(input(holdings, funds));
    // A(10%) → B(50%) → NVDA(10%): 10 × 0.5 × 0.1 = 0.5%; the A→B→A edge dies at the visited set.
    const nvda = exposures.find((e) => e.symbol === "NVDA")!;
    expect(nvda.totalPct).toBeCloseTo(0.5, 6);
  });
});

describe("fundPairOverlap", () => {
  it("is the sum of min-weights over shared names", () => {
    const a = fund("VOO", [["AAPL", 7], ["MSFT", 6.5], ["NVDA", 6]]);
    const b = fund("QQQ", [["AAPL", 9], ["NVDA", 8], ["AMZN", 5]]);
    const overlap = fundPairOverlap(a, b);
    // min(7,9) + min(6,8) = 13.
    expect(overlap.overlapPct).toBeCloseTo(13, 6);
    expect(overlap.shared.map((s) => s.symbol).sort()).toEqual(["AAPL", "NVDA"]);
  });
});

describe("lookThroughSectors", () => {
  it("distributes fund sector weights and never guesses unclassified value into a sector", () => {
    const holdings = [
      h({ id: "AAPL", value: 10_000, weight: 10, sector: "Technology" }),
      h({ id: "VOO", value: 40_000, weight: 40, assetClass: "etf" }),
      h({ id: "GOLD-BAR", value: 50_000, weight: 50, assetClass: "commodity", sector: null }),
    ];
    const funds = new Map([
      ["VOO", fund("VOO", [["AAPL", 7]], {
        sectorWeights: [
          { sector: "Technology", weightPercent: 30 },
          { sector: "Financial Services", weightPercent: 15 },
        ],
        equityWeightPct: 100,
      })],
    ]);
    const { sectors, classifiedPct } = lookThroughSectors(input(holdings, funds));
    const tech = sectors.find((s) => s.sector === "Technology")!;
    // 10 direct + 40 × 30% = 22.
    expect(tech.pct).toBeCloseTo(22, 6);
    expect(tech.viaFundsPct).toBeCloseTo(12, 6);
    // Only the classifiable 10 + 40×45% was classified; the gold bar was not.
    expect(classifiedPct).toBeCloseTo(28, 6);
  });
});

describe("correlationClusters", () => {
  it("joins on r >= threshold and never joins on NaN (unknown is not high)", () => {
    const symbols = ["A", "B", "C", "D"];
    const matrix = [
      [1, 0.9, NaN, 0.1],
      [0.9, 1, 0.88, 0.1],
      [NaN, 0.88, 1, 0.1],
      [0.1, 0.1, 0.1, 1],
    ];
    const clusters = correlationClusters(symbols, matrix, 0.85);
    expect(clusters).toHaveLength(1);
    expect([...clusters[0]].sort()).toEqual(["A", "B", "C"]);
  });
});

/* ────────────────────────── Detector honesty ────────────────────────── */

describe("runDetectors", () => {
  it("fires hidden concentration with the exact effective figure", () => {
    const holdings = [
      h({ id: "NVDA", value: 6_000, weight: 6 }),
      h({ id: "QQQ", value: 30_000, weight: 30, assetClass: "etf" }),
      h({ id: "SMH", value: 10_000, weight: 10, assetClass: "etf" }),
      h({ id: "KO", value: 54_000, weight: 54, sector: "Consumer Defensive" }),
    ];
    const funds = new Map([
      ["QQQ", fund("QQQ", [["NVDA", 9]])],
      ["SMH", fund("SMH", [["NVDA", 20]])],
    ]);
    const findings = runDetectors(input(holdings, funds));
    const hidden = findings.find((f) => f.id === "hidden-concentration:NVDA")!;

    expect(hidden).toBeDefined();
    // 6 + 30×0.09 + 10×0.20 = 10.7 — and it must be presented as a lower bound.
    expect(hidden.headline).toContain("10.7%");
    expect(hidden.caveat).toMatch(/lower bound/i);
    // Every evidence line is labelled observed or derived — nothing unlabelled.
    expect(hidden.evidence.every((e) => e.basis === "observed" || e.basis === "derived")).toBe(true);
  });

  it("emits NOTHING on a genuinely diversified book — allClear is reachable", () => {
    const holdings = [
      h({ id: "AAPL", value: 12_000, weight: 12, sector: "Technology" }),
      h({ id: "JNJ", value: 12_000, weight: 12, sector: "Healthcare" }),
      h({ id: "JPM", value: 12_000, weight: 12, sector: "Financial Services" }),
      h({ id: "XOM", value: 12_000, weight: 12, sector: "Energy" }),
      h({ id: "PG", value: 12_000, weight: 12, sector: "Consumer Defensive" }),
      h({ id: "CAT", value: 12_000, weight: 12, sector: "Industrials" }),
      h({ id: "NEE", value: 12_000, weight: 12, sector: "Utilities" }),
      h({ id: "AMT", value: 16_000, weight: 16, assetClass: "reit", sector: "Real Estate" }),
    ];
    const findings = runDetectors(input(holdings, new Map()));
    expect(findings).toEqual([]);
  });

  it("flags a winner that grew into its size, and stays silent when size was chosen", () => {
    const grown = [
      // 20% of value from 8% of capital (+250%): the market chose this weight.
      h({ id: "WIN", value: 20_000, cost: 4_000, weight: 20 }),
      h({ id: "REST", value: 80_000, cost: 46_000, weight: 80, sector: "Healthcare" }),
    ];
    const grownFindings = runDetectors(input(grown, new Map()));
    expect(grownFindings.some((f) => f.detector === "winner-concentration")).toBe(true);

    const chosen = [
      h({ id: "BIG", value: 20_000, cost: 19_000, weight: 20 }),
      h({ id: "REST", value: 80_000, cost: 76_000, weight: 80, sector: "Healthcare" }),
    ];
    const chosenFindings = runDetectors(input(chosen, new Map()));
    expect(chosenFindings.some((f) => f.detector === "winner-concentration")).toBe(false);
  });

  it("clusters correlated holdings into one bet with their combined weight", () => {
    const holdings = [
      h({ id: "GDX", value: 15_000, weight: 15, sector: "Basic Materials" }),
      h({ id: "GOLD", value: 10_000, weight: 10, sector: "Basic Materials" }),
      h({ id: "IAU", value: 8_000, weight: 8, assetClass: "commodity", sector: null }),
      h({ id: "MSFT", value: 67_000, weight: 67 }),
    ];
    const symbols = ["GDX", "GOLD", "IAU", "MSFT"];
    const matrix = [
      [1, 0.93, 0.9, 0.2],
      [0.93, 1, 0.87, 0.2],
      [0.9, 0.87, 1, 0.2],
      [0.2, 0.2, 0.2, 1],
    ];
    const findings = runDetectors(
      input(holdings, new Map(), {
        risk: risk({
          correlation: {
            symbols,
            matrix,
            highPairs: [
              { a: "GDX", b: "GOLD", r: 0.93 },
              { a: "GDX", b: "IAU", r: 0.9 },
              { a: "GOLD", b: "IAU", r: 0.87 },
            ],
            avgCorrelation: 0.5,
            excluded: [],
          },
        }),
      }),
    );
    const cluster = findings.find((f) => f.detector === "correlation-cluster")!;
    expect(cluster).toBeDefined();
    expect(cluster.weightPct).toBeCloseTo(33, 6);
    expect(cluster.title).toContain("3 holdings");
  });
});

/* ────────────────────────── What changed ────────────────────────── */

describe("diffSnapshots", () => {
  const holdingsA = [
    h({ id: "AAPL", value: 50_000, weight: 50 }),
    h({ id: "VOO", value: 50_000, weight: 50, assetClass: "etf" }),
  ];
  const findingsA = [{ id: "f1", title: "Finding one", severity: "high" as const }];

  it("first run is the baseline: since=null, nothing reported changed", () => {
    const current = snapshotOf(holdingsA, findingsA, "2026-08-10T00:00:00Z");
    const diff = diffSnapshots(current, null);
    expect(diff.since).toBeNull();
    expect(diff.changed).toBe(false);
  });

  it("reports adds, removes, material resizes, and finding churn — nothing else", () => {
    const prev = snapshotOf(holdingsA, findingsA, "2026-08-01T00:00:00Z");
    const holdingsB = [
      h({ id: "AAPL", value: 60_000, weight: 60 }), // resized +10pp
      h({ id: "NVDA", value: 40_000, weight: 40 }), // added; VOO removed
    ];
    const findingsB = [{ id: "f2", title: "Finding two", severity: "medium" as const }];
    const current = snapshotOf(holdingsB, findingsB, "2026-08-10T00:00:00Z");
    const diff = diffSnapshots(current, prev);

    expect(diff.changed).toBe(true);
    expect(diff.since).toBe("2026-08-01T00:00:00Z");
    expect(diff.holdingsAdded).toEqual(["NVDA"]);
    expect(diff.holdingsRemoved).toEqual(["VOO"]);
    expect(diff.resized).toEqual([{ label: "AAPL", fromPct: 50, toPct: 60 }]);
    expect(diff.newFindings).toEqual(["Finding two"]);
    expect(diff.resolvedFindings).toEqual(["Finding one"]);
  });

  it("a sub-threshold weight wiggle is not a change — price drift must not spam the diff", () => {
    const prev = snapshotOf(holdingsA, findingsA, "2026-08-01T00:00:00Z");
    const wiggled = [
      h({ id: "AAPL", value: 51_000, weight: 51 }),
      h({ id: "VOO", value: 49_000, weight: 49, assetClass: "etf" }),
    ];
    const diff = diffSnapshots(snapshotOf(wiggled, findingsA, "2026-08-10T00:00:00Z"), prev);
    expect(diff.changed).toBe(false);
    expect(diff.resized).toEqual([]);
  });
});
