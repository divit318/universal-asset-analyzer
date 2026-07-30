"use client";

import { useState } from "react";
import { Card, Badge, Button, ScoreChip } from "@/app/_components/ui";
import { Dialog } from "@/app/_components/dialog";
import { formatCurrency } from "@/lib/format";
import { OBJECTIVES } from "@/lib/portfolio/engines/optimize";
import type { Simulation, SimulationStatus } from "@/lib/portfolio/simulator/types";

const STATUS: Record<SimulationStatus, { label: string; variant: "neutral" | "positive" | "brand" }> = {
  draft: { label: "Draft", variant: "neutral" },
  complete: { label: "Ready", variant: "positive" },
  promoted: { label: "Promoted", variant: "brand" },
};

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

/**
 * Saved simulations, newest-updated first. Total value and health come from
 * the denormalized headline (refreshed on every evaluation) — a Draft that has
 * never been generated legitimately has neither, and shows neither.
 */
export function SimulationList({
  simulations,
  onOpen,
  onCompare,
  onDuplicate,
  onDelete,
  busyId,
}: {
  simulations: Simulation[];
  onOpen: (sim: Simulation) => void;
  onCompare: (sim: Simulation) => void;
  onDuplicate: (sim: Simulation) => void;
  onDelete: (sim: Simulation) => void;
  /** Simulation id currently being duplicated/deleted, to disable its actions. */
  busyId: string | null;
}) {
  const [confirmDelete, setConfirmDelete] = useState<Simulation | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {simulations.map((sim) => {
          const status = STATUS[sim.status];
          const busy = busyId === sim.id;
          return (
            <li key={sim.id}>
              <Card className="flex flex-col gap-2.5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 max-w-full flex-col gap-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      {/* min-w-0 at every flex level or `truncate` never engages —
                          a long name would otherwise force the page wider than a
                          phone viewport instead of ellipsizing. */}
                      <button
                        onClick={() => onOpen(sim)}
                        className="min-w-0 max-w-full truncate text-left text-sm font-semibold text-foreground hover:text-brand hover:underline"
                      >
                        {sim.name}
                      </button>
                      <Badge variant={status.variant}>{status.label}</Badge>
                      <Badge variant="neutral">{OBJECTIVES[sim.profile.objective]?.label ?? sim.profile.objective}</Badge>
                    </span>
                    <span className="text-[11px] text-muted">
                      Created {relativeDate(sim.createdAt)} · Updated {relativeDate(sim.updatedAt)}
                      {" · "}
                      {formatCurrency(sim.profile.cash, sim.profile.currency)} mandate · Risk{" "}
                      {sim.profile.riskAppetite}/10
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    {sim.headline && (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                          {formatCurrency(sim.headline.totalValue, sim.profile.currency)}
                        </span>
                        <span className="text-[11px] text-muted">
                          {sim.headline.holdingCount} holdings · {sim.headline.assetClassCount} classes
                        </span>
                      </div>
                    )}
                    {sim.headline?.healthScore != null && (
                      <ScoreChip kind="health" score={sim.headline.healthScore} size="sm" />
                    )}
                  </div>
                </div>

                {sim.thesis && (
                  <p className="line-clamp-2 text-xs leading-relaxed text-muted">{sim.thesis.summary}</p>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="xs" variant="secondary" onClick={() => onOpen(sim)} disabled={busy}>
                    Open
                  </Button>
                  {sim.holdings.length > 0 && (
                    <Button size="xs" variant="ghost" onClick={() => onCompare(sim)} disabled={busy}>
                      Compare
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={() => onDuplicate(sim)} disabled={busy}>
                    Duplicate
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(sim)} disabled={busy}>
                    Delete
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete simulation"
        className="max-w-sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs leading-relaxed text-muted">
            Delete <strong className="text-foreground">{confirmDelete?.name}</strong>? This removes the
            saved profile and hypothetical holdings permanently.
            {confirmDelete?.status === "promoted" && " Your real portfolio is not affected."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirmDelete) onDelete(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
