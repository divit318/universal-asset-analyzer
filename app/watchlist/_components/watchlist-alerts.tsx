"use client";

import type { WatchlistAlert } from "@/lib/types";

const SEVERITY_STYLE: Record<WatchlistAlert["severity"], string> = {
  high:   "border-negative/30 bg-negative/5",
  medium: "border-amber-400/30 bg-amber-400/5",
  low:    "border-border bg-surface",
};

const SEVERITY_DOT: Record<WatchlistAlert["severity"], string> = {
  high:   "bg-negative",
  medium: "bg-amber-400",
  low:    "bg-muted",
};

const SEVERITY_LABEL: Record<WatchlistAlert["severity"], string> = {
  high:   "High",
  medium: "Medium",
  low:    "Low",
};

const TYPE_ICON: Record<WatchlistAlert["type"], string> = {
  new_opportunity:  "✦",
  deteriorating:    "▽",
  breakout:         "↗",
  sector_leadership: "⬟",
  valuation:        "◈",
};

/** Watchlist Intelligence — structured proactive alerts, mirrors SmartAlerts (Portfolio). */
export function WatchlistAlerts({ alerts }: { alerts: WatchlistAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Watchlist Intelligence</h2>
      <div className="flex flex-col gap-2">
        {alerts.map((alert, i) => (
          <div key={i} className={`rounded-xl border px-4 py-3.5 ${SEVERITY_STYLE[alert.severity]}`}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-base shrink-0">{TYPE_ICON[alert.type]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-semibold">{alert.title}</span>
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${SEVERITY_STYLE[alert.severity]}`}>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[alert.severity]}`} />
                    {SEVERITY_LABEL[alert.severity]}
                  </span>
                </div>
                <p className="text-xs text-muted leading-relaxed">{alert.description}</p>
                <p className="mt-1.5 text-xs text-foreground/70 font-medium">→ {alert.action}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
