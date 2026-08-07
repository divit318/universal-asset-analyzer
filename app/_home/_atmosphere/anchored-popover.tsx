"use client";

/**
 * AnchoredPopover — a small portaled action panel anchored to a caller-owned
 * trigger (the queue's snooze menu and journal-capture form, audits AG-04 and
 * AG-09).
 *
 * Portaled for the same reason ExplainableValue's panel is (explain-popover.tsx):
 * several triggers live inside `overflow-hidden` cards (the attention
 * spotlight), which silently clip an inline absolutely-positioned panel. It
 * reuses the same measured `computePopoverPosition` math, so both popover
 * families collide and flip identically.
 *
 * Unlike ExplainableValue it does NOT own its trigger: the queue opens these
 * from icon buttons AND from list-level keyboard shortcuts ('s' on a focused
 * row), so open state has to live with the caller. On open, focus moves to the
 * first focusable child (the keyboard path lands directly in the menu); Escape
 * and outside-click close via `onClose`, and the caller restores focus.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { computePopoverPosition, popoverMaxWidth, type PopoverPosition } from "./popover-position";

/** Off-screen coordinates used to measure the panel's natural size before its
 *  real position is computed, so it never flashes at the wrong spot. */
const MEASURE_POS: PopoverPosition = { top: -9999, left: -9999, placement: "bottom" };

interface AnchoredPopoverProps {
  /** The trigger element the panel positions against. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /** Fired on Escape or outside pointer-down. The caller owns focus return. */
  onClose: () => void;
  ariaLabel: string;
  /** Preferred panel width; capped to the viewport on narrow screens. */
  width?: number;
  align?: "start" | "end";
  children: ReactNode;
}

/** The panel proper — mounted only while open (like ExplainPanel), so every
 *  effect below runs against a live panel and never needs a closed branch. */
function AnchoredPanel({
  anchorRef,
  onClose,
  ariaLabel,
  width = 240,
  align = "end",
  children,
}: Omit<AnchoredPopoverProps, "open">) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  const [panelWidth, setPanelWidth] = useState(width);

  // Measure + position before paint, and track resize/scroll while open
  // (capture:true also catches scrolling inside nested containers).
  useLayoutEffect(() => {
    const reposition = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setPanelWidth(popoverMaxWidth(viewport, width));
      setPos(
        computePopoverPosition(
          anchor.getBoundingClientRect(),
          { width: panel.offsetWidth, height: panel.offsetHeight },
          viewport,
          align,
        ),
      );
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchorRef, align, width]);

  // Keyboard-opened menus must land focus IN the menu, or 's' would open a
  // panel the keyboard can't reach (audit AG-12's "driveable without a mouse").
  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>("button, input, textarea, select, [tabindex]")
      ?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // The panel is portaled to document.body, so outside-click detection has
    // to check both the anchor and the panel — they aren't DOM relatives.
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose, anchorRef]);

  const measured = pos ?? MEASURE_POS;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        top: measured.top,
        left: measured.left,
        width: panelWidth,
        maxHeight: "min(70vh, 480px)",
        visibility: pos ? "visible" : "hidden",
      }}
      className="uaa-reveal z-50 flex flex-col overflow-y-auto rounded-card border border-border bg-surface p-2 shadow-lg"
    >
      {children}
    </div>,
    document.body,
  );
}

export function AnchoredPopover({ open, ...props }: AnchoredPopoverProps) {
  if (!open) return null;
  return <AnchoredPanel {...props} />;
}
