"use client";

/**
 * ExplainableValue — the no-black-box primitive.
 *
 * Wraps any rendered score with a click target that opens an anchored
 * decomposition panel: the factors, their weights/multipliers as bars, the
 * confidence, the method sentence, and the engine's own caveats. One component
 * so every number on the dashboard explains itself the same way.
 *
 * The panel is portaled to `document.body` and positioned from the trigger's
 * measured rect via `computePopoverPosition` (popover-position.ts), not laid
 * out inline. Two failure modes made that necessary: several triggers live
 * inside `overflow-hidden` cards (the hero, the attention spotlight), which
 * silently clipped an inline `position: absolute` panel; and a fixed
 * `w-[300px]` panel with no collision handling ran off-screen on narrow cards
 * and on mobile viewports. A portaled, measured panel is immune to both — it
 * has no ancestor to be clipped by, and it repositions itself to always fit.
 *
 * Accessibility: a real <button> trigger (aria-expanded + aria-haspopup),
 * Escape and outside-click to close (checked against both the trigger and the
 * portaled panel, since they're no longer DOM siblings), focus returned to the
 * trigger on close. The dotted underline is the affordance — it reads as
 * "this is a term you can look up", which is exactly what it is.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import type { ScoreExplanation, ExplanationFactor } from "@/lib/home/explain";
import { computePopoverPosition, popoverMaxWidth, type PopoverPosition } from "./popover-position";

function FactorRow({ f }: { f: ExplanationFactor }) {
  const barTone =
    f.direction > 0 ? "bg-positive/70" : f.direction < 0 ? "bg-negative/70" : "bg-foreground/30";
  return (
    <li className={`flex flex-col gap-1 ${f.muted ? "opacity-50" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium text-foreground/90">{f.label}</span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{f.display}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, f.bar)) * 100)}%` }} />
      </div>
      {f.detail ? <p className="text-[10px] leading-snug text-muted">{f.detail}</p> : null}
    </li>
  );
}

/** Off-screen coordinates used to measure the panel's natural size before its
 *  real position is computed, so it never flashes at the wrong spot. */
const MEASURE_POS: PopoverPosition = { top: -9999, left: -9999, placement: "bottom" };
const DEFAULT_PANEL_WIDTH = 300;

function ExplainPanel({
  explanation,
  panelRef,
  triggerRef,
  panelId,
  align,
}: {
  explanation: ScoreExplanation;
  panelRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelId: string;
  align: "start" | "end";
}) {
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);

  // Measure + position synchronously before paint, and keep it correct across
  // resize/scroll while the panel is open (capture:true also catches scrolling
  // inside nested containers, not just the window).
  useLayoutEffect(() => {
    const reposition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const width = popoverMaxWidth(viewport, DEFAULT_PANEL_WIDTH);
      setPanelWidth(width);
      const triggerRect = trigger.getBoundingClientRect();
      setPos(computePopoverPosition(triggerRect, { width: panel.offsetWidth, height: panel.offsetHeight }, viewport, align));
    };

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [triggerRef, panelRef, align]);

  const measured = pos ?? MEASURE_POS;

  return createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={`${explanation.title} breakdown`}
      style={{
        position: "fixed",
        top: measured.top,
        left: measured.left,
        width: panelWidth,
        maxHeight: "min(70vh, 480px)",
        visibility: pos ? "visible" : "hidden",
      }}
      className="uaa-reveal z-50 flex flex-col overflow-y-auto rounded-card border border-border bg-surface p-3.5 shadow-lg"
    >
      <div className="mb-2.5 flex items-start justify-between gap-3 border-b border-hairline pb-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{explanation.title}</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{explanation.value}</span>
        </div>
        {explanation.confidence ? (
          <span
            className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted"
            title={explanation.confidence.detail}
          >
            {explanation.confidence.label}
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2.5">
        {explanation.factors.map((f) => (
          <FactorRow key={f.label} f={f} />
        ))}
      </ul>

      <p className="mt-2.5 border-t border-hairline pt-2 text-[10px] leading-snug text-muted">
        <Info className="mr-1 inline h-3 w-3 align-[-2px]" strokeWidth={2} />
        {explanation.method}
      </p>
      {explanation.caveats.map((c) => (
        <p key={c} className="mt-1.5 text-[10px] leading-snug text-faint">
          {c}
        </p>
      ))}
    </div>,
    document.body,
  );
}

export function ExplainableValue({
  explanation,
  children,
  align = "start",
  className = "",
}: {
  explanation: ScoreExplanation | null;
  children: ReactNode;
  /** Preferred horizontal anchoring relative to the trigger — overridden by
   *  viewport collision clamping whenever honoring it would clip the panel. */
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    // The panel is portaled to document.body, so it's no longer a DOM
    // descendant of the trigger — outside-click detection has to check both,
    // via the shared panelRef the portal attaches itself to.
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  // A value with no explanation renders as-is — never a dead affordance.
  if (!explanation) return <span className={className}>{children}</span>;

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={`Explain: ${explanation.title}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex cursor-help items-center gap-0.5 rounded-[4px] underline decoration-dotted decoration-foreground/35 underline-offset-4 outline-none transition-colors hover:decoration-brand focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {children}
      </button>

      {open ? (
        <ExplainPanel
          explanation={explanation}
          panelRef={panelRef}
          triggerRef={triggerRef}
          panelId={panelId}
          align={align}
        />
      ) : null}
    </span>
  );
}
