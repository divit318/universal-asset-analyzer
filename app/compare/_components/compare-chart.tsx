"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/* ─── types ────────────────────────────────────────────────────────────────── */
type Period = "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y";
type Metric = "return" | "price" | "marketcap";

interface RawPoint { date: string; close: number }
type HistoryMap = Record<string, RawPoint[]>;

interface ChartPoint { date: string; [symbol: string]: string | number | null }

/* ─── constants ─────────────────────────────────────────────────────────────── */
const PERIODS: { label: Period; days: number }[] = [
  { label: "1M",  days: 30 },
  { label: "3M",  days: 91 },
  { label: "6M",  days: 183 },
  { label: "YTD", days: 0 },
  { label: "1Y",  days: 365 },
  { label: "3Y",  days: 1095 },
  { label: "5Y",  days: 1825 },
];

const METRICS: { value: Metric; label: string }[] = [
  { value: "return",    label: "Price Return (%)" },
  { value: "price",     label: "Stock Price" },
  { value: "marketcap", label: "Market Cap" },
];

/* ─── formatters ─────────────────────────────────────────────────────────────── */
function fmtPct(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function fmtMoney(v: number) {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(2)}`;
}

/* ─── helpers ───────────────────────────────────────────────────────────────── */
function periodStart(p: Period): string {
  if (p === "YTD") return `${new Date().getFullYear()}-01-01`;
  const d = new Date();
  d.setDate(d.getDate() - PERIODS.find((x) => x.label === p)!.days);
  return d.toISOString().slice(0, 10);
}

function maxDays(p: Period): number {
  if (p === "YTD") return 370;
  return PERIODS.find((x) => x.label === p)!.days + 10;
}

function formatAxisDate(iso: string, period: Period): string {
  const d = new Date(iso + "T00:00:00");
  if (period === "1M" || period === "3M") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

/* ─── custom tooltip ─────────────────────────────────────────────────────────── */
function CompareTooltip({
  active, payload, label, metric, symbols, colors,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number | null }[];
  label?: string;
  metric: Metric;
  symbols: string[];
  colors: string[];
}) {
  if (!active || !payload?.length || !label) return null;
  const date = new Date(label + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  return (
    <div style={{
      background: "#14161a", border: "1px solid #272b33",
      borderRadius: 8, fontSize: 12, padding: "8px 14px", minWidth: 160,
    }}>
      <p style={{ color: "#9aa3af", marginBottom: 6, fontSize: 11 }}>{date}</p>
      {symbols.map((sym, i) => {
        const entry = payload.find((p) => p.dataKey === sym);
        const v = entry?.value;
        if (v == null) return null;
        const label = metric === "return" ? fmtPct(v) : fmtMoney(v);
        return (
          <div key={sym} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "1px 0" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 600, color: colors[i] }}>{sym}</span>
            <span style={{ fontFamily: "monospace", color: metric === "return" ? (v >= 0 ? "#4ade80" : "#f87171") : "#e2e8f0" }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── custom dot — only renders the badge on the LAST data point ─────────────── */
function EndDot(props: {
  cx?: number;
  cy?: number;
  index?: number;
  dataLength: number;
  color: string;
  value?: number | null;
  metric: Metric;
}) {
  const { cx, cy, index, dataLength, color, value, metric } = props;
  if (index == null || index !== dataLength - 1 || cx == null || cy == null || value == null) return null;

  const label = metric === "return" ? fmtPct(value) : fmtMoney(value);
  const isPos = metric !== "return" || value >= 0;
  const bg = isPos ? color : "#ef4444";
  const chars = label.length;
  const bw = chars * 6.8 + 10;
  const bh = 18;

  return (
    <g>
      <circle cx={cx} cy={cy} r={3.5} fill={bg} stroke="#14161a" strokeWidth={1} />
      <rect x={cx + 6} y={cy - bh / 2} width={bw} height={bh} rx={4} fill={bg} />
      <text
        x={cx + 6 + bw / 2}
        y={cy + 4.5}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight="700"
        fill="#fff"
        fontFamily="'ui-monospace','SFMono-Regular',monospace"
      >
        {label}
      </text>
    </g>
  );
}

/* ─── main component ─────────────────────────────────────────────────────────── */
interface Props {
  symbols: string[];
  colors: string[];
  marketCaps: Record<string, number | null | undefined>;
}

export function CompareChart({ symbols, colors, marketCaps }: Props) {
  const [period, setPeriod]     = useState<Period>("1Y");
  const [metric, setMetric]     = useState<Metric>("return");
  const [historyMap, setHistoryMap] = useState<HistoryMap>({});
  const [loading, setLoading]   = useState(false);
  const [metricOpen, setMetricOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setMetricOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fetch history whenever symbols or period change
  useEffect(() => {
    if (!symbols.length) return;
    setLoading(true);
    fetch(`/api/compare-history?symbols=${symbols.join(",")}&days=${maxDays(period)}`)
      .then((r) => r.json())
      .then((data: HistoryMap) => setHistoryMap(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbols, period]);

  /* ── build chart data ── */
  const chartData = useMemo<ChartPoint[]>(() => {
    if (!symbols.length) return [];
    const start = periodStart(period);

    const filtered: Record<string, RawPoint[]> = {};
    for (const sym of symbols) {
      const pts = (historyMap[sym] ?? []).filter((p) => p.date >= start);
      if (pts.length) filtered[sym] = pts;
    }

    const allDates = [...new Set(
      Object.values(filtered).flatMap((pts) => pts.map((p) => p.date)),
    )].sort();
    if (!allDates.length) return [];

    // Baseline for return-mode: first available close for each symbol
    const baseline: Record<string, number> = {};
    if (metric === "return") {
      for (const sym of symbols) {
        const pts = filtered[sym];
        if (pts?.length) baseline[sym] = pts[0].close;
      }
    }

    const lookup: Record<string, Map<string, number>> = {};
    for (const sym of symbols) {
      lookup[sym] = new Map((filtered[sym] ?? []).map((p) => [p.date, p.close]));
    }

    return allDates.map((date) => {
      const pt: ChartPoint = { date };
      for (const sym of symbols) {
        const close = lookup[sym]?.get(date) ?? null;
        if (close == null) { pt[sym] = null; continue; }
        if (metric === "return") {
          const base = baseline[sym];
          pt[sym] = base ? +((close / base - 1) * 100).toFixed(3) : null;
        } else if (metric === "price") {
          pt[sym] = close;
        } else {
          // approximate historical market cap = current mcap × (price_t / latest_price)
          const mcap = marketCaps[sym];
          const latestClose = filtered[sym]?.[filtered[sym].length - 1]?.close;
          pt[sym] = mcap && latestClose ? +(mcap * (close / latestClose)) : null;
        }
      }
      return pt;
    });
  }, [historyMap, symbols, period, metric, marketCaps]);

  /* ── current (last) values for legend ── */
  const lastValues = useMemo<Record<string, number | null>>(() => {
    const last = chartData[chartData.length - 1];
    if (!last) return {};
    return Object.fromEntries(symbols.map((s) => {
      const v = last[s]; return [s, typeof v === "number" ? v : null];
    }));
  }, [chartData, symbols]);

  /* ── y-axis domain ── */
  const yDomain = useMemo<[number | "auto", number | "auto"]>(() => {
    const vals = chartData.flatMap((pt) =>
      symbols.map((s) => pt[s]).filter((v): v is number => typeof v === "number"),
    );
    if (!vals.length) return ["auto", "auto"];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.12 || 5;
    // Extra right padding for end labels: add ~8% to max
    return [min - pad, max + pad + (max - min) * 0.08];
  }, [chartData, symbols]);

  const tickInterval = useMemo(() => {
    const n = chartData.length;
    if (n <= 30)  return Math.max(1, Math.floor(n / 5));
    if (n <= 100) return Math.max(1, Math.floor(n / 6));
    if (n <= 260) return Math.max(1, Math.floor(n / 8));
    return Math.max(1, Math.floor(n / 10));
  }, [chartData]);

  const yFormatter = (v: number) => metric === "return" ? fmtPct(v) : fmtMoney(v);
  const metricLabel = METRICS.find((m) => m.value === metric)?.label ?? "Price Return (%)";
  const dataLen = chartData.length;

  if (!symbols.length) return null;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">

      {/* ── controls row ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        {/* Period pills */}
        <div className="flex gap-1">
          {PERIODS.map(({ label }) => (
            <button
              key={label}
              onClick={() => setPeriod(label)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors
                ${period === label
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Metric dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setMetricOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface"
          >
            {metricLabel}
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted">
              <path d="M2 3.5l3 3 3-3" />
            </svg>
          </button>

          {metricOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[170px] overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Chart metric
              </div>
              {METRICS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => { setMetric(m.value); setMetricOpen(false); }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-2 ${metric === m.value ? "text-accent" : "text-foreground"}`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${metric === m.value ? "bg-accent" : "bg-transparent border border-border"}`}
                  />
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── legend with current values ── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-3 pb-1">
        {symbols.map((sym, i) => {
          const v = lastValues[sym];
          const isPos = v == null || metric !== "return" || v >= 0;
          return (
            <div key={sym} className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-3 rounded-sm" style={{ background: colors[i] }} />
              <span className="font-mono font-semibold" style={{ color: colors[i] }}>{sym}</span>
              {v != null && (
                <span className={`font-mono tabular-nums ${isPos ? "text-green-400" : "text-rose-400"}`}>
                  {metric === "return" ? fmtPct(v) : fmtMoney(v)}
                </span>
              )}
            </div>
          );
        })}
        <span className="ml-auto text-xs font-medium text-muted">{metricLabel}</span>
      </div>

      {/* ── chart ── */}
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
              <CartesianGrid stroke="#272b33" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#9aa3af", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "#272b33" }}
                interval={tickInterval}
                tickFormatter={(v: string) => formatAxisDate(v, period)}
              />
              <YAxis
                tick={{ fill: "#9aa3af", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={yFormatter}
                domain={yDomain}
                width={metric === "return" ? 64 : 76}
              />
              <Tooltip
                content={
                  <CompareTooltip
                    metric={metric}
                    symbols={symbols}
                    colors={colors}
                  />
                }
                cursor={{ stroke: "#9aa3af", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              {metric === "return" && (
                <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1} strokeDasharray="4 4" />
              )}
              {symbols.map((sym, i) => (
                <Line
                  key={sym}
                  type="monotone"
                  dataKey={sym}
                  stroke={colors[i]}
                  strokeWidth={1.8}
                  connectNulls
                  dot={(dotProps: {
                    cx?: number; cy?: number; index?: number; value?: number | null;
                  }) => (
                    <EndDot
                      key={`dot-${sym}-${dotProps.index}`}
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      index={dotProps.index}
                      dataLength={dataLen}
                      color={colors[i]}
                      value={dotProps.value}
                      metric={metric}
                    />
                  )}
                  activeDot={{ r: 4, fill: colors[i], stroke: "#14161a", strokeWidth: 1.5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
