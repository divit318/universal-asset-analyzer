"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const OPEN_MS = 280;

/**
 * Smooth expand/collapse for the metric-table sections — replaces the old
 * "arrow rotates, content instantly appears" with a measured max-height
 * animation plus a fade-up on the content itself. `.collapsible-panel`
 * (globals.css) owns the transition + the prefers-reduced-motion override,
 * so this component only ever sets the target max-height.
 */
export function Collapsible({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<string>(open ? "none" : "0px");
  const [mounted, setMounted] = useState(open);

  // Adjust state during render rather than in an effect when `open` flips to
  // true (the React-recommended way to react to a prop change synchronously,
  // without an extra commit) — content must be mounted before the height
  // effect below can measure it.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMounted(true);
  }

  // Measuring scrollHeight genuinely requires a layout effect (must read the
  // DOM after mount/update, before paint, to animate from a real pixel value
  // rather than a guess) — the two setState calls below are that measurement
  // being committed, not derived state; see app/_components/toast.tsx for
  // the same accepted pattern in this codebase.
  useLayoutEffect(() => {
    if (!mounted) return;
    const el = innerRef.current;
    if (!el) return;

    if (open) {
      const full = el.scrollHeight;
      setMaxHeight(`${full}px`);
      const t = setTimeout(() => setMaxHeight("none"), OPEN_MS);
      return () => clearTimeout(t);
    }
    const full = el.scrollHeight;
    setMaxHeight(`${full}px`);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setMaxHeight("0px")));
    const t = setTimeout(() => setMounted(false), OPEN_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [open, mounted]);

  return (
    <div className={`collapsible-panel ${className}`} style={{ maxHeight, overflow: "hidden" }}>
      <div ref={innerRef} className={open ? "animate-fade-rise" : ""}>
        {mounted && children}
      </div>
    </div>
  );
}
