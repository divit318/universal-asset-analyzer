"use client";

/**
 * Knowledge Graph canvas (v2).
 *
 * SVG renderer with a d3-force layout below ~150 nodes (profiled: React SVG
 * reconciliation stays comfortably under a frame at this scale; a canvas/WebGL
 * path is not warranted for graphs this size and would cost hit-testing and
 * accessibility — revisit if scopes ever exceed that threshold).
 *
 * Encodings:
 * - node type: shape + color (works without color vision)
 * - node importance/position weight: size
 * - edge relation: color + dash; edge strength: width; direction: chevron
 * - selection/hover: outline + neighbor emphasis, dimming keeps AA contrast
 *   (dimmed labels switch to the muted token instead of fading opacity)
 *
 * Interaction: pan (drag background), zoom (wheel, buttons, +/-/0 keys),
 * drag nodes, hover tooltips, click nodes AND edges, full keyboard traversal
 * (Tab into the graph, arrows cycle nodes, Enter selects, Escape clears).
 * Layouts: force (deterministic seed) and radial (weight-driven rings).
 * prefers-reduced-motion: the simulation settles synchronously, no animation.
 */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
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
import type { GraphNode, GraphEdge } from "@/lib/knowledge-graph";
import { NODE_VISUAL, EDGE_VISUAL, shapePath, nodeRadius, hashAngle } from "./graph-model";

export type GraphLayout = "force" | "radial";

export interface GraphSelection {
  kind: "node" | "edge";
  id: string;
}

export interface GraphCanvasHandle {
  fit: () => void;
  exportPng: () => void;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  node: GraphNode;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusId: string;
  layout: GraphLayout;
  selected: GraphSelection | null;
  /** Node ids to emphasize (search matches or an active path); null = no emphasis. */
  highlightedNodeIds: Set<string> | null;
  /** Second endpoint picker for "find path" mode. */
  connectFromId: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onClearSelection: () => void;
  onOpenNode?: (node: GraphNode) => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

function GraphCanvasInner(
  {
    nodes,
    edges,
    focusId,
    layout,
    selected,
    highlightedNodeIds,
    connectFromId,
    onSelectNode,
    onSelectEdge,
    onClearSelection,
  }: Props,
  ref: React.Ref<GraphCanvasHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const [size, setSize] = useState({ width: 800, height: 560 });
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [keyboardFocusId, setKeyboardFocusId] = useState<string | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const dragMoved = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: Math.max(440, entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Frame every node inside the viewport, with slack for labels. */
  const fitToView = useCallback(
    (pts: Map<string, { x: number; y: number }>) => {
      if (pts.size === 0) return;
      const PAD_X = 56;
      const PAD_TOP = 10;
      const PAD_BOTTOM = 30;
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
      // Never zoom past 1:1 — a three-node graph blown up to 900px looks broken.
      const k = Math.max(MIN_ZOOM, Math.min(1, Math.min(size.width / w, size.height / h) * 0.96));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      setTransform({ k, x: -cx * k, y: -cy * k });
    },
    [nodes, size.width, size.height],
  );

  /** Radial layout: focus centered, assets ringed by weight, satellites near their parent. */
  const computeRadial = useCallback((): Map<string, { x: number; y: number }> => {
    const pts = new Map<string, { x: number; y: number }>();
    const neighborOf = new Map<string, string>();
    for (const e of edges) {
      if (e.source === focusId) neighborOf.set(e.target, focusId);
      if (e.target === focusId) neighborOf.set(e.source, focusId);
    }
    pts.set(focusId, { x: 0, y: 0 });

    const ring1 = nodes.filter((n) => n.id !== focusId && neighborOf.has(n.id));
    ring1.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.label.localeCompare(b.label));
    const n1 = Math.max(1, ring1.length);
    ring1.forEach((node, i) => {
      const angle = (i / n1) * Math.PI * 2 - Math.PI / 2;
      // Heavier positions sit closer to the center: weight is the radius driver.
      const w = Math.min(1, (node.weight ?? 0) * 4);
      const r = 150 + (1 - w) * 130;
      pts.set(node.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    });

    // Everything else clusters around its nearest placed neighbor, fanned
    // outward (away from the center) so siblings never pile onto one spot.
    const remaining = nodes.filter((n) => !pts.has(n.id));
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
      adjacency.set(e.target, [...(adjacency.get(e.target) ?? []), e.source]);
    }
    const byParent = new Map<string, typeof remaining>();
    for (const node of remaining) {
      const parentId = (adjacency.get(node.id) ?? []).find((pid) => pts.has(pid)) ?? focusId;
      byParent.set(parentId, [...(byParent.get(parentId) ?? []), node]);
    }
    for (const [parentId, children] of byParent) {
      const parent = pts.get(parentId) ?? { x: 0, y: 0 };
      const outward = Math.atan2(parent.y, parent.x) || hashAngle(parentId);
      const spread = Math.PI / 2.2; // fan width
      children.forEach((node, i) => {
        const t = children.length === 1 ? 0.5 : i / (children.length - 1);
        const angle = outward + (t - 0.5) * spread;
        const dist = 85 + (i % 2) * 34;
        pts.set(node.id, { x: parent.x + Math.cos(angle) * dist, y: parent.y + Math.sin(angle) * dist });
      });
    }
    return pts;
  }, [nodes, edges, focusId]);

  useEffect(() => {
    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (layout === "radial") {
      simRef.current?.stop();
      simRef.current = null;
      const pts = computeRadial();
      const id = requestAnimationFrame(() => {
        setPositions(pts);
        fitToView(pts);
      });
      return () => cancelAnimationFrame(id);
    }

    // Deterministic seed: same graph, same layout, every visit.
    const simNodes: SimNode[] = nodes.map((n) => {
      const angle = hashAngle(n.id);
      const r = n.id === focusId ? 0 : 160 + (hashAngle(`${n.id}:seed`) / (Math.PI * 2)) * 120;
      return { id: n.id, node: n, x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    });
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
      // Gentle pull toward the origin so poorly-connected nodes settle a
      // readable distance out instead of at infinity (forceCenter only
      // recentres the centroid; it does not bound individual nodes).
      .force("x", forceX(0).strength(0.045))
      .force("y", forceY(0).strength(0.045))
      .force("collide", forceCollide<SimNode>().radius((d) => nodeRadius(d.node) + 12));

    const snapshot = () => new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));

    if (reducedMotion) {
      // Settle synchronously: no animation for users who asked for none.
      sim.stop();
      for (let i = 0; i < 300; i++) sim.tick();
      const pts = snapshot();
      const id = requestAnimationFrame(() => {
        setPositions(pts);
        fitToView(pts);
      });
      simRef.current = sim;
      return () => {
        cancelAnimationFrame(id);
        sim.stop();
        simRef.current = null;
      };
    }

    sim
      .on("tick", () => setPositions(snapshot()))
      .on("end", () => fitToView(snapshot()));
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
    // fitToView depends on size; refitting on resize is handled separately so a
    // window resize does not restart the whole simulation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, layout, focusId, computeRadial]);

  // Re-frame when the container resizes, without disturbing the layout itself.
  useEffect(() => {
    if (positions.size === 0) return;
    const id = setTimeout(() => fitToView(positions), 120);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => fitToView(positions),
      exportPng: () => {
        const svg = svgRef.current;
        if (!svg) return;
        const clone = svg.cloneNode(true) as SVGSVGElement;
        // Inline the theme tokens so the exported bitmap matches the screen.
        const styles = getComputedStyle(document.documentElement);
        const inline = (el: Element) => {
          for (const attr of ["fill", "stroke"]) {
            const v = el.getAttribute(attr);
            if (v?.startsWith("var(")) {
              const token = v.slice(4, -1).trim();
              el.setAttribute(attr, styles.getPropertyValue(token).trim() || "#888");
            }
          }
          for (const child of el.children) inline(child);
        };
        inline(clone);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const bg = styles.getPropertyValue("--surface").trim() || "#131519";
        const xml = new XMLSerializer().serializeToString(clone);
        const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = size.width * 2;
          canvas.height = size.height * 2;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          const a = document.createElement("a");
          a.href = canvas.toDataURL("image/png");
          a.download = "knowledge-graph.png";
          a.click();
        };
        img.src = url;
      },
    }),
    [fitToView, positions, size.width, size.height],
  );

  /* ---------------------------- pointer handling --------------------------- */

  const screenToLocal = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const sx = clientX - rect.left - size.width / 2 - transform.x;
    const sy = clientY - rect.top - size.height / 2 - transform.y;
    return { x: sx / transform.k, y: sy / transform.k };
  };

  function onNodePointerDown(e: React.PointerEvent, nodeId: string) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragMoved.current = false;
    setDragNodeId(nodeId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragNodeId) {
      dragMoved.current = true;
      const { x, y } = screenToLocal(e.clientX, e.clientY);
      if (layout === "radial") {
        setPositions((prev) => new Map(prev).set(dragNodeId, { x, y }));
        return;
      }
      const sim = simRef.current;
      const simNode = sim?.nodes().find((n) => n.id === dragNodeId);
      if (simNode && sim) {
        simNode.fx = x;
        simNode.fy = y;
        sim.alphaTarget(0.15).restart();
      }
      return;
    }
    if (panStart.current) {
      const start = panStart.current;
      setTransform((t) => ({ ...t, x: start.tx + (e.clientX - start.x), y: start.ty + (e.clientY - start.y) }));
    }
  }

  function onPointerUp() {
    if (dragNodeId && layout === "force") {
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
    dragMoved.current = false;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setTransform((t) => ({ ...t, k: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.k + delta * t.k)) }));
  }

  const zoomBy = (factor: number) =>
    setTransform((t) => ({ ...t, k: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.k * factor)) }));

  /* ---------------------------- keyboard handling -------------------------- */

  const orderedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label)),
    [nodes],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "+" || e.key === "=") { zoomBy(1.25); e.preventDefault(); return; }
    if (e.key === "-") { zoomBy(1 / 1.25); e.preventDefault(); return; }
    if (e.key === "0") { fitToView(positions); e.preventDefault(); return; }
    if (e.key === "Escape") { setKeyboardFocusId(null); onClearSelection(); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      if (orderedNodes.length === 0) return;
      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      const idx = keyboardFocusId ? orderedNodes.findIndex((n) => n.id === keyboardFocusId) : -1;
      const next = orderedNodes[(idx + dir + orderedNodes.length) % orderedNodes.length];
      setKeyboardFocusId(next.id);
      // Keep the focused node in view.
      const p = positions.get(next.id);
      if (p) setTransform((t) => ({ ...t, x: -p.x * t.k, y: -p.y * t.k }));
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && keyboardFocusId) {
      e.preventDefault();
      onSelectNode(keyboardFocusId);
    }
  }

  /* ------------------------------- rendering ------------------------------- */

  const neighborIds = useMemo(() => {
    const active = hoverId ?? (selected?.kind === "node" ? selected.id : null);
    if (!active) return null;
    const set = new Set<string>([active]);
    for (const e of edges) {
      if (e.source === active) set.add(e.target);
      if (e.target === active) set.add(e.source);
    }
    return set;
  }, [hoverId, selected, edges]);

  const emphasizedNodeIds = useMemo(() => {
    if (highlightedNodeIds) return highlightedNodeIds;
    return neighborIds;
  }, [highlightedNodeIds, neighborIds]);

  const emphasizedEdgeIds = useMemo(() => {
    if (!emphasizedNodeIds) return null;
    const set = new Set<string>();
    const active = hoverId ?? (selected?.kind === "node" ? selected.id : null);
    for (const e of edges) {
      if (highlightedNodeIds) {
        if (emphasizedNodeIds.has(e.source) && emphasizedNodeIds.has(e.target)) set.add(e.id);
      } else if (active && (e.source === active || e.target === active)) {
        set.add(e.id);
      }
    }
    return set;
  }, [edges, emphasizedNodeIds, highlightedNodeIds, hoverId, selected]);

  const hoverNode = hoverId ? nodes.find((n) => n.id === hoverId) ?? null : null;
  const hoverPos = hoverNode ? positions.get(hoverNode.id) : null;

  const showLabel = (node: GraphNode) => {
    if (node.type === "company" || node.type === "sector" || node.type === "portfolio" || node.type === "watchlist") return true;
    if (selected?.kind === "node" && selected.id === node.id) return true;
    if (node.id === hoverId || node.id === keyboardFocusId || node.id === connectFromId) return true;
    if (emphasizedNodeIds?.has(node.id)) return true;
    return transform.k >= 1.05 || node.importance >= 75;
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[440px] w-full touch-none overflow-hidden rounded-xl border border-border bg-surface"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerDown={onBackgroundPointerDown}
      onWheel={onWheel}
      onClick={() => {
        if (!dragMoved.current) onClearSelection();
      }}
    >
      {/* Zoom / fit controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 p-0.5 backdrop-blur">
        <button
          type="button"
          title="Zoom out (-)"
          aria-label="Zoom out"
          onClick={(e) => { e.stopPropagation(); zoomBy(1 / 1.25); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-md font-mono text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        >
          −
        </button>
        <span aria-live="polite" className="w-12 text-center font-mono text-[11px] text-muted">
          {Math.round(transform.k * 100)}%
        </span>
        <button
          type="button"
          title="Zoom in (+)"
          aria-label="Zoom in"
          onClick={(e) => { e.stopPropagation(); zoomBy(1.25); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-md font-mono text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        >
          +
        </button>
        <button
          type="button"
          title="Fit every node in view (0)"
          onClick={(e) => { e.stopPropagation(); fitToView(positions); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded-md px-2 py-1.5 text-[10px] uppercase tracking-widest text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        >
          Fit
        </button>
      </div>

      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        role="application"
        aria-label={`Knowledge graph, ${nodes.length} nodes and ${edges.length} connections. Use arrow keys to move between nodes, Enter to select, Escape to clear. A table alternative is available via the Table view toggle.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (!keyboardFocusId && orderedNodes.length > 0) setKeyboardFocusId(orderedNodes[0].id);
        }}
        className="cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
      >
        <g transform={`translate(${size.width / 2 + transform.x}, ${size.height / 2 + transform.y}) scale(${transform.k})`}>
          {edges.map((edge) => {
            const s = positions.get(edge.source);
            const t = positions.get(edge.target);
            if (!s || !t) return null;
            const visual = EDGE_VISUAL[edge.type];
            const isSelected = selected?.kind === "edge" && selected.id === edge.id;
            const emphasized = emphasizedEdgeIds?.has(edge.id) ?? false;
            const dimmed = emphasizedEdgeIds != null && !emphasized && !isSelected;
            const width = isSelected ? 3 : Math.max(1.2, edge.strength / 40);
            // Direction chevron at 62% along the edge.
            const mx = s.x + (t.x - s.x) * 0.62;
            const my = s.y + (t.y - s.y) * 0.62;
            const angle = (Math.atan2(t.y - s.y, t.x - s.x) * 180) / Math.PI;
            return (
              <g key={edge.id} opacity={dimmed ? 0.18 : 1}>
                <line
                  x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                  stroke={isSelected ? "var(--accent)" : visual.color}
                  strokeWidth={width}
                  strokeDasharray={visual.dash}
                  vectorEffect="non-scaling-stroke"
                  opacity={isSelected || emphasized ? 0.95 : 0.55}
                />
                {edge.directed && (
                  <path
                    d="M -4 -3.5 L 4 0 L -4 3.5"
                    transform={`translate(${mx}, ${my}) rotate(${angle})`}
                    fill="none"
                    stroke={isSelected ? "var(--accent)" : visual.color}
                    strokeWidth={1.4}
                    opacity={isSelected || emphasized ? 0.95 : 0.55}
                  />
                )}
                {/* Fat invisible hit area: edges are clickable ("why is this connected?" is an edge concept). */}
                <line
                  x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                  stroke="transparent"
                  strokeWidth={12 / transform.k}
                  className="cursor-pointer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onSelectEdge(edge.id); }}
                >
                  <title>{`${edge.label}: ${edge.evidence}`}</title>
                </line>
              </g>
            );
          })}

          {nodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const r = nodeRadius(node);
            const visual = NODE_VISUAL[node.type];
            const isSelected = selected?.kind === "node" && selected.id === node.id;
            const isConnectFrom = node.id === connectFromId;
            const isKeyFocus = node.id === keyboardFocusId;
            const dimmed = emphasizedNodeIds != null && !emphasizedNodeIds.has(node.id) && !isSelected;
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onPointerDown={(e) => onNodePointerDown(e, node.id)}
                onPointerEnter={() => setHoverId(node.id)}
                onPointerLeave={() => setHoverId((h) => (h === node.id ? null : h))}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!dragMoved.current) onSelectNode(node.id);
                }}
                className="cursor-pointer"
              >
                {/* Invisible 24px-minimum hit target regardless of node size. */}
                <circle r={Math.max(r + 4, 13)} fill="transparent" />
                <path
                  d={shapePath(visual.shape, r)}
                  fill={visual.color}
                  fillOpacity={dimmed ? 0.12 : node.type === "sector" ? 0.34 : 0.3}
                  stroke={visual.color}
                  strokeOpacity={dimmed ? 0.4 : 1}
                  strokeWidth={isSelected || isConnectFrom ? 3 : 1.6}
                />
                {isSelected && (
                  <path d={shapePath(visual.shape, r + 5)} fill="none" stroke="var(--accent)" strokeWidth={1.4} opacity={0.9} />
                )}
                {isKeyFocus && (
                  <path d={shapePath(visual.shape, r + 8)} fill="none" stroke="var(--foreground)" strokeWidth={1.2} strokeDasharray="3 3" />
                )}
                <title>{node.fullLabel}</title>
                {showLabel(node) && (
                  <text
                    y={r + 14}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                    style={{
                      fontSize: 11,
                      fill: dimmed ? "var(--muted)" : "var(--foreground)",
                      fontFamily: "var(--font-sans)",
                      fontWeight: node.id === focusId ? 600 : 400,
                    }}
                  >
                    {node.label.length > 26 ? `${node.label.slice(0, 24)}…` : node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hover tooltip (HTML, so it never clips or scales with zoom). */}
      {hoverNode && hoverPos && !dragNodeId && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 max-w-xs rounded-lg border border-border bg-surface-2 px-3 py-2 shadow-lg"
          style={{
            left: Math.min(size.width - 220, Math.max(8, size.width / 2 + transform.x + hoverPos.x * transform.k + 14)),
            top: Math.max(8, size.height / 2 + transform.y + hoverPos.y * transform.k - 12),
          }}
        >
          <p className="text-xs font-medium text-foreground">{hoverNode.fullLabel}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {NODE_VISUAL[hoverNode.type].label}
            {hoverNode.metrics.instrument ? ` · ${hoverNode.metrics.instrument}` : ""}
            {hoverNode.weight != null ? ` · ${(hoverNode.weight * 100).toFixed(1)}% of book` : ""}
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 right-3 text-[11px] text-muted">
        Scroll to zoom · drag to pan · click a node or edge to inspect
      </div>
    </div>
  );
}

export const GraphCanvas = memo(forwardRef(GraphCanvasInner));
GraphCanvas.displayName = "GraphCanvas";
