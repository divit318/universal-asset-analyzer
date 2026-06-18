"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CompareEntry } from "@/app/api/compare/route";

/* ─── types ────────────────────────────────────────────────────────────────── */
type Period = "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y";
type AnnualPeriod = "3Y" | "5Y" | "All";

type PriceMetric = "return" | "totalReturn" | "price" | "marketcap";
type AnnualMetric = "revenueGrowth" | "epsGrowth" | "fcfGrowth" | "grossMargin" | "operatingMargin" | "fcfMargin";
type SnapshotMetric = "pe" | "evEbitda" | "ps" | "roic" | "roe";
type Metric = PriceMetric | AnnualMetric | SnapshotMetric;

interface RawPoint { date: string; close: number }
type HistoryMap = Record<string, RawPoint[]>;
interface ChartPoint { date: string; [symbol: string]: string | number | null }
interface AnnualChartPoint { fy: string; [symbol: string]: string | number | null }

/* ─── metric config ──────────────────────────────────────────────────────── */
interface MetricConfig {
  value: Metric;
  label: string;
  category: "price" | "annual" | "snapshot";
  formatFn: (v: number) => string;
  isGrowth?: boolean; // for sign coloring
}

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const fmtPctAbs = (v: number) => `${v.toFixed(1)}%`;
const fmtMoney = (v: number) => {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(2)}`;
};
const fmtRatio = (v: number) => `${v.toFixed(1)}x`;
const fmtPrice = (v: number) => `$${v.toFixed(2)}`;

const METRIC_GROUPS: { header: string; metrics: MetricConfig[] }[] = [
  {
    header: "Price",
    metrics: [
      { value: "return", label: "Price Return (%)", category: "price", formatFn: fmtPct, isGrowth: true },
      { value: "totalReturn", label: "Total Return (%)", category: "price", formatFn: fmtPct, isGrowth: true },
      { value: "price", label: "Stock Price", category: "price", formatFn: fmtPrice },
      { value: "marketcap", label: "Market Cap", category: "price", formatFn: fmtMoney },
    ],
  },
  {
    header: "Fundamentals (Annual)",
    metrics: [
      { value: "revenueGrowth", label: "Revenue Growth (YoY%)", category: "annual", formatFn: fmtPct, isGrowth: true },
      { value: "epsGrowth", label: "EPS Growth (YoY%)", category: "annual", formatFn: fmtPct, isGrowth: true },
      { value: "fcfGrowth", label: "FCF Growth (YoY%)", category: "annual", formatFn: fmtPct, isGrowth: true },
      { value: "grossMargin", label: "Gross Margin (%)", category: "annual", formatFn: fmtPctAbs },
      { value: "operatingMargin", label: "Operating Margin (%)", category: "annual", formatFn: fmtPctAbs },
      { value: "fcfMargin", label: "FCF Margin (%)", category: "annual", formatFn: fmtPctAbs },
    ],
  },
  {
    header: "Valuation & Quality",
    metrics: [
      { value: "pe", label: "P/E Ratio", category: "snapshot", formatFn: fmtRatio },
      { value: "evEbitda", label: "EV/EBITDA", category: "snapshot", formatFn: fmtRatio },
      { value: "ps", label: "P/S Ratio", category: "snapshot", formatFn: fmtRatio },
      { value: "roic", label: "ROIC (%)", category: "snapshot", formatFn: fmtPctAbs },
      { value: "roe", label: "ROE (%)", category: "snapshot", formatFn: fmtPctAbs },
    ],
  },
];

const ALL_METRICS = METRIC_GROUPS.flatMap((g) => g.metrics);
function getMetricConfig(m: Metric): MetricConfig {
  return ALL_METRICS.find((x) => x.value === m) ?? ALL_METRICS[0];
}

/* ─── period constants ───────────────────────────────────────────────────── */
const PERIODS: { label: Period; days: number }[] = [
  { label: "1M", days: 30 },
  { label: "3M", days: 91 },
  { label: "6M", days: 183 },
  { label: "YTD", days: 0 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1095 },
  { label: "5Y", days: 1825 },
];

const ANNUAL_PERIODS: AnnualPeriod[] = ["3Y", "5Y", "All"];

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
  if (period === "1M" || period === "3M")
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

/* ─── annual data helpers ───────────────────────────────────────────────── */
function yoyGrowth(
  points: { fy: number; value: number }[],
): Map<number, number> {
  const result = new Map<number, number>();
  const sorted = [...points].sort((a, b) => a.fy - b.fy);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    const curr = sorted[i].value;
    if (prev !== 0) result.set(sorted[i].fy, ((curr / prev) - 1) * 100);
  }
  return result;
}

function fcfMarginMap(
  fcf: { fy: number; value: number }[],
  rev: { fy: number; value: number }[],
): Map<number, number> {
  const revMap = new Map(rev.map((p) => [p.fy, p.value]));
  const result = new Map<number, number>();
  for (const { fy, value: f } of fcf) {
    const r = revMap.get(fy);
    if (r != null && r !== 0) result.set(fy, (f / r) * 100);
  }
  return result;
}

function buildAnnualData(
  entries: CompareEntry[],
  metric: AnnualMetric,
  maxYears: number | null,
): AnnualChartPoint[] {
  const seriesMap: Record<string, Map<number, number>> = {};

  for (const e of entries) {
    const st = e.statements;
    if (!st) { seriesMap[e.symbol] = new Map(); continue; }

    let m: Map<number, number>;
    if (metric === "revenueGrowth") m = yoyGrowth(st.revenue);
    else if (metric === "epsGrowth") m = yoyGrowth(st.netIncome);
    else if (metric === "fcfGrowth") m = yoyGrowth(st.freeCashFlow);
    else if (metric === "grossMargin") m = new Map(st.grossMargin.map((p) => [p.fy, p.value * 100]));
    else if (metric === "operatingMargin") m = new Map(st.operatingMargin.map((p) => [p.fy, p.value * 100]));
    else m = fcfMarginMap(st.freeCashFlow, st.revenue);

    seriesMap[e.symbol] = m;
  }

  const allFys = [...new Set(Object.values(seriesMap).flatMap((m) => [...m.keys()]))].sort();
  const fySlice = maxYears ? allFys.slice(-maxYears) : allFys;

  return fySlice.map((fy) => {
    const pt: AnnualChartPoint = { fy: `FY${fy}` };
    for (const e of entries) {
      const v = seriesMap[e.symbol]?.get(fy);
      pt[e.symbol] = v != null ? +v.toFixed(2) : null;
    }
    return pt;
  });
}

function getSnapshotValue(entry: CompareEntry, metric: SnapshotMetric): number | null {
  const snap = entry.snapshot;
  const quote = entry.quote;
  if (!snap || !quote) return null;

  if (metric === "pe") return snap.trailingPE;
  if (metric === "roe") return snap.returnOnEquity != null ? snap.returnOnEquity * 100 : null;
  if (metric === "roic") {
    const roe = snap.returnOnEquity;
    const de = snap.debtToEquity;
    if (roe == null) return null;
    if (de == null) return roe * 100;
    return (roe / (1 + de / 100)) * 100;
  }
  if (metric === "evEbitda") {
    const mc = quote.marketCap;
    const debt = snap.totalDebt;
    const cash = snap.totalCash;
    const ebitda = snap.ebitda;
    if (mc == null || ebitda == null || ebitda === 0) return null;
    const ev = mc + (debt ?? 0) - (cash ?? 0);
    return ev / ebitda;
  }
  if (metric === "ps") {
    const mc = quote.marketCap;
    if (mc == null) return null;
    const rev = entry.statements?.revenue;
    if (!rev || rev.length === 0) return null;
    const latestRev = rev[rev.length - 1].value;
    if (!latestRev) return null;
    return mc / latestRev;
  }
  return null;
}

/* ─── tooltips ───────────────────────────────────────────────────────────── */
function PriceTooltip({
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
  const cfg = getMetricConfig(metric);
  const date = new Date(label + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  return (
    <div style={{ background: "#14161a", border: "1px solid #272b33", borderRadius: 8, fontSize: 12, padding: "8px 14px", minWidth: 160 }}>
      <p style={{ color: "#9aa3af", marginBottom: 6, fontSize: 11 }}>{date}</p>
      {symbols.map((sym, i) => {
        const entry = payload.find((p) => p.dataKey === sym);
        const v = entry?.value;
        if (v == null) return null;
        return (
          <div key={sym} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "1px 0" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 600, color: colors[i] }}>{sym}</span>
            <span style={{ fontFamily: "monospace", color: cfg.isGrowth ? (v >= 0 ? "#4ade80" : "#f87171") : "#e2e8f0" }}>
              {cfg.formatFn(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AnnualTooltip({
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
  const cfg = getMetricConfig(metric);
  return (
    <div style={{ background: "#14161a", border: "1px solid #272b33", borderRadius: 8, fontSize: 12, padding: "8px 14px", minWidth: 160 }}>
      <p style={{ color: "#9aa3af", marginBottom: 6, fontSize: 11 }}>{label}</p>
      {symbols.map((sym, i) => {
        const entry = payload.find((p) => p.dataKey === sym);
        const v = entry?.value;
        if (v == null) return null;
        return (
          <div key={sym} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "1px 0" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 600, color: colors[i] }}>{sym}</span>
            <span style={{ fontFamily: "monospace", color: cfg.isGrowth ? (v >= 0 ? "#4ade80" : "#f87171") : "#e2e8f0" }}>
              {cfg.formatFn(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── end-of-line dot ────────────────────────────────────────────────────── */
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
  const cfg = getMetricConfig(metric);
  const label = cfg.formatFn(value);
  const isPos = !cfg.isGrowth || value >= 0;
  const bg = isPos ? color : "#ef4444";
  const bw = label.length * 6.8 + 10;
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

/* ─── snapshot comparison panel ─────────────────────────────────────────── */
function SnapshotPanel({
  entries, metric, colors,
}: {
  entries: CompareEntry[];
  metric: SnapshotMetric;
  colors: string[];
}) {
  const cfg = getMetricConfig(metric);
  const values = entries.map((e) => ({ symbol: e.symbol, value: getSnapshotValue(e, metric) }));
  const nums = values.map((x) => x.value).filter((v): v is number => v != null);
  const max = nums.length ? Math.max(...nums) : 1;

  return (
    <div className="px-6 py-8 flex flex-col gap-4">
      <p className="text-xs text-muted text-center">Current snapshot — not a time series</p>
      <div className="flex flex-col gap-3 max-w-xl mx-auto w-full">
        {values.map(({ symbol, value }, i) => (
          <div key={symbol} className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold w-14 shrink-0" style={{ color: colors[i] }}>
              {symbol}
            </span>
            <div className="flex-1 h-6 bg-surface-2 rounded-md overflow-hidden relative">
              <div
                className="h-full rounded-md transition-all"
                style={{
                  width: value != null ? `${Math.max(2, (Math.abs(value) / Math.max(Math.abs(max), 0.01)) * 100)}%` : "0%",
                  backgroundColor: colors[i],
                  opacity: 0.85,
                }}
              />
            </div>
            <span className="font-mono text-xs tabular-nums w-16 text-right shrink-0 text-foreground">
              {value != null ? cfg.formatFn(value) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── main component ──────────────────────────────────────────────────────── */
interface Props {
  symbols: string[];
  colors: string[];
  marketCaps: Record<string, number | null | undefined>;
  entries?: CompareEntry[];
}

export function CompareChart({ symbols, colors, marketCaps, entries = [] }: Props) {
  const [period, setPeriod] = useState<Period>("1Y");
  const [annualPeriod, setAnnualPeriod] = useState<AnnualPeriod>("5Y");
  const [metric, setMetric] = useState<Metric>("return");
  const [historyMap, setHistoryMap] = useState<HistoryMap>({});
  const [loading, setLoading] = useState(false);
  const [metricOpen, setMetricOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const cfg = getMetricConfig(metric);
  const isPrice = cfg.category === "price";
  const isAnnual = cfg.category === "annual";
  const isSnapshot = cfg.category === "snapshot";

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setMetricOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fetch daily history only when price metric selected
  useEffect(() => {
    if (!symbols.length || !isPrice) return;
    setLoading(true);
    fetch(`/api/compare-history?symbols=${symbols.join(",")}&days=${maxDays(period)}`)
      .then((r) => r.json())
      .then((data: HistoryMap) => setHistoryMap(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbols, period, isPrice]);

  /* ── price chart data ── */
  const chartData = useMemo<ChartPoint[]>(() => {
    if (!isPrice || !symbols.length) return [];
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

    const baseline: Record<string, number> = {};
    if (metric === "return" || metric === "totalReturn") {
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
        if (metric === "return" || metric === "totalReturn") {
          const base = baseline[sym];
          pt[sym] = base ? +((close / base - 1) * 100).toFixed(3) : null;
        } else if (metric === "price") {
          pt[sym] = close;
        } else {
          const mcap = marketCaps[sym];
          const latestClose = filtered[sym]?.[filtered[sym].length - 1]?.close;
          pt[sym] = mcap && latestClose ? +(mcap * (close / latestClose)) : null;
        }
      }
      return pt;
    });
  }, [historyMap, symbols, period, metric, marketCaps, isPrice]);

  /* ── annual chart data ── */
  const annualData = useMemo<AnnualChartPoint[]>(() => {
    if (!isAnnual || !entries.length) return [];
    const maxYears = annualPeriod === "3Y" ? 3 : annualPeriod === "5Y" ? 5 : null;
    const validEntries = entries.filter((e) => symbols.includes(e.symbol));
    return buildAnnualData(validEntries, metric as AnnualMetric, maxYears);
  }, [isAnnual, entries, symbols, metric, annualPeriod]);

  /* ── last values for legend ── */
  const lastValues = useMemo<Record<string, number | null>>(() => {
    if (isPrice) {
      const last = chartData[chartData.length - 1];
      if (!last) return {};
      return Object.fromEntries(symbols.map((s) => {
        const v = last[s]; return [s, typeof v === "number" ? v : null];
      }));
    }
    if (isAnnual) {
      const last = annualData[annualData.length - 1];
      if (!last) return {};
      return Object.fromEntries(symbols.map((s) => {
        const v = last[s]; return [s, typeof v === "number" ? v : null];
      }));
    }
    return Object.fromEntries(symbols.map((s) => {
      const e = entries.find((x) => x.symbol === s);
      return [s, e ? getSnapshotValue(e, metric as SnapshotMetric) : null];
    }));
  }, [isPrice, isAnnual, chartData, annualData, symbols, entries, metric]);

  /* ── y-axis domain (price chart) ── */
  const yDomain = useMemo<[number | "auto", number | "auto"]>(() => {
    if (!isPrice) return ["auto", "auto"];
    const vals = chartData.flatMap((pt) =>
      symbols.map((s) => pt[s]).filter((v): v is number => typeof v === "number"),
    );
    if (!vals.length) return ["auto", "auto"];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.12 || 5;
    return [min - pad, max + pad + (max - min) * 0.08];
  }, [chartData, symbols, isPrice]);

  const tickInterval = useMemo(() => {
    const n = chartData.length;
    if (n <= 30) return Math.max(1, Math.floor(n / 5));
    if (n <= 100) return Math.max(1, Math.floor(n / 6));
    if (n <= 260) return Math.max(1, Math.floor(n / 8));
    return Math.max(1, Math.floor(n / 10));
  }, [chartData]);

  const yFormatter = (v: number) => cfg.formatFn(v);
  const dataLen = chartData.length;

  if (!symbols.length) return null;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">

      {/* ── controls row ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">

        {/* Period selector */}
        <div className="flex gap-1">
          {isPrice && PERIODS.map(({ label }) => (
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
          {isAnnual && ANNUAL_PERIODS.map((ap) => (
            <button
              key={ap}
              onClick={() => setAnnualPeriod(ap)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors
                ${annualPeriod === ap
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"}`}
            >
              {ap}
            </button>
          ))}
          {isSnapshot && (
            <span className="rounded-md px-3 py-1 text-xs text-muted">Latest</span>
          )}
        </div>

        {/* Metric dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setMetricOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface"
          >
            {cfg.label}
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted">
              <path d="M2 3.5l3 3 3-3" />
            </svg>
          </button>

          {metricOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
              {METRIC_GROUPS.map((group) => (
                <div key={group.header}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted border-t border-border first:border-t-0">
                    {group.header}
                  </div>
                  {group.metrics.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => { setMetric(m.value); setMetricOpen(false); }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-2 ${metric === m.value ? "text-accent" : "text-foreground"}`}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${metric === m.value ? "bg-accent" : "bg-transparent border border-border"}`}
                      />
                      {m.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── legend ── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-3 pb-1">
        {symbols.map((sym, i) => {
          const v = lastValues[sym];
          const isPos = v == null || !cfg.isGrowth || v >= 0;
          return (
            <div key={sym} className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-3 rounded-sm" style={{ background: colors[i] }} />
              <span className="font-mono font-semibold" style={{ color: colors[i] }}>{sym}</span>
              {v != null && (
                <span className={`font-mono tabular-nums ${cfg.isGrowth ? (isPos ? "text-green-400" : "text-rose-400") : "text-foreground"}`}>
                  {cfg.formatFn(v)}
                </span>
              )}
            </div>
          );
        })}
        <span className="ml-auto text-xs font-medium text-muted">{cfg.label}</span>
      </div>

      {/* ── price line chart ── */}
      {isPrice && (
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
                  width={(metric === "return" || metric === "totalReturn") ? 64 : 76}
                />
                <Tooltip
                  content={<PriceTooltip metric={metric} symbols={symbols} colors={colors} />}
                  cursor={{ stroke: "#9aa3af", strokeWidth: 1, strokeDasharray: "4 4" }}
                />
                {(metric === "return" || metric === "totalReturn") && (
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
                    dot={(dotProps: { cx?: number; cy?: number; index?: number; value?: number | null }) => (
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
      )}

      {/* ── annual bar chart ── */}
      {isAnnual && (
        <div className="relative pb-4 pt-1">
          {annualData.length === 0 && (
            <div className="flex h-[320px] items-center justify-center text-xs text-muted">
              No annual data available.
            </div>
          )}
          {annualData.length > 0 && (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={annualData} margin={{ top: 10, right: 20, left: 4, bottom: 4 }} barGap={2} barCategoryGap="25%">
                <CartesianGrid stroke="#272b33" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="fy"
                  tick={{ fill: "#9aa3af", fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: "#272b33" }}
                />
                <YAxis
                  tick={{ fill: "#9aa3af", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={yFormatter}
                  width={64}
                />
                <Tooltip
                  content={<AnnualTooltip metric={metric} symbols={symbols} colors={colors} />}
                  cursor={{ fill: "#272b33", opacity: 0.5 }}
                />
                {cfg.isGrowth && <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1} strokeDasharray="4 4" />}
                {symbols.map((sym, i) => (
                  <Bar key={sym} dataKey={sym} fill={colors[i]} radius={[3, 3, 0, 0]} opacity={0.85}>
                    {annualData.map((entry) => {
                      const v = entry[sym];
                      const isNeg = cfg.isGrowth && typeof v === "number" && v < 0;
                      return (
                        <Cell
                          key={`cell-${sym}-${entry.fy}`}
                          fill={isNeg ? "#ef4444" : colors[i]}
                          opacity={0.85}
                        />
                      );
                    })}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* ── snapshot comparison ── */}
      {isSnapshot && (
        <SnapshotPanel
          entries={entries.filter((e) => symbols.includes(e.symbol))}
          metric={metric as SnapshotMetric}
          colors={symbols.map((s) => {
            const idx = entries.findIndex((e) => e.symbol === s);
            return colors[idx >= 0 ? idx : 0];
          })}
        />
      )}
    </div>
  );
}
