"use client";

import { useRef, type ReactNode } from "react";
import { useSectionProgress } from "../motion/hooks";

/**
 * SectionShell — the ONE section wrapper on the landing page. It owns:
 *   - the <section> landmark with its anchor id (ids never change),
 *   - scroll-margin so anchor targets clear the nav pill (48px + 24px + offset),
 *   - the uniform vertical rhythm (py-mk-section) and the 1px hairline rule,
 *   - the measure system: ONE `data-measure="content"` container (1200px) with
 *     identical clamp(24px, 5vw, 64px) side padding in every section — the
 *     audit harness asserts every section reports the same left offset,
 *   - the band dissolve: an absolutely positioned tonal layer whose opacity
 *     ramps 0→1 over the first 15% of section travel and 1→0 over the last
 *     15%, driven by useSectionProgress on the shared rAF loop (no re-renders;
 *     the style is written directly). Under reduced motion the progress hook
 *     still settles the value, so the band renders at rest.
 *
 * `breakout` renders full-bleed children BETWEEN the shell and the measure
 * container for the two permitted wide surfaces (capability rows, compare
 * table) and decorative layers; those tag themselves `data-measure="wide"`.
 */
export function SectionShell({
  id,
  headingId,
  band = false,
  className = "",
  containerClassName = "",
  breakout,
  children,
}: {
  id: string;
  headingId?: string;
  /** Alternating tonal band, dissolved in/out with section travel. */
  band?: boolean;
  className?: string;
  containerClassName?: string;
  /** Rendered inside the section but outside the measure container. */
  breakout?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);

  useSectionProgress(ref, (p) => {
    const el = bandRef.current;
    if (!el) return;
    // 0→1 over the first 15% of travel, 1→0 over the last 15%.
    const inRamp = Math.min(1, p / 0.15);
    const outRamp = Math.min(1, (1 - p) / 0.15);
    el.style.opacity = String(Math.max(0, Math.min(inRamp, outRamp)));
  });

  return (
    <section
      id={id}
      ref={ref}
      aria-labelledby={headingId}
      className={`relative scroll-mt-22 border-b border-hairline py-mk-section ${className}`}
    >
      {band && (
        <div
          ref={bandRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-surface/80 via-surface/45 to-surface/80"
        />
      )}
      {breakout}
      <div data-measure="content" className={`relative mx-auto w-full max-w-measure-content px-mk-pad ${containerClassName}`}>
        {children}
      </div>
    </section>
  );
}
