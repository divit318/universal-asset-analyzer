"use client";

import { useEffect, useRef, useState } from "react";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Counts up from 0 to `value` once, on mount — used anywhere a number should
 * arrive in motion rather than appear all at once (comparison metric cells,
 * portfolio stat tiles, and similar progressive-reveal moments). Deliberately
 * mount-triggered, not value-triggered: callers that need a re-count on data
 * change should remount via `key`, since most of these values don't change
 * after their initial load.
 */
export function CountUp({
  value,
  format,
  durationMs = 500,
  className,
}: {
  value: number;
  format: (v: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? value : 0,
  );
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    let raf: number;
    const tick = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const progress = Math.min(1, (t - startRef.current) / durationMs);
      setDisplay(value * easeOutCubic(progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Mount-only — see doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span className={className}>{format(display)}</span>;
}
