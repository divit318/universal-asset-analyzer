"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Objective } from "@/lib/portfolio/engines/optimize";
import type { BuyRecommendationResponse } from "./types";

/**
 * Fetches the portfolio-aware buy recommendation for `symbol`, mirroring the
 * Portfolio page's useCashPreview() exactly: debounced, cancels a stale
 * in-flight request via a ref counter, refires whenever an input that
 * actually changes the recommendation changes.
 *
 * `amount`, when set, is the Live Preview override — the modal's currently
 * customized size (already resolved to dollars from whatever sizing mode is
 * active). Passing it makes the response describe that exact amount instead
 * of the engine's own optimal size, so impact/funding/warnings stay correct
 * while the user is exploring a size other than the recommendation.
 *
 * `enabled` (default true) skips fetching entirely — used by the modal's Live
 * Preview instance so it stays inert while the user isn't in manual mode.
 *
 * The recommendation is a function of portfolio state the modal does not own,
 * so it also revalidates when the tab regains focus: buying or selling in
 * another tab changes cash, weights and concentration, and a recommendation
 * computed against the pre-trade portfolio would quietly be wrong.
 */
export function useBuyRecommendation(symbol: string, name: string, objective: Objective, amount?: number, enabled = true) {
  const [recommendation, setRecommendation] = useState<BuyRecommendationResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const requestId = useRef(0);

  const refetch = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      requestId.current++; // invalidate any in-flight request from a moment ago
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing loading to the `enabled` prop transitioning true->false, not derivable at render time
      setLoading(false);
      return;
    }
    const id = ++requestId.current;

    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/portfolio/buy/recommendation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, name, objective, amount }),
        });
        const json = await res.json();
        if (requestId.current !== id) return;
        if (!res.ok) throw new Error(json.error ?? "Failed to build recommendation");
        setRecommendation(json as BuyRecommendationResponse);
      } catch (e) {
        if (requestId.current === id) setError(e instanceof Error ? e.message : "Failed to build recommendation");
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 150);

    return () => clearTimeout(t);
  }, [symbol, name, objective, amount, enabled, reloadTick]);

  // Revalidate against portfolio changes made elsewhere while this modal was open.
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, refetch]);

  return { recommendation, loading, error, refetch };
}
