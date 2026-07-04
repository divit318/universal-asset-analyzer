"use client";

import { useMemo, useState } from "react";
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
import type { HistoryPoint } from "@/lib/types";
import {
  buildTechnicalSummary,
  calcSma,
  type CandlePattern,
} from "@/lib/indicators";

/* -------------------------------------------------------------------------- */
/* Color constants (matches interactive-chart.tsx palette)                    */
/* -------------------------------------------------------------------------- */

const AXIS = "#9aa3af";
const GRID = "#272b33";
const POSITIVE = "#4ade80";
const NEGATIVE = "#f87171";
const BLUE = "#60a5fa";
const AMBER = "#fbbf24";
const PURPLE = "#a78bfa";
const TEAL = "#2dd4bf";
const ORANGE = "#fb923c";

const TOOLTIP_STYLE = {
  background: "#14161a",
  border: "1px solid #272b33",
  borderRadius: 8,
  fontSize: 12,
  padding: "8px 12px",
};

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
  history: HistoryPoint[];
  since: string;
}

/* -------------------------------------------------------------------------- */
/* Formatters                                                                  */
/* -------------------------------------------------------------------------- */

function fmtPrice(v: number): string {
  return v < 10 ? `$${v.toFixed(2)}` : v < 100 ? `$${v.toFixed(1)}` : `$${v.toFixed(0)}`;
}

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
) {
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

    const pats = index != null ? (patternMap.get(index) ?? []) : [];
    const hasBullish = pats.some((p) => p.direction === "bullish");
    const hasBearish = pats.some((p) => p.direction === "bearish");
    const hasNeutral = !hasBullish && !hasBearish && pats.some((p) => p.direction === "neutral");

    return (
      <g>
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
  showSma50, showSma200, showBB,
}: {
  active?: boolean;
  payload?: { payload: CandleData }[];
  label?: string;
  showSma50: boolean;
  showSma200: boolean;
  showBB: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const bullish = row.close >= row.open;
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="mb-1.5 text-xs text-muted">{label ? fmtDate(label) : ""}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        <span className="text-muted">O</span>
        <span className="font-mono" style={{ color: bullish ? POSITIVE : NEGATIVE }}>{fmtPrice(row.open)}</span>
        <span className="text-muted">H</span>
        <span className="font-mono" style={{ color: bullish ? POSITIVE : NEGATIVE }}>{fmtPrice(row.high)}</span>
        <span className="text-muted">L</span>
        <span className="font-mono" style={{ color: bullish ? POSITIVE : NEGATIVE }}>{fmtPrice(row.low)}</span>
        <span className="text-muted">C</span>
        <span className="font-mono" style={{ color: bullish ? POSITIVE : NEGATIVE }}>{fmtPrice(row.close)}</span>
        {row.volume > 0 && <>
          <span className="text-muted">Vol</span>
          <span className="font-mono text-muted">{fmtVol(row.volume)}</span>
        </>}
        {showSma50 && row.sma50 != null && <>
          <span style={{ color: AMBER }}>SMA 50</span>
          <span className="font-mono">{fmtPrice(row.sma50)}</span>
        </>}
        {showSma200 && row.sma200 != null && <>
          <span style={{ color: PURPLE }}>SMA 200</span>
          <span className="font-mono">{fmtPrice(row.sma200)}</span>
        </>}
        {showBB && row.bbUpper != null && <>
          <span style={{ color: TEAL }}>BB Upper</span>
          <span className="font-mono">{fmtPrice(row.bbUpper)}</span>
          <span style={{ color: TEAL }}>BB Lower</span>
          <span className="font-mono">{fmtPrice(row.bbLower!)}</span>
        </>}
      </div>
    </div>
  );
}

function RsiTooltip({ active, payload, label }: {
  active?: boolean; payload?: { payload: CandleData }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row || row.rsi == null) return null;
  const rsi = row.rsi;
  const color = rsi > 70 ? NEGATIVE : rsi < 30 ? POSITIVE : AXIS;
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="mb-1 text-xs text-muted">{label ? fmtDate(label) : ""}</p>
      <p className="text-xs">
        <span className="text-muted mr-2">RSI(14)</span>
        <span className="font-mono" style={{ color }}>{rsi.toFixed(1)}</span>
        {rsi > 70 && <span className="ml-2 text-xs" style={{ color: NEGATIVE }}>overbought</span>}
        {rsi < 30 && <span className="ml-2 text-xs" style={{ color: POSITIVE }}>oversold</span>}
      </p>
    </div>
  );
}

function MacdTooltip({ active, payload, label }: {
  active?: boolean; payload?: { payload: CandleData }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row || row.macd == null) return null;
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="mb-1 text-xs text-muted">{label ? fmtDate(label) : ""}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        {row.macd != null && <>
          <span style={{ color: BLUE }}>MACD</span>
          <span className="font-mono">{row.macd.toFixed(3)}</span>
        </>}
        {row.macdSignal != null && <>
          <span style={{ color: ORANGE }}>Signal</span>
          <span className="font-mono">{row.macdSignal.toFixed(3)}</span>
        </>}
        {row.macdHistogram != null && <>
          <span className="text-muted">Histogram</span>
          <span className="font-mono" style={{ color: row.macdHistogram >= 0 ? POSITIVE : NEGATIVE }}>
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

export function CandleChart({ history, since }: CandleChartProps) {
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(true);
  const [showBB, setShowBB] = useState(false);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);

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

  // Detect patterns over full history; keep those in visible window
  const allPatterns = useMemo(() => buildTechnicalSummary(history).patterns, [history]);
  const visiblePatterns = useMemo(
    () =>
      allPatterns
        .filter((p) => p.index >= fullStart)
        .map((p) => ({ ...p, index: p.index - fullStart })),
    [allPatterns, fullStart],
  );

  // Build index → patterns lookup for the shape renderer
  const patternMap = useMemo(() => {
    const m = new Map<number, CandlePattern[]>();
    for (const pat of visiblePatterns) {
      const arr = m.get(pat.index) ?? [];
      arr.push(pat);
      m.set(pat.index, arr);
    }
    return m;
  }, [visiblePatterns]);

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

  // Y-axis domain with 3% padding so wicks and pattern markers stay in view
  const yMin = useMemo(() => Math.min(...priceData.map((d) => d.low)) * 0.97, [priceData]);
  const yMax = useMemo(() => Math.max(...priceData.map((d) => d.high)) * 1.03, [priceData]);

  // Memoize the shape renderer so it only regenerates when domain or patterns change
  const candleShape = useMemo(
    () => makeCandleShape(yMin, yMax, patternMap),
    [yMin, yMax, patternMap],
  );

  // Recent unique patterns (last 20 candles, deduplicated by name)
  const recentPatterns = useMemo(() => {
    const seen = new Set<string>();
    return [...visiblePatterns]
      .filter((p) => p.index >= priceData.length - 20)
      .reverse()
      .filter((p) => {
        if (seen.has(p.name)) return false;
        seen.add(p.name);
        return true;
      })
      .slice(0, 6);
  }, [visiblePatterns, priceData.length]);

  if (sliced.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">
        No price history available
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* ── Overlay / indicator toggles ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <span className="text-xs text-muted mr-1">Overlays</span>
        {([
          { key: "sma50",  label: "SMA 50",   active: showSma50,  toggle: () => setShowSma50((v) => !v),  cls: "bg-amber-500/20 text-amber-400" },
          { key: "sma200", label: "SMA 200",  active: showSma200, toggle: () => setShowSma200((v) => !v), cls: "bg-purple-500/20 text-purple-400" },
          { key: "bb",     label: "BB(20,2)", active: showBB,     toggle: () => setShowBB((v) => !v),     cls: "bg-teal-500/20 text-teal-400" },
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
              active ? "bg-blue-500/20 text-blue-400" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── OHLC warning ─────────────────────────────────────────────────── */}
      {!hasOhlc && (
        <p className="px-1 text-xs text-muted">
          OHLC data not available — showing close price only.
        </p>
      )}

      {/* ── Main candlestick chart ───────────────────────────────────────── */}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={priceData}
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
            tickFormatter={fmtPrice}
            width={56}
            domain={[yMin, yMax]}
          />
          <Tooltip
            content={
              <CandleTooltip
                showSma50={showSma50}
                showSma200={showSma200}
                showBB={showBB}
              />
            }
          />

          {/*
           * The Bar with shape={candleShape} is the core of the candle rendering.
           * dataKey="close" gives Recharts a value to compute y and height from.
           * The shape function uses those pixel values plus yMin/yMax (closure) to
           * derive pixel positions for open, high, and low and draws the full candle.
           * fillOpacity/strokeOpacity=0 hides the default bar rect — only our SVG shows.
           */}
          <Bar
            dataKey="close"
            fillOpacity={0}
            strokeOpacity={0}
            isAnimationActive={false}
            shape={candleShape}
          />

          {/* SMA overlays */}
          {showSma50 && (
            <Line type="monotone" dataKey="sma50" stroke={AMBER} strokeWidth={1.5}
              dot={false} activeDot={false} connectNulls isAnimationActive={false} />
          )}
          {showSma200 && (
            <Line type="monotone" dataKey="sma200" stroke={PURPLE} strokeWidth={1.5}
              strokeDasharray="5 3" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
          )}

          {/* Bollinger Bands — three lines (upper, middle, lower) */}
          {showBB && (
            <>
              <Line type="monotone" dataKey="bbUpper" stroke={TEAL} strokeWidth={1}
                strokeOpacity={0.7} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="bbMiddle" stroke={TEAL} strokeWidth={0.8}
                strokeDasharray="4 3" strokeOpacity={0.45} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="bbLower" stroke={TEAL} strokeWidth={1}
                strokeOpacity={0.7} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* ── Volume sub-chart ─────────────────────────────────────────────── */}
      {hasVolume && (
        <ResponsiveContainer width="100%" height={52}>
          <BarChart
            data={priceData}
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
            <Tooltip content={() => null} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Bar
              dataKey="volume"
              fill={BLUE}
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
              data={priceData}
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
              <Tooltip content={<RsiTooltip />} />
              <Line type="monotone" dataKey="rsi" stroke={BLUE} strokeWidth={1.5}
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
              data={priceData}
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
              <Tooltip content={<MacdTooltip />} />
              <Bar dataKey="macdHistogram" fill={BLUE} fillOpacity={0.5}
                maxBarSize={6} isAnimationActive={false} />
              <Line type="monotone" dataKey="macd" stroke={BLUE} strokeWidth={1.5}
                dot={false} activeDot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="macdSignal" stroke={ORANGE} strokeWidth={1.5}
                strokeDasharray="4 2" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Detected patterns panel ──────────────────────────────────────── */}
      {recentPatterns.length > 0 && (
        <div className="mt-1 rounded-lg border border-border bg-surface-2 p-3">
          <p className="mb-2 text-xs font-medium text-muted uppercase tracking-wide">
            Recent Patterns Detected
          </p>
          <div className="flex flex-col gap-2">
            {recentPatterns.map((pat, idx) => (
              <div key={idx} className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium"
                  style={{
                    background:
                      pat.direction === "bullish" ? "rgba(74,222,128,0.15)"
                      : pat.direction === "bearish" ? "rgba(248,113,113,0.15)"
                      : "rgba(154,163,175,0.15)",
                    color:
                      pat.direction === "bullish" ? POSITIVE
                      : pat.direction === "bearish" ? NEGATIVE
                      : AXIS,
                  }}
                >
                  {pat.direction === "bullish" ? "▲" : pat.direction === "bearish" ? "▼" : "●"}{" "}
                  {pat.name}
                </span>
                <p className="text-xs leading-relaxed text-muted">{pat.description}</p>
              </div>
            ))}
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
        {visiblePatterns.length > 0 && (
          <>
            <span className="flex items-center gap-1 text-xs text-muted">
              <span style={{ color: POSITIVE }}>▲</span> Bullish pattern
            </span>
            <span className="flex items-center gap-1 text-xs text-muted">
              <span style={{ color: NEGATIVE }}>▼</span> Bearish pattern
            </span>
          </>
        )}
      </div>
    </div>
  );
}
