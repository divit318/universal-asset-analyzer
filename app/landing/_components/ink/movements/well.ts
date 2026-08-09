import type { InkRect, Movement, MoveContext } from "../types";
import { WELL_PROFILES, wellProfileAt } from "./formations";

/**
 * VI. The Well (Try it). Silhouette: a shallow horizontal pool beneath the
 * search input with a defined top surface line. Material: fluid surface —
 * the one formation constrained to a 1D height field. Input: typing.
 *
 *   - slow idle swell
 *   - every keystroke drops a ripple at the caret's horizontal position;
 *     ripples propagate, reflect off the ends, and interfere
 *   - hovering a ticker chip settles the surface into that sparkline
 *   - Analyze drops the surface sharply; it rebounds once
 */
const COL_W = 3;
const MAX_COLS = 640;

// The height field (allocated once at the max; cols vary with zone width).
const H = new Float32Array(MAX_COLS);
const HV = new Float32Array(MAX_COLS);
let lastRipple = -1;
let lastAnalyze = -1;

function zone(ctx: MoveContext): InkRect | null {
  return ctx.target("demo-well");
}

function wellStep(ctx: MoveContext) {
  const r = zone(ctx);
  if (!r) return;
  const cols = Math.min(MAX_COLS, Math.max(16, Math.floor(r.w / COL_W)));
  const surfY = r.y + r.h * 0.34;

  if (ctx.dt > 0) {
    // Keystroke ripples at the caret's x.
    const ripple = ctx.param<{ x: number; t: number }>("well.ripple");
    if (ripple && ripple.t !== lastRipple) {
      lastRipple = ripple.t;
      const c = Math.min(cols - 2, Math.max(1, Math.round((ripple.x - r.x) / COL_W)));
      H[c] -= 15;
      H[c - 1] -= 8;
      H[c + 1] -= 8;
    }
    // Analyze: the surface drops sharply and rebounds once.
    const analyze = ctx.param<number>("well.analyze");
    if (analyze !== undefined && analyze !== lastAnalyze) {
      lastAnalyze = analyze;
      for (let c = 0; c < cols; c++) H[c] -= 20;
    }
    // Wave equation: propagate, reflect at the ends, damp.
    for (let c = 0; c < cols; c++) {
      const left = H[c === 0 ? 0 : c - 1];
      const right = H[c === cols - 1 ? cols - 1 : c + 1];
      HV[c] += ((left + right) / 2 - H[c]) * 0.42;
      HV[c] *= 0.982;
    }
    // Held ticker profile: the surface settles into the sparkline shape.
    const ticker = ctx.param<string | null>("well.ticker") ?? null;
    const profile = ticker ? WELL_PROFILES[ticker] : null;
    for (let c = 0; c < cols; c++) {
      H[c] += HV[c];
      if (profile) {
        const target = (wellProfileAt(profile, c / cols) - 0.5) * -34;
        H[c] += (target - H[c]) * Math.min(1, ctx.dt * 6);
      }
      // Idle swell.
      H[c] += Math.sin(ctx.time * 1.1 + c * 0.11) * 0.9 * ctx.dt;
      if (H[c] > r.h * 0.3) H[c] = r.h * 0.3;
      if (H[c] < -r.h * 0.2) H[c] = -r.h * 0.2;
    }
  }

  for (let k = 0; k < ctx.slotCount; k++) {
    const i = ctx.slots[k];
    const u = ctx.seed[i];
    const v = ctx.rand(i, 51);
    const c = Math.min(cols - 1, Math.floor(u * cols));
    const surface = surfY + H[c];
    if (v < 0.58) {
      // The surface line itself: dense, linked along x.
      ctx.tx[i] = r.x + u * r.w;
      ctx.ty[i] = surface;
      ctx.alpha[i] = 0.9;
      ctx.size[i] = 3.4;
    } else {
      // Sub-surface scatter, following the surface with depth decay.
      const depth = (v - 0.58) / 0.42;
      ctx.tx[i] = r.x + u * r.w;
      ctx.ty[i] = surface + 6 + depth * (r.y + r.h - surface - 10) + H[c] * 0.2 * (1 - depth);
      ctx.alpha[i] = 0.42 * (1 - depth * 0.6);
      ctx.size[i] = 3 + v;
    }
  }
}

export const wellMovement: Movement & { stiffness: number; damping: number } = {
  id: "well",
  sections: ["demo"],
  stiffness: 150, // the surface must track the height field tightly
  damping: 18,
  unit: 130,
  maxCount: 1100,
  material: {
    shape: "dot",
    streakLength: 0,
    jitter: 0,
    blend: "additive",
    packing: 0.45,
    constrain: "surface",
    linkDistance: 12,
    maxLinks: 2,
    linkAlpha: 0.16,
  },
  regions(ctx) {
    const r = zone(ctx);
    return r ? [r] : [];
  },
  step: wellStep,
};
