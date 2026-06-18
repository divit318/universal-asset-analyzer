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
import type { HistoryPoint } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const AXIS = "#9aa3af";
const GRID = "#272b33";
const POSITIVE = "#4ade80";
const NEGATIVE = "#f87171";
const BLUE = "#60a5fa";
const AMBER = "#fbbf24";
const PURPLE = "#a78bfa";

const TOOLTIP_STYLE = {
  background: "#14161a",
  border: "1px solid #272b33",
  borderRadius: 8,
  fontSize: 12,
  padding: "8px 12px",
};

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type PeriodKey = "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "Max";
type ChartMode = "price" | "relative";

interface Benchmarks {
  spy: HistoryPoint[];
  sectorEtf: string | null;
  sector: HistoryPoint[];
}

interface Props {
  symbol: string;
  history: HistoryPoint[];
  benchmarks: Benchmarks;
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

function fmtPrice(v: number): string {
  return v < 10 ? `$${v.toFixed(2)}` : v < 100 ? `$${v.toFixed(1)}` : `$${v.toFixed(0)}`;
}

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
  showSma50,
  showSma200,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  symbol: string;
  showSma50: boolean;
  showSma200: boolean;
}) {
  if (!active || !payload?.length) return null;
  const byKey = Object.fromEntries(payload.map((p) => [p.dataKey, p.value]));
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="mb-1.5 text-xs text-muted">{label ? fmtTooltipDate(label) : ""}</p>
      {byKey.price != null && (
        <p className="flex items-center gap-2 text-xs">
          <span className="font-medium text-foreground">{symbol}</span>
          <span className="font-mono">{fmtPrice(byKey.price as number)}</span>
        </p>
      )}
      {showSma50 && byKey.sma50 != null && (
        <p className="flex items-center gap-2 text-xs">
          <span style={{ color: AMBER }}>SMA 50</span>
          <span className="font-mono">{fmtPrice(byKey.sma50 as number)}</span>
        </p>
      )}
      {showSma200 && byKey.sma200 != null && (
        <p className="flex items-center gap-2 text-xs">
          <span style={{ color: PURPLE }}>SMA 200</span>
          <span className="font-mono">{fmtPrice(byKey.sma200 as number)}</span>
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
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE}>
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

export function InteractiveChart({ symbol, history, benchmarks }: Props) {
  const [period, setPeriod] = useState<PeriodKey>("6M");
  const [mode, setMode] = useState<ChartMode>("price");
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(true);

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

    const spySliced = benchmarks.spy.filter((p) => p.date >= since);
    const sectorSliced = benchmarks.sector.filter((p) => p.date >= since);
    const baseSpy = spySliced[0]?.close ?? 1;
    const baseSector = sectorSliced[0]?.close ?? 1;

    const spyMap = new Map(spySliced.map((p) => [p.date, p.close]));
    const sectorMap = new Map(sectorSliced.map((p) => [p.date, p.close]));

    return sliced.map((p) => {
      const spyClose = spyMap.get(p.date);
      const sectorClose = sectorMap.get(p.date);
      return {
        date: p.date,
        [symbol]: +((p.close / baseStock) * 100).toFixed(2),
        SPY: spyClose != null ? +((spyClose / baseSpy) * 100).toFixed(2) : null,
        ...(benchmarks.sectorEtf && sectorClose != null
          ? { [benchmarks.sectorEtf]: +((sectorClose / baseSector) * 100).toFixed(2) }
          : {}),
      };
    });
  }, [sliced, since, benchmarks, symbol]);

  const hasVolume = priceData.some((d) => d.volume > 0);

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
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
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
                  ? "bg-accent-strong text-background"
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
              <button
                onClick={() => setShowSma50((v) => !v)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  showSma50
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                SMA 50
              </button>
              <button
                onClick={() => setShowSma200((v) => !v)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  showSma200
                    ? "bg-purple-500/20 text-purple-400"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                SMA 200
              </button>
              <span className="h-4 w-px bg-border" />
            </>
          )}
          <button
            onClick={() => setMode((m) => (m === "price" ? "relative" : "price"))}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "relative"
                ? "bg-blue-500/20 text-blue-400"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            vs Index &amp; Sector
          </button>
        </div>
      </div>

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
                tickFormatter={fmtPrice}
                width={56}
                domain={[
                  (dataMin: number) => dataMin * 0.97,
                  (dataMax: number) => dataMax * 1.03,
                ]}
              />
              <Tooltip
                content={
                  <PriceTooltip
                    symbol={symbol}
                    showSma50={showSma50}
                    showSma200={showSma200}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={lineColor}
                strokeWidth={1.75}
                fill="url(#priceAreaGrad)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: lineColor }}
                connectNulls
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
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar
                  dataKey="volume"
                  fill={BLUE}
                  fillOpacity={0.45}
                  radius={[1, 1, 0, 0]}
                  maxBarSize={8}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
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
              content={<RelativeTooltip />}
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
            />
            <Line
              type="monotone"
              dataKey="SPY"
              stroke={BLUE}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls
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
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* ── Period performance footer ─────────────────────────────────────── */}
      {periodLabel && (
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
