"use client";

/**
 * Keep-out geometry: the ink must never cross the copy. On mount and resize
 * we collect the bounding rects of every text node and interactive element
 * inside the ink-bearing sections, inflated by 24px; the shared render path
 * multiplies every particle's alpha by keepoutAlpha(x, y), which is 0 inside
 * any rect and smoothsteps back to 1 across the inflation band. Applied in
 * ONE place (the engine's render loop), so no movement can forget it.
 *
 * Elements inside a [data-ink-ignore] container are skipped: the hero's
 * waypoint labels annotate the ink itself and must not punch holes in it.
 */

const INFLATE = 24;
const SELECTOR = "h1, h2, h3, p, a, button, input, li, td, th, [data-ink-keepout]";
/** Only sections that carry canvas ink need masks. */
const INK_SCOPES = ["#hero", "#problem", "#solution", "#privacy", "#cta", "footer"];
const BAND = 256; // vertical binning, page px

interface KRect {
  x0: number;
  y0: number; // page coords
  x1: number;
  y1: number;
}

let rects: KRect[] = [];
let bands: Int32Array[] = [];
let bandBase = 0;

export function measureKeepout(): void {
  rects = [];
  for (const scope of INK_SCOPES) {
    const root = document.querySelector(scope);
    if (!root) continue;
    root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
      if (el.closest("[data-ink-ignore]")) return;
      // Skip elements that contain other keep-out elements (use the leaves:
      // a section-wide <li> wrapping a paragraph would mask half the page).
      if (el.querySelector(SELECTOR)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      rects.push({
        x0: r.left - INFLATE,
        y0: r.top + window.scrollY - INFLATE,
        x1: r.right + INFLATE,
        y1: r.bottom + window.scrollY + INFLATE,
      });
    });
  }
  // Vertical band index for cheap lookup.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.y0 < minY) minY = r.y0;
    if (r.y1 > maxY) maxY = r.y1;
  }
  if (!rects.length || !isFinite(minY)) {
    bands = [];
    return;
  }
  bandBase = Math.floor(minY / BAND);
  const bandCount = Math.floor(maxY / BAND) - bandBase + 1;
  const lists: number[][] = Array.from({ length: bandCount }, () => []);
  rects.forEach((r, i) => {
    const b0 = Math.max(0, Math.floor(r.y0 / BAND) - bandBase);
    const b1 = Math.min(bandCount - 1, Math.floor(r.y1 / BAND) - bandBase);
    for (let b = b0; b <= b1; b++) lists[b].push(i);
  });
  bands = lists.map((l) => Int32Array.from(l));
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Alpha multiplier for a particle at viewport (x, y): 0 inside any keep-out
 * rect, ramping to 1 across the 24px inflation band.
 */
export function keepoutAlpha(x: number, y: number, scrollY: number): number {
  if (!bands.length) return 1;
  const py = y + scrollY;
  const b = Math.floor(py / BAND) - bandBase;
  if (b < 0 || b >= bands.length) return 1;
  const list = bands[b];
  let best = 1;
  for (let k = 0; k < list.length; k++) {
    const r = rects[list[k]];
    if (x < r.x0 || x > r.x1 || py < r.y0 || py > r.y1) continue;
    // Inside the inflated rect: distance from the CORE rect edge.
    const dx = Math.max(r.x0 + INFLATE - x, x - (r.x1 - INFLATE), 0);
    const dy = Math.max(r.y0 + INFLATE - py, py - (r.y1 - INFLATE), 0);
    const d = Math.max(dx, dy);
    const f = smoothstep(d / INFLATE);
    if (f < best) best = f;
    if (best === 0) return 0;
  }
  return best;
}

/** Page-space keep-out rects (for the audit harness). */
export function keepoutRects(): { x0: number; y0: number; x1: number; y1: number }[] {
  return rects;
}
