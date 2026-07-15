"use client";

/**
 * Module 6 — Opportunity Feed.
 *
 * Scanner opportunities, ranked by *fit to this portfolio* rather than by raw
 * score — the ranking `buildOpportunitySnapshot()` already performs. A 90-score
 * name that duplicates your largest existing exposure is not an opportunity for
 * you, and that is the whole point of ranking on fit.
 *
 * Scanner freshness is shown rather than hidden: an opportunity list built from
 * a week-old snapshot is a different claim from one built this morning.
 */

import Link from "next/link";
import { Badge } from "@/app/_components/ui";
import { getHomeModule } from "@/lib/home/registry";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("opportunity-feed");

const TIER: Record<string, "positive" | "brand" | "neutral" | "warning"> = {
  excellent: "positive",
  good: "brand",
  neutral: "neutral",
  poor: "warning",
  avoid: "warning",
};

export function OpportunityFeedModule() {
  const state = useHomeSlice("opportunityFeed");
  const { refreshDigest } = useHome();

  const unmet = state.data?.status === "empty" && state.data.opportunities.length === 0
    ? ("scanner-snapshot" as const)
    : null;

  return (
    <ModuleShell
      definition={definition}
      state={state}
      unmet={unmet}
      minHeight={180}
      onRefresh={refreshDigest}
      isEmpty={(d) => d.opportunities.length === 0}
      emptyMessage="No opportunities in the latest scan."
    >
      {(d) => (
        <div className="flex flex-col gap-3">
          {d.scannerFreshness && d.scannerFreshness.level === "stale" ? (
            <p className="text-xs text-warning">
              From a stale scan — re-run the scanner for current signals.
            </p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {d.opportunities.map((o) => (
              <li key={o.symbol}>
                <Link
                  href={`/research?symbol=${encodeURIComponent(o.symbol)}`}
                  className="flex items-start gap-3 rounded-control border border-border bg-surface-2 p-3 outline-none transition-colors hover:border-brand/30 focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <span className="font-mono text-sm font-semibold text-foreground">{o.symbol}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <Badge variant={TIER[o.fitTier] ?? "neutral"}>{o.fitTier} fit</Badge>
                      <span className="font-mono text-xs tabular-nums text-muted">{Math.round(o.combinedScore)}/100</span>
                    </span>
                    <span className="text-xs leading-5 text-muted">{o.fitSummary}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ModuleShell>
  );
}
