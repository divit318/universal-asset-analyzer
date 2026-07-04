"use client";

import { useEffect, useRef, useState } from "react";
import { forceSimulation, forceManyBody, forceCollide, forceX, forceY, type Simulation, type SimulationNodeDatum } from "d3-force";
import type { OpportunityMapNode } from "@/lib/opportunity-map";
import { CATEGORY_COLOR, RISK_BORDER_COLOR } from "./category-colors";

interface SimNode extends SimulationNodeDatum {
  id: string;
  node: OpportunityMapNode;
}

const CONVICTION_GLOW: Record<OpportunityMapNode["conviction"], number> = { High: 0.35, Medium: 0.18, Low: 0 };

function radiusFor(score: number): number {
  return 9 + (Math.max(0, Math.min(100, score)) / 100) * 26;
}

/** Custom d3-force: pulls same-theme nodes toward their shared centroid each tick — the "clustering" effect. */
function clusterForce(nodes: SimNode[], strength: number) {
  return () => {
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const node of nodes) {
      const key = node.node.theme;
      const s = sums.get(key) ?? { x: 0, y: 0, n: 0 };
      s.x += node.x ?? 0;
      s.y += node.y ?? 0;
      s.n += 1;
      sums.set(key, s);
    }
    for (const node of nodes) {
      const s = sums.get(node.node.theme)!;
      const cx = s.x / s.n;
      const cy = s.y / s.n;
      node.vx = (node.vx ?? 0) + (cx - (node.x ?? 0)) * strength;
      node.vy = (node.vy ?? 0) + (cy - (node.y ?? 0)) * strength;
    }
  };
}

export function BubbleView({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: OpportunityMapNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const [size, setSize] = useState({ width: 900, height: 560 });
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const dragId = useRef<string | null>(null);

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
    const sim = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(-18))
      .force("collide", forceCollide<SimNode>().radius((d) => radiusFor(d.node.opportunityScore) + 3))
      .force("cluster", clusterForce(simNodes, 0.06))
      .force("x", forceX(0).strength(0.02))
      .force("y", forceY(0).strength(0.02))
      .on("tick", () => {
        setPositions(new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
      });
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [nodes]);

  function screenToLocal(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    const sx = clientX - rect.left - size.width / 2 - transform.x;
    const sy = clientY - rect.top - size.height / 2 - transform.y;
    return { x: sx / transform.k, y: sy / transform.k };
  }

  function onNodePointerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragId.current = id;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragId.current) {
      const { x, y } = screenToLocal(e.clientX, e.clientY);
      const simNode = simRef.current?.nodes().find((n) => n.id === dragId.current);
      if (simNode) {
        simNode.fx = x;
        simNode.fy = y;
        simRef.current?.alphaTarget(0.1).restart();
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
    if (dragId.current) {
      const simNode = simRef.current?.nodes().find((n) => n.id === dragId.current);
      if (simNode) {
        simNode.fx = null;
        simNode.fy = null;
      }
      simRef.current?.alphaTarget(0);
    }
    dragId.current = null;
    panStart.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setTransform((t) => ({ ...t, k: Math.max(0.3, Math.min(3, t.k + delta * t.k)) }));
  }

  return (
    <div
      ref={containerRef}
      className="relative h-[560px] w-full touch-none overflow-hidden rounded-xl border border-border bg-surface"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerDown={(e) => {
        panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
      }}
      onWheel={onWheel}
    >
      <svg width={size.width} height={size.height} className="cursor-grab active:cursor-grabbing">
        <g transform={`translate(${size.width / 2 + transform.x}, ${size.height / 2 + transform.y}) scale(${transform.k})`}>
          {nodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const r = radiusFor(node.opportunityScore);
            const glow = CONVICTION_GLOW[node.conviction];
            const color = CATEGORY_COLOR[node.category];
            const border = RISK_BORDER_COLOR[node.expectedVolatility];
            const isSelected = node.id === selectedId;
            const highMomentum = node.changePercent != null && Math.abs(node.changePercent) >= 3;
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onPointerDown={(e) => onNodePointerDown(e, node.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(node.id);
                }}
                className={`cursor-pointer ${highMomentum ? "animate-pulse" : ""}`}
              >
                {glow > 0 && <circle r={r + 6} fill={color} fillOpacity={glow} />}
                <circle r={r} fill={color} fillOpacity={0.3} stroke={border} strokeWidth={isSelected ? 3 : 1.75} />
                {(node.inPortfolio || node.inWatchlist) && (
                  <circle r={r + 3} fill="none" stroke={node.inPortfolio ? "var(--accent)" : "var(--muted)"} strokeWidth={1.25} strokeDasharray={node.inPortfolio ? undefined : "3 2"} />
                )}
                {r >= 13 && (
                  <text
                    y={r + 13}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                    style={{ fontSize: 10, fill: "var(--foreground)", fontFamily: "var(--font-mono)" }}
                  >
                    {node.symbol}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="pointer-events-none absolute bottom-3 right-3 text-[10px] text-muted/70">
        Scroll to zoom · drag background to pan · drag a bubble to reposition
      </div>
    </div>
  );
}
