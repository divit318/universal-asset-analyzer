/**
 * Builds the AI dock's context object from the chart's current state. Two
 * pure functions, deliberately NOT given the live klinecharts `Chart`
 * instance — `chart.getVisibleRange()`/`chart.getOverlays()` are the only two
 * calls that genuinely need it, and both are cheap synchronous reads, so
 * chart-workspace.tsx does those once (at hover/submit time) and passes the
 * plain results in here. That keeps this file 100% unit-testable with
 * fabricated data — no klinecharts mock required.
 */

import { calcSma } from "@/lib/indicators";
import { calcVolumeSma, type TechnicalSignal } from "@/lib/pattern-signals";
import type { ChartQAContext, ChartQANewsItem, ChartQAOtherDrawing, ChartQASelection, HistoryPoint, NewsItem } from "@/lib/types";
import type { Overlay, VisibleRange } from "klinecharts";
import { DRAWING_TOOL_LABEL, OVERLAY_NAME_TO_TOOL_ID } from "./drawing-categories";
import type { CandleIntervalKey, DrawingStyle, DrawingToolId, IndicatorKey, PeriodKey } from "./types";

function daysBetween(isoA: string, isoB: string): number {
  return Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) / (1000 * 60 * 60 * 24);
}

function toCandle(bar: HistoryPoint): { date: string; open: number; high: number; low: number; close: number; volume: number | null } {
  return {
    date: bar.date,
    open: bar.open ?? bar.close,
    high: bar.high ?? bar.close,
    low: bar.low ?? bar.close,
    close: bar.close,
    volume: bar.volume ?? null,
  };
}

/**
 * What's currently selected, in precedence order: an explicitly selected
 * drawing wins over a pinned candle; a pinned candle that lands on a curated
 * pattern is labeled as that pattern rather than a bare candle; with nothing
 * selected, it's "Chart Overview" (a more natural label than "Nothing
 * Selected" for the AI dock's context indicator).
 *
 * `pinnedCandleIndex` is deliberately click-driven, not hover-driven — a
 * hover-based crosshair position is gone the instant the mouse leaves the
 * canvas to type into the AI input, which defeats the entire point of
 * "click a candle, then ask about it." Clicking a candle (kline-chart.tsx's
 * onCandleBarClick) sets a sticky index that survives moving the mouse away;
 * the live crosshair hover state remains separate, feeding only the
 * transient CrosshairPanel readout, not this selection.
 */
export function resolveSelection(params: {
  selectedOverlay: Overlay | null;
  selectedStyle: DrawingStyle | null;
  pinnedCandleIndex: number | null;
  displayHistory: HistoryPoint[];
  signals: TechnicalSignal[];
}): ChartQASelection {
  const { selectedOverlay, selectedStyle, pinnedCandleIndex, displayHistory, signals } = params;

  if (selectedOverlay) {
    const toolId = OVERLAY_NAME_TO_TOOL_ID[selectedOverlay.name];
    const label = toolId ? DRAWING_TOOL_LABEL[toolId] : "Drawing";
    const points = selectedOverlay.points
      .filter((p): p is { timestamp: number; value: number } => p.timestamp != null && p.value != null)
      .map((p) => ({ timestamp: p.timestamp, value: p.value }));
    return {
      kind: "drawing",
      label,
      drawing: {
        type: toolId ?? ("brush" as DrawingToolId),
        points,
        style: selectedStyle ?? { color: "#60a5fa", opacity: 1, thickness: 1.5, lineStyle: "solid", textSize: 12 },
      },
    };
  }

  if (pinnedCandleIndex != null) {
    const bar = displayHistory[pinnedCandleIndex];
    if (bar) {
      const signal = signals.find((s) => s.date === bar.date);
      if (signal) {
        return { kind: "pattern", label: `Pattern · ${signal.name}`, signal, candle: toCandle(bar) };
      }
      return { kind: "candle", label: "Candle", candle: toCandle(bar) };
    }
  }

  return { kind: "overview", label: "Chart Overview" };
}

/** Builds the full context object sent to the chart-qa API on submit. */
export function buildChartContext(params: {
  symbol: string;
  period: PeriodKey;
  candleInterval: CandleIntervalKey;
  indicators: Record<IndicatorKey, boolean>;
  displayHistory: HistoryPoint[];
  signals: TechnicalSignal[];
  news: NewsItem[] | undefined;
  visibleRange: VisibleRange;
  selectedOverlay: Overlay | null;
  selectedStyle: DrawingStyle | null;
  allOverlays: Overlay[];
  pinnedCandleIndex: number | null;
}): ChartQAContext {
  const {
    symbol, period, candleInterval, indicators, displayHistory, signals, news,
    visibleRange, selectedOverlay, selectedStyle, allOverlays, pinnedCandleIndex,
  } = params;

  const selection = resolveSelection({ selectedOverlay, selectedStyle, pinnedCandleIndex, displayHistory, signals });

  const lastIdx = displayHistory.length - 1;
  const from = Math.max(0, Math.min(visibleRange.realFrom, lastIdx));
  const to = Math.max(0, Math.min(visibleRange.realTo, lastIdx));
  const slice = lastIdx >= 0 ? displayHistory.slice(Math.min(from, to), Math.max(from, to) + 1) : [];

  const lows = slice.map((b) => b.low ?? b.close);
  const highs = slice.map((b) => b.high ?? b.close);

  let trendSummary = "Not enough visible history to summarize a trend.";
  if (slice.length >= 2) {
    const first = slice[0];
    const last = slice[slice.length - 1];
    const pct = first.close !== 0 ? ((last.close - first.close) / first.close) * 100 : 0;
    const closes = displayHistory.map((p) => p.close);
    const notes: string[] = [];
    if (indicators.sma50) {
      const sma50 = calcSma(closes, 50);
      const v = sma50[sma50.length - 1];
      if (v != null) notes.push(`${last.close >= v ? "above" : "below"} SMA50`);
    }
    if (indicators.sma200) {
      const sma200 = calcSma(closes, 200);
      const v = sma200[sma200.length - 1];
      if (v != null) notes.push(`${last.close >= v ? "above" : "below"} SMA200`);
    }
    trendSummary = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% over the visible range` + (notes.length > 0 ? `; price ${notes.join(" and ")}` : "");
  }

  let volumeSummary = "Volume data unavailable.";
  const volumes = displayHistory.map((p) => p.volume);
  if (volumes.some((v) => v != null) && slice.length > 0) {
    const volSma = calcVolumeSma(volumes, 20);
    const lastVol = slice[slice.length - 1].volume;
    const lastAvg = volSma[volSma.length - 1];
    if (lastVol != null && lastAvg != null && lastAvg > 0) {
      const ratio = lastVol / lastAvg;
      volumeSummary = `latest bar ${ratio.toFixed(1)}x its 20-bar average volume`;
    }
  }

  const otherDrawings: ChartQAOtherDrawing[] = allOverlays
    .filter((o) => o.id !== selectedOverlay?.id)
    .map((o) => {
      const toolId = OVERLAY_NAME_TO_TOOL_ID[o.name];
      return toolId ? { type: toolId as string, label: DRAWING_TOOL_LABEL[toolId] } : null;
    })
    .filter((d): d is ChartQAOtherDrawing => d !== null)
    .slice(0, 15);

  const anchorDate = selection.candle?.date ?? selection.signal?.date ?? slice[slice.length - 1]?.date ?? displayHistory[lastIdx]?.date;
  const nearbyNews: ChartQANewsItem[] = anchorDate && news?.length
    ? [...news]
        .filter((n) => daysBetween(n.publishedAt, anchorDate) <= 5)
        .sort((a, b) => daysBetween(a.publishedAt, anchorDate) - daysBetween(b.publishedAt, anchorDate))
        .slice(0, 3)
        .map((n) => ({ headline: n.headline, source: n.source, publishedAt: n.publishedAt }))
    : [];

  return {
    symbol,
    periodKey: period,
    candleInterval,
    indicatorsEnabled: (Object.keys(indicators) as IndicatorKey[]).filter((k) => indicators[k]),
    visibleCandleCount: slice.length,
    visibleDateRange: { from: slice[0]?.date ?? "", to: slice[slice.length - 1]?.date ?? "" },
    visiblePriceRange: {
      low: lows.length > 0 ? Math.min(...lows) : 0,
      high: highs.length > 0 ? Math.max(...highs) : 0,
    },
    trendSummary,
    volumeSummary,
    selection,
    otherDrawings,
    nearbyNews,
  };
}
