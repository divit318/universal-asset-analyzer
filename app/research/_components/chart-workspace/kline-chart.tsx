"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { init, dispose, type Chart, type Crosshair, type KLineData, type Period } from "klinecharts";
import type { HistoryPoint } from "@/lib/types";
import { registerChartIndicators } from "@/lib/chart-indicators";
import { useChartTheme } from "@/app/_components/chart-theme";
import type { IndicatorKey } from "./types";

/**
 * klinecharts' internal id for the main candlestick pane (confirmed via its
 * bundled source: `PaneIdConstants.CANDLE = 'candle_pane'`) — not part of the
 * public API surface, since it's only exposed as an internal constant. Used to
 * pin price-series indicators (SMA/BOLL) onto the main pane instead of letting
 * `createIndicator` default them into their own new sub-pane. Re-verify this
 * string if the `klinecharts` dependency is ever upgraded.
 */
const MAIN_PANE_ID = "candle_pane";

/** How much space (in px) to reserve after the last candle — small, so the chart fits its data instead of reserving room for a simulated "future." */
const RIGHT_FIT_DISTANCE = 24;

export interface KLineChartHandle {
  readonly chart: Chart | null;
}

export interface KLineChartProps {
  symbol: string;
  history: HistoryPoint[];
  /** What each bar represents, for klinecharts' own axis/date formatting — defaults to daily. */
  period?: Period;
  initialIndicators?: Record<IndicatorKey, boolean>;
  onIndicatorsChange?: (indicators: Record<IndicatorKey, boolean>) => void;
  /** Fired once the chart instance exists — refs don't trigger re-renders, so callers that need the live Chart in state (e.g. to feed useChartDrawings) should use this instead of polling the forwarded ref. */
  onReady?: (chart: Chart) => void;
  /** Live crosshair position, for the merged hover/crosshair info panel. */
  onCrosshairChange?: (crosshair: Crosshair | null) => void;
  /**
   * Fires when the user clicks directly on a candle bar — deliberately
   * separate from onCrosshairChange (which fires continuously on hover and
   * is gone the moment the mouse leaves the canvas to type a question).
   * This is the sticky "select a candle" signal the AI dock's context relies
   * on: it persists until a different candle (or drawing) is clicked.
   */
  onCandleClick?: (dataIndex: number) => void;
  /** Rendered inside the same relative-positioned canvas wrapper as the chart itself, so an absolutely-positioned overlay (the crosshair info panel) lines up with the canvas rather than the indicator toggle row above it. */
  overlay?: React.ReactNode;
}

function toKLineData(points: HistoryPoint[]): KLineData[] {
  return points
    .filter((p) => p.close != null)
    .map((p) => ({
      timestamp: new Date(p.date).getTime(),
      open: p.open ?? p.close,
      high: p.high ?? p.close,
      low: p.low ?? p.close,
      close: p.close,
      volume: p.volume ?? 0,
    }));
}

const INDICATOR_NAME: Record<IndicatorKey, string> = {
  sma50: "UAA_SMA50",
  sma200: "UAA_SMA200",
  boll: "UAA_BOLL",
  rsi: "UAA_RSI",
  macd: "UAA_MACD",
};
/** Indicators pinned to the main candle pane; the rest each get their own sub-pane. */
const MAIN_PANE_INDICATORS = new Set<IndicatorKey>(["sma50", "sma200", "boll"]);
const DEFAULT_INDICATORS: Record<IndicatorKey, boolean> = {
  sma50: true,
  sma200: true,
  boll: false,
  rsi: true,
  macd: false,
};

/**
 * Thin React wrapper around klinecharts' imperative core — candles, volume,
 * and indicators only. Drawing/overlay tools are layered on top by
 * `chart-workspace.tsx` via the exposed `chart` instance, so this component
 * stays focused on rendering the price series.
 */
export const KLineChart = forwardRef<KLineChartHandle, KLineChartProps>(function KLineChart(
  { symbol, history, period, initialIndicators, onIndicatorsChange, onReady, onCrosshairChange, onCandleClick, overlay },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const indicatorIds = useRef<Partial<Record<IndicatorKey, string>>>({});
  const ct = useChartTheme();

  const [active, setActive] = useState<Record<IndicatorKey, boolean>>(initialIndicators ?? DEFAULT_INDICATORS);

  useImperativeHandle(ref, () => ({
    get chart() {
      return chartRef.current;
    },
  }), []);

  // Init once per symbol mount; dispose on unmount/symbol change.
  useEffect(() => {
    registerChartIndicators();
    const container = containerRef.current;
    if (!container) return;

    const chart = init(container, {
      styles: {
        grid: {
          horizontal: { color: ct.grid },
          vertical: { color: ct.grid },
        },
        candle: {
          bar: {
            upColor: ct.positive,
            downColor: ct.negative,
            noChangeColor: ct.axis,
            upBorderColor: ct.positive,
            downBorderColor: ct.negative,
            noChangeBorderColor: ct.axis,
            upWickColor: ct.positive,
            downWickColor: ct.negative,
            noChangeWickColor: ct.axis,
          },
          // The built-in tooltip is replaced by chart-workspace.tsx's merged
          // hover/crosshair panel (crosshair-panel.tsx), which also shows
          // %change, detected patterns, and a news link the built-in one
          // can't — showing both would duplicate the OHLCV information.
          tooltip: { showRule: "none" },
        },
        xAxis: { axisLine: { color: ct.grid }, tickText: { color: ct.axis } },
        yAxis: { axisLine: { color: ct.grid }, tickText: { color: ct.axis } },
        crosshair: {
          horizontal: { line: { color: ct.axis } },
          vertical: { line: { color: ct.axis } },
        },
      },
    });
    chartRef.current = chart;
    indicatorIds.current = {};

    if (chart) {
      chart.setSymbol({ ticker: symbol });
      chart.setPeriod(period ?? { type: "day", span: 1 });
      chart.setDataLoader({ getBars: ({ callback }) => callback(toKLineData(history), false) });
      // Fit the data: a small trailing gap instead of reserving a large
      // "future" area — this app is for analysis, not simulating live
      // streaming, per the brief.
      chart.setMaxOffsetRightDistance(RIGHT_FIT_DISTANCE);
      chart.setOffsetRightDistance(RIGHT_FIT_DISTANCE);

      if (onCrosshairChange) {
        chart.subscribeAction("onCrosshairChange", (crosshair) => onCrosshairChange(crosshair ?? null));
      }
      if (onCandleClick) {
        // Payload shape isn't part of klinecharts' public .d.ts — confirmed by
        // reading the bundled source (CandleBarView pushes
        // { dataIndex, x, data: { prev, current, next } } from
        // getVisibleRangeDataList()) and verified at runtime, so read
        // defensively rather than trusting an assumed type.
        chart.subscribeAction("onCandleBarClick", (payload) => {
          const dataIndex = (payload as { dataIndex?: unknown } | undefined)?.dataIndex;
          if (typeof dataIndex === "number") onCandleClick(dataIndex);
        });
      }

      onReady?.(chart);

      for (const key of Object.keys(active) as IndicatorKey[]) {
        if (!active[key]) continue;
        const id = chart.createIndicator(
          MAIN_PANE_INDICATORS.has(key)
            ? { name: INDICATOR_NAME[key], paneId: MAIN_PANE_ID }
            : INDICATOR_NAME[key],
        );
        if (id) indicatorIds.current[key] = id;
      }
    }

    return () => {
      if (onCrosshairChange) chart?.unsubscribeAction("onCrosshairChange");
      if (onCandleClick) chart?.unsubscribeAction("onCandleBarClick");
      dispose(container);
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // Refresh the underlying price series when `history` or `period` changes
  // (interval switch, background refetch) without tearing down the instance.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setPeriod(period ?? { type: "day", span: 1 });
    chart.setDataLoader({ getBars: ({ callback }) => callback(toKLineData(history), false) });
    chart.resetData();
    chart.setOffsetRightDistance(RIGHT_FIT_DISTANCE);
  }, [history, period]);

  function toggleIndicator(key: IndicatorKey) {
    const chart = chartRef.current;
    if (!chart) return;
    const next = { ...active, [key]: !active[key] };
    if (next[key]) {
      const id = chart.createIndicator(
        MAIN_PANE_INDICATORS.has(key)
          ? { name: INDICATOR_NAME[key], paneId: MAIN_PANE_ID }
          : INDICATOR_NAME[key],
      );
      if (id) indicatorIds.current[key] = id;
    } else {
      const id = indicatorIds.current[key];
      if (id) {
        chart.removeIndicator({ id });
        delete indicatorIds.current[key];
      }
    }
    setActive(next);
    onIndicatorsChange?.(next);
  }

  const TOGGLES: { key: IndicatorKey; label: string }[] = [
    { key: "sma50", label: "SMA 50" },
    { key: "sma200", label: "SMA 200" },
    { key: "boll", label: "BB(20,2)" },
    { key: "rsi", label: "RSI(14)" },
    { key: "macd", label: "MACD" },
  ];

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1 px-1 py-0.5">
        {TOGGLES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => toggleIndicator(key)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              active[key] ? "bg-blue-500/20 text-blue-400 light:text-sky-700" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="relative min-h-[480px] flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {overlay}
      </div>
    </div>
  );
});
