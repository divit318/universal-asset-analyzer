"use client";

import type { AnalystChecklistItem } from "@/lib/thematic-engine";
import { Badge } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { Empty } from "./shared";

export function ChecklistTab({ items }: { items: AnalystChecklistItem[] }) {
  if (items.length === 0) return <Empty>The checklist could not be assembled for this report.</Empty>;

  // "unscored" is honest absence: no stage output grades that answer, so it
  // gets a hollow dot and no verdict badge instead of a fake "neutral".
  const SIGNAL = {
    positive: { dot: "bg-positive", variant: "positive" },
    neutral: { dot: "bg-muted", variant: "neutral" },
    negative: { dot: "bg-negative", variant: "negative" },
    unscored: { dot: "border border-border bg-transparent", variant: null },
  } as const;

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        The ten questions this framework insists on answering before capital moves. Each answer is assembled from the
        stage above it, so nothing here is a second opinion.
      </p>
      {items.map((item, i) => {
        const signal = SIGNAL[item.signal] ?? SIGNAL.unscored;
        return (
          <Reveal
            key={i}
            index={i}
            className="flex gap-4 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong"
          >
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${signal.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs tabular-nums text-muted/60">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-sm font-semibold leading-snug">{item.question}</span>
              </div>
              <p className="mt-1.5 pl-7 text-sm leading-relaxed text-muted">{item.answer || "Not answered by this run."}</p>
            </div>
            {signal.variant && <Badge variant={signal.variant}>{item.signal}</Badge>}
          </Reveal>
        );
      })}
    </div>
  );
}
