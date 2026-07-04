"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { KnowledgeGraph, ConnectionExplanation, NodeType, GraphScope } from "@/lib/knowledge-graph";
import { useIntelligence } from "@/lib/intelligence/context";
import { GraphScopeSwitcher } from "@/app/knowledge-graph/_components/graph-scope-switcher";
import { GraphCanvas } from "@/app/knowledge-graph/_components/graph-canvas";
import { NodeDetailPanel } from "@/app/knowledge-graph/_components/node-detail-panel";
import { ConnectionExplainer } from "@/app/knowledge-graph/_components/connection-explainer";
import { InsightsPanel } from "@/app/knowledge-graph/_components/insights-panel";

const LEGEND: { type: NodeType; label: string; color: string }[] = [
  { type: "company", label: "Company", color: "var(--accent)" },
  { type: "sector", label: "Sector", color: "var(--chart-1)" },
  { type: "portfolio", label: "Portfolio / Watchlist", color: "var(--chart-5)" },
  { type: "timeline_event", label: "Timeline Event", color: "var(--chart-2)" },
  { type: "market_event", label: "Market Event", color: "var(--chart-4)" },
  { type: "opportunity", label: "Opportunity", color: "var(--positive)" },
  { type: "thesis", label: "Thesis", color: "var(--chart-3)" },
];

/** Graph view of the Intelligence page — shares `focus` (scope+id) with the Timeline and Opportunity Map views. */
export function GraphView() {
  const { focus, setFocus, selectedTheme, setSelectedTheme } = useIntelligence();
  const { scope, id } = focus;

  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [explanation, setExplanation] = useState<ConnectionExplanation | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [filterText, setFilterText] = useState(selectedTheme ?? "");

  const load = useCallback(async (nextScope: string, nextId: string) => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setConnectFromId(null);
    setConnecting(false);
    setExplanation(null);
    try {
      const res = await fetch(`/api/knowledge-graph?scope=${nextScope}&id=${encodeURIComponent(nextId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to build graph");
      setGraph(json as KnowledgeGraph);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build graph");
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load() only sets state after an await, so this is safe to call here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(scope, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, id]);

  // A theme selected elsewhere (e.g. Opportunity Map's theme clusters) highlights matching nodes here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedTheme != null) setFilterText(selectedTheme);
  }, [selectedTheme]);

  const nodesById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;

  const highlightedNodeIds = useMemo(() => {
    if (explanation?.pathFound) return new Set(explanation.path.map((p) => p.nodeId));
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      return new Set(
        (graph?.nodes ?? []).filter((n) => n.label.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q)).map((n) => n.id),
      );
    }
    return null;
  }, [explanation, filterText, graph]);

  function handleScopeSelect(nextScope: GraphScope, nextId: string) {
    setFocus({ scope: nextScope, id: nextId });
  }

  function handleSelectNode(nodeId: string) {
    if (connecting && connectFromId && nodeId !== connectFromId) {
      void runExplain(connectFromId, nodeId);
      return;
    }
    setSelectedId(nodeId);
    // A company/sector node carries the same identity Timeline and Opportunity Map
    // understand — propagate it so switching views shows this entity there too.
    const node = nodesById.get(nodeId);
    if (node?.type === "company") setFocus({ scope: "symbol", id: node.label });
    else if (node?.type === "sector") setFocus({ scope: "sector", id: node.label });
  }

  async function runExplain(fromId: string, toId: string) {
    setExplanationLoading(true);
    setConnecting(false);
    try {
      const res = await fetch(
        `/api/knowledge-graph/explain?scope=${scope}&id=${encodeURIComponent(id)}&from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`,
      );
      const json = await res.json();
      setExplanation(json.explanation ?? null);
    } catch {
      setExplanation(null);
    } finally {
      setExplanationLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <GraphScopeSwitcher scope={scope} id={id} onSelect={handleScopeSelect} />

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={filterText}
          onChange={(e) => {
            setFilterText(e.target.value);
            setSelectedTheme(null);
          }}
          placeholder="Highlight nodes in this graph…"
          className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted/50 focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-3">
          {LEGEND.map((l) => (
            <span key={l.type} className="flex items-center gap-1.5 text-[10px] text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {error && <div className="rounded-lg border border-negative/30 bg-negative/10 p-3 text-xs text-negative">{error}</div>}

      {loading && !graph ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
          Building knowledge graph…
        </div>
      ) : graph ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <GraphCanvas
              nodes={graph.nodes}
              edges={graph.edges}
              selectedId={selectedId}
              connectFromId={connectFromId}
              highlightedNodeIds={highlightedNodeIds}
              onSelect={handleSelectNode}
            />
            <div className="flex flex-col gap-4">
              {explanationLoading || explanation ? (
                <ConnectionExplainer
                  explanation={explanation}
                  loading={explanationLoading}
                  onClose={() => {
                    setExplanation(null);
                    setConnectFromId(null);
                  }}
                />
              ) : selectedNode ? (
                <NodeDetailPanel
                  node={selectedNode}
                  edges={graph.edges}
                  nodesById={nodesById}
                  onSelectRelated={setSelectedId}
                  connecting={connecting}
                  onStartConnect={() => {
                    setConnectFromId(selectedNode.id);
                    setConnecting(true);
                  }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted">
                  <span className="text-2xl">◇</span>
                  Click a node to inspect it, or drag to explore the graph.
                </div>
              )}
            </div>
          </div>

          <InsightsPanel insights={graph.insights} onSelectNode={setSelectedId} />
        </>
      ) : null}
    </div>
  );
}
