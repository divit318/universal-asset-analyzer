import { describe, expect, it } from "vitest";
import { findPath, describePath, parseExplanationResponse } from "@/lib/knowledge-graph/traverse";
import { computeGraphInsights } from "@/lib/knowledge-graph/recommend";
import type { GraphNode, GraphEdge } from "@/lib/knowledge-graph/types";

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: "company",
    label: id,
    summary: "",
    importance: 50,
    confidence: 50,
    metrics: {},
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
    confidence: 50,
    strength: 50,
    evidence: "",
    timestamp: null,
    ...overrides,
  };
}

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
    const path = findPath(nodes, edges, "A", "C");
    expect(path).toHaveLength(2);
  });

  it("treats edges as undirected for connectivity", () => {
    const edges = [edge("e1", "B", "A")]; // reversed direction
    const path = findPath(nodes, edges, "A", "B");
    expect(path).toHaveLength(1);
  });

  it("returns null when no path exists", () => {
    const edges = [edge("e1", "A", "B")];
    expect(findPath(nodes, edges, "A", "D")).toBeNull();
  });

  it("returns null for an unknown node id", () => {
    expect(findPath(nodes, [], "A", "ZZZ")).toBeNull();
  });

  it("finds the shortest path when multiple exist", () => {
    const withE = [node("A"), node("B"), node("C"), node("D"), node("E")];
    const edges = [
      edge("e1", "A", "B"),
      edge("e2", "B", "C"),
      edge("e3", "C", "D"),
      edge("e4", "A", "D"), // direct shortcut
    ];
    const path = findPath(withE, edges, "A", "D");
    expect(path).toHaveLength(1);
    expect(path![0].id).toBe("e4");
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

describe("computeGraphInsights", () => {
  it("flags sector concentration when 2+ owned companies share a sector", () => {
    const nodes = [
      node("portfolio:main", { type: "portfolio" }),
      node("company:A", { label: "A" }),
      node("company:B", { label: "B" }),
      node("sector:Tech", { type: "sector", label: "Tech" }),
    ];
    const edges = [
      edge("e1", "portfolio:main", "company:A", { type: "OWNS" }),
      edge("e2", "portfolio:main", "company:B", { type: "OWNS" }),
      edge("e3", "company:A", "sector:Tech", { type: "OPERATES_IN" }),
      edge("e4", "company:B", "sector:Tech", { type: "OPERATES_IN" }),
    ];
    const insights = computeGraphInsights(nodes, edges);
    expect(insights.concentrationRisks).toHaveLength(1);
    expect(insights.concentrationRisks[0].sector).toBe("Tech");
    expect(insights.concentrationRisks[0].nodeCount).toBe(2);
  });

  it("does not flag concentration for a single holding in a sector", () => {
    const nodes = [
      node("portfolio:main", { type: "portfolio" }),
      node("company:A", { label: "A" }),
      node("sector:Tech", { type: "sector", label: "Tech" }),
    ];
    const edges = [
      edge("e1", "portfolio:main", "company:A", { type: "OWNS" }),
      edge("e2", "company:A", "sector:Tech", { type: "OPERATES_IN" }),
    ];
    expect(computeGraphInsights(nodes, edges).concentrationRisks).toHaveLength(0);
  });

  it("surfaces an opportunity not already owned as hidden", () => {
    const nodes = [
      node("company:A", { label: "A" }),
      node("opportunity:1", { type: "opportunity", label: "A opportunity", importance: 80 }),
    ];
    const edges = [edge("e1", "company:A", "opportunity:1", { type: "GENERATES" })];
    const insights = computeGraphInsights(nodes, edges);
    expect(insights.hiddenOpportunities).toHaveLength(1);
    expect(insights.hiddenOpportunities[0].nodeId).toBe("opportunity:1");
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
    expect(computeGraphInsights(nodes, edges).hiddenOpportunities).toHaveLength(0);
  });

  it("groups sectors sharing a rotation classification into a correlation cluster", () => {
    const nodes = [
      node("sector:Tech", { type: "sector", label: "Tech", metrics: { classification: "leading" } }),
      node("sector:Comm", { type: "sector", label: "Comm", metrics: { classification: "leading" } }),
      node("sector:Util", { type: "sector", label: "Util", metrics: { classification: "lagging" } }),
    ];
    const insights = computeGraphInsights(nodes, []);
    expect(insights.correlationClusters).toHaveLength(1);
    expect(insights.correlationClusters[0].classification).toBe("leading");
    expect(insights.correlationClusters[0].sectors).toEqual(["Tech", "Comm"]);
  });

  it("returns empty insight arrays for a graph with no portfolio/watchlist edges", () => {
    const nodes = [node("company:A")];
    const insights = computeGraphInsights(nodes, []);
    expect(insights.concentrationRisks).toHaveLength(0);
    expect(insights.emergingRisks).toHaveLength(0);
  });
});

describe("parseExplanationResponse", () => {
  it("defaults confidence to 50 when a valid parse omits it", () => {
    const parsed = parseExplanationResponse('{"explanation":"They share a supply chain."}');
    expect(parsed.explanation).toBe("They share a supply chain.");
    expect(parsed.confidence).toBe(50);
  });

  it("coerces a numeric-string confidence instead of propagating NaN", () => {
    const parsed = parseExplanationResponse('{"explanation":"ok","confidence":"80"}');
    expect(parsed.confidence).toBe(80);
  });

  it("falls back to 50 when confidence is a non-numeric string", () => {
    const parsed = parseExplanationResponse('{"explanation":"ok","confidence":"high"}');
    expect(parsed.confidence).toBe(50);
  });

  it("returns blank explanation defaults on total garbage instead of throwing", () => {
    const parsed = parseExplanationResponse("the model refused to answer");
    expect(parsed.explanation).toBe("");
    expect(parsed.confidence).toBe(50);
  });
});
