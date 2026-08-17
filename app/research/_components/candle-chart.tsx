"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryPoint, NewsItem } from "@/lib/types";
import { formatChartPrice } from "@/lib/format";
import { buildTechnicalSummary, calcSma, type CandlePattern } from "@/lib/indicators";
import { buildTechnicalSignals, type TechnicalSignal } from "@/lib/pattern-signals";
import { useChartTheme, type ChartTheme } from "@/app/_components/chart-theme";
import { usePlotDrawOnce } from "@/app/_components/use-in-view-once";
import { PatternAnalysisPanel, type AskAIPayload } from "./pattern-analysis-panel";

/* -------------------------------------------------------------------------- */
/* All colors — categorical overlays included — come from useChartTheme()     */
/* (ct.blue / ct.amber / ct.purple / ct.teal / ct.orange), threaded into the  */
/* tooltip helpers. The previous module-level literals were the dark palette  */
/* and sat at 1.9–2.5:1 on a white canvas (2026-08-08 light-mode audit).      */
/* -------------------------------------------------------------------------- */

type CandleColors = { positive: string; negative: string; axis: string };

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

interface CandleData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma50: number | null;
  sma200: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
}

export interface CandleChartProps {
  symbol: string;
  history: HistoryPoint[];
  since: string;
  /** Listing currency of `history` (Quote.currency). Absent → bare numbers, never assumed dollars. */
  currency?: string | null;
  /** Display label for the current period selector (e.g. "6M") — read-only in the Analysis Panel. */
  periodLabel?: string;
  news?: NewsItem[];
  onAskAI?: (payload: AskAIPayload) => void;
  onOpenTechnical?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Formatters                                                                  */
/* -------------------------------------------------------------------------- */

/* Price ticks/tooltips format through lib/format's formatChartPrice with the
   listing currency — the old local fmtPrice stamped a dollar sign onto every
   market. */

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function fmtDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function fmtAxisDate(date: string, count: number): string {
  const d = new Date(date);
  if (count <= 60) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

/* -------------------------------------------------------------------------- */
/* Custom candlestick bar shape                                                */
/*                                                                            */
/* Recharts passes the bar's pixel coords to the shape function:              */
/*   x, width  — horizontal band from the category (band) scale              */
/*   y, height — the bar's top pixel and height for dataKey="close"          */
/*                                                                            */
/* From y, height, close, and the known y-axis domain [yMin, yMax] we can    */
/* derive the pixel y-position for any other price:                           */
/*   toY(p) = y + height * (1 − (p − yMin) / (close − yMin))                */
/*                                                                            */
/* `indexOffset` translates a rendered-data-local index back into full        */
/* priceData space so `patternMap` lookups stay correct while zoomed (the     */
/* shape function only ever sees the index within whatever `data` array was  */
/* actually passed to the chart — `displayData`, which may be a zoomed slice) */
/* -------------------------------------------------------------------------- */

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: CandleData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function makeCandleShape(
  yMin: number,
  yMax: number,
  patternMap: Map<number, CandlePattern[]>,
  colors: CandleColors,
  indexOffset: number,
  focusRange: { start: number; end: number } | null,
) {
  const { positive: POSITIVE, negative: NEGATIVE, axis: AXIS } = colors;
  return function CandleBarShape(props: BarShapeProps) {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null || width == null || height == null || !payload) return null;

    const { open, high, low, close } = payload;

    // Map a price to a pixel y-coordinate using the bar's own position as reference.
    // Derived analytically from: height = (close − yMin) / (yMax − yMin) * chartH
    const denom = close - yMin;
    const toY = (price: number): number => {
      if (denom <= 0) return y;
      return y + height * (1 - (price - yMin) / denom);
    };

    const yH = toY(high);
    const yL = toY(low);
    const yO = toY(open);
    const yC = toY(close);

    const bullish = close >= open;
    const color = bullish ? POSITIVE : NEGATIVE;
    const bodyTop = Math.min(yO, yC);
    const bodyBot = Math.max(yO, yC);
    const bodyH = Math.max(bodyBot - bodyTop, 1);
    const cx = x + width / 2;
    // Candle body is 70% of bar width, min 1px each side
    const halfW = Math.max(Math.floor(width * 0.35), 1);

    const globalIndex = index != null ? index + indexOffset : null;
    const pats = globalIndex != null ? (patternMap.get(globalIndex) ?? []) : [];
    const hasBullish = pats.some((p) => p.direction === "bullish");
    const hasBearish = pats.some((p) => p.direction === "bearish");
    const hasNeutral = !hasBullish && !hasBearish && pats.some((p) => p.direction === "neutral");

    const dimmed = focusRange != null && index != null && (index < focusRange.start || index > focusRange.end);
    const opacity = dimmed ? 0.25 : 1;

    return (
      <g opacity={opacity}>
        {/* High-to-Low wick */}
        <line x1={cx} y1={yH} x2={cx} y2={yL} stroke={color} strokeWidth={1} />
        {/* Open-to-Close body */}
        <rect
          x={cx - halfW}
          y={bodyTop}
          width={halfW * 2}
          height={bodyH}
          fill={color}
          stroke={color}
          strokeWidth={0.5}
          fillOpacity={bullish ? 0.85 : 1}
        />
        {/* Pattern marker — triangle below wick (bullish) or above wick (bearish) */}
        {hasBullish && yL + 18 < toY(yMin) + 20 && (
          <polygon
            points={`${cx},${yL + 8} ${cx - 4},${yL + 16} ${cx + 4},${yL + 16}`}
            fill={POSITIVE}
            opacity={0.9}
          />
        )}
        {hasBearish && yH - 18 > y - 20 && (
          <polygon
            points={`${cx},${yH - 8} ${cx - 4},${yH - 16} ${cx + 4},${yH - 16}`}
            fill={NEGATIVE}
            opacity={0.9}
          />
        )}
        {hasNeutral && (
          <circle cx={cx} cy={yC - 10} r={3} fill={AXIS} opacity={0.8} />
        )}
      </g>
    );
  };
}

/* -------------------------------------------------------------------------- */
/* Custom tooltips                                                             */
/* -------------------------------------------------------------------------- */

function CandleTooltip({
  active, payload, label,
  currency, showSma50, showSma200, showBB, ct,
}: {
  active?: boolean;
  payload?: { payload: CandleData }[];
  label?: string;
  currency?: string | null;
  showSma50: boolean;
  showSma200: boolean;
  showBB: boolean;
  ct: ChartTheme;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const bullish = row.close >= row.open;
  const ohlc = bullish ? ct.positive : ct.negative;
  const price = (v: number) => formatChartPrice(v, currency);
  return (
    <div style={ct.tooltip}>
      <p className="mb-1.5 text-xs text-muted">{label ? fmtDate(label) : ""}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        <span className="text-muted">O</span>
        <span className="font-mono" style={{ color: ohlc }}>{price(row.open)}</span>
        <span className="text-muted">H</span>
        <span className="font-mono" style={{ color: ohlc }}>{price(row.high)}</span>
        <span className="text-muted">L</span>
        <span className="font-mono" style={{ color: ohlc }}>{price(row.low)}</span>
        <span className="text-muted">C</span>
        <span className="font-mono" style={{ color: ohlc }}>{price(row.close)}</span>
        {row.volume > 0 && <>
          <span className="text-muted">Vol</span>
          <span className="font-mono text-muted">{fmtVol(row.volume)}</span>
        </>}
        {showSma50 && row.sma50 != null && <>
          <span style={{ color: ct.amber }}>SMA 50</span>
          <span className="font-mono">{price(row.sma50)}</span>
        </>}
        {showSma200 && row.sma200 != null && <>
          <span style={{ color: ct.purple }}>SMA 200</span>
          <span className="font-mono">{price(row.sma200)}</span>
        </>}
        {showBB && row.bbUpper != null && <>
          <span style={{ color: ct.teal }}>BB Upper</span>
          <span className="font-mono">{price(row.bbUpper)}</span>
          <span style={{ color: ct.teal }}>BB Lower</span>
          <span className="font-mono">{price(row.bbLower!)}</span>
        </>}
      </div>
    </div>
  );
}

function RsiTooltip({ active, payload, label, ct }: {
  active?: boolean; payload?: { payload: CandleData }[]; label?: string; ct: ChartTheme;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row || row.rsi == null) return null;
  const rsi = row.rsi;
  const color = rsi > 70 ? ct.negative : rsi < 30 ? ct.positive : ct.axis;
  return (
    <div style={ct.tooltip}>
      <p className="mb-1 text-xs text-muted">{label ? fmtDate(label) : ""}</p>
      <p className="text-xs">
        <span className="text-muted mr-2">RSI(14)</span>
        <span className="font-mono" style={{ color }}>{rsi.toFixed(1)}</span>
        {rsi > 70 && <span className="ml-2 text-xs" style={{ color: ct.negative }}>overbought</span>}
        {rsi < 30 && <span className="ml-2 text-xs" style={{ color: ct.positive }}>oversold</span>}
      </p>
    </div>
  );
}

function MacdTooltip({ active, payload, label, ct }: {
  active?: boolean; payload?: { payload: CandleData }[]; label?: string; ct: ChartTheme;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row || row.macd == null) return null;
  return (
    <div style={ct.tooltip}>
      <p className="mb-1 text-xs text-muted">{label ? fmtDate(label) : ""}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        {row.macd != null && <>
          <span style={{ color: ct.blue }}>MACD</span>
          <span className="font-mono">{row.macd.toFixed(3)}</span>
        </>}
        {row.macdSignal != null && <>
          <span style={{ color: ct.orange }}>Signal</span>
          <span className="font-mono">{row.macdSignal.toFixed(3)}</span>
        </>}
        {row.macdHistogram != null && <>
          <span className="text-muted">Histogram</span>
          <span className="font-mono" style={{ color: row.macdHistogram >= 0 ? ct.positive : ct.negative }}>
            {row.macdHistogram.toFixed(3)}
          </span>
        </>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main CandleChart component                                                  */
/* -------------------------------------------------------------------------- */

export function CandleChart({
  symbol,
  history,
  since,
  currency,
  periodLabel,
  news,
  onAskAI = () => {},
  onOpenTechnical = () => {},
}: CandleChartProps) {
  const ct = useChartTheme();
  const AXIS = ct.axis;
  const GRID = ct.grid;
  const POSITIVE = ct.positive;
  const NEGATIVE = ct.negative;

  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(true);
  const [showBB, setShowBB] = useState(false);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);

  // The pattern the user clicked in "Key Technical Signals" — drives the
  // transient zoom/highlight overlay. Independent of `since` (the user's
  // chosen period), which is never touched by this interaction.
  const [focusedSignal, setFocusedSignal] = useState<TechnicalSignal | null>(null);

  // Changing the period always clears any active focus — the overlay
  // shouldn't survive the user picking a different window.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setFocusedSignal(null);
  }, [since]);

  // Escape clears focus too.
  useEffect(() => {
    if (!focusedSignal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusedSignal(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusedSignal]);

  // Compute all indicators over the full history (correct EMA/RSI warm-up)
  const { rsi: fullRsi, macd: fullMacd, bb: fullBb } = useMemo(
    () => buildTechnicalSummary(history),
    [history],
  );

  const sma50Full = useMemo(() => calcSma(history.map((p) => p.close), 50), [history]);
  const sma200Full = useMemo(() => calcSma(history.map((p) => p.close), 200), [history]);

  // Slice to visible period
  const sliced = useMemo(
    () => history.filter((p) => p.date >= since),
    [history, since],
  );

  const fullStart = useMemo(
    () => history.findIndex((p) => p.date >= since),
    [history, since],
  );

  const hasOhlc = sliced.some((p) => p.open != null && p.high != null && p.low != null);

  // Curated technical signals over the FULL history (absolute index) — used
  // for historical-similar-setups stats, which compare across all history,
  // not just the visible window.
  const allSignals = useMemo(() => buildTechnicalSignals(history), [history]);

  // Re-indexed to the visible/sliced window — used for the chart markers,
  // the "Key Technical Signals" list, and click targeting.
  const visibleSignals = useMemo(
    () =>
      allSignals
        .filter((s) => s.index >= fullStart)
        .map((s) => ({ ...s, index: s.index - fullStart })),
    [allSignals, fullStart],
  );

  // Build index → patterns lookup for the shape renderer
  const patternMap = useMemo(() => {
    const m = new Map<number, CandlePattern[]>();
    for (const sig of visibleSignals) {
      const arr = m.get(sig.index) ?? [];
      arr.push(sig);
      m.set(sig.index, arr);
    }
    return m;
  }, [visibleSignals]);

  // Build chart data aligned to the sliced window
  const priceData: CandleData[] = useMemo(
    () =>
      sliced.map((p, i) => {
        const fi = fullStart + i;
        return {
          date: p.date,
          open: p.open ?? p.close,
          high: p.high ?? p.close,
          low: p.low ?? p.close,
          close: p.close,
          volume: p.volume ?? 0,
          sma50: sma50Full[fi] ?? null,
          sma200: sma200Full[fi] ?? null,
          bbUpper: fullBb[fi]?.upper ?? null,
          bbMiddle: fullBb[fi]?.middle ?? null,
          bbLower: fullBb[fi]?.lower ?? null,
          rsi: fullRsi[fi] ?? null,
          macd: fullMacd[fi]?.macd ?? null,
          macdSignal: fullMacd[fi]?.signal ?? null,
          macdHistogram: fullMacd[fi]?.histogram ?? null,
        };
      }),
    [sliced, fullStart, sma50Full, sma200Full, fullBb, fullRsi, fullMacd],
  );

  const hasVolume = priceData.some((d) => d.volume > 0);
  const hasMacdData = priceData.some((d) => d.macd != null);
  const hasRsiData = priceData.some((d) => d.rsi != null);
  const count = priceData.length;

  // Transient zoom window — layered on top of `since`, cleared automatically
  // when the period changes or when focus is cleared. Padding is a fixed
  // context window around the pattern's own span (tunable per pattern).
  const zoomDomain = useMemo(() => {
    if (!focusedSignal) return null;
    const idx = focusedSignal.index;
    if (idx < 0 || idx >= priceData.length) return null;
    const pad = 8;
    const start = Math.max(0, idx - focusedSignal.span + 1 - pad);
    const end = Math.min(priceData.length - 1, idx + pad);
    return { start, end };
  }, [focusedSignal, priceData.length]);

  const displayData = useMemo(
    () => (zoomDomain ? priceData.slice(zoomDomain.start, zoomDomain.end + 1) : priceData),
    [priceData, zoomDomain],
  );

  // The candle span the pattern actually covers, in displayData-local index
  // space — everything else in the zoomed view dims.
  const focusRange = useMemo(() => {
    if (!focusedSignal || !zoomDomain) return null;
    const highlightEnd = focusedSignal.index - zoomDomain.start;
    const highlightStart = highlightEnd - focusedSignal.span + 1;
    return {
      start: Math.max(0, highlightStart),
      end: Math.min(displayData.length - 1, highlightEnd),
    };
  }, [focusedSignal, zoomDomain, displayData.length]);

  // Y-axis domain with 3% padding so wicks and pattern markers stay in view.
  // Derived from displayData so a zoomed view gets a tighter, more legible
  // domain (identical to the full domain when not zoomed, since
  // displayData === priceData in that case).
  const yMin = useMemo(() => Math.min(...displayData.map((d) => d.low)) * 0.97, [displayData]);
  const yMax = useMemo(() => Math.max(...displayData.map((d) => d.high)) * 1.03, [displayData]);

  // Memoize the shape renderer so it only regenerates when domain or patterns change
  const candleShape = useMemo(
    () =>
      makeCandleShape(
        yMin,
        yMax,
        patternMap,
        { positive: POSITIVE, negative: NEGATIVE, axis: AXIS },
        zoomDomain?.start ?? 0,
        focusRange,
      ),
    [yMin, yMax, patternMap, POSITIVE, NEGATIVE, AXIS, zoomDomain, focusRange],
  );

  // Key Technical Signals — the curated, confidence-scored list (already
  // filtered + sorted most-recent-first by buildTechnicalSignals). Capped for
  // compactness; unlike the old dedup-by-name cap, distinct occurrences of the
  // same pattern at different dates are each meaningful and kept.
  const keySignals = useMemo(() => visibleSignals.slice(0, 8), [visibleSignals]);

  const [plotRef, drawPlot] = usePlotDrawOnce<HTMLDivElement>();

  function handleSignalClick(sig: TechnicalSignal) {
    setFocusedSignal((prev) =>
      prev && prev.name === sig.name && prev.date === sig.date ? null : sig,
    );
  }

  if (sliced.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">
        No price history available
      </div>
    );
  }

  return (
    <div ref={plotRef} className="flex flex-col gap-1.5">
      {/* ── Overlay / indicator toggles ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <span className="text-xs text-muted mr-1">Overlays</span>
        {([
          { key: "sma50",  label: "SMA 50",   active: showSma50,  toggle: () => setShowSma50((v) => !v),  cls: "bg-amber-500/20 text-warning" },
          { key: "sma200", label: "SMA 200",  active: showSma200, toggle: () => setShowSma200((v) => !v), cls: "bg-purple-500/20 text-purple-400 light:text-purple-700" },
          { key: "bb",     label: "BB(20,2)", active: showBB,     toggle: () => setShowBB((v) => !v),     cls: "bg-teal-500/20 text-teal-400 light:text-teal-700" },
        ] as const).map(({ key, label, active, toggle, cls }) => (
          <button
            key={key}
            onClick={toggle}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active ? cls : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="h-4 w-px bg-border" />
        <span className="text-xs text-muted mr-1">Indicators</span>
        {([
          { key: "rsi",  label: "RSI(14)", active: showRsi,  toggle: () => setShowRsi((v) => !v) },
          { key: "macd", label: "MACD",    active: showMacd, toggle: () => setShowMacd((v) => !v) },
        ] as const).map(({ key, label, active, toggle }) => (
          <button
            key={key}
            onClick={toggle}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active ? "bg-blue-500/20 text-blue-400 light:text-sky-700" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        {focusedSignal && (
          <>
            <span className="h-4 w-px bg-border" />
            <button
              onClick={() => setFocusedSignal(null)}
              className="rounded px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-surface-2"
            >
              ✕ Clear focus
            </button>
          </>
        )}
      </div>

      {/* ── OHLC warning ─────────────────────────────────────────────────── */}
      {!hasOhlc && (
        <p className="px-1 text-xs text-muted">
          OHLC data not available — showing close price only.
        </p>
      )}

      {/* ── Main candlestick chart ───────────────────────────────────────── */}
      <motion.div
        key={focusedSignal ? `${focusedSignal.name}-${focusedSignal.date}` : "full"}
        initial={{ opacity: 0.4, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={displayData}
            margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
            syncId="uaa-candle"
            barCategoryGap="10%"
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="date"
              stroke={AXIS}
              tick={{ fontSize: 11, fill: AXIS }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(d) => fmtAxisDate(d, count)}
              minTickGap={48}
            />
            <YAxis
              stroke={AXIS}
              tick={{ fontSize: 11, fill: AXIS }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatChartPrice(v, currency)}
              width={56}
              domain={[yMin, yMax]}
            />
            <Tooltip
              content={
                <CandleTooltip
                  currency={currency}
                  showSma50={showSma50}
                  showSma200={showSma200}
                  showBB={showBB}
                  ct={ct}
                />
              }
            />

            {/*
             * The Bar with shape={candleShape} is the core of the candle rendering.
             * dataKey="close" gives Recharts a value to compute y and height from.
             * The shape function uses those pixel values plus yMin/yMax (closure) to
             * derive pixel positions for open, high, and low and draws the full candle.
             * fillOpacity/strokeOpacity=0 hides the default bar rect — only our SVG shows.
             *
             * Recharts can't animate a custom `shape`, so the first draw is a CSS
             * sweep across the whole candle layer instead (.animate-plot-draw),
             * gated on the same one-shot in-view flag the price chart uses — so a
             * period or overlay change never redraws candles already on screen.
             */}
            <Bar
              dataKey="close"
              fillOpacity={0}
              strokeOpacity={0}
              isAnimationActive={false}
              shape={candleShape}
              className={drawPlot ? "animate-plot-draw" : undefined}
            />

            {/* SMA overlays */}
            {showSma50 && (
              <Line type="monotone" dataKey="sma50" stroke={ct.amber} strokeWidth={1.5}
                dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            )}
            {showSma200 && (
              <Line type="monotone" dataKey="sma200" stroke={ct.purple} strokeWidth={1.5}
                strokeDasharray="5 3" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            )}

            {/* Bollinger Bands — three lines (upper, middle, lower) */}
            {showBB && (
              <>
                <Line type="monotone" dataKey="bbUpper" stroke={ct.teal} strokeWidth={1}
                  strokeOpacity={0.7} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="bbMiddle" stroke={ct.teal} strokeWidth={0.8}
                  strokeDasharray="4 3" strokeOpacity={0.45} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="bbLower" stroke={ct.teal} strokeWidth={1}
                  strokeOpacity={0.7} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </motion.div>

      {/* ── Volume sub-chart ─────────────────────────────────────────────── */}
      {hasVolume && (
        <ResponsiveContainer width="100%" height={52}>
          <BarChart
            data={displayData}
            margin={{ top: 0, right: 4, left: 0, bottom: 0 }}
            barCategoryGap="10%"
            syncId="uaa-candle"
          >
            <XAxis dataKey="date" hide />
            <YAxis
              stroke={AXIS}
              tick={{ fontSize: 9, fill: AXIS }}
              tickLine={false}
              axisLine={false}
              tickCount={2}
              width={56}
              tickFormatter={fmtVol}
            />
            <Tooltip content={() => null} cursor={{ fill: ct.cursorFill }} />
            <Bar
              dataKey="volume"
              fill={ct.blue}
              fillOpacity={0.4}
              radius={[1, 1, 0, 0]}
              maxBarSize={8}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* ── RSI sub-panel ────────────────────────────────────────────────── */}
      {showRsi && hasRsiData && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs font-medium text-muted">RSI (14)</span>
            {(() => {
              const last = [...priceData].reverse().find((d) => d.rsi != null)?.rsi;
              if (last == null) return null;
              const color = last > 70 ? NEGATIVE : last < 30 ? POSITIVE : AXIS;
              return (
                <>
                  <span className="font-mono text-xs" style={{ color }}>{last.toFixed(1)}</span>
                  <span className="text-xs" style={{ color }}>
                    {last > 70 ? "Overbought" : last < 30 ? "Oversold" : "Neutral"}
                  </span>
                </>
              );
            })()}
          </div>
          <ResponsiveContainer width="100%" height={72}>
            <ComposedChart
              data={displayData}
              margin={{ top: 2, right: 4, left: 0, bottom: 0 }}
              syncId="uaa-candle"
            >
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis
                stroke={AXIS}
                tick={{ fontSize: 9, fill: AXIS }}
                tickLine={false}
                axisLine={false}
                width={56}
                domain={[0, 100]}
                ticks={[30, 50, 70]}
              />
              <ReferenceLine y={70} stroke={NEGATIVE} strokeDasharray="3 2" strokeOpacity={0.5} />
              <ReferenceLine y={30} stroke={POSITIVE} strokeDasharray="3 2" strokeOpacity={0.5} />
              <Tooltip content={<RsiTooltip ct={ct} />} />
              <Line type="monotone" dataKey="rsi" stroke={ct.blue} strokeWidth={1.5}
                dot={false} activeDot={{ r: 3, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── MACD sub-panel ───────────────────────────────────────────────── */}
      {showMacd && hasMacdData && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-3 px-1">
            <span className="text-xs font-medium text-muted">MACD (12, 26, 9)</span>
            {(() => {
              const last = [...priceData].reverse().find((d) => d.macdHistogram != null);
              if (!last) return null;
              // Detect most recent crossover
              let crossLabel: string | null = null;
              let crossColor = AXIS;
              for (let i = priceData.length - 1; i >= 1; i--) {
                const cur = priceData[i];
                const prev = priceData[i - 1];
                if (cur.macd == null || cur.macdSignal == null) continue;
                if (prev.macd == null || prev.macdSignal == null) continue;
                if (prev.macd <= prev.macdSignal && cur.macd > cur.macdSignal) {
                  crossLabel = "Bullish crossover"; crossColor = POSITIVE;
                } else if (prev.macd >= prev.macdSignal && cur.macd < cur.macdSignal) {
                  crossLabel = "Bearish crossover"; crossColor = NEGATIVE;
                }
                break;
              }
              return (
                <>
                  {last.macdHistogram != null && (
                    <span className="font-mono text-xs"
                      style={{ color: last.macdHistogram >= 0 ? POSITIVE : NEGATIVE }}>
                      {last.macdHistogram.toFixed(3)}
                    </span>
                  )}
                  {crossLabel && (
                    <span className="text-xs" style={{ color: crossColor }}>{crossLabel}</span>
                  )}
                </>
              );
            })()}
          </div>
          <ResponsiveContainer width="100%" height={72}>
            <ComposedChart
              data={displayData}
              margin={{ top: 2, right: 4, left: 0, bottom: 0 }}
              syncId="uaa-candle"
            >
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis
                stroke={AXIS}
                tick={{ fontSize: 9, fill: AXIS }}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => v.toFixed(2)}
              />
              <ReferenceLine y={0} stroke={GRID} strokeDasharray="4 2" />
              <Tooltip content={<MacdTooltip ct={ct} />} />
              <Bar dataKey="macdHistogram" fill={ct.blue} fillOpacity={0.5}
                maxBarSize={6} isAnimationActive={false} />
              <Line type="monotone" dataKey="macd" stroke={ct.blue} strokeWidth={1.5}
                dot={false} activeDot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="macdSignal" stroke={ct.orange} strokeWidth={1.5}
                strokeDasharray="4 2" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Analysis Panel — opens when a Key Technical Signal is clicked ─── */}
      {focusedSignal && (
        <PatternAnalysisPanel
          signal={focusedSignal}
          symbol={symbol}
          points={history}
          allSignals={allSignals}
          news={news}
          period={periodLabel ?? ""}
          onClose={() => setFocusedSignal(null)}
          onAskAI={onAskAI}
          onOpenTechnical={onOpenTechnical}
        />
      )}

      {/* ── Key Technical Signals ────────────────────────────────────────── */}
      {keySignals.length > 0 && (
        <div className="mt-1 rounded-lg border border-border bg-surface-2 p-3">
          <p className="mb-2 text-xs font-medium text-muted uppercase tracking-wide">
            Key Technical Signals
          </p>
          <div className="flex flex-col gap-1">
            {keySignals.map((sig) => {
              const isFocused = focusedSignal?.name === sig.name && focusedSignal?.date === sig.date;
              return (
                <button
                  key={`${sig.name}-${sig.date}`}
                  onClick={() => handleSignalClick(sig)}
                  className={`flex items-start gap-2.5 rounded-md p-1.5 text-left transition-colors ${
                    isFocused ? "bg-brand/10" : "hover:bg-surface-3"
                  }`}
                >
                  <span
                    className="mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium"
                    style={{
                      background: `color-mix(in srgb, ${
                        sig.direction === "bullish" ? POSITIVE
                        : sig.direction === "bearish" ? NEGATIVE
                        : AXIS
                      } 15%, transparent)`,
                      color:
                        sig.direction === "bullish" ? POSITIVE
                        : sig.direction === "bearish" ? NEGATIVE
                        : AXIS,
                    }}
                  >
                    {sig.direction === "bullish" ? "▲" : sig.direction === "bearish" ? "▼" : "●"}{" "}
                    {sig.name}
                  </span>
                  <span className="flex-1 text-xs leading-relaxed text-muted">{sig.description}</span>
                  <span className="shrink-0 font-mono text-xs text-faint">{sig.confidence}%</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-1 pt-1">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: POSITIVE }} />
          Bullish candle
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: NEGATIVE }} />
          Bearish candle
        </span>
        {visibleSignals.length > 0 && (
          <>
            <span className="flex items-center gap-1 text-xs text-muted">
              <span style={{ color: POSITIVE }}>▲</span> Bullish signal
            </span>
            <span className="flex items-center gap-1 text-xs text-muted">
              <span style={{ color: NEGATIVE }}>▼</span> Bearish signal
            </span>
          </>
        )}
      </div>
    </div>
  );
}
