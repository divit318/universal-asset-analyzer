import { describe, expect, it } from "vitest";
import {
  canonicalIssuerSymbol,
  computeEffectiveExposures,
} from "@/lib/portfolio/intelligence/lookthrough";
import type { FundLookThrough, IntelligenceInput } from "@/lib/portfolio/intelligence/types";
import type { Holding } from "@/lib/portfolio/model/types";
import { assembleDrivers } from "@/lib/exposure/drivers";
import {
  blastRadius,
  compareIssuers,
  indexGraph,
  neighboursOf,
  positionFan,
  resolveExplore,
  traceIssuer,
} from "@/lib/exposure/query";
import type { ExposureGraph, ExposureModel } from "@/lib/exposure/types";

/* ────────────────────────────── Fixtures ────────────────────────────── */

function holding(partial: Partial<Holding> & { symbol: string; weight: number }): Holding {
  return {
    id: partial.symbol,
    assetClass: "equity",
    name: partial.symbol,
    currency: "USD",
    quantity: 1,
    unit: "shares",
    costBasis: 0,
    costBasisBase: 0,
    acquiredAt: "2024-01-01",
    valuation: {
      mode: "market",
      value: partial.weight,
      valueBase: partial.weight,
      fxRate: 1,
      source: "yahoo",
      asOf: "2026-08-12T20:00:00.000Z",
      stale: false,
    },
    unrealizedPL: null,
    unrealizedPct: null,
    liquidity: "t0",
    income: null,
    factors: {},
    metrics: {},
    attributes: {},
    score: null,
    meta: {},
    ...partial,
  } as Holding;
}

function fund(symbol: string, holdings: [string, number][], top10 = 100): FundLookThrough {
  return {
    symbol,
    topHoldings: holdings.map(([s, w]) => ({ symbol: s, name: s, weightPercent: w })),
    top10Pct: top10,
    sectorWeights: null,
    category: "Large Blend",
    equityWeightPct: 100,
  };
}

/**
 * The canonical book this whole feature exists for: NVDA bought once and owned
 * three more times without noticing.
 */
function input(): IntelligenceInput {
  return {
    holdings: [
      holding({ symbol: "NVDA", weight: 6.1 }),
      holding({ symbol: "VOO", weight: 20.4, assetClass: "etf" }),
      holding({ symbol: "VGT", weight: 11.2, assetClass: "etf" }),
      holding({ symbol: "MSFT", weight: 4 }),
      holding({ symbol: "CASH-USD", weight: 10, assetClass: "cash" }),
    ],
    totalValue: 100,
    // The exposure model never reads these; they exist so the detector context
    // that shares this input type can be constructed.
    allocation: {} as IntelligenceInput["allocation"],
    risk: { correlation: null } as unknown as IntelligenceInput["risk"],
    health: {} as IntelligenceInput["health"],
    attribution: null,
    baseCurrency: "USD",
    funds: new Map([
      ["VOO", fund("VOO", [["NVDA", 7.1], ["MSFT", 6.5], ["2330.TW", 1.0]], 14.6)],
      ["VGT", fund("VGT", [["NVDA", 14.8], ["MSFT", 15.2]], 30)],
    ]),
  };
}

/* ────────────────────────── Effective exposure ────────────────────────── */

describe("computeEffectiveExposures", () => {
  it("sums the direct position and every fund route into one effective figure", () => {
    const nvda = computeEffectiveExposures(input()).find((e) => e.symbol === "NVDA")!;
    expect(nvda.directPct).toBeCloseTo(6.1, 2);
    // 20.4 × 7.1% = 1.4484 ; 11.2 × 14.8% = 1.6576
    expect(nvda.indirectPct).toBeCloseTo(3.11, 2);
    expect(nvda.totalPct).toBeCloseTo(9.21, 2);
    expect(nvda.sources.map((s) => s.via).sort()).toEqual(["VGT", "VOO", "direct"]);
  });

  it("reports the issuer's weight inside each wrapper, so the arithmetic can be shown", () => {
    const nvda = computeEffectiveExposures(input()).find((e) => e.symbol === "NVDA")!;
    const voo = nvda.sources.find((s) => s.via === "VOO")!;
    expect(voo.innerPct).toBeCloseTo(7.1, 1);
    expect(voo.pct).toBeCloseTo((20.4 * 7.1) / 100, 2);
    expect(nvda.sources.find((s) => s.via === "direct")!.innerPct).toBe(100);
  });

  it("counts a local listing and its ADR as one company", () => {
    const tsm = computeEffectiveExposures(input()).find((e) => e.symbol === "TSM");
    // VOO discloses 2330.TW; the book's issuer space must call that TSM.
    expect(tsm).toBeDefined();
    expect(tsm!.indirectPct).toBeCloseTo(0.2, 2);
  });

  it("never turns cash, crypto or a bond sleeve into an issuer", () => {
    const symbols = computeEffectiveExposures(input()).map((e) => e.symbol);
    expect(symbols).not.toContain("CASH-USD");
  });
});

describe("canonicalIssuerSymbol", () => {
  it("maps a known local listing to its ADR", () => {
    expect(canonicalIssuerSymbol("2330.TW")).toBe("TSM");
    expect(canonicalIssuerSymbol("asml.as")).toBe("ASML");
  });

  it("passes an unknown listing through — under-report, never guess", () => {
    expect(canonicalIssuerSymbol("1299.HK")).toBe("1299.HK");
    expect(canonicalIssuerSymbol("AAPL")).toBe("AAPL");
  });
});

/* ────────────────────────────── The graph ────────────────────────────── */

/** Build a model the way lib/exposure/model.ts does, without the I/O. */
function model(): ExposureModel {
  const exposures = computeEffectiveExposures(input());
  const positions = [
    { label: "NVDA", weight: 6.1, fund: false },
    { label: "VOO", weight: 20.4, fund: true },
    { label: "VGT", weight: 11.2, fund: true },
    { label: "MSFT", weight: 4, fund: false },
    { label: "CASH-USD", weight: 10, fund: false },
  ].map((p) => ({
    id: `position:${p.label}`,
    kind: "position" as const,
    label: p.label,
    symbol: p.label,
    name: p.label,
    assetClass: (p.fund ? "etf" : "equity") as ExposureModel["positions"][number]["assetClass"],
    weightPct: p.weight,
    valueBase: p.weight,
    unrealizedPct: null,
    isFund: p.fund,
    lookThrough: p.fund
      ? { disclosedPct: 30, undisclosedPct: 70, category: null, sectorWeights: null, equityWeightPct: 100 }
      : null,
    opaque: false,
    href: null,
  }));

  const issuers = exposures.map((e) => ({
    id: `issuer:${e.symbol}`,
    kind: "issuer" as const,
    symbol: e.symbol,
    name: e.name,
    effectivePct: e.totalPct,
    directPct: e.directPct,
    indirectPct: e.indirectPct,
    routeCount: e.sources.length,
    industry: null,
    sector: null,
    heldDirectly: e.directPct > 0,
    href: "",
  }));

  const edges: ExposureModel["edges"] = [];
  for (const e of exposures) {
    for (const s of e.sources) {
      edges.push({
        id: `${s.via}:${e.symbol}`,
        from: s.via === "direct" ? `position:${e.symbol}` : `position:${s.via}`,
        to: `issuer:${e.symbol}`,
        kind: s.via === "direct" ? "IS" : "CONTAINS",
        bookPct: s.pct,
        innerPct: s.innerPct,
        path: s.nested,
        basis: s.via === "direct" ? "observed" : "derived",
        source: "test",
        asOf: null,
      });
    }
  }

  return {
    generatedAt: "2026-08-12T20:00:00.000Z",
    baseCurrency: "USD",
    portfolio: {
      id: "portfolio",
      kind: "portfolio",
      label: "Your portfolio",
      totalValue: 100,
      baseCurrency: "USD",
      holdingCount: positions.length,
    },
    positions,
    issuers,
    edges,
    concentration: { topIssuerIds: [], effectivePct: 0, statedPct: 0, hiddenPp: 0 },
    coverage: {
      fundsAnalyzed: 2,
      fundsOpaque: [],
      lookThroughPct: 100,
      issuerMappedPct: 90,
      unmappedLabels: ["CASH-USD"],
      basis: "floors, not totals",
      asOf: "2026-08-12T20:00:00.000Z",
    },
    coMovement: {
      labels: ["NVDA", "MSFT"],
      matrix: [
        [1, 0.88],
        [0.88, 1],
      ],
      window: "12 months",
      excluded: [],
    },
    findings: [],
  };
}

function graph(overrides: Partial<ExposureGraph> = {}): ExposureGraph {
  return {
    ...model(),
    drivers: [],
    driverEdges: [],
    driversState: "ready",
    unresolvedIssuers: [],
    probes: [],
    ...overrides,
  };
}

describe("traceIssuer", () => {
  it("returns every route, direct first, then largest", () => {
    const g = graph();
    const trace = traceIssuer(g, indexGraph(g), "issuer:NVDA")!;
    expect(trace.routes.map((r) => r.positionLabel)).toEqual(["NVDA", "VGT", "VOO"]);
    expect(trace.routes[0].kind).toBe("direct");
  });

  it("reconciles the summed routes with the issuer's effective weight", () => {
    const g = graph();
    const trace = traceIssuer(g, indexGraph(g), "issuer:NVDA")!;
    expect(trace.totalPct).toBeCloseTo(trace.issuer.effectivePct, 2);
  });

  it("states the part that arrived without being chosen", () => {
    const g = graph();
    const trace = traceIssuer(g, indexGraph(g), "issuer:NVDA")!;
    expect(trace.hiddenPp).toBeCloseTo(3.11, 2);
  });
});

describe("blastRadius", () => {
  it("keeps ownership, shared drivers and co-movement in separate tranches", () => {
    const g = graph({
      drivers: [
        {
          id: "driver:semis",
          kind: "driver",
          label: "Semiconductors",
          basis: [{ kind: "industry", detail: "test", n: 2, strength: null, window: null, via: null }],
          issuerIds: ["issuer:NVDA", "issuer:TSM"],
          bookPct: 9.41,
          positionCount: 3,
          labelFromAi: false,
        },
      ],
    });
    const blast = blastRadius(g, indexGraph(g), "issuer:NVDA")!;
    const kinds = blast.tranches.map((t) => t.kind);
    expect(kinds).toContain("self");
    expect(kinds).toContain("driver");
    expect(blast.tranches.find((t) => t.kind === "self")!.claim).toBe("ownership");
    expect(blast.tranches.find((t) => t.kind === "driver")!.claim).toBe("shared exposure");
  });

  it("never counts one issuer in two tranches", () => {
    const g = graph({
      drivers: [
        {
          id: "driver:x",
          kind: "driver",
          label: "X",
          basis: [{ kind: "industry", detail: "test", n: 2, strength: null, window: null, via: null }],
          issuerIds: ["issuer:NVDA", "issuer:MSFT"],
          bookPct: 20,
          positionCount: 3,
          labelFromAi: false,
        },
      ],
    });
    const blast = blastRadius(g, indexGraph(g), "issuer:NVDA")!;
    const seen = blast.tranches.flatMap((t) => t.members.map((m) => m.issuerId));
    // MSFT correlates at 0.88 AND shares a driver; it must appear exactly once.
    expect(seen.length).toBe(new Set(seen).size);
    expect(blast.tranches.find((t) => t.kind === "co-movement")).toBeUndefined();
  });

  it("returns only the ownership tranche when nothing else relates", () => {
    const g = graph({ coMovement: null });
    const blast = blastRadius(g, indexGraph(g), "issuer:TSM")!;
    expect(blast.tranches).toHaveLength(1);
    expect(blast.tranches[0].kind).toBe("self");
  });
});

describe("positionFan", () => {
  it("splits a fund into its constituents' contributions to the BOOK", () => {
    const g = graph();
    const fan = positionFan(g, indexGraph(g), "position:VOO")!;
    expect(fan.constituents.map((c) => c.symbol)).toEqual(["NVDA", "MSFT", "TSM"]);
    expect(fan.constituents[0].bookPct).toBeCloseTo((20.4 * 7.1) / 100, 2);
  });

  it("carries the undisclosed remainder rather than dropping it", () => {
    const g = graph();
    const fan = positionFan(g, indexGraph(g), "position:VOO")!;
    expect(fan.undisclosedPct).toBe(70);
  });

  it("finds the other lines reaching the same companies", () => {
    const g = graph();
    const fan = positionFan(g, indexGraph(g), "position:VOO")!;
    expect(fan.overlaps.map((o) => o.label)).toContain("VGT");
  });
});

describe("compareIssuers", () => {
  it("names the lines and the correlation that connect two companies", () => {
    const g = graph();
    const cmp = compareIssuers(g, indexGraph(g), "issuer:NVDA", "issuer:MSFT")!;
    expect(cmp.sharedRoutes.map((r) => r.label).sort()).toEqual(["VGT", "VOO"]);
    expect(cmp.correlation?.r).toBeCloseTo(0.88, 2);
    expect(cmp.related).toBe(true);
  });

  it("reports an unrelated pair as a result, not as an absence", () => {
    const g = graph({ coMovement: null });
    // MSFT and TSM share VOO in this fixture, so build a pair that shares nothing:
    const stripped: ExposureGraph = {
      ...g,
      edges: g.edges.filter((e) => !(e.to === "issuer:TSM" && e.from === "position:VOO")),
    };
    const cmp = compareIssuers(stripped, indexGraph(stripped), "issuer:NVDA", "issuer:TSM")!;
    expect(cmp.related).toBe(false);
    expect(cmp.sharedRoutes).toHaveLength(0);
  });
});

describe("neighboursOf", () => {
  it("gives an issuer its routes and drivers as onward links", () => {
    const g = graph();
    const n = neighboursOf(g, indexGraph(g), "issuer:NVDA");
    expect(n.map((x) => x.label)).toEqual(expect.arrayContaining(["VOO", "VGT", "NVDA"]));
  });

  it("gives a fund its constituents and its overlapping lines", () => {
    const g = graph();
    const n = neighboursOf(g, indexGraph(g), "position:VOO");
    expect(n.some((x) => x.kind === "issuer")).toBe(true);
    expect(n.some((x) => x.kind === "position" && x.label === "VGT")).toBe(true);
  });
});

describe("resolveExplore", () => {
  it("maps each finding kind to a view that can prove it", () => {
    const idx = indexGraph(graph());
    expect(resolveExplore(idx, { kind: "trace", target: "NVDA" })).toEqual({
      nodeId: "issuer:NVDA",
      view: "trace",
    });
    expect(resolveExplore(idx, { kind: "overlap", target: "VOO+VGT" })).toEqual({
      nodeId: "position:VOO",
      view: "overlap",
      secondaryId: "position:VGT",
    });
    expect(resolveExplore(idx, { kind: "position", target: "VOO" })).toEqual({
      nodeId: "position:VOO",
      view: "position",
    });
  });

  it("returns null rather than a broken link when the subject left the model", () => {
    const idx = indexGraph(graph());
    expect(resolveExplore(idx, { kind: "trace", target: "ZZZZ" })).toBeNull();
  });
});

/* ────────────────────────────── Drivers ────────────────────────────── */

describe("assembleDrivers", () => {
  const base = model();

  it("admits a driver only when it clears the book-share floor", () => {
    const tiny = assembleDrivers(
      { ...base, issuers: base.issuers.map((i) => ({ ...i, effectivePct: 0.4 })) },
      {
        profiles: new Map([
          ["NVDA", { industry: "Semiconductors", sector: "Technology" }],
          ["TSM", { industry: "Semiconductors", sector: "Technology" }],
        ]),
        memberships: [],
        unresolved: [],
      },
    );
    expect(tiny.drivers).toHaveLength(0);
  });

  it("requires at least two issuers", () => {
    const solo = assembleDrivers({ ...base, coMovement: null }, {
      profiles: new Map([["NVDA", { industry: "Semiconductors", sector: "Technology" }]]),
      memberships: [],
      unresolved: [],
    });
    expect(solo.drivers).toHaveLength(0);
  });

  it("never emits two drivers with the same label", () => {
    // The real-book failure this rule exists for: an industry classifier and a
    // reference fund both find the semiconductor group, disagree by one name,
    // and the page renders "Semiconductors 23.4%" above "Semiconductors 20.4%".
    const out = assembleDrivers({ ...base, coMovement: null }, {
      profiles: new Map([
        ["NVDA", { industry: "Semiconductors", sector: "Technology" }],
        ["TSM", { industry: "Semiconductors", sector: "Technology" }],
        ["MSFT", { industry: "Semiconductors", sector: "Technology" }],
      ]),
      memberships: [
        {
          via: "SMH",
          label: "Semiconductors",
          members: new Map([
            ["NVDA", 19.9],
            ["TSM", 11.2],
          ]),
        },
      ],
      unresolved: [],
    });
    const labels = out.drivers.map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(out.drivers).toHaveLength(1);
    // Union of both substrates, each keeping its own coverage count.
    expect(out.drivers[0].issuerIds.sort()).toEqual(["issuer:MSFT", "issuer:NVDA", "issuer:TSM"]);
    expect(out.drivers[0].basis.find((b) => b.kind === "co-membership")!.n).toBe(2);
    expect(out.drivers[0].basis.find((b) => b.kind === "industry")!.n).toBe(3);
  });

  it("merges agreeing substrates into one driver with several bases", () => {
    const out = assembleDrivers({ ...base, coMovement: null }, {
      profiles: new Map([
        ["NVDA", { industry: "Semiconductors", sector: "Technology" }],
        ["TSM", { industry: "Semiconductors", sector: "Technology" }],
      ]),
      memberships: [
        {
          via: "SMH",
          label: "Semiconductors",
          members: new Map([
            ["NVDA", 19.9],
            ["TSM", 11.2],
          ]),
        },
      ],
      unresolved: [],
    });
    expect(out.drivers).toHaveLength(1);
    expect(out.drivers[0].basis.map((b) => b.kind).sort()).toEqual(["co-membership", "industry"]);
    // The disclosure-backed label wins over the raw industry string.
    expect(out.drivers[0].label).toBe("Semiconductors");
  });

  it("sums the member issuers' effective exposure onto the driver", () => {
    const out = assembleDrivers({ ...base, coMovement: null }, {
      profiles: new Map([
        ["NVDA", { industry: "Semiconductors", sector: "Technology" }],
        ["MSFT", { industry: "Semiconductors", sector: "Technology" }],
      ]),
      memberships: [],
      unresolved: [],
    });
    const nvda = base.issuers.find((i) => i.symbol === "NVDA")!;
    const msft = base.issuers.find((i) => i.symbol === "MSFT")!;
    expect(out.drivers[0].bookPct).toBeCloseTo(nvda.effectivePct + msft.effectivePct, 2);
  });

  it("emits a SHARES edge per member, each carrying a magnitude", () => {
    const out = assembleDrivers({ ...base, coMovement: null }, {
      profiles: new Map([
        ["NVDA", { industry: "Semiconductors", sector: "Technology" }],
        ["MSFT", { industry: "Semiconductors", sector: "Technology" }],
      ]),
      memberships: [],
      unresolved: [],
    });
    expect(out.edges).toHaveLength(2);
    expect(out.edges.every((e) => e.kind === "SHARES" && e.bookPct != null)).toBe(true);
  });

  it("builds a co-movement driver only from directly held lines", () => {
    const out = assembleDrivers(base, { profiles: new Map(), memberships: [], unresolved: [] });
    // NVDA and MSFT are both held directly and correlate at 0.88; TSM is
    // reached only through VOO and has no series, so it cannot join.
    expect(out.drivers).toHaveLength(1);
    const members = out.drivers[0].issuerIds.sort();
    expect(members).toEqual(["issuer:MSFT", "issuer:NVDA"]);
    expect(out.drivers[0].basis[0].kind).toBe("co-movement");
    expect(out.drivers[0].basis[0].strength).toBeCloseTo(0.88, 2);
  });

  it("never joins a pair whose correlation could not be measured", () => {
    const unmeasured: ExposureModel = {
      ...base,
      coMovement: {
        labels: ["NVDA", "MSFT"],
        matrix: [
          [1, NaN],
          [NaN, 1],
        ],
        window: "12 months",
        excluded: [],
      },
    };
    const out = assembleDrivers(unmeasured, {
      profiles: new Map(),
      memberships: [],
      unresolved: [],
    });
    expect(out.drivers).toHaveLength(0);
  });

  it("carries industries through for the inspector", () => {
    const out = assembleDrivers({ ...base, coMovement: null }, {
      profiles: new Map([["NVDA", { industry: "Semiconductors", sector: "Technology" }]]),
      memberships: [],
      unresolved: ["ZZZZ"],
    });
    expect(out.industries.NVDA).toBe("Semiconductors");
    expect(out.unresolved).toEqual(["ZZZZ"]);
  });
});
