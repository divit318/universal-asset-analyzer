import type { InkRect, Movement, MoveContext } from "../types";
import { pinchPoint, wrap01 } from "./formations";

/**
 * IV. The Pinch (Local-first). Silhouette: an hourglass, two wide fields
 * converging to a single bright point at the exact centre. Material: flow,
 * streaks aligned along direction, linking on. Input: pointer pressure.
 *
 * The asymmetry is the argument, visible without interaction: the LEFT
 * field (traditional tools) converges to the pinch, passes THROUGH it, and
 * escapes; the RIGHT field (UAA) converges, reaches the pinch, and
 * RECIRCULATES. Nothing crosses the centre line from the right. The pinch
 * point is the brightest single spot on the page, blooming under pointer
 * pressure with 200ms decay.
 */
function zone(ctx: MoveContext): InkRect | null {
  const r = ctx.target("privacy-ink");
  return r ? { x: r.x + 32, y: r.y + 6, w: r.w - 64, h: r.h - 12 } : null;
}

const out = { x: 0, y: 0, a: 0, s: 0 };
let pressure = 0;

function pinchStep(ctx: MoveContext) {
  const r = zone(ctx);
  if (!r) return;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;

  // Pointer pressure on the pinch: bloom brightens, 200ms decay.
  if (ctx.dt > 0) {
    pressure *= Math.exp(-ctx.dt / 0.2);
    const pd = Math.hypot(ctx.pointer.x - cx, ctx.pointer.y - cy);
    if (ctx.pointer.enabled && ctx.pointer.active && pd < 200) {
      pressure = Math.min(1.6, pressure + ((200 - pd) / 200) * ctx.dt * 5);
    }
  }

  for (let k = 0; k < ctx.slotCount; k++) {
    const i = ctx.slots[k];
    const side = i % 2 === 0 ? -1 : 1;
    const u = ctx.seed[i];
    const v = ctx.rand(i, 41);
    const phase = wrap01(u + ctx.time * 0.055 * (0.7 + v * 0.6));
    pinchPoint(side, phase, v * 2 - 1, r.w, r.h, out);
    ctx.tx[i] = r.x + out.x;
    ctx.ty[i] = r.y + out.y;
    ctx.alpha[i] = out.a * 0.85;
    ctx.size[i] = out.s;

    // Pointer repulsion, 120px: the left field is pushed clean through and
    // out; the right field crowds and returns (constrain guards the line).
    const p = ctx.pointer;
    if (p.enabled && p.active && ctx.dt > 0) {
      const dx = ctx.px[i] - p.x;
      const dy = ctx.py[i] - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 120 * 120 && d2 > 1) {
        const d = Math.sqrt(d2);
        const f = ((120 - d) / 120) * 3000 * ctx.dt;
        ctx.vx[i] += (dx / d) * f;
        ctx.vy[i] += (dy / d) * f;
      }
    }
  }
}

function pinchConstrain(ctx: MoveContext) {
  const r = zone(ctx);
  if (!r) return;
  const cx = r.x + r.w / 2;
  for (let k = 0; k < ctx.slotCount; k++) {
    const i = ctx.slots[k];
    // The whole band contains everyone horizontally (spring overshoot must
    // never leave the zone: column discipline is physical, not aspirational).
    if (ctx.px[i] < r.x) {
      ctx.px[i] = r.x;
      ctx.vx[i] = Math.abs(ctx.vx[i]) * 0.7;
    } else if (ctx.px[i] > r.x + r.w) {
      ctx.px[i] = r.x + r.w;
      ctx.vx[i] = -Math.abs(ctx.vx[i]) * 0.7;
    }
    if (i % 2 === 0) continue; // left field escapes freely through the pinch
    // Nothing crosses the centre line from the right. Ever.
    if (ctx.px[i] < cx + 2) {
      ctx.px[i] = cx + 2;
      ctx.vx[i] = Math.abs(ctx.vx[i]) * 0.8;
      pressure = Math.min(1.6, pressure + 0.01);
    }
    // Keep the recirculation inside the band vertically.
    if (ctx.py[i] < r.y) {
      ctx.py[i] = r.y;
      ctx.vy[i] = Math.abs(ctx.vy[i]) * 0.8;
    } else if (ctx.py[i] > r.y + r.h) {
      ctx.py[i] = r.y + r.h;
      ctx.vy[i] = -Math.abs(ctx.vy[i]) * 0.8;
    }
  }
}

function pinchDraw(ctx: MoveContext) {
  const r = zone(ctx);
  if (!r) return;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // The thin vertical rule marking the centre line.
  const g = ctx.gBack;
  g.globalAlpha = 0.3 * ctx.presence;
  g.strokeStyle = ctx.palette.brand;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx + 0.5, r.y + r.h * 0.08);
  g.lineTo(cx + 0.5, r.y + r.h * 0.92);
  g.stroke();
  // The pinch bloom: the brightest single spot on the page, brighter still
  // under pressure. Front layer, additive, capped by the front budget.
  const gf = ctx.gFront;
  gf.globalCompositeOperation = "lighter";
  const base = 26 + pressure * 16;
  gf.globalAlpha = Math.min(0.35, (0.26 + pressure * 0.12) * ctx.presence);
  gf.drawImage(ctx.spriteHi, cx - base / 2, cy - base / 2, base, base);
  const halo = 90 + pressure * 50;
  gf.globalAlpha = Math.min(0.35, (0.16 + pressure * 0.1) * ctx.presence);
  gf.drawImage(ctx.sprite, cx - halo / 2, cy - halo / 2, halo, halo);
  gf.globalAlpha = 1;
  gf.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
}

export const pinchMovement: Movement & { stiffness: number; damping: number } = {
  id: "pinch",
  sections: ["privacy"],
  stiffness: 26,
  damping: 4.5,
  unit: 150,
  maxCount: 1500,
  material: {
    shape: "streak",
    streakLength: 10,
    jitter: 0,
    blend: "additive",
    packing: 0.35,
    constrain: "free",
    linkDistance: 22,
    maxLinks: 3,
    linkAlpha: 0.1,
  },
  regions(ctx) {
    const r = zone(ctx);
    return r ? [r] : [];
  },
  step: pinchStep,
  constrain: pinchConstrain,
  draw: pinchDraw,
};
