import { describe, expect, it } from "vitest";
import {
  companyNameTokens,
  isMateriallyAbout,
  timelineEventLinks,
  isUsListedTicker,
  eventQualifiesForUsScope,
  normalizedTitleKey,
} from "@/lib/knowledge-graph/relevance";
import { applyLedgerGuard, resolveInstrument } from "@/lib/knowledge-graph/instrument";
import { GraphBuilder } from "@/lib/knowledge-graph/build";
import { detectCommunities } from "@/lib/knowledge-graph/community";
import { summarizeChanges } from "@/lib/knowledge-graph/diff";
import type { GraphNode, GraphEdge, GraphChanges, Provenance } from "@/lib/knowledge-graph/types";
import type { TimelineEvent } from "@/lib/types";

/* ------------------------------ helpers ---------------------------------- */

const PROV: Provenance = { source: "platform", origin: "computed", asOf: null };

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: "company",
    instrument: "common_equity",
    label: id,
    fullLabel: id,
    summary: id,
    importance: 50,
    confidence: null,
    sector: null,
    weight: null,
    metrics: {},
    provenance: { ...PROV },
    href: null,
    ...overrides,
  };
}

function edge(source: string, target: string, overrides: Partial<GraphEdge> = {}): Omit<GraphEdge, "id"> {
  return {
    source,
    target,
    type: "IMPACTS",
    label: "impacts",
    confidence: null,
    strength: 50,
    directed: true,
    evidence: "",
    provenance: { ...PROV },
    timestamp: null,
    ...overrides,
  };
}

function timelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "ev1",
    symbol: "AAPL",
    timestamp: "2026-08-01T00:00:00.000Z",
    title: "Apple ships a thing",
    category: "product",
    importanceScore: 60,
    confidenceScore: 70,
    impact: "neutral",
    affectedSegment: null,
    relatedMetrics: [],
    source: { kind: "news", url: null, description: "" },
    thesisImpact: null,
    catalystStatus: "not_catalyst",
    ...overrides,
  } as TimelineEvent;
}

/* --------------------------- subject linkage ------------------------------ */

describe("isMateriallyAbout (KG-011)", () => {
  it("accepts a headline naming the ticker", () => {
    expect(isMateriallyAbout("AAPL Stock Alert: What to Know", "AAPL", "Apple Inc.")).toBe(true);
  });

  it("accepts a headline naming the company", () => {
    expect(isMateriallyAbout("3 Reasons to Buy Apple Stock on the Dip", "AAPL", "Apple Inc.")).toBe(true);
  });

  it("rejects the macro co-mention artefacts from the live defect", () => {
    expect(isMateriallyAbout("Dollar slides against the yen and euro as weak US jobs data clouds the Fed outlook", "AAPL", "Apple Inc.")).toBe(false);
    expect(isMateriallyAbout("Meta's Bold $6.5 Billion Power Move to Turbocharge Its Cloud and AI Takeover", "AAPL", "Apple Inc.")).toBe(false);
    expect(isMateriallyAbout("Meta's Bold $6.5 Billion Power Move", "TSM", "Taiwan Semiconductor Manufacturing")).toBe(false);
  });

  it("does not match the ticker inside another word", () => {
    expect(isMateriallyAbout("PINEAPPLE farming subsidies rise", "AAPL", null)).toBe(false);
  });

  it("matches crypto tickers without the -USD suffix", () => {
    expect(isMateriallyAbout("BTC hits a new high", "BTC-USD", "Bitcoin USD")).toBe(true);
    expect(isMateriallyAbout("'Bitcoin is a zeppelin': Why this cycle differs", "BTC-USD", "Bitcoin USD")).toBe(true);
  });
});

describe("companyNameTokens", () => {
  it("strips corporate suffixes", () => {
    expect(companyNameTokens("Apple Inc.")).toEqual(["apple"]);
    expect(companyNameTokens("The Coca-Cola Company")).toEqual(["coca", "cola"]);
  });
});

describe("timelineEventLinks", () => {
  it("always links filings and earnings regardless of the title", () => {
    expect(timelineEventLinks(timelineEvent({ title: "10-Q: 10-Q", source: { kind: "filing", url: null, description: "" } }), "Apple Inc.")).toBe(true);
    expect(timelineEventLinks(timelineEvent({ title: "Earnings", source: { kind: "earnings_calendar", url: null, description: "" } }), "Apple Inc.")).toBe(true);
  });

  it("gates scanner and news headlines on material mention", () => {
    expect(timelineEventLinks(timelineEvent({ title: "Dollar slides against the yen", source: { kind: "scanner", url: null, description: "" } }), "Apple Inc.")).toBe(false);
    expect(timelineEventLinks(timelineEvent({ title: "Apple acquires PlasmaSolve", source: { kind: "scanner", url: null, description: "" } }), "Apple Inc.")).toBe(true);
  });
});

/* ------------------------------ region gate ------------------------------- */

describe("region gate (KG-012)", () => {
  it("recognizes US-shaped tickers", () => {
    for (const t of ["AAPL", "TSM", "BRK-B", "GOOGL", "V"]) expect(isUsListedTicker(t)).toBe(true);
  });

  it("rejects foreign suffixes and long NSE bare names", () => {
    for (const t of ["JSWSTEEL.NS", "DYNAMATECH.NS", "7203.T", "005930.KS", "JSWSTEEL", "BRITANNIA", "MUTHOOTCAP"]) {
      expect(isUsListedTicker(t)).toBe(false);
    }
  });

  it("passes events with at least one US ticker and blocks all-foreign events", () => {
    expect(eventQualifiesForUsScope(["DYNAMATECH.NS", "TNA", "IWM"])).toBe(true);
    expect(eventQualifiesForUsScope(["JSWSTEEL", "BRITANNIA", "OLAELEC", "ZENTEC", "MUTHOOTCAP"])).toBe(false);
    expect(eventQualifiesForUsScope([])).toBe(true);
  });
});

describe("normalizedTitleKey (KG-013)", () => {
  it("collapses punctuation/case variants of the same story", () => {
    expect(normalizedTitleKey("US stocks rally to record high!")).toBe(normalizedTitleKey("U.S stocks rally to record high"));
  });
});

/* ---------------------------- ledger guard -------------------------------- */

describe("applyLedgerGuard (KG-008/010)", () => {
  it("forces the synthetic cash sleeve to cash no matter what Yahoo says", () => {
    expect(applyLedgerGuard("crypto", "cash", "Litecash USD")).toBe("cash");
  });

  it("keeps a declared equity out of the crypto namespace (the DASH collision)", () => {
    expect(applyLedgerGuard("crypto", "equity", "Dash USD")).toBe("common_equity");
  });

  it("keeps declared crypto crypto", () => {
    expect(applyLedgerGuard("common_equity", "crypto", "Bitcoin USD")).toBe("crypto");
  });

  it("maps a bond sleeve's fund vehicle to a bond fund", () => {
    expect(applyLedgerGuard("etf_equity", "bond", "iShares 7-10 Year Treasury Bond ETF")).toBe("etf_bond");
    expect(applyLedgerGuard("unknown", "bond", "whatever")).toBe("etf_bond");
  });

  it("lets Yahoo refine within the security namespace", () => {
    expect(applyLedgerGuard("etf_equity", "reit", "Vanguard Real Estate ETF")).toBe("etf_equity");
    expect(applyLedgerGuard("common_equity", "equity", "DoorDash Inc")).toBe("common_equity");
  });

  it("passes through when the ledger has no opinion", () => {
    expect(applyLedgerGuard("etf_bond", null, "x")).toBe("etf_bond");
    expect(applyLedgerGuard("unknown", undefined, "x")).toBe("unknown");
  });
});

describe("resolveInstrument cash short-circuit", () => {
  it("resolves cash without any quote I/O", async () => {
    const resolved = await resolveInstrument("CASH-USD", null, "cash");
    expect(resolved.instrument).toBe("cash");
    expect(resolved.name).toBe("Cash");
    expect(resolved.quote).toBeNull();
    expect(resolved.sector).toBeNull();
  });
});

/* --------------------------- hub suppression ------------------------------ */

describe("GraphBuilder hub suppression (KG-002/003)", () => {
  it("caps a super-hub below the focus degree and records the suppression", () => {
    const builder = new GraphBuilder("company:FOCUS");
    builder.upsertNode(node("company:FOCUS"));
    // Focus gets 8 links.
    for (let i = 0; i < 8; i++) {
      builder.upsertNode(node(`company:F${i}`));
      builder.addEdge(edge("company:FOCUS", `company:F${i}`, { strength: 90 }));
    }
    // A macro-event hub tries to out-connect it with 20 links.
    builder.upsertNode(node("market:hub", { type: "market_event", instrument: null }));
    for (let i = 0; i < 20; i++) {
      builder.upsertNode(node(`company:H${i}`));
      builder.addEdge(edge("market:hub", `company:H${i}`, { strength: 30 + i }));
    }
    builder.addEdge(edge("market:hub", "company:FOCUS", { strength: 80 }));

    const { nodes, edges } = builder.build();
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const focusDegree = degree.get("company:FOCUS")!;
    const hubDegree = degree.get("market:hub") ?? 0;
    expect(hubDegree).toBeLessThan(focusDegree);
    expect(Math.max(...[...degree.values()])).toBe(focusDegree);
    const hub = nodes.find((n) => n.id === "market:hub")!;
    expect(hub.metrics.suppressedLinks).toBeGreaterThan(0);
    // The edge to the focus is never the one dropped.
    expect(edges.some((e) => e.source === "market:hub" && e.target === "company:FOCUS")).toBe(true);
  });

  it("collapses near-duplicate event nodes and re-points their edges", () => {
    const builder = new GraphBuilder("company:A");
    builder.upsertNode(node("company:A"));
    builder.upsertNode(node("event:1", { type: "timeline_event", instrument: null, fullLabel: "US stocks rally to record high!" }));
    builder.upsertNode(node("event:2", { type: "timeline_event", instrument: null, fullLabel: "U.S stocks rally to record high" }));
    builder.addEdge(edge("event:1", "company:A"));
    builder.addEdge(edge("event:2", "company:A"));
    const { nodes, edges } = builder.build();
    expect(nodes.filter((n) => n.type === "timeline_event")).toHaveLength(1);
    expect(edges).toHaveLength(1);
  });

  it("ignores symbol prefixes when comparing event titles", () => {
    const builder = new GraphBuilder("company:A");
    builder.upsertNode(node("company:A"));
    builder.upsertNode(node("company:B"));
    builder.addEdge(edge("company:A", "company:B"));
    builder.upsertNode(node("event:1", { type: "timeline_event", instrument: null, fullLabel: "AAPL · Dollar slides against the yen" }));
    builder.upsertNode(node("event:2", { type: "timeline_event", instrument: null, fullLabel: "MSFT · Dollar slides against the yen" }));
    builder.addEdge(edge("event:1", "company:A"));
    builder.addEdge(edge("event:2", "company:B"));
    const { nodes, edges } = builder.build();
    expect(nodes.filter((n) => n.type === "timeline_event")).toHaveLength(1);
    // Both companies keep their link, re-pointed at the surviving node.
    expect(edges.filter((e) => e.source.startsWith("event:"))).toHaveLength(2);
  });
});

/* ------------------------------ communities ------------------------------- */

describe("detectCommunities", () => {
  it("separates two cliques and is deterministic", () => {
    const ids = ["a", "b", "c", "x", "y", "z"];
    const ns = ids.map((id) => node(id));
    const es: GraphEdge[] = [
      { ...edge("a", "b"), id: "1" },
      { ...edge("b", "c"), id: "2" },
      { ...edge("a", "c"), id: "3" },
      { ...edge("x", "y"), id: "4" },
      { ...edge("y", "z"), id: "5" },
      { ...edge("x", "z"), id: "6" },
    ];
    const first = detectCommunities(ns, es);
    const second = detectCommunities(ns, es);
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.get("a")).toBe(first.get("b"));
    expect(first.get("a")).toBe(first.get("c"));
    expect(first.get("x")).toBe(first.get("y"));
    expect(first.get("a")).not.toBe(first.get("x"));
  });
});

/* ------------------------------ change feed ------------------------------- */

describe("summarizeChanges (KG-014/015/017)", () => {
  const changes: GraphChanges = {
    previousAt: "2026-08-07T00:00:00.000Z",
    addedNodes: [
      { id: "event:btc1", label: "BTC-USD · Bitcoin is a zeppelin", type: "timeline_event" },
      { id: "event:btc2", label: "BTC-USD · Sector Update: Financial Stocks", type: "timeline_event" },
      { id: "event:btc3", label: "BTC-USD · Top Cryptocurrencies Rise", type: "timeline_event" },
      { id: "company:NVDA", label: "NVDA", type: "company" },
    ],
    removedNodes: [{ id: "company:ARKK", label: "ARKK", type: "company" }],
    addedEdges: [
      // Edges implied by added nodes must be subsumed, not repeated (KG-014).
      { id: "event:btc1::IMPACTS::company:BTC-USD", label: "impacts", sourceLabel: "BTC-USD · Bitcoin is a zeppelin", targetLabel: "BTC" },
      { id: "company:NVDA::OPERATES_IN::sector:Technology", label: "operates in", sourceLabel: "NVDA", targetLabel: "Technology" },
      // A genuinely new edge between pre-existing nodes survives.
      { id: "company:OLD::OPERATES_IN::sector:Technology", label: "operates in", sourceLabel: "OLD", targetLabel: "Technology" },
    ],
    removedEdges: [],
  };
  const current = [
    node("company:NVDA", { importance: 80, provenance: { ...PROV, asOf: "2026-08-08T00:00:00.000Z" } }),
    node("event:btc1", { type: "timeline_event", importance: 70 }),
    node("event:btc2", { type: "timeline_event", importance: 65 }),
    node("event:btc3", { type: "timeline_event", importance: 60 }),
    node("company:OLD"),
    node("sector:Technology", { type: "sector" }),
  ];

  it("never renders the same story as both a node and an edge", () => {
    const feed = summarizeChanges(changes, current);
    const labels = feed.entries.map((e) => e.label);
    expect(labels.filter((l) => l.includes("Bitcoin is a zeppelin"))).toHaveLength(1);
  });

  it("caps entries per entity so one loud asset cannot flood the feed", () => {
    const feed = summarizeChanges(changes, current);
    const btcEntries = feed.entries.filter((e) => e.label.startsWith("BTC-USD"));
    expect(btcEntries.length).toBeLessThanOrEqual(2);
    expect(feed.hiddenCount).toBeGreaterThan(0);
  });

  it("ranks by materiality and carries timestamps when known", () => {
    const feed = summarizeChanges(changes, current);
    expect(feed.entries[0].label).toBe("NVDA");
    expect(feed.entries[0].at).toBe("2026-08-08T00:00:00.000Z");
  });

  it("keeps genuinely new edges between pre-existing nodes", () => {
    const feed = summarizeChanges(changes, current);
    expect(feed.entries.some((e) => e.label.includes("OLD operates in Technology"))).toBe(true);
  });

  it("marks removed nodes as unfocusable", () => {
    const feed = summarizeChanges(changes, current);
    const removed = feed.entries.find((e) => e.kind === "removed");
    expect(removed?.nodeId).toBeNull();
  });
});
