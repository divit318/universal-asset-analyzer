import { DEFAULT_DRAWING_STYLE, type DrawingStyle } from "./types";

const KEY = "uaa_chart_drawing_defaults";

/** The user's last-chosen drawing style, remembered across drawings and sessions. */
export function getPreferredDrawingStyle(): DrawingStyle {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DRAWING_STYLE;
    return { ...DEFAULT_DRAWING_STYLE, ...(JSON.parse(raw) as Partial<DrawingStyle>) };
  } catch {
    return DEFAULT_DRAWING_STYLE;
  }
}

export function setPreferredDrawingStyle(style: DrawingStyle): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(style));
  } catch {
    /* localStorage unavailable — preference just won't persist across sessions */
  }
}
