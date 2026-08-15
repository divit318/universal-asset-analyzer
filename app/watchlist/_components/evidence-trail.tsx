"use client";

/**
 * The evidence trail — what has actually happened to this idea, as chips.
 *
 * Every chip is derived from a store that recorded the work when it happened
 * (research visits, AI sessions, valuation cases, notes, the thesis fields,
 * the journal). Absent artifacts render as a dimmed "—" chip rather than
 * disappearing: "no thesis yet" is information, and a trail that only shows
 * what exists cannot be scanned column-wise across rows.
 *
 * `compact` keeps the row narrow for the table: research recency and the
 * thesis always render (they are the two facts the old pipeline lied about);
 * other artifacts appear only once they exist.
 */

import { evidenceTrail, type IdeaEvidence } from "@/lib/ideas/evidence";
import type { Conviction } from "@/lib/types";

export function EvidenceTrail({
  item,
  evidence,
  compact = false,
  className = "",
}: {
  item: { notes: string | null; buyTrigger: string | null; sellTrigger: string | null; conviction: Conviction | null };
  evidence: IdeaEvidence;
  compact?: boolean;
  className?: string;
}) {
  const chips = evidenceTrail(item, evidence).filter(
    (c) => !compact || c.present || c.key === "research" || c.key === "thesis",
  );
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 ${className}`}>
      {chips.map((c, i) => (
        <span key={c.key} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
          {i > 0 ? (
            <span aria-hidden className="text-faint/50">
              ·
            </span>
          ) : null}
          <span
            title={c.title}
            className={`text-[10px] tabular-nums ${c.present ? "text-foreground/75" : "text-faint/60"}`}
          >
            {c.label}
          </span>
        </span>
      ))}
    </span>
  );
}
