/**
 * Measure — a 2-point ruler showing the price delta, percent change, and bar
 * count between two points. No built-in klinecharts overlay covers this.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayFigure, OverlayTemplate } from "klinecharts";
import { readLineStyle, readTextStyle } from "./style-utils";

const template: OverlayTemplate = {
  name: "measure",
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  mode: "strong_magnet",
  createPointFigures: ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];
    const [from, to] = coordinates;
    const [p0, p1] = overlay.points;
    const line = readLineStyle(overlay.styles);
    const text = readTextStyle(overlay.styles);

    const figures: OverlayFigure[] = [
      { key: "ruler", type: "line", attrs: { coordinates: [from, to] }, styles: { ...line, style: "dashed" as const } },
    ];

    if (p0?.value != null && p1?.value != null) {
      const delta = p1.value - p0.value;
      const pct = p0.value !== 0 ? (delta / p0.value) * 100 : 0;
      const bars = p0.dataIndex != null && p1.dataIndex != null ? Math.abs(p1.dataIndex - p0.dataIndex) : null;
      const sign = delta >= 0 ? "+" : "";
      const label = `${sign}${delta.toFixed(2)} (${sign}${pct.toFixed(2)}%)${bars != null ? ` · ${bars} bars` : ""}`;
      figures.push({
        key: "label",
        type: "text",
        attrs: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 8, text: label, align: "center", baseline: "bottom" },
        styles: text,
      });
    }

    return figures;
  },
};

registerOverlay(template);
