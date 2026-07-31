"use client";

import { useEffect, useState } from "react";
import type { SectorRotationSnapshot, RotationClass } from "@/lib/types";
import { Skeleton } from "./ui/skeleton";

const CLASS_STYLE: Record<RotationClass, { bg: string; text: string; label: string }> = {
  leading: { bg: "bg-positive/10 border-positive/25", text: "text-positive", label: "Leading" },
  strengthening: { bg: "bg-accent/10 border-accent/25", text: "text-accent", label: "Strengthening" },
  weakening: { bg: "bg-amber-500/10 border-amber-500/25", text: "text-amber-500", label: "Weakening" },
  lagging: { bg: "bg-negative/10 border-negative/25", text: "text-negative", label: "Lagging" },
};

function RankChangeBadge({ change }: { change: number | null }) {
  if (change == null || change === 0) return <span className="text-[10px] text-muted/50">—</span>;
  const up = change > 0;
  return (
    <span className={`text-[10px] font-semibold ${up ? "text-positive" : "text-negative"}`}>
      {up ? "▲" : "▼"} {Math.abs(change)}
    </span>
  );
}

/**
 * Continuous sector rotation panel — relative strength, leadership, and
 * capital-flow classification across the 11 GICS sector ETFs. Distinct from
 * the event-driven SectorRotationGrid (Scanner): this reflects rolling
 * multi-window momentum, not a single news scan.
 */
export function SectorRotationPanel({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<SectorRotationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sector-rotation")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSnapshot(data.snapshot ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <Skeleton height="h-24" radius="rounded-lg" />;
  }
  if (!snapshot || snapshot.sectors.length === 0) return null;

  const sectors = compact ? snapshot.sectors.slice(0, 6) : snapshot.sectors;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Sector Rotation</h2>
        <span className="text-[10px] text-muted/60 uppercase tracking-widest">
          Leaders: {snapshot.leaders.join(", ")}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sectors.map((entry) => {
          const style = CLASS_STYLE[entry.classification];
          return (
            <div key={entry.sector} className={`rounded-lg border px-3 py-2.5 ${style.bg}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-semibold text-foreground truncate">{entry.sector}</span>
                <RankChangeBadge change={entry.rankChange} />
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-medium uppercase tracking-wide ${style.text}`}>
                  {style.label}
                </span>
                <span className="text-xs font-bold text-foreground">
                  #{entry.rank} · {entry.returns["1m"] != null ? `${entry.returns["1m"] >= 0 ? "+" : ""}${entry.returns["1m"].toFixed(1)}%` : "n/a"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
