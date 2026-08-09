/**
 * Quant Engine desk — shared visual primitives.
 *
 * The desk's grammar, in one file so every section speaks it identically: a
 * signed z-score reads as a bar around a centre line, a probability reads as a
 * fill, a distribution reads as a band. These are the shapes that make the desk
 * legible at a glance without reading a single number, and they are what keep it
 * from collapsing back into Research Hub's card-and-table layout.
 *
 * All bar fills use the shipped `.animate-bar-fill` keyframe (`--bar-value`), so
 * every quantity on the page *grows to* its measurement on arrival rather than
 * appearing pre-stamped — the same convention The Wire established.
 */

"use client";

import type { CSSProperties, ReactNode } from "react";
import { CountUp } from "@/app/_components/count-up";
import { useTheme } from "@/app/_components/theme";
import { regimeColor } from "@/lib/engine-desk";

/* -------------------------------------------------------------------------- */
/* Numbers                                                                     */
/* -------------------------------------------------------------------------- */

export const fmtZ = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

export const fmtPct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;

/** For values already expressed in percentage points (e.g. `net_tilt_pct`). */
export const fmtPp = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

export const toneOf = (v: number | null | undefined) =>
  v == null ? "text-muted" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted";

/** Signed number that counts to its value on arrival. */
export function SignedValue({
  value,
  digits = 2,
  className = "",
  percent = false,
}: {
  value: number | null;
  digits?: number;
  className?: string;
  percent?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) return <span className="text-muted">—</span>;
  return (
    <CountUp
      value={value}
      durationMs={600}
      format={(v) => (percent ? fmtPct(v, digits) : fmtZ(v, digits))}
      className={`font-mono tabular-nums ${toneOf(value)} ${className}`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Z-score bar                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A signed z-score as a bar growing out from a centre line — the desk's single
 * most repeated shape. Direction is encoded by which side of centre the bar
 * occupies, magnitude by its length, so a column of these scans as a shape
 * before any digit is read.
 */
export function ZBar({
  value,
  max = 3,
  width = "w-20",
  showValue = true,
}: {
  value: number | null | undefined;
  max?: number;
  width?: string;
  showValue?: boolean;
}) {
  const v = value == null || !Number.isFinite(value) ? 0 : Math.max(-max, Math.min(max, value));
  const halfPct = (Math.abs(v) / max) * 50;
  const tone = v >= 0.5 ? "bg-positive" : v <= -0.5 ? "bg-negative" : "bg-warning";

  return (
    <div className="flex items-center gap-2">
      <div className={`relative h-1.5 ${width} shrink-0 overflow-hidden rounded-full bg-surface-2`}>
        <span aria-hidden className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border-strong" />
        <div
          className={`absolute top-0 h-full animate-bar-fill rounded-full ${tone}`}
          style={{
            ...(v >= 0 ? { left: "50%" } : { right: "50%" }),
            ["--bar-value" as string]: `${halfPct}%`,
          } as CSSProperties}
        />
      </div>
      {showValue && (
        <span className="font-mono text-xs tabular-nums text-muted">{fmtZ(value)}</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Probability meter                                                           */
/* -------------------------------------------------------------------------- */

/** A 0-1 probability as a left-anchored fill. Used for regime posteriors,
 *  P(up), model confidence — anything that is genuinely a probability. */
export function ProbMeter({
  prob,
  color,
  label,
  trailing,
  height = "h-2",
}: {
  prob: number | null;
  color?: string;
  label?: ReactNode;
  trailing?: ReactNode;
  height?: string;
}) {
  const p = prob == null || !Number.isFinite(prob) ? 0 : Math.max(0, Math.min(1, prob));
  return (
    <div className="flex items-center gap-2.5">
      {label != null && <span className="w-[4.5rem] shrink-0 text-xs text-muted">{label}</span>}
      <div className={`relative ${height} flex-1 overflow-hidden rounded-full bg-surface-2`}>
        <div
          className="absolute inset-y-0 left-0 animate-bar-fill rounded-full"
          style={{
            backgroundColor: color ?? "var(--brand)",
            ["--bar-value" as string]: `${p * 100}%`,
          } as CSSProperties}
        />
      </div>
      {trailing ?? (
        <span className="w-11 shrink-0 text-right font-mono text-xs tabular-nums text-muted">
          {(p * 100).toFixed(0)}%
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Probability band                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A P10–P90 forecast band on a shared, symmetric return axis, with the median
 * marked. This is the primitive that makes the engine feel probabilistic rather
 * than point-estimate: the *width* of the band is the model's uncertainty, and
 * how much of it sits left of zero is the downside.
 *
 * `scale` is the axis half-width in return space (e.g. 0.25 = ±25%), passed in by
 * the caller so every row in a list shares one axis and the bands are comparable.
 */
export function ProbBand({
  p10,
  p50,
  p90,
  scale = 0.25,
}: {
  p10: number | null;
  p50: number | null;
  p90: number | null;
  scale?: number;
}) {
  if (p10 == null || p90 == null) {
    return <span className="text-caption text-faint">no forecast</span>;
  }
  const pos = (v: number) => ((Math.max(-scale, Math.min(scale, v)) + scale) / (2 * scale)) * 100;
  const left = pos(p10);
  const right = pos(p90);
  const mid = p50 == null ? null : pos(p50);
  const tone = (p50 ?? 0) >= 0 ? "bg-positive/35" : "bg-negative/35";

  return (
    <div className="relative h-4 w-full overflow-hidden rounded bg-surface-2" title={`P10 ${fmtPct(p10)} · P50 ${fmtPct(p50)} · P90 ${fmtPct(p90)}`}>
      {/* Zero line — the reference that makes the band mean something. */}
      <span aria-hidden className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border-strong" />
      <div
        className={`absolute inset-y-1 animate-bar-fill rounded-sm ${tone}`}
        style={{ left: `${left}%`, ["--bar-value" as string]: `${Math.max(1, right - left)}%` } as CSSProperties}
      />
      {mid != null && (
        <span
          aria-hidden
          className={`absolute inset-y-0.5 w-0.5 rounded-full ${(p50 ?? 0) >= 0 ? "bg-positive" : "bg-negative"}`}
          style={{ left: `${mid}%` }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sparkline                                                                   */
/* -------------------------------------------------------------------------- */

/** Inline SVG trend. Deliberately not Recharts: these render dozens per screen
 *  and each Recharts instance would bring its own ResponsiveContainer measure
 *  pass (the documented 0×0 first-paint hazard) for an 80px graphic. */
export function Sparkline({
  data,
  color = "var(--brand)",
  width = 80,
  height = 24,
  animate = true,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  animate?: boolean;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animate ? "animate-line-draw" : ""}
        // `.animate-line-draw` defaults --line-length to 240, which for an 80px
        // sparkline leaves the stroke hidden for most of the animation. Scaled to
        // this graphic's actual path length so the draw reads as continuous.
        style={{ ["--line-length" as string]: `${Math.round(width * 1.6)}` } as CSSProperties}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Regime chip                                                                 */
/* -------------------------------------------------------------------------- */

/** The regime label, tinted by state. Colour is the fastest possible read of
 *  "what market are we in", which is the desk's first question. */
export function RegimeChip({ label, size = "md" }: { label: string | null; size?: "sm" | "md" | "lg" }) {
  const theme = useTheme().theme;
  if (!label) return <span className="text-muted">Unknown</span>;
  const color = regimeColor(label, theme) ?? "var(--muted)";
  const cls =
    size === "lg" ? "px-3 py-1 text-base font-semibold"
    : size === "sm" ? "px-1.5 py-0.5 text-label font-semibold uppercase tracking-wide"
    : "px-2 py-0.5 text-xs font-semibold";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${cls}`}
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}18` }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Micro-header                                                                */
/* -------------------------------------------------------------------------- */

/** In-panel label with a hairline rule — separates regions *inside* a section
 *  without spending another Card. */
export function Rule({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-label font-semibold uppercase tracking-widest text-muted/70">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {trailing}
    </div>
  );
}

/** A short, plain-language note explaining what the reader is looking at. The
 *  desk's whole premise is that a systematic call is only trustworthy if its
 *  derivation is visible, so every section carries one. */
export function Derivation({ children }: { children: ReactNode }) {
  return <p className="text-caption leading-relaxed text-faint">{children}</p>;
}
