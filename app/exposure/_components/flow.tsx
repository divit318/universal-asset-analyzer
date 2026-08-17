"use client";

/**
 * The flow diagram — the page's one signature visual.
 *
 * A Sankey, not a node-link graph, and that choice is the whole argument of the
 * redesign. The structure here genuinely is a graph: multiple routes converge
 * on one issuer. But the thing flowing along those routes is MONEY, and the
 * question is always "how much" — so the right encoding is band thickness, and
 * the right layout is left-to-right by construction. A force simulation of the
 * same data answers none of that, changes every time it runs, and asks the user
 * to do the analysis by eye.
 *
 * It runs in both directions from one implementation:
 *   converge  — many routes into one issuer  ("how am I exposed?")
 *   diverge   — one line out into what it contains ("what does this expose me to?")
 *
 * Reversing the flow in place is what makes blast radius feel like the same
 * question asked backwards, because it is.
 *
 * No physics, no simulation loop, no animation frame budget: geometry is a pure
 * function of the bands, computed once per render.
 */

import { useId, useState } from "react";
import { TONE_COLOR, type Tone } from "./primitives";

export interface FlowBand {
  id: string;
  /** Drawn inside the band when it is tall enough to hold text. */
  label: string;
  /** The arithmetic, shown on hover. Never a restatement of the label. */
  detail: string;
  value: number;
  tone: Tone;
  onClick?: () => void;
}

export interface FlowProps {
  direction: "converge" | "diverge";
  /** The fixed end of the flow — the portfolio, or the line being opened. */
  anchorLabel: string;
  /** The other end — the issuer being traced, or nothing when diverging. */
  headLabel?: string;
  bands: FlowBand[];
  height?: number;
  /** Band id currently highlighted from elsewhere (the route table). */
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
}

const ANCHOR_W = 10;
const NODE_W = 10;
const GAP = 3;
const PAD_Y = 6;

/** Sankey link: two cubic curves and a close. */
function ribbon(x0: number, y0: number, x1: number, y1: number, thickness: number): string {
  const xm = (x0 + x1) / 2;
  const y0b = y0 + thickness;
  const y1b = y1 + thickness;
  return [
    `M${x0},${y0}`,
    `C${xm},${y0} ${xm},${y1} ${x1},${y1}`,
    `L${x1},${y1b}`,
    `C${xm},${y1b} ${xm},${y0b} ${x0},${y0b}`,
    "Z",
  ].join(" ");
}

interface BandGeometry {
  band: FlowBand;
  /** Top of the band on the fanned side, where the routes stack with gaps. */
  ly: number;
  /** Top of the band on the converged side, where they stack contiguously. */
  ry: number;
  /** Thickness in user units — proportional to the band's share of the total. */
  t: number;
}

interface FlowLayout {
  rows: BandGeometry[];
  inner: number;
  gaps: number;
  /** Height of the converged stack, which is less than `inner` by the gaps. */
  stackHeight: number;
}

/**
 * Band geometry, computed once and shared by the diagram and its label column.
 *
 * Extracted from the two components deliberately: both need the identical
 * scale/gap arithmetic to line a label up with its ribbon, and two copies of it
 * is one edit away from labels that no longer point at anything.
 */
function layoutBands(bands: FlowBand[], height: number): FlowLayout {
  const inner = height - PAD_Y * 2;
  const gaps = GAP * Math.max(0, bands.length - 1);
  const total = bands.reduce((s, b) => s + b.value, 0);
  const scale = total > 0 ? (inner - gaps) / total : 0;

  const rows: BandGeometry[] = [];
  let ly = PAD_Y;
  let ry = PAD_Y + gaps / 2;
  for (const band of bands) {
    // A floor of 2 units keeps a rounding-error route visible rather than
    // silently absent; the label column still states its real contribution.
    const t = Math.max(2, band.value * scale);
    rows.push({ band, ly, ry, t });
    ly += t + GAP;
    ry += t;
  }

  return { rows, inner, gaps, stackHeight: rows.reduce((s, r) => s + r.t, 0) };
}

export function Flow({
  direction,
  anchorLabel,
  headLabel,
  bands,
  height = 240,
  hoveredId = null,
  onHover,
}: FlowProps) {
  const uid = useId().replace(/[:]/g, "");
  const [localHover, setLocalHover] = useState<string | null>(null);
  const hover = hoveredId ?? localHover;

  const total = bands.reduce((s, b) => s + b.value, 0);
  if (bands.length === 0 || total <= 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-card border border-dashed border-border text-caption text-muted">
        No routes to draw.
      </div>
    );
  }

  const { rows: geom, inner, gaps, stackHeight } = layoutBands(bands, height);
  const converge = direction === "converge";

  // Geometry is mirrored, not duplicated: the same ribbon runs right-to-left
  // when the flow diverges, which is what lets one component draw both a trace
  // and a fan-out from one implementation.
  const xAnchor = converge ? 0 : 100;

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full select-none"
      style={{ height }}
      role="img"
      aria-label={`${converge ? "Routes into" : "Contents of"} ${converge ? headLabel : anchorLabel}`}
    >
      <defs>
        {/* Undisclosed remainder. Drawn, never omitted: a fund picture that
            silently shows only the disclosed tenth is the most misleading
            thing this page could render. */}
        <pattern id={`hatch-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--surface-3)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--faint)" strokeWidth="1.4" opacity="0.5" />
        </pattern>
      </defs>

      {/* The fixed rail. */}
      <rect
        x={xAnchor === 0 ? 0 : 100 - ANCHOR_W / 10}
        y={PAD_Y}
        width={ANCHOR_W / 10}
        height={inner}
        fill="var(--border-strong)"
        vectorEffect="non-scaling-stroke"
      />

      {geom.map((g) => {
        const active = hover === g.band.id;
        const dim = hover != null && !active;
        const isHatch = g.band.tone === "undisclosed";
        const from = converge ? ANCHOR_W / 10 : 100 - ANCHOR_W / 10;
        const to = converge ? 100 - NODE_W / 10 : NODE_W / 10;
        return (
          <path
            key={g.band.id}
            d={ribbon(from, g.ly, to, g.ry, g.t)}
            fill={isHatch ? `url(#hatch-${uid})` : TONE_COLOR[g.band.tone]}
            opacity={dim ? 0.22 : active ? 0.95 : 0.62}
            className="transition-opacity duration-[var(--duration-feedback)]"
            style={{ cursor: g.band.onClick ? "pointer" : "default" }}
            onMouseEnter={() => {
              setLocalHover(g.band.id);
              onHover?.(g.band.id);
            }}
            onMouseLeave={() => {
              setLocalHover(null);
              onHover?.(null);
            }}
            onClick={g.band.onClick}
          >
            <title>{g.band.detail}</title>
          </path>
        );
      })}

      {/* The converged head. */}
      {headLabel ? (
        <rect
          x={converge ? 100 - NODE_W / 10 : 0}
          y={converge ? PAD_Y + gaps / 2 : PAD_Y}
          width={NODE_W / 10}
          height={converge ? stackHeight : inner}
          fill="var(--foreground)"
          opacity={0.75}
        />
      ) : null}
    </svg>
  );
}

/**
 * Labels for a flow, rendered as HTML beside the SVG rather than inside it.
 *
 * Deliberate: text inside a `preserveAspectRatio="none"` viewBox distorts, and
 * more importantly a thin band cannot hold a label at all. The old graph spent
 * a whole occlusion pass hiding labels that would not fit; here the picture
 * carries proportion and a real table carries the words, and neither has to
 * compromise for the other.
 */
export function FlowLegend({
  bands,
  hoveredId,
  onHover,
  height,
}: {
  bands: FlowBand[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  height: number;
}) {
  const total = bands.reduce((s, b) => s + b.value, 0);
  if (total <= 0) return null;

  return (
    <div className="relative shrink-0" style={{ height, width: 148 }}>
      {layoutBands(bands, height).rows.map(({ band: b, ly: top, t }) => {
        const active = hoveredId === b.id;
        return (
          <button
            key={b.id}
            onMouseEnter={() => onHover(b.id)}
            onMouseLeave={() => onHover(null)}
            onClick={b.onClick}
            disabled={!b.onClick}
            className={[
              "absolute right-0 flex w-full items-center justify-end gap-2 pr-2 text-right transition-opacity duration-[var(--duration-feedback)]",
              b.onClick ? "cursor-pointer" : "cursor-default",
              hoveredId != null && !active ? "opacity-40" : "opacity-100",
            ].join(" ")}
            style={{ top, height: Math.max(t, 14), lineHeight: 1 }}
          >
            <span className="truncate font-mono text-[11px] font-medium text-foreground">{b.label}</span>
            <span
              aria-hidden
              className="h-2.5 w-[3px] shrink-0 rounded-full"
              style={{ background: TONE_COLOR[b.tone] }}
            />
          </button>
        );
      })}
    </div>
  );
}
