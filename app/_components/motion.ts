/** JS-side mirror of the motion tokens defined in app/globals.css (:root). */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
/**
 * The firm curve, for a component changing state under the user's hand. Replaced
 * `EASE_SPRING` (`cubic-bezier(0.34, 1.56, 0.64, 1)`), whose 1.56 control point
 * overshot the destination and sprang back: bounce reads as playful, and this
 * instrument doesn't wobble when it lands. Monotonic by construction.
 */
export const EASE_PRECISE = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * The duration scale, mirroring `--duration-*` in app/globals.css. Named by
 * role, not size — a component asks for the speed its *interaction* runs at,
 * never for a number.
 *
 * Anything animating from TS should reach for one of these rather than inlining
 * a literal, because a literal in a component and a literal in the stylesheet
 * cannot be kept in step by anything but memory: `score-ring.tsx` passed
 * `durationMs={1050}` to match a `1050ms` in the CSS, next to a comment
 * asserting it shared bar-fill's 900ms. Both now read DRAW_MS.
 */
export const DURATION_FEEDBACK_MS = 80;
export const DURATION_FAST_MS = 120;
export const DURATION_BASE_MS = 200;
export const DURATION_PANEL_MS = 280;
export const DRAW_MS = 900;

/** Timing constants matching the shipped .uaa-loading-mark is-done sequence
 * (app/globals.css) — kept here so anything scheduling around that sequence
 * (the boot splash) never re-derives or drifts from the CSS values.
 *
 * Halved from 110/440/1080. The resolve is the app's signature moment and it
 * keeps its choreography — bars settle one after another, *then* the terminus
 * twists — but it was spending 1.52s on that choreography while the real page
 * sat fully rendered behind the overlay. The gesture survives a faster read;
 * the user waiting on it does not benefit from the extra second. */
export const MARK_BAR_STAGGER_MS = 70;
export const MARK_TERMINUS_DELAY_MS = 280;
export const MARK_TERMINUS_DURATION_MS = 460;
export const MARK_DONE_SEQUENCE_MS = MARK_TERMINUS_DELAY_MS + MARK_TERMINUS_DURATION_MS;

/** Duration of the `.animate-plot-draw` sweep (app/globals.css) — the page's one
 *  deliberate "being drawn" moment. Mirrored here so charts that hand their draw
 *  to Recharts' own `animationDuration` land on the same timing as the CSS sweep,
 *  and so callers can latch "already drawn" after exactly that long. */
export const PLOT_DRAW_MS = 1500;

/** Shared "arrive into view" pacing for scroll-triggered reveals (Reveal,
 *  CountUp, ValueBar, ScoreRing — see app/_components/use-in-view-once.tsx).
 *  Deliberately calmer than UI-chrome transitions (popovers, menus, hover
 *  states): a section settling into place as the user reaches it should read
 *  as measured, not snappy. Per-item stagger is capped so a long list never
 *  takes longer than one comfortable glance to finish arriving. */
export const REVEAL_DURATION_MS = 640;
export const REVEAL_STAGGER_MS = 90;
export const REVEAL_STAGGER_MAX_MS = 540;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
