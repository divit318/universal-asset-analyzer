"use client";

/**
 * The landing page's motion engine — ONE global scroll observer and ONE
 * requestAnimationFrame loop for the entire page. Every animated consumer
 * (hero canvas, nav pill, band dissolves, waypoint pulses) subscribes here;
 * nothing else on the page is allowed to call requestAnimationFrame.
 *
 * Architecture:
 *   - A passive scroll listener that ONLY records raw scrollY and wakes the
 *     loop. All math happens inside the rAF loop, never in the handler.
 *   - velocity is integrated and damped (inertia), not read raw:
 *       velocity += (delta - velocity) * 0.18; velocity *= 0.90
 *   - The loop SUSPENDS when the page is idle (|velocity| < EPS for >120ms)
 *     and no subscriber returned `true` (keep-alive) this frame; it resumes
 *     on the next scroll event or via wake().
 *
 * Reduced motion: one shared flag (prefersReducedMotion). When set, velocity
 * is pinned to 0 and the loop never free-runs; consumers read this same flag.
 */

export interface ScrollState {
  scrollY: number;
  delta: number;
  /** Smoothed, damped, signed px/frame. Always 0 under reduced motion. */
  velocity: number;
  direction: -1 | 0 | 1;
  isIdle: boolean;
  /** High-res timestamp of this frame. */
  now: number;
}

/** Return `true` to keep the loop alive even while scroll is idle. */
export type FrameCallback = (state: ScrollState, dt: number) => boolean | void;

const EPS = 0.01;
const IDLE_MS = 120;

/* ----------------------------- reduced motion ----------------------------- */

let mql: MediaQueryList | null = null;
let reduced = false;
const reducedListeners = new Set<(r: boolean) => void>();

function ensureMql() {
  if (mql || typeof window === "undefined") return;
  mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduced = mql.matches;
  mql.addEventListener("change", (e) => {
    reduced = e.matches;
    reducedListeners.forEach((cb) => cb(reduced));
  });
}

/** THE reduced-motion flag. Every landing consumer reads this one source. */
export function prefersReducedMotion(): boolean {
  ensureMql();
  return reduced;
}

export function onReducedMotionChange(cb: (r: boolean) => void): () => void {
  ensureMql();
  reducedListeners.add(cb);
  return () => reducedListeners.delete(cb);
}

/* ------------------------------- the engine ------------------------------- */

const subscribers = new Set<FrameCallback>();
const state: ScrollState = { scrollY: 0, delta: 0, velocity: 0, direction: 0, isIdle: true, now: 0 };

let rawY = 0;
let lastMove = 0;
let lastFrame = 0;
let running = false;
let installed = false;

function loop(now: number) {
  const dt = lastFrame ? Math.min(64, now - lastFrame) / 1000 : 1 / 60;
  lastFrame = now;

  state.delta = rawY - state.scrollY;
  state.scrollY = rawY;
  state.now = now;

  if (prefersReducedMotion()) {
    state.velocity = 0;
  } else {
    state.velocity += (state.delta - state.velocity) * 0.18;
    state.velocity *= 0.9;
  }
  state.direction = state.velocity > EPS ? 1 : state.velocity < -EPS ? -1 : 0;
  state.isIdle = Math.abs(state.velocity) < EPS && now - lastMove > IDLE_MS;

  let keepAlive = false;
  for (const cb of subscribers) {
    if (cb(state, dt) === true) keepAlive = true;
  }

  if (state.isIdle && !keepAlive) {
    running = false;
    lastFrame = 0;
    return; // suspended: a permanently running rAF loop is a battery bug
  }
  schedule();
}

/** THE one requestAnimationFrame call site for the entire landing page. */
function schedule() {
  requestAnimationFrame(loop);
}

function wakeLoop() {
  if (running || typeof window === "undefined") return;
  running = true;
  schedule();
}

function onScroll() {
  // The handler ONLY records; all math happens in the frame loop.
  rawY = window.scrollY;
  lastMove = performance.now();
  wakeLoop();
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  rawY = window.scrollY;
  state.scrollY = rawY;
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wakeLoop();
    // Hidden: the loop parks itself because subscribers gate on visibility
    // (canvas returns keep-alive false when the tab is hidden).
  });
}

/**
 * Subscribe a per-frame callback. Returns an unsubscribe function.
 * Callbacks run once per frame in registration order.
 */
export function subscribe(cb: FrameCallback): () => void {
  install();
  subscribers.add(cb);
  wakeLoop();
  return () => subscribers.delete(cb);
}

/** Wake the loop for at least one frame (e.g. after a resize or IO entry). */
export function wake(): void {
  install();
  wakeLoop();
}

/** Schedule a callback on the engine's next frame (the ONE rAF site). */
export function onNextFrame(cb: () => void): void {
  const un = subscribe(() => {
    un();
    cb();
  });
}

/** Read-only snapshot of the current scroll state. */
export function getScrollState(): Readonly<ScrollState> {
  return state;
}
