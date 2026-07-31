"use client";

import type { CSSProperties } from "react";
import { useInViewOnce } from "./use-in-view-once";

interface ValueBarProps {
  /** 0-100. Null renders an empty track (no bar), never a misleading zero-width fill. */
  value: number | null;
  /** Tailwind class for the fill — the caller owns the data colour. */
  barClassName?: string;
  /** Height utility for both track and fill. */
  height?: string;
  trackClassName?: string;
  className?: string;
  /** Fill animation length. Kept above UI-element timings on purpose: a bar
   *  growing to its value reads as measurement, and 900ms is the shipped
   *  .animate-bar-fill duration every other bar in the app already uses. */
  durationMs?: number;
  title?: string;
  /** When provided, overrides the component's own scroll-into-view gating —
   *  for callers (e.g. a card syncing several bars to one observer) that are
   *  already tracking visibility themselves. */
  active?: boolean;
}

/**
 * The one progress/confidence bar. Grows from 0 to its value once, the first
 * time it scrolls into view, via the shipped `.animate-bar-fill` keyframe
 * (app/globals.css) driven by `--bar-value` — so a score bar is never painted
 * pre-filled, whether that's on page load or a hundred pixels below the fold.
 * Remount via `key` to re-run the fill.
 */
export function ValueBar({
  value,
  barClassName = "bg-brand",
  height = "h-1",
  trackClassName = "bg-surface-2",
  className = "",
  durationMs,
  title,
  active,
}: ValueBarProps) {
  const [ref, selfInView] = useInViewOnce<HTMLDivElement>(0.4);
  const inView = active ?? selfInView;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div
      ref={ref}
      className={`${height} w-full overflow-hidden rounded-full ${trackClassName} ${className}`}
      title={title}
    >
      {value != null && (
        <div
          className={inView ? `animate-bar-fill h-full rounded-full ${barClassName}` : "h-full rounded-full"}
          style={{
            "--bar-value": `${pct}%`,
            width: inView ? `${pct}%` : "0%",
            ...(durationMs ? { animationDuration: `${durationMs}ms` } : {}),
          } as CSSProperties}
        />
      )}
    </div>
  );
}

/**
 * Multi-segment variant for compositions that must sum to 100% (asset
 * allocation, analyst ratings mix). Segments grow together rather than one
 * sweeping across the other, so the proportions are never briefly wrong, and
 * only once the row first scrolls into view.
 */
export function SegmentedBar({
  segments,
  height = "h-2",
  trackClassName = "bg-surface-2",
  className = "",
}: {
  segments: { key: string; pct: number; className?: string; color?: string; title?: string }[];
  height?: string;
  trackClassName?: string;
  className?: string;
}) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.4);
  return (
    <div ref={ref} className={`flex ${height} w-full overflow-hidden rounded-full ${trackClassName} ${className}`}>
      {segments.map((s) =>
        s.pct > 0 ? (
          <div
            key={s.key}
            className={inView ? `animate-bar-fill h-full ${s.className ?? ""}` : `h-full ${s.className ?? ""}`}
            style={{
              "--bar-value": `${s.pct}%`,
              width: inView ? `${s.pct}%` : "0%",
              ...(s.color ? { background: s.color } : {}),
            } as CSSProperties}
            title={s.title}
          />
        ) : null,
      )}
    </div>
  );
}
