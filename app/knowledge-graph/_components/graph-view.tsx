"use client";

/**
 * Graph view (v2) — orchestrates the canvas, the always-useful inspector, the
 * legend/filter rail, search, layout modes, exports, and URL state.
 *
 * State contract with the page: the page owns scope/id (from the URL); this
 * component reports every other piece of view state (layout, view mode,
 * search, filters, selection) upward through onViewStateChange so the URL
 * round-trips completely.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KnowledgeGraph,
  ConnectionExplanation,
  GraphNarrative,
  GraphNode,
  NodeType,
  GraphScope,
} from "@/lib/knowledge-graph/types";
// Value import from the zero-I/O types module (never the package index, which
// would pull node:sqlite into the client bundle).
import { INSTRUMENT_LABEL } from "@/lib/knowledge-graph/types";
import { GraphCanvas, type GraphCanvasHandle, type GraphLayout, type GraphSelection } from "./graph-canvas";
import { GraphTable } from "./graph-table";
import { Inspector } from "./inspector";
import { NODE_VISUAL, EDGE_VISUAL, shapePath, nodeShape, instrumentShape } from "./graph-model";

export interface GraphViewState {
  layout: GraphLayout | null; // null = scope default
  view: "graph" | "table";
  q: string;
  /** Hidden legend keys: a NodeType for non-asset kinds, "i:<instrument>" for assets. */
  hiddenTypes: string[];
  /** Individually hidden node ids (KG-039/044). */
  hiddenNodes: string[];
  /** Neighborhood focus: reduce the view to this node and its neighbors. */
  focusNodeId: string | null;
  minStrength: number;
  selected: string | null; // node id only (edges are session-local)
}

/** Legend/filter key for a node: assets split by instrument, others by kind. */
function legendKey(node: GraphNode): string {
  return node.type === "company" ? `i:${node.instrument ?? "unknown"}` : node.type;
}

interface Props {
  scope: GraphScope;
  id: string;
  initialState: Partial<GraphViewState>;
  onViewStateChange: (state: GraphViewState) => void;
  onFocusChange: (scope: GraphScope, id: string) => void;
}

const SCOPE_DEFAULT_LAYOUT: Record<GraphScope, GraphLayout> = {
  symbol: "force",
  sector: "force",
  portfolio: "radial",
  watchlist: "radial",
};

export function GraphView({ scope, id, initialState, onViewStateChange, onFocusChange }: Props) {
  const canvasRef = useRef<GraphCanvasHandle>(null);

  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<GraphSelection | null>(
    initialState.selected ? { kind: "node", id: initialState.selected } : null,
  );
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [explanation, setExplanation] = useState<ConnectionExplanation | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  const [narrative, setNarrative] = useState<GraphNarrative | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);

  const [searchText, setSearchText] = useState(initialState.q ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(initialState.q ?? "");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set(initialState.hiddenTypes ?? []));
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set(initialState.hiddenNodes ?? []));
  const [focusNodeId, setFocusNodeId] = useState<string | null>(initialState.focusNodeId ?? null);
  const [minStrength, setMinStrength] = useState(initialState.minStrength ?? 0);
  const [layoutOverride, setLayoutOverride] = useState<GraphLayout | null>(initialState.layout ?? null);
  const [view, setView] = useState<"graph" | "table">(initialState.view ?? "graph");
  const [copied, setCopied] = useState(false);

  const layout = layoutOverride ?? SCOPE_DEFAULT_LAYOUT[scope];

  /* ------------------------------ data loading ----------------------------- */

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs =
        scope === "portfolio" || scope === "watchlist"
          ? `scope=${scope}`
          : `scope=${scope}&id=${encodeURIComponent(id)}`;
      const res = await fetch(`/api/knowledge-graph?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to build graph");
      setGraph(json as KnowledgeGraph);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build graph");
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, [scope, id]);

  // The page keys this component by scope:id, so a focus change remounts it
  // with fresh state; the only job here is the initial fetch.
  useEffect(() => {
    // load() flips the loading flag synchronously (initial state already
    // matches, so no cascading render) and only sets data after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /* ------------------------------- URL sync -------------------------------- */

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchText), 180);
    return () => clearTimeout(handle);
  }, [searchText]);

  useEffect(() => {
    onViewStateChange({
      layout: layoutOverride,
      view,
      q: debouncedSearch,
      hiddenTypes: [...hiddenTypes],
      hiddenNodes: [...hiddenNodes],
      focusNodeId,
      minStrength,
      selected: selected?.kind === "node" ? selected.id : null,
    });
  }, [layoutOverride, view, debouncedSearch, hiddenTypes, hiddenNodes, focusNodeId, minStrength, selected, onViewStateChange]);

  /* ------------------------------- filtering ------------------------------- */

  const applyFilters = useCallback(
    (minStrengthValue: number): { nodes: GraphNode[]; edges: KnowledgeGraph["edges"] } => {
      if (!graph) return { nodes: [], edges: [] };
      // Neighborhood focus first: the view reduces to the focused node and
      // its direct neighbors (KG-039).
      let scopeNodes = graph.nodes;
      if (focusNodeId && graph.nodes.some((n) => n.id === focusNodeId)) {
        const keep = new Set<string>([focusNodeId]);
        for (const e of graph.edges) {
          if (e.source === focusNodeId) keep.add(e.target);
          if (e.target === focusNodeId) keep.add(e.source);
        }
        scopeNodes = graph.nodes.filter((n) => keep.has(n.id));
      }
      const keptNodes = scopeNodes.filter(
        (n) => (!hiddenTypes.has(legendKey(n)) && !hiddenNodes.has(n.id)) || n.id === graph.meta.focusId,
      );
      const keptIds = new Set(keptNodes.map((n) => n.id));
      const keptEdges = graph.edges.filter(
        (e) => e.strength >= minStrengthValue && keptIds.has(e.source) && keptIds.has(e.target),
      );
      // Re-prune isolates created by filtering (zero orphans stays true under filters).
      const degree = new Map<string, number>();
      for (const e of keptEdges) {
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
      }
      const anchor = focusNodeId ?? graph.meta.focusId;
      const finalNodes = keptNodes.filter((n) => (degree.get(n.id) ?? 0) > 0 || n.id === anchor);
      return { nodes: finalNodes, edges: keptEdges };
    },
    [graph, hiddenTypes, hiddenNodes, focusNodeId],
  );

  const { filteredNodes, filteredEdges } = useMemo(() => {
    const { nodes, edges } = applyFilters(minStrength);
    return { filteredNodes: nodes, filteredEdges: edges };
  }, [applyFilters, minStrength]);

  // Live preview per min-strength option: the select states what each
  // threshold would leave on screen (KG-004).
  const strengthPreview = useMemo(() => {
    const out = new Map<number, { nodes: number; edges: number }>();
    for (const value of [0, 40, 60, 80]) {
      const { nodes, edges } = applyFilters(value);
      out.set(value, { nodes: nodes.length, edges: edges.length });
    }
    return out;
  }, [applyFilters]);

  const searchMatches = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      filteredNodes
        .filter((n) => n.fullLabel.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q))
        .map((n) => n.id),
    );
  }, [debouncedSearch, filteredNodes]);

  const pathHighlight = useMemo(
    () => (showExplanation && explanation?.pathFound ? new Set(explanation.path.map((p) => p.nodeId)) : null),
    [showExplanation, explanation],
  );

  const highlightedNodeIds = pathHighlight ?? searchMatches;

  // Legend entries: asset nodes are grouped by INSTRUMENT (Common Equity,
  // Bond ETF, FX Pair...), everything else by node kind. The word "Company"
  // never appears for a non-equity instrument.
  const legendEntries = useMemo(() => {
    const entries = new Map<string, { label: string; type: NodeType; instrument: GraphNode["instrument"]; count: number }>();
    for (const n of graph?.nodes ?? []) {
      const key = legendKey(n);
      const label = n.type === "company" ? INSTRUMENT_LABEL[n.instrument ?? "unknown"] : NODE_VISUAL[n.type].label;
      const existing = entries.get(key);
      if (existing) existing.count += 1;
      else entries.set(key, { label, type: n.type, instrument: n.type === "company" ? n.instrument : null, count: 1 });
    }
    return [...entries.entries()];
  }, [graph]);

  // Edge legend: every relation treatment on screen is explained (KG-027).
  const edgeLegendEntries = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of graph?.edges ?? []) seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
    return [...seen.entries()];
  }, [graph]);

  /* ------------------------------- callbacks ------------------------------- */

  const runExplain = useCallback(
    async (fromId: string, toId: string) => {
      setExplanationLoading(true);
      setShowExplanation(true);
      setConnecting(false);
      try {
        const qs = scope === "portfolio" || scope === "watchlist" ? `scope=${scope}&id=${scope}` : `scope=${scope}&id=${encodeURIComponent(id)}`;
        const res = await fetch(
          `/api/knowledge-graph/explain?${qs}&from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`,
        );
        const json = await res.json();
        setExplanation(json.explanation ?? null);
      } catch {
        setExplanation(null);
      } finally {
        setExplanationLoading(false);
      }
    },
    [scope, id],
  );

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      if (connecting && connectFromId && nodeId !== connectFromId) {
        void runExplain(connectFromId, nodeId);
        return;
      }
      setShowExplanation(false);
      setSelected({ kind: "node", id: nodeId });
    },
    [connecting, connectFromId, runExplain],
  );

  const handleSelectEdge = useCallback((edgeId: string) => {
    setShowExplanation(false);
    setSelected({ kind: "edge", id: edgeId });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelected(null);
    setConnecting(false);
    setConnectFromId(null);
  }, []);

  const handleRecenter = useCallback(
    (node: GraphNode) => {
      // Node ids carry the raw symbol ("company:USDCHF=X"); labels are display
      // forms ("USD/CHF") that would not round-trip through the API.
      if (node.type === "company") onFocusChange("symbol", node.id.slice("company:".length));
      else if (node.type === "sector") onFocusChange("sector", node.label);
    },
    [onFocusChange],
  );

  const generateNarrative = useCallback(async () => {
    setNarrativeLoading(true);
    try {
      const qs = scope === "portfolio" || scope === "watchlist" ? `scope=${scope}` : `scope=${scope}&id=${encodeURIComponent(id)}`;
      const res = await fetch(`/api/knowledge-graph/narrative?${qs}`);
      const json = await res.json();
      setNarrative(json.narrative ?? null);
    } catch {
      setNarrative(null);
    } finally {
      setNarrativeLoading(false);
    }
  }, [scope, id]);

  const exportJson = useCallback(() => {
    if (!graph) return;
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `knowledge-graph-${scope}-${id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [graph, scope, id]);

  const copyPermalink = useCallback(() => {
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, []);

  const toggleType = useCallback((key: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /* -------------------------------- render --------------------------------- */

  if (loading && !graph) {
    return (
      <div className="flex min-h-[440px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm text-muted">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none" />
        Building knowledge graph…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-xl border border-negative/30 bg-negative/5 p-6 text-center">
        <p className="text-sm text-negative">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!graph) return null;

  const isEmpty = graph.nodes.length <= 1 && (scope === "portfolio" || scope === "watchlist");
  if (isEmpty) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
        <p className="text-sm text-foreground">
          {scope === "portfolio" ? "Your portfolio is empty." : "Your watchlist is empty."}
        </p>
        <p className="max-w-md text-xs text-muted">
          Add {scope === "portfolio" ? "holdings on the Portfolio page" : "symbols on the Watchlist page"} and this
          view will map how they connect across sectors, events, and market signals.
        </p>
        <a
          href={scope === "portfolio" ? "/portfolio" : "/watchlist"}
          className="rounded-md bg-accent-strong px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
        >
          {scope === "portfolio" ? "Open Portfolio" : "Open Watchlist"}
        </a>
      </div>
    );
  }

  const matchCount = searchMatches?.size ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar: search, layout, view, export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              // Enter navigates: select (and inspect) the first match (KG-042).
              if (e.key === "Enter" && searchMatches && searchMatches.size > 0) {
                const first = filteredNodes.find((n) => searchMatches.has(n.id));
                if (first) handleSelectNode(first.id);
              }
              if (e.key === "Escape") setSearchText("");
            }}
            placeholder="Find nodes… (Enter selects)"
            aria-label="Find nodes matching text; press Enter to select the first match"
            className="w-56 rounded-lg border border-border bg-surface px-3 py-2 pr-16 text-xs text-foreground outline-none placeholder:text-muted focus:border-accent"
          />
          {searchText && (
            <span className="absolute right-8 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted" aria-live="polite">
              {matchCount ?? 0}
            </span>
          )}
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText("")}
              aria-label="Clear highlight"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>

        <div role="group" aria-label="Layout" className="flex rounded-lg border border-border bg-surface p-0.5">
          {(["force", "radial"] as GraphLayout[]).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={layout === l}
              onClick={() => setLayoutOverride(l)}
              className={`rounded-md px-2.5 py-1.5 text-xs capitalize transition-colors ${
                layout === l ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div role="group" aria-label="View" className="flex rounded-lg border border-border bg-surface p-0.5">
          {(["graph", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1.5 text-xs capitalize transition-colors ${
                view === v ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            Min strength
            <select
              value={minStrength}
              onChange={(e) => setMinStrength(Number(e.target.value))}
              className="rounded-md border border-border bg-surface px-1.5 py-1 text-[11px] text-foreground"
            >
              {[0, 40, 60, 80].map((v) => {
                const preview = strengthPreview.get(v);
                const suffix = preview ? ` (${preview.nodes}n · ${preview.edges}e)` : "";
                return (
                  <option key={v} value={v}>
                    {v === 0 ? "Any" : `${v}+`}
                    {suffix}
                  </option>
                );
              })}
            </select>
          </label>
          {view === "graph" && (
            <button
              type="button"
              onClick={() => canvasRef.current?.exportPng()}
              className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              PNG
            </button>
          )}
          <button
            type="button"
            onClick={exportJson}
            className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            JSON
          </button>
          <button
            type="button"
            onClick={copyPermalink}
            className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      {/* Legend doubles as the filter: assets grouped by instrument, other
          kinds by type. Click to hide/show, with live counts. */}
      <div role="group" aria-label="Node types (click to filter)" className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted/80">Nodes (click to filter)</span>
        {legendEntries.map(([key, entry]) => {
          const visual = NODE_VISUAL[entry.type];
          const shape = entry.type === "company" ? instrumentShape(entry.instrument) : visual.shape;
          const hidden = hiddenTypes.has(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={!hidden}
              onClick={() => toggleType(key)}
              title={hidden ? `Show ${entry.label} nodes` : `Hide ${entry.label} nodes`}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                hidden
                  ? "border-border text-muted line-through opacity-60"
                  : "border-border text-foreground hover:border-accent/40"
              }`}
            >
              <svg width="12" height="12" viewBox="-8 -8 16 16" aria-hidden="true">
                <path d={shapePath(shape, 6)} fillRule="evenodd" fill={visual.color} fillOpacity={0.4} stroke={visual.color} strokeWidth={1.6} strokeDasharray={shape === "circleDash" ? "2.5 2" : undefined} />
              </svg>
              {entry.label}
              <span className="font-mono text-[10px] text-muted">{entry.count}</span>
            </button>
          );
        })}
        <span className="text-[10px] text-muted/80">size = importance{scope === "portfolio" ? " / book weight" : ""}</span>
        {connecting && (
          <span className="ml-2 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] text-accent" role="status">
            Path mode: pick the destination node
          </span>
        )}
      </div>

      {/* Edge legend: every treatment on screen is explained (KG-027/028). */}
      {edgeLegendEntries.length > 0 && (
        <div role="group" aria-label="Connection types" className="flex flex-wrap items-center gap-2.5 text-[11px] text-muted">
          <span className="text-[10px] uppercase tracking-wider text-muted/80">Connections</span>
          {edgeLegendEntries.map(([type, count]) => {
            const visual = EDGE_VISUAL[type as keyof typeof EDGE_VISUAL];
            return (
              <span key={type} className="flex items-center gap-1.5" title={`${count} ${visual.label} connection${count === 1 ? "" : "s"}`}>
                <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
                  <line x1="1" y1="4" x2="21" y2="4" stroke={visual.color} strokeWidth="2" strokeDasharray={visual.dash} />
                </svg>
                {visual.label}
              </span>
            );
          })}
          <span className="text-[10px] text-muted/80">arrow = direction of the relation · width = strength</span>
        </div>
      )}

      {/* Focus-mode breadcrumb + hidden-node restore */}
      {(focusNodeId || hiddenNodes.size > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {focusNodeId && (
            <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-accent" role="status">
              Focused on {graph.nodes.find((n) => n.id === focusNodeId)?.label ?? focusNodeId} and its neighbors
              <button type="button" onClick={() => setFocusNodeId(null)} className="font-medium underline-offset-2 hover:underline">
                Show full graph
              </button>
            </span>
          )}
          {hiddenNodes.size > 0 && (
            <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-muted">
              {hiddenNodes.size} node{hiddenNodes.size === 1 ? "" : "s"} hidden
              <button type="button" onClick={() => setHiddenNodes(new Set())} className="font-medium text-foreground underline-offset-2 hover:underline">
                Unhide all
              </button>
            </span>
          )}
        </div>
      )}

      {/* Canvas / table + inspector */}
      <div className="grid gap-4 lg:h-[calc(100vh-330px)] lg:min-h-[480px] lg:grid-cols-[minmax(0,1fr)_340px]">
        {view === "graph" ? (
          <GraphCanvas
            ref={canvasRef}
            nodes={filteredNodes}
            edges={filteredEdges}
            focusId={focusNodeId ?? graph.meta.focusId}
            layout={layout}
            selected={selected}
            highlightedNodeIds={highlightedNodeIds}
            connectFromId={connecting ? connectFromId : null}
            onSelectNode={handleSelectNode}
            onSelectEdge={handleSelectEdge}
            onClearSelection={handleClearSelection}
            onFocusNeighborhood={(nodeId) => setFocusNodeId((prev) => (prev === nodeId ? null : nodeId))}
          />
        ) : (
          // Table parity (KG-046): the table sees exactly what the graph sees.
          <GraphTable graph={graph} nodes={filteredNodes} edges={filteredEdges} onSelectNode={handleSelectNode} onSelectEdge={handleSelectEdge} />
        )}

        <Inspector
          graph={graph}
          selected={selected}
          connecting={connecting}
          explanation={explanation}
          explanationLoading={explanationLoading}
          showExplanation={showExplanation}
          narrative={narrative}
          narrativeLoading={narrativeLoading}
          onGenerateNarrative={() => void generateNarrative()}
          onSelectNode={handleSelectNode}
          onSelectEdge={handleSelectEdge}
          onStartConnect={() => {
            if (selected?.kind === "node") {
              setConnectFromId(selected.id);
              setConnecting(true);
            }
          }}
          onRecenter={handleRecenter}
          onFocusNeighborhood={(nodeId) => setFocusNodeId((prev) => (prev === nodeId ? null : nodeId))}
          onHideNode={(nodeId) => {
            setHiddenNodes((prev) => new Set(prev).add(nodeId));
            setSelected(null);
          }}
          onCloseExplanation={() => {
            setShowExplanation(false);
            setExplanation(null);
            setConnectFromId(null);
          }}
        />
      </div>
    </div>
  );
}
