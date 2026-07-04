"use client";

import Link from "next/link";
import type { ScannerOpportunity } from "@/lib/types";

const DIR_STYLE = {
  bullish: { badge: "text-positive bg-positive/10 border-positive/25", arrow: "↑" },
  bearish: { badge: "text-negative bg-negative/10 border-negative/25", arrow: "↓" },
  neutral: { badge: "text-muted bg-muted/10 border-muted/20", arrow: "→" },
};

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
          className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase shrink-0 ${dir.badge}`}
        >
          {dir.arrow}
        </span>
        <span className="text-[11px] text-muted truncate">{opportunity.rationale}</span>
      </div>
      <span className="shrink-0 font-mono text-[10px] font-bold text-foreground">
        {opportunity.opportunityScore.composite}
      </span>
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
  if (watchlistSymbols.length === 0) return null;

  const watchlistSet = new Set(watchlistSymbols.map((s) => s.replace(/\.(NS|BO)$/, "").toUpperCase()));
  const affected = opportunities.filter((o) => {
    const stripped = o.ticker.replace(/\.(NS|BO)$/, "").toUpperCase();
    return watchlistSet.has(stripped);
  });

  if (affected.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Watchlist Impact</h2>
        <Link href="/watchlist" className="text-xs text-accent hover:underline">
          View Watchlist →
        </Link>
      </div>
      <div className="flex flex-col gap-0.5">
        {affected.slice(0, 5).map((o) => (
          <ImpactRow key={o.id} opportunity={o} />
        ))}
      </div>
      {affected.length === 0 && (
        <p className="text-xs text-muted/60">No signals affecting your watchlist today.</p>
      )}
    </div>
  );
}

export function PortfolioImpact({
  opportunities,
  portfolioSymbols,
}: {
  opportunities: ScannerOpportunity[];
  portfolioSymbols: string[];
}) {
  if (portfolioSymbols.length === 0) return null;

  const portfolioSet = new Set(portfolioSymbols.map((s) => s.replace(/\.(NS|BO)$/, "").toUpperCase()));
  const affected = opportunities.filter((o) => {
    const stripped = o.ticker.replace(/\.(NS|BO)$/, "").toUpperCase();
    return portfolioSet.has(stripped);
  });

  if (affected.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Portfolio Impact</h2>
        <Link href="/portfolio" className="text-xs text-accent hover:underline">
          View Portfolio →
        </Link>
      </div>
      <div className="flex flex-col gap-0.5">
        {affected.slice(0, 5).map((o) => (
          <ImpactRow key={o.id} opportunity={o} />
        ))}
      </div>
      {affected.length === 0 && (
        <p className="text-xs text-muted/60">No signals affecting your portfolio today.</p>
      )}
    </div>
  );
}
