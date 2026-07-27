import type { CSSProperties } from "react";

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
 */
export function LoadingMark({ state = "loading", size = 20, className, label }: LoadingMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      width={size}
      height={size}
      className={`uaa-loading-mark ${state === "loading" ? "is-loading" : "is-done"} ${className ?? ""}`}
      role="status"
      aria-label={label ?? (state === "loading" ? "Loading" : "Loaded")}
    >
      <rect className="mark-bar mark-bar1" x="4" y="5.4" width="24" height="2.4" rx="0.8" fill="currentColor" style={{ "--mark-rest": 0.5 } as CSSProperties} />
      <rect className="mark-bar mark-bar2" x="6.5" y="9.8" width="19" height="2.4" rx="0.8" fill="currentColor" style={{ "--mark-rest": 0.65 } as CSSProperties} />
      <rect className="mark-bar mark-bar3" x="9" y="13.8" width="14" height="2.4" rx="0.8" fill="currentColor" style={{ "--mark-rest": 0.8 } as CSSProperties} />
      <rect className="mark-bar mark-bar4" x="11.5" y="17.4" width="9" height="2.4" rx="0.8" fill="currentColor" style={{ "--mark-rest": 1 } as CSSProperties} />
      <rect className="mark-terminus" x="12.5" y="20.1" width="7" height="7" rx="1.2" fill="var(--brand)" />
    </svg>
  );
}
