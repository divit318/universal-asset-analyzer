"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./engine";

/**
 * useMockupEntry — the one entrance gate for the capability mock UI frames.
 * Each frame animates ONCE, on first viewport entry (IntersectionObserver,
 * threshold 0.35), then holds its final state forever. Never loops.
 *
 * Contract (same as <Reveal>):
 *   - SSR / no-JS: phase is "visible" — everything renders in final state.
 *   - After hydration (motion allowed): phase drops to "armed" (elements
 *     jump to their hidden states via [data-mock=armed] CSS), then flips to
 *     "play" on first entry, driving the staggered one-shot choreography.
 *   - Reduced motion: stays "visible" forever. No observer, no animation.
 *
 * Consumers put `data-mock={phase}` on the frame root and style children
 * with `[[data-mock=armed]_&]:...` hidden states.
 */
export type MockupPhase = "visible" | "armed" | "play";

export function useMockupEntry<T extends HTMLElement = HTMLDivElement>(): {
  ref: React.RefObject<T | null>;
  phase: MockupPhase;
  played: boolean;
} {
  const ref = useRef<T | null>(null);
  const [phase, setPhase] = useState<MockupPhase>("visible");

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    // Must match SSR markup (final state) first, then arm the entrance.
    setPhase("armed");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("play");
          io.disconnect(); // once, ever
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, phase, played: phase !== "armed" };
}
