"use client";

import { useCallback } from "react";
import { useDebouncedSimulation } from "../use-debounced-simulation";
import type { SelectedTrade } from "./use-trade-selection";
import type { Objective } from "@/lib/portfolio/engines/optimize";
import type { ImpactEstimate } from "@/lib/portfolio/engines/simulate";
import type { HealthScore } from "@/lib/portfolio/engines/health";
import type { UniversalRisk } from "@/lib/portfolio/engines/risk";
import type { PortfolioAllocation } from "@/lib/portfolio/engines/allocation";

export interface PreviewSide {
  totalValue: number;
  annualIncome: number;
  health: HealthScore;
  risk: UniversalRisk;
  allocation: PortfolioAllocation;
}

export interface PreviewResponse {
  before: PreviewSide;
  after: PreviewSide;
  impact: ImpactEstimate;
  skippedHoldingIds: string[];
  estimatedRealizedGainLoss: number;
}

/**
 * Debounced live simulation of the current trade selection (Feature 3),
 * shared by the Live Preview Panel and the Warnings Panel so both read one
 * fetch instead of two. Re-fires only when the selection's holdingIds or
 * partial percentages actually change.
 */
export function usePreview(selectedTrades: SelectedTrade[], objective: Objective) {
  const selectionKey = selectedTrades
    .map((t) => `${t.holdingId}:${t.partialPct}`)
    .sort()
    .join("|");

  const fetcher = useCallback(async (): Promise<PreviewResponse> => {
    const res = await fetch("/api/portfolio/optimize/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objective,
        trades: selectedTrades.map((tr) => ({ holdingId: tr.holdingId, partialPct: tr.partialPct })),
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to preview trades");
    return json as PreviewResponse;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectionKey stands in for selectedTrades' content.
  }, [selectionKey, objective]);

  const { data: preview, loading, error } = useDebouncedSimulation(
    fetcher,
    `${selectionKey}|${objective}`,
    selectedTrades.length === 0,
    "Failed to preview trades",
  );

  return { preview, loading, error };
}
