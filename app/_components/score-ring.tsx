"use client";

import type { CSSProperties, ReactNode } from "react";
import { CountUp } from "./count-up";
import { useInViewOnce } from "./use-in-view-once";
import { DRAW_MS } from "./motion";

interface ScoreRingProps {
  /** 0-100. */
  score: number;
  /** Outer box size in px. */
  size?: number;
  strokeWidth?: number;
  /** Arc colour as a `text-*` class — the arc strokes with currentColor. */
  arcClassName?: string;
  /** Overrides the default `<score> / 100` centre. */
  children?: ReactNode;
  /** Denominator caption under the number. Pass null to hide it. */
  caption?: string | null;
  /** Font size utility for the centre number. */
  valueClassName?: string;
  className?: string;
  label?: string;
}

/**
 * The one score dial. Draws its arc around the circle from 0 to the score
 * once, the first time it scrolls into view (`.animate-ring-draw` in
 * app/globals.css, driven by `--ring-circ` / `--ring-offset`) while the
 * centre number counts up over the same window, off the same observer — the
 * score reads as being *measured* right as the user reaches it, not stamped
 * on page load. Remount via `key` to redraw.
 */
export function ScoreRing({
  score,
  size = 72,
  strokeWidth = 3,
  arcClassName = "text-brand",
  children,
  caption = "/ 100",
  valueClassName = "text-[1.6rem]",
  className = "",
  label,
}: ScoreRingProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.4);
  const clamped = Math.max(0, Math.min(100, score));
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      ref={ref}
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `Score ${Math.round(clamped)} out of 100`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-surface-3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={inView ? offset : circumference}
          className={inView ? `animate-ring-draw ${arcClassName}` : arcClassName}
          style={{ "--ring-circ": circumference, "--ring-offset": offset } as CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children ?? (
          <>
            {/* DRAW_MS matches .animate-ring-draw exactly — the arc and the
                number it labels have to finish together, so both read the one
                token rather than two hand-synced literals. */}
            <CountUp
              value={clamped}
              format={(v) => String(Math.round(v))}
              durationMs={DRAW_MS}
              active={inView}
              className={`${valueClassName} font-semibold leading-none tabular-nums`}
            />
            {caption && (
              <span className="mt-0.5 text-micro font-medium uppercase tracking-wide text-muted">
                {caption}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
