"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartTheme, type ChartTheme } from "@/app/_components/chart-theme";
import { useHoverSymbol } from "./hover-symbol-context";

/**
 * The historical-performance line chart for the non-equity Compare
 * framework — the primary visualization, mirroring equity's own price chart
 * (app/compare/_components/compare-chart.tsx) in visual language and period
 * selector, but built generically on symbols + /api/compare-history rather
 * than CompareEntry's equity-only fields (no annual/snapshot modes: ETFs,
 * REITs, crypto etc. have no financial statements to chart).
 *
 * Users primarily compare performance over time regardless of asset class —
 * this is what makes the hero visualization consistent across every tab
 * instead of each class defaulting to its own secondary scatter/curve chart.
 */

type Period = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "Max";

interface RawPoint { date: string; close: number; adjClose: number }
type HistoryMap = Record<string, RawPoint[]>;
interface ChartPoint { date: string; [symbol: string]: string | number | null }

const PERIODS: { label: Period; days: number }[] = [
  { label: "1D", days: 3 },
  { label: "1W", days: 9 },
  { label: "1M", days: 30 },
  { label: "3M", days: 91 },
  { label: "6M", days: 183 },
  { label: "YTD", days: 0 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1095 },
  { label: "5Y", days: 1825 },
  { label: "Max", days: 20 * 365 },
];

function periodStart(p: Period): string {
  if (p === "YTD") return `${new Date().getFullYear()}-01-01`;
  const d = new Date();
  d.setDate(d.getDate() - PERIODS.find((x) => x.label === p)!.days);
  return d.toISOString().slice(0, 10);
}

function fetchDays(p: Period): number {
  return PERIODS.find((x) => x.label === p)!.days + 10;
}

function formatAxisDate(iso: string, period: Period): string {
  const d = new Date(iso + "T00:00:00");
  if (period === "1D" || period === "1W" || period === "1M" || period === "3M")
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

function PriceTooltip({
  active, payload, label, symbols, colors, ct,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number | null }[];
  label?: string;
  symbols: string[];
  colors: string[];
  ct: ChartTheme;
}) {
  if (!active || !payload?.length || !label) return null;
  const date = new Date(label + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  return (
    <div style={{ ...ct.tooltip, minWidth: 160 }}>
      <p style={{ color: ct.axis, marginBottom: 6, fontSize: 11 }}>{date}</p>
      {symbols.map((sym, i) => {
        const entry = payload.find((p) => p.dataKey === sym);
        const v = entry?.value;
        if (v == null) return null;
        return (
          <div key={sym} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "1px 0" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 600, color: colors[i] }}>{sym}</span>
            <span style={{ fontFamily: "monospace", color: v >= 0 ? ct.positive : ct.negative }}>{fmtPct(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function EndDot(props: {
  cx?: number;
  cy?: number;
  index?: number;
  dataLength: number;
  color: string;
  value?: number | null;
  surface: string;
  negative: string;
}) {
  const { cx, cy, index, dataLength, color, value, surface, negative } = props;
  if (index == null || index !== dataLength - 1 || cx == null || cy == null || value == null) return null;
  const label = fmtPct(value);
  const bg = value >= 0 ? color : negative;
  const bw = label.length * 6.8 + 10;
  const bh = 18;

  return (
    <g>
      <circle cx={cx} cy={cy} r={3.5} fill={bg} stroke={surface} strokeWidth={1} />
      <rect x={cx + 6} y={cy - bh / 2} width={bw} height={bh} rx={4} fill={bg} />
      <text x={cx + 6 + bw / 2} y={cy + 4.5} textAnchor="middle" fontSize={9.5} fontWeight="700" fill="#fff" fontFamily="'ui-monospace','SFMono-Regular',monospace">
        {label}
      </text>
    </g>
  );
}

interface Props {
  symbols: string[];
  colors: string[];
}

export function ClassPerformanceChart({ symbols, colors }: Props) {
  const ct = useChartTheme();
  const { hovered, setHovered } = useHoverSymbol();
  const [period, setPeriod] = useState<Period>("1Y");
  const [historyMap, setHistoryMap] = useState<HistoryMap>({});
  const [convertedSymbols, setConvertedSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      fetch(`/api/compare-history?symbols=${symbols.join(",")}&days=${fetchDays(period)}`)
        .then((r) => r.json())
        .then((raw: Record<string, unknown>) => {
          if (cancelled) return;
          const meta = raw["_meta"] as { convertedToUsd?: string[] } | undefined;
          setConvertedSymbols(meta?.convertedToUsd ?? []);
          delete raw["_meta"];
          setHistoryMap(raw as HistoryMap);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    });
    return () => { cancelled = true; };
  }, [symbols, period]);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!symbols.length) return [];
    const start = periodStart(period);

    const filtered: Record<string, RawPoint[]> = {};
    for (const sym of symbols) {
      const pts = (historyMap[sym] ?? []).filter((p) => p.date >= start);
      if (pts.length) filtered[sym] = pts;
    }

    const allDates = [...new Set(Object.values(filtered).flatMap((pts) => pts.map((p) => p.date)))].sort();
    if (!allDates.length) return [];

    const baseline: Record<string, number> = {};
    for (const sym of symbols) {
      const pts = filtered[sym];
      if (pts?.length) baseline[sym] = pts[0].adjClose;
    }

    const lookup: Record<string, Map<string, RawPoint>> = {};
    for (const sym of symbols) {
      lookup[sym] = new Map((filtered[sym] ?? []).map((p) => [p.date, p]));
    }

    return allDates.map((date) => {
      const pt: ChartPoint = { date };
      for (const sym of symbols) {
        const raw = lookup[sym]?.get(date) ?? null;
        if (raw == null) { pt[sym] = null; continue; }
        const base = baseline[sym];
        pt[sym] = base ? +((raw.adjClose / base - 1) * 100).toFixed(3) : null;
      }
      return pt;
    });
  }, [historyMap, symbols, period]);

  const lastValues = useMemo<Record<string, number | null>>(() => {
    const last = chartData[chartData.length - 1];
    if (!last) return {};
    return Object.fromEntries(symbols.map((s) => {
      const v = last[s];
      return [s, typeof v === "number" ? v : null];
    }));
  }, [chartData, symbols]);

  const yDomain = useMemo<[number | "auto", number | "auto"]>(() => {
    const vals = chartData.flatMap((pt) => symbols.map((s) => pt[s]).filter((v): v is number => typeof v === "number"));
    if (!vals.length) return ["auto", "auto"];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.12 || 5;
    return [min - pad, max + pad + (max - min) * 0.08];
  }, [chartData, symbols]);

  const tickInterval = useMemo(() => {
    const n = chartData.length;
    if (n <= 30) return Math.max(1, Math.floor(n / 5));
    if (n <= 100) return Math.max(1, Math.floor(n / 6));
    if (n <= 260) return Math.max(1, Math.floor(n / 8));
    return Math.max(1, Math.floor(n / 10));
  }, [chartData]);

  const dataLen = chartData.length;
  if (!symbols.length) return null;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-visible">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {PERIODS.map(({ label }) => (
            <button
              key={label}
              onClick={() => setPeriod(label)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors
                ${period === label ? "bg-brand-strong text-background shadow-sm" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs font-medium text-muted">Performance</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-3 pb-1">
        {symbols.map((sym, i) => {
          const v = lastValues[sym];
          const dimmed = hovered != null && hovered !== sym;
          return (
            <div
              key={sym}
              onMouseEnter={() => setHovered(sym)}
              onMouseLeave={() => setHovered(null)}
              className={`flex cursor-default items-center gap-1.5 text-xs transition-opacity duration-200 ease-out ${dimmed ? "opacity-60" : "opacity-100"}`}
            >
              <span className="h-2 w-3 rounded-sm" style={{ background: colors[i] }} />
              <span className="font-mono font-semibold" style={{ color: colors[i] }}>{sym}</span>
              {v != null && (
                <span className={`font-mono tabular-nums ${v >= 0 ? "text-positive" : "text-negative"}`}>{fmtPct(v)}</span>
              )}
            </div>
          );
        })}
        {convertedSymbols.length > 0 && (
          <span className="ml-2 rounded-md bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
            non-USD prices converted to USD
          </span>
        )}
      </div>

      <div className="relative pb-4 pt-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/80 text-xs text-muted backdrop-blur-[1px]">
            Loading chart data…
          </div>
        )}
        {!loading && chartData.length === 0 && (
          <div className="flex h-[320px] items-center justify-center text-xs text-muted">
            No price data available for this period.
          </div>
        )}
        {chartData.length > 0 && (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top: 10, right: 90, left: 4, bottom: 4 }}>
              <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: ct.axis, fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: ct.grid }}
                interval={tickInterval}
                tickFormatter={(v: string) => formatAxisDate(v, period)}
              />
              <YAxis
                tick={{ fill: ct.axis, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtPct}
                domain={yDomain}
                width={64}
              />
              <Tooltip
                content={<PriceTooltip symbols={symbols} colors={colors} ct={ct} />}
                cursor={{ stroke: ct.axis, strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1} strokeDasharray="4 4" />
              {symbols.map((sym, i) => (
                <Line
                  key={sym}
                  type="monotone"
                  dataKey={sym}
                  stroke={colors[i]}
                  strokeWidth={hovered == null ? 1.8 : hovered === sym ? 2.6 : 1.8}
                  strokeOpacity={hovered == null || hovered === sym ? 1 : 0.4}
                  connectNulls
                  isAnimationActive
                  animationDuration={320}
                  animationEasing="ease-out"
                  onMouseEnter={() => setHovered(sym)}
                  onMouseLeave={() => setHovered(null)}
                  dot={(dotProps: { cx?: number; cy?: number; index?: number; value?: number | null }) => (
                    <EndDot
                      key={`dot-${sym}-${dotProps.index}`}
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      index={dotProps.index}
                      dataLength={dataLen}
                      color={colors[i]}
                      value={dotProps.value}
                      surface={ct.surface}
                      negative={ct.negative}
                    />
                  )}
                  activeDot={{ r: 4, fill: colors[i], stroke: ct.surface, strokeWidth: 1.5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
