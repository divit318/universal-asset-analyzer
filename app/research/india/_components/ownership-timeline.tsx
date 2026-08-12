"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScreenerInShareholding } from "@/lib/screener-in";
import { changeOverN, streakOfSeries } from "@/lib/india-ownership-trends";
import { useChartTheme } from "@/app/_components/chart-theme";
import { useTheme } from "@/app/_components/theme";

/* Holder identity palette, theme-paired: the dark set is the original; the
   light set deepens each hue for a white canvas (2026-08-08 light-mode audit —
   #fbbf24 retail sat at 1.9:1 on white). */
const HOLDER_COLORS_DARK: Record<string, string> = {
  promoter: "#4ade80",
  fii:      "#60a5fa",
  dii:      "#a78bfa",
  retail:   "#fbbf24",
  govt:     "#f97316",
  other:    "#9aa3af",
};
const HOLDER_COLORS_LIGHT: Record<string, string> = {
  promoter: "#15803d",
  fii:      "#2563eb",
  dii:      "#7c3aed",
  retail:   "#b45309",
  govt:     "#c2410c",
  other:    "#64748b",
};

function useHolderColors(): { colors: Record<string, string>; fallback: string } {
  const light = useTheme().theme === "light";
  return {
    colors: light ? HOLDER_COLORS_LIGHT : HOLDER_COLORS_DARK,
    fallback: light ? "#64748b" : "#9aa3af",
  };
}

const HOLDER_LABELS: Record<string, string> = {
  promoter: "Promoters",
  fii:      "FIIs",
  dii:      "DIIs",
  retail:   "Public / Retail",
  govt:     "Government",
  other:    "Others",
};


/* -------------------------------------------------------------------------- */
/* Parse shareholding rows into chart data                                     */
/* -------------------------------------------------------------------------- */

function num(v: string): number | null {
  const n = parseFloat(v.replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

function buildTimelineData(
  rows: ScreenerInShareholding[],
  periods: string[],
): { period: string; [key: string]: number | string | null }[] {
  if (!rows.length) return [];

  // Figure out how many periods we have
  const maxLen = Math.max(...rows.map((r) => r.values.length));
  const allPeriods = periods.length >= maxLen
    ? periods.slice(-maxLen)
    : rows[0].values.map((_, i) => `Q${i + 1}`);

  return allPeriods.map((period, i) => {
    const point: { period: string; [key: string]: number | string | null } = { period };
    for (const row of rows) {
      // Right-align shorter rows to the period axis (a row can carry fewer
      // cells than the header; its LAST cell is the latest period).
      const j = i - (maxLen - row.values.length);
      const v = j >= 0 ? num(row.values[j] ?? "") : null;
      point[row.holding] = v;
    }
    return point;
  });
}

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                     */
/* -------------------------------------------------------------------------- */

interface TooltipPayload {
  dataKey: string;
  value: number | null;
  color: string;
}

function OwnershipTooltip({
  active,
  payload,
  label,
  style,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  style?: React.CSSProperties;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={style}>
      <p className="mb-2 text-xs font-medium text-muted">{label}</p>
      {[...payload].reverse().map((p) =>
        p.value != null ? (
          <p key={p.dataKey} className="text-xs" style={{ color: p.color }}>
            {HOLDER_LABELS[p.dataKey] ?? p.dataKey}: {p.value.toFixed(1)}%
          </p>
        ) : null,
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Current distribution card                                                   */
/* -------------------------------------------------------------------------- */

function CurrentDistribution({ rows }: { rows: ScreenerInShareholding[] }) {
  const { colors, fallback } = useHolderColors();
  const items = rows
    .map((r) => ({ holding: r.holding, name: HOLDER_LABELS[r.holding] ?? r.name, value: num(r.values.at(-1) ?? "") }))
    .filter((d) => d.value != null && d.value > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  if (!items.length) return null;

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.holding} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs text-muted">{item.name}</span>
          <div className="flex-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, item.value ?? 0)}%`,
                  background: colors[item.holding] ?? fallback,
                }}
              />
            </div>
          </div>
          <span className="w-14 text-right font-mono text-xs font-medium">
            {item.value?.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend interpretation                                                        */
/* -------------------------------------------------------------------------- */

/** The contiguous disclosed tail as numbers — feeds the SHARED trend math
 *  (lib/india-ownership-trends.ts), so this card, the screener and the Radar
 *  can never disagree on what a streak is. */
function tailOf(values: string[]): number[] | null {
  const vals: number[] = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const v = num(values[i] ?? "");
    if (v == null) break;
    vals.unshift(v);
  }
  return vals.length >= 2 ? vals : null;
}

function TrendInsight({ rows, periods }: { rows: ScreenerInShareholding[]; periods: string[] }) {
  const insights: { label: string; color: string }[] = [];

  // The window every 4-quarter statement refers to, from real disclosures.
  const windowLabel =
    periods.length >= 5 ? ` (${periods[periods.length - 5]} → ${periods.at(-1)})` : "";

  for (const row of rows) {
    if (row.values.length < 4) continue;
    const first = num(row.values[0] ?? "");
    const last = num(row.values.at(-1) ?? "");
    const mid = num(row.values[Math.floor(row.values.length / 2)] ?? "");
    if (first == null || last == null) continue;

    const delta = last - first;
    const label = HOLDER_LABELS[row.holding] ?? row.name;

    // Multi-quarter streaks take precedence — they are the sharper statement.
    const tail = tailOf(row.values);
    const s = streakOfSeries(tail) ?? 0;
    const c4 = changeOverN(tail, 4);
    if (s >= 3) {
      insights.push({ label: `${label} ownership increased for ${s} consecutive disclosed quarters${c4 != null ? ` (+${c4.toFixed(1)}pp over the last 4)` : ""}`, color: "text-positive" });
      continue;
    }
    if (s <= -3) {
      insights.push({ label: `${label} ownership decreased for ${Math.abs(s)} consecutive disclosed quarters${c4 != null ? ` (${c4.toFixed(1)}pp over the last 4)` : ""}`, color: "text-negative" });
      continue;
    }
    if (row.holding === "promoter" && c4 != null && c4 <= -2) {
      insights.push({ label: `Promoter ownership declined ${c4.toFixed(1)}pp over the last 4 disclosed quarters${windowLabel} — alignment risk`, color: "text-negative" });
      continue;
    }

    if (row.holding === "promoter") {
      // Run-length of unchanged quarters (|Δ| < 0.05pp), most recent backwards.
      let unchangedQuarters = 0;
      for (let i = row.values.length - 1; i > 0; i--) {
        const a = num(row.values[i] ?? "");
        const b = num(row.values[i - 1] ?? "");
        if (a == null || b == null || Math.abs(a - b) >= 0.05) break;
        unchangedQuarters++;
      }
      if (delta < -2) insights.push({ label: `${label} stake declining (${delta.toFixed(1)}pp over period) — watch for alignment risk`, color: "text-negative" });
      else if (delta > 1) insights.push({ label: `${label} increasing stake (+${delta.toFixed(1)}pp) — high conviction signal`, color: "text-positive" });
      else if (unchangedQuarters >= 3) insights.push({ label: `${label} holding unchanged for ${unchangedQuarters + 1} consecutive quarters at ${last.toFixed(1)}%`, color: "text-muted" });
      else insights.push({ label: `${label} holding stable at ${last.toFixed(1)}%`, color: "text-muted" });
    } else if (row.holding === "fii") {
      if (delta > 2) insights.push({ label: `FII accumulation trend (+${delta.toFixed(1)}pp) — improving global interest`, color: "text-positive" });
      else if (delta < -2) insights.push({ label: `FII selling pressure (${delta.toFixed(1)}pp) — monitor institutional conviction`, color: "text-negative" });
      else if (mid != null && last > mid) insights.push({ label: `FIIs recently re-accumulating after prior exits`, color: "text-positive" });
    } else if (row.holding === "dii") {
      if (delta > 1.5) insights.push({ label: `Domestic institutions increasing allocation (+${delta.toFixed(1)}pp)`, color: "text-positive" });
    }
  }

  if (!insights.length) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Ownership Analysis</span>
      {insights.map((ins, i) => (
        <p key={i} className={`text-xs leading-5 ${ins.color}`}>{ins.label}</p>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quarter-over-quarter changes                                                */
/* -------------------------------------------------------------------------- */

function QoQChanges({ rows, periods }: { rows: ScreenerInShareholding[]; periods: string[] }) {
  const { colors, fallback } = useHolderColors();
  const changes = rows
    .map((r) => {
      if (r.values.length < 2) return null;
      const prev = num(r.values[r.values.length - 2] ?? "");
      const curr = num(r.values.at(-1) ?? "");
      if (prev == null || curr == null) return null;
      const delta = curr - prev;
      if (Math.abs(delta) < 0.05) return null;
      return { holding: r.holding, name: HOLDER_LABELS[r.holding] ?? r.name, prev, curr, delta };
    })
    .filter((d): d is NonNullable<typeof d> => d != null);

  if (!changes.length) return null;

  // The two disclosure quarters the deltas actually compare — never "today".
  const latest = periods.at(-1);
  const prior = periods.length >= 2 ? periods.at(-2) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Latest Quarter Changes</span>
        {latest && prior && (
          <span className="text-[10px] text-muted/70">{latest} vs {prior} · percentage points</span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {changes.map((c) => (
          <div key={c.holding} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: colors[c.holding] ?? fallback }}
              />
              <span className="text-xs text-muted">{c.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted/70">{c.prev.toFixed(1)}% →</span>
              <span className="font-mono text-xs">{c.curr.toFixed(1)}%</span>
              <span className={`font-mono text-[10px] ${c.delta > 0 ? "text-positive" : "text-negative"}`}>
                {c.delta > 0 ? "+" : ""}{c.delta.toFixed(1)}pp
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main export                                                                 */
/* -------------------------------------------------------------------------- */

export function OwnershipTimeline({
  rows,
  periods,
}: {
  rows: ScreenerInShareholding[];
  periods: string[];
}) {
  const ct = useChartTheme();
  const { colors, fallback } = useHolderColors();
  const AXIS = ct.axis, GRID = ct.grid;
  // Only include main categories with sufficient data
  const mainRows = rows.filter(
    (r) => ["promoter", "fii", "dii", "retail", "govt"].includes(r.holding) && r.values.length >= 2,
  );

  const hasTimeline = mainRows.length > 0 && mainRows.some((r) => r.values.length >= 3);

  if (!rows.length) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
        No shareholding data available.
      </p>
    );
  }

  const timelineData = buildTimelineData(mainRows, periods);
  const holders = [...new Set(mainRows.map((r) => r.holding))];

  return (
    <div className="flex flex-col gap-6">
      {/* Timeline chart */}
      {hasTimeline && timelineData.length >= 3 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <h3 className="text-sm font-semibold">Shareholding Trend</h3>
            <p className="text-xs text-muted">Quarterly ownership evolution — {timelineData[0].period} to {timelineData.at(-1)?.period}</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timelineData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <defs>
                {holders.map((h) => (
                  <linearGradient key={h} id={`grad-${h}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors[h] ?? fallback} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={colors[h] ?? fallback} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<OwnershipTooltip style={ct.tooltip} />} />
              {holders.map((h) => (
                <Area
                  key={h}
                  type="monotone"
                  dataKey={h}
                  stroke={colors[h] ?? fallback}
                  strokeWidth={1.5}
                  fill={`url(#grad-${h})`}
                  connectNulls
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            {holders.map((h) => (
              <span key={h} className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm" style={{ background: colors[h] ?? fallback }} />
                {HOLDER_LABELS[h] ?? h}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Latest disclosed distribution — "current" only up to the disclosure
          quarter, so the period is part of the heading, not fine print. */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">Current Distribution</h3>
          {periods.length > 0 && (
            <span className="text-[10px] uppercase tracking-wide text-muted">
              As of {periods.at(-1)} · SEBI shareholding pattern
            </span>
          )}
        </div>
        <CurrentDistribution rows={rows} />
      </div>

      {/* QoQ changes */}
      <QoQChanges rows={rows} periods={periods} />

      {/* Deterministic trend interpretation over the disclosed series */}
      <TrendInsight rows={rows} periods={periods} />
    </div>
  );
}
