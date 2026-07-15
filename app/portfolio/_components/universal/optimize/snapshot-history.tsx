"use client";

import { useCallback, useState } from "react";
import { Card, Badge, Button } from "@/app/_components/ui";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { formatCurrency } from "@/lib/format";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { OBJECTIVES, type Objective } from "@/lib/portfolio/engines/optimize";
import type { PortfolioSnapshot } from "@/lib/portfolio/engines/transaction";

const LABEL_TEXT: Record<string, string> = {
  "pre-execution": "Before optimization",
  "post-execution": "After optimization",
  manual: "Manual snapshot",
};

/**
 * Portfolio Snapshots (Feature 10) — every implementation's before/after pair,
 * visible as history. The foundation for future scenario comparison: each
 * snapshot already carries enough (raw ledger state + a denormalized summary)
 * to be diffed against any other, this view just doesn't do that diffing yet.
 */
export function SnapshotHistory({ refreshSignal }: { refreshSignal: number }) {
  const [expanded, setExpanded] = useState(false);

  const fetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/portfolio/optimize/snapshots?limit=20", { signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to load snapshots");
    return json.snapshots as PortfolioSnapshot[];
  }, []);

  const { data: snapshots, refresh } = useDataset<PortfolioSnapshot[]>("portfolioSnapshots", String(refreshSignal), fetcher, {
    enabled: expanded,
  });

  if (!expanded) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
        View snapshot history
      </Button>
    );
  }

  return (
    <CollapsibleSection title="Snapshot history" subtitle="Every implementation's before/after state" defaultOpen>
      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <button onClick={refresh} className="text-[11px] text-brand hover:underline">Refresh</button>
        </div>
        {!snapshots || snapshots.length === 0 ? (
          <p className="text-xs text-muted">No snapshots yet — one is taken automatically every time you implement trades.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {snapshots.map((s) => (
              <li key={s.id}>
                <Card className="flex items-center justify-between gap-3 p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      {LABEL_TEXT[s.label] ?? s.label}
                      {s.objective && <Badge variant="neutral">{OBJECTIVES[s.objective as Objective]?.label ?? s.objective}</Badge>}
                    </span>
                    <span className="text-[11px] text-muted">{new Date(s.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                      {formatCurrency(s.summary.totalValue)}
                    </span>
                    <span className="text-[11px] text-muted">
                      Health {s.summary.health} {s.summary.healthGrade}
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CollapsibleSection>
  );
}
