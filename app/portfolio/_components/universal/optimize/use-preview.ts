"use client";

import { useEffect, useRef, useState } from "react";
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
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const selectionKey = selectedTrades
    .map((t) => `${t.holdingId}:${t.partialPct}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (selectedTrades.length === 0) {
      // Syncing local state to the (external, debounced) selection going
      // empty — not derivable at render time.
      /* eslint-disable react-hooks/set-state-in-effect */
      setPreview(null);
      setError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    const id = ++requestId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/portfolio/optimize/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective,
            trades: selectedTrades.map((tr) => ({ holdingId: tr.holdingId, partialPct: tr.partialPct })),
          }),
        });
        const json = await res.json();
        if (requestId.current !== id) return; // a newer selection superseded this request
        if (!res.ok) throw new Error(json.error ?? "Failed to preview trades");
        setPreview(json as PreviewResponse);
      } catch (e) {
        if (requestId.current === id) setError(e instanceof Error ? e.message : "Failed to preview trades");
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 350);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectionKey is the intentional, content-stable dependency; selectedTrades itself is a new array every render.
  }, [selectionKey, objective]);

  return { preview, loading, error };
}
