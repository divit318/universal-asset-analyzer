import type { InkRect, Movement, MoveContext } from "../types";
import { streamPoint } from "./formations";
import { clamp01 } from "./helpers";

/**
 * III. The Streams (Solution). Silhouette: five labelled streams enter at
 * the LEFT edge of the centre ink column, one per source from the Problem
 * section, loose and scattered at their origins, tightening and
 * brightening as they travel right until all five land at one apex on the
 * product panel's left edge. The geometry is the argument: five things
 * becoming one, order emerging from scatter, arriving INTO the product.
 *
 * Material: flow. Velocity-aligned streaks while the ink is moving that
 * settle into calm dots at rest. Input: a play-once, staggered reveal as
 * the section enters the viewport (never scrubbed, never replayed); after
 * settle the only ambient motion is a faint sub-pixel drift near the
 * origins. Reduced motion renders the settled, fully-converged state.
 */

/* Reveal timing: lane i starts at STAGGER*i and flows for FLOW seconds. */
const STAGGER = 0.14;
const FLOW = 1.15;

/* Origins are inset past the zone's label column (solution.tsx pins the
 * five source labels at the left edge), so the loose origin scatter never
 * renders over the label text: content protection is structural. */
const INSET = 112;

const out = { x: 0, y: 0, a: 0, s: 0 };

function zone(ctx: MoveContext): InkRect | null {
  return ctx.target("solution-ink");
}

/** Apex (landing point) in zone-local coords: the panel port when the
 *  panel is measurable, the zone's right-centre otherwise. */
function apexOf(ctx: MoveContext, r: InkRect): { x: number; y: number } {
  const port = ctx.target("solution-port");
  if (port) return { x: port.x + 3 - r.x, y: port.y + port.h / 2 - r.y };
  return { x: r.w, y: r.h * 0.5 };
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3);
}

function streamsStep(ctx: MoveContext) {
  const r = zone(ctx);
  if (!r) return;
  const apex = apexOf(ctx, r);
  const laneOf = ctx.mem("streams.lane", -1);
  const state = ctx.mem("streams.state"); // [0] phase 0/1/2, [1] t0
  const fresh = (ctx as unknown as { fresh: Uint8Array }).fresh;

  // Arm the play-once reveal when the zone is meaningfully in view.
  if (state[0] === 0 && (ctx.reduced || r.y < ctx.vh * 0.72)) {
    state[0] = 1;
    state[1] = ctx.time;
  }
  const age = state[0] >= 1 ? ctx.time - state[1] : 0;
  // Latch BEFORE deriving `played`: the engine may park on the very frame
  // the latch flips (settled() turns true), so that frame must already
  // render the fully-converged state, never a zero-alpha intermediate.
  if (state[0] === 1 && age > STAGGER * 4 + FLOW + 0.4) state[0] = 2;
  const played = ctx.reduced || state[0] === 2;

  for (let k = 0; k < ctx.slotCount; k++) {
    const i = ctx.slots[k];
    if (fresh[i]) {
      fresh[i] = 0;
      laneOf[i] = Math.floor(ctx.seed[i] * 5);
    }
    const lane = laneOf[i];
    const u = Math.pow(ctx.rand(i, 41), 0.92);
    const v = ctx.rand(i, 42);
    const v2 = ctx.rand(i, 43);

    // The lane's flow head: 0 at its origin, 1 once it reaches the apex.
    const head = played ? 1 : state[0] === 1 ? easeOut((age - lane * STAGGER) / FLOW) : 0;
    // Particles ride the head until their resting u, then peel off and
    // hold: the stream visibly extends from origin to apex, then settles.
    const ue = Math.min(u, head);

    streamPoint(lane, ue, v, v2, ctx.time, apex.x - INSET, r.h, apex.y, out);
    out.x += INSET;
    let x = r.x + out.x;
    let y = r.y + out.y;
    let a = out.a * (head > 0 ? 0.55 + 0.45 * head : 0);
    let sz = out.s;

    // The landing: the last stretch snaps onto the apex and stays bright.
    // These particles cross the panel's inflated keep-out edge by design.
    if (ue > 0.965) {
      const t = (ue - 0.965) / 0.035;
      x = r.x + out.x + (r.x + apex.x - (r.x + out.x)) * t;
      y = r.y + out.y + (r.y + apex.y - (r.y + out.y)) * t;
      a = Math.max(a, 0.8);
      sz = Math.max(sz, 3.2);
    }
    ctx.exempt[i] = out.x > apex.x - 36 ? 1 : 0;

    ctx.tx[i] = x;
    ctx.ty[i] = y;
    ctx.alpha[i] = a;
    ctx.size[i] = sz;
  }
}

export const streamsMovement: Movement & { stiffness: number; damping: number } = {
  id: "streams",
  sections: ["solution"],
  stiffness: 55,
  damping: 8.5,
  unit: 120,
  maxCount: 1500,
  material: {
    shape: "streak",
    streakLength: 9,
    jitter: 3,
    blend: "additive",
    packing: 0.35,
    constrain: "free",
    linkDistance: 22,
    maxLinks: 3,
    linkAlpha: 0.09,
  },
  regions(ctx) {
    const r = zone(ctx);
    if (!r) return [];
    const apex = apexOf(ctx, r);
    return [{ x: r.x, y: r.y, w: Math.max(r.w, apex.x), h: r.h }];
  },
  step: streamsStep,
  draw(ctx) {
    // The port glow: the moment of arrival, rendered at the panel edge.
    const r = zone(ctx);
    if (!r) return;
    const state = ctx.mem("streams.state");
    if (!ctx.reduced && state[0] === 0) return;
    const apex = apexOf(ctx, r);
    const age = ctx.time - state[1];
    const arrived = ctx.reduced || state[0] === 2 ? 1 : clamp01((age - STAGGER * 4 - FLOW * 0.7) / 0.5);
    if (arrived <= 0) return;
    // Bloom on arrival (up to 1.35x), settling to a steady faint glow.
    const bloom = ctx.reduced || state[0] === 2 ? 1 : 1 + 0.35 * Math.sin(Math.PI * clamp01(arrived));
    const g = ctx.gBack;
    const x = r.x + apex.x;
    const y = r.y + apex.y;
    const rad = 26 * bloom;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, ctx.palette.brandStrong + "55");
    grad.addColorStop(0.45, ctx.palette.brand + "2e");
    grad.addColorStop(1, ctx.palette.brand + "00");
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = arrived * ctx.presence;
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    g.restore();
  },
  settled(ctx) {
    const state = ctx.mem("streams.state");
    return state[0] === 2;
  },
};
