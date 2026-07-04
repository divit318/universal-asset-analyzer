"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
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
      .force("collide", forceCollide<SimNode>().radius((d) => nodeRadius(d.node) + 10))
      .on("tick", () => {
        setPositions(new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
      });

    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [nodes, edges]);

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
      className="relative h-[560px] w-full touch-none overflow-hidden rounded-xl border border-border bg-surface"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerDown={onBackgroundPointerDown}
      onWheel={onWheel}
    >
      <svg width={size.width} height={size.height} className="cursor-grab active:cursor-grabbing">
        <g transform={`translate(${size.width / 2 + transform.x}, ${size.height / 2 + transform.y}) scale(${transform.k})`}>
          {edges.map((edge) => {
            const s = positions.get(edge.source);
            const t = positions.get(edge.target);
            if (!s || !t) return null;
            const dimmed = highlightedEdgeIds != null && !highlightedEdgeIds.has(edge.id);
            const active = highlightedEdgeIds?.has(edge.id);
            return (
              <line
                key={edge.id}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={active ? "var(--accent)" : "var(--border)"}
                strokeWidth={active ? 2.5 : Math.max(0.75, edge.strength / 45)}
                opacity={dimmed ? 0.12 : active ? 0.9 : 0.45}
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
