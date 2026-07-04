"use client";

import type { ScreenerInRatio } from "@/lib/screener-in";

/* -------------------------------------------------------------------------- */
/* Inline SVG sparkline — no external dependency                              */
/* -------------------------------------------------------------------------- */

function MiniSparkline({ values, positive }: { values: number[]; positive?: boolean }) {
  if (values.length < 2) {
    return <div className="h-8 w-full rounded bg-surface-3" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 120;
  const H = 32;
  const pad = 3;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (W - pad * 2) + pad;
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return [x, y] as const;
  });

  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;

  const up = values[values.length - 1] >= values[0];
  // For metrics where lower = better (D/E, Debtor Days), flip color logic
  const good = positive === false ? !up : up;
  const stroke = good ? "var(--color-positive)" : "var(--color-negative)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-8 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={areaPath} fill={stroke} fillOpacity={0.12} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
      {/* Latest value dot */}
      <circle cx={pts[pts.length - 1][0].toFixed(1)} cy={pts[pts.length - 1][1].toFixed(1)} r={2.5} fill={stroke} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend indicator badge                                                       */
/* -------------------------------------------------------------------------- */

function TrendBadge({ values, positiveIsUp = true }: { values: number[]; positiveIsUp?: boolean }) {
  if (values.length < 2) return null;
  const delta = values[values.length - 1] - values[0];
  const pct = Math.abs(delta / (values[0] || 1)) * 100;

  const improving = positiveIsUp ? delta > 0 : delta < 0;
  const flat = pct < 3;

  if (flat) return <span className="text-[10px] text-muted">Stable</span>;
  return (
    <span className={`text-[10px] font-medium ${improving ? "text-positive" : "text-negative"}`}>
      {improving ? "▲" : "▼"} {pct.toFixed(0)}%
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Individual ratio card                                                       */
/* -------------------------------------------------------------------------- */

// Metrics where a higher value is BAD
const LOWER_IS_BETTER = new Set([
  "debtor days",
  "inventory days",
  "days payable",
  "cash conversion cycle",
  "working capital days",
  "debt to equity",
  "d/e",
]);

function isPositiveUp(name: string): boolean {
  const lower = name.toLowerCase();
  return !Array.from(LOWER_IS_BETTER).some((k) => lower.includes(k));
}

function RatioCard({ ratio }: { ratio: ScreenerInRatio }) {
  const values = ratio.values
    .map((v) => parseFloat(v.value.replace(/,/g, "")))
    .filter((n) => isFinite(n) && !isNaN(n));

  const latest = ratio.values.at(-1);
  const positive = isPositiveUp(ratio.name);

  // Format display value
  const fmtLatest = (() => {
    if (!latest?.value) return "—";
    const n = parseFloat(latest.value.replace(/,/g, ""));
    if (!isFinite(n)) return latest.value || "—";
    if (Math.abs(n) >= 1000) return n.toLocaleString("en-IN");
    return n.toFixed(1);
  })();

  // Determine value color
  const latestNum = parseFloat(latest?.value?.replace(/,/g, "") ?? "");
  const colorClass = (() => {
    if (!isFinite(latestNum)) return "text-foreground";
    const low = ratio.name.toLowerCase();
    if (low.includes("roce") || low.includes("roe")) {
      return latestNum >= 15 ? "text-positive" : latestNum < 10 ? "text-negative" : "text-amber-400";
    }
    if (low.includes("debt") || low.includes("d/e")) {
      return latestNum <= 0.5 ? "text-positive" : latestNum > 1.5 ? "text-negative" : "text-amber-400";
    }
    return "text-foreground";
  })();

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium leading-snug text-muted">{ratio.name}</span>
        <TrendBadge values={values} positiveIsUp={positive} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={`font-mono text-lg font-semibold tabular-nums ${colorClass}`}>{fmtLatest}</span>
        {latest?.period && (
          <span className="text-[10px] text-muted">{latest.period}</span>
        )}
      </div>
      {/* Sparkline trend */}
      <MiniSparkline values={values} positive={positive} />
      {/* Period labels — first and last */}
      {ratio.values.length >= 2 && (
        <div className="flex justify-between text-[9px] text-muted/60">
          <span>{ratio.values[0]?.period ?? ""}</span>
          <span>{ratio.values.at(-1)?.period ?? ""}</span>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main export                                                                 */
/* -------------------------------------------------------------------------- */

const RATIO_GROUPS: { label: string; keys: string[] }[] = [
  {
    label: "Profitability",
    keys: ["roce", "roe", "net profit margin", "operating profit margin", "opm"],
  },
  {
    label: "Efficiency",
    keys: ["debtor days", "inventory days", "days payable", "cash conversion", "working capital"],
  },
  {
    label: "Leverage",
    keys: ["debt to equity", "d/e", "interest coverage", "current ratio"],
  },
  {
    label: "Growth",
    keys: ["sales growth", "profit growth", "revenue growth", "earnings growth"],
  },
];

function matchGroup(name: string): string | null {
  const lower = name.toLowerCase();
  for (const g of RATIO_GROUPS) {
    if (g.keys.some((k) => lower.includes(k))) return g.label;
  }
  return null;
}

export function RatioSparklines({ ratios }: { ratios: ScreenerInRatio[] }) {
  if (!ratios.length) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
        No historical ratio data available.
      </p>
    );
  }

  // Group ratios
  const grouped = new Map<string, ScreenerInRatio[]>();
  const ungrouped: ScreenerInRatio[] = [];

  for (const r of ratios) {
    const g = matchGroup(r.name);
    if (g) {
      if (!grouped.has(g)) grouped.set(g, []);
      grouped.get(g)!.push(r);
    } else {
      ungrouped.push(r);
    }
  }

  if (ungrouped.length > 0) grouped.set("Other", ungrouped);

  return (
    <div className="flex flex-col gap-6">
      {Array.from(grouped.entries()).map(([group, items]) => (
        <div key={group} className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{group}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((r) => (
              <RatioCard key={r.name} ratio={r} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
