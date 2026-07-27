"use client";

import { useEffect, useRef, useState } from "react";

export interface WireSection {
  id: string;
  label: string;
}

/**
 * Floating scroll-spy nav. No existing pattern to reuse in this codebase
 * (confirmed — only one-shot reveal-on-scroll hooks exist elsewhere), so
 * this is net new: vanilla IntersectionObserver, matching the codebase's
 * existing preference (no framer-motion scroll hooks are used anywhere
 * despite the dependency being available).
 */
export function SectionNav({ sections }: { sections: WireSection[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const ratiosRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratiosRef.current.set(entry.target.id, entry.intersectionRatio);
        }
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of ratiosRef.current) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId) setActiveId(bestId);
      },
      // Biases "active" toward a section once it's crossed into the upper
      // half of the viewport, rather than requiring it be fully in view.
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [sections]);

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav
      aria-label="Page sections"
      className="fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-2 lg:flex"
    >
      {sections.map((s) => {
        const active = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollToSection(s.id)}
            aria-label={s.label}
            aria-current={active}
            className="group flex items-center justify-end gap-2"
          >
            <span
              className={`max-w-0 overflow-hidden whitespace-nowrap rounded-full border border-border bg-surface px-0 py-1 text-[11px] font-medium opacity-0 transition-all duration-200 group-hover:max-w-[160px] group-hover:px-2.5 group-hover:opacity-100 ${
                active ? "text-foreground" : "text-muted"
              }`}
            >
              {s.label}
            </span>
            <span
              className={`h-2 w-2 shrink-0 rounded-full border transition-all duration-200 ${
                active
                  ? "scale-125 border-positive bg-positive"
                  : "border-border bg-surface-3 group-hover:border-positive/50"
              }`}
            />
          </button>
        );
      })}
    </nav>
  );
}
