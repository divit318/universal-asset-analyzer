"use client";

import Link from "next/link";
import type { ScannerOpportunity } from "@/lib/types";

const DIR_STYLE = {
  bullish: { badge: "text-positive bg-positive/10 border-positive/25", arrow: "↑" },
  bearish: { badge: "text-negative bg-negative/10 border-negative/25", arrow: "↓" },
  neutral: { badge: "text-muted bg-muted/10 border-muted/20", arrow: "→" },
};

function symbolKey(s: string): string {
  return s.replace(/\.(NS|BO)$/, "").toUpperCase();
}

function ImpactRow({ opportunity }: { opportunity: ScannerOpportunity }) {
  const dir = DIR_STYLE[opportunity.direction];
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href={`/stocks/${encodeURIComponent(opportunity.ticker)}`}
          className="font-mono text-xs font-semibold text-accent hover:underline shrink-0"
        >
          {opportunity.ticker}
        </Link>
        <span
          className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase shrink-0 ${dir.badge}`}
          aria-label={opportunity.direction}
        >
          {dir.arrow}
        </span>
        <span className="text-caption text-muted truncate">{opportunity.rationale}</span>
      </div>
      <span
        className="shrink-0 font-mono text-[10px] font-bold text-foreground"
        title="Composite opportunity score (0–100)"
      >
        {opportunity.opportunityScore.composite}
      </span>
    </div>
  );
}

/**
 * One panel, two callers (Watchlist / Portfolio). "No overlap" renders as a
 * statement rather than unmounting: "this scan doesn't touch what you own"
 * answers the reader's question; a silently missing panel doesn't.
 */
function ImpactPanel({
  title,
  linkHref,
  linkLabel,
  emptyText,
  opportunities,
  symbols,
}: {
  title: string;
  linkHref: string;
  linkLabel: string;
  emptyText: string;
  opportunities: ScannerOpportunity[];
  symbols: string[];
}) {
  if (symbols.length === 0) return null;

  const tracked = new Set(symbols.map(symbolKey));
  const affected = opportunities.filter((o) => tracked.has(symbolKey(o.ticker)));

  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Link href={linkHref} className="text-xs text-accent hover:underline">
          {linkLabel} →
        </Link>
      </div>
      {affected.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {affected.slice(0, 5).map((o) => (
            <ImpactRow key={o.id} opportunity={o} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted/60">{emptyText}</p>
      )}
    </div>
  );
}

export function WatchlistImpact({
  opportunities,
  watchlistSymbols,
}: {
  opportunities: ScannerOpportunity[];
  watchlistSymbols: string[];
}) {
  return (
    <ImpactPanel
      title="Watchlist Impact"
      linkHref="/watchlist"
      linkLabel="View Watchlist"
      emptyText="No signal from this scan touches a name you follow."
      opportunities={opportunities}
      symbols={watchlistSymbols}
    />
  );
}

export function PortfolioImpact({
  opportunities,
  portfolioSymbols,
}: {
  opportunities: ScannerOpportunity[];
  portfolioSymbols: string[];
}) {
  return (
    <ImpactPanel
      title="Portfolio Impact"
      linkHref="/portfolio"
      linkLabel="View Portfolio"
      emptyText="No signal from this scan touches a position you hold."
      opportunities={opportunities}
      symbols={portfolioSymbols}
    />
  );
}
