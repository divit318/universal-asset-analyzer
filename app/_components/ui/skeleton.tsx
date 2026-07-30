import type { CSSProperties } from "react";

/**
 * The placeholder primitive: one shape, one animation, one source of truth.
 *
 * Before this, "still loading" was said three different ways in the same app —
 * `LoadingPanel` (the brand mark, for a whole panel), a hand-rolled
 * `animate-pulse` grey rectangle (in ~20 places, including the shared
 * `SectionSkeleton`), and bare "Loading…" text. Which one a given surface got
 * was down to whoever wrote it.
 *
 * The division of labour now:
 *  - `<Skeleton>` — the shape of content you are about to see, for a block whose
 *    layout is known in advance (a row, a stat, a paragraph). Preserves the
 *    layout so nothing jumps when the real thing arrives.
 *  - `<LoadingPanel>` — a *long* wait whose shape isn't known or isn't worth
 *    faking (a universe build, a chart, an agent pipeline). Says what's
 *    happening, in words.
 *
 * If you can describe the shape, use this. If you need to explain the wait, use
 * LoadingPanel. Never write `animate-pulse` again — with one exception, which is
 * the reason the two gestures are different: `animate-pulse` still belongs on
 * things that are genuinely *live* rather than absent. A pulsing dot next to
 * "syncing", the typing caret in the copilot, the active step in a running
 * pipeline, a degraded-health indicator — those are breathing because something
 * is happening right now, and they should not look like a placeholder.
 */

interface SkeletonProps {
  /** Height utility. Match the real content's height so arrival shifts nothing. */
  height?: string;
  /** Width utility — vary it across lines so prose doesn't read as a barcode. */
  width?: string;
  /** `rounded` for text lines, `rounded-lg`/`rounded-card` for blocks. */
  radius?: string;
  className?: string;
  /**
   * Escape hatch for a width Tailwind has no utility for — several call sites
   * ragged their placeholder lines with `style={{ width: '73%' }}`. Pass
   * `width=""` alongside it so the two don't fight.
   */
  style?: CSSProperties;
}

export function Skeleton({
  height = "h-3",
  width = "w-full",
  radius = "rounded",
  className = "",
  style,
}: SkeletonProps) {
  // aria-hidden throughout: a skeleton is a picture of absent content, so it has
  // nothing to announce. The surface that owns the wait is responsible for the
  // live region (see Section's role="status"), and a screen reader reading four
  // decorative bars is worse than silence.
  return (
    <div aria-hidden style={style} className={`uaa-skeleton ${height} ${width} ${radius} ${className}`} />
  );
}

/**
 * A paragraph of skeleton lines with a ragged right edge, for prose-shaped
 * content (AI summaries, notes, explanations). The widths taper because real
 * text does; four full-width bars read as a table, not a paragraph.
 */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  const widths = ["w-full", "w-11/12", "w-4/5", "w-10/12", "w-3/4"];
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height="h-2.5" width={widths[i % widths.length]} />
      ))}
    </div>
  );
}
