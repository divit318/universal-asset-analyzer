"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, Redo2, Trash2, Undo2, X } from "lucide-react";
import type { Chart, Crosshair, Overlay } from "klinecharts";
import type { HistoryPoint, NewsItem } from "@/lib/types";
import { buildTechnicalSignals } from "@/lib/pattern-signals";
import { aggregateToFourHour, aggregateToMonthly, aggregateToWeekly } from "@/lib/chart-aggregation";
import type { IntradayInterval } from "@/lib/yahoo";
import type { ChartQARelatedTarget } from "@/lib/ai-chart-qa";
import "./overlays"; // registers custom overlay templates (pitchfork/measure/risk-reward/arrow) once, as a side effect
import { KLineChart } from "./kline-chart";
import { DrawingToolbar } from "./drawing-toolbar";
import { DrawingPropertiesPanel } from "./drawing-properties-panel";
import { CrosshairPanel } from "./crosshair-panel";
import { AIDock } from "./ai-dock";
import { buildChartContext, resolveSelection } from "./build-chart-context";
import { useChartDrawings } from "./use-chart-drawings";
import { useDrawingHistory } from "./use-drawing-history";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { getPreferredDrawingStyle, setPreferredDrawingStyle } from "./style-preferences";
import { getWorkspacePreferences, setWorkspacePreferences } from "./workspace-preferences";
import { OVERLAY_NAME_TO_TOOL_ID } from "./drawing-categories";
import type { CandleIntervalKey, DrawingStyle, DrawingToolId, IndicatorKey, PeriodKey } from "./types";
import type { AskAIPayload } from "../pattern-analysis-panel";

const PERIODS: PeriodKey[] = ["1W", "1M", "3M", "6M", "YTD", "1Y", "Max"];
const PERIOD_DAYS: Partial<Record<PeriodKey, number>> = { "1W": 7, "1M": 30, "3M": 91, "6M": 183, "1Y": 365 };

const CANDLE_INTERVALS: CandleIntervalKey[] = ["5m", "15m", "30m", "1H", "4H", "1D", "1W", "1M"];
const INTRADAY_ONLY = new Set<CandleIntervalKey>(["5m", "15m", "30m", "1H", "4H"]);
/** Which real Yahoo interval to fetch for each intraday tier — 4H has no native equivalent, so it fetches 60m and aggregates client-side (lib/chart-aggregation.ts). */
const YAHOO_INTERVAL_BY_CANDLE: Partial<Record<CandleIntervalKey, IntradayInterval>> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1H": "60m",
  "4H": "60m",
};
/** klinecharts' own Period, for its axis/date formatting — independent of our fetch/aggregation logic above. */
const KLINE_PERIOD_BY_INTERVAL: Record<CandleIntervalKey, { type: "minute" | "hour" | "day" | "week" | "month"; span: number }> = {
  "5m": { type: "minute", span: 5 },
  "15m": { type: "minute", span: 15 },
  "30m": { type: "minute", span: 30 },
  "1H": { type: "hour", span: 1 },
  "4H": { type: "hour", span: 4 },
  "1D": { type: "day", span: 1 },
  "1W": { type: "week", span: 1 },
  "1M": { type: "month", span: 1 },
};

// Drawings are scoped by (symbol, timeframe) using the Date Range period-key
// string as the "timeframe" — every drawing is timeframe-specific (the plan's
// assumption), and Date Range (not Candle Interval) is what "timeframe" means
// here, matching interactive-chart.tsx's own period selector.
function getPeriodStart(period: PeriodKey): string {
  if (period === "YTD") return `${new Date().getFullYear()}-01-01`;
  if (period === "Max") return "1900-01-01";
  const days = PERIOD_DAYS[period]!;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysForPeriod(period: PeriodKey): number {
  if (period === "YTD") {
    const start = new Date(new Date().getFullYear(), 0, 1);
    return Math.max(1, Math.ceil((Date.now() - start.getTime()) / 86_400_000));
  }
  if (period === "Max") return 3650; // Yahoo self-limits intraday retention regardless of what we ask for
  return PERIOD_DAYS[period]!;
}

export interface ChartWorkspaceProps {
  symbol: string;
  history: HistoryPoint[];
  news?: NewsItem[];
  onClose: () => void;
  /** Related Context navigation from the AI dock — "earnings"/"analysis" switch tabs, "copilot" asks the Research Copilot. */
  onNavigate: (target: ChartQARelatedTarget, payload?: AskAIPayload) => void;
}

/**
 * Fullscreen Mode — the dedicated technical-analysis workspace. Shows only
 * the candlestick chart, drawing toolbar, price/time scales, Date Range and
 * Candle Interval selectors, and ticker info; everything else (nav,
 * portfolio, news, AI panels) is left behind entirely since this renders via
 * a portal outside the Research page's own layout.
 *
 * The caller must render this keyed by symbol (`<ChartWorkspace key={symbol} .../>`)
 * so switching symbols remounts it fresh — `chart` state and the drawing
 * hooks below assume a stable symbol for their whole lifetime rather than
 * resetting on prop change.
 */
export function ChartWorkspace({ symbol, history, news, onClose, onNavigate }: ChartWorkspaceProps) {
  const initialPrefs = useMemo(() => getWorkspacePreferences(), []);

  const [period, setPeriod] = useState<PeriodKey>(initialPrefs.dateRange);
  const [candleInterval, setCandleInterval] = useState<CandleIntervalKey>(initialPrefs.candleInterval);
  const [toolbarPinned, setToolbarPinned] = useState(initialPrefs.toolbarPinned);
  const [indicators, setIndicators] = useState<Record<IndicatorKey, boolean>>(initialPrefs.indicators);

  const [chart, setChart] = useState<Chart | null>(null);
  const [crosshair, setCrosshair] = useState<Crosshair | null>(null);
  // Click-driven, not hover-driven — sticky until a different candle (or a
  // drawing) is selected, so it survives moving the mouse away to type into
  // the AI dock. See build-chart-context.ts's resolveSelection for why this
  // is kept separate from the (purely visual, hover-driven) `crosshair` state.
  const [pinnedCandleIndex, setPinnedCandleIndex] = useState<number | null>(null);
  const [cleanView, setCleanViewState] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [intradayData, setIntradayData] = useState<HistoryPoint[]>([]);
  const [intradayLimitDays, setIntradayLimitDays] = useState<number | null>(null);
  const [drawingNudge, setDrawingNudge] = useState<{ toolId: DrawingToolId; overlayId: string } | null>(null);

  // Persist workspace chrome preferences (global — see workspace-preferences.ts) whenever any of them change.
  useEffect(() => {
    setWorkspacePreferences({ toolbarPinned, dateRange: period, candleInterval, indicators });
  }, [toolbarPinned, period, candleInterval, indicators]);

  // A pinned candle index is only meaningful for the bar array it was clicked
  // in — switching interval/period reshapes displayHistory entirely, so a
  // stale index would silently point at the wrong candle.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setPinnedCandleIndex(null);
  }, [candleInterval, period]);

  const since = useMemo(() => getPeriodStart(period), [period]);
  const sliced = useMemo(() => history.filter((p) => p.date >= since), [history, since]);

  // Fetch real intraday bars only for intervals that need them (5m/15m/30m/1H/4H).
  // 1D/1W/1M never leave the browser — derived from `sliced` below.
  useEffect(() => {
    const yahooInterval = YAHOO_INTERVAL_BY_CANDLE[candleInterval];
    if (!yahooInterval) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setIntradayData([]);
      setIntradayLimitDays(null);
      return;
    }
    let cancelled = false;
    const requestedDays = daysForPeriod(period);
    fetch(`/api/chart-history?symbol=${encodeURIComponent(symbol)}&interval=${yahooInterval}&days=${requestedDays}`)
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ history: HistoryPoint[]; requestedDays: number; availableDays: number }>)
          : { history: [], requestedDays, availableDays: requestedDays },
      )
      .then(({ history: fetched, availableDays }) => {
        if (cancelled) return;
        setIntradayData(fetched ?? []);
        setIntradayLimitDays(availableDays < requestedDays ? availableDays : null);
      })
      .catch(() => {
        if (!cancelled) {
          setIntradayData([]);
          setIntradayLimitDays(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, candleInterval, period]);

  const displayHistory = useMemo(() => {
    switch (candleInterval) {
      case "1D":
        return sliced;
      case "1W":
        return aggregateToWeekly(sliced);
      case "1M":
        return aggregateToMonthly(sliced);
      case "4H":
        return aggregateToFourHour(intradayData);
      default:
        return intradayData; // 5m/15m/30m/1H — fetched directly at that interval
    }
  }, [candleInterval, sliced, intradayData]);

  const klinePeriod = KLINE_PERIOD_BY_INTERVAL[candleInterval];
  const showTimeInPanel = INTRADAY_ONLY.has(candleInterval);

  // Deterministic, non-AI pattern detection over whatever bars are currently
  // displayed — reused as-is from the pattern-signals feature, not rebuilt.
  const signals = useMemo(() => buildTechnicalSignals(displayHistory), [displayHistory]);

  const drawingHistory = useDrawingHistory(`${symbol}:${period}`);
  // Stable identity (empty deps) — never causes attachEvents/useChartDrawings'
  // restore-drawings effect to refire, matching the fix for the infinite-loop
  // bug this exact hook hit earlier (see use-chart-drawings.ts's own notes).
  const handleDrawingCreated = useCallback((overlay: Overlay) => {
    const toolId = OVERLAY_NAME_TO_TOOL_ID[overlay.name];
    if (!toolId) return;
    setDrawingNudge({ toolId, overlayId: overlay.id });
  }, []);
  const drawings = useChartDrawings(chart, symbol, period, drawingHistory, handleDrawingCreated);
  const selectedStyle = drawings.getSelectedStyle();

  const selectedOverlay = useMemo(
    () => (chart && drawings.selectedOverlayId ? (chart.getOverlays({ id: drawings.selectedOverlayId })[0] ?? null) : null),
    [chart, drawings.selectedOverlayId],
  );

  // The AI dock's context indicator + rotating placeholder examples — cheap,
  // recomputed whenever the selected drawing or pinned candle changes.
  const selection = useMemo(
    () => resolveSelection({ selectedOverlay, selectedStyle, pinnedCandleIndex, displayHistory, signals }),
    [selectedOverlay, selectedStyle, pinnedCandleIndex, displayHistory, signals],
  );

  // The heavier context build (slicing/trend-volume summary/news filter) only
  // ever runs on submit, never on click/hover — see build-chart-context.ts's own note.
  const handleBuildContext = useCallback(
    () =>
      buildChartContext({
        symbol,
        period,
        candleInterval,
        indicators,
        displayHistory,
        signals,
        news,
        visibleRange: chart?.getVisibleRange() ?? { from: 0, to: displayHistory.length - 1, realFrom: 0, realTo: displayHistory.length - 1 },
        selectedOverlay,
        selectedStyle,
        allOverlays: chart?.getOverlays() ?? [],
        pinnedCandleIndex,
      }),
    [symbol, period, candleInterval, indicators, displayHistory, signals, news, chart, selectedOverlay, selectedStyle, pinnedCandleIndex],
  );

  // The nudge only stays visible while its own drawing is still the selected
  // one (or nothing else has been selected yet) — selecting a DIFFERENT
  // drawing implicitly dismisses it. A derived value, not an effect: no
  // setState-in-effect needed since this never needs to persist past a render.
  const activeDrawingNudge =
    drawingNudge && (!drawings.selectedOverlayId || drawings.selectedOverlayId === drawingNudge.overlayId) ? drawingNudge : null;

  const dismissDrawingNudge = useCallback(() => setDrawingNudge(null), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmClear) {
        setConfirmClear(false);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, confirmClear]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useKeyboardShortcuts({
    onDelete: drawings.deleteSelected,
    onUndo: drawingHistory.undo,
    onRedo: drawingHistory.redo,
  });

  const handleSelectTool = useCallback(
    (toolId: DrawingToolId) => drawings.createDrawing(toolId, getPreferredDrawingStyle()),
    [drawings],
  );

  const handleStyleChange = useCallback(
    (style: DrawingStyle) => {
      drawings.updateSelectedStyle(style);
      setPreferredDrawingStyle(style);
    },
    [drawings],
  );

  function toggleCleanView() {
    const next = !cleanView;
    setCleanViewState(next);
    drawings.setCleanView(next);
  }

  return createPortal(
    <div className="fixed inset-0 z-[300] flex flex-col bg-background">
      {/* Header — compact, two rows: data controls, then actions. */}
      <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm font-semibold text-foreground">{symbol}</span>

          <div className="flex items-center gap-2">
            <span className="text-micro font-semibold uppercase tracking-wide text-faint">Range</span>
            <div className="flex items-center gap-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    period === p ? "bg-brand-strong text-background" : "text-muted hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <span className="h-4 w-px bg-border" />

          <div className="flex items-center gap-2">
            <span className="text-micro font-semibold uppercase tracking-wide text-faint">Interval</span>
            <div className="flex items-center gap-0.5">
              {CANDLE_INTERVALS.map((i) => (
                <button
                  key={i}
                  onClick={() => setCandleInterval(i)}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    candleInterval === i ? "bg-brand-strong text-background" : "text-muted hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          {intradayLimitDays != null && (
            <span className="text-micro text-faint">
              {candleInterval} data only goes back {intradayLimitDays}d on Yahoo — showing the max available range
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={drawingHistory.undo}
              disabled={!drawingHistory.canUndo}
              title="Undo (Cmd/Ctrl+Z)"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Undo2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Undo
            </button>
            <button
              onClick={drawingHistory.redo}
              disabled={!drawingHistory.canRedo}
              title="Redo (Cmd/Ctrl+Shift+Z)"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Redo2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Redo
            </button>
            <span className="mx-1 h-4 w-px bg-border" />
            <button
              onClick={() => setConfirmClear(true)}
              title="Clear all drawings"
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Clear All
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleCleanView}
              aria-pressed={cleanView}
              title={cleanView ? "Clean View is ON — showing price action only" : "Clean View is OFF — showing all drawings"}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                cleanView ? "bg-brand text-background" : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {cleanView ? <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />}
              Clean View {cleanView ? "ON" : "OFF"}
            </button>
            <span className="mx-1 h-4 w-px bg-border" />
            <button
              onClick={onClose}
              aria-label="Exit fullscreen"
              className="rounded p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      {/* Body — toolbar/chart/properties row, then the AI dock docked below it */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          <DrawingToolbar
            onSelectTool={handleSelectTool}
            pinned={toolbarPinned}
            onTogglePin={() => setToolbarPinned((v) => !v)}
          />
          <div className="min-w-0 flex-1 overflow-hidden">
            <KLineChart
              symbol={symbol}
              history={displayHistory}
              period={klinePeriod}
              initialIndicators={indicators}
              onIndicatorsChange={setIndicators}
              onReady={setChart}
              onCrosshairChange={setCrosshair}
              onCandleClick={setPinnedCandleIndex}
              overlay={
                <CrosshairPanel
                  crosshair={crosshair}
                  points={displayHistory}
                  signals={signals}
                  news={news}
                  showTime={showTimeInPanel}
                />
              }
            />
          </div>
          {selectedStyle && (
            <DrawingPropertiesPanel
              key={drawings.selectedOverlayId}
              style={selectedStyle}
              onChange={handleStyleChange}
              onDelete={drawings.deleteSelected}
            />
          )}
        </div>

        <AIDock
          selection={selection}
          buildContext={handleBuildContext}
          onNavigate={onNavigate}
          nudge={activeDrawingNudge}
          onDismissNudge={dismissDrawingNudge}
        />
      </div>

      {/*
       * A local confirm panel, not the shared ConfirmDialog — that component
       * portals to document.body at a fixed z-50, which would render BEHIND
       * this workspace's own z-[300] layer (both are document.body siblings,
       * so stacking is z-index-only). Rendering inline here instead keeps it
       * in the same stacking context, above everything in the workspace.
       */}
      {confirmClear && (
        <div className="fixed inset-0 z-10 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmClear(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <h2 className="text-base font-semibold">Clear all drawings?</h2>
            <p className="mt-2 text-sm text-muted">
              This removes every drawing for {symbol} on the {period} timeframe. This can&apos;t be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setConfirmClear(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void drawings.clearAll();
                  setConfirmClear(false);
                }}
                className="rounded-lg border border-negative/30 bg-negative/15 px-4 py-2 text-sm font-medium text-negative transition-colors hover:bg-negative/25"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
