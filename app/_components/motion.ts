/** JS-side mirror of the motion tokens defined in app/globals.css (:root). */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EASE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/** Timing constants matching the shipped .uaa-loading-mark is-done sequence
 * (app/globals.css) — kept here so anything scheduling around that sequence
 * (the boot splash) never re-derives or drifts from the CSS values. */
export const MARK_BAR_STAGGER_MS = 110;
export const MARK_TERMINUS_DELAY_MS = 440;
export const MARK_TERMINUS_DURATION_MS = 1080;
export const MARK_DONE_SEQUENCE_MS = MARK_TERMINUS_DELAY_MS + MARK_TERMINUS_DURATION_MS;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
