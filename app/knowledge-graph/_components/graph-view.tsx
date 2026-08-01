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
} from "@/lib/knowledge-graph";
import { GraphCanvas, type GraphCanvasHandle, type GraphLayout, type GraphSelection } from "./graph-canvas";
import { GraphTable } from "./graph-table";
import { Inspector } from "./inspector";
import { NODE_VISUAL, shapePath } from "./graph-model";

export interface GraphViewState {
  layout: GraphLayout | null; // null = scope default
  view: "graph" | "table";
  q: string;
  hiddenTypes: NodeType[];
  minStrength: number;
  selected: string | null; // node id only (edges are session-local)
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
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set(initialState.hiddenTypes ?? []));
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
      minStrength,
      selected: selected?.kind === "node" ? selected.id : null,
    });
  }, [layoutOverride, view, debouncedSearch, hiddenTypes, minStrength, selected, onViewStateChange]);

  /* ------------------------------- filtering ------------------------------- */

  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!graph) return { filteredNodes: [], filteredEdges: [] };
    const keptNodes = graph.nodes.filter((n) => !hiddenTypes.has(n.type) || n.id === graph.meta.focusId);
    const keptIds = new Set(keptNodes.map((n) => n.id));
    const keptEdges = graph.edges.filter(
      (e) => e.strength >= minStrength && keptIds.has(e.source) && keptIds.has(e.target),
    );
    // Re-prune isolates created by filtering (zero orphans stays true under filters).
    const degree = new Map<string, number>();
    for (const e of keptEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const finalNodes = keptNodes.filter((n) => (degree.get(n.id) ?? 0) > 0 || n.id === graph.meta.focusId);
    return { filteredNodes: finalNodes, filteredEdges: keptEdges };
  }, [graph, hiddenTypes, minStrength]);

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

  const typeCounts = useMemo(() => {
    const counts = new Map<NodeType, number>();
    for (const n of graph?.nodes ?? []) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return counts;
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

  const toggleType = useCallback((type: NodeType) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
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
            placeholder="Highlight nodes…"
            aria-label="Highlight nodes matching text"
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
              <option value={0}>Any</option>
              <option value={40}>40+</option>
              <option value={60}>60+</option>
              <option value={80}>80+</option>
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

      {/* Legend doubles as the node-type filter: click to hide/show, with counts. */}
      <div role="group" aria-label="Node types (click to filter)" className="flex flex-wrap items-center gap-1.5">
        {([...typeCounts.entries()] as [NodeType, number][]).map(([type, count]) => {
          const visual = NODE_VISUAL[type];
          const hidden = hiddenTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={!hidden}
              onClick={() => toggleType(type)}
              title={hidden ? `Show ${visual.label} nodes` : `Hide ${visual.label} nodes`}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                hidden
                  ? "border-border text-muted line-through opacity-60"
                  : "border-border text-foreground hover:border-accent/40"
              }`}
            >
              <svg width="10" height="10" viewBox="-8 -8 16 16" aria-hidden="true">
                <path d={shapePath(visual.shape, 6)} fill={visual.color} fillOpacity={0.4} stroke={visual.color} strokeWidth={1.6} />
              </svg>
              {visual.label}
              <span className="font-mono text-[10px] text-muted">{count}</span>
            </button>
          );
        })}
        {connecting && (
          <span className="ml-2 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] text-accent" role="status">
            Path mode: pick the destination node
          </span>
        )}
      </div>

      {/* Canvas / table + inspector */}
      <div className="grid gap-4 lg:h-[calc(100vh-330px)] lg:min-h-[480px] lg:grid-cols-[minmax(0,1fr)_340px]">
        {view === "graph" ? (
          <GraphCanvas
            ref={canvasRef}
            nodes={filteredNodes}
            edges={filteredEdges}
            focusId={graph.meta.focusId}
            layout={layout}
            selected={selected}
            highlightedNodeIds={highlightedNodeIds}
            connectFromId={connecting ? connectFromId : null}
            onSelectNode={handleSelectNode}
            onSelectEdge={handleSelectEdge}
            onClearSelection={handleClearSelection}
          />
        ) : (
          <GraphTable graph={graph} onSelectNode={handleSelectNode} onSelectEdge={handleSelectEdge} />
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
