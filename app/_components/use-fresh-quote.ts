"use client";

import { useEffect, useRef, useState } from "react";
import type { Quote } from "@/lib/types";

/**
 * Fetch a fresh quote the instant a caller mounts/enables it — whatever price
 * is already on screen (a watchlist row, a holdings table) could be stale by
 * the time the user gets around to acting on it. Shared by every buy/sell
 * flow that needs a live price at the moment of transaction (Watchlist Buy,
 * Manage Holding) rather than duplicating the same fetch-with-cancellation
 * hook per component.
 */
export function useFreshQuote(symbol: string | null, enabled: boolean) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const refetch = () => {
    if (!symbol) return;
    const token = ++tokenRef.current;
    setLoading(true);
    setError(null);
    fetch(`/api/quote?symbols=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const json = await r.json();
        if (tokenRef.current !== token) return;
        if (!r.ok) throw new Error(json.error ?? "Failed to fetch price");
        const q = (json.quotes as Quote[] | undefined)?.[0] ?? null;
        if (!q) throw new Error(`No live price available for ${symbol}`);
        setQuote(q);
      })
      .catch((e: unknown) => {
        if (tokenRef.current !== token) return;
        setQuote(null);
        setError(e instanceof Error ? e.message : "Failed to fetch price");
      })
      .finally(() => {
        if (tokenRef.current === token) setLoading(false);
      });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (enabled && symbol) refetch(); }, [enabled, symbol]);

  return { quote, loading, error, refetch };
}
