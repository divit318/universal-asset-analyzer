"use client";

import { useEffect, useRef, useState } from "react";
import { subscribe, wake, prefersReducedMotion, onReducedMotionChange, type ScrollState } from "./engine";

/**
 * React bindings for the motion engine. All continuous values are delivered
 * through callbacks that write styles directly (no per-frame React renders).
 */

/** The one reduced-motion flag, as React state (for render-time branches). */
export function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- must start
       false to match SSR markup, then sync to the real media query. */
    setR(prefersReducedMotion());
    return onReducedMotionChange(setR);
  }, []);
  return r;
}

/**
 * useScrollVelocity — subscribe to the shared engine. `onFrame` runs once per
 * engine frame; return `true` from it to keep the loop alive while idle.
 */
export function useScrollVelocity(onFrame: (state: ScrollState, dt: number) => boolean | void): void {
  const cbRef = useRef(onFrame);
  useEffect(() => {
    cbRef.current = onFrame;
  });
  useEffect(() => subscribe((s, dt) => cbRef.current(s, dt)), []);
}

/**
 * useSectionProgress — 0→1 for how far `ref`'s element has travelled through
 * the viewport (0 = top edge at viewport bottom, 1 = bottom edge at viewport
 * top). IntersectionObserver gates activity; the shared rAF loop supplies the
 * continuous value. `onProgress` writes styles directly — never setState.
 */
export function useSectionProgress(
  ref: React.RefObject<HTMLElement | null>,
  onProgress: (progress: number) => void,
): void {
  const cbRef = useRef(onProgress);
  useEffect(() => {
    cbRef.current = onProgress;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let active = false;
    let unsub: (() => void) | null = null;

    const compute = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = vh + r.height;
      const travelled = vh - r.top;
      cbRef.current(Math.min(1, Math.max(0, travelled / total)));
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !active) {
          active = true;
          compute();
          unsub = subscribe((s) => {
            if (!s.isIdle) compute();
          });
          wake();
        } else if (!entry.isIntersecting && active) {
          active = false;
          compute(); // settle at 0 or 1
          unsub?.();
          unsub = null;
        }
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      unsub?.();
    };
  }, [ref]);
}
