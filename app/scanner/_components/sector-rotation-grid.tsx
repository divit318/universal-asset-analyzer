"use client";

import type { SectorImpact } from "@/lib/types";

const DIR_STYLE = {
  bullish: {
    bg: "bg-positive/10 border-positive/25",
    text: "text-positive",
    arrow: "↑",
  },
  bearish: {
    bg: "bg-negative/10 border-negative/25",
    text: "text-negative",
    arrow: "↓",
  },
  neutral: {
    bg: "bg-surface border-border",
    text: "text-muted",
    arrow: "→",
  },
};

function StrengthBar({ value }: { value: number }) {
  const color =
    value >= 70
      ? "bg-positive"
      : value >= 40
        ? "bg-accent"
        : "bg-muted/40";
  return (
    <div className="h-0.5 w-full rounded-full bg-surface-3 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function SectorRotationGrid({ impacts }: { impacts: SectorImpact[] }) {
  if (impacts.length === 0) return null;

  const sorted = [...impacts].sort((a, b) => {
    // Bullish first, then bearish, then neutral; within each group by strength desc
    const dirRank = { bullish: 0, bearish: 1, neutral: 2 };
    const dr = dirRank[a.direction] - dirRank[b.direction];
    return dr !== 0 ? dr : b.strength - a.strength;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Sector Rotation</h2>
        <span className="text-[10px] text-muted/60 uppercase tracking-widest">
          {impacts.filter((i) => i.direction === "bullish").length} bullish ·{" "}
          {impacts.filter((i) => i.direction === "bearish").length} bearish
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sorted.map((impact) => {
          const style = DIR_STYLE[impact.direction];
          return (
            <div
              key={impact.sector}
              className={`rounded-lg border px-3 py-2.5 ${style.bg}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-semibold text-foreground truncate">
                  {impact.sector}
                </span>
                <span className={`text-xs font-bold ${style.text} shrink-0`}>
                  {style.arrow} {impact.strength}
                </span>
              </div>
              <StrengthBar value={impact.strength} />
              <p className="mt-1.5 text-[10px] leading-4 text-muted line-clamp-2">
                {impact.rationale}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
