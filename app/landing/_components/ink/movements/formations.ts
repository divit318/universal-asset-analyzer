/**
 * The six silhouettes as pure geometry, in LOCAL box coordinates (0..w,
 * 0..h). Shared by the movements and the dev-only ink lab, so the shapes
 * tuned in isolation are exactly the shapes that ship.
 *
 * Sections are differentiated by silhouette first: each function must
 * produce a formation that is nameable as a black-and-white thumbnail.
 */

export interface FPoint {
  x: number;
  y: number;
  /** Geometry's own alpha weight 0..1 (the value ramp multiplies later). */
  a: number;
  s: number;
}

const TAU = Math.PI * 2;

function hash2(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export function wrap01(t: number): number {
  return t - Math.floor(t);
}

/* --------------------------- II. The Five Shards -------------------------- */

/**
 * Five structurally different geometries, each holding its shape:
 *   0 sawtooth line · 1 text block · 2 lattice · 3 closed loop · 4 burst
 * u,v: stable per-particle randoms. time drives the subtle internal cycle.
 */
export function shardPoint(lane: number, u: number, v: number, time: number, w: number, h: number, out: FPoint): void {
  const cx = w / 2;
  const cy = h / 2;
  if (lane === 0) {
    // A jagged sawtooth line: high frequency, sharp reversals. A ticker.
    const teeth = 7;
    const ph = wrap01(u * teeth + time * 0.12);
    const tri = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
    out.x = u * w;
    out.y = cy + tri * h * 0.42 + (v - 0.5) * 3 + Math.sin(time * 3 + u * 30) * 1.5;
    out.a = 1;
    out.s = 3.6;
    return;
  }
  if (lane === 1) {
    // A page of dense justified text: rows with ragged internal gaps.
    const rows = 7;
    const row = Math.floor(u * rows);
    const cells = Math.floor(w / 6);
    const cell = Math.floor(v * cells);
    const gap = hash2(row * 31 + Math.floor(cell / 4), 7) < 0.24; // word gaps
    const shift = (Math.floor(time * 0.5 + row * 1.7) % 5 === 0 ? time * 6 : 0) % 6;
    out.x = 3 + ((cell * 6 + shift) % (w - 6));
    out.y = (row + 0.5) * (h / rows) + (hash2(row, cell) - 0.5) * 2;
    out.a = gap ? 0 : 1;
    out.s = 3.8;
    return;
  }
  if (lane === 2) {
    // A strict orthogonal lattice: intersections and grid edges only.
    const cols = 8;
    const rows = 4;
    if (v < 0.34) {
      // Intersections: brighter, bigger.
      const k = Math.floor(u * (cols + 1) * (rows + 1));
      out.x = (k % (cols + 1)) * (w / cols);
      out.y = Math.floor(k / (cols + 1)) * (h / rows);
      out.a = 1;
      out.s = 4.8;
    } else if (v < 0.67) {
      // Horizontal edges.
      const row = Math.floor(u * (rows + 1));
      out.x = wrap01(u * 13 + time * 0.02) * w;
      out.y = row * (h / rows);
      out.a = 0.85;
      out.s = 3.2;
    } else {
      // Vertical edges.
      const col = Math.floor(u * (cols + 1));
      out.x = col * (w / cols);
      out.y = wrap01(u * 17 + time * 0.02) * h;
      out.a = 0.85;
      out.s = 3.2;
    }
    return;
  }
  if (lane === 3) {
    // A smooth closed figure-eight turning back on itself: a circuit going
    // nowhere, endlessly.
    const th = u * TAU + time * 0.24;
    out.x = cx + Math.sin(th) * w * 0.44 + (v - 0.5) * 4;
    out.y = cy + Math.sin(2 * th + 0.4) * h * 0.4 + (hash2(u * 99, 3) - 0.5) * 4;
    out.a = 1;
    out.s = 3.6;
    return;
  }
  // A dispersing burst with no centre of mass: quantized rays thrown
  // outward at varied speeds, dying at the rim.
  const ray = Math.floor(u * 22) / 22;
  const ang = ray * TAU + (u - ray) * 0.5;
  const speed = 0.25 + v * 0.75;
  const rad = wrap01(v * 7 + time * 0.16 * speed);
  const r = Math.pow(rad, 0.6);
  out.x = cx + Math.cos(ang) * r * w * 0.5;
  out.y = cy + Math.sin(ang) * r * h * 0.5;
  out.a = r < 0.16 ? (r / 0.16) * 0.4 : 1 * (1 - rad * 0.65);
  out.s = 3.2 + v * 2.2;
}

/* ---------------------------- III. The Streams ---------------------------- */

/**
 * Five converging streams: one origin lane per source on the left edge,
 * loose and scattered there, tightening and brightening rightward until
 * all five land at a single apex on the right edge (the product panel's
 * port). The visual argument is order emerging from scatter.
 * lane: 0..4; u: 0..1 along the stream; v/v2: stable lateral and
 * longitudinal randoms; apexY: convergence height in the local box.
 */
export function streamPoint(
  lane: number,
  u: number,
  v: number,
  v2: number,
  time: number,
  w: number,
  h: number,
  apexY: number,
  out: FPoint,
): void {
  const laneY = (lane + 0.5) * (h / 5);
  const merge = Math.pow(u, 1.7); // hold the lane early, converge late
  const bow = Math.sin(Math.PI * u) * (laneY - apexY) * 0.1;
  const spread = Math.pow(1 - u, 1.4) * h * 0.05 + 1.2;
  const wiggle = Math.sin(time * 0.7 + lane * 2.1 + u * 11) * (1 - u) * 2;
  out.x = u * w + (v2 - 0.5) * spread;
  out.y = laneY + (apexY - laneY) * merge + bow + (v - 0.5) * 2 * spread + wiggle;
  out.a = 0.42 + 0.58 * Math.pow(u, 1.6);
  out.s = 2.5 + Math.pow(u, 1.6) * 1.6;
}

/* ------------------------------ IV. The Pinch ----------------------------- */

/**
 * The hourglass. side -1 (left, escapes through) or +1 (right,
 * recirculates). u: 0..1 phase along the particle's path; lat: -1..1 lane.
 * Returns positions in the band box; alpha encodes the dissolve.
 */
export function pinchPoint(
  side: number,
  u: number,
  lat: number,
  w: number,
  h: number,
  out: FPoint,
): void {
  const cx = w / 2;
  const cy = h / 2;
  if (side < 0) {
    // LEFT: converge to the pinch, pass THROUGH, thin out, dissolve.
    if (u < 0.62) {
      const k = u / 0.62; // inbound
      const spread = Math.pow(1 - k, 1.25);
      out.x = k * cx;
      out.y = cy + lat * h * 0.46 * spread;
      out.a = 0.55 + 0.35 * k;
      out.s = 2.8 + (1 - spread) * 1.6;
    } else {
      const k = (u - 0.62) / 0.38; // escaped past the centre line
      out.x = cx + k * w * 0.22;
      out.y = cy + lat * h * 0.1 * k;
      out.a = 0.9 * (1 - k);
      out.s = 2.6;
    }
    return;
  }
  // RIGHT: converge to the pinch and RECIRCULATE. A closed circulation
  // cell: inbound along the outer half, return along the inner half.
  // Nothing crosses the centre line.
  const th = u * TAU;
  const inb = (1 - Math.cos(th)) / 2; // 0 at right edge, 1 at pinch
  const spread = Math.pow(1 - inb, 1.15);
  const retLobe = Math.sin(th); // +1 outbound leg, -1 inbound leg
  out.x = cx + 6 + (1 - inb) * (w / 2 - 10);
  out.y = cy + lat * h * 0.46 * spread + retLobe * h * 0.07 * (1 - spread) * Math.sign(lat);
  out.a = 0.6 + 0.3 * inb;
  out.s = 2.8 + inb * 1.4;
}

/* ------------------------------- VI. The Well ----------------------------- */

/** Held surface profiles for the three ticker chips (0..1 x, 0..1 depth). */
export const WELL_PROFILES: Record<string, number[]> = {
  NVDA: [0.9, 0.82, 0.85, 0.7, 0.62, 0.5, 0.42, 0.3, 0.24, 0.1, 0.05],
  AAPL: [0.6, 0.52, 0.58, 0.45, 0.5, 0.4, 0.45, 0.35, 0.4, 0.3, 0.32],
  MSFT: [0.75, 0.7, 0.6, 0.62, 0.52, 0.55, 0.45, 0.4, 0.35, 0.28, 0.2],
};

export function wellProfileAt(profile: number[], x01: number): number {
  const f = Math.min(0.999, Math.max(0, x01)) * (profile.length - 1);
  const i = Math.floor(f);
  return profile[i] + (profile[i + 1] - profile[i]) * (f - i);
}
