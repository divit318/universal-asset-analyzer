/**
 * Pure floating-panel positioning math for ExplainableValue.
 *
 * Kept free of the DOM (plain Rect/Viewport numbers in, a placement out) so the
 * collision/flip logic is unit-testable without mounting anything — the app's
 * convention is that component rendering is browser-verified, but the math
 * underneath it is not.
 *
 * The panel always fits inside the viewport (clamped by VIEWPORT_MARGIN on every
 * edge): horizontally by sliding along the trigger's preferred edge, vertically
 * by flipping above the trigger when there isn't room below. This is what makes
 * a popover safe to render anywhere on the page regardless of which card it's
 * triggered from — the caller no longer needs the trigger's ancestors to have
 * unclipped overflow or extra room.
 */

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type PopoverAlign = "start" | "end";

export interface PopoverPosition {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

/** Gap between the trigger and the panel. */
export const POPOVER_GAP = 8;
/** Minimum clearance kept between the panel and every viewport edge. */
export const POPOVER_VIEWPORT_MARGIN = 8;

/**
 * Where the panel should render given the trigger's rect, its own measured
 * size, and the viewport. `align` is a preference (start = left edges match,
 * end = right edges match) — it is overridden by horizontal clamping whenever
 * honoring it would push the panel off-screen. Vertically, "below the trigger"
 * is preferred; the panel flips above only when there's more room there than
 * below and it still doesn't fit below.
 */
export function computePopoverPosition(
  trigger: Rect,
  panel: Size,
  viewport: Viewport,
  align: PopoverAlign = "start",
): PopoverPosition {
  const margin = POPOVER_VIEWPORT_MARGIN;
  const gap = POPOVER_GAP;

  // Horizontal: anchor to the preferred edge, then clamp fully on-screen. A
  // panel wider than the viewport (minus margins) still gets a defined
  // position — clamped to the margin — rather than a negative overflow.
  const maxLeft = Math.max(margin, viewport.width - panel.width - margin);
  const preferredLeft = align === "end" ? trigger.right - panel.width : trigger.left;
  const left = Math.min(Math.max(preferredLeft, margin), maxLeft);

  // Vertical: prefer opening below. Flip above only when below doesn't fit
  // AND above has more room — flipping into an equally-cramped space would
  // trade one clipped edge for another.
  const spaceBelow = viewport.height - trigger.bottom - gap - margin;
  const spaceAbove = trigger.top - gap - margin;

  let top: number;
  let placement: "top" | "bottom";
  if (panel.height <= spaceBelow || spaceBelow >= spaceAbove) {
    top = trigger.bottom + gap;
    placement = "bottom";
  } else {
    top = trigger.top - gap - panel.height;
    placement = "top";
  }
  // Clamp vertically too: an unusually tall panel on a short viewport still
  // gets pinned inside the margin rather than pushed off either edge.
  const maxTop = Math.max(margin, viewport.height - panel.height - margin);
  top = Math.min(Math.max(top, margin), maxTop);

  return { top, left, placement };
}

/**
 * The panel's own width, capped to the viewport so a fixed 300px panel never
 * causes horizontal overflow on a narrow (e.g. mobile) screen.
 */
export function popoverMaxWidth(viewport: Viewport, preferred = 300): number {
  return Math.max(0, Math.min(preferred, viewport.width - POPOVER_VIEWPORT_MARGIN * 2));
}
