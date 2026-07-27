"use client";

/**
 * useCountUp — rolls a number from 0 up to its target on first paint, and
 * animates between values when the target later changes. The hero's signature
 * "the figures settle into place" moment.
 *
 * Returns a live number; the caller formats it with the same helper it would
 * have used for the static value, so the final frame is byte-identical to the
 * un-animated render (no unit or rounding drift). Honours reduced-motion by
 * snapping straight to the target.
 */

import { useEffect, useRef, useState } from "react";

function prefersReduced(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useCountUp(target: number, durationMs = 760): number {
  // Start at 0 on both server and client so hydration matches; the effect then
  // rolls to the target.
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReduced() || !Number.isFinite(target)) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = from + (target - from) * eased;
      setValue(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      // Whatever value we reached becomes the origin for the next transition.
      fromRef.current = value;
    };
    // `value` is intentionally excluded: it changes every frame and would
    // restart the animation. fromRef captures the last frame on cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
