"use client";

import { useEffect, useRef, useState } from "react";
import type { Objective, Constraints } from "@/lib/portfolio/engines/optimize";
import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";
import type { CashPlanResponse } from "./types";

/**
 * Debounced live simulation of "what would this cash amount + objective do",
 * mirroring the Optimize tab's usePreview() hook exactly: re-fires only when
 * the inputs actually change, cancels a stale in-flight request via a ref
 * counter rather than trusting fetch ordering.
 */
export function useCashPreview(
  amount: number,
  objective: Objective,
  customTarget?: Partial<Record<PortfolioAssetClass, number>>,
  constraints?: Partial<Constraints>,
) {
  const [plan, setPlan] = useState<CashPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const customTargetKey = customTarget ? JSON.stringify(customTarget) : "";
  const constraintsKey = constraints ? JSON.stringify(constraints) : "";

  useEffect(() => {
    if (!Number.isFinite(amount) || amount <= 0) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPlan(null);
      setError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    const id = ++requestId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/portfolio/allocate-cash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, objective, customTarget, constraints }),
        });
        const json = await res.json();
        if (requestId.current !== id) return; // a newer request superseded this one
        if (!res.ok) throw new Error(json.error ?? "Failed to allocate cash");
        setPlan(json as CashPlanResponse);
      } catch (e) {
        if (requestId.current === id) setError(e instanceof Error ? e.message : "Failed to allocate cash");
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 350);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customTargetKey/constraintsKey are the intentional, content-stable dependencies.
  }, [amount, objective, customTargetKey, constraintsKey]);

  return { plan, loading, error };
}
