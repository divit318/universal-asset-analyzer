"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphNode, GraphEdge, NodeType } from "@/lib/knowledge-graph";

interface SimNode extends SimulationNodeDatum {
  id: string;
  node: GraphNode;
}

const NODE_COLOR: Record<NodeType, string> = {
  company: "var(--accent)",
  sector: "var(--chart-1)",
  portfolio: "var(--chart-5)",
  watchlist: "var(--chart-5)",
  timeline_event: "var(--chart-2)",
  market_event: "var(--chart-4)",
  opportunity: "var(--positive)",
  thesis: "var(--chart-3)",
  catalyst: "var(--chart-2)",
  risk: "var(--negative)",
};

function nodeRadius(node: GraphNode): number {
  return 7 + (Math.max(0, Math.min(100, node.importance)) / 100) * 20;
}

export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  connectFromId,
  highlightedNodeIds,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  connectFromId: string | null;
  highlightedNodeIds: Set<string> | null;
  onSelect: (nodeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const [size, setSize] = useState({ width: 800, height: 560 });
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: Math.max(420, entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * Frame every node inside the viewport.
   *
   * A force layout settles wherever it settles; it has no notion of a viewport.
   * Without this step nodes routinely came to rest outside the visible box — the
   * graph shipped with labels clipped off both edges ("a's Bold $6.5…" on the
   * left, "Appl" on the right) while most of the canvas sat empty. Panning to
   * find your own data is not exploration, it is a bug.
   *
   * The padding is asymmetric because the label is, so the fit accounts for text
   * that extends past a node's radius without wasting canvas on sides where
   * nothing is drawn.
   */
  const fitToView = useCallback(
    (pts: Map<string, { x: number; y: number }>) => {
      if (pts.size === 0) return;

      /* Label slack, measured from how the label is actually drawn: centred
         horizontally and 13px BELOW the node. So it needs generous horizontal
         room, a little below, and essentially none above. Padding all four sides
         equally (the obvious first cut) wasted ~20% of the canvas. */
      const PAD_X = 44;
      const PAD_TOP = 6;
      const PAD_BOTTOM = 26;

      const radii = new Map(nodes.map((n) => [n.id, nodeRadius(n)]));

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [id, p] of pts) {
        const r = radii.get(id) ?? 8;
        minX = Math.min(minX, p.x - r - PAD_X);
        maxX = Math.max(maxX, p.x + r + PAD_X);
        minY = Math.min(minY, p.y - r - PAD_TOP);
        maxY = Math.max(maxY, p.y + r + PAD_BOTTOM);
      }
      if (!Number.isFinite(minX)) return;

      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      // Never zoom past 1:1 — a three-node graph blown up to fill 900px looks
      // broken rather than spacious.
      const k = Math.max(0.3, Math.min(1, Math.min(size.width / w, size.height / h) * 0.96));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // The <g> is already translated by size/2, so this only has to cancel the
      // layout's own centroid offset.
      setTransform({ k, x: -cx * k, y: -cy * k });
    },
    [nodes, size.width, size.height],
  );

  useEffect(() => {
    const simNodes: SimNode[] = nodes.map((n) => ({ id: n.id, node: n }));
    const linkForce = forceLink<SimNode, { source: string; target: string }>(
      edges.map((e) => ({ source: e.source, target: e.target })),
    )
      .id((d) => d.id)
      .distance(95)
      .strength(0.35);

    const sim = forceSimulation(simNodes)
      .force("link", linkForce)
      .force("charge", forceManyBody().strength(-260))
      .force("center", forceCenter(0, 0))
      /* A gentle pull toward the origin on both axes.
      
         `forceCenter` only recentres the CENTROID; it does nothing to stop
         individual nodes drifting. With charge at -260 and link strength at 0.35,
         the news/event nodes — which have one edge or none — were being pushed
         thousands of units out. The centroid stayed at zero, so nothing looked
         wrong to the simulation, but the bounding box became so large that fitting
         it to the viewport shrank the actual cluster to a third of the canvas.
      
         0.045 is weak enough that it does not distort the clustering the graph is
         there to show, and strong enough that a poorly-connected node settles a
         readable distance out instead of at infinity. */
      .force("x", forceX(0).strength(0.045))
      .force("y", forceY(0).strength(0.045))
      .force("collide", forceCollide<SimNode>().radius((d) => nodeRadius(d.node) + 10))
      .on("tick", () => {
        setPositions(new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
      })
      .on("end", () => {
        // Frame it once the layout has stopped moving. Fitting on every tick
        // would make the whole graph visibly breathe while it settles.
        fitToView(new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
      });

    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
    // `fitToView` depends on size; refitting on resize is handled separately so a
    // window resize does not restart the whole simulation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Re-frame when the container resizes, without disturbing the layout itself.
  useEffect(() => {
    if (positions.size === 0) return;
    const id = setTimeout(() => fitToView(positions), 120);
    return () => clearTimeout(id);
    // Intentionally keyed on size only — refitting on every tick would fight the
    // simulation, and refitting on `positions` would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  const screenToLocal = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const sx = clientX - rect.left - size.width / 2 - transform.x;
    const sy = clientY - rect.top - size.height / 2 - transform.y;
    return { x: sx / transform.k, y: sy / transform.k };
  };

  function onNodePointerDown(e: React.PointerEvent, nodeId: string) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragNodeId(nodeId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragNodeId) {
      const { x, y } = screenToLocal(e.clientX, e.clientY);
      const sim = simRef.current;
      if (!sim) return;
      const simNode = sim.nodes().find((n) => n.id === dragNodeId);
      if (simNode) {
        simNode.fx = x;
        simNode.fy = y;
        sim.alphaTarget(0.15).restart();
      }
      return;
    }
    if (panStart.current) {
      const start = panStart.current;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      setTransform((t) => ({ ...t, x: start.tx + dx, y: start.ty + dy }));
    }
  }

  function onPointerUp() {
    if (dragNodeId) {
      const sim = simRef.current;
      const simNode = sim?.nodes().find((n) => n.id === dragNodeId);
      if (simNode) {
        simNode.fx = null;
        simNode.fy = null;
      }
      sim?.alphaTarget(0);
    }
    setDragNodeId(null);
    panStart.current = null;
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setTransform((t) => ({ ...t, k: Math.max(0.3, Math.min(3, t.k + delta * t.k)) }));
  }

  const highlightedEdgeIds = useMemo(() => {
    if (!highlightedNodeIds) return null;
    const set = new Set<string>();
    for (const e of edges) {
      if (highlightedNodeIds.has(e.source) && highlightedNodeIds.has(e.target)) set.add(e.id);
    }
    return set;
  }, [edges, highlightedNodeIds]);

  return (
    <div
      ref={containerRef}
      /* Taller, and sized to the viewport rather than to a fixed 560px. The graph
         is the flagship expression of "everything is connected", and it was being
         shown through a letterbox. `min-h` keeps it usable on a laptop; the vh
         term lets a large display actually be used. */
      className="relative h-[min(78vh,900px)] min-h-[520px] w-full touch-none overflow-hidden rounded-card border border-border bg-surface"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerDown={onBackgroundPointerDown}
      onWheel={onWheel}
    >
      {/* Zoom/fit controls. "Fit" exists because a user who has panned away
          needs a way back that is not "reload the page". */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-control border border-border bg-surface/90 p-0.5 backdrop-blur">
        {[
          { label: "−", title: "Zoom out", onClick: () => setTransform((t) => ({ ...t, k: Math.max(0.3, t.k / 1.25) })) },
          { label: "+", title: "Zoom in", onClick: () => setTransform((t) => ({ ...t, k: Math.min(3, t.k * 1.25) })) },
        ].map((b) => (
          <button
            key={b.title}
            type="button"
            title={b.title}
            onClick={(e) => { e.stopPropagation(); b.onClick(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-6 w-6 rounded-control font-mono text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          title="Fit every node in view"
          onClick={(e) => { e.stopPropagation(); fitToView(positions); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded-control px-2 py-1 text-[10px] uppercase tracking-widest text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          Fit
        </button>
      </div>

      <svg width={size.width} height={size.height} className="cursor-grab active:cursor-grabbing">
        <g transform={`translate(${size.width / 2 + transform.x}, ${size.height / 2 + transform.y}) scale(${transform.k})`}>
          {edges.map((edge) => {
            const s = positions.get(edge.source);
            const t = positions.get(edge.target);
            if (!s || !t) return null;
            const dimmed = highlightedEdgeIds != null && !highlightedEdgeIds.has(edge.id);
            const active = highlightedEdgeIds?.has(edge.id);
            return (
              /* Edges are the entire point of this view — "how your names
                 connect" — and they were effectively invisible: `--border`
                 (#282d37) drawn 0.75px wide at 0.45 opacity on `--surface`, then
                 scaled DOWN further by the zoom transform. The graph read as a
                 field of unconnected dots.
              
                 Three fixes: the stronger border token, a higher floor on width
                 and opacity, and `non-scaling-stroke` so a line stays 1px on
                 screen no matter how far the view is zoomed out. */
              <line
                key={edge.id}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={active ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={active ? 2.5 : Math.max(1.15, edge.strength / 45)}
                vectorEffect="non-scaling-stroke"
                opacity={dimmed ? 0.12 : active ? 0.9 : 0.75}
              />
            );
          })}
          {nodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const r = nodeRadius(node);
            const isSelected = node.id === selectedId;
            const isConnectFrom = node.id === connectFromId;
            const dimmed = highlightedNodeIds != null && !highlightedNodeIds.has(node.id);
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onPointerDown={(e) => onNodePointerDown(e, node.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(node.id);
                }}
                className="cursor-pointer"
                opacity={dimmed ? 0.2 : 1}
              >
                <circle
                  r={r}
                  fill={NODE_COLOR[node.type]}
                  fillOpacity={node.type === "company" ? 0.28 : 0.22}
                  stroke={NODE_COLOR[node.type]}
                  strokeWidth={isSelected || isConnectFrom ? 3 : 1.5}
                />
                {/* The drawn label is truncated to 18 characters to keep the
                    canvas legible, so the full one has to remain recoverable —
                    otherwise a node reading "Nvidia, SK Group P…" is unidentifiable
                    without clicking it. */}
                <title>{node.label}</title>
                {(isSelected || isConnectFrom || r >= 14) && (
                  <text
                    y={r + 13}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                    style={{ fontSize: 10, fill: "var(--foreground)", fontFamily: "var(--font-mono)" }}
                  >
                    {node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-1 text-[10px] text-muted/70">
        <span>Scroll to zoom · drag background to pan · drag a node to reposition</span>
      </div>
    </div>
  );
}
