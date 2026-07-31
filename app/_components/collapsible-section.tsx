"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Progressive disclosure primitive — a titled section that collapses secondary
 * detail behind a click so a dense page can lead with the answer and reveal
 * evidence on demand. Reusable platform-wide.
 *
 * Opening and closing both animate via the 0fr→1fr grid transition
 * (`.collapse-grid`, app/globals.css), which reaches content height without
 * measuring it — so a body that loads asynchronously can't strand a stale
 * max-height. The body is mounted lazily on first open and then kept mounted:
 * a collapsed section still costs nothing (no fetch until the user asks for
 * it), but re-collapsing has something to animate away and doesn't re-fetch.
 */
export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen);
  /** Drives the class, one frame behind `open` on a first open so the browser
   *  has a 0fr starting frame to transition from. */
  const [expanded, setExpanded] = useState(defaultOpen);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- deferring the class by a frame is the mechanism */
    if (!open) {
      setExpanded(false);
      return;
    }
    setMounted(true);
    const handle = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(handle);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>
      {mounted && (
        <div className={`collapse-grid ${expanded ? "is-open" : ""}`} aria-hidden={!open}>
          <div className="min-h-0 overflow-hidden">
            <div className="border-t border-border p-4">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}
