/**
 * Arrow — a 2-point annotation (tail -> head) with an arrowhead at the second
 * point. No built-in klinecharts overlay covers this.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayTemplate } from "klinecharts";
import { readLineStyle } from "./style-utils";

const HEAD_LENGTH = 10;
const HEAD_ANGLE = Math.PI / 7;

const template: OverlayTemplate = {
  name: "arrow",
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  mode: "strong_magnet",
  createPointFigures: ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];
    const [from, to] = coordinates;
    const line = readLineStyle(overlay.styles);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head1 = {
      x: to.x - HEAD_LENGTH * Math.cos(angle - HEAD_ANGLE),
      y: to.y - HEAD_LENGTH * Math.sin(angle - HEAD_ANGLE),
    };
    const head2 = {
      x: to.x - HEAD_LENGTH * Math.cos(angle + HEAD_ANGLE),
      y: to.y - HEAD_LENGTH * Math.sin(angle + HEAD_ANGLE),
    };
    return [
      { key: "shaft", type: "line", attrs: { coordinates: [from, to] }, styles: line },
      {
        key: "head",
        type: "polygon",
        attrs: { coordinates: [to, head1, head2] },
        styles: { style: "fill", color: line.color, borderColor: line.color },
      },
    ];
  },
};

registerOverlay(template);
