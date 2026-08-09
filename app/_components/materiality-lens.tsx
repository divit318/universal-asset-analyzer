"use client";

/**
 * The materiality lens — shared control, keyboard wiring, and fade wrapper
 * for /research and /portfolio.
 *
 * Discoverability model: the BUTTON comes first and the keystroke is just the
 * accelerator. The control always shows the flag count ("3 flagged" /
 * "Nothing flagged"), computed on page load whether or not the lens is on, so
 * it advertises that there is something worth looking at before any
 * interaction. `d` toggles the same state; Esc clears it. State is per-page
 * component state — not global, not persisted.
 *
 * All judgments come from lib/materiality.ts verdicts; nothing in here
 * decides what is material. Toggling the lens is pure presentation: no
 * refetch, no recompute — pages memoise their flag set alongside the data it
 * derives from.
 */

import { useCallback, useEffect, useState } from "react";
import type { MaterialityVerdict } from "@/lib/materiality";

/* -------------------------------------------------------------------------- */
/* Keyboard + state                                                            */
/* -------------------------------------------------------------------------- */

/**
 * True when a keypress belongs to something else: typing surfaces, or any open
 * dialog (dialog.tsx and the AI dock register their own document-level key
 * handlers — Esc must close the modal, not silently clear a lens underneath it).
 *
 * "Open" must mean VISIBLE: the AI assistant keeps its role="dialog" aside
 * permanently mounted and merely hides it with opacity-0/pointer-events-none,
 * so a bare querySelector("[role='dialog']") would disable the lens keys on
 * every page, always.
 */
function keyBelongsElsewhere(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target as HTMLElement | null;
  if (t?.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return true;
  for (const el of document.querySelectorAll<HTMLElement>("[role='dialog']")) {
    const style = getComputedStyle(el);
    if (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      parseFloat(style.opacity || "1") > 0.05 &&
      el.getClientRects().length > 0
    ) {
      return true;
    }
  }
  return false;
}

export function useMaterialityLens(): {
  active: boolean;
  toggle: () => void;
  deactivate: () => void;
} {
  const [active, setActive] = useState(false);
  const toggle = useCallback(() => setActive((a) => !a), []);
  const deactivate = useCallback(() => setActive(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "d" || e.key === "D") {
        if (e.repeat || keyBelongsElsewhere(e)) return;
        setActive((a) => !a);
      } else if (e.key === "Escape" && active) {
        if (keyBelongsElsewhere(e)) return;
        setActive(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return { active, toggle, deactivate };
}

/* -------------------------------------------------------------------------- */
/* The header control                                                          */
/* -------------------------------------------------------------------------- */

export function LensControl({
  count,
  active,
  onToggle,
  className = "",
}: {
  /** How many items on this page are material right now. */
  count: number;
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const nothing = count === 0;
  return (
    <button
      type="button"
      // Zero material items DISABLES the control rather than offering to fade
      // the whole page to uniform grey.
      disabled={nothing}
      onClick={onToggle}
      aria-pressed={active}
      title={
        nothing
          ? "Materiality lens (d) — nothing on this page is outside its normal range"
          : `Materiality lens (d) — fade everything within normal range, keep the ${count} flagged item${count === 1 ? "" : "s"} at full contrast. Esc clears.`
      }
      className={`inline-flex shrink-0 items-center gap-2 rounded-control border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-brand bg-brand/10 text-brand"
          : nothing
            ? "cursor-default border-border bg-surface text-faint"
            : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
      } ${className}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${nothing ? "bg-border" : active ? "bg-brand" : "bg-warning"}`}
      />
      {/* Keyboard accelerator lives in the title tooltip only — a bare "d"
          chip appended to the count read as a rendering artifact. */}
      {nothing ? "Nothing flagged" : active ? `Lens on · ${count} flagged` : `${count} flagged`}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* The fade wrapper                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Wraps one flaggable region. Three render states while the lens is on:
 *   - material          → full contrast + the reason on hover, and on tap
 *                         (title alone is hover-only, so a click toggles an
 *                         inline reason line for touch).
 *   - within range      → faded to the muted opacity. Still interactive.
 *   - not applicable    → NEVER faded: missing data must not be presented as
 *                         examined-and-fine. The reason explains the gap on
 *                         hover.
 * Lens off → renders children untouched.
 */
export function MaterialFade({
  active,
  verdict,
  children,
  className = "",
}: {
  active: boolean;
  /** Null/undefined = nothing known about this region; treated as within range. */
  verdict: MaterialityVerdict | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const [showReason, setShowReason] = useState(false);

  if (!active) return <div className={className}>{children}</div>;

  const material = verdict?.material ?? false;
  const applicable = verdict?.applicable ?? true;
  const fade = !material && applicable;

  return (
    <div
      className={`transition-opacity duration-200 ${fade ? "opacity-30" : ""} ${className}`}
      title={verdict?.reason}
      onClick={material ? () => setShowReason((s) => !s) : undefined}
    >
      {material && showReason && verdict?.reason && (
        <p className="mb-1 rounded-control border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">
          {verdict.reason}
        </p>
      )}
      {children}
    </div>
  );
}
