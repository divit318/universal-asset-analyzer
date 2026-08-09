import type { InkRect, Movement, MoveContext } from "../types";
import { shardPoint } from "./formations";

/**
 * II. The Five Shards (Problem). Silhouette: five stacked forms in the
 * centre ink column, each a visibly different geometry: sawtooth, text
 * block, lattice, closed loop, burst. Material: shard — angular, low-drag
 * particles that hold formation crisply, short link threshold so each
 * shard reads as a constructed object. Input: hover on the five labelled
 * items in the right column.
 *
 * At the closing line all five attempt to align into a single row for
 * about one second, fail, and fall back.
 */
const GAP = 26;

function zone(ctx: MoveContext): InkRect | null {
  return ctx.target("problem-ink");
}

function shardBox(r: InkRect, lane: number): InkRect {
  // Inset 16px each side: the neighbouring text columns' 24px inflation
  // bands must never reach a shard.
  const h = (r.h - GAP * 4) / 5;
  return { x: r.x + 16, y: r.y + lane * (h + GAP), w: r.w - 32, h };
}

const out = { x: 0, y: 0, a: 0, s: 0 };
let alignT = -10;
let alignArmed = true;

function shardsStep(ctx: MoveContext) {
  const r = zone(ctx);
  if (!r) return;
  const laneOf = ctx.mem("shard.lane", -1);
  const hoverW = ctx.mem("shard.hoverW", 0.8);
  const fresh = (ctx as unknown as { fresh: Uint8Array }).fresh;
  const hover = ctx.param<number>("problem.hover") ?? -1;

  for (let l = 0; l < 5; l++) {
    const want = hover < 0 ? 0.8 : l === hover ? 1 : 0.15;
    hoverW[l] += (want - hoverW[l]) * Math.min(1, ctx.dt / 0.13);
  }

  // The failed alignment at the closing line: one second, then release.
  if (alignArmed && ctx.progress > 0.72) {
    alignArmed = false;
    alignT = ctx.time;
  }
  if (ctx.progress < 0.5) alignArmed = true;
  const age = ctx.time - alignT;
  const align = age < 0.35 ? age / 0.35 : age < 0.85 ? 1 : age < 1.3 ? 1 - (age - 0.85) / 0.45 : 0;

  for (let k = 0; k < ctx.slotCount; k++) {
    const i = ctx.slots[k];
    if (fresh[i]) {
      fresh[i] = 0;
      laneOf[i] = Math.floor(ctx.seed[i] * 5);
    }
    const lane = laneOf[i];
    const box = shardBox(r, lane);
    const u = ctx.rand(i, 21);
    const v = ctx.rand(i, 22);
    shardPoint(lane, u, v, ctx.time, box.w, box.h, out);
    let x = box.x + out.x;
    let y = box.y + out.y;
    let a = out.a * hoverW[lane];

    if (align > 0.01) {
      // All five reach for one row across the column, wobble, and fail.
      const rowY = r.y + r.h * 0.5;
      const wobble = age > 0.6 ? Math.sin(ctx.time * 9 + i) * (age - 0.6) * 14 : 0;
      x += (r.x + u * r.w - x) * align;
      y += (rowY + wobble - y) * align;
      a *= 1 - align * 0.15;
    }

    ctx.tx[i] = x;
    ctx.ty[i] = y;
    ctx.alpha[i] = a;
    ctx.size[i] = out.s;
  }
}

export const shardsMovement: Movement & { stiffness: number; damping: number } = {
  id: "shards",
  sections: ["problem"],
  stiffness: 90, // crisp: shards hold formation
  damping: 13,
  unit: 140,
  maxCount: 1600,
  material: {
    shape: "angular",
    streakLength: 0,
    jitter: 26,
    blend: "additive",
    packing: 0.3,
    constrain: "free",
    linkDistance: 20,
    maxLinks: 3,
    linkAlpha: 0.13,
  },
  regions(ctx) {
    const r = zone(ctx);
    if (!r) return [];
    return [0, 1, 2, 3, 4].map((l) => shardBox(r, l));
  },
  step: shardsStep,
};
