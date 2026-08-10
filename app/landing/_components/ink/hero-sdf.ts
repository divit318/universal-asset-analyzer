/**
 * Hero text exclusion field. The union of the hero's text rects (eyebrow,
 * each headline LINE, each lead-paragraph line, both CTAs, the nav pill,
 * the pipeline stages) becomes a distance field the silk shader samples:
 * material density falls off smoothly over ~150 CSS px approaching any
 * text, so the field is structurally incapable of crowding the type and
 * the exclusion reads as atmosphere, never as a cutout rectangle.
 *
 * Geometry is measured from the rendered DOM (getBoundingClientRect and
 * per-line Range fragments), never hardcoded. Distances are EXACT: every
 * obstacle is an axis-aligned rect, so per-texel min-distance-to-rect is
 * computed analytically. A jump-flood or 8SSEDT pass would only
 * approximate what this closed form gives outright.
 *
 * The field is encoded as one byte per texel: 0 at a glyph box, 255 at or
 * beyond the falloff distance. 256 texels across the hero is ample; the
 * shader's bilinear sample plus a full-range smoothstep make the 8-bit
 * quantization invisible.
 */

export interface SdfRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Per-rect falloff radius override, CSS px (default SDF_FALLOFF_PX). */
  falloff?: number;
}

/** Falloff radius in CSS px: generous, so the thinning reads as air. */
export const SDF_FALLOFF_PX = 150;
/** The attribution line gets a tight halo: it annotates the field itself,
 *  so it earns legibility without carving into the composition. */
export const SDF_ATTRIBUTION_FALLOFF_PX = 56;
/** Uniform expansion beyond the glyph boxes. */
export const SDF_INSET_PX = 8;
/** Texture width; height follows the canvas aspect. */
export const SDF_TEX_W = 256;

/**
 * Rasterize the falloff field: for each texel center (canvas-local CSS
 * px), the distance to the nearest rect NORMALIZED BY THAT RECT'S OWN
 * falloff radius, quantized to a byte (0 at a glyph box, 255 at or
 * beyond the radius). Row 0 is the TOP of the canvas, matching the
 * shader's uv convention.
 */
export function rectFalloffField(rects: SdfRect[], texW: number, texH: number, cssW: number, cssH: number, falloffPx: number = SDF_FALLOFF_PX): Uint8Array {
  const out = new Uint8Array(texW * texH);
  if (rects.length === 0) {
    out.fill(255);
    return out;
  }
  const sx = cssW / texW;
  const sy = cssH / texH;
  for (let j = 0; j < texH; j++) {
    const y = (j + 0.5) * sy;
    for (let i = 0; i < texW; i++) {
      const x = (i + 0.5) * sx;
      let best = 1;
      for (const r of rects) {
        const dx = Math.max(r.x0 - x, x - r.x1, 0);
        const dy = Math.max(r.y0 - y, y - r.y1, 0);
        const d = dx && dy ? Math.hypot(dx, dy) : dx + dy;
        const n = d / (r.falloff ?? falloffPx);
        if (n < best) best = n;
        if (best === 0) break;
      }
      out[j * texW + i] = Math.round(best * 255);
    }
  }
  return out;
}

/** Clip a viewport-space rect to the canvas box, expand it, localize it. */
function localize(r: DOMRect, box: DOMRect, inset: number, falloff?: number): SdfRect | null {
  const x0 = Math.max(r.left - inset, box.left) - box.left;
  const y0 = Math.max(r.top - inset, box.top) - box.top;
  const x1 = Math.min(r.right + inset, box.right) - box.left;
  const y1 = Math.min(r.bottom + inset, box.bottom) - box.top;
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return falloff ? { x0, y0, x1, y1, falloff } : { x0, y0, x1, y1 };
}

/** Per-line boxes of an element's inline content (headline, lead rag). */
function lineRects(el: Element): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  return Array.from(range.getClientRects());
}

/**
 * Collect the exclusion rects in canvas-local CSS px. Headline and lead
 * are measured per LINE FRAGMENT (they break via <br/> and wrapping, so
 * the block box would exclude far beyond the rag); everything else uses
 * its border box. Rects that do not intersect the canvas are dropped,
 * which is what confines the mobile bottom-band layout to a no-op.
 */
export function collectHeroKeepoutRects(canvas: HTMLElement): SdfRect[] {
  const box = canvas.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return [];
  const rects: SdfRect[] = [];
  const push = (r: DOMRect) => {
    const local = localize(r, box, SDF_INSET_PX);
    if (local) rects.push(local);
  };

  const copy = document.querySelector("[data-hero-copy]");
  if (copy) {
    for (const el of copy.querySelectorAll("h1, p[data-lead]")) lineRects(el).forEach(push);
    for (const el of copy.querySelectorAll("p:not([data-lead]), a, button")) push(el.getBoundingClientRect());
  }
  const nav = document.querySelector("header nav");
  if (nav) push(nav.getBoundingClientRect());
  for (const el of document.querySelectorAll("[data-pipeline-stage]")) push(el.getBoundingClientRect());
  /* The attribution annotates the field, so it clears only a tight halo
     for its own legibility instead of a full atmospheric exclusion. */
  const attribution = document.querySelector("[data-hero-attribution]");
  if (attribution) {
    const local = localize(attribution.getBoundingClientRect(), box, SDF_INSET_PX, SDF_ATTRIBUTION_FALLOFF_PX);
    if (local) rects.push(local);
  }
  return rects;
}
