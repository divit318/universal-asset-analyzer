import type { InkRect, Movement, MoveContext } from "../types";
import { lensPoint, wrap01 } from "./formations";
import { clamp01, lerp, samplePolyline } from "./helpers";

/**
 * III. The Lens (Solution). Silhouette: converging to a bright point at
 * the left end, fanning and bowing outward at the right, formed of visible
 * striations. Material: membrane — particles on a surface, long link
 * threshold. Input: scroll scrub.
 *
 * progress 0.0-0.5 the lens forms and swells; 0.5-1.0 it compresses along
 * its short axis and RESOLVES into the sparkline inside the Market
 * performance card. The shape becomes the product. Scrubbed, never played.
 */

/* The PerformancePanel sparkline, normalized to its 260x80 viewBox. */
const SPARK: number[] = [
  0, 66, 18, 58, 34, 62, 52, 40, 70, 46, 88, 30, 106, 38, 124, 44, 142, 34, 160, 40, 178, 28, 196, 34, 214, 22, 232, 28, 252, 14,
].map((v, i) => (i % 2 === 0 ? v / 260 : v / 80));

const pt = { x: 0, y: 0 };
const out = { x: 0, y: 0, a: 0, s: 0 };

function zone(ctx: MoveContext): InkRect | null {
  return ctx.target("solution-ink");
}

function lensStep(ctx: MoveContext) {
  const r = zone(ctx);
  if (!r) return;
  const spark = ctx.target("solution-sparkline");
  const sol = ctx.section("solution");
  const p2 = sol ? clamp01((ctx.vh / 2 - sol.y) / Math.max(1, sol.h)) : ctx.progress;
  const swellP = clamp01(p2 / 0.45);
  const squeeze = clamp01((p2 - 0.5) / 0.4);
  const resolve = clamp01((p2 - 0.55) / 0.35);

  for (let k = 0; k < ctx.slotCount; k++) {
    const i = ctx.slots[k];
    const u = ctx.seed[i];
    const v = ctx.rand(i, 31);
    // Nine visible striations; slow flow along the axis (entering from the
    // left point, where the shards handed off).
    const level = (Math.floor(v * 9) / 8) * 2 - 1;
    const s = wrap01(u + ctx.time * 0.014);
    lensPoint(s, level, ctx.time, squeeze, r.w, r.h * swellP + 40 * (1 - swellP), out);
    let x = r.x + out.x;
    let y = r.y + (r.h - (r.h * swellP + 40 * (1 - swellP))) / 2 + out.y;
    let a = out.a * (0.5 + swellP * 0.4);
    let sz = out.s;

    if (resolve > 0 && spark) {
      samplePolyline(SPARK, u, pt);
      x = lerp(x, spark.x + pt.x * spark.w, resolve);
      y = lerp(y, spark.y + pt.y * spark.h + (v - 0.5) * 5, resolve);
      a = lerp(a, 0.65, resolve);
      sz = lerp(sz, 3, resolve);
      // The designed exception: the resolve crosses the (aria-hidden)
      // dashboard mock and becomes its chart.
      ctx.exempt[i] = 1;
    } else {
      ctx.exempt[i] = 0;
    }

    ctx.tx[i] = x;
    ctx.ty[i] = y;
    ctx.alpha[i] = a;
    ctx.size[i] = sz;
  }
}

export const lensMovement: Movement & { stiffness: number; damping: number } = {
  id: "lens",
  sections: ["solution"],
  stiffness: 40,
  damping: 7,
  unit: 170,
  maxCount: 1200,
  material: {
    shape: "dot",
    streakLength: 0,
    jitter: 0,
    blend: "additive",
    packing: 0.4,
    constrain: "free",
    linkDistance: 30,
    maxLinks: 3,
    linkAlpha: 0.12,
  },
  regions(ctx) {
    const r = zone(ctx);
    return r ? [r] : [];
  },
  step: lensStep,
};
