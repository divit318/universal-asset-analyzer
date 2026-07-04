"use client";

import { useEffect, useState } from "react";
import { SmartAlerts } from "@/app/portfolio/_components/smart-alerts";
import type { WatchlistAlert } from "@/lib/types";

/**
 * Watchlist Intelligence for the researched symbol — reuses SmartAlerts'
 * rendering (generalized to AlertLike[]) and /api/watchlist/symbol-alerts'
 * wrap of the canonical gatherWatchlistAlerts() orchestration. Renders
 * nothing when there are no active alerts, to avoid clutter for a symbol
 * with nothing notable to flag.
 */
export function WatchlistIntelligenceCard({ symbol }: { symbol: string }) {
  const [alerts, setAlerts] = useState<WatchlistAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void fetch(`/api/watchlist/symbol-alerts?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setAlerts(data?.alerts ?? []); })
      .catch(() => { if (!cancelled) setAlerts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (loading) return <div className="h-16 w-full animate-pulse rounded-xl bg-surface-2" />;
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted">Watchlist Intelligence</h3>
        <div className="h-px flex-1 bg-border" />
      </div>
      <SmartAlerts alerts={alerts} />
    </div>
  );
}
