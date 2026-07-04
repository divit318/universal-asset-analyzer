"use client";

/**
 * Structural shape shared by PortfolioAlert (lib/portfolio-analytics.ts) and
 * WatchlistAlert (lib/types.ts) — both are deterministic, severity-sorted
 * alert lists with an identical field set, by design (ai-watchlist.ts's
 * computeWatchlistAlerts() explicitly mirrors this component's pattern).
 * Typed structurally here so this one renderer serves both, instead of a
 * duplicate "WatchlistAlerts" component.
 */
export interface AlertLike {
  type: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  action: string;
  symbol?: string;
}

const SEVERITY_STYLE: Record<AlertLike["severity"], string> = {
  high:   "border-negative/30 bg-negative/5",
  medium: "border-warning/30 bg-warning/5",
  low:    "border-border bg-surface",
};

const SEVERITY_DOT: Record<AlertLike["severity"], string> = {
  high:   "bg-negative",
  medium: "bg-warning",
  low:    "bg-muted",
};

const SEVERITY_LABEL: Record<AlertLike["severity"], string> = {
  high:   "High",
  medium: "Medium",
  low:    "Low",
};

const TYPE_ICON: Record<string, string> = {
  concentration:     "⬟",
  valuation:         "◈",
  momentum:          "↘",
  diversification:   "⊕",
  rebalance:         "⇄",
  risk:              "△",
  new_opportunity:   "★",
  deteriorating:     "▽",
  breakout:          "↗",
  sector_leadership: "⬢",
};
const DEFAULT_TYPE_ICON = "•";

export function SmartAlerts({ alerts }: { alerts: AlertLike[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-4">
        <p className="text-sm text-muted">No active alerts — portfolio looks healthy.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {alerts.map((alert, i) => (
        <div key={i} className={`rounded-xl border px-4 py-3.5 ${SEVERITY_STYLE[alert.severity]}`}>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-base shrink-0">{TYPE_ICON[alert.type] ?? DEFAULT_TYPE_ICON}</span>
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
  );
}
