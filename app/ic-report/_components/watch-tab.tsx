"use client";

/**
 * IC Report — watch items tab (Phase 5.15).
 *
 * Structured monitorables: kind, trigger and source, deduplicated against
 * the signals tab (signal-kind items reference their category once), with a
 * hand-off to the Watchlist feature.
 */

import Link from "next/link";
import type { Monitorable } from "@/lib/ic-report";
import type { DataGap } from "@/lib/ic/canonical";
import { Card, EmptyState } from "./shared";

export function WatchTab({
  monitorables,
  symbol,
  gaps,
}: {
  monitorables: Monitorable[] | undefined;
  symbol: string;
  gaps: DataGap[] | undefined;
}) {
  if (!monitorables || monitorables.length === 0) {
    return <EmptyState title="No watch items yet" detail="Watch items derive from the thesis key drivers and high-severity signals once the run completes." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            What to track from here, and what would change the thesis.
          </p>
          <Link
            href={`/watchlist?symbol=${encodeURIComponent(symbol)}`}
            className="min-h-[36px] rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Open {symbol} in Watchlist
          </Link>
        </div>
        <ul className="space-y-3">
          {monitorables.map((m, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/20 text-xs font-semibold text-brand" aria-hidden="true">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p>{m.label}</p>
                <p className="mt-0.5 text-label text-muted">
                  <span className={`mr-1.5 rounded-full px-1.5 py-0.5 uppercase ${m.kind === "signal" ? "bg-warning/10 text-warning" : "bg-brand/10 text-brand"}`}>
                    {m.kind === "signal" ? "from a fired signal" : "thesis driver"}
                  </span>
                  {m.trigger && <span>Next step: {m.trigger}. </span>}
                  <span className="text-muted">Source: {m.source}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {gaps && gaps.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Data to backfill before the next review</h3>
          <ul className="space-y-1 text-xs text-muted">
            {gaps.map((g) => (
              <li key={g.concept}>
                <span className="font-medium text-foreground">{g.concept}:</span> {g.reason}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
