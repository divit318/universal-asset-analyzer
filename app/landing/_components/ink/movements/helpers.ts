export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Sample a polyline (flat [x0,y0,x1,y1,...] in 0..1 space) at u 0..1. */
export function samplePolyline(pts: number[], u: number, out: { x: number; y: number }): void {
  const segs = pts.length / 2 - 1;
  const f = Math.min(0.99999, Math.max(0, u)) * segs;
  const i = Math.floor(f);
  const t = f - i;
  out.x = pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t;
  out.y = pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t;
}
