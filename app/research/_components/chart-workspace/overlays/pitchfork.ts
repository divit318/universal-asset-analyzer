/**
 * Andrews Pitchfork — 3 clicks (P1 handle, then P2/P3 defining the fork
 * width). The median line runs from P1 through the midpoint of P2-P3; two
 * parallel "tines" run through P2 and P3, all extended to the right edge of
 * the visible chart. No built-in klinecharts overlay covers this.
 */
import { registerOverlay } from "klinecharts";
import type { Coordinate, OverlayFigure, OverlayTemplate } from "klinecharts";
import { readLineStyle } from "./style-utils";

/** Extend the ray from `start` through `through` out to `rightEdge`, returning the far endpoint. */
function extendToEdge(start: Coordinate, through: Coordinate, rightEdge: number): Coordinate {
  const dx = through.x - start.x;
  if (Math.abs(dx) < 1e-6) return { x: through.x, y: through.y };
  const slope = (through.y - start.y) / dx;
  const y = start.y + slope * (rightEdge - start.x);
  return { x: rightEdge, y };
}

const template: OverlayTemplate = {
  name: "pitchfork",
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  mode: "strong_magnet",
  createPointFigures: ({ coordinates, overlay, bounding }) => {
    if (coordinates.length < 2) return [];
    const line = readLineStyle(overlay.styles);
    const [p1] = coordinates;
    const rightEdge = bounding.right;

    if (coordinates.length < 3) {
      // Only the handle and one width point placed so far — show the handle-to-point line.
      return [{ key: "handle", type: "line", attrs: { coordinates: [p1, coordinates[1]] }, styles: line }];
    }

    const [, p2, p3] = coordinates;
    const midpoint: Coordinate = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
    const medianEnd = extendToEdge(p1, midpoint, rightEdge);
    // The tines are parallel to the median (p1->midpoint direction) but pass through p2/p3 —
    // reuse extendToEdge by translating the median's direction onto each tine's own origin.
    const dx = midpoint.x - p1.x;
    const dy = midpoint.y - p1.y;
    const tine2 = extendToEdge(p2, { x: p2.x + dx, y: p2.y + dy }, rightEdge);
    const tine3 = extendToEdge(p3, { x: p3.x + dx, y: p3.y + dy }, rightEdge);

    return [
      { key: "median", type: "line", attrs: { coordinates: [p1, medianEnd] }, styles: line },
      { key: "tine-upper", type: "line", attrs: { coordinates: [p2, tine2] }, styles: line },
      { key: "tine-lower", type: "line", attrs: { coordinates: [p3, tine3] }, styles: line },
      { key: "width", type: "line", attrs: { coordinates: [p2, p3] }, styles: { ...line, style: "dashed" as const } },
    ] satisfies OverlayFigure[];
  },
};

registerOverlay(template);
