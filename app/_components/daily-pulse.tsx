"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CalendarResponse } from "@/app/api/calendar/route";
import type { PortfolioAnalytics } from "@/app/api/portfolio/analytics/route";
import type { WatchlistItem } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";

interface PulseData {
  portfolio: PortfolioAnalytics | null;
  watchlist: WatchlistItem[];
  nextEvent: { name: string; date: string; type: string; symbol?: string } | null;
}

function PulseCard({
  href,
  label,
  value,
  sub,
  positive,
  empty,
  emptyHref,
  emptyLabel,
}: {
  href: string;
  label: string;
  value?: string;
  sub?: string;
  positive?: boolean;
  empty?: boolean;
  emptyHref?: string;
  emptyLabel?: string;
}) {
  if (empty) {
    return (
      <Link
        href={emptyHref ?? href}
        className="flex flex-col gap-1 rounded-xl border border-dashed border-border bg-surface px-4 py-3 transition-colors hover:border-accent/30 hover:bg-surface-2"
      >
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">{label}</span>
        <span className="text-xs text-muted">{emptyLabel ?? "Set up →"}</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/20 hover:bg-surface-2"
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">{label}</span>
      <span
        className={`font-mono text-sm font-semibold ${
          positive === true ? "text-positive" : positive === false ? "text-negative" : "text-foreground"
        }`}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-muted">{sub}</span>}
    </Link>
  );
}

export function DailyPulse() {
  const [data, setData] = useState<PulseData | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/portfolio/analytics")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/watchlist")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/calendar")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([analytics, watchlistJson, calJson]) => {
      const portfolio = analytics as PortfolioAnalytics | null;
      const watchlist = ((watchlistJson as { items?: WatchlistItem[] } | null)?.items ?? []) as WatchlistItem[];

      const cal = calJson as CalendarResponse | null;
      const today = new Date().toISOString().slice(0, 10);
      const cutoff = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const upcoming = (cal?.events ?? [])
        .filter((e) => e.date >= today && e.date <= cutoff)
        .sort((a, b) => a.date.localeCompare(b.date));
      const nextEvent = upcoming[0]
        ? { name: upcoming[0].name, date: upcoming[0].date, type: upcoming[0].type, symbol: upcoming[0].symbol }
        : null;

      setData({ portfolio, watchlist, nextEvent });
    });
  }, []);

  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
    );
  }

  const { portfolio, watchlist, nextEvent } = data;
  const hasPortfolio = portfolio && portfolio.positionCount > 0;
  const totalReturn = hasPortfolio ? portfolio.totalReturn : null;

  const alertCount = watchlist.filter(
    (w) => (w.targetPrice != null && w.targetPrice > 0) || (w.alertPctDrop != null && w.alertPctDrop > 0),
  ).length;

  const nextEventLabel = nextEvent
    ? `${nextEvent.symbol ? `${nextEvent.symbol} · ` : ""}${nextEvent.date.slice(5).replace("-", "/")}`
    : null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {/* Portfolio */}
      {hasPortfolio ? (
        <PulseCard
          href="/portfolio"
          label="Portfolio"
          value={formatCurrency(portfolio!.totalValue)}
          sub={`${totalReturn! >= 0 ? "+" : ""}${totalReturn!.toFixed(1)}% total return · ${portfolio!.positionCount} positions`}
          positive={totalReturn! >= 0}
        />
      ) : (
        <PulseCard
          href="/portfolio"
          label="Portfolio"
          empty
          emptyHref="/portfolio"
          emptyLabel="Add your first holding →"
        />
      )}

      {/* Watchlist */}
      {watchlist.length > 0 ? (
        <PulseCard
          href="/watchlist"
          label="Watchlist"
          value={`${watchlist.length} stocks`}
          sub={alertCount > 0 ? `${alertCount} price ${alertCount === 1 ? "alert" : "alerts"} set` : "No alerts set"}
        />
      ) : (
        <PulseCard
          href="/watchlist"
          label="Watchlist"
          empty
          emptyHref="/watchlist"
          emptyLabel="Start tracking stocks →"
        />
      )}

      {/* Next event */}
      {nextEvent ? (
        <PulseCard
          href="/calendar"
          label="Next event"
          value={nextEvent.name.length > 28 ? `${nextEvent.name.slice(0, 28)}…` : nextEvent.name}
          sub={nextEventLabel ?? ""}
        />
      ) : (
        <PulseCard href="/calendar" label="Events calendar" empty emptyLabel="View upcoming events →" />
      )}

      {/* Quick link to scanner */}
      <Link
        href="/scanner"
        className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/20 hover:bg-surface-2 group"
      >
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Market scanner</span>
        <span className="text-sm font-medium text-foreground group-hover:text-accent transition-colors">
          Scan for signals →
        </span>
        <span className="text-[11px] text-muted">AI-powered market intelligence</span>
      </Link>
    </div>
  );
}
