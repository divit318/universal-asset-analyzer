import type { ReactNode } from "react";
import { getAssetClass, availableMetrics } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import { MiniRadar, MiniPerformanceChart, MiniRankedVerdict } from "./mini-charts";

interface Props {
  assetClass: AssetClassId;
}

/**
 * Three flip cards previewing what's inside the comparison engine. Front =
 * label + one-line teaser; back = a small, real preview of the capability
 * (not more description). Flips on hover or keyboard focus (`.flip-card` /
 * `.flip-card-inner` in globals.css); reduced-motion gets an instant swap
 * rather than no motion (it still needs to be discoverable via keyboard).
 */
export function FeatureCards({ assetClass }: Props) {
  const def = getAssetClass(assetClass);
  const metricCount = availableMetrics(assetClass).length;
  const groups = def.filterGroups.filter((g) => g !== "Composite Scores" && g !== "Size & Sector").slice(0, 6);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <FlipCard
        label={`Institutional Metrics — hover or focus to preview the ${metricCount} metrics tracked for ${def.label}`}
        front={
          <CardFront
            title="Institutional Metrics"
            teaser={`Every number that moves a real ${def.label} thesis.`}
          />
        }
        back={
          <div className="flex h-full flex-col justify-center gap-2">
            <p className="font-mono text-2xl font-bold text-brand">{metricCount}</p>
            <p className="text-[10px] uppercase tracking-widest text-muted/70">metrics tracked</p>
            <ul className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
              {groups.map((g) => (
                <li key={g} className="truncate text-[11px] text-foreground/80">
                  · {g}
                </li>
              ))}
            </ul>
          </div>
        }
      />

      <FlipCard
        label="Visual Analysis — hover or focus to preview the radar and performance charts"
        front={
          <CardFront
            title="Visual Analysis"
            teaser="See the shape of the comparison, not just a table of numbers."
          />
        }
        back={
          <div className="flex h-full items-center justify-center gap-3">
            <MiniRadar size={92} />
            <div className="flex flex-col items-center gap-1">
              <MiniPerformanceChart width={68} height={36} />
              <span className="text-[9px] uppercase tracking-widest text-muted/60">1Y perf</span>
            </div>
          </div>
        }
      />

      <FlipCard
        label="AI Research — hover or focus to preview a ranked AI verdict"
        front={
          <CardFront
            title="AI Research"
            teaser="A ranked verdict for every pick — not a forced single winner."
          />
        }
        back={
          <div className="flex h-full flex-col justify-center">
            <MiniRankedVerdict />
          </div>
        }
      />
    </div>
  );
}

function CardFront({ title, teaser }: { title: string; teaser: string }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1.5 text-xs leading-5 text-muted">{teaser}</p>
      </div>
      <span className="text-[10px] uppercase tracking-widest text-muted/50">Hover to preview →</span>
    </div>
  );
}

function FlipCard({ label, front, back }: { label: string; front: ReactNode; back: ReactNode }) {
  return (
    <div className="flip-card h-40" tabIndex={0} role="group" aria-label={label}>
      <div className="flip-card-inner h-full">
        <div className="flip-card-face absolute inset-0 rounded-xl border border-border bg-surface p-4">
          {front}
        </div>
        <div className="flip-card-face flip-card-back absolute inset-0 rounded-xl border border-brand/25 bg-surface p-4">
          {back}
        </div>
      </div>
    </div>
  );
}
