"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

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
