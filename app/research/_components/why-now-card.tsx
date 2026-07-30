"use client";

import type { InvestmentVerdict } from "@/app/api/ai/verdict/route";
import type { SectorRotationEntry } from "@/lib/types";
import { Reveal } from "@/app/_components/reveal";

/**
 * "Why Now?" — pure client-side composition of data already fetched
 * elsewhere on the page (verdict catalysts, sector rotation, nearest
 * timeline milestone). No new backend call of its own.
 *
 * Hover/focus turns the card over (`.uaa-flip-scene`, app/globals.css) to a
 * reverse face carrying the supporting detail behind the front's bullets —
 * the full AI thesis, plus one counterbalancing risk — rather than a tooltip
 * or an expand/collapse that pushes the page around.
 */

interface Props {
  verdict: InvestmentVerdict | null;
  sectorEntry: SectorRotationEntry | null;
  /** Nearest timeline milestone headline within ~90 days, from TimelinePreviewCard. */
  nearestTimelineHeadline?: string | null;
  /** Top movement driver description, from MovementExplainerCard. */
  topMovementDriver?: string | null;
}

export function WhyNowCard({ verdict, sectorEntry, nearestTimelineHeadline, topMovementDriver }: Props) {
  const points: string[] = [];

  if (verdict?.catalysts?.[0]) points.push(verdict.catalysts[0]);

  if (sectorEntry && (sectorEntry.classification === "leading" || sectorEntry.classification === "strengthening")) {
    points.push(
      `${sectorEntry.sector} sector is ${sectorEntry.classification} — rank #${sectorEntry.rank}/11 by relative strength, ${sectorEntry.returns["1m"] != null ? `${sectorEntry.returns["1m"] >= 0 ? "+" : ""}${sectorEntry.returns["1m"].toFixed(1)}% over 1 month` : "improving momentum"}.`,
    );
  }

  if (topMovementDriver) points.push(topMovementDriver);
  if (nearestTimelineHeadline) points.push(`Upcoming: ${nearestTimelineHeadline}`);

  if (points.length === 0) return null;

  const thesis = verdict?.thesis || null;
  const counterpoint = verdict?.risks?.[0] || null;
  const hasBack = Boolean(thesis || counterpoint);

  const front = (
    <div className="flex flex-col gap-2.5 rounded-xl border border-accent/20 bg-accent/5 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-accent/80">Why Now?</span>
        {hasBack && (
          <span className="text-[9px] font-medium uppercase tracking-wide text-accent/50">Hover for thesis</span>
        )}
      </div>
      <ul className="space-y-1.5">
        {points.slice(0, 4).map((p, i) => (
          <Reveal key={i} as="li" index={i} className="flex gap-2 text-xs leading-5 text-foreground/85">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/50" />
            {p}
          </Reveal>
        ))}
      </ul>
    </div>
  );

  if (!hasBack) return front;

  return (
    <div className="uaa-flip-scene">
      <div className="uaa-flip-card">
        <div className="uaa-flip-face">{front}</div>
        <div className="uaa-flip-face uaa-flip-face-back flex flex-col gap-2.5 rounded-xl border border-accent/20 bg-accent/5 p-4">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-accent/80">The Thesis</span>
          {thesis && <p className="text-xs leading-5 text-foreground/85">{thesis}</p>}
          {counterpoint && (
            <div className="mt-auto flex gap-2 border-t border-accent/10 pt-2 text-xs leading-5 text-foreground/70">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning/60" />
              <span>
                <span className="font-medium text-warning/80">Counterpoint: </span>
                {counterpoint}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
