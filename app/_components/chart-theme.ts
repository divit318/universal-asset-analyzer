"use client";

/**
 * Shared Recharts theme, theme-aware.
 *
 * Recharts renders colors as raw SVG presentation attributes, where CSS
 * `var(--token)` resolution is unreliable (observed stale paint on
 * stroke/fill after a token changed). So we keep literal hex here and pick
 * the light/dark set at runtime via useChartTheme(), which re-renders on
 * theme change. Keep these values in sync with the tokens in app/globals.css.
 */

import { useTheme, type Theme } from "./theme";

/**
 * Categorical series colors — identity of a stock/series, deliberately
 * distinct from positive/negative/warning semantics (excludes green & red).
 * Chosen to stay legible on BOTH light and dark canvases, so they are not
 * theme-swapped (unlike the structural + semantic colors below).
 */
export const CHART_SERIES = [
  "#a855f7", // purple
  "#60a5fa", // steel — the retired brand sky-blue hue, returned to the data (brand book §3)
  "#14b8a6", // teal
  "#ec4899", // pink
  "#64748b", // slate
] as const;

/* Steel needs a darker shade on a white canvas (brand book: #2563EB light);
   the other four slots stay legible on both canvases unswapped. */
const LIGHT_SERIES = [
  CHART_SERIES[0],
  "#2563eb", // steel (light)
  CHART_SERIES[2],
  CHART_SERIES[3],
  CHART_SERIES[4],
] as const;

export interface ChartTheme {
  axis: string;
  grid: string;
  surface: string; // dot strokes, tooltip background
  positive: string;
  negative: string;
  warning: string;
  brand: string;
  series: readonly string[];
  cursorFill: string;
  tooltip: React.CSSProperties;
  axisTick: { fontSize: number; fill: string };
}

const DARK: ChartTheme = {
  axis: "#99a3b2", // --muted
  grid: "#282d37", // --border
  surface: "#131519", // --surface
  positive: "#4ade80",
  negative: "#f87171",
  warning: "#fb923c",
  brand: "#c8a96e",
  series: CHART_SERIES,
  cursorFill: "rgba(255,255,255,0.05)",
  tooltip: {
    background: "#131519",
    border: "1px solid #282d37",
    borderRadius: 10,
    fontSize: 12,
    padding: "8px 12px",
    boxShadow: "0 12px 32px -8px rgba(0,0,0,0.6), 0 4px 12px -4px rgba(0,0,0,0.5)",
    color: "#edeff2",
  },
  axisTick: { fontSize: 11, fill: "#99a3b2" },
};

const LIGHT: ChartTheme = {
  axis: "#56606f", // --muted (light)
  grid: "#e2e6ec", // --border (light)
  surface: "#ffffff", // --surface (light)
  positive: "#16a34a",
  negative: "#dc2626",
  warning: "#c2540a",
  brand: "#7a5f33",
  series: LIGHT_SERIES,
  cursorFill: "rgba(16,23,34,0.05)",
  tooltip: {
    background: "#ffffff",
    border: "1px solid #e2e6ec",
    borderRadius: 10,
    fontSize: 12,
    padding: "8px 12px",
    boxShadow: "0 12px 32px -8px rgba(16,23,34,0.18), 0 4px 12px -4px rgba(16,23,34,0.12)",
    color: "#101722",
  },
  axisTick: { fontSize: 11, fill: "#56606f" },
};

export function getChartTheme(theme: Theme): ChartTheme {
  return theme === "light" ? LIGHT : DARK;
}

/** Reactive Recharts palette for the active theme. Use inside chart components. */
export function useChartTheme(): ChartTheme {
  return getChartTheme(useTheme().theme);
}

/* ── Legacy static exports (dark) — retained so any unmigrated reference still
      compiles. Prefer useChartTheme() in client chart components. ─────────── */
export const CHART_AXIS = DARK.axis;
export const CHART_GRID = DARK.grid;
export const CHART_SURFACE = DARK.surface;
export const CHART_POSITIVE = DARK.positive;
export const CHART_NEGATIVE = DARK.negative;
export const CHART_WARNING = DARK.warning;
export const CHART_BRAND = DARK.brand;
export const chartTooltipStyle = DARK.tooltip;
export const chartAxisTick = DARK.axisTick;
export const chartCursorFill = DARK.cursorFill;
