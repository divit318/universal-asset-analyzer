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
import { detectCommunities } from "@/lib/knowledge-graph/community";
import { NODE_VISUAL, EDGE_VISUAL, shapePath, shapeStrokeDash, nodeShape, nodeRadius, hashAngle } from "./graph-model";

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
  /** Double-click: reduce the view to this node's neighborhood (focus mode). */
  onFocusNeighborhood?: (nodeId: string) => void;
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
    onFocusNeighborhood,
  }: Props,
  ref: React.Ref<GraphCanvasHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const [size, setSize] = useState({ width: 800, height: 560 });
  // The d3 "end" handler closes over fitToView once per layout effect; the
  // ref keeps the viewport it frames against current (a stale 800x560
  // default made fit a no-op on narrow viewports).
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [keyboardFocusId, setKeyboardFocusId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
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

      const { width, height } = sizeRef.current;
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      // Never zoom past 1:1 — a three-node graph blown up to 900px looks broken.
      const k = Math.max(MIN_ZOOM, Math.min(1, Math.min(width / w, height / h) * 0.96));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      setTransform({ k, x: -cx * k, y: -cy * k });
    },
    [nodes],
  );

  /**
   * Radial layout: GENUINELY radial (KG-035) — concentric rings by BFS hop
   * depth from the focus. Within a ring, nodes are ordered by their parent's
   * angle (children stay near their parent's bearing, siblings never pile up)
   * and spaced evenly, so rings cannot self-overlap. Ring 1 is additionally
   * ordered by position weight, heaviest first, so the book reads clockwise
   * from 12 o'clock.
   */
  const computeRadial = useCallback((): Map<string, { x: number; y: number }> => {
    const pts = new Map<string, { x: number; y: number }>();
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
      adjacency.set(e.target, [...(adjacency.get(e.target) ?? []), e.source]);
    }

    // BFS depth + parent from the focus.
    const depth = new Map<string, number>([[focusId, 0]]);
    const parent = new Map<string, string>();
    const queue = [focusId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const next of adjacency.get(id) ?? []) {
        if (depth.has(next)) continue;
        depth.set(next, depth.get(id)! + 1);
        parent.set(next, id);
        queue.push(next);
      }
    }
    // Unreached nodes (possible under client-side filters) join the outermost ring.
    const maxSeen = Math.max(1, ...[...depth.values()]);
    for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, maxSeen);

    pts.set(focusId, { x: 0, y: 0 });
    const maxDepth = Math.max(...nodes.map((n) => depth.get(n.id) ?? 1));
    const angleOf = new Map<string, number>([[focusId, -Math.PI / 2]]);

    for (let d = 1; d <= maxDepth; d++) {
      const ring = nodes.filter((n) => depth.get(n.id) === d);
      if (ring.length === 0) continue;
      ring.sort((a, b) => {
        if (d === 1) return (b.weight ?? 0) - (a.weight ?? 0) || a.label.localeCompare(b.label);
        const pa = angleOf.get(parent.get(a.id) ?? focusId) ?? hashAngle(a.id);
        const pb = angleOf.get(parent.get(b.id) ?? focusId) ?? hashAngle(b.id);
        return pa - pb || a.label.localeCompare(b.label);
      });
      // Ring radius grows with depth; wide rings get extra room so even
      // spacing keeps at least ~48px of arc between neighbors.
      const minArc = 48;
      const r = Math.max(150 + (d - 1) * 115, (ring.length * minArc) / (2 * Math.PI));
      ring.forEach((node, i) => {
        const angle = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
        angleOf.set(node.id, angle);
        pts.set(node.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
      });
    }
    return pts;
  }, [nodes, edges, focusId]);

  useEffect(() => {
    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // A new layout/graph invalidates pinned positions. Scheduled (not
    // synchronous) so the effect body never sets state directly; clearing
    // pins is idempotent, so a stale callback is harmless.
    requestAnimationFrame(() => setPinnedIds((prev) => (prev.size > 0 ? new Set() : prev)));

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

    // Community-informed seeding + cohesion (KG-005): each detected community
    // is assigned an angular sector; members seed inside it and feel a gentle
    // pull toward its centroid, so clusters lay out as visible groups instead
    // of interleaving in one gravity well. Deterministic: same graph, same
    // communities, same layout, every visit.
    const communities = detectCommunities(nodes, edges);
    const communityCount = Math.max(1, new Set(communities.values()).size);
    const communityAnchor = (id: string): { x: number; y: number } => {
      const c = communities.get(id) ?? 0;
      const angle = (c / communityCount) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(angle) * 150, y: Math.sin(angle) * 150 };
    };
    const simNodes: SimNode[] = nodes.map((n) => {
      if (n.id === focusId) return { id: n.id, node: n, x: 0, y: 0 };
      const anchor = communityAnchor(n.id);
      const jitter = hashAngle(`${n.id}:seed`);
      return {
        id: n.id,
        node: n,
        x: anchor.x + Math.cos(jitter) * 70,
        y: anchor.y + Math.sin(jitter) * 70,
      };
    });
    const linkForce = forceLink<SimNode, { source: string; target: string }>(
      edges.map((e) => ({ source: e.source, target: e.target })),
    )
      .id((d) => d.id)
      .distance(95)
      .strength(0.35);

    const sim = forceSimulation(simNodes)
      // The deterministic seed starts near equilibrium, so the default decay's
      // ~300 ticks (~5s wall time) buy nothing after the first ~100. 0.06
      // settles in ~110 ticks (~1.8s) with no visible layout difference.
      .alphaDecay(0.06)
      .force("link", linkForce)
      .force("charge", forceManyBody().strength(-260))
      .force("center", forceCenter(0, 0))
      // Community cohesion doubles as the origin pull that keeps
      // poorly-connected nodes from drifting to infinity (forceCenter only
      // recentres the centroid; it does not bound individual nodes).
      .force("x", forceX<SimNode>((d) => (d.id === focusId ? 0 : communityAnchor(d.id).x)).strength(0.05))
      .force("y", forceY<SimNode>((d) => (d.id === focusId ? 0 : communityAnchor(d.id).y)).strength(0.05))
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
      if (simNode && dragMoved.current) {
        // A deliberate drag pins the node where the user put it (KG-039);
        // fx/fy stay set. "Clear pins" and Alt-click release.
        setPinnedIds((prev) => new Set(prev).add(dragNodeId));
      } else if (simNode) {
        simNode.fx = null;
        simNode.fy = null;
      }
      sim?.alphaTarget(0);
    }
    setDragNodeId(null);
    panStart.current = null;
  }

  const unpinNode = useCallback((nodeId: string) => {
    const simNode = simRef.current?.nodes().find((n) => n.id === nodeId);
    if (simNode) {
      simNode.fx = null;
      simNode.fy = null;
      simRef.current?.alpha(0.2).restart();
    }
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

  const clearPins = useCallback(() => {
    for (const simNode of simRef.current?.nodes() ?? []) {
      simNode.fx = null;
      simNode.fy = null;
    }
    simRef.current?.alpha(0.3).restart();
    setPinnedIds(new Set());
  }, []);

  function onBackgroundPointerDown(e: React.PointerEvent) {
    panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    dragMoved.current = false;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    const rect = containerRef.current?.getBoundingClientRect();
    setTransform((t) => {
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.k + delta * t.k));
      if (!rect || k === t.k) return { ...t, k };
      // Anchor the zoom on the cursor: the graph point under the pointer
      // stays under the pointer (KG-045).
      const px = e.clientX - rect.left - size.width / 2;
      const py = e.clientY - rect.top - size.height / 2;
      const scale = k / t.k;
      return { k, x: px - (px - t.x) * scale, y: py - (py - t.y) * scale };
    });
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

  // Greedy label occlusion: when two labels would overlap on screen at the
  // current zoom, the less important one is suppressed (it remains available
  // on hover and in the tooltip). Guarantees zero label collisions at any
  // zoom for the labels actually drawn. O(n^2) over <=~60 labels per frame.
  const suppressedLabelIds = useMemo(() => {
    const kept: { x: number; y: number; w: number; h: number }[] = [];
    const suppressed = new Set<string>();
    const k = transform.k;
    const eligible = [...nodes]
      .filter((n) => positions.has(n.id))
      .sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : b.importance - a.importance));
    for (const node of eligible) {
      const pos = positions.get(node.id)!;
      const text = node.label.length > 26 ? node.label.slice(0, 25) : node.label;
      const w = text.length * 6.4 * k;
      const h = 13 * k;
      const rect = { x: pos.x * k - w / 2, y: (pos.y + nodeRadius(node) + 8) * k, w, h };
      const overlaps = kept.some(
        (r) => rect.x < r.x + r.w && r.x < rect.x + rect.w && rect.y < r.y + r.h && r.y < rect.y + rect.h,
      );
      if (overlaps) suppressed.add(node.id);
      else kept.push(rect);
    }
    return suppressed;
  }, [nodes, positions, transform.k, focusId]);

  // Every node gets a label unless the occlusion pass (importance-priority)
  // had to suppress it (KG-033); suppressed labels come back on hover,
  // selection, keyboard focus, or emphasis, and are always in the tooltip.
  const showLabel = (node: GraphNode) => {
    if (selected?.kind === "node" && selected.id === node.id) return true;
    if (node.id === hoverId || node.id === keyboardFocusId || node.id === connectFromId) return true;
    if (emphasizedNodeIds?.has(node.id) && !suppressedLabelIds.has(node.id)) return true;
    return !suppressedLabelIds.has(node.id);
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
        {pinnedIds.size > 0 && (
          <button
            type="button"
            title="Release all pinned nodes"
            onClick={(e) => { e.stopPropagation(); clearPins(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="rounded-md px-2 py-1.5 text-[10px] uppercase tracking-widest text-warning transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            Unpin {pinnedIds.size}
          </button>
        )}
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
            const shape = nodeShape(node);
            const isSelected = selected?.kind === "node" && selected.id === node.id;
            const isConnectFrom = node.id === connectFromId;
            const isKeyFocus = node.id === keyboardFocusId;
            const isPinned = pinnedIds.has(node.id);
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
                  if (dragMoved.current) return;
                  if (e.altKey && isPinned) {
                    unpinNode(node.id);
                    return;
                  }
                  onSelectNode(node.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onFocusNeighborhood?.(node.id);
                }}
                className="cursor-pointer"
              >
                {/* Invisible 24px-minimum hit target regardless of node size. */}
                <circle r={Math.max(r + 4, 13)} fill="transparent" />
                <path
                  d={shapePath(shape, r)}
                  fillRule="evenodd"
                  fill={visual.color}
                  fillOpacity={dimmed ? 0.12 : node.type === "sector" ? 0.34 : 0.3}
                  stroke={visual.color}
                  strokeOpacity={dimmed ? 0.4 : 1}
                  strokeWidth={isSelected || isConnectFrom ? 3 : 1.6}
                  strokeDasharray={shapeStrokeDash(shape)}
                />
                {isSelected && (
                  <path d={shapePath(shape, r + 5)} fill="none" stroke="var(--accent)" strokeWidth={1.4} opacity={0.9} />
                )}
                {isKeyFocus && (
                  <path d={shapePath(shape, r + 8)} fill="none" stroke="var(--foreground)" strokeWidth={1.2} strokeDasharray="3 3" />
                )}
                {isPinned && (
                  <circle cx={r * 0.85} cy={-r * 0.85} r={3} fill="var(--warning)" stroke="var(--surface)" strokeWidth={1}>
                    <title>Pinned (Alt-click to release)</title>
                  </circle>
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
                      // Halo plate so labels stay legible over edge strokes (KG-031).
                      paintOrder: "stroke",
                      stroke: "var(--surface)",
                      strokeWidth: 3,
                      strokeLinejoin: "round",
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
          {(hoverNode.metrics.price != null || hoverNode.metrics.date != null) && (
            <p className="mt-0.5 text-[11px] text-muted">
              {hoverNode.metrics.price != null
                ? `${hoverNode.metrics.price} ${hoverNode.metrics.currency ?? ""}${
                    hoverNode.metrics.changePercent != null ? ` (${Number(hoverNode.metrics.changePercent) >= 0 ? "+" : ""}${hoverNode.metrics.changePercent}%)` : ""
                  }`
                : null}
              {hoverNode.metrics.date != null ? `${hoverNode.metrics.price != null ? " · " : ""}${hoverNode.metrics.date}` : null}
              {hoverNode.metrics.impact != null ? ` · ${hoverNode.metrics.impact}` : null}
            </p>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 right-3 text-[11px] text-muted">
        Scroll to zoom · drag to pan · click to inspect · double-click to focus · drag a node to pin it
      </div>
    </div>
  );
}

export const GraphCanvas = memo(forwardRef(GraphCanvasInner));
GraphCanvas.displayName = "GraphCanvas";
