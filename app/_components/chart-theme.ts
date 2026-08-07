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
  /* ── Named auxiliary hues (2026-08-08 light-mode audit) ─────────────────
     Every page-level chart used to hardcode these as dark-palette literals
     (BLUE #60a5fa, AMBER #fbbf24, …), which sit at 1.9–2.5:1 on a white
     canvas. One theme-swapped set here instead of five private copies. */
  blue: string;   // = series[1] steel — the "second line" of any two-series chart
  amber: string;  // annual/estimate overlays, SMA-50 — amber, NOT signal orange
  purple: string; // SMA-200, volume bars
  teal: string;   // Bollinger bands, tertiary series
  orange: string; // = warning hue as a series identity
  pink: string;   // quaternary series
  neutral: string; // "no direction" markers
  referenceLine: string; // zero/threshold rules — quieter than axis
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
  blue: "#60a5fa",
  amber: "#fbbf24",
  purple: "#a78bfa",
  teal: "#2dd4bf",
  orange: "#fb923c",
  pink: "#f472b6",
  neutral: "#9aa3af",
  referenceLine: "#4b5563",
};

const LIGHT: ChartTheme = {
  axis: "#4d5564", // --muted (light, deepened 2026-08-08 light-mode audit)
  grid: "#e2e6ec", // --border (light)
  surface: "#ffffff", // --surface (light)
  positive: "#15803d", // deepened with --positive (2026-08-07 contrast audit)
  negative: "#b91c1c", // deepened with --negative (2026-08-07 contrast audit)
  warning: "#ad4a08", // --warning (light, deepened 2026-08-08 light-mode audit)
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
  axisTick: { fontSize: 11, fill: "#4d5564" },
  blue: "#2563eb",   // steel (light) — matches LIGHT_SERIES[1]
  amber: "#b45309",  // amber-700: 5.02:1 on white where #fbbf24 was 1.9:1
  purple: "#7c3aed", // violet-600: 5.70:1 on white
  teal: "#0f766e",   // teal-700: 5.47:1 on white
  orange: "#ad4a08", // = light --warning
  pink: "#db2777",   // matches light --chart-4
  neutral: "#64748b",
  referenceLine: "#94a3b8", // slate-400 — a quiet rule on white, like #4b5563 on dark
};

export function getChartTheme(theme: Theme): ChartTheme {
  return theme === "light" ? LIGHT : DARK;
}

/** Reactive Recharts palette for the active theme. Use inside chart components. */
export function useChartTheme(): ChartTheme {
  return getChartTheme(useTheme().theme);
}

/* The legacy static dark-only exports (CHART_AXIS, chartTooltipStyle, …) are
   gone (2026-08-08 light-mode audit): they had zero remaining consumers, and
   their existence invited new call sites that would render dark chrome on a
   light canvas. useChartTheme() is the only door. */
