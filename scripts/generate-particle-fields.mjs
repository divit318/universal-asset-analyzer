/**
 * generate-particle-fields.mjs — build-time generator for the landing page's
 * gold particle fields (app/landing/_components/primitives/particle-field.tsx).
 *
 * The reference designs carry dense raster renders of dot scatters along swept
 * curves. Reproducing them live (canvas/WebGL/DOM nodes) would wreck the
 * performance budget, so this script procedurally places dots along parametric
 * curves ONCE and emits static SVGs to public/landing/particles/.
 *
 * Encoding: dots are grouped into (radius x opacity) buckets, each bucket a
 * single <path> of "M x y v.01" micro-segments drawn with a round line cap —
 * ~13 bytes per dot instead of ~38 for a <circle>. Every asset stays well
 * under the 60KB budget.
 *
 * Deterministic: seeded mulberry32 PRNG, so re-running the script is a no-op
 * diff. Run: node scripts/generate-particle-fields.mjs
 */

import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "landing", "particles");
const BRASS = "#c8a96e";

/* ------------------------------ deterministic PRNG ------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Box–Muller for a soft gaussian spread around each curve. */
function gaussian(rand) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ------------------------------ SVG emission ------------------------------ */

const RADII = [0.6, 1.0, 1.5];
const ALPHAS = [0.16, 0.32, 0.6, 1.0];

function nearestIndex(value, options) {
  let best = 0;
  for (let i = 1; i < options.length; i++) {
    if (Math.abs(options[i] - value) < Math.abs(options[best] - value)) best = i;
  }
  return best;
}

/**
 * dots: [{x, y, r, a}] with r a target radius and a a target alpha in [0,1].
 * Buckets each dot to the nearest (radius, alpha) pair and emits one path per
 * non-empty bucket.
 */
function emitSvg(name, width, height, dots) {
  const buckets = new Map();
  for (const d of dots) {
    if (d.x < -2 || d.x > width + 2 || d.y < -2 || d.y > height + 2) continue;
    if (d.a < 0.04) continue;
    const key = `${nearestIndex(d.r, RADII)}:${nearestIndex(d.a, ALPHAS)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(`M${Math.round(d.x)} ${Math.round(d.y)}v.01`);
  }
  const paths = [...buckets.entries()]
    .sort()
    .map(([key, segs]) => {
      const [ri, ai] = key.split(":").map(Number);
      return `<path stroke-width="${RADII[ri] * 2}" stroke-opacity="${ALPHAS[ai]}" d="${segs.join("")}"/>`;
    })
    .join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none" stroke="${BRASS}" stroke-linecap="round">
${paths}
</svg>
`;
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${name}.svg`);
  writeFileSync(file, svg);
  const kb = statSync(file).size / 1024;
  console.log(`${name}.svg  ${kb.toFixed(1)}KB  (${dots.length} candidate dots, ${buckets.size} paths)`);
  if (kb > 60) throw new Error(`${name}.svg exceeds the 60KB budget`);
}

/* ------------------------------ variants ---------------------------------- */

/**
 * hero-wave — one wide sweeping wave (1600x520) with quiet room in the upper
 * half for the waypoint labels. Dots cluster in a gaussian band around a
 * composite sine curve; brightness rises toward five focal points (the
 * waypoint anchors) and fades toward both horizontal edges.
 */
function heroWave() {
  const rand = mulberry32(20260807);
  const W = 1600;
  const H = 520;
  const dots = [];
  const curveY = (t) => 330 + 70 * Math.sin(t * Math.PI * 1.6 - 0.9) + 34 * Math.sin(t * Math.PI * 3.4 + 1.2);
  // Five focal points, matching the waypoint x positions (fractions of width).
  const focals = [0.1, 0.3, 0.5, 0.7, 0.9];
  const N = 3400;
  for (let i = 0; i < N; i++) {
    const t = rand();
    const x = t * W;
    const spread = 26 + 34 * Math.abs(Math.sin(t * Math.PI * 2.2));
    const y = curveY(t) + gaussian(rand) * spread;
    // Edge fade + focal brightening.
    const edge = Math.min(1, Math.min(x, W - x) / 180);
    let focal = 0;
    for (const f of focals) focal = Math.max(focal, Math.exp(-(((t - f) * 14) ** 2)));
    const band = Math.exp(-(((y - curveY(t)) / spread) ** 2) / 2);
    const a = edge * (0.1 + 0.55 * band + 0.5 * focal * band);
    const r = 0.6 + rand() * (0.5 + focal * 0.9);
    dots.push({ x, y, r, a });
  }
  // A thin bright spine along the curve itself.
  for (let i = 0; i < 420; i++) {
    const t = i / 420;
    const x = t * W;
    const edge = Math.min(1, Math.min(x, W - x) / 180);
    dots.push({ x, y: curveY(t) + gaussian(rand) * 3, r: 0.9, a: edge * 0.8 });
  }
  emitSvg("hero-wave", W, H, dots);
}

/**
 * edge-pair — symmetric left and right accents (1400x600) for centered
 * sections: two arcs sweeping inward from the side edges, dense at the edge,
 * dissolving toward the middle so the section content stays clean.
 */
function edgePair() {
  const rand = mulberry32(41);
  const W = 1400;
  const H = 600;
  const dots = [];
  const N = 2100;
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < N; i++) {
      const t = rand(); // 0 at the edge, 1 toward centre
      const reach = 340;
      const xr = t * reach;
      const x = side === 0 ? xr : W - xr;
      const y = 300 + 190 * Math.sin(t * Math.PI * 1.15 + (side === 0 ? 0.3 : Math.PI - 0.3)) + gaussian(rand) * (16 + 44 * t);
      const a = (1 - t) ** 1.4 * (0.7 + 0.3 * rand());
      dots.push({ x, y, r: 0.6 + rand() * 0.9, a });
    }
  }
  emitSvg("edge-pair", W, H, dots);
}

/**
 * corner — a single lower-right corner accent (420x420) for cards: a quarter
 * arc hugging the corner, brightest at the corner, fading inward.
 */
function corner() {
  const rand = mulberry32(7);
  const W = 420;
  const H = 420;
  const dots = [];
  for (let i = 0; i < 1500; i++) {
    const theta = rand() * (Math.PI / 2); // sweep of the quarter
    const rad = 90 + rand() * 300;
    const x = W - Math.cos(theta) * rad + gaussian(rand) * 9;
    const y = H - Math.sin(theta) * rad + gaussian(rand) * 9;
    const nearness = 1 - Math.min(1, (rad - 90) / 300);
    const a = (0.25 + 0.85 * nearness) * (0.6 + 0.4 * rand());
    dots.push({ x, y, r: 0.6 + rand() * 0.8, a });
  }
  emitSvg("corner", W, H, dots);
}

/**
 * card-interior — a subtle full-bleed field (800x400) for inside a bordered
 * card: a low-amplitude drift of faint dots, slightly denser along a gentle
 * diagonal current, never bright enough to compete with copy.
 */
function cardInterior() {
  const rand = mulberry32(1859);
  const W = 800;
  const H = 400;
  const dots = [];
  for (let i = 0; i < 1500; i++) {
    const t = rand();
    const x = t * W;
    const drift = 210 + 90 * Math.sin(t * Math.PI * 1.3 + 0.4) - t * 60;
    const y = rand() < 0.6 ? drift + gaussian(rand) * 46 : rand() * H;
    const band = Math.exp(-(((y - drift) / 46) ** 2) / 2);
    const a = 0.1 + 0.45 * band * rand();
    dots.push({ x, y, r: 0.6 + rand() * 0.7, a });
  }
  emitSvg("card-interior", W, H, dots);
}

/**
 * streams — the Problem section's connecting currents (1200x360): horizontal
 * particle streams flowing across the card row, BRIGHTEST in the four gaps
 * between the five cards (card centres at 10/30/50/70/90% of width, gaps at
 * 20/40/60/80%). This layer carries the section's visual argument, so it is
 * markedly denser and brighter than the ambient fields.
 */
function streams() {
  const rand = mulberry32(515151);
  const W = 1200;
  const H = 360;
  const dots = [];
  const gaps = [0.2, 0.4, 0.6, 0.8];
  const lanes = [0.32, 0.5, 0.68];
  for (let i = 0; i < 2600; i++) {
    const t = rand();
    const x = t * W;
    const lane = lanes[Math.floor(rand() * lanes.length)];
    const y = lane * H + 26 * Math.sin(t * Math.PI * 3 + lane * 9) + gaussian(rand) * 14;
    let gapBoost = 0;
    for (const g of gaps) gapBoost = Math.max(gapBoost, Math.exp(-(((t - g) * 16) ** 2)));
    const edge = Math.min(1, Math.min(x, W - x) / 90);
    const a = edge * (0.1 + 0.85 * gapBoost) * (0.6 + 0.4 * rand());
    dots.push({ x, y, r: 0.6 + rand() * (0.7 + gapBoost * 0.8), a });
  }
  emitSvg("streams", W, H, dots);
}

// heroWave() retired: the hero illustration is now a live canvas
// (app/landing/_components/hero-flow.tsx), not a static asset.
void heroWave;
edgePair();
corner();
cardInterior();
streams();
console.log("Done →", OUT_DIR);
