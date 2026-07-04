"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { DashboardResponse } from "@/app/api/dashboard/route";

const TREND_STYLE: Record<string, { label: string; className: string }> = {
  "risk-on": { label: "Risk-On", className: "text-positive border-positive/30 bg-positive/10" },
  "risk-off": { label: "Risk-Off", className: "text-negative border-negative/30 bg-negative/10" },
  neutral: { label: "Neutral / Mixed", className: "text-muted border-border bg-surface-2" },
};

const SEVERITY_DOT: Record<string, string> = { high: "bg-negative", medium: "bg-amber-400", low: "bg-muted" };

/**
 * Market Dashboard — the daily command center. Pure composition: synthesizes
 * Sector Rotation, Portfolio alerts/opportunities, Watchlist Intelligence
 * alerts, market regime, and the earnings calendar into one view. No new
 * business logic lives here — everything is computed by /api/dashboard.
 */
export function MarketDashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />)}
      </div>
    );
  }
  if (!data) return null;

  const trend = data.regime ? TREND_STYLE[data.regime.trend] ?? TREND_STYLE.neutral : null;
  const allAlerts = [
    ...data.portfolioAlerts.map((a) => ({ severity: a.severity, title: a.title, href: "/portfolio" })),
    ...data.watchlistAlerts.map((a) => ({ severity: a.severity, title: a.title, href: "/watchlist" })),
  ].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-4">
      {/* Regime + top-line stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Market Regime</p>
          {trend ? (
            <>
              <span className={`inline-block rounded-full border px-2.5 py-1 text-xs font-semibold ${trend.className}`}>
                {trend.label}
              </span>
              {data.regime?.breadthPct != null && (
                <p className="text-[11px] text-muted mt-2">{data.regime.breadthPct}% of sectors advancing</p>
              )}
            </>
          ) : <p className="text-xs text-muted">Unavailable</p>}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Sector Leadership</p>
          {data.sectorRotation && data.sectorRotation.leaders.length > 0 ? (
            <p className="text-xs text-foreground/85 leading-5">
              {data.sectorRotation.leaders.join(", ")}
            </p>
          ) : <p className="text-xs text-muted">No snapshot yet</p>}
          <Link href="/scanner" className="text-[11px] text-accent hover:underline mt-2 inline-block">Full rotation grid →</Link>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Portfolio</p>
          {data.portfolioValue != null ? (
            <>
              <p className="font-mono text-lg font-bold">{formatCurrency(data.portfolioValue)}</p>
              <p className="text-[11px] text-muted mt-1">
                Health {data.portfolioHealthScore ?? "n/a"}/100 · {data.portfolioAlerts.length} alert{data.portfolioAlerts.length === 1 ? "" : "s"}
              </p>
            </>
          ) : <p className="text-xs text-muted">No positions tracked</p>}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Next Event</p>
          {data.upcomingEvents[0] ? (
            <>
              <p className="text-xs font-semibold text-foreground">{data.upcomingEvents[0].name}</p>
              <p className="text-[11px] text-muted mt-1">{data.upcomingEvents[0].date}</p>
            </>
          ) : <p className="text-xs text-muted">None scheduled</p>}
          <Link href="/calendar" className="text-[11px] text-accent hover:underline mt-2 inline-block">Full calendar →</Link>
        </div>
      </div>

      {/* Alerts + Opportunities */}
      {(allAlerts.length > 0 || data.topOpportunities.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {allAlerts.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-3">Priority Alerts</p>
              <div className="flex flex-col gap-2">
                {allAlerts.map((a, i) => (
                  <Link key={i} href={a.href} className="flex items-start gap-2 text-xs hover:text-accent">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[a.severity]}`} />
                    <span className="text-foreground/85">{a.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {data.topOpportunities.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-3">Top Opportunities</p>
              <div className="flex flex-col gap-2">
                {data.topOpportunities.map((o) => (
                  <Link key={o.symbol} href={`/research?symbol=${o.symbol}`} className="flex items-center justify-between text-xs hover:text-accent">
                    <span className="font-mono font-semibold">{o.symbol}</span>
                    <span className="text-muted">{o.action} · {o.composite}/100</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
