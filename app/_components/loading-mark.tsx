import type { CSSProperties } from "react";
import {
  MARK_BARS,
  MARK_BAR_HEIGHT,
  MARK_BAR_RADIUS,
  MARK_TERMINUS,
  MARK_VIEWBOX,
} from "@/lib/brand/mark";

type LoadingMarkState = "loading" | "done";

interface LoadingMarkProps {
  /** "loading" (default) loops the arrive-hold-fade wave; "done" plays the
   * square-to-diamond flip once and holds the resolved mark. */
  state?: LoadingMarkState;
  size?: number;
  className?: string;
  label?: string;
}

/**
 * UAA's signature loading indicator — the brand mark (four bars converging
 * to a diamond) doing the loading instead of a generic spinner. Drop in
 * anywhere a page load, AI research run, or other long-running task needs
 * an indicator; drive `state` from whatever boolean already tracks that
 * work (see app/globals.css for the .uaa-loading-mark animation rules).
 *
 * Geometry comes from lib/brand/mark.ts — the same numbers `<BrandMark>` draws.
 * That is deliberate and load-bearing: `state="done"` resolves to a shape that
 * is pixel-identical to the logo in the header, which is the whole reason the
 * boot splash's ending reads as "the product", not "a spinner finished". Do not
 * inline coordinates here again.
 */
export function LoadingMark({ state = "loading", size = 20, className, label }: LoadingMarkProps) {
  return (
    <svg
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      fill="none"
      width={size}
      height={size}
      className={`uaa-loading-mark shrink-0 ${state === "loading" ? "is-loading" : "is-done"} ${className ?? ""}`}
      role="status"
      aria-label={label ?? (state === "loading" ? "Loading" : "Loaded")}
    >
      {MARK_BARS.map((bar, i) => (
        <rect
          key={i}
          className={`mark-bar mark-bar${i + 1}`}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={MARK_BAR_HEIGHT}
          rx={MARK_BAR_RADIUS}
          fill="currentColor"
          style={{ "--mark-rest": bar.opacity } as CSSProperties}
        />
      ))}
      <rect
        className="mark-terminus"
        x={MARK_TERMINUS.x}
        y={MARK_TERMINUS.y}
        width={MARK_TERMINUS.size}
        height={MARK_TERMINUS.size}
        rx={MARK_TERMINUS.radius}
        fill="var(--brand)"
      />
    </svg>
  );
}
