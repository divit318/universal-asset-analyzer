import type { InkRect, Movement, MoveContext } from "../types";
import { clamp01, lerp } from "./helpers";
import { loadSeal, sealPoints } from "../glyph";

/**
 * VII. The Seal (CTA). Silhouette: a circular seal roughly 180px across
 * with the asset/analyzer mark as NEGATIVE SPACE inside it. Material:
 * solid — particles packed to maximum density, linking at maximum, reading
 * as a struck object. Input: arrival.
 *
 * Ink converges from the entry seam into a dense disc; the disc compresses
 * once, sharply, over 220ms with a hard ease-out, as if stamped; then it
 * goes completely still and the rAF loop parks. The last frame of the page
 * is a struck brass seal: evidence in ink, verdicts in brass.
 */
const RADIUS = 104;

function zone(ctx: MoveContext): InkRect | null {
  return ctx.target("cta-seal");
}

let assignedFor = -1;
let assignedSlots = -1;
let stampAt = -1;
let struck = false;

function assign(ctx: MoveContext, pts: Float32Array) {
  const slotPt = ctx.mem("seal.pt", -1);
  const gx = ctx.mem("seal.gx");
  const gy = ctx.mem("seal.gy");
  slotPt.fill(-1);
  const nPts = pts.length / 2;
  const taken = new Uint8Array(ctx.slotCount);
  // Greedy nearest-neighbour in stable seed space: no path crossings, no
  // flicker on reassignment.
  const order = Array.from({ length: nPts }, (_, k) => k).sort((a, b) => pts[a * 2 + 1] - pts[b * 2 + 1]);
  for (const k of order) {
    const x0 = pts[k * 2];
    const y0 = pts[k * 2 + 1];
    let best = -1;
    let bestD = Infinity;
    for (let s = 0; s < ctx.slotCount; s++) {
      if (taken[s]) continue;
      const i = ctx.slots[s];
      const dx = ctx.seed[i] * 2 - 1 - x0;
      const dy = ctx.rand(i, 61) * 2 - 1 - y0;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best < 0) break;
    taken[best] = 1;
    const i = ctx.slots[best];
    slotPt[i] = k;
    gx[i] = x0;
    gy[i] = y0;
  }
  assignedFor = nPts;
  assignedSlots = ctx.slotCount;
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

function sealStep(ctx: MoveContext) {
  const r = zone(ctx);
  if (!r) return;
  loadSeal();
  const pts = sealPoints();
  const slotPt = ctx.mem("seal.pt", -1);
  const gx = ctx.mem("seal.gx");
  const gy = ctx.mem("seal.gy");
  const fresh = (ctx as unknown as { fresh: Uint8Array }).fresh;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;

  if (pts && ctx.slotCount > 0 && (assignedFor !== pts.length / 2 || assignedSlots !== ctx.slotCount)) {
    assign(ctx, pts);
  }

  const p = ctx.progress;
  const converge = clamp01((p - 0.3) / 0.4);

  // The strike: one sharp 220ms compression when the disc completes.
  if (converge >= 0.97 && !struck && ctx.dt > 0) {
    struck = true;
    stampAt = ctx.time;
  }
  if (converge < 0.5) struck = false;
  const stampT = struck ? clamp01((ctx.time - stampAt) / 0.22) : 0;
  const scale = struck ? 1 + 0.07 * (1 - easeOutQuart(stampT)) : 1 + (1 - converge) * 0.18;

  for (let k = 0; k < ctx.slotCount; k++) {
    const i = ctx.slots[k];
    if (fresh[i]) fresh[i] = 0;
    const u = ctx.seed[i];
    const v = ctx.rand(i, 62);
    let a: number;
    if (pts && slotPt[i] >= 0) {
      // Converging cloud -> packed disc: the same points, scaled inward,
      // with a slight swirl that dies as the seal lands.
      const swirl = (1 - converge) * 1.6 * (u > 0.5 ? 1 : -1);
      const px0 = gx[i] * scale;
      const py0 = gy[i] * scale;
      const cosS = Math.cos(swirl);
      const sinS = Math.sin(swirl);
      ctx.tx[i] = cx + (px0 * cosS - py0 * sinS) * RADIUS;
      ctx.ty[i] = cy + (px0 * sinS + py0 * cosS) * RADIUS;
      a = lerp(0.35, 0.92, converge);
      ctx.size[i] = lerp(2.6, 3.8, converge);
    } else {
      // Unassigned ink dissolves: the seal is all that remains.
      ctx.tx[i] = cx + (u - 0.5) * r.w;
      ctx.ty[i] = cy + (v - 0.5) * r.h;
      a = 0.3 * (1 - converge);
      ctx.size[i] = 2.6;
    }
    ctx.alpha[i] = a;
  }
}

function sealSettled(ctx: MoveContext): boolean {
  if (ctx.progress < 0.85 || !struck) return false;
  if (stampAt >= 0 && ctx.time - stampAt < 0.5) return false;
  let energy = 0;
  const step = Math.max(1, Math.floor(ctx.slotCount / 64));
  let n = 0;
  for (let k = 0; k < ctx.slotCount; k += step) {
    const i = ctx.slots[k];
    energy += Math.abs(ctx.vx[i]) + Math.abs(ctx.vy[i]);
    n++;
  }
  return n === 0 || energy / n < 2.4;
}

export const sealMovement: Movement & { stiffness: number; damping: number } = {
  id: "seal",
  sections: ["cta"],
  stiffness: 46,
  damping: 8,
  unit: 42, // packed to maximum density: the disc must read as solid
  maxCount: 1700,
  material: {
    shape: "dot",
    streakLength: 0,
    jitter: 0,
    blend: "additive",
    packing: 1,
    constrain: "free",
    linkDistance: 9,
    maxLinks: 3,
    linkAlpha: 0.16,
  },
  regions(ctx) {
    const r = zone(ctx);
    if (!r) return [];
    const side = Math.min(r.w, r.h, RADIUS * 2 + 30);
    return [{ x: r.x + r.w / 2 - side / 2, y: r.y + r.h / 2 - side / 2, w: side, h: side }];
  },
  step: sealStep,
  settled: sealSettled,
};
