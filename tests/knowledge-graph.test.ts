import { describe, expect, it } from "vitest";
import { findPath, findPaths, describePath, parseExplanationResponse } from "@/lib/knowledge-graph/traverse";
import { computeGraphInsights, computeGraphStats } from "@/lib/knowledge-graph/recommend";
import { GraphBuilder } from "@/lib/knowledge-graph/build";
import { classifyInstrument, classifyFundUnderlying, displaySymbol } from "@/lib/knowledge-graph/instrument";
import { eventLabels, formatFilingLabel, clipLabel } from "@/lib/knowledge-graph/label";
import { diffGraphs, isEmptyChanges } from "@/lib/knowledge-graph/diff";
import { parseNarrativeResponse } from "@/lib/knowledge-graph/narrate";
import { canonicalizeSector } from "@/lib/gics-sectors";
import type { GraphNode, GraphEdge, Provenance } from "@/lib/knowledge-graph/types";
import type { TimelineEvent } from "@/lib/types";

const PROV: Provenance = { source: "platform", origin: "computed", asOf: null };

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: "company",
    instrument: null,
    label: id,
    fullLabel: id,
    summary: "",
    importance: 50,
    confidence: null,
    sector: null,
    weight: null,
    metrics: {},
    provenance: PROV,
    href: null,
    ...overrides,
  };
}

function edge(id: string, source: string, target: string, overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id,
    source,
    target,
    type: "IMPACTS",
    label: "impacts",
    confidence: null,
    strength: 50,
    directed: true,
    evidence: "",
    provenance: PROV,
    timestamp: null,
    ...overrides,
  };
}

function timelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "evt1",
    symbol: "AAPL",
    timestamp: "2025-08-01T12:00:00.000Z",
    title: "10-Q: 10-Q",
    category: "earnings",
    importanceScore: 60,
    confidenceScore: 80,
    impact: "neutral",
    affectedSegment: null,
    relatedMetrics: [],
    source: { kind: "filing", url: null, description: "SEC 10-Q" },
    thesisImpact: null,
    catalystStatus: "not_catalyst",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* GraphBuilder invariants                                                    */
/* -------------------------------------------------------------------------- */

describe("GraphBuilder", () => {
  it("resolves edges queued before their endpoint nodes exist (the v1 event-orphan bug)", () => {
    const builder = new GraphBuilder("company:AAPL");
    // Edge added FIRST, nodes after — v1 silently dropped this.
    builder.addEdge(edge("", "event:e1", "company:AAPL"));
    builder.upsertNode(node("event:e1", { type: "timeline_event" }));
    builder.upsertNode(node("company:AAPL"));
    const { edges } = builder.build();
    expect(edges).toHaveLength(1);
  });

  it("prunes degree-0 nodes except the focus node", () => {
    const builder = new GraphBuilder("company:AAPL");
    builder.upsertNode(node("company:AAPL"));
    builder.upsertNode(node("sector:Energy", { type: "sector" }));
    builder.upsertNode(node("sector:Utilities", { type: "sector" }));
    builder.upsertNode(node("company:B"));
    builder.addEdge(edge("", "company:AAPL", "company:B"));
    const { nodes, meta } = builder.build();
    expect(nodes.map((n) => n.id).sort()).toEqual(["company:AAPL", "company:B"]);
    expect(meta.isolatesDropped).toBe(2);
  });

  it("keeps the focus node even at degree 0", () => {
    const builder = new GraphBuilder("company:AAPL");
    builder.upsertNode(node("company:AAPL"));
    const { nodes } = builder.build();
    expect(nodes).toHaveLength(1);
  });

  it("drops edges whose endpoints never materialize and self-loops", () => {
    const builder = new GraphBuilder("a");
    builder.upsertNode(node("a"));
    builder.addEdge(edge("", "a", "ghost"));
    builder.addEdge(edge("", "a", "a"));
    expect(builder.build().edges).toHaveLength(0);
  });

  it("dedupes nodes by id, keeping the higher importance", () => {
    const builder = new GraphBuilder("a");
    builder.upsertNode(node("a", { importance: 40 }));
    builder.upsertNode(node("a", { importance: 90 }));
    builder.upsertNode(node("b"));
    builder.addEdge(edge("", "a", "b"));
    const { nodes } = builder.build();
    expect(nodes.find((n) => n.id === "a")?.importance).toBe(90);
  });

  it("reports truncation through meta", () => {
    const builder = new GraphBuilder("a");
    builder.upsertNode(node("a"));
    const { meta } = builder.build({ shown: 12, total: 61 });
    expect(meta.truncation).toEqual({ shown: 12, total: 61 });
  });
});

/* -------------------------------------------------------------------------- */
/* Taxonomy                                                                   */
/* -------------------------------------------------------------------------- */

describe("sector taxonomy mapping", () => {
  it("maps Yahoo assetProfile names to canonical GICS-11", () => {
    expect(canonicalizeSector("Basic Materials")).toBe("Materials");
    expect(canonicalizeSector("Financial Services")).toBe("Financials");
    expect(canonicalizeSector("Consumer Defensive")).toBe("Consumer Staples");
  });

  it("passes canonical names through unchanged", () => {
    expect(canonicalizeSector("Technology")).toBe("Technology");
    expect(canonicalizeSector("Communication Services")).toBe("Communication Services");
  });

  it("returns null (never guesses) for unknown labels", () => {
    expect(canonicalizeSector("Widgets & Gadgets")).toBeNull();
    expect(canonicalizeSector("")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Instrument resolution                                                      */
/* -------------------------------------------------------------------------- */

describe("classifyInstrument", () => {
  it("classifies FX pairs by symbol shape regardless of quoteType", () => {
    expect(classifyInstrument("USDCHF=X", null, "USD/CHF")).toBe("fx_pair");
    expect(classifyInstrument("USDCHF=X", "CURRENCY", "USD/CHF")).toBe("fx_pair");
  });

  it("classifies futures, indices, crypto", () => {
    expect(classifyInstrument("HO=F", "FUTURE", "Heating Oil")).toBe("future");
    expect(classifyInstrument("^GSPC", "INDEX", "S&P 500")).toBe("index");
    expect(classifyInstrument("USDT-USD", "CRYPTOCURRENCY", "Tether")).toBe("crypto");
  });

  it("classifies ETFs with underlying asset class from the name", () => {
    expect(classifyInstrument("SPHY", "ETF", "SPDR Portfolio High Yield Bond ETF")).toBe("etf_bond");
    expect(classifyInstrument("GLD", "ETF", "SPDR Gold Shares")).toBe("etf_commodity");
    expect(classifyInstrument("VOO", "ETF", "Vanguard S&P 500 ETF")).toBe("etf_equity");
  });

  it("classifies common equity and preferred shares", () => {
    expect(classifyInstrument("AAPL", "EQUITY", "Apple Inc.")).toBe("common_equity");
    expect(classifyInstrument("SKHY", "EQUITY", "SK hynix Inc.")).toBe("common_equity");
    expect(classifyInstrument("SCHW-PD", "EQUITY", "Charles Schwab Pref D")).toBe("preferred");
  });

  it("returns unknown for unrecognized quote types instead of defaulting to equity", () => {
    expect(classifyInstrument("XYZ", null, "XYZ")).toBe("unknown");
  });
});

describe("classifyFundUnderlying", () => {
  it("detects bond funds", () => {
    expect(classifyFundUnderlying("iShares 7-10 Year Treasury Bond ETF")).toBe("etf_bond");
    expect(classifyFundUnderlying("WisdomTree Floating Rate Treasury Fund")).toBe("etf_bond");
  });
  it("detects commodity funds", () => {
    expect(classifyFundUnderlying("Invesco DB Commodity Index Tracking Fund")).toBe("etf_commodity");
  });
  it("defaults to equity", () => {
    expect(classifyFundUnderlying("Vanguard Total Stock Market ETF")).toBe("etf_equity");
  });
});

describe("displaySymbol", () => {
  it("renders FX pairs without the Yahoo suffix", () => {
    expect(displaySymbol("USDCHF=X", "fx_pair")).toBe("USD/CHF");
  });
  it("strips futures and crypto suffixes", () => {
    expect(displaySymbol("HO=F", "future")).toBe("HO");
    expect(displaySymbol("BTC-USD", "crypto")).toBe("BTC");
  });
  it("leaves equities untouched", () => {
    expect(displaySymbol("AAPL", "common_equity")).toBe("AAPL");
  });
});

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

describe("event labels", () => {
  it('fixes the "10-Q: 10-Q" duplication into "SYM FORM, filed DATE"', () => {
    const labels = eventLabels(timelineEvent());
    expect(labels.short).toBe("AAPL 10-Q, filed 01 Aug 2025");
    expect(labels.full).toBe("AAPL 10-Q, filed 01 Aug 2025");
  });

  it('drops the redundant "FORM 6-K" restatement', () => {
    const labels = eventLabels(
      timelineEvent({ title: "6-K: FORM 6-K", source: { kind: "filing", url: null, description: "SEC 6-K" } }),
    );
    expect(labels.short).toBe("AAPL 6-K, filed 01 Aug 2025");
  });

  it("keeps a real filing description in the full label", () => {
    const labels = eventLabels(timelineEvent({ title: "8-K: Departure of Directors" }));
    expect(labels.short).toBe("AAPL 8-K, filed 01 Aug 2025");
    expect(labels.full).toContain("Departure of Directors");
  });

  it("clips non-filing titles on a word boundary", () => {
    const labels = eventLabels(
      timelineEvent({
        title: "Meta's Bold $6.5 Billion Power Move to Turbocharge Its Cloud Ambitions in 2026",
        source: { kind: "news", url: null, description: "news" },
      }),
    );
    expect(labels.short.length).toBeLessThanOrEqual(45);
    expect(labels.short.endsWith("…")).toBe(true);
    expect(labels.full).toContain("Turbocharge");
  });
});

describe("clipLabel", () => {
  it("returns short strings unchanged", () => {
    expect(clipLabel("NVDA")).toBe("NVDA");
  });
  it("never cuts mid-word when a boundary is near", () => {
    const clipped = clipLabel("alpha beta gamma delta epsilon zeta eta theta iota", 30);
    expect(clipped).toMatch(/[a-z]…$/);
    expect(clipped).not.toMatch(/\s…$/);
  });
});

describe("formatFilingLabel", () => {
  it("returns null for non-filing events", () => {
    expect(formatFilingLabel(timelineEvent({ source: { kind: "news", url: null, description: "" } }))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Pathfinding                                                                */
/* -------------------------------------------------------------------------- */

describe("findPath", () => {
  const nodes = [node("A"), node("B"), node("C"), node("D")];

  it("returns an empty path for the same node", () => {
    expect(findPath(nodes, [], "A", "A")).toEqual([]);
  });

  it("finds a direct connection", () => {
    const edges = [edge("e1", "A", "B")];
    const path = findPath(nodes, edges, "A", "B");
    expect(path).toHaveLength(1);
    expect(path![0].id).toBe("e1");
  });

  it("finds a multi-hop connection", () => {
    const edges = [edge("e1", "A", "B"), edge("e2", "B", "C")];
    expect(findPath(nodes, edges, "A", "C")).toHaveLength(2);
  });

  it("treats edges as undirected for connectivity", () => {
    const edges = [edge("e1", "B", "A")];
    expect(findPath(nodes, edges, "A", "B")).toHaveLength(1);
  });

  it("returns null when no path exists", () => {
    expect(findPath(nodes, [edge("e1", "A", "B")], "A", "D")).toBeNull();
  });

  it("returns null for an unknown node id", () => {
    expect(findPath(nodes, [], "A", "ZZZ")).toBeNull();
  });

  it("finds the shortest path when multiple exist", () => {
    const withE = [node("A"), node("B"), node("C"), node("D"), node("E")];
    const edges = [edge("e1", "A", "B"), edge("e2", "B", "C"), edge("e3", "C", "D"), edge("e4", "A", "D")];
    const path = findPath(withE, edges, "A", "D");
    expect(path).toHaveLength(1);
    expect(path![0].id).toBe("e4");
  });
});

describe("findPaths", () => {
  const nodes = [node("A"), node("B"), node("C"), node("D")];
  const edges = [
    edge("e1", "A", "B", { strength: 90 }),
    edge("e2", "B", "D", { strength: 90 }),
    edge("e3", "A", "C", { strength: 20 }),
    edge("e4", "C", "D", { strength: 20 }),
    edge("e5", "A", "D", { strength: 80 }),
  ];

  it("finds every simple path within depth and ranks the strongest first", () => {
    const paths = findPaths(nodes, edges, "A", "D");
    expect(paths.length).toBe(3);
    expect(paths[0].edges.map((e) => e.id)).toEqual(["e5"]); // direct, strong
    expect(paths[0].nodeIds).toEqual(["A", "D"]);
  });

  it("returns [] for unknown or identical endpoints", () => {
    expect(findPaths(nodes, edges, "A", "A")).toEqual([]);
    expect(findPaths(nodes, edges, "A", "ZZZ")).toEqual([]);
  });

  it("respects maxDepth", () => {
    const paths = findPaths(nodes, edges, "A", "D", { maxDepth: 1 });
    expect(paths).toHaveLength(1);
    expect(paths[0].edges[0].id).toBe("e5");
  });
});

describe("describePath", () => {
  it("describes an empty path as the same entity", () => {
    expect(describePath([node("A")], [])).toBe("These are the same entity.");
  });

  it("renders each hop with its relationship type", () => {
    const nodes = [node("A", { label: "AAPL" }), node("B", { label: "Technology" })];
    const edges = [edge("e1", "A", "B", { type: "OPERATES_IN" })];
    expect(describePath(nodes, edges)).toContain("AAPL");
    expect(describePath(nodes, edges)).toContain("Technology");
    expect(describePath(nodes, edges)).toContain("operates in");
  });
});

/* -------------------------------------------------------------------------- */
/* Insights                                                                   */
/* -------------------------------------------------------------------------- */

describe("computeGraphInsights", () => {
  const WINDOW = "1m relative strength";

  it("flags sector concentration when 2+ owned companies share a canonical sector", () => {
    const nodes = [
      node("portfolio:main", { type: "portfolio" }),
      node("company:A", { label: "A", sector: "Technology", weight: 0.3 }),
      node("company:B", { label: "B", sector: "Technology", weight: 0.2 }),
      node("sector:Technology", { type: "sector", label: "Technology" }),
    ];
    const edges = [
      edge("e1", "portfolio:main", "company:A", { type: "OWNS" }),
      edge("e2", "portfolio:main", "company:B", { type: "OWNS" }),
    ];
    const insights = computeGraphInsights(nodes, edges, WINDOW);
    expect(insights.concentrationRisks).toHaveLength(1);
    expect(insights.concentrationRisks[0].sector).toBe("Technology");
    expect(insights.concentrationRisks[0].weight).toBe(0.5);
  });

  it("flags a single oversized position's sector by weight", () => {
    const nodes = [
      node("portfolio:main", { type: "portfolio" }),
      node("company:A", { label: "A", sector: "Energy", weight: 0.4 }),
    ];
    const edges = [edge("e1", "portfolio:main", "company:A", { type: "OWNS" })];
    expect(computeGraphInsights(nodes, edges, WINDOW).concentrationRisks).toHaveLength(1);
  });

  it("does not flag a small single holding", () => {
    const nodes = [
      node("portfolio:main", { type: "portfolio" }),
      node("company:A", { label: "A", sector: "Technology", weight: 0.1 }),
    ];
    const edges = [edge("e1", "portfolio:main", "company:A", { type: "OWNS" })];
    expect(computeGraphInsights(nodes, edges, WINDOW).concentrationRisks).toHaveLength(0);
  });

  it("surfaces an opportunity not already owned as hidden", () => {
    const nodes = [
      node("company:A", { label: "A" }),
      node("opportunity:1", { type: "opportunity", label: "A opportunity", importance: 80 }),
    ];
    const edges = [edge("e1", "company:A", "opportunity:1", { type: "GENERATES" })];
    const insights = computeGraphInsights(nodes, edges, WINDOW);
    expect(insights.hiddenOpportunities).toHaveLength(1);
  });

  it("excludes an opportunity for an already-owned company", () => {
    const nodes = [
      node("portfolio:main", { type: "portfolio" }),
      node("company:A", { label: "A" }),
      node("opportunity:1", { type: "opportunity", label: "A opportunity", importance: 80 }),
    ];
    const edges = [
      edge("e1", "portfolio:main", "company:A", { type: "OWNS" }),
      edge("e2", "company:A", "opportunity:1", { type: "GENERATES" }),
    ];
    expect(computeGraphInsights(nodes, edges, WINDOW).hiddenOpportunities).toHaveLength(0);
  });

  it("groups only sectors present in THIS graph into correlation clusters, with the window attached", () => {
    const nodes = [
      node("sector:Tech", { type: "sector", label: "Tech", metrics: { classification: "leading" } }),
      node("sector:Comm", { type: "sector", label: "Comm", metrics: { classification: "leading" } }),
      node("sector:Util", { type: "sector", label: "Util", metrics: { classification: "lagging" } }),
    ];
    const insights = computeGraphInsights(nodes, [], WINDOW);
    expect(insights.correlationClusters).toHaveLength(1);
    expect(insights.correlationClusters[0].sectors).toEqual(["Tech", "Comm"]);
    expect(insights.correlationClusters[0].window).toBe(WINDOW);
  });

  it("returns empty insight arrays for a graph with no portfolio/watchlist edges", () => {
    const insights = computeGraphInsights([node("company:A")], [], WINDOW);
    expect(insights.concentrationRisks).toHaveLength(0);
    expect(insights.emergingRisks).toHaveLength(0);
  });
});

describe("computeGraphStats", () => {
  it("computes counts, density, and most-connected nodes", () => {
    const nodes = [node("A"), node("B"), node("C")];
    const edges = [edge("e1", "A", "B"), edge("e2", "A", "C")];
    const stats = computeGraphStats(nodes, edges);
    expect(stats.nodes).toBe(3);
    expect(stats.edges).toBe(2);
    expect(stats.density).toBeCloseTo(2 / 3, 2);
    expect(stats.mostConnected[0]).toMatchObject({ nodeId: "A", degree: 2 });
  });
});

/* -------------------------------------------------------------------------- */
/* Diff                                                                       */
/* -------------------------------------------------------------------------- */

describe("diffGraphs", () => {
  it("reports added and removed nodes and edges with labels", () => {
    const prev = { nodes: [node("A", { label: "AAPL" }), node("B")], edges: [edge("e1", "A", "B")] };
    const next = { nodes: [node("A", { label: "AAPL" }), node("C", { label: "NVDA" })], edges: [edge("e2", "A", "C", { label: "owns" })] };
    const changes = diffGraphs(prev, next, "2026-08-01T00:00:00Z");
    expect(changes.addedNodes).toEqual([{ id: "C", label: "NVDA", type: "company" }]);
    expect(changes.removedNodes.map((n) => n.id)).toEqual(["B"]);
    expect(changes.addedEdges[0]).toMatchObject({ sourceLabel: "AAPL", targetLabel: "NVDA", label: "owns" });
    expect(changes.removedEdges).toHaveLength(1);
    expect(isEmptyChanges(changes)).toBe(false);
  });

  it("reports an identical graph as empty changes", () => {
    const g = { nodes: [node("A")], edges: [] };
    expect(isEmptyChanges(diffGraphs(g, g, "t"))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* AI response parsing                                                        */
/* -------------------------------------------------------------------------- */

describe("parseExplanationResponse", () => {
  it("returns null confidence when a valid parse omits it (unknown, not 50)", () => {
    const parsed = parseExplanationResponse('{"explanation":"They share a supply chain."}');
    expect(parsed.explanation).toBe("They share a supply chain.");
    expect(parsed.confidence).toBeNull();
  });

  it("coerces a numeric-string confidence", () => {
    expect(parseExplanationResponse('{"explanation":"ok","confidence":"80"}').confidence).toBe(80);
  });

  it("maps a non-numeric confidence to null instead of a fabricated neutral", () => {
    expect(parseExplanationResponse('{"explanation":"ok","confidence":"high"}').confidence).toBeNull();
  });

  it("returns blank explanation defaults on total garbage instead of throwing", () => {
    const parsed = parseExplanationResponse("the model refused to answer");
    expect(parsed.explanation).toBe("");
    expect(parsed.confidence).toBeNull();
  });
});

describe("parseNarrativeResponse", () => {
  const valid = new Set(["company:NVDA", "sector:Technology"]);

  it("keeps observations whose citations exist in the graph", () => {
    const raw = JSON.stringify({
      observations: [{ text: "NVDA dominates the book.", nodeIds: ["company:NVDA"] }],
    });
    const parsed = parseNarrativeResponse(raw, valid);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].nodeIds).toEqual(["company:NVDA"]);
  });

  it("drops observations with no valid citations (unsupported claims never ship)", () => {
    const raw = JSON.stringify({
      observations: [
        { text: "Fabricated claim.", nodeIds: ["company:FAKE"] },
        { text: "Uncited claim.", nodeIds: [] },
        { text: "Real claim.", nodeIds: ["sector:Technology", "company:FAKE"] },
      ],
    });
    const parsed = parseNarrativeResponse(raw, valid);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe("Real claim.");
    expect(parsed[0].nodeIds).toEqual(["sector:Technology"]);
  });

  it("returns [] for garbage", () => {
    expect(parseNarrativeResponse("no json here", valid)).toEqual([]);
  });
});
