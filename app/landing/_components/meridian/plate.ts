/**
 * The engraved plate — everything on the Meridian that never moves.
 *
 * Drawn ONCE per size/theme change into an offscreen canvas the live field
 * composites each frame, so per-frame cost is a single drawImage. The
 * engraving language is banknote ruling, not decoration: a main limb with
 * two companion hairlines, graduation ticks pointing into the void below,
 * and sparse degree numerals. All of it fades under the page's text
 * blocks (the same keep-out falloff the dust obeys) so the instrument
 * passes BEHIND the words, never through them.
 */

import { limbPoint, type MeridianGeometry } from "./stations";

export interface MeridianPalette {
  /** True when the light theme is active: ink on paper, no additive light. */
  isLight: boolean;
  ink: string; // brass body (dark) / bronze ink (light)
  inkStrong: string; // champagne (dark) / deep bronze (light)
  core: string; // white-gold particle core (dark) / near-black ink (light)
  falloff: string; // deep amber shadow tone
}

export interface KeepRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Distance-based alpha falloff around the page's text: 0 at the words,
 *  1 in open space. Shared by plate engraving, dust, links and labels. */
export function keepFactor(rects: KeepRect[], x: number, y: number, pad = 26, feather = 88): number {
  let f = 1;
  for (const r of rects) {
    const dx = Math.max(r.x - pad - x, 0, x - (r.x + r.w + pad));
    const dy = Math.max(r.y - pad - y, 0, y - (r.y + r.h + pad));
    const d = Math.hypot(dx, dy);
    const t = d >= feather ? 1 : d / feather;
    const local = 0.04 + 0.96 * t * t * (3 - 2 * t);
    if (local < f) f = local;
  }
  return f;
}

function arcSegments(
  g: CanvasRenderingContext2D,
  geo: MeridianGeometry,
  alt: number,
  alpha: number,
  width: number,
  color: string,
  rects: KeepRect[],
  span: [number, number] = [0, 1],
) {
  const steps = 240;
  const a0 = geo.phi0 + (geo.phi1 - geo.phi0) * span[0];
  const a1 = geo.phi0 + (geo.phi1 - geo.phi0) * span[1];
  g.strokeStyle = color;
  g.lineWidth = width;
  let prev = limbPoint(geo, a0, alt);
  for (let i = 1; i <= steps; i++) {
    const phi = a0 + ((a1 - a0) * i) / steps;
    const p = limbPoint(geo, phi, alt);
    const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
    const a = alpha * keepFactor(rects, mid.x, mid.y);
    if (a > 0.008) {
      g.globalAlpha = a;
      g.beginPath();
      g.moveTo(prev.x, prev.y);
      g.lineTo(p.x, p.y);
      g.stroke();
    }
    prev = p;
  }
  g.globalAlpha = 1;
}

export function drawPlate(
  canvas: HTMLCanvasElement,
  geo: MeridianGeometry,
  palette: MeridianPalette,
  rects: KeepRect[],
  dpr: number,
  monoFamily: string,
  compact: boolean,
): void {
  canvas.width = Math.round(geo.w * dpr);
  canvas.height = Math.round(geo.h * dpr);
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, geo.w, geo.h);
  g.lineCap = "round";

  const inkAlpha = palette.isLight ? 0.52 : 0.42;

  // Companion hairlines first (under), then the limb itself.
  arcSegments(g, geo, -34, inkAlpha * 0.3, 1, palette.ink, rects);
  arcSegments(g, geo, 22, inkAlpha * 0.42, 1, palette.ink, rects);
  arcSegments(g, geo, 58, inkAlpha * 0.18, 1, palette.ink, rects);
  arcSegments(g, geo, 0, inkAlpha, 1.25, palette.ink, rects);
  // One breath of light near the apex — the limb catching the sky.
  arcSegments(g, geo, 0, palette.isLight ? 0.2 : 0.26, 2.2, palette.inkStrong, rects, [0.42, 0.68]);

  /* Graduations: minor / major / grand ticks pointing DOWN into the quiet
     zone (negative altitude), engraved in degrees of the instrument. */
  const spanDeg = ((geo.phi1 - geo.phi0) * 180) / Math.PI;
  const minorStep = compact ? 0.5 : 0.25;
  g.font = `500 9px ${monoFamily}`;
  g.textAlign = "center";
  for (let d = 0; d <= spanDeg + 1e-6; d += minorStep) {
    const phi = geo.phi0 + (d * Math.PI) / 180;
    const grand = Math.abs(d % 5) < 1e-6;
    const major = Math.abs(d % 1.25) < 1e-6;
    const len = grand ? 22 : major ? 13 : 6;
    const p0 = limbPoint(geo, phi, -3);
    const p1 = limbPoint(geo, phi, -3 - len);
    const a = (grand ? 0.5 : major ? 0.38 : 0.22) * (palette.isLight ? 1.1 : 1) * keepFactor(rects, p0.x, p0.y);
    if (a <= 0.01) continue;
    g.globalAlpha = a;
    g.strokeStyle = palette.ink;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(p0.x, p0.y);
    g.lineTo(p1.x, p1.y);
    g.stroke();
    if (grand && !compact) {
      const pt = limbPoint(geo, phi, -44);
      g.globalAlpha = 0.34 * keepFactor(rects, pt.x, pt.y);
      g.fillStyle = palette.ink;
      g.fillText(`${Math.round(d)}°`, pt.x, pt.y);
    }
  }
  g.globalAlpha = 1;
}
