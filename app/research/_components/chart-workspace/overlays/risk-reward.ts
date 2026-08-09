/**
 * Risk/Reward tool — 3 clicks (entry, stop, target) render a red risk zone
 * and a green reward zone spanning from the entry point forward, plus the
 * computed R:R ratio. No built-in klinecharts overlay covers this.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayFigure, OverlayTemplate } from "klinecharts";
import { readTextStyle, themeToken, withOpacity } from "./style-utils";

const ZONE_WIDTH = 80; // px, extends right from the entry point

const template: OverlayTemplate = {
  name: "risk-reward",
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  mode: "strong_magnet",
  createPointFigures: ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];
    const [entry, stop, target] = coordinates;
    const [p0, p1, p2] = overlay.points;
    const text = readTextStyle(overlay.styles);
    // Semantic zone colors follow the active theme (see themeToken docstring).
    const negative = themeToken("--negative", "#f87171");
    const positive = themeToken("--positive", "#4ade80");

    const figures: OverlayFigure[] = [
      {
        key: "risk-zone",
        type: "rect",
        attrs: { x: entry.x, y: Math.min(entry.y, stop.y), width: ZONE_WIDTH, height: Math.abs(stop.y - entry.y) },
        styles: { style: "fill", color: withOpacity(negative, 0.2), borderColor: withOpacity(negative, 0.6), borderSize: 1 },
      },
    ];

    if (coordinates.length >= 3) {
      figures.push({
        key: "reward-zone",
        type: "rect",
        attrs: { x: entry.x, y: Math.min(entry.y, target.y), width: ZONE_WIDTH, height: Math.abs(target.y - entry.y) },
        styles: { style: "fill", color: withOpacity(positive, 0.2), borderColor: withOpacity(positive, 0.6), borderSize: 1 },
      });

      if (p0?.value != null && p1?.value != null && p2?.value != null) {
        const risk = Math.abs(p0.value - p1.value);
        const reward = Math.abs(p2.value - p0.value);
        const ratio = risk !== 0 ? reward / risk : 0;
        figures.push({
          key: "ratio-label",
          type: "text",
          attrs: {
            x: entry.x + ZONE_WIDTH / 2,
            y: Math.min(entry.y, stop.y, target.y) - 10,
            text: `R:R 1:${ratio.toFixed(2)}`,
            align: "center",
            baseline: "bottom",
          },
          styles: text,
        });
      }
    }

    return figures;
  },
};

registerOverlay(template);
