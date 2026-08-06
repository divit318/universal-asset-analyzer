/**
 * Round-interval axis ticks — shared by every chart so no axis ever renders
 * $61.9 / $67.9 / $73.9 (Recharts' raw min/max padding artifacts).
 *
 * Pure, dependency-free, unit-tested in tests/chart-scale.test.ts.
 */

/** Largest "nice" step ≤ raw (1/2/2.5/5 × 10^k ladder). */
function niceStep(raw: number): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1;
  return nice * mag;
}

/**
 * Tick values at round intervals covering [min, max], padded so the extremes
 * of the data never sit on the plot border.
 *
 * `count` is a target, not a promise — the step is snapped to the 1/2/2.5/5
 * ladder, so the result has count ± 2 ticks.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step = niceStep(span / Math.max(count - 1, 1));
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step; // always covers max
  const ticks: number[] = [];
  // Epsilon guards float drift (0.1 + 0.2 style) from dropping the last tick.
  for (let v = start; v <= end + step * 1e-6; v += step) {
    // Snap each tick to the step's precision so 0.30000000000000004 renders as 0.3.
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

/** Domain implied by {@link niceTicks} — hand both to the axis so the plot
 *  area and the labels agree. */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  const ticks = niceTicks(min, max, count);
  if (ticks.length === 0) return [min, max];
  return [ticks[0], ticks[ticks.length - 1]];
}
