"use client";

import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import { useInViewOnce } from "./use-in-view-once";
import { REVEAL_DURATION_MS, REVEAL_STAGGER_MAX_MS, REVEAL_STAGGER_MS } from "./motion";

interface RevealProps extends HTMLAttributes<HTMLElement> {
  /** Position in the sequence — each step adds another beat of stagger delay
   *  once the group scrolls into view (capped so long lists don't crawl in). */
  index: number;
  /** Element to render, for contexts where a div is invalid (list rows inside
   *  a `<ul>`, cells inside a `<tr>`) or where a wrapper would cost a layout
   *  layer — passing `as` plus the element's own classes lets Reveal *be* the
   *  grid/flex child rather than nesting inside it. Defaults to `div`. */
  as?: "div" | "li" | "tr" | "td" | "section" | "article" | "aside" | "nav" | "header" | "p" | "span";
  className?: string;
  children: ReactNode;
}

/**
 * Shared stagger primitive for progressive reveal. Unlike a plain CSS
 * `animation-delay` fired on mount, this only plays once its own element
 * first scrolls into the viewport (`useInViewOnce`) — so a page reveals
 * itself as the user explores it rather than finishing its whole entrance
 * animation, invisibly, before they ever scroll down. Fires exactly once
 * per element, then holds its resolved state permanently; it never replays
 * on subsequent scrolls.
 *
 * Before that first intersection the element sits at opacity 0 — the point
 * of the exercise — but never gets stuck there without JS: `useInViewOnce`
 * resolves `inView` immediately when IntersectionObserver isn't available,
 * and the app-wide `prefers-reduced-motion` rule zeroes every animation
 * duration, so both fall back to "visible almost instantly" rather than
 * "invisible forever".
 *
 * Remaining div props are forwarded, so this can *be* the section wrapper
 * (border, background, `data-arrival-target`) rather than adding a layer.
 */
export function Reveal({ index, as: Tag = "div", className = "", children, style, ...rest }: RevealProps) {
  const [ref, inView] = useInViewOnce<HTMLElement>(0.15);
  const delay = Math.min(index * REVEAL_STAGGER_MS, REVEAL_STAGGER_MAX_MS);

  return (
    <Tag
      ref={ref as Ref<never>}
      // Makes the primitive observable: `[data-reveal]` selects exactly the
      // elements whose visibility this component owns, and `data-revealed`
      // says whether each has had its intersection yet. Without it there is no
      // way to distinguish "stranded at opacity 0 because the observer never
      // fired" — the one real failure mode here — from the many things in the
      // app that are deliberately transparent (a closed drawer, a collapsed
      // label). Cheap in the DOM, and the difference between a testable
      // invariant and a visual spot-check.
      data-reveal={index}
      data-revealed={inView ? "true" : "false"}
      className={`${inView ? "animate-fade-rise" : "opacity-0"} ${className}`}
      style={
        {
          ...(inView ? { animationDuration: `${REVEAL_DURATION_MS}ms`, animationDelay: `${delay}ms` } : {}),
          ...style,
        } as CSSProperties
      }
      {...rest}
    >
      {children}
    </Tag>
  );
}
