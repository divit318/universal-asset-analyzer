"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import { prefersReducedMotion } from "./engine";
import { onNextFrame } from "./engine";

/**
 * <Reveal> — the page's ONE entrance primitive (Phase 3.1 timeline: eyebrow
 * 0ms, headline 90ms, lead 180ms, content 280ms + 70ms stagger).
 *
 * Mechanics:
 *   - Server render and no-JS: children are in their final, visible state.
 *     Nothing is ever trapped at opacity 0 without JavaScript.
 *   - After hydration, content below the fold is hidden (opacity 0,
 *     translateY(distance)) and animates to rest over 700ms on
 *     cubic-bezier(0.16, 1, 0.3, 1) when 15% visible. Content already in the
 *     viewport plays the same entrance immediately (page-load choreography).
 *   - ONLY opacity and transform animate. will-change is applied while
 *     animating and removed on transitionend.
 *   - Plays exactly ONCE per page load; the observer disconnects after firing.
 *   - Reduced motion (the shared engine flag): final state, no transition.
 *
 * CSS scroll-driven animations (animation-timeline: view()) were evaluated and
 * deliberately NOT used: a view() timeline scrubs with scroll and replays on
 * re-entry, which violates both the 700ms play-once timeline (3.1) and the
 * once-per-page-load rule (verification 15). The IntersectionObserver path is
 * the only one that satisfies the spec.
 */
export function Reveal({
  children,
  delay = 0,
  stagger = 0,
  distance = 20,
  as = "div",
  className = "",
  childClassName = "",
}: {
  children: ReactNode;
  /** ms before this block's entrance starts. */
  delay?: number;
  /** ms between direct children; 0 animates the block as one unit. */
  stagger?: number;
  /** px of translateY in the hidden state. */
  distance?: number;
  as?: ElementType;
  className?: string;
  /** Extra classes for each staggered child wrapper (e.g. h-full). */
  childClassName?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const setRef = useCallback((el: HTMLElement | null) => {
    ref.current = el;
  }, []);
  // "visible": SSR/no-JS final state. "hidden": armed. "shown": animating in.
  const [phase, setPhase] = useState<"visible" | "hidden" | "shown">("visible");

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    setPhase("hidden");

    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) {
      // Above the fold at load: play the entrance now (next engine frame so
      // the hidden state paints first).
      onNextFrame(() => onNextFrame(() => setPhase("shown")));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("shown");
          io.disconnect(); // once per page load
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const hidden = phase === "hidden";
  const shown = phase === "shown";

  const unitStyle = (i: number) =>
    phase === "visible"
      ? undefined
      : {
          opacity: hidden ? 0 : 1,
          transform: hidden ? `translateY(${distance}px)` : "translateY(0px)",
          // `rotate` included so signature tilts (Problem cards) ride the same
          // 700ms entrance; it is a no-op for everything else.
          transitionProperty: "opacity, transform, rotate",
          transitionDuration: "700ms",
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          transitionDelay: `${delay + i * stagger}ms`,
          willChange: shown ? "opacity, transform" : undefined,
        };

  /** On completion, clear every inline animation style so class-driven hover
   *  transitions (120/200ms) regain control and will-change is released. */
  const clearWillChange = (e: React.TransitionEvent) => {
    if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
    const el = e.target as HTMLElement;
    el.style.willChange = "";
    el.style.transitionProperty = "";
    el.style.transitionDuration = "";
    el.style.transitionTimingFunction = "";
    el.style.transitionDelay = "";
    el.style.opacity = "";
    el.style.transform = "";
  };

  const Tag = as;

  if (stagger > 0) {
    // Clone direct children rather than wrapping them, so semantics survive
    // (li stays a direct child of ul, table rows stay rows, and so on).
    const items = Children.toArray(children);
    return (
      <Tag ref={setRef} className={className} data-reveal={phase}>
        {items.map((child, i) => {
          if (
            !isValidElement<{
              style?: CSSProperties;
              className?: string;
              onTransitionEnd?: (e: React.TransitionEvent) => void;
            }>(child)
          ) {
            return child;
          }
          return cloneElement(child, {
            key: child.key ?? i,
            style: { ...child.props.style, ...unitStyle(i) },
            className: `${child.props.className ?? ""} ${childClassName}`.trim(),
            onTransitionEnd: clearWillChange,
          });
        })}
      </Tag>
    );
  }

  return (
    <Tag ref={setRef} className={className} data-reveal={phase} style={unitStyle(0)} onTransitionEnd={clearWillChange}>
      {children}
    </Tag>
  );
}
