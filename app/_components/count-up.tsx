"use client";

import { useEffect, useRef, useState } from "react";
import { useInViewOnce } from "./use-in-view-once";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Subsequent value changes are a *correction*, not an arrival, so they travel
 *  from the current number at UI speed instead of re-counting from zero. */
const UPDATE_MS = 260;

/**
 * Counts up from 0 to `value` once, the first time it scrolls into view —
 * used anywhere a number should arrive in motion rather than appear all at
 * once (comparison metric cells, portfolio stat tiles, research headline
 * numbers, and similar progressive-reveal moments). A number that finishes
 * counting off-screen, before the user ever reaches it, reads as never
 * having animated at all — gating on visibility is what makes the motion
 * legible.
 *
 * If `value` later changes (a re-polled quote, a refreshed screen) the number
 * travels from wherever it currently sits to the new one over UPDATE_MS —
 * never a second count-up from zero. Pair with `useValueFlash` when the update
 * itself is worth marking. To deliberately replay the full arrival (e.g. a
 * different asset entirely), remount via `key`.
 *
 * Pass `active` to hand control to a parent that's already gating on
 * visibility itself (e.g. `ScoreRing`, which syncs its arc draw and its
 * centre number to one shared observer instead of each running its own).
 */
export function CountUp({
  value,
  format,
  durationMs = 700,
  className,
  active,
}: {
  value: number;
  format: (v: number) => string;
  durationMs?: number;
  className?: string;
  /** When provided, overrides the component's own scroll-into-view gating. */
  active?: boolean;
}) {
  const [selfRef, selfInView] = useInViewOnce<HTMLSpanElement>(0.4);
  const inView = active ?? selfInView;

  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [display, setDisplay] = useState(() => (reduced ? value : 0));
  /** Where the next animation starts from — 0 until first in view, then
   *  wherever the previous one got to (which may be mid-flight). */
  const fromRef = useRef(reduced ? value : 0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value); // eslint-disable-line react-hooks/set-state-in-effect
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const duration = startedRef.current ? UPDATE_MS : durationMs;
    startedRef.current = true;
    if (from === value) {
      setDisplay(value);
      return;
    }

    let raf = 0;
    let startedAt: number | null = null;
    let latest = from;
    const tick = (t: number) => {
      if (startedAt == null) startedAt = t;
      const progress = Math.min(1, (t - startedAt) / duration);
      latest = from + (value - from) * easeOutCubic(progress);
      setDisplay(latest);
      if (progress < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Interrupted by a newer value — resume from where this one got to, so
      // rapid updates read as one continuous number, not a stutter.
      fromRef.current = latest;
    };
  }, [inView, value, durationMs]);

  return (
    <span ref={active === undefined ? selfRef : undefined} className={className}>
      {format(display)}
    </span>
  );
}
