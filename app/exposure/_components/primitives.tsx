"use client";

/**
 * The page's visual vocabulary, defined once.
 *
 * Two rules hold the design together, and both are enforced here rather than
 * remembered at each call site:
 *
 *   1. COLOUR ENCODES ROUTE TYPE AND NOTHING ELSE. Direct, through a fund,
 *      derived. The moment a second meaning enters the colour channel the page
 *      needs a legend, and a page that needs a legend has failed to explain
 *      itself. Everything else is carried by weight, size and alignment.
 *
 *   2. EVERY NUMBER IS TYPESET. Tabular figures, decimal-aligned, units in the
 *      header rather than repeated per cell. Density comes from alignment, not
 *      from shrinking the type.
 */

import type { ReactNode } from "react";

/* ────────────────────────────── Route tone ────────────────────────────── */

export type Tone = "direct" | "fund" | "derived" | "undisclosed";

export const TONE_COLOR: Record<Tone, string> = {
  // The route you chose.
  direct: "var(--chart-2)",
  // The route that arrived with something else you bought.
  fund: "var(--chart-1)",
  // A measured relationship, not an ownership claim.
  derived: "var(--chart-4)",
  // Not a route at all — the part of a wrapper nobody disclosed.
  undisclosed: "var(--faint)",
};

export const TONE_LABEL: Record<Tone, string> = {
  direct: "Held directly",
  fund: "Through a fund",
  derived: "Measured relationship",
  undisclosed: "Undisclosed",
};

/* ────────────────────────────── Numbers ────────────────────────────── */

export function Pct({
  value,
  dp = 2,
  sign = false,
  className = "",
}: {
  value: number;
  dp?: number;
  sign?: boolean;
  className?: string;
}) {
  const text = `${sign && value > 0 ? "+" : ""}${value.toFixed(dp)}%`;
  return (
    <span className={`font-mono tabular-nums ${className}`} style={{ fontVariantNumeric: "tabular-nums" }}>
      {text}
    </span>
  );
}

/** A number that carries the page's headline weight. Used sparingly — once per view. */
export function BigPct({ value, dp = 1 }: { value: number; dp?: number }) {
  return (
    <span className="font-mono text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-foreground">
      {value.toFixed(dp)}
      <span className="text-[1rem] text-muted">%</span>
    </span>
  );
}

/* ────────────────────────────── Structure ────────────────────────────── */

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-label font-medium uppercase tracking-[0.14em] text-faint ${className}`}>
      {children}
    </div>
  );
}

export function Rule({ className = "" }: { className?: string }) {
  return <div className={`h-px w-full bg-hairline ${className}`} />;
}

/**
 * The basis tag. Every derived figure on this page wears one, because the
 * difference between "the fund discloses this" and "we computed this" and "this
 * correlated last year" is the difference between three very different claims.
 */
export function BasisTag({ basis }: { basis: "observed" | "derived" | "estimated" }) {
  const style =
    basis === "observed"
      ? "border-border bg-surface-3 text-muted"
      : basis === "derived"
        ? "border-chart-1/30 bg-chart-1/10 text-chart-1"
        : "border-warning/30 bg-warning/10 text-warning";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px text-micro font-medium uppercase tracking-wider ${style}`}
    >
      {basis}
    </span>
  );
}

/** A clickable entity chip — the atom of exploration. */
export function NodeChip({
  label,
  tone = "fund",
  sub,
  onClick,
  active = false,
}: {
  label: string;
  tone?: Tone;
  sub?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={[
        "group inline-flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-left transition-colors duration-[var(--duration-feedback)]",
        active
          ? "border-border-strong bg-surface-3"
          : "border-border bg-surface-2 hover:border-border-strong hover:bg-surface-3",
        onClick ? "cursor-pointer" : "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className="h-3 w-[3px] shrink-0 rounded-full"
        style={{ background: TONE_COLOR[tone] }}
      />
      <span className="font-mono text-xs font-medium text-foreground">{label}</span>
      {sub ? <span className="text-caption text-muted">{sub}</span> : null}
    </Comp>
  );
}

/**
 * A horizontal magnitude bar. Used for drivers and constituent lists, where a
 * ranked bar answers the question better than a network of circles ever could.
 */
export function MagnitudeBar({
  value,
  max,
  tone = "fund",
  height = 6,
}: {
  value: number;
  max: number;
  tone?: Tone;
  height?: number;
}) {
  const pct = max > 0 ? Math.max(0.5, (value / max) * 100) : 0;
  return (
    <div className="w-full rounded-full bg-surface-3" style={{ height }}>
      <div
        className="rounded-full transition-[width] duration-[var(--duration-draw)] ease-[var(--ease-out)]"
        style={{ width: `${pct}%`, height, background: TONE_COLOR[tone] }}
      />
    </div>
  );
}

/** Section heading inside the stage. */
export function StageSection({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <Eyebrow>{title}</Eyebrow>
          {hint ? <span className="text-caption text-faint">{hint}</span> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The verbatim data-limitation line. Never paraphrased, never hidden. */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-border pl-3 text-caption leading-relaxed text-muted">{children}</p>
  );
}
