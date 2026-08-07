/**
 * Knowledge Graph — visual language. Client-safe constants shared by the
 * canvas, legend, inspector, and table view.
 *
 * Node TYPE is encoded twice: by color AND by shape, so the graph remains
 * readable for protan/deutan viewers and in grayscale. Edge RELATION is
 * encoded by color + dash pattern; STRENGTH by width; DIRECTION by arrowhead.
 */

import type { NodeType, EdgeType, GraphNode } from "@/lib/knowledge-graph";

export type NodeShape = "circle" | "square" | "diamond" | "triangle" | "hexagon";

export const NODE_VISUAL: Record<NodeType, { color: string; shape: NodeShape; label: string }> = {
  company: { color: "var(--accent)", shape: "circle", label: "Asset" },
  sector: { color: "var(--chart-1)", shape: "hexagon", label: "Sector" },
  portfolio: { color: "var(--chart-5)", shape: "diamond", label: "Portfolio" },
  watchlist: { color: "var(--chart-5)", shape: "diamond", label: "Watchlist" },
  timeline_event: { color: "var(--chart-2)", shape: "square", label: "Event" },
  market_event: { color: "var(--chart-4)", shape: "triangle", label: "Market Event" },
  opportunity: { color: "var(--positive)", shape: "triangle", label: "Opportunity" },
  thesis: { color: "var(--chart-3)", shape: "square", label: "Thesis" },
  catalyst: { color: "var(--chart-2)", shape: "triangle", label: "Catalyst" },
  risk: { color: "var(--negative)", shape: "triangle", label: "Risk" },
};

export const EDGE_VISUAL: Record<EdgeType, { color: string; dash: string | undefined; label: string }> = {
  OWNS: { color: "var(--chart-5)", dash: undefined, label: "owns" },
  WATCHES: { color: "var(--chart-5)", dash: "4 3", label: "watches" },
  OPERATES_IN: { color: "var(--chart-1)", dash: undefined, label: "operates in" },
  EXPOSED_TO: { color: "var(--chart-1)", dash: "4 3", label: "exposed to" },
  HOLDS: { color: "var(--chart-5)", dash: "1 3", label: "holds" },
  CONSTITUENT: { color: "var(--chart-1)", dash: "8 3", label: "sector ETF constituent" },
  IMPACTS: { color: "var(--chart-4)", dash: undefined, label: "impacts" },
  GENERATES: { color: "var(--positive)", dash: "2 3", label: "generates" },
  SUPPORTED_BY: { color: "var(--positive)", dash: undefined, label: "supported by" },
  CONTRADICTED_BY: { color: "var(--negative)", dash: undefined, label: "contradicted by" },
  TRIGGERED: { color: "var(--chart-2)", dash: undefined, label: "triggered" },
  ROTATES_TO: { color: "var(--chart-2)", dash: "6 3", label: "rotating to" },
  ROTATES_FROM: { color: "var(--chart-2)", dash: "6 3", label: "rotating from" },
  DRIVES: { color: "var(--chart-3)", dash: "2 3", label: "drives" },
};

/** SVG path for a node glyph of "radius" r, centered on the origin. */
export function shapePath(shape: NodeShape, r: number): string {
  switch (shape) {
    case "circle":
      return `M ${-r},0 a ${r},${r} 0 1,0 ${2 * r},0 a ${r},${r} 0 1,0 ${-2 * r},0`;
    case "square": {
      const s = r * 0.9;
      return `M ${-s},${-s} H ${s} V ${s} H ${-s} Z`;
    }
    case "diamond":
      return `M 0,${-r * 1.15} L ${r * 1.15},0 L 0,${r * 1.15} L ${-r * 1.15},0 Z`;
    case "triangle": {
      const h = r * 1.2;
      return `M 0,${-h} L ${h * 0.95},${h * 0.7} L ${-h * 0.95},${h * 0.7} Z`;
    }
    case "hexagon": {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return `${(r * 1.05 * Math.cos(a)).toFixed(2)},${(r * 1.05 * Math.sin(a)).toFixed(2)}`;
      });
      return `M ${pts.join(" L ")} Z`;
    }
  }
}

export function nodeRadius(node: GraphNode): number {
  return 8 + (Math.max(0, Math.min(100, node.importance)) / 100) * 14;
}

/** Deterministic per-id angle so a graph lays out the same way on every visit. */
export function hashAngle(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
}
