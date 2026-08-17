"use client";

import { subscribe, wake, prefersReducedMotion } from "../motion/engine";
import { drawPlate, keepFactor, type KeepRect, type MeridianPalette } from "./plate";
import {
  computeGeometry,
  deriveStations,
  limbPoint,
  stationPoint,
  type MeridianGeometry,
  type SeriesLike,
  type Station,
} from "./stations";

/**
 * The Meridian field — the hero's live layer, and the page's one ambient
 * privilege. The scene is an act of resolution driven by the pinned
 * scroll:
 *
 *   noise      — gold dust drifts in the sky band above the engraved limb,
 *   structure  — as the visitor scrolls, stations (year-samples of the
 *                committed series) activate in calendar order; nearby dust
 *                is CAPTURED and spirals home; hairlines draw between
 *                consecutive years,
 *   record     — at the top of the act the final year resolves as the
 *                verdict star (white-gold core, fine ring) and the
 *                instrument raises its measurement ray from the limb.
 *
 * Scroll IS the computation. Nothing bounces; captures are critically
 * damped springs (machined, monotonic); dust drift is a slow curl field.
 *
 * Rendering: ONE DOM canvas. The static engraving (plate.ts) lives on an
 * offscreen canvas composited per frame, so the per-frame cost is dust +
 * constellation only. Rides the page's single rAF loop (motion/engine),
 * parks when the hero leaves the viewport or the tab hides, and under
 * prefers-reduced-motion renders the FINAL resolved frame exactly once.
 */

const DUST_AREA_PER = 1250; // px² of sky per particle (desktop)
const DUST_MIN = 180;
const DUST_MAX = 1150;
const CAPTURE_R = 96;
const SPRING_K = 26;

interface FieldOpts {
  section: HTMLElement;
  series: SeriesLike;
  monoFamily: string;
}

declare global {
  interface Window {
    __uaaMeridianDebug?: {
      progress(): number;
      stations(): { active: number; total: number };
      dust(): number;
      /** Verdict star position in canvas/viewport px (for harness sampling). */
      verdict(): { x: number; y: number };
      /** Frame-time distribution: samples + p75 ms. 0 samples under reduced motion. */
      stats(): { samples: number; p75: number };
    };
  }
}

function readPalette(): MeridianPalette {
  const cs = getComputedStyle(document.documentElement);
  const token = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const ink = token("--brand", isLight ? "#7a5f33" : "#c8a96e");
  const inkStrong = token("--brand-strong", isLight ? "#5f4a26" : "#e2c489");
  return {
    isLight,
    ink,
    inkStrong,
    core: isLight ? "#3a2e18" : "#f4e7cb",
    falloff: isLight ? "#a68d5e" : "#6b5a3c",
  };
}

/** Soft round sprite (dust) or machined diamond (station core). */
function makeSprite(color: string, kind: "dot" | "diamond", sharp = 0.32): HTMLCanvasElement {
  const S = 48;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  if (kind === "dot") {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, color);
    grad.addColorStop(sharp, color);
    grad.addColorStop(1, "transparent");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  } else {
    g.translate(S / 2, S / 2);
    g.rotate(Math.PI / 4);
    g.fillStyle = color;
    const r = S * 0.3;
    g.fillRect(-r, -r, r * 2, r * 2);
  }
  return c;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

export function createMeridianField(canvas: HTMLCanvasElement, opts: FieldOpts): { destroy(): void } {
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) return { destroy() {} };
  const g = ctx2d; // non-null from here on, incl. inside closures
  const { section, series, monoFamily } = opts;

  const stations: Station[] = deriveStations(series);
  const N = stations.length;

  let geo: MeridianGeometry = computeGeometry(1, 1, false);
  let palette = readPalette();
  let keepRects: KeepRect[] = [];
  let dpr = 1;
  let compact = false;
  const plate = document.createElement("canvas");

  // Sprites per palette: dust ramp (core / body / falloff), station diamond,
  // halo, and the large soft mote for the near depth band.
  let sprites: Record<string, HTMLCanvasElement> = {};
  function buildSprites() {
    sprites = {
      core: makeSprite(palette.core, "dot", 0.5),
      body: makeSprite(palette.ink, "dot", 0.34),
      fall: makeSprite(palette.falloff, "dot", 0.3),
      mote: makeSprite(palette.isLight ? palette.falloff : palette.ink, "dot", 0.06),
      diamond: makeSprite(palette.core, "diamond"),
      halo: makeSprite(palette.ink, "dot", 0.04),
    };
  }

  /* -------------------------------- dust -------------------------------- */

  let count = 0;
  let px = new Float32Array(0);
  let py = new Float32Array(0);
  let vx = new Float32Array(0);
  let vy = new Float32Array(0);
  let band = new Uint8Array(0); // 0 far / 1 mid / 2 near-mote
  let ph = new Float32Array(0); // twinkle phase
  let st8 = new Uint8Array(0); // 0 free / 1 captured
  let target = new Int16Array(0);

  let seed = 20070917; // the series' own start date
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

  function limbYAt(x: number): number {
    const phi = Math.asin(Math.max(-1, Math.min(1, (x - geo.cx) / geo.R)));
    return limbPoint(geo, phi).y;
  }

  /** Spawn in the sky band: density gathers toward the limb (the reference
   *  plates' horizon glow), thins toward the zenith. Near motes roam free. */
  function spawn(i: number, anywhere = false) {
    const nearMote = band[i] === 2;
    px[i] = rnd() * geo.w;
    if (nearMote) {
      py[i] = rnd() * geo.h;
    } else {
      const ly = limbYAt(px[i]);
      const depth = Math.pow(rnd(), 0.55); // 0 at limb, 1 at zenith
      py[i] = anywhere ? ly * (1 - depth) : Math.min(ly - 2, ly - depth * (ly + geo.h * 0.05));
      py[i] = Math.max(-geo.h * 0.04, ly - depth * (ly + geo.h * 0.04));
    }
    vx[i] = 0;
    vy[i] = 0;
    ph[i] = rnd() * Math.PI * 2;
    st8[i] = 0;
    target[i] = -1;
  }

  function allocDust() {
    // Sky area ≈ width × mean limb height above it.
    const skyArea = geo.w * ((limbYAt(geo.w * 0.1) + limbYAt(geo.w * 0.5) + limbYAt(geo.w * 0.9)) / 3);
    const unit = compact ? DUST_AREA_PER * 1.7 : DUST_AREA_PER;
    count = Math.max(DUST_MIN, Math.min(DUST_MAX, Math.round(skyArea / unit)));
    px = new Float32Array(count);
    py = new Float32Array(count);
    vx = new Float32Array(count);
    vy = new Float32Array(count);
    band = new Uint8Array(count);
    ph = new Float32Array(count);
    st8 = new Uint8Array(count);
    target = new Int16Array(count);
    for (let i = 0; i < count; i++) {
      band[i] = rnd() < 0.08 ? 2 : rnd() < 0.62 ? 0 : 1;
      spawn(i, true);
    }
  }

  /* ------------------------------ measure ------------------------------- */

  let sectionTop = 0;
  let sectionH = 1;
  let vh = 1;

  function measure() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    compact = rect.width < 768 || window.matchMedia("(pointer: coarse)").matches;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    geo = computeGeometry(rect.width, rect.height, compact);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    vh = window.innerHeight;
    const sr = section.getBoundingClientRect();
    sectionTop = sr.top + window.scrollY;
    sectionH = sr.height;
    // Keep-out: every marked text block, measured in canvas space (the
    // canvas fills the sticky viewport, so this holds at any scroll).
    keepRects = Array.from(section.querySelectorAll<HTMLElement>("[data-mk-keepout]")).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height };
    });
    buildSprites();
    drawPlate(plate, geo, palette, keepRects, dpr, monoFamily, compact);
    allocDust();
    wake();
  }

  /* ------------------------------- the act ------------------------------ */

  const reduced = prefersReducedMotion();
  const mountAt = performance.now();
  let parked = false;
  let time = 0;

  function progress(): number {
    if (reduced) return 1;
    const denom = Math.max(1, sectionH - vh);
    return clamp01((window.scrollY - sectionTop) / denom);
  }

  /** Station activation: calendar order across the heart of the act. */
  function activation(k: number, p: number): number {
    const th = 0.05 + 0.7 * (k / (N - 1));
    return smooth((p - th) / 0.055);
  }

  function step(dt: number, p: number) {
    time += dt;
    const t = time * 0.45;
    for (let i = 0; i < count; i++) {
      if (st8[i] === 1) {
        // Captured: critically damped spring home — machined, no orbiting.
        const s = stations[target[i]];
        const q = stationPoint(geo, s, compact);
        const ax = (q.x - px[i]) * SPRING_K - vx[i] * 2 * Math.sqrt(SPRING_K);
        const ay = (q.y - py[i]) * SPRING_K - vy[i] * 2 * Math.sqrt(SPRING_K);
        vx[i] += ax * dt;
        vy[i] += ay * dt;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        if (Math.hypot(q.x - px[i], q.y - py[i]) < 2.2) spawn(i); // absorbed
        continue;
      }
      // Free drift: slow curl-ish field with a faint up-right prevailing wind.
      const nx = px[i] * 0.0021;
      const ny = py[i] * 0.0024;
      const ang =
        Math.sin(nx * 1.7 + t * 0.35) + Math.cos(ny * 2.3 - t * 0.28) + 0.6 * Math.sin((nx + ny) * 1.1 + t * 0.18);
      const speed = band[i] === 2 ? 3.5 : band[i] === 1 ? 9 : 6;
      vx[i] = Math.cos(ang) * speed + 2.4;
      vy[i] = Math.sin(ang) * speed * 0.6 - 1.2;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      // Leaving the plate: re-enter the sky.
      if (px[i] < -20 || px[i] > geo.w + 20 || py[i] < -30 || (band[i] !== 2 && py[i] > limbYAt(px[i]) + 30) || py[i] > geo.h + 30) {
        spawn(i);
        continue;
      }
      // Capture: an activating station recruits nearby free dust.
      if (band[i] !== 2 && (i & 3) === 0) {
        for (let k = 0; k < N; k++) {
          const a = activation(k, p);
          if (a <= 0.02 || a >= 0.98) continue;
          const q = stationPoint(geo, stations[k], compact);
          if (Math.abs(q.x - px[i]) < CAPTURE_R && Math.abs(q.y - py[i]) < CAPTURE_R) {
            st8[i] = 1;
            target[i] = k;
            break;
          }
        }
      }
    }
  }

  function render(p: number) {
    const w = geo.w;
    const h = geo.h;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // Arrival: the plate breathes in over the first moments of the visit.
    const arrive = reduced ? 1 : smooth((performance.now() - mountAt) / 1400);
    // Release: as the act completes, the whole plate recedes a breath.
    const release = smooth((p - 0.9) / 0.1);
    const scale = 1 - 0.03 * release;
    g.translate(w / 2, h * 0.42);
    g.scale(scale, scale);
    g.translate(-w / 2, -h * 0.42);
    g.globalAlpha = arrive * (1 - 0.12 * release);

    // 1 · the engraving (offscreen plate, one blit).
    g.drawImage(plate, 0, 0, w, h);

    const additive = !palette.isLight;
    const parY = (p - 0.5) * -10; // constellation layer drifts with the act

    // 2 · dust (far + mid), additive light in the dark theme, ink in light.
    if (additive) g.globalCompositeOperation = "lighter";
    const baseA = palette.isLight ? 0.36 : 0.58;
    for (let i = 0; i < count; i++) {
      if (band[i] === 2) continue;
      const far = band[i] === 0;
      const tw = reduced ? 0.85 : 0.72 + 0.28 * Math.sin(time * (far ? 0.9 : 1.3) + ph[i]);
      const kf = keepFactor(keepRects, px[i], py[i]);
      const a = arrive * baseA * (far ? 0.55 : 0.9) * tw * kf * (st8[i] ? 1.25 : 1);
      if (a < 0.015) continue;
      const size = far ? 2 : 3;
      const spr = st8[i] ? sprites.core : far ? sprites.fall : sprites.body;
      g.globalAlpha = Math.min(1, a);
      g.drawImage(spr, px[i] - size / 2, py[i] + (far ? parY * 0.4 : parY * 0.7) - size / 2, size, size);
    }
    g.globalCompositeOperation = "source-over";

    // 3 · the record: links between consecutive activated years.
    g.lineWidth = 1;
    for (let k = 1; k < N; k++) {
      const a = activation(k, p);
      if (a <= 0.01) continue;
      const q0 = stationPoint(geo, stations[k - 1], compact);
      const q1 = stationPoint(geo, stations[k], compact);
      const ex = q0.x + (q1.x - q0.x) * a;
      const ey = q0.y + (q1.y - q0.y) * a + parY;
      const kf = keepFactor(keepRects, (q0.x + ex) / 2, (q0.y + parY + ey) / 2);
      g.globalAlpha = arrive * 0.34 * kf * Math.min(1, activation(k - 1, p) * 2);
      g.strokeStyle = palette.ink;
      g.beginPath();
      g.moveTo(q0.x, q0.y + parY);
      g.lineTo(ex, ey);
      g.stroke();
    }

    // 4 · the measurement ray: the instrument takes the verdict's altitude.
    const verdict = stationPoint(geo, stations[N - 1], compact);
    const rayT = smooth((p - 0.84) / 0.09);
    if (rayT > 0.01) {
      const phiV = Math.asin(Math.max(-1, Math.min(1, (verdict.x - geo.cx) / geo.R)));
      const foot = limbPoint(geo, phiV);
      g.globalAlpha = arrive * 0.3 * rayT;
      g.strokeStyle = palette.inkStrong;
      g.beginPath();
      g.moveTo(foot.x, foot.y);
      g.lineTo(foot.x + (verdict.x - foot.x) * rayT, foot.y + (verdict.y + parY - foot.y) * rayT);
      g.stroke();
      // Foot tick across the limb, a reading being taken.
      g.globalAlpha = arrive * 0.5 * rayT;
      g.beginPath();
      g.moveTo(foot.x - 7, foot.y + 4);
      g.lineTo(foot.x + 7, foot.y - 4);
      g.stroke();
    }

    // 5 · stations: machined diamonds, light earned by activation.
    if (additive) g.globalCompositeOperation = "lighter";
    for (let k = 0; k < N; k++) {
      const a = activation(k, p);
      if (a <= 0.01) continue;
      const q = stationPoint(geo, stations[k], compact);
      const y = q.y + parY;
      const kf = keepFactor(keepRects, q.x, y);
      const isVerdict = k === N - 1;
      const tw = reduced ? 1 : 0.93 + 0.07 * Math.sin(time * 1.1 + k * 1.7);
      const size = (isVerdict ? 7.5 : 4.2 + 1.6 * stations[k].v) * (0.6 + 0.4 * a);
      const halo = size * (isVerdict ? 7 : 4.5);
      g.globalAlpha = arrive * 0.16 * a * kf;
      g.drawImage(sprites.halo, q.x - halo / 2, y - halo / 2, halo, halo);
      g.globalAlpha = arrive * (palette.isLight ? 0.8 : 0.92) * a * tw * kf;
      g.drawImage(sprites.diamond, q.x - size / 2, y - size / 2, size, size);
      if (isVerdict && rayT > 0.35) {
        // The verdict ring: one fine circle, drawn once, no pulsing.
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = arrive * 0.55 * smooth((rayT - 0.35) / 0.5) * kf;
        g.strokeStyle = palette.inkStrong;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(q.x, y, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * smooth((rayT - 0.35) / 0.55));
        g.stroke();
        if (additive) g.globalCompositeOperation = "lighter";
      }
    }
    g.globalCompositeOperation = "source-over";

    // 6 · year labels for the catalogue years.
    g.font = `500 9.5px ${monoFamily}`;
    g.textAlign = "left";
    g.fillStyle = palette.isLight ? palette.inkStrong : palette.ink;
    for (let k = 0; k < N; k++) {
      const s = stations[k];
      if (!s.labeled) continue;
      const a = activation(k, p);
      if (a <= 0.5) continue;
      const q = stationPoint(geo, s, compact);
      const y = q.y + parY;
      g.globalAlpha = arrive * 0.62 * smooth((a - 0.5) / 0.4) * keepFactor(keepRects, q.x + 14, y + 12);
      g.fillText(String(s.year), q.x + 9, y + 13);
    }

    // 7 · near motes: sparse, large, soft — the depth layer nearest the eye.
    if (additive) g.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i++) {
      if (band[i] !== 2) continue;
      const tw = reduced ? 0.8 : 0.65 + 0.35 * Math.sin(time * 0.7 + ph[i]);
      const a = arrive * (palette.isLight ? 0.1 : 0.13) * tw * keepFactor(keepRects, px[i], py[i]);
      if (a < 0.012) continue;
      const size = 26;
      g.globalAlpha = a;
      g.drawImage(sprites.mote, px[i] - size / 2, py[i] + parY * 1.6 - size / 2, size, size);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }

  /* ----------------------------- lifecycle ------------------------------ */

  let last = -1;
  const frameMs: number[] = [];
  let frameIdx = 0;
  const unsubscribe = reduced
    ? null
    : subscribe((state, dt) => {
        if (parked || document.visibilityState === "hidden") return false;
        const t0 = performance.now();
        const p = progress();
        step(Math.min(dt, 1 / 30), p);
        render(p);
        last = p;
        const cost = performance.now() - t0;
        if (frameMs.length < 240) frameMs.push(cost);
        else frameMs[frameIdx++ % 240] = cost;
        // Ambient privilege: the plate stays alive while on screen so the
        // dust drifts and the stars breathe. Parked the moment it leaves.
        return true;
      });

  const io = new IntersectionObserver(
    (entries) => {
      parked = !entries.some((e) => e.isIntersecting);
      if (!parked) wake();
    },
    { threshold: 0.02 },
  );
  io.observe(section);

  const ro = new ResizeObserver(() => {
    measure();
    if (reduced) render(1);
  });
  ro.observe(canvas);

  const mo = new MutationObserver(() => {
    palette = readPalette();
    buildSprites();
    drawPlate(plate, geo, palette, keepRects, dpr, monoFamily, compact);
    if (reduced) render(1);
    wake();
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Webfont arrival shifts the text blocks the keep-out protects.
  document.fonts?.ready.then(() => {
    measure();
    if (reduced) render(1);
  });

  measure();
  if (reduced) {
    // The contract: the final state, instantly, exactly once per layout.
    render(1);
  }

  window.__uaaMeridianDebug = {
    progress: () => (last < 0 ? progress() : last),
    stations: () => ({
      active: stations.reduce((n, _, k) => n + (activation(k, progress()) > 0.5 ? 1 : 0), 0),
      total: N,
    }),
    dust: () => count,
    // The RENDERED star position: the release recede (scale about w/2,
    // 0.42h) and the constellation's parallax drift are applied, so a
    // harness sampling pixels finds the star exactly where we say it is.
    verdict: () => {
      const p = reduced ? 1 : progress();
      const release = smooth((p - 0.9) / 0.1);
      const s = 1 - 0.03 * release;
      const q = stationPoint(geo, stations[N - 1], compact);
      const y = q.y + (p - 0.5) * -10;
      return { x: geo.w / 2 + (q.x - geo.w / 2) * s, y: geo.h * 0.42 + (y - geo.h * 0.42) * s };
    },
    stats: () => {
      const sorted = [...frameMs].sort((a, b) => a - b);
      return { samples: frameMs.length, p75: sorted.length ? Number(sorted[Math.floor(sorted.length * 0.75)].toFixed(2)) : 0 };
    },
  };

  return {
    destroy() {
      unsubscribe?.();
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      delete window.__uaaMeridianDebug;
    },
  };
}
