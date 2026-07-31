"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { PLOT_DRAW_MS, prefersReducedMotion } from "./motion";

/**
 * True the first time the ref'd element enters the viewport, then stays
 * true forever (disconnects the observer) — the "trigger once per page
 * load" primitive behind the scroll-triggered winner-highlight reveal.
 */
export function useInViewOnce<T extends HTMLElement>(threshold = 0.3): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true); // eslint-disable-line react-hooks/set-state-in-effect -- no IO support, reveal immediately rather than never
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, threshold]);

  return [ref, inView];
}

/**
 * Ref plus a one-shot "draw the plot now" flag for charts: true from the first
 * time the plot scrolls into view until the sweep finishes, then false forever.
 *
 * The latching-off half is the point. A chart animating in as you reach it reads
 * as the data being plotted; the same animation replaying every time you switch
 * period or toggle an overlay reads as lag. So this drives the series' animation
 * for exactly one draw and then stops, leaving later re-renders instant. Off
 * entirely under reduced motion.
 */
export function usePlotDrawOnce<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const [ref, inView] = useInViewOnce<T>(0.2);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!inView || done) return;
    const t = setTimeout(() => setDone(true), PLOT_DRAW_MS);
    return () => clearTimeout(t);
  }, [inView, done]);

  return [ref, inView && !done && !prefersReducedMotion()];
}
