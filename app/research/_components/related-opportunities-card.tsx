"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Opportunity Map, scoped to this company's theme cluster — reuses
 * /api/opportunity-map as-is (lib/opportunity-map.ts reshapes the last
 * cached Scanner run, never re-scores). Since this data is scanner-cache-
 * dependent, a symbol outside the last scan simply has nothing to show —
 * that's a real data-availability constraint, not a bug, so this degrades
 * to a hint rather than an empty card.
 */

interface OpportunityNodeLite {
  id: string;
  symbol: string;
  name: string;
  theme: string;
  categoryLabel: string;
  opportunityScore: number;
  changePercent: number | null;
}

interface OpportunityClusterLite {
  theme: string;
  nodeIds: string[];
}

export function RelatedOpportunitiesCard({ symbol }: { symbol: string }) {
  const [nodes, setNodes] = useState<OpportunityNodeLite[]>([]);
  const [clusters, setClusters] = useState<OpportunityClusterLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void fetch("/api/opportunity-map")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setNodes(data?.nodes ?? []);
        setClusters(data?.clusters ?? []);
      })
      .catch(() => { if (!cancelled) { setNodes([]); setClusters([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (loading) return <div className="h-24 w-full animate-pulse rounded-xl bg-surface-2" />;

  const thisNode = nodes.find((n) => n.symbol === symbol.toUpperCase());
  if (!thisNode) return null; // not in the last scan — nothing to relate it to

  const cluster = clusters.find((c) => c.nodeIds.includes(thisNode.id));
  const siblings = cluster
    ? cluster.nodeIds
        .filter((id) => id !== thisNode.id)
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is OpportunityNodeLite => n != null)
        .sort((a, b) => b.opportunityScore - a.opportunityScore)
        .slice(0, 6)
    : [];

  if (siblings.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Related Opportunities</h3>
          <p className="text-xs text-muted">Theme: {thisNode.theme}</p>
        </div>
        <Link href="/wire" className="text-xs text-accent hover:underline">
          Explore in The Wire →
        </Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {siblings.map((n) => (
          <Link
            key={n.id}
            href={`/research?symbol=${encodeURIComponent(n.symbol)}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 transition-colors hover:border-accent/40"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">{n.symbol}</p>
              <p className="truncate text-[10px] text-muted">{n.categoryLabel}</p>
            </div>
            <span className="shrink-0 font-mono text-xs text-muted">{n.opportunityScore}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
