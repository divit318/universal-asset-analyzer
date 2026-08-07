"use client";

import type { SectorRotationEntry } from "@/lib/types";
import { CountUp } from "@/app/_components/count-up";
import { LoadingPanel } from "@/app/_components/loading-panel";
import { Reveal } from "@/app/_components/reveal";

/**
 * Sector Intelligence for the researched company's specific sector — rank,
 * rotation trend, momentum, historical movement, leading/weakening/lagging
 * state. Data comes from the Sector Rotation Engine (lib/sector-rotation.ts)
 * via /api/sector-rotation, fetched once at the page level and passed down
 * (also shared by MacroContextLadder and WhyNowCard).
 */

const CLASS_STYLE: Record<SectorRotationEntry["classification"], { label: string; cls: string }> = {
  leading:       { label: "Leading",       cls: "text-positive border-positive/30 bg-positive/8" },
  strengthening: { label: "Strengthening", cls: "text-emerald-400 light:text-emerald-700 border-emerald-400/30 light:border-emerald-700/40 bg-emerald-400/8" },
  weakening:     { label: "Weakening",     cls: "text-warning border-warning/30 bg-warning/8" },
  lagging:       { label: "Lagging",       cls: "text-negative border-negative/30 bg-negative/8" },
};

const WINDOWS: { key: "1w" | "1m" | "3m" | "6m"; label: string }[] = [
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
];

function ReturnChip({ label, value, index }: { label: string; value: number | null; index: number }) {
  const cls = value == null ? "text-muted" : value >= 0 ? "text-positive" : "text-negative";
  return (
    <Reveal index={index} className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-surface px-2.5 py-1.5">
      <span className="text-[9px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-xs font-semibold tabular-nums ${cls}`}>
        {value != null
          ? <CountUp value={value} format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`} />
          : "—"}
      </span>
    </Reveal>
  );
}

export function SectorContextCard({ entry, loading }: { entry: SectorRotationEntry | null; loading?: boolean }) {
  if (loading) return <LoadingPanel height="h-24" markSize={18} />;
  if (!entry) return null;

  const style = CLASS_STYLE[entry.classification];

  return (
    <div className="card-lift flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-foreground">{entry.sector}</span>
          <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}>
            {style.label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="font-mono">Rank #{entry.rank}/11</span>
          {entry.rankChange != null && entry.rankChange !== 0 && (
            <span className={entry.rankChange > 0 ? "text-positive" : "text-negative"}>
              {entry.rankChange > 0 ? "▲" : "▼"} {Math.abs(entry.rankChange)} since prior snapshot
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {WINDOWS.map((w, i) => (
          <ReturnChip key={w.key} label={w.label} value={entry.returns[w.key]} index={i} />
        ))}
      </div>
      <p className="text-[10px] text-muted/70">
        Relative strength {entry.relativeStrength >= 0 ? "+" : ""}{entry.relativeStrength.toFixed(1)}pp vs. sector average · momentum {entry.momentum >= 0 ? "+" : ""}{entry.momentum.toFixed(1)}
      </p>
    </div>
  );
}
