"use client";

import { useCallback } from "react";
import { useDebouncedSimulation } from "../use-debounced-simulation";
import type { Objective, Constraints } from "@/lib/portfolio/engines/optimize";
import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";
import type { CashPlanResponse } from "./types";

/**
 * Debounced live simulation of "what would this cash amount + objective do",
 * sharing its debounce/stale-guard core with the Optimize tab's usePreview()
 * via useDebouncedSimulation() — only the fetch and the skip condition differ.
 */
export function useCashPreview(
  amount: number,
  objective: Objective,
  customTarget?: Partial<Record<PortfolioAssetClass, number>>,
  constraints?: Partial<Constraints>,
) {
  const customTargetKey = customTarget ? JSON.stringify(customTarget) : "";
  const constraintsKey = constraints ? JSON.stringify(constraints) : "";

  const fetcher = useCallback(async (): Promise<CashPlanResponse> => {
    const res = await fetch("/api/portfolio/allocate-cash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, objective, customTarget, constraints }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to allocate cash");
    return json as CashPlanResponse;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customTargetKey/constraintsKey stand in for customTarget/constraints' content.
  }, [amount, objective, customTargetKey, constraintsKey]);

  const { data: plan, loading, error } = useDebouncedSimulation(
    fetcher,
    `${amount}|${objective}|${customTargetKey}|${constraintsKey}`,
    !Number.isFinite(amount) || amount <= 0,
    "Failed to allocate cash",
  );

  return { plan, loading, error };
}
