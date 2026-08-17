"use client";

import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Maximize2 } from "lucide-react";
import type { HistoryPoint, NewsItem } from "@/lib/types";
import { formatChartPrice } from "@/lib/format";
import { niceTicks } from "@/lib/chart-scale";
import type { ChartQARelatedTarget } from "@/lib/ai-chart-qa";
import { CandleChart } from "./candle-chart";
import type { AskAIPayload } from "./pattern-analysis-panel";
import { ChartWorkspace } from "./chart-workspace/chart-workspace";
import { useChartTheme } from "@/app/_components/chart-theme";
import { usePlotDrawOnce } from "@/app/_components/use-in-view-once";
import { PLOT_DRAW_MS } from "@/app/_components/motion";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/* Categorical overlay colors resolve inside the component from ct.series so
   they theme-swap — CHART_SERIES is the static dark set and its steel slot
   measured 2.5:1 on a white canvas (2026-08-08 light-mode audit). */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type PeriodKey = "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "Max";
type ChartMode = "price" | "candles" | "relative";

interface Benchmarks {
  /** Market benchmark series — SPY for US listings, NIFTY 50 for NSE/BSE. */
  market: HistoryPoint[];
  /** Series/legend label for the market benchmark. */
  marketLabel: string;
  sectorEtf: string | null;
  sector: HistoryPoint[];
}

interface Props {
  symbol: string;
  history: HistoryPoint[];
  benchmarks: Benchmarks;
  /**
   * Listing currency of `history` (Quote.currency), e.g. "JPY" for 7974.T.
   * Optional so callers without a quote render bare numbers — the axis and
   * tooltip must never claim dollars for a series that isn't dollars.
   */
  currency?: string | null;
  news?: NewsItem[];
  onAskAI?: (payload: AskAIPayload) => void;
  onOpenTechnical?: () => void;
  onNavigate?: (target: ChartQARelatedTarget, payload?: AskAIPayload) => void;
}

/* -------------------------------------------------------------------------- */
/* Period helpers                                                              */
/* -------------------------------------------------------------------------- */

const PERIOD_DAYS: Partial<Record<PeriodKey, number>> = {
  "1W": 7,
  "1M": 30,
  "3M": 91,
  "6M": 183,
  "1Y": 365,
};

function getPeriodStart(period: PeriodKey): string {
  if (period === "YTD") return `${new Date().getFullYear()}-01-01`;
  if (period === "Max") return "1900-01-01";
  const days = PERIOD_DAYS[period]!;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* SMA calculation                                                            */
/* -------------------------------------------------------------------------- */

function buildSmaMap(data: HistoryPoint[], window: number): Map<string, number> {
  const result = new Map<string, number>();
  for (let i = window - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += data[j].close;
    result.set(data[i].date, sum / window);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Formatting helpers                                                          */
/* -------------------------------------------------------------------------- */

/* Price ticks/tooltips format through lib/format's formatChartPrice with the
   listing currency — the old local fmtPrice stamped a dollar sign onto every
   market (7974.T rendered as $14655). */

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function fmtAxisDate(period: PeriodKey, date: string): string {
  const d = new Date(date);
  if (period === "1W" || period === "1M") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (period === "3M" || period === "6M" || period === "YTD") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function fmtTooltipDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* -------------------------------------------------------------------------- */
/* Custom tooltips                                                             */
/* -------------------------------------------------------------------------- */

interface TooltipPayloadItem {
  name: string;
  value: number | null;
  color: string;
  dataKey: string;
}

function PriceTooltip({
  active,
  payload,
  label,
  symbol,
  currency,
  showSma50,
  showSma200,
  sma50Color,
  sma200Color,
  style,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  symbol: string;
  currency?: string | null;
  showSma50: boolean;
  showSma200: boolean;
  sma50Color: string;
  sma200Color: string;
  style?: React.CSSProperties;
}) {
  if (!active || !payload?.length) return null;
  const byKey = Object.fromEntries(payload.map((p) => [p.dataKey, p.value]));
  return (
    <div style={style}>
      <p className="mb-1.5 text-xs text-muted">{label ? fmtTooltipDate(label) : ""}</p>
      {byKey.price != null && (
        <p className="flex items-center gap-2 text-xs">
          <span className="font-medium text-foreground">{symbol}</span>
          <span className="font-mono">{formatChartPrice(byKey.price as number, currency)}</span>
        </p>
      )}
      {showSma50 && byKey.sma50 != null && (
        <p className="flex items-center gap-2 text-xs">
          <span style={{ color: sma50Color }}>SMA 50</span>
          <span className="font-mono">{formatChartPrice(byKey.sma50 as number, currency)}</span>
        </p>
      )}
      {showSma200 && byKey.sma200 != null && (
        <p className="flex items-center gap-2 text-xs">
          <span style={{ color: sma200Color }}>SMA 200</span>
          <span className="font-mono">{formatChartPrice(byKey.sma200 as number, currency)}</span>
        </p>
      )}
      {byKey.volume != null && (byKey.volume as number) > 0 && (
        <p className="mt-1 flex items-center gap-2 text-xs text-muted">
          <span>Vol</span>
          <span className="font-mono">{fmtVol(byKey.volume as number)}</span>
        </p>
      )}
    </div>
  );
}

function RelativeTooltip({
  active,
  payload,
  label,
  style,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  style?: React.CSSProperties;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={style}>
      <p className="mb-1.5 text-xs text-muted">{label ? fmtTooltipDate(label) : ""}</p>
      {payload.map((p) =>
        p.value != null ? (
          <p key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-mono">{(p.value as number).toFixed(1)}</span>
            <span className="text-muted">
              ({(p.value as number - 100) >= 0 ? "+" : ""}
              {((p.value as number) - 100).toFixed(1)}%)
            </span>
          </p>
        ) : null,
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                              */
/* -------------------------------------------------------------------------- */

export function InteractiveChart({ symbol, history, benchmarks, currency, news, onAskAI, onOpenTechnical, onNavigate }: Props) {
  const ct = useChartTheme();
  const AXIS = ct.axis;
  const GRID = ct.grid;
  const POSITIVE = ct.positive;
  const BLUE = ct.series[0];
  const AMBER = ct.series[1];
  const PURPLE = ct.series[4];
  const NEGATIVE = ct.negative;
  const TOOLTIP_STYLE = ct.tooltip;

  const [period, setPeriod] = useState<PeriodKey>("6M");
  const [mode, setMode] = useState<ChartMode>("price");
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(true);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  // Compute SMAs once over the full dataset so values are correct for recent periods.
  const sma50Map = useMemo(() => buildSmaMap(history, 50), [history]);
  const sma200Map = useMemo(() => buildSmaMap(history, 200), [history]);

  const since = useMemo(() => getPeriodStart(period), [period]);

  const sliced = useMemo(
    () => history.filter((p) => p.date >= since),
    [history, since],
  );

  const periodUp =
    sliced.length >= 2
      ? sliced[sliced.length - 1].close >= sliced[0].close
      : true;
  const lineColor = periodUp ? POSITIVE : NEGATIVE;

  // ── Price chart data ──────────────────────────────────────────────────────
  const priceData = useMemo(
    () =>
      sliced.map((p) => ({
        date: p.date,
        price: p.close,
        volume: p.volume ?? 0,
        sma50: sma50Map.get(p.date) ?? null,
        sma200: sma200Map.get(p.date) ?? null,
      })),
    [sliced, sma50Map, sma200Map],
  );

  // ── Relative performance data ─────────────────────────────────────────────
  const relativeData = useMemo(() => {
    if (!sliced.length) return [];
    const baseStock = sliced[0].close;

    const marketSliced = benchmarks.market.filter((p) => p.date >= since);
    const sectorSliced = benchmarks.sector.filter((p) => p.date >= since);
    const baseMarket = marketSliced[0]?.close ?? 1;
    const baseSector = sectorSliced[0]?.close ?? 1;

    const marketMap = new Map(marketSliced.map((p) => [p.date, p.close]));
    const sectorMap = new Map(sectorSliced.map((p) => [p.date, p.close]));

    return sliced.map((p) => {
      const marketClose = marketMap.get(p.date);
      const sectorClose = sectorMap.get(p.date);
      return {
        date: p.date,
        [symbol]: +((p.close / baseStock) * 100).toFixed(2),
        [benchmarks.marketLabel]: marketClose != null ? +((marketClose / baseMarket) * 100).toFixed(2) : null,
        ...(benchmarks.sectorEtf && sectorClose != null
          ? { [benchmarks.sectorEtf]: +((sectorClose / baseSector) * 100).toFixed(2) }
          : {}),
      };
    });
  }, [sliced, since, benchmarks, symbol]);

  const hasVolume = priceData.some((d) => d.volume > 0);

  // Round-interval y-axis ticks over everything plotted (price + visible
  // SMAs), replacing Recharts' raw min×0.97/max×1.03 labels ($61.9, $67.9…).
  const priceTicks = useMemo(() => {
    const values: number[] = [];
    for (const d of priceData) {
      values.push(d.price);
      if (showSma50 && d.sma50 != null) values.push(d.sma50);
      if (showSma200 && d.sma200 != null) values.push(d.sma200);
    }
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || Math.abs(max) * 0.02 || 1;
    return niceTicks(min - span * 0.04, max + span * 0.04, 6);
  }, [priceData, showSma50, showSma200]);

  /* Recharts animates the *series* only — axes, grid and tooltip are up
     immediately — so handing it the one-shot flag draws the price in without
     ever making the chart feel like it's still loading. */
  const [plotRef, drawPlot] = usePlotDrawOnce<HTMLDivElement>();
  const drawProps = {
    isAnimationActive: drawPlot,
    animationDuration: PLOT_DRAW_MS,
    animationEasing: "ease-out" as const,
  };

  const periodLabel = sliced.length >= 2
    ? (() => {
        const change = ((sliced[sliced.length - 1].close - sliced[0].close) / sliced[0].close) * 100;
        return { change, up: change >= 0 };
      })()
    : null;

  if (history.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">
        No price history available
      </div>
    );
  }

  return (
    <div ref={plotRef} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Period selector */}
        <div className="flex items-center gap-0.5">
          {(["1W", "1M", "3M", "6M", "YTD", "1Y", "Max"] as PeriodKey[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                period === p
                  ? "bg-brand-strong text-background"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Overlay toggles + mode switch */}
        <div className="flex items-center gap-1.5">
          {mode === "price" && (
            <>
              {/* Swatches double as the in-chart legend: solid amber = SMA 50,
                  dashed purple = SMA 200 — no plotted line is unlabeled. */}
              <button
                onClick={() => setShowSma50((v) => !v)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  showSma50
                    ? "bg-amber-500/20 text-warning"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span aria-hidden className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: AMBER }} />
                SMA 50
              </button>
              <button
                onClick={() => setShowSma200((v) => !v)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  showSma200
                    ? "bg-purple-500/20 text-purple-400 light:text-purple-700"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-3.5"
                  style={{ backgroundImage: `repeating-linear-gradient(to right, ${PURPLE} 0 4px, transparent 4px 7px)` }}
                />
                SMA 200
              </button>
              <span className="h-4 w-px bg-border" />
            </>
          )}
          <button
            onClick={() => setMode("price")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "price"
                ? "bg-brand-strong text-background"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            Line
          </button>
          <button
            onClick={() => setMode("candles")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "candles"
                ? "bg-brand-strong text-background"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            Candles
          </button>
          <span className="h-4 w-px bg-border" />
          <button
            onClick={() => setMode((m) => (m === "relative" ? "price" : "relative"))}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "relative"
                ? "bg-blue-500/20 text-blue-400 light:text-sky-700"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            vs Index &amp; Sector
          </button>
          <span className="h-4 w-px bg-border" />
          <button
            onClick={() => setFullscreenOpen(true)}
            title="Fullscreen technical analysis"
            className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Fullscreen
          </button>
        </div>
      </div>

      {fullscreenOpen && (
        <ChartWorkspace
          key={symbol}
          symbol={symbol}
          history={history}
          news={news}
          onClose={() => setFullscreenOpen(false)}
          onNavigate={onNavigate ?? (() => {})}
        />
      )}

      {/* ── Price mode ───────────────────────────────────────────────────── */}
      {mode === "price" && (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart
              data={priceData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              syncId="uaa-chart"
            >
              <defs>
                <linearGradient id="priceAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="date"
                stroke={AXIS}
                tick={{ fontSize: 11, fill: AXIS }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(d) => fmtAxisDate(period, d)}
                minTickGap={48}
              />
              <YAxis
                stroke={AXIS}
                tick={{ fontSize: 11, fill: AXIS }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatChartPrice(v, currency)}
                width={56}
                ticks={priceTicks}
                domain={
                  priceTicks.length >= 2
                    ? [priceTicks[0], priceTicks[priceTicks.length - 1]]
                    : [(dataMin: number) => dataMin * 0.97, (dataMax: number) => dataMax * 1.03]
                }
              />
              <Tooltip
                content={
                  <PriceTooltip
                    symbol={symbol}
                    currency={currency}
                    showSma50={showSma50}
                    showSma200={showSma200}
                    sma50Color={AMBER}
                    sma200Color={PURPLE}
                    style={TOOLTIP_STYLE}
                  />
                }
                cursor={{ stroke: ct.cursorFill, strokeWidth: 1, strokeDasharray: "3 3" }}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={lineColor}
                strokeWidth={1.75}
                fill="url(#priceAreaGrad)"
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: lineColor, fill: "var(--background)", className: "uaa-chart-active-dot" }}
                connectNulls
                {...drawProps}
              />
              {showSma50 && (
                <Line
                  type="monotone"
                  dataKey="sma50"
                  stroke={AMBER}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  {...drawProps}
                />
              )}
              {showSma200 && (
                <Line
                  type="monotone"
                  dataKey="sma200"
                  stroke={PURPLE}
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={false}
                  connectNulls
                  {...drawProps}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Volume sub-chart */}
          {hasVolume && (
            <ResponsiveContainer width="100%" height={56}>
              <BarChart
                data={priceData}
                margin={{ top: 0, right: 4, left: 0, bottom: 0 }}
                syncId="uaa-chart"
              >
                <CartesianGrid stroke={GRID} vertical={false} horizontal={false} />
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
                {/* Render-fn content (not a cloned element) avoids leaking
                    Recharts' internal tooltip props onto the DOM. The price
                    chart's tooltip already shows volume; here we only want the
                    synced hover cursor, so the tooltip box itself renders null. */}
                <Tooltip
                  content={() => null}
                  cursor={{ fill: ct.cursorFill }}
                />
                <Bar
                  dataKey="volume"
                  fill={BLUE}
                  fillOpacity={0.45}
                  radius={[1, 1, 0, 0]}
                  maxBarSize={8}
                  {...drawProps}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
      )}

      {/* ── Candles mode ─────────────────────────────────────────────────── */}
      {mode === "candles" && (
        <CandleChart
          symbol={symbol}
          history={history}
          since={since}
          currency={currency}
          periodLabel={period}
          news={news}
          onAskAI={onAskAI}
          onOpenTechnical={onOpenTechnical}
        />
      )}

      {/* ── Relative performance mode ─────────────────────────────────────── */}
      {mode === "relative" && (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart
            data={relativeData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="date"
              stroke={AXIS}
              tick={{ fontSize: 11, fill: AXIS }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(d) => fmtAxisDate(period, d)}
              minTickGap={48}
            />
            <YAxis
              stroke={AXIS}
              tick={{ fontSize: 11, fill: AXIS }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <ReferenceLine y={100} stroke={GRID} strokeDasharray="4 2" />
            <Tooltip
              content={<RelativeTooltip style={TOOLTIP_STYLE} />}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType="plainline"
              iconSize={16}
            />
            <Line
              type="monotone"
              dataKey={symbol}
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
              {...drawProps}
            />
            <Line
              type="monotone"
              dataKey={benchmarks.marketLabel}
              stroke={BLUE}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls
              {...drawProps}
            />
            {benchmarks.sectorEtf && (
              <Line
                type="monotone"
                dataKey={benchmarks.sectorEtf}
                stroke={AMBER}
                strokeWidth={1.5}
                strokeDasharray="3 2"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                connectNulls
                {...drawProps}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* ── Period performance footer ─────────────────────────────────────── */}
      {periodLabel && mode !== "candles" && (
        <div className="flex items-center justify-between border-t border-border pt-2.5 text-xs">
          <span className="text-muted">
            {period === "Max" ? "All-time" : period} performance
          </span>
          <span
            className={`font-mono font-medium ${periodLabel.up ? "text-positive" : "text-negative"}`}
          >
            {periodLabel.up ? "+" : ""}
            {periodLabel.change.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
}
