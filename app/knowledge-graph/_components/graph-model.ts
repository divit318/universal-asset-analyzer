/**
 * Knowledge Graph — visual language. Client-safe constants shared by the
 * canvas, legend, inspector, and table view.
 *
 * Node TYPE is encoded twice: by color AND by shape, so the graph remains
 * readable for protan/deutan viewers and in grayscale. Within the asset
 * family, INSTRUMENT kind is encoded by glyph (circle = single issuer,
 * ring = fund, dotted circle = digital asset, dashed circle = other), so a
 * Bond ETF and a Common Equity are never visually identical (KG-025) and no
 * two semantic types differ by hue alone. Edge RELATION is encoded by
 * color + dash pattern; STRENGTH by width; DIRECTION by arrowhead. Node SIZE
 * encodes importance (position weight in portfolio scope) — stated in the
 * legend, not just here.
 */

import type { NodeType, EdgeType, GraphNode, InstrumentType } from "@/lib/knowledge-graph";

export type NodeShape =
  | "circle"
  | "ring"
  | "circleDot"
  | "circleDash"
  | "square"
  | "diamond"
  | "triangle"
  | "star"
  | "hexagon";

export const NODE_VISUAL: Record<NodeType, { color: string; shape: NodeShape; label: string }> = {
  company: { color: "var(--accent)", shape: "circle", label: "Asset" },
  sector: { color: "var(--chart-1)", shape: "hexagon", label: "Sector" },
  portfolio: { color: "var(--chart-5)", shape: "diamond", label: "Portfolio" },
  watchlist: { color: "var(--chart-5)", shape: "diamond", label: "Watchlist" },
  timeline_event: { color: "var(--chart-2)", shape: "square", label: "Event" },
  market_event: { color: "var(--chart-4)", shape: "triangle", label: "Market Event" },
  // A triangle in a different hue failed color-blind viewers (KG-026).
  opportunity: { color: "var(--positive)", shape: "star", label: "Opportunity" },
  thesis: { color: "var(--chart-3)", shape: "square", label: "Thesis" },
  catalyst: { color: "var(--chart-2)", shape: "triangle", label: "Catalyst" },
  risk: { color: "var(--negative)", shape: "triangle", label: "Risk" },
};

/** Instrument kind -> glyph within the asset family. */
export function instrumentShape(instrument: InstrumentType | null): NodeShape {
  if (instrument == null) return "circle";
  if (instrument === "common_equity" || instrument === "preferred") return "circle";
  if (instrument.startsWith("etf_") || instrument === "mutual_fund") return "ring";
  if (instrument === "crypto") return "circleDot";
  // fx_pair, future, index, cash, unknown: visibly "other".
  return "circleDash";
}

/** The shape drawn for a node: assets by instrument, everything else by type. */
export function nodeShape(node: Pick<GraphNode, "type" | "instrument">): NodeShape {
  return node.type === "company" ? instrumentShape(node.instrument) : NODE_VISUAL[node.type].shape;
}

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

function circlePath(r: number): string {
  return `M ${-r},0 a ${r},${r} 0 1,0 ${2 * r},0 a ${r},${r} 0 1,0 ${-2 * r},0`;
}

/** SVG path for a node glyph of "radius" r, centered on the origin. */
export function shapePath(shape: NodeShape, r: number): string {
  switch (shape) {
    case "circle":
    case "circleDash":
      return circlePath(r);
    case "ring":
      // Annulus: outer circle + inner counter-circle (evenodd fill).
      return `${circlePath(r)} ${circlePath(Math.max(2, r * 0.5))}`;
    case "circleDot":
      return `${circlePath(r)} ${circlePath(Math.max(1.5, r * 0.22))}`;
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
    case "star": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r * 1.25 : r * 0.55;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${(rad * Math.cos(a)).toFixed(2)},${(rad * Math.sin(a)).toFixed(2)}`);
      }
      return `M ${pts.join(" L ")} Z`;
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

/** Stroke dash for the node OUTLINE (distinct from edge dashes). */
export function shapeStrokeDash(shape: NodeShape): string | undefined {
  return shape === "circleDash" ? "3 2.5" : undefined;
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
