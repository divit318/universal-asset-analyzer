"use client";

import type { SectorRotationEntry } from "@/lib/types";
import { Reveal } from "@/app/_components/reveal";

/**
 * "Why Now?" — pure client-side composition of TIMING context that appears
 * nowhere else on the page: sector rotation state, today's top movement
 * driver, and the nearest upcoming milestone. The AI verdict's catalysts are
 * deliberately NOT repeated here (they already render in the hero and in
 * full on the Analysis tab). Static content — no hover/flip interaction, so
 * it works identically on a touchscreen or in a recording.
 */

interface Props {
  sectorEntry: SectorRotationEntry | null;
  /** Nearest timeline milestone headline within ~90 days, from TimelinePreviewCard. */
  nearestTimelineHeadline?: string | null;
  /** Top movement driver description, from MovementExplainerCard. */
  topMovementDriver?: string | null;
}

export function WhyNowCard({ sectorEntry, nearestTimelineHeadline, topMovementDriver }: Props) {
  const points: string[] = [];

  if (sectorEntry && (sectorEntry.classification === "leading" || sectorEntry.classification === "strengthening")) {
    points.push(
      `${sectorEntry.sector} sector is ${sectorEntry.classification} — rank #${sectorEntry.rank}/11 by relative strength, ${sectorEntry.returns["1m"] != null ? `${sectorEntry.returns["1m"] >= 0 ? "+" : ""}${sectorEntry.returns["1m"].toFixed(1)}% over 1 month` : "improving momentum"}.`,
    );
  }

  if (topMovementDriver) points.push(topMovementDriver);
  if (nearestTimelineHeadline) points.push(`Upcoming: ${nearestTimelineHeadline}`);

  if (points.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-accent/20 bg-accent/5 p-4">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-accent/80">Why Now?</span>
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
}
