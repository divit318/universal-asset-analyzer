"use client";

import { subscribe, wake, prefersReducedMotion } from "../motion/engine";
import { measureLayout, layoutReady, sectionRect, targetRect, movementRange } from "./layout";
import { measureKeepout, keepoutAlpha, keepoutRects } from "./keepout";
import { DEFAULT_MATERIAL, type InkPalette, type InkRect, type MoveContext, type Movement } from "./types";

/**
 * The Ink Field engine, movement edition.
 *
 * Five sealed movements own their own particle sub-pools (drawn from ONE
 * shared free list, allocated once), their own bounds, and their own
 * lifecycles. There is NO position cross-fade between movements: a movement
 * retires its ink toward its exit seam (alpha to zero as it arrives) and
 * the next spawns from its entry seam. No particle is ever asked to be in
 * two formations at once, so no particle ever crosses a paragraph.
 *
 * Density is derived from formation area (DENSITY_UNIT px² per particle,
 * computed per movement from the sum of its region areas), never assigned
 * globally: a formation confined to two card interiors is dense, a
 * full-width band is dense, and nothing is dust.
 *
 * Keep-out masking (keepout.ts) is applied in the ONE shared render path:
 * every particle's alpha is multiplied by the mask, so no movement can
 * forget it. Movements may exempt individual particles only for designed
 * resolutions (the braid becoming the sparkline).
 *
 * Two layers: back canvas below content (all formation ink), front canvas
 * above content (membrane pressure, glyph resolution), front alpha capped
 * at 0.35.
 *
 * Kept from the previous engine: fixed 1/60 timestep with render
 * interpolation, spring integration, degradation sampling, pointer
 * smoothing, visibility parking, and the no-loop reduced-motion branch.
 */

const STEP = 1 / 60;
const MAX_ACC = 0.1;
const DENSITY_UNIT = 380;
const DENSITY_UNIT_MOBILE = 520;
const COUNT_MIN = 120;
const COUNT_MAX = 1800;
const SEAM_VH = 0.15; // seams sit 15vh inside the movement's range edge
const OVERLAP_VH = 0.12; // relay window

function isCoarse(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

/* ------------------------- cross-boundary channels ------------------------- */

const params = new Map<string, unknown>();
const domRegistry = new Map<string, HTMLElement[]>();

export function setInkParam(key: string, value: unknown): void {
  params.set(key, value);
  wake();
}

export function registerInkDom(key: string, els: HTMLElement[]): () => void {
  domRegistry.set(key, els);
  return () => {
    if (domRegistry.get(key) === els) domRegistry.delete(key);
  };
}

/* --------------------------------- engine --------------------------------- */

interface MoveState {
  m: Movement;
  slots: Int32Array;
  slotCount: number;
  desired: number;
  presence: number;
  wants: boolean;
  progress: number;
  seamY: number; // page coords
  regions: InkRect[];
  regionArea: number;
}

export function createInkEngine(
  back: HTMLCanvasElement,
  front: HTMLCanvasElement,
  movements: Movement[],
): { destroy(): void } {
  const gBack = back.getContext("2d");
  const gFront = front.getContext("2d");
  if (!gBack || !gFront) return { destroy() {} };

  const reduced = prefersReducedMotion();
  const coarse = isCoarse();
  const unit = coarse || window.innerWidth < 768 ? DENSITY_UNIT_MOBILE : DENSITY_UNIT;

  /* ---- palette + sprites: the three-stop value ramp -------------------
     Core (near-white, warm), body (brass), falloff (deep amber). All stops
     are DERIVED from the live theme tokens at mount, never hardcoded. */
  const palette: InkPalette = {
    brand: "#c8a96e", brandStrong: "#e2c489", foreground: "#edeff2", background: "#0a0b0e", muted: "#99a3b2",
    core: "#f2e4c8", falloff: "#67573a",
  };
  function mixHex(a: string, b: string, t: number): string {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return `#${pa.map((x, i) => Math.round(x + (pb[i] - x) * t).toString(16).padStart(2, "0")).join("")}`;
  }
  function cssColorToHex(v: string): string {
    // Tokens are hex in globals.css; normalize defensively via a canvas.
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const g2 = c.getContext("2d")!;
    g2.fillStyle = v;
    g2.fillRect(0, 0, 1, 1);
    const d = g2.getImageData(0, 0, 1, 1).data;
    return `#${[d[0], d[1], d[2]].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  }
  // Sprites: dot + angular (diamond), per ramp stop.
  const SPRITES = ["core", "body", "fall"] as const;
  const dotSprites = SPRITES.map(() => document.createElement("canvas"));
  const angSprites = SPRITES.map(() => document.createElement("canvas"));
  for (const c of [...dotSprites, ...angSprites]) c.width = c.height = 32;
  function buildSprites() {
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => {
      const v = cs.getPropertyValue(name).trim();
      return v ? cssColorToHex(v) : fallback;
    };
    palette.brand = read("--brand", palette.brand);
    palette.brandStrong = read("--brand-strong", palette.brandStrong);
    palette.foreground = read("--foreground", palette.foreground);
    palette.background = read("--background", palette.background);
    palette.muted = read("--muted", palette.muted);
    palette.core = mixHex(palette.foreground, palette.brand, 0.28);
    palette.falloff = mixHex(palette.brand, palette.background, 0.5);
    const colors = [palette.core, palette.brand, palette.falloff];
    colors.forEach((color, i) => {
      const g2 = dotSprites[i].getContext("2d")!;
      g2.clearRect(0, 0, 32, 32);
      const grad = g2.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, color);
      grad.addColorStop(0.35, color + "b0");
      grad.addColorStop(1, color + "00");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, 32, 32);
      const ga = angSprites[i].getContext("2d")!;
      ga.clearRect(0, 0, 32, 32);
      ga.fillStyle = color;
      ga.save();
      ga.translate(16, 16);
      ga.rotate(Math.PI / 4);
      ga.fillRect(-9, -9, 18, 18);
      ga.restore();
    });
  }
  buildSprites();
  const sprite = dotSprites[1];
  const spriteHi = dotSprites[0];
  const themeObserver = new MutationObserver(() => {
    buildSprites();
    if (reduced) stillDirty = true;
    wake();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* ---- canvases ---- */
  let vw = 0;
  let vh = 0;
  let dpr = 1;
  function sizeCanvases() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [back, front]) {
      c.width = Math.round(vw * dpr);
      c.height = Math.round(vh * dpr);
    }
  }
  sizeCanvases();

  /* ---- layout invalidation ---- */
  let layoutDirty = true;
  let stillDirty = true;
  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      sizeCanvases();
      sizeHash();
      layoutDirty = true;
      stillDirty = true;
      wake();
    }, 150);
  };
  window.addEventListener("resize", onResize);
  const ro = new ResizeObserver(() => {
    layoutDirty = true;
    wake();
  });
  ro.observe(document.body);

  /* ---- pointer ---- */
  const pointer = { x: -9999, y: -9999, vx: 0, vy: 0, active: false, enabled: !coarse && !reduced };
  let rawPX = -9999;
  let rawPY = -9999;
  const onPointerMove = (e: PointerEvent) => {
    rawPX = e.clientX;
    rawPY = e.clientY;
    if (!pointer.active) {
      pointer.x = rawPX;
      pointer.y = rawPY;
      pointer.active = true;
    }
    wake();
  };
  if (pointer.enabled) window.addEventListener("pointermove", onPointerMove, { passive: true });

  /* ---- pool (allocated once, after the first layout measure) ---- */
  let P = 0;
  let px!: Float32Array;
  let py!: Float32Array;
  let ppx!: Float32Array;
  let ppy!: Float32Array;
  let vx!: Float32Array;
  let vy!: Float32Array;
  let tx!: Float32Array;
  let ty!: Float32Array;
  let alpha!: Float32Array;
  let size!: Float32Array;
  let life!: Float32Array;
  let dying!: Uint8Array;
  let layer!: Uint8Array;
  let exempt!: Uint8Array;
  let fresh!: Uint8Array;
  let seedArr!: Float32Array;
  let freeList!: Int32Array;
  let freeTop = 0;

  const states: MoveState[] = movements.map((m) => ({
    m,
    slots: new Int32Array(0),
    slotCount: 0,
    desired: 0,
    presence: 0,
    wants: false,
    progress: 0,
    seamY: 0,
    regions: [],
    regionArea: 0,
  }));

  const memStore = new Map<string, Float32Array>();
  let quality = 1;
  let scrollYNow = 0;
  let time = 0;

  const hash = (i: number, salt = 0) => {
    const v = Math.sin(i * 127.1 + salt * 311.7 + (seedArr ? seedArr[i] : 0) * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };

  const ctx: MoveContext = {
    slots: new Int32Array(0),
    slotCount: 0,
    px: new Float32Array(0), py: new Float32Array(0), vx: new Float32Array(0), vy: new Float32Array(0),
    tx: new Float32Array(0), ty: new Float32Array(0), alpha: new Float32Array(0), size: new Float32Array(0),
    life: new Float32Array(0), layer: new Uint8Array(0), exempt: new Uint8Array(0), seed: new Float32Array(0),
    progress: 0,
    presence: 1,
    retiring: false,
    seamY: 0,
    dt: STEP,
    time: 0,
    scrollY: 0,
    scrollV: 0,
    vw, vh,
    reduced,
    gBack, gFront,
    pointer,
    palette,
    sprite, spriteHi,
    section: (id: string) => sectionRect(id, scrollYNow),
    target: (name: string) => targetRect(name, scrollYNow),
    mem: (key: string, fill = 0) => {
      let arr = memStore.get(key);
      if (!arr) {
        arr = new Float32Array(P);
        if (fill !== 0) arr.fill(fill);
        memStore.set(key, arr);
      }
      return arr;
    },
    param: <T,>(key: string) => params.get(key) as T | undefined,
    dom: (key: string) => domRegistry.get(key),
    rand: hash,
  };
  // `fresh` rides along outside the interface for movement spawn-init.
  (ctx as unknown as { fresh: Uint8Array }).fresh = new Uint8Array(0);

  function bindCtx(s: MoveState) {
    ctx.slots = s.slots;
    ctx.slotCount = s.slotCount;
    ctx.progress = s.progress;
    ctx.presence = s.presence;
    ctx.retiring = !s.wants;
    ctx.seamY = s.seamY;
    ctx.vw = vw;
    ctx.vh = vh;
    ctx.scrollY = scrollYNow;
    ctx.time = time;
  }

  function computeRegions(s: MoveState) {
    bindCtx(s);
    s.regions = s.m.regions(ctx);
    s.regionArea = s.regions.reduce((sum, r) => sum + Math.max(0, r.w) * Math.max(0, r.h), 0);
    const u = (s.m.unit ?? unit) / Math.max(0.25, quality);
    s.desired = s.regionArea > 0 ? Math.round(Math.min(s.m.maxCount ?? COUNT_MAX, Math.max(COUNT_MIN, s.regionArea / u))) : 0;
  }

  function allocatePool() {
    // Pool = the largest any single movement requires, measured now.
    scrollYNow = window.scrollY;
    for (const s of states) computeRegions(s);
    P = Math.max(256, ...states.map((s) => s.desired));
    px = new Float32Array(P); py = new Float32Array(P);
    ppx = new Float32Array(P); ppy = new Float32Array(P);
    vx = new Float32Array(P); vy = new Float32Array(P);
    tx = new Float32Array(P); ty = new Float32Array(P);
    alpha = new Float32Array(P); size = new Float32Array(P);
    life = new Float32Array(P);
    dying = new Uint8Array(P);
    layer = new Uint8Array(P);
    exempt = new Uint8Array(P);
    fresh = new Uint8Array(P);
    seedArr = new Float32Array(P);
    freeList = new Int32Array(P);
    dens = new Uint16Array(P);
    hNext = new Int32Array(P);
    let s0 = 987654321;
    const rnd = () => ((s0 = (s0 * 1103515245 + 12345) & 0x7fffffff), s0 / 0x7fffffff);
    for (let i = 0; i < P; i++) {
      seedArr[i] = rnd();
      freeList[i] = P - 1 - i;
      size[i] = 3;
    }
    freeTop = P;
    for (const s of states) s.slots = new Int32Array(P);
    ctx.px = px; ctx.py = py; ctx.vx = vx; ctx.vy = vy;
    ctx.tx = tx; ctx.ty = ty; ctx.alpha = alpha; ctx.size = size;
    ctx.life = life; ctx.layer = layer; ctx.exempt = exempt; ctx.seed = seedArr;
    (ctx as unknown as { fresh: Uint8Array }).fresh = fresh;
  }

  /* ---- lifecycle: wants, presence, spawn, retire ---- */

  function updateLifecycles(dt: number) {
    const center = scrollYNow + vh / 2;
    const margin = vh * OVERLAP_VH;

    for (const s of states) {
      const range = movementRange(s.m.sections);
      if (!range) {
        s.wants = false;
        continue;
      }
      const mid = (range.top + range.bottom) / 2;
      const visible = range.top - margin < scrollYNow + vh && range.bottom + margin > scrollYNow;
      const terminal = s.m.sections.includes("cta");
      // The terminal movement measures progress from the viewport BOTTOM so
      // it reaches exactly 1 at the end of the document (the glyph must
      // finish resolving at max scroll).
      s.progress = terminal
        ? Math.min(1, Math.max(0, (scrollYNow + vh - range.top) / Math.max(1, range.bottom - range.top)))
        : Math.min(1, Math.max(0, (center - range.top) / Math.max(1, range.bottom - range.top)));
      s.wants = visible && (terminal || s.progress < 0.92) && (terminal || s.progress > -0.02);
      // The seam: the side of the range nearest to where the viewer is.
      // Top seam sits just inside the range top; exit seam 15vh above the
      // range bottom, so it visually coincides with the neighbour's seam.
      s.seamY = center < mid ? range.top + vh * 0.02 : range.bottom - vh * SEAM_VH;

      // Presence envelope.
      const pTarget = s.wants ? 1 : 0;
      const rate = s.wants ? dt / 0.35 : dt / 0.45;
      s.presence += (pTarget - s.presence) * Math.min(1, rate * 3);
      if (!s.wants && s.presence < 0.02) s.presence = 0;

      computeRegions(s);

      if (s.wants) {
        // Spawn from the entry seam, a fraction of the deficit per frame.
        const deficit = s.desired - s.slotCount;
        if (deficit > 0 && freeTop > 0) {
          const n = Math.min(deficit, freeTop, Math.max(2, Math.ceil(s.desired * dt / 0.5)));
          const seamV = s.seamY - scrollYNow;
          for (let k = 0; k < n; k++) {
            const slot = freeList[--freeTop];
            s.slots[s.slotCount++] = slot;
            const rx = s.regions.length
              ? s.regions[Math.floor(hash(slot, 5) * s.regions.length)]
              : { x: 0, y: seamV, w: vw, h: 1 };
            px[slot] = rx.x + hash(slot, 6) * rx.w;
            // Clamp the seam into the region: column discipline holds even
            // during the relay (the fade carries the seam narrative).
            py[slot] = Math.min(Math.max(seamV, rx.y), rx.y + rx.h);
            // Reset the render-interpolation history: without this, the
            // first frames lerp from the slot's PREVIOUS owner's position,
            // streaking a spawn across the page (and across text).
            ppx[slot] = px[slot];
            ppy[slot] = py[slot];
            vx[slot] = 0;
            vy[slot] = 0;
            life[slot] = 0;
            dying[slot] = 0;
            layer[slot] = 0;
            exempt[slot] = 0;
            fresh[slot] = 1;
            tx[slot] = px[slot];
            ty[slot] = py[slot];
            alpha[slot] = 0;
          }
        } else if (s.slotCount > s.desired) {
          // Density shrank (resize): mark the surplus dying.
          for (let k = s.desired; k < s.slotCount; k++) dying[s.slots[k]] = 1;
        }
        // Life ramps.
        for (let k = 0; k < s.slotCount; k++) {
          const i = s.slots[k];
          if (dying[i]) {
            life[i] -= dt * 2.5;
          } else {
            life[i] = Math.min(1, life[i] + dt * (1.6 + seedArr[i] * 1.4));
          }
        }
      } else {
        // Retiring: life decays with per-particle stagger.
        for (let k = 0; k < s.slotCount; k++) {
          const i = s.slots[k];
          life[i] -= dt * (1.4 + seedArr[i] * 1.8);
        }
      }

      // Compact: release dead slots back to the free list.
      let w = 0;
      for (let k = 0; k < s.slotCount; k++) {
        const i = s.slots[k];
        if (life[i] <= 0 && (!s.wants || dying[i])) {
          life[i] = 0;
          dying[i] = 0;
          freeList[freeTop++] = i;
        } else {
          s.slots[w++] = s.slots[k];
        }
      }
      s.slotCount = w;
    }
  }

  /* ---- the fixed step ---- */

  function integrate(dt: number) {
    time += dt;
    if (pointer.active) {
      const nx = pointer.x + (rawPX - pointer.x) * 0.15;
      const ny = pointer.y + (rawPY - pointer.y) * 0.15;
      pointer.vx = (nx - pointer.x) / Math.max(dt, 1e-3);
      pointer.vy = (ny - pointer.y) / Math.max(dt, 1e-3);
      pointer.x = nx;
      pointer.y = ny;
    }

    updateLifecycles(dt);

    for (const s of states) {
      if (s.slotCount === 0) continue;
      bindCtx(s);
      ctx.dt = dt;
      s.m.step(ctx);
      s.slotCount = ctx.slotCount; // movements never change this, but keep honest

      // Seam retirement drift: the ink leaves toward the seam (movement's
      // own targets are overridden progressively as presence falls).
      if (!s.wants && (s.m.seamDrift ?? true)) {
        const seamV = s.seamY - scrollYNow;
        const f = 1 - s.presence;
        for (let k = 0; k < s.slotCount; k++) {
          const i = s.slots[k];
          const drift = Math.max(-26, Math.min(26, seamV - ty[i]));
          ty[i] = ty[i] + drift * f;
          alpha[i] *= s.presence;
        }
      } else if (!s.wants) {
        for (let k = 0; k < s.slotCount; k++) alpha[s.slots[k]] *= s.presence;
      }

      // Spring integration for this movement's slots (+ material jitter).
      const kSpring = (s.m as { stiffness?: number }).stiffness ?? 34;
      const damp = Math.exp(-((s.m as { damping?: number }).damping ?? 5.5) * dt);
      const jit = (s.m.material ?? DEFAULT_MATERIAL).jitter;
      for (let k = 0; k < s.slotCount; k++) {
        const i = s.slots[k];
        if (jit > 0) {
          vx[i] += (hash(i, (time * 31) | 0) - 0.5) * jit * dt;
          vy[i] += (hash(i, ((time * 31) | 0) + 7) - 0.5) * jit * dt;
        }
        vx[i] = (vx[i] + (tx[i] - px[i]) * kSpring * dt) * damp;
        vy[i] = (vy[i] + (ty[i] - py[i]) * kSpring * dt) * damp;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
      }
      if (s.m.constrain) {
        bindCtx(s);
        s.m.constrain(ctx);
      }
    }
  }

  /* ---- render: one material renderer, six parameterizations ----------
     Per movement: 40px spatial hash -> local density -> three-stop value
     ramp; neighbour links (1px, under the dots, capped at 3x particle
     count); dots as dot/streak/angular sprites. Keep-out is a DEV-ONLY
     assertion here: content protection is structural (column discipline),
     so a violation means a movement's bounds are wrong. ---- */

  const HCELL = 40;
  let hCols = 1;
  let hRows = 1;
  let hHead = new Int32Array(1);
  let hNext = new Int32Array(0);
  let dens!: Uint16Array;
  let frameNo = 0;
  const hist = new Uint32Array(96);
  const linkCounts = new Map<string, number>();
  let keepoutViolations = 0;
  const violByMovement = new Map<string, number>();
  let lastViolation: { id: string; x: number; y: number } | null = null;

  function sizeHash() {
    hCols = Math.max(1, Math.ceil(vw / HCELL));
    hRows = Math.max(1, Math.ceil(vh / HCELL));
    hHead = new Int32Array(hCols * hRows);
  }
  sizeHash();

  function render(interp: number) {
    frameNo++;
    gBack!.setTransform(dpr, 0, 0, dpr, 0, 0);
    gBack!.clearRect(0, 0, vw, vh);
    gFront!.setTransform(dpr, 0, 0, dpr, 0, 0);
    gFront!.clearRect(0, 0, vw, vh);
    const inv = 1 - interp;

    for (const s of states) {
      if (s.slotCount === 0) {
        if (s.m.draw && s.presence > 0.02) {
          bindCtx(s);
          s.m.draw(ctx);
        }
        continue;
      }
      const mat = s.m.material ?? DEFAULT_MATERIAL;
      const g = gBack!;
      g.globalCompositeOperation = mat.blend === "normal" ? "source-over" : "lighter";

      // Interpolated screen positions for this movement's slots.
      // (Written into tx/ty scratch? No: reuse local loop reads.)
      // Spatial hash rebuild (cheap) every frame; density scan every 4th.
      hHead.fill(-1);
      for (let k = 0; k < s.slotCount; k++) {
        const i = s.slots[k];
        if (alpha[i] * life[i] < 0.012) continue;
        const x = ppx[i] * inv + px[i] * interp;
        const y = ppy[i] * inv + py[i] * interp;
        if (x < -20 || y < -20 || x > vw + 20 || y > vh + 20) continue;
        const b = Math.min(hRows - 1, Math.max(0, Math.floor(y / HCELL))) * hCols + Math.min(hCols - 1, Math.max(0, Math.floor(x / HCELL)));
        hNext[i] = hHead[b];
        hHead[b] = i;
      }
      const refresh = frameNo % 4 === 1;
      let alive = 0;
      hist.fill(0);
      for (let k = 0; k < s.slotCount; k++) {
        const i = s.slots[k];
        if (alpha[i] * life[i] < 0.012) continue;
        alive++;
        if (refresh) {
          const x = ppx[i] * inv + px[i] * interp;
          const y = ppy[i] * inv + py[i] * interp;
          const bx = Math.floor(x / HCELL);
          const by = Math.floor(y / HCELL);
          let c = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const cx2 = bx + ox;
              const cy2 = by + oy;
              if (cx2 < 0 || cy2 < 0 || cx2 >= hCols || cy2 >= hRows) continue;
              for (let j = hHead[cy2 * hCols + cx2]; j >= 0; j = hNext[j]) c++;
            }
          }
          dens[i] = Math.min(65535, c);
        }
        hist[Math.min(95, dens[i])]++;
      }
      // Core threshold: the densest ~8% of the formation.
      let acc = 0;
      let coreT = 95;
      for (let k2 = 95; k2 >= 0; k2--) {
        acc += hist[k2];
        if (acc >= alive * 0.08) {
          coreT = Math.max(2, k2);
          break;
        }
      }
      const bodyT = Math.max(1, Math.round(coreT * 0.42));

      // Neighbour links: 1px lines beneath the dots, capped.
      if (mat.linkDistance > 0 && mat.maxLinks > 0) {
        const cap = s.slotCount * 3;
        let drawn = 0;
        g.lineWidth = 1;
        g.strokeStyle = palette.brand;
        g.globalAlpha = mat.linkAlpha;
        g.beginPath();
        const ld2 = mat.linkDistance * mat.linkDistance;
        for (let k = 0; k < s.slotCount && drawn < cap; k++) {
          const i = s.slots[k];
          const ai = alpha[i] * life[i];
          if (ai < 0.03) continue;
          const x = ppx[i] * inv + px[i] * interp;
          const y = ppy[i] * inv + py[i] * interp;
          if (x < -20 || y < -20 || x > vw + 20 || y > vh + 20) continue;
          const bx = Math.floor(x / HCELL);
          const by = Math.floor(y / HCELL);
          let linked = 0;
          for (let oy = -1; oy <= 1 && linked < mat.maxLinks; oy++) {
            for (let ox = -1; ox <= 1 && linked < mat.maxLinks; ox++) {
              const cx2 = bx + ox;
              const cy2 = by + oy;
              if (cx2 < 0 || cy2 < 0 || cx2 >= hCols || cy2 >= hRows) continue;
              for (let j = hHead[cy2 * hCols + cx2]; j >= 0 && linked < mat.maxLinks; j = hNext[j]) {
                if (j <= i || alpha[j] * life[j] < 0.03) continue;
                const jx = ppx[j] * inv + px[j] * interp;
                const jy = ppy[j] * inv + py[j] * interp;
                const dx = jx - x;
                const dy = jy - y;
                if (dx * dx + dy * dy > ld2) continue;
                g.moveTo(x, y);
                g.lineTo(jx, jy);
                linked++;
                drawn++;
              }
            }
          }
        }
        g.stroke();
        linkCounts.set(s.m.id, drawn);
      } else {
        linkCounts.set(s.m.id, 0);
      }

      // Dots, streaks, angular shards, on the three-stop value ramp.
      const packScale = 1 + mat.packing * 0.6;
      for (let k = 0; k < s.slotCount; k++) {
        const i = s.slots[k];
        const a = alpha[i] * life[i];
        if (a < 0.012) continue;
        const x = ppx[i] * inv + px[i] * interp;
        const y = ppy[i] * inv + py[i] * interp;
        const sz = size[i] * packScale;
        if (x < -sz || y < -sz || x > vw + sz || y > vh + sz) continue;
        if (process.env.NODE_ENV !== "production" && !exempt[i] && a > 0.06 && keepoutAlpha(x, y, scrollYNow) < 0.5) {
          keepoutViolations++;
          violByMovement.set(s.m.id, (violByMovement.get(s.m.id) ?? 0) + 1);
          lastViolation = { id: s.m.id, x: Math.round(x), y: Math.round(y + scrollYNow) };
          if (keepoutViolations % 400 === 1) {
            console.warn(`[ink] keep-out violation: movement "${s.m.id}" is rendering over text (fix its bounds)`, lastViolation);
          }
        }
        const d = dens[i];
        const stop = d >= coreT ? 0 : d >= bodyT ? 1 : 2;
        const set = mat.shape === "angular" ? angSprites : dotSprites;
        const spr = set[stop];
        const gl = layer[i] === 1 ? gFront! : g;
        gl.globalAlpha = Math.min(layer[i] === 1 ? 0.35 : 1, stop === 0 ? Math.min(1, a * 1.25) : stop === 1 ? a * 0.85 : a * 0.55);
        const rr = stop === 0 ? sz * 0.8 : stop === 1 ? sz : sz * 1.35;
        if (mat.shape === "streak" && mat.streakLength > 0) {
          const vxi = vx[i];
          const vyi = vy[i];
          const sp = Math.hypot(vxi, vyi) + 1e-3;
          const len = rr + mat.streakLength * Math.min(1, sp / 60);
          const cA = vxi / sp;
          const sA = vyi / sp;
          gl.setTransform(dpr * cA, dpr * sA, -dpr * sA, dpr * cA, x * dpr, y * dpr);
          gl.drawImage(spr, -len / 2, -rr / 2, len, rr);
          gl.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
          gl.drawImage(spr, x - rr / 2, y - rr / 2, rr, rr);
        }
      }

      if (s.m.draw) {
        bindCtx(s);
        s.m.draw(ctx);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    gFront!.globalAlpha = 1;
    gFront!.globalCompositeOperation = "source-over";
  }

  /* ---- reduced-motion / degraded stills ---- */

  const sectionToMovement = new Map<string, MoveState>();
  for (const s of states) for (const sec of s.m.sections) sectionToMovement.set(sec, s);

  let stillFor: string | null = null;
  let degradedToStill = false;

  function dominantSection(): string {
    const center = window.scrollY + vh / 2;
    const best = "hero";
    for (const s of states) {
      const range = movementRange(s.m.sections);
      if (range && center >= range.top && center < range.bottom) return s.m.sections[0];
    }
    // Silence sections: find by section rect.
    for (const id of ["features", "demo", "comparison", "pricing", "faq"]) {
      const r = sectionRect(id, window.scrollY);
      if (r && r.y <= vh / 2 && r.y + r.h > vh / 2) return id;
    }
    return best;
  }

  function composeStill(sectionId: string) {
    scrollYNow = window.scrollY;
    if (layoutDirty || !layoutReady()) {
      measureLayout();
      measureKeepout();
      layoutDirty = false;
    }
    if (P === 0) allocatePool();
    const s = sectionToMovement.get(sectionId);
    // Reset pool ownership.
    for (const st of states) st.slotCount = 0;
    freeTop = P;
    for (let i = 0; i < P; i++) freeList[i] = P - 1 - i;
    gBack!.setTransform(dpr, 0, 0, dpr, 0, 0);
    gBack!.clearRect(0, 0, vw, vh);
    gFront!.setTransform(dpr, 0, 0, dpr, 0, 0);
    gFront!.clearRect(0, 0, vw, vh);
    stillFor = sectionId;
    stillDirty = false;
    if (!s) return; // Silence: a clean canvas IS the still.
    computeRegions(s);
    const n = Math.min(s.desired, P);
    for (let k = 0; k < n; k++) {
      const slot = freeList[--freeTop];
      s.slots[s.slotCount++] = slot;
      const rx = s.regions.length ? s.regions[Math.floor(hash(slot, 5) * s.regions.length)] : { x: 0, y: 0, w: vw, h: vh };
      px[slot] = rx.x + hash(slot, 6) * rx.w;
      py[slot] = rx.y + hash(slot, 7) * rx.h;
      vx[slot] = 0; vy[slot] = 0;
      life[slot] = 1;
      fresh[slot] = 1;
      layer[slot] = 0;
      exempt[slot] = 0;
    }
    s.wants = true;
    s.presence = 1;
    const range = movementRange(s.m.sections);
    if (range) {
      const center = scrollYNow + vh / 2;
      s.progress = Math.min(1, Math.max(0, (center - range.top) / Math.max(1, range.bottom - range.top)));
    }
    for (let stepK = 0; stepK < 180; stepK++) {
      bindCtx(s);
      ctx.dt = STEP;
      ctx.time = time + stepK * STEP;
      s.m.step(ctx);
      const kSpring = (s.m as { stiffness?: number }).stiffness ?? 34;
      const damp = Math.exp(-((s.m as { damping?: number }).damping ?? 5.5) * STEP);
      for (let k = 0; k < s.slotCount; k++) {
        const i = s.slots[k];
        vx[i] = (vx[i] + (tx[i] - px[i]) * kSpring * STEP) * damp;
        vy[i] = (vy[i] + (ty[i] - py[i]) * kSpring * STEP) * damp;
        px[i] += vx[i] * STEP;
        py[i] += vy[i] * STEP;
      }
      if (s.m.constrain) s.m.constrain(ctx);
    }
    ppx.set(px);
    ppy.set(py);
    render(1);
  }

  let onReducedScroll: (() => void) | null = null;
  if (reduced) {
    const pick = () => {
      const id = dominantSection();
      if (id !== stillFor || stillDirty) composeStill(id);
    };
    measureLayout();
    measureKeepout();
    layoutDirty = false;
    allocatePool();
    pick();
    let t = 0;
    onReducedScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(pick, 120);
    };
    window.addEventListener("scroll", onReducedScroll, { passive: true });
  }

  /* ---- the live loop, riding the page's single rAF site ---- */

  let acc = 0;
  let unsub: (() => void) | null = null;
  const debugFrames: number[] = [];
  let sampleFrames: number[] = [];
  let sampling = true;

  if (!reduced) {
    unsub = subscribe((scroll, dt) => {
      if (document.visibilityState === "hidden") {
        acc = 0;
        return false;
      }
      if (degradedToStill) {
        const id = dominantSection();
        if (id !== stillFor || stillDirty) composeStill(id);
        return false;
      }
      const t0 = performance.now();
      const scrollDelta = scroll.scrollY - scrollYNow;
      scrollYNow = scroll.scrollY;
      ctx.scrollV = scroll.velocity;
      if (layoutDirty || !layoutReady()) {
        measureLayout();
        measureKeepout();
        layoutDirty = false;
      }
      if (P === 0) allocatePool();

      // Scroll compensation: particle physics runs in viewport space, so a
      // scroll step would otherwise read as every particle being dragged
      // through the page (and through text zones) toward its re-anchored
      // formation. Shifting held particles by the scroll delta makes them
      // effectively page-anchored; only genuine formation motion remains.
      if (scrollDelta !== 0) {
        for (const s of states) {
          for (let k = 0; k < s.slotCount; k++) {
            const i = s.slots[k];
            py[i] -= scrollDelta;
            ppy[i] -= scrollDelta;
          }
        }
      }

      acc += Math.min(dt, MAX_ACC);
      let stepped = false;
      while (acc >= STEP) {
        if (!stepped) {
          ppx.set(px);
          ppy.set(py);
          stepped = true;
        }
        integrate(STEP);
        acc -= STEP;
      }
      render(stepped ? acc / STEP : 1);

      const ms = performance.now() - t0;
      if (debugFrames.length >= 240) debugFrames.shift();
      debugFrames.push(ms);
      if (sampling) {
        sampleFrames.push(ms);
        if (sampleFrames.length >= 60) {
          const sorted = [...sampleFrames].sort((a, b) => a - b);
          const p75 = sorted[Math.floor(sorted.length * 0.75)];
          if (p75 > 20) {
            if (quality > 0.25) {
              quality = Math.max(0.25, quality / 2);
              sampleFrames = [];
            } else {
              degradedToStill = true;
              sampling = false;
            }
          } else {
            sampling = false;
          }
        }
      }

      // Park: nothing held anywhere (Silence) or the terminal movement is
      // settled, with scroll idle. A scroll or pointer event re-wakes.
      const held = states.reduce((sum, s) => sum + s.slotCount, 0);
      if (held === 0 && scroll.isIdle) return false;
      const active = states.filter((s) => s.slotCount > 0);
      if (active.length === 1 && active[0].m.settled) {
        bindCtx(active[0]);
        if (active[0].m.settled(ctx) && scroll.isIdle) return false;
      }
      return true;
    });
  }

  /* ---- debug hooks for the legibility harness ---- */
  (window as unknown as Record<string, unknown>).__uaaInkDebug = {
    particleCount: () => P,
    quality: () => quality,
    degraded: () => degradedToStill,
    stats: () => {
      const sorted = [...debugFrames].sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
      return { samples: sorted.length, p50: Math.round(q(0.5) * 100) / 100, p75: Math.round(q(0.75) * 100) / 100, p95: Math.round(q(0.95) * 100) / 100, particles: P, quality };
    },
    movements: () =>
      states.map((s) => {
        scrollYNow = window.scrollY;
        computeRegions(s);
        return {
          id: s.m.id,
          sections: s.m.sections,
          progress: Math.round(s.progress * 1000) / 1000,
          presence: Math.round(s.presence * 1000) / 1000,
          desired: s.desired,
          held: s.slotCount,
          regions: s.regions.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })),
        };
      }),
    keepout: () => keepoutRects(),
    links: () => Object.fromEntries(linkCounts),
    keepoutViolations: () => keepoutViolations,
    violations: () => ({ by: Object.fromEntries(violByMovement), last: lastViolation }),
  };

  return {
    destroy() {
      unsub?.();
      ro.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("resize", onResize);
      if (pointer.enabled) window.removeEventListener("pointermove", onPointerMove);
      if (onReducedScroll) window.removeEventListener("scroll", onReducedScroll);
      window.clearTimeout(resizeTimer);
      params.clear();
      domRegistry.clear();
      delete (window as unknown as Record<string, unknown>).__uaaInkDebug;
    },
  };
}
