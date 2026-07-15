"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll-reveal wrapper — the landing site's only motion primitive, built on a
 * native IntersectionObserver and the repo's existing `animate-fade-rise`
 * keyframe. No animation library (reconciliation: no Framer Motion / GSAP).
 *
 * Progressive enhancement is the whole design:
 *   - Initial render (and no-JS) → `shown === false` → NO animation class → the
 *     content is in its natural, fully-visible state. Nothing is ever trapped at
 *     opacity:0 waiting on JS. This is what makes the page work without scripts.
 *   - After hydration, the observer flips `shown` when the block enters the
 *     viewport, adding the class so it fades/rises in exactly once (then the
 *     observer disconnects — one-shot, never a loop).
 *
 * Because below-the-fold blocks are off-screen when the class is added, there is
 * no visible "flash" — the first animation frame (opacity:0) lands the instant
 * the block scrolls into view, reading as a clean fade-in.
 *
 * prefers-reduced-motion is honored twice over: this component skips the
 * observer and shows immediately, and globals.css neutralizes the keyframe
 * anyway. Either path yields instantly-visible content.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
  duration = 600,
}: {
  children: ReactNode;
  className?: string;
  /** Stagger offset in ms. */
  delay?: number;
  /** Entrance duration in ms; overrides the keyframe's default. */
  duration?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- must start `shown=false` to match SSR
         markup, then flip once mounted; computing this in the initializer instead would read `window`
         during hydration and desync from the server-rendered className. */
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${shown ? "animate-fade-rise" : ""} ${className}`}
      style={shown ? { animationDuration: `${duration}ms`, animationDelay: delay ? `${delay}ms` : undefined } : undefined}
    >
      {children}
    </div>
  );
}
