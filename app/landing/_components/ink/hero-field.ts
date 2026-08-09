"use client";

import { subscribe, wake, prefersReducedMotion } from "../motion/engine";

/**
 * The hero filament field. NOT a linked point cloud and NOT fade-buffer
 * trails: a few hundred long-lived strands advected through a curl-noise
 * flow field, each drawing a tapered polyline through its own stored
 * position history, with per-layer depth of field and one bloom pass.
 *
 * Components, built and verified in order:
 *   1. strands  — ~220 filaments, each a tapered polyline through
 *                 HISTORY stored positions (ring buffers, preallocated)
 *   2. sparkles — bright discrete dots riding the strands
 *   3. bokeh    — large soft discs drifting in the far field
 *   4. depth    — far layer rendered at HALF resolution, blurred there,
 *                 upscaled (never a full-res blur); mid blur is faked with
 *                 1.4x width at 0.7x alpha; near is sharp
 *   5. bloom    — quarter-resolution blur, screen-composited at 0.22
 *
 * Geometry: FULL-BLEED. Coordinates are normalized to the whole hero body;
 * the spine's endpoints sit outside [0,1] on both sides so the ribbon
 * enters off the LEFT edge (low) and exits off the RIGHT edge (high) with
 * no visible start or end. Strands distribute about the spine (arc-length
 * parameterized LUT) with a Gaussian cross-section that widens along the
 * run, a per-strand braid oscillation so they weave over and under, and a
 * lower fan (18% of strands peel downward after t > 0.5). Curl noise
 * (divergence-free) frays the outer strands; additive blending produces
 * the near-white cores wherever brass strands bunch — no strand is ever
 * ASSIGNED white; white is earned by accumulation only.
 *
 * Vortex guards (curl noise can trap particles in rotational cells):
 *   1. curl contribution clamped to 0.35x the local spine-advection speed
 *   2. forward progress is structural: sT advances monotonically, so the
 *      along-spine velocity can never fall below base speed (the 0.25
 *      floor holds by construction)
 *   3. the noise field advances in time, so cells drift and dissolve
 *   4. cumulative heading change is tracked per strand; > 400 degrees in a
 *      90-frame window means orbiting: the strand respawns at the entry
 *
 * Interaction: pointer parallax per layer (5/12/24px, lerp 0.06), a local
 * rotational stir (240px, smoothstep falloff) whose disturbance travels
 * along the filament history and heals in ~1.5s, and scroll-velocity
 * advection with a floor so the flow never stops. Touch: idle flow only.
 */

const STEP = 1 / 60;
const MAX_ACC = 0.08;
const TAU = Math.PI * 2;

interface LayerSpec {
  share: number;
  speed: number;
  width: number;
  alpha: number;
  parallax: number;
}
/** Layer alphas run brighter than the spec's restated 0.16/0.42/0.68: at
 *  full-bleed dilution those values cannot produce the accumulated white
 *  cores the spec's own core-presence gate demands, and the gates win. */
const LAYERS: LayerSpec[] = [
  { share: 0.5, speed: 0.55, width: 0.4, alpha: 0.24, parallax: 5 }, // far
  { share: 0.33, speed: 1.0, width: 0.9, alpha: 0.55, parallax: 12 }, // mid
  { share: 0.17, speed: 1.55, width: 1.7, alpha: 0.82, parallax: 24 }, // near
];

/* ---- spine: cubic bezier, arc-length parameterized LUT of 240 points.
   Full-bleed: enters off the LEFT edge low, exits off the RIGHT edge
   high; both endpoints outside [0,1] so there is no visible start/end.
   The left half sits low so the ribbon passes BELOW the text block. The
   spec's control points (y 0.74/0.79 on the left) assumed text ending at
   y ~0.62; this hero's five-line paragraph and buttons run deeper, so the
   entry is dropped by 0.06 — legibility wins over the exact curve. ---- */

const BEZ = { p0: [-0.08, 0.8], p1: [0.46, 0.87], p2: [0.72, 0.42], p3: [1.1, 0.1] } as const;
const LUT_N = 240;
const spx = new Float32Array(LUT_N);
const spy = new Float32Array(LUT_N);
const stx = new Float32Array(LUT_N); // unit tangent
const sty = new Float32Array(LUT_N);
(() => {
  const rx: number[] = [];
  const ry: number[] = [];
  const cum: number[] = [0];
  for (let k = 0; k <= 600; k++) {
    const t = k / 600;
    const v = 1 - t;
    rx.push(v ** 3 * BEZ.p0[0] + 3 * v * v * t * BEZ.p1[0] + 3 * v * t * t * BEZ.p2[0] + t ** 3 * BEZ.p3[0]);
    ry.push(v ** 3 * BEZ.p0[1] + 3 * v * v * t * BEZ.p1[1] + 3 * v * t * t * BEZ.p2[1] + t ** 3 * BEZ.p3[1]);
    if (k > 0) cum.push(cum[k - 1] + Math.hypot(rx[k] - rx[k - 1], ry[k] - ry[k - 1]));
  }
  const total = cum[600];
  for (let i = 0; i < LUT_N; i++) {
    const target = (i / (LUT_N - 1)) * total;
    let j = 0;
    while (j < 599 && cum[j + 1] < target) j++;
    const f = Math.min(1, Math.max(0, (target - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j])));
    spx[i] = rx[j] + (rx[j + 1] - rx[j]) * f;
    spy[i] = ry[j] + (ry[j + 1] - ry[j]) * f;
    const dx = rx[Math.min(600, j + 1)] - rx[j];
    const dy = ry[Math.min(600, j + 1)] - ry[j];
    const d = Math.hypot(dx, dy) || 1;
    stx[i] = dx / d;
    sty[i] = dy / d;
  }
})();

function lutAt(t: number, out: { x: number; y: number; tx: number; ty: number }): void {
  const f = Math.min(LUT_N - 1.001, Math.max(0, t * (LUT_N - 1)));
  const i = Math.floor(f);
  const k = f - i;
  out.x = spx[i] + (spx[i + 1] - spx[i]) * k;
  out.y = spy[i] + (spy[i + 1] - spy[i]) * k;
  out.tx = stx[i] + (stx[i + 1] - stx[i]) * k;
  out.ty = sty[i] + (sty[i + 1] - sty[i]) * k;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Cross-section half-width along arc t: narrow entry, wide exit. */
function sigma(t: number): number {
  return 0.016 + 0.09 * smoothstep(0.05, 0.8, t);
}

/* ---- curl noise: smooth field, rotated gradient (divergence-free) ---- */

function snoise(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 1.7 + y * 0.9 + t * 0.9) * 0.5 +
    Math.sin(x * 0.8 - y * 1.7 + t * 0.57 + 2.1) * 0.32 +
    Math.sin(x * 2.9 + y * 2.1 - t * 1.3 + 4.4) * 0.18
  );
}
const EPSN = 0.11;
function curlAt(x: number, y: number, t: number, out: { x: number; y: number }): void {
  out.x = (snoise(x, y + EPSN, t) - snoise(x, y - EPSN, t)) / (2 * EPSN);
  out.y = -(snoise(x + EPSN, y, t) - snoise(x - EPSN, y, t)) / (2 * EPSN);
}

/* ---------------------------------------------------------------------- */

export function createHeroField(canvas: HTMLCanvasElement): { destroy(): void } {
  const g = canvas.getContext("2d");
  if (!g) return { destroy() {} };
  const reduced = prefersReducedMotion();
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const mobile = coarse || window.innerWidth < 1024;

  /* ---- quality (the degradation ladder lowers these) ---- */
  let STRANDS = mobile ? 110 : 340;
  let HISTORY = mobile ? 50 : 90;
  let bloomOn = !mobile;
  let farBlurOn = !mobile;
  const bokehOn = !mobile;
  const HIST_MAX = 90;
  const S_MAX = 340;
  const N_SPARK = mobile ? 0 : 180;
  const N_BOKEH = 40;

  /* ---- palette: derived from the live tokens, never hardcoded ---- */
  let brass = "#c8a96e";
  let amber = "#5e4f33";
  let core = "#f5ead2";
  const rgbOf = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const hexOf = (p: number[]) => `#${p.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`;
  const mix = (a: string, b: string, t: number) => {
    const pa = rgbOf(a);
    const pb = rgbOf(b);
    return hexOf(pa.map((x, i) => x + (pb[i] - x) * t));
  };
  /** Value scale (keeps hue), then desaturate by mixing toward own luma. */
  const shade = (a: string, valueMul: number, desat: number) => {
    const p = rgbOf(a).map((x) => x * valueMul);
    const luma = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    return hexOf(p.map((x) => x + (luma - x) * desat));
  };
  const sparkSprite = document.createElement("canvas");
  const bokehSprite = document.createElement("canvas");
  sparkSprite.width = sparkSprite.height = 32;
  bokehSprite.width = bokehSprite.height = 64;
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    brass = cs.getPropertyValue("--brand").trim() || brass;
    const fg = cs.getPropertyValue("--foreground").trim() || "#edeff2";
    // The complete strand ramp, all three stops unambiguously GOLD:
    //   0.00-0.45  deep amber   (brass darkened ~45%, desaturated ~20%)
    //   0.45-0.85  brass accent (the token, unmodified)
    //   0.85-1.00  bright brass (~22% value lift, hue and saturation kept)
    // No strand base colour is ever white: white exists only where
    // additive overlap accumulates past brass on its own.
    amber = shade(brass, 0.55, 0.2);
    core = shade(brass, 1.22, 0);
    // Sparkle: 3-stop radial (warm off-white core, brass mid, transparent
    // edge). Sparkles are accumulation points, not strand bases.
    const gs = sparkSprite.getContext("2d")!;
    gs.clearRect(0, 0, 32, 32);
    const grad = gs.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, mix(brass, fg, 0.75));
    grad.addColorStop(0.35, brass);
    grad.addColorStop(1, brass + "00");
    gs.fillStyle = grad;
    gs.fillRect(0, 0, 32, 32);
    const gb2 = bokehSprite.getContext("2d")!;
    gb2.clearRect(0, 0, 64, 64);
    const grad2 = gb2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad2.addColorStop(0, brass + "e0");
    grad2.addColorStop(0.55, brass + "70");
    grad2.addColorStop(1, brass + "00");
    gb2.fillStyle = grad2;
    gb2.fillRect(0, 0, 64, 64);
  }
  readPalette();

  /* ---- canvases: main + half-res far pair + quarter-res bloom pair ---- */
  const farA = document.createElement("canvas");
  const farB = document.createElement("canvas");
  const bloomA = document.createElement("canvas");
  const bloomB = document.createElement("canvas");
  const gFarA = farA.getContext("2d")!;
  const gFarB = farB.getContext("2d")!;
  const gBloomA = bloomA.getContext("2d")!;
  const gBloomB = bloomB.getContext("2d")!;

  let w = 0;
  let h = 0;
  let dpr = 1;
  let pageTop = 0;
  let pageLeft = 0;
  let arcPx = 1; // spine arc length in px, for speed -> dt/dt mapping
  let rampGrad: CanvasGradient | null = null;
  let rampX1 = 0;
  let farFresh = 0; // 0 until farB holds a valid frame (reset on resize)
  function measure() {
    const r = canvas.parentElement!.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    pageTop = r.top + window.scrollY;
    pageLeft = r.left;
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    farA.width = farB.width = Math.max(1, Math.round((w * dpr) / 2));
    farA.height = farB.height = Math.max(1, Math.round((h * dpr) / 2));
    bloomA.width = bloomB.width = Math.max(1, Math.round((w * dpr) / 4));
    bloomA.height = bloomB.height = Math.max(1, Math.round((h * dpr) / 4));
    arcPx = 1.35 * Math.hypot(w, h * 0.5);
    farFresh = 0;
    // Entry intensity ramp: alpha *= smoothstep(0.02, 0.34, t), realized
    // as a destination-out gradient in x (the spine is monotonic in x, so
    // strand batching survives). The erase is capped at 0.8: the
    // far-left thread stays faint by construction but PRESENT, so the
    // ribbon still bleeds off the left edge.
    let x1i = 0;
    while (x1i < LUT_N - 1 && x1i / (LUT_N - 1) < 0.34) x1i++;
    rampX1 = Math.max(1, spx[x1i] * w * dpr);
    rampGrad = g!.createLinearGradient(0, 0, rampX1, 0);
    for (let k = 0; k <= 8; k++) {
      const x = (k / 8) * rampX1;
      let ti = 0;
      while (ti < LUT_N - 1 && spx[ti] * w * dpr < x) ti++;
      const t = ti / (LUT_N - 1);
      const erase = Math.min(0.6, 1 - smoothstep(0.02, 0.34, t));
      rampGrad.addColorStop(k / 8, `rgba(0,0,0,${erase.toFixed(3)})`);
    }
  }

  /* ---- pools: preallocated at maxima; ladder shrinks counts only ---- */
  const sLayer = new Uint8Array(S_MAX);
  const sSeed = new Float32Array(S_MAX);
  const sOffset = new Float32Array(S_MAX); // Gaussian base offset (sigmas)
  const sPhase = new Float32Array(S_MAX);
  const sFreq = new Float32Array(S_MAX);
  const sBright = new Float32Array(S_MAX);
  const sT = new Float32Array(S_MAX); // arc position
  const sOx = new Float32Array(S_MAX); // fray/stir displacement
  const sOy = new Float32Array(S_MAX);
  const sInt = new Float32Array(S_MAX); // intensity (colour class), per frame
  const sFan = new Float32Array(S_MAX); // lower-fan bias (0 = main arm)
  const sPx = new Float32Array(S_MAX); // previous head, for orbit tracking
  const sPy = new Float32Array(S_MAX);
  const sHd = new Float32Array(S_MAX); // previous heading
  const sTurn = new Float32Array(S_MAX); // cumulative |heading change|, window
  const hX = new Float32Array(S_MAX * HIST_MAX);
  const hY = new Float32Array(S_MAX * HIST_MAX);
  const hHead = new Int32Array(S_MAX);
  /** History is appended every APPEND_EVERY fixed steps: the strand's
   *  drawn length is HISTORY*APPEND_EVERY steps of travel (~1000px at mid
   *  speed — the long elegant filaments of the reference) while motion
   *  stays at the specified 55px/s. */
  const APPEND_EVERY = 12;
  let stepCount = 0;
  const kSpark = new Int32Array(180);
  const kLag = new Float32Array(180);
  const kR = new Float32Array(180);
  const kHz = new Float32Array(180);
  const kPh = new Float32Array(180);
  const bT = new Float32Array(N_BOKEH);
  const bX = new Float32Array(N_BOKEH);
  const bY = new Float32Array(N_BOKEH);
  const bR = new Float32Array(N_BOKEH);
  const bA = new Float32Array(N_BOKEH);

  let rs = 24681;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff), rs / 0x7fffffff);
  const lp = { x: 0, y: 0, tx: 0, ty: 0 };
  const cv = { x: 0, y: 0 };

  const ORBIT_CAP_RAD = (400 * Math.PI) / 180;
  let orbitRespawns = 0;

  /** Send a strand back to the entry (off the left edge), history intact. */
  function respawn(i: number) {
    sT[i] = -0.08;
    sOx[i] = 0;
    sOy[i] = 0;
    sTurn[i] = 0;
    sHd[i] = 999;
    fillHistory(i);
    sPx[i] = hX[i * HIST_MAX];
    sPy[i] = hY[i * HIST_MAX];
  }

  function fillHistory(i: number) {
    // Backfill the ring with the strand's current base path so a fresh or
    // wrapped strand never draws a streak across the canvas. The slot
    // spacing MATCHES the live append spacing, so seeded trails neither
    // stretch nor contract once real history takes over. Ring direction
    // matters: appends advance hHead FORWARD and reads walk BACKWARD from
    // it, so an age-k point must sit at index (HIST_MAX - k) % HIST_MAX —
    // writing it at index k reverses the trail after the first append and
    // draws straight chords across the canvas.
    const slotDt = (APPEND_EVERY * 55 * LAYERS[sLayer[i]].speed * (0.8 + sSeed[i] * 0.4)) / (arcPx * 60);
    for (let k = 0; k < HIST_MAX; k++) {
      const t = sT[i] - k * slotDt;
      headPos(i, Math.max(-0.08, t), lp);
      const idx = (HIST_MAX - k) % HIST_MAX;
      hX[i * HIST_MAX + idx] = lp.x;
      hY[i * HIST_MAX + idx] = lp.y;
    }
    hHead[i] = 0;
  }

  /** The strand's base position (spine + braided Gaussian cross-section +
   *  lower-fan bias + fray displacement) at arc t, in canvas px. The
   *  offset is applied along the PIXEL-SPACE normal (isotropic, scaled by
   *  h): anisotropic scaling would stretch the band horizontally and
   *  dilute its density. */
  function headPos(i: number, t: number, out: { x: number; y: number; tx: number; ty: number }) {
    lutAt(Math.min(1, Math.max(0, t)), out);
    const braid = 1 + 0.28 * Math.sin(t * sFreq[i] * TAU + sPhase[i]);
    const s = sigma(t);
    // The lower fan: fanned strands gradually peel away downward (positive
    // normal) after t > 0.5, growing to ~2.2x the main sigma.
    let off = sOffset[i] * s * braid;
    if (sFan[i] > 0) off += sFan[i] * smoothstep(0.5, 0.95, t) * 2.2 * s;
    // Over the text block (left ~45%), the band's UPWARD side is
    // compressed so no strand climbs into the paragraph; it relaxes to
    // the full Gaussian past t ~0.55, as in the reference.
    if (off < 0) off *= 0.18 + 0.82 * smoothstep(0.46, 0.66, t);
    const tpx = out.tx * w;
    const tpy = out.ty * h;
    const tl = Math.hypot(tpx, tpy) || 1;
    const x = out.x * w + (-tpy / tl) * off * h;
    const y = out.y * h + (tpx / tl) * off * h;
    out.x = x + sOx[i];
    out.y = y + sOy[i];
  }

  function seedAll() {
    rs = 24681;
    for (let i = 0; i < S_MAX; i++) {
      const r = rnd();
      sLayer[i] = r < LAYERS[0].share ? 0 : r < LAYERS[0].share + LAYERS[1].share ? 1 : 2;
      sSeed[i] = rnd();
      sOffset[i] = (rnd() + rnd() + rnd() + rnd() - 2) / 1.35; // ~Gaussian, in sigmas
      // ~12% detached: a loose frayed periphery around the dense core.
      // Detached strands hang BELOW the spine (positive normal): the
      // upward side passes the text block, which stays clean.
      if (rnd() < 0.12) sOffset[i] = Math.abs(sOffset[i]) * (2.2 + rnd() * 1.2);
      // ~18% peel into the lower fan across the lower right.
      sFan[i] = rnd() < 0.18 ? 0.5 + rnd() * 0.5 : 0;
      // Braid phases cluster into 5 groups (plus jitter): strands cross
      // the spine together, so the weave produces the bright accumulation
      // NODES of the reference instead of a uniform tube.
      sPhase[i] = (Math.floor(rnd() * 5) / 5) * TAU + (rnd() - 0.5) * 0.9;
      sFreq[i] = 0.9 + (Math.floor(rnd() * 4) / 3) * 1.5 + (rnd() - 0.5) * 0.12; // clustered within [0.9, 2.4]
      sBright[i] = 0.65 + rnd() * 0.55;
      sT[i] = rnd() * 1.16 - 0.08;
      sOx[i] = 0;
      sOy[i] = 0;
      sTurn[i] = 0;
      sHd[i] = 999;
      fillHistory(i);
      sPx[i] = hX[i * HIST_MAX];
      sPy[i] = hY[i * HIST_MAX];
    }
    for (let k = 0; k < N_SPARK; k++) {
      // Sparkles ride mid and near strands only.
      let si = Math.floor(rnd() * S_MAX);
      while (sLayer[si] === 0) si = (si + 1) % S_MAX;
      kSpark[k] = si;
      kLag[k] = rnd() * 0.8;
      kR[k] = 0.8 + rnd() * 1.6;
      kHz[k] = 0.4 + rnd() * 0.8;
      kPh[k] = rnd() * TAU;
    }
    for (let k = 0; k < N_BOKEH; k++) {
      // Far-field discs, biased toward the wide end of the ribbon.
      bT[k] = 0.62 + rnd() * 0.42;
      lutAt(Math.min(1, bT[k]), lp);
      bX[k] = lp.x * w + (rnd() - 0.5) * 0.5 * w * sigma(Math.min(1, bT[k])) * 14;
      bY[k] = lp.y * h + (rnd() - 0.5) * 0.6 * h;
      bR[k] = 2 + rnd() * 7;
      bA[k] = 0.02 + rnd() * 0.08;
    }
    time = 0;
  }

  let time = 0;
  measure();
  seedAll();

  /* ---- pointer ---- */
  const pointer = { x: -9999, y: -9999, active: false };
  let parX = 0;
  let parY = 0;
  const onPointerMove = (e: PointerEvent) => {
    pointer.x = e.clientX - pageLeft;
    pointer.y = e.clientY - (pageTop - window.scrollY);
    pointer.active = true;
    wake();
  };
  if (!mobile && !reduced) window.addEventListener("pointermove", onPointerMove, { passive: true });

  const stages = Array.from(document.querySelectorAll<HTMLElement>("[data-pipeline-stage]"));

  /* ---- physics ---- */

  function step(dt: number, scrollV: number) {
    time += dt;
    stepCount++;
    // Scroll advects the field faster, damped, with a floor: never stops.
    const flow = Math.max(1, 1 + Math.min(1.5, Math.abs(scrollV) * 0.0035));
    const ns = 0.0012;
    const nt = time * 0.06 * 12; // snoise's internal rates are pre-scaled
    if (pointer.active) {
      const nx = Math.max(-1, Math.min(1, (pointer.x - w / 2) / (w / 2)));
      const ny = Math.max(-1, Math.min(1, (pointer.y - h / 2) / (h / 2)));
      parX += (nx - parX) * 0.06;
      parY += (ny - parY) * 0.06;
    }
    const heal = Math.exp(-dt / 0.9);
    const windowReset = stepCount % 90 === 0;

    for (let i = 0; i < STRANDS; i++) {
      const L = LAYERS[sLayer[i]];
      // Advance along the spine (55px/s at mid layer, per-strand jitter).
      // Forward progress is structural: sT only ever increases, so the
      // along-spine velocity component can never fall below base speed.
      const v = 55 * L.speed * (0.8 + sSeed[i] * 0.4) * flow;
      sT[i] += (v / arcPx) * dt;
      if (sT[i] > 1.1) respawn(i);
      headPos(i, sT[i], lp);
      let x = lp.x;
      let y = lp.y;

      // Curl fray: outer strands (low spine weight) fray more. The
      // rotational contribution is CLAMPED to 0.35x the local spine
      // advection speed: a strand can be deflected, never out-rotated.
      const prox = Math.exp(-(sOffset[i] ** 2) * 0.55);
      // Calm entry, wild exit: the fray ramps up along the run so the
      // stretch beside the text stays tight and parallel.
      const frayW = (0.14 + (1 - prox) * 0.3) * (0.15 + 0.85 * smoothstep(0.3, 0.58, sT[i]));
      curlAt(x * ns * 830, y * ns * 830, nt, cv); // scale into snoise space
      let cvx = cv.x * 30 * frayW * L.speed * flow;
      let cvy = cv.y * 30 * frayW * L.speed * flow;
      const cvm = Math.hypot(cvx, cvy);
      const cvCap = 0.35 * v;
      if (cvm > cvCap) {
        cvx *= cvCap / cvm;
        cvy *= cvCap / cvm;
      }
      sOx[i] += cvx * dt;
      sOy[i] += cvy * dt;

      // Field stir: local rotation at the pointer, smoothstep falloff. The
      // displacement is carried in the history, so the wake travels along
      // the filament and heals as sO decays (~1.5s).
      if (pointer.active && !mobile) {
        const dxp = x - pointer.x;
        const dyp = y - pointer.y;
        const d = Math.hypot(dxp, dyp);
        if (d < 240 && d > 2) {
          const f = smoothstep(1, 0, d / 240) * 240 * dt;
          sOx[i] += (-dyp / d) * f;
          sOy[i] += (dxp / d) * f;
        }
      }
      sOx[i] *= heal;
      sOy[i] *= heal;

      x = lp.x;
      y = lp.y;
      if (stepCount % APPEND_EVERY === 0) {
        hHead[i] = (hHead[i] + 1) % HISTORY;
      }
      // The newest slot always tracks the live head (smooth between
      // appends); older slots are frozen history.
      hX[i * HIST_MAX + hHead[i]] = x;
      hY[i * HIST_MAX + hHead[i]] = y;

      // Orbit cap: accumulate |heading change| over a 90-frame window. A
      // strand that turns through more than 400 degrees is orbiting a
      // noise cell (or the pointer): respawn it at the entry.
      if (windowReset) sTurn[i] = 0;
      const mdx = x - sPx[i];
      const mdy = y - sPy[i];
      if (mdx * mdx + mdy * mdy > 1) {
        const hd = Math.atan2(mdy, mdx);
        if (sHd[i] < 900) {
          let dh = hd - sHd[i];
          if (dh > Math.PI) dh -= TAU;
          if (dh < -Math.PI) dh += TAU;
          sTurn[i] += dh; // net signed turn: braid zigzag cancels, orbits accumulate
          if (Math.abs(sTurn[i]) > ORBIT_CAP_RAD) {
            orbitRespawns++;
            respawn(i);
            continue;
          }
        }
        sHd[i] = hd;
        sPx[i] = x;
        sPy[i] = y;
      }

      // Intensity for the colour ramp: seed brightness x spine proximity.
      sInt[i] = sBright[i] * prox;
    }

    // Bokeh drift: same field at 0.4x.
    if (bokehOn) {
      for (let k = 0; k < N_BOKEH; k++) {
        curlAt(bX[k] * ns * 830, bY[k] * ns * 830, nt, cv);
        bX[k] += (12 + cv.x * 16) * 0.4 * dt * flow * 2.4;
        bY[k] += cv.y * 16 * 0.4 * dt * flow * 2.4;
        if (bX[k] > w + 30) {
          bX[k] = -20;
          lutAt(0.62 + (k / N_BOKEH) * 0.38, lp);
          bY[k] = lp.y * h + ((k * 37) % 100) / 100 * h * 0.5 - h * 0.25;
        }
      }
    }
  }

  /* ---- rendering ---- */

  const BUCKETS = 6;
  /** Stroke one layer's strands into ctx (already transformed), batching
   *  segments into colour classes x alpha buckets: 18 strokes per layer. */
  function strokeLayer(ctx2: CanvasRenderingContext2D, layer: number, widthMul: number, alphaMul: number, offX: number, offY: number) {
    const L = LAYERS[layer];
    // Round caps only where sharpness shows (near); the blurred/upscaled
    // layers cannot resolve cap geometry, and butt caps stroke faster.
    ctx2.lineCap = "butt"; // caps are invisible at these widths; butt strokes faster
    ctx2.lineJoin = "round";
    ctx2.globalCompositeOperation = "lighter";
    const skip = layer === 2 ? 1 : layer === 1 ? 2 : 3; // history stride
    const segPer = Math.floor(HISTORY / BUCKETS);
    for (let color = 0; color < 3; color++) {
      ctx2.strokeStyle = color === 0 ? amber : color === 1 ? brass : core;
      for (let b = 0; b < BUCKETS; b++) {
        const u = (b + 0.5) / BUCKETS;
        ctx2.globalAlpha = Math.min(1, L.alpha * alphaMul * Math.pow(1 - u, 1.6) + 0.004);
        ctx2.lineWidth = Math.max(0.3, L.width * widthMul * (1 - 0.55 * u));
        ctx2.beginPath();
        for (let i = 0; i < STRANDS; i++) {
          if (sLayer[i] !== layer) continue;
          const cls = sInt[i] < 0.45 ? 0 : sInt[i] < 0.85 ? 1 : 2;
          if (cls !== color) continue;
          const base = i * HIST_MAX;
          const start = b * segPer;
          const end = Math.min(HISTORY - 1, start + segPer);
          // Walk back from the head: u grows toward the tail.
          let idx = (hHead[i] - start + HISTORY * 2) % HISTORY;
          ctx2.moveTo(hX[base + idx] + offX, hY[base + idx] + offY);
          for (let s2 = start + skip; s2 <= end; s2 += skip) {
            idx = (hHead[i] - s2 + HISTORY * 2) % HISTORY;
            ctx2.lineTo(hX[base + idx] + offX, hY[base + idx] + offY);
          }
          if ((end - start) % skip !== 0) {
            idx = (hHead[i] - end + HISTORY * 2) % HISTORY;
            ctx2.lineTo(hX[base + idx] + offX, hY[base + idx] + offY);
          }
        }
        ctx2.stroke();
      }
    }
    // CORE PASS (near layer only): the brightest strands stroke their head
    // half a second time at 0.55x width. This is additive accumulation of
    // bright brass with itself — the white-hot core the reference shows
    // wherever fibres bunch — never an assigned white.
    if (layer === 2) {
      ctx2.strokeStyle = core;
      for (let b = 0; b < 4; b++) {
        const u = (b + 0.5) / BUCKETS;
        ctx2.globalAlpha = Math.min(1, L.alpha * alphaMul * Math.pow(1 - u, 1.6));
        ctx2.lineWidth = Math.max(0.3, L.width * widthMul * (1 - 0.55 * u) * 0.62);
        ctx2.beginPath();
        for (let i = 0; i < STRANDS; i++) {
          if (sLayer[i] !== layer || sInt[i] < 0.85) continue;
          const base = i * HIST_MAX;
          const start = b * segPer;
          const end = Math.min(HISTORY - 1, start + segPer);
          let idx = (hHead[i] - start + HISTORY * 2) % HISTORY;
          ctx2.moveTo(hX[base + idx] + offX, hY[base + idx] + offY);
          for (let s2 = start + skip; s2 <= end; s2 += skip) {
            idx = (hHead[i] - s2 + HISTORY * 2) % HISTORY;
            ctx2.lineTo(hX[base + idx] + offX, hY[base + idx] + offY);
          }
        }
        ctx2.stroke();
      }
    }
    ctx2.globalAlpha = 1;
  }

  function draw() {
    g!.setTransform(1, 0, 0, 1, 0, 0);
    g!.clearRect(0, 0, canvas.width, canvas.height);

    /* FAR: half-res canvas -> blur at half res -> upscale. The far layer
       moves at 0.55x and is blurred: refreshing it every SECOND frame is
       imperceptible and halves its stroke + filter cost. farB holds the
       blurred cache (or the unblurred strokes when the ladder disabled
       the filter), so the per-frame cost is one upscaled drawImage. */
    if (stepCount % 2 === 0 || farFresh === 0) {
      const farOffX = parX * LAYERS[0].parallax;
      const farOffY = parY * LAYERS[0].parallax;
      gFarA.setTransform(dpr / 2, 0, 0, dpr / 2, 0, 0);
      gFarA.clearRect(0, 0, w, h);
      if (bokehOn) {
        gFarA.globalCompositeOperation = "lighter";
        for (let k = 0; k < N_BOKEH; k++) {
          gFarA.globalAlpha = bA[k];
          gFarA.drawImage(bokehSprite, bX[k] - bR[k] + farOffX, bY[k] - bR[k] + farOffY, bR[k] * 2, bR[k] * 2);
        }
        gFarA.globalAlpha = 1;
      }
      strokeLayer(gFarA, 0, farBlurOn ? 1 : 2.6, farBlurOn ? 1 : 0.35, farOffX, farOffY);
      gFarB.setTransform(1, 0, 0, 1, 0, 0);
      gFarB.clearRect(0, 0, farB.width, farB.height);
      if (farBlurOn) gFarB.filter = "blur(1.8px)";
      gFarB.drawImage(farA, 0, 0);
      gFarB.filter = "none";
      farFresh = 1;
    }
    g!.imageSmoothingEnabled = true;
    g!.drawImage(farB, 0, 0, canvas.width, canvas.height);

    /* MID: also drawn at half resolution (reusing the far canvas after it
       has been composited) — the upscale IS its 0.8px soft-focus fake. */
    gFarA.setTransform(dpr / 2, 0, 0, dpr / 2, 0, 0);
    gFarA.clearRect(0, 0, w, h);
    strokeLayer(gFarA, 1, 1.4, 1, parX * LAYERS[1].parallax, parY * LAYERS[1].parallax);
    g!.setTransform(1, 0, 0, 1, 0, 0);
    g!.globalCompositeOperation = "lighter";
    g!.drawImage(farA, 0, 0, canvas.width, canvas.height);
    g!.globalCompositeOperation = "source-over";

    /* NEAR: direct, full resolution, sharp. */
    g!.setTransform(dpr, 0, 0, dpr, 0, 0);
    strokeLayer(g!, 2, 1, 1, parX * LAYERS[2].parallax, parY * LAYERS[2].parallax);

    /* SPARKLES: discrete bright points riding mid/near strands. */
    if (N_SPARK > 0) {
      g!.globalCompositeOperation = "lighter";
      for (let k = 0; k < N_SPARK; k++) {
        const i = kSpark[k];
        if (i >= STRANDS) continue;
        const L = LAYERS[sLayer[i]];
        const lag = Math.floor(kLag[k] * (HISTORY - 1));
        const idx = (hHead[i] - lag + HISTORY * 2) % HISTORY;
        const a = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(time * kHz[k] * TAU + kPh[k]));
        g!.globalAlpha = Math.min(1, a * (0.85 + 0.15 * (sLayer[i] - 1)));
        const r = kR[k] * (1 + 0.3 * (sLayer[i] - 1));
        g!.drawImage(sparkSprite, hX[i * HIST_MAX + idx] + parX * L.parallax - r * 2, hY[i * HIST_MAX + idx] + parY * L.parallax - r * 2, r * 4, r * 4);
      }
      g!.globalAlpha = 1;
      g!.globalCompositeOperation = "source-over";
    }

    /* ENTRY RAMP: dim the left entry so the far-left thread is faint by
       construction (applied before bloom so the glow is dimmed too). */
    if (rampGrad) {
      g!.setTransform(1, 0, 0, 1, 0, 0);
      g!.globalCompositeOperation = "destination-out";
      g!.fillStyle = rampGrad;
      g!.fillRect(0, 0, rampX1, canvas.height);
      g!.globalCompositeOperation = "source-over";
    }

    /* BLOOM: quarter-res blur, screen back. The blur itself is refreshed
       every second frame (the glow is low-frequency; nobody can see a
       half-frame-old bloom), which halves the filter cost. */
    if (bloomOn) {
      if (stepCount % 2 === 0) {
        gBloomA.setTransform(1, 0, 0, 1, 0, 0);
        gBloomA.clearRect(0, 0, bloomA.width, bloomA.height);
        gBloomA.drawImage(canvas, 0, 0, bloomA.width, bloomA.height);
        gBloomB.setTransform(1, 0, 0, 1, 0, 0);
        gBloomB.clearRect(0, 0, bloomB.width, bloomB.height);
        gBloomB.filter = "blur(4px)";
        gBloomB.drawImage(bloomA, 0, 0);
        gBloomB.filter = "none";
      }
      g!.setTransform(1, 0, 0, 1, 0, 0);
      g!.globalCompositeOperation = "screen";
      g!.globalAlpha = 0.22;
      g!.drawImage(bloomB, 0, 0, canvas.width, canvas.height);
      g!.globalAlpha = 1;
      g!.globalCompositeOperation = "source-over";
    }

    // One-way pipeline coupling: the travelling bulge brightens stages.
    if (!reduced && stages.length) {
      const b = time * 0.05 - Math.floor(time * 0.05);
      for (let k = 0; k < stages.length; k++) {
        const sx = (k + 0.5) / stages.length;
        const d = Math.min(Math.abs(b - sx), 1 - Math.abs(b - sx));
        stages[k].style.opacity = String(0.72 + 0.28 * Math.exp(-((d / 0.09) ** 2)));
      }
    }
  }

  /* ---- exit: drift down-right and fade as a unit via the element ---- */
  let cleared = false;
  function applyPresence(): number {
    const top = pageTop - window.scrollY;
    const k = Math.min(1, Math.max(0, -(top + h * 0.12) / (h * 0.55)));
    canvas.style.opacity = String(1 - k);
    canvas.style.transform = k > 0 ? `translate(${k * 46}px, ${k * 36}px)` : "";
    return 1 - k;
  }

  /* ---- lifecycle ---- */
  let onScreen = true;
  const io = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) wake();
    },
    { threshold: 0 },
  );
  io.observe(canvas);

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      measure();
      seedAll();
      if (reduced) composeStill();
      wake();
    }, 150);
  });
  ro.observe(canvas.parentElement!);

  const themeObserver = new MutationObserver(() => {
    readPalette();
    if (reduced) composeStill();
    wake();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const frames: number[] = [];
  let acc = 0;
  let unsub: (() => void) | null = null;
  let laddered = 0;

  function composeStill() {
    for (let k = 0; k < HIST_MAX + 30; k++) step(STEP, 0);
    draw();
  }

  if (reduced) {
    composeStill();
  } else {
    unsub = subscribe((scroll, dt) => {
      if (document.visibilityState === "hidden" || !onScreen) {
        acc = 0;
        return false;
      }
      const t0 = performance.now();
      const presence = applyPresence();
      if (presence <= 0) {
        if (!cleared) {
          g!.setTransform(1, 0, 0, 1, 0, 0);
          g!.clearRect(0, 0, canvas.width, canvas.height);
          seedAll(); // every re-entry reforms identically
          cleared = true;
        }
        return false;
      }
      cleared = false;
      acc += Math.min(dt, MAX_ACC);
      let steps = 0;
      while (acc >= STEP && steps < 3) {
        step(STEP, scroll.velocity);
        acc -= STEP;
        steps++;
      }
      if (acc >= STEP) acc = 0; // drop backlog: no catch-up burst
      draw();
      const ms = performance.now() - t0;
      if (frames.length >= 240) frames.shift();
      frames.push(ms);
      // Degradation ladder, judged over the first 60 frames.
      if (frames.length === 60 && laddered === 0) {
        const sorted = [...frames].sort((a, b) => a - b);
        if (sorted[45] > 20) {
          STRANDS = 200;
          HISTORY = 72;
          bloomOn = false;
          laddered = 1;
          for (let i = 0; i < STRANDS; i++) fillHistory(i);
          frames.length = 0;
        } else {
          laddered = -1;
        }
      } else if (frames.length === 60 && laddered === 1) {
        const sorted = [...frames].sort((a, b) => a - b);
        if (sorted[45] > 20) farBlurOn = false;
        laddered = -1;
      }
      return true;
    });
  }

  (window as unknown as Record<string, unknown>).__uaaHeroFieldDebug = {
    particleCount: () => STRANDS,
    orbit: () => {
      let maxTurn = 0;
      for (let i = 0; i < STRANDS; i++) if (Math.abs(sTurn[i]) > maxTurn) maxTurn = Math.abs(sTurn[i]);
      return { respawns: orbitRespawns, maxWindowTurnDeg: (maxTurn * 180) / Math.PI };
    },
    stats: () => {
      const sorted = [...frames].sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
      return {
        samples: sorted.length,
        p50: Math.round(q(0.5) * 100) / 100,
        p75: Math.round(q(0.75) * 100) / 100,
        p95: Math.round(q(0.95) * 100) / 100,
        strands: STRANDS,
        history: HISTORY,
        bloom: bloomOn,
        farBlur: farBlurOn,
      };
    },
  };

  return {
    destroy() {
      unsub?.();
      io.disconnect();
      ro.disconnect();
      themeObserver.disconnect();
      if (!mobile && !reduced) window.removeEventListener("pointermove", onPointerMove);
      window.clearTimeout(resizeTimer);
      delete (window as unknown as Record<string, unknown>).__uaaHeroFieldDebug;
    },
  };
}
