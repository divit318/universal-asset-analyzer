/**
 * Bridges our `DrawingStyle` (color/opacity/thickness/lineStyle/textSize —
 * what the properties panel edits) to klinecharts' figure style shapes.
 *
 * klinecharts does NOT automatically apply an overlay's `.styles` to the
 * figures a custom `createPointFigures` returns — each figure's own `styles`
 * field determines its appearance. So every custom overlay template in this
 * folder reads `overlay.styles` defensively via the helpers here and passes
 * the result into its returned figures. `overlay.styles` itself is populated
 * once, at creation time, by whoever calls `chart.createOverlay({ styles })`
 * (`use-chart-drawings.ts` / the drawing toolbar) via `toOverlayStyle` below.
 */

import type { DeepPartial, LineStyle, OverlayStyle, RectStyle, TextStyle } from "klinecharts";
import type { DrawingStyle } from "../types";

/** "#rrggbb" + 0-1 opacity -> "rgba(r,g,b,opacity)". Passes through non-hex colors unchanged. */
export function withOpacity(color: string, opacity: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const DEFAULT_LINE: Pick<LineStyle, "color" | "size" | "style" | "dashedValue"> = {
  color: "#60a5fa",
  size: 1.5,
  style: "solid",
  dashedValue: [4, 4],
};

/** Convert our DrawingStyle into the klinecharts overlay-level style bag stored on the instance. */
export function toOverlayStyle(style: DrawingStyle): DeepPartial<OverlayStyle> {
  const color = withOpacity(style.color, style.opacity);
  const dashed = style.lineStyle !== "solid";
  return {
    line: {
      color,
      size: style.thickness,
      style: dashed ? "dashed" : "solid",
      dashedValue: style.lineStyle === "dotted" ? [2, 2] : [6, 4],
    },
    rect: { color: withOpacity(style.color, style.opacity * 0.15), borderColor: color, borderSize: style.thickness },
    polygon: { color, borderColor: color },
    text: { color: style.color, size: style.textSize },
  };
}

/** Defensive reader for a custom overlay template's line figures — falls back to sane defaults. */
export function readLineStyle(overlayStyles: DeepPartial<OverlayStyle> | null | undefined): Pick<LineStyle, "color" | "size" | "style" | "dashedValue"> {
  return { ...DEFAULT_LINE, ...overlayStyles?.line };
}

/** Defensive reader for a custom overlay template's rect figures. */
export function readRectStyle(overlayStyles: DeepPartial<OverlayStyle> | null | undefined): Partial<RectStyle> {
  return {
    style: "fill",
    color: withOpacity("#60a5fa", 0.15),
    borderColor: "#60a5fa",
    borderSize: 1,
    ...overlayStyles?.rect,
  };
}

/** Defensive reader for a custom overlay template's text figures. */
export function readTextStyle(overlayStyles: DeepPartial<OverlayStyle> | null | undefined): Partial<TextStyle> {
  return { color: themeToken("--foreground", "#e6e9ef"), size: 12, ...overlayStyles?.text };
}

/**
 * Resolve a design token to its current hex at draw time. Overlay templates
 * register once at module load and never re-render on theme change, but their
 * `createPointFigures` runs on every draw — reading the token here is what
 * lets a semantic zone (risk red / reward green) follow the active theme
 * instead of baking in the dark palette (2026-08-08 light-mode audit).
 */
export function themeToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#([0-9a-f]{6})$/i.test(v) ? v : fallback;
}
