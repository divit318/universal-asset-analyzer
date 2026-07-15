"use client";

/**
 * Module 7 — Watchlist Intelligence.
 *
 * Buckets, alerts, and upcoming earnings for names you're tracking. Symbols
 * with no alert appear in no bucket — see lib/home/watchlist-intel.ts for why
 * that's the honest outcome rather than a gap.
 */

import Link from "next/link";
import { Badge } from "@/app/_components/ui";
import { getHomeModule } from "@/lib/home/registry";
import type { WatchlistBucket } from "@/lib/home/contracts";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("watchlist-intelligence");

const BUCKET_TONE: Record<WatchlistBucket["id"], "positive" | "brand" | "negative"> = {
  buy: "positive",
  "near-buy": "brand",
  "high-risk": "negative",
};

function SymbolLink({ symbol }: { symbol: string }) {
  return (
    <Link
      href={`/research?symbol=${encodeURIComponent(symbol)}`}
      className="rounded-control border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs font-medium text-foreground outline-none transition-colors hover:border-brand/40 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      {symbol}
    </Link>
  );
}

export function WatchlistIntelligenceModule() {
  const state = useHomeSlice("watchlistIntelligence");
  const { refreshDigest } = useHome();

  const unmet = state.data?.status === "empty" ? ("watchlist" as const) : null;

  return (
    <ModuleShell
      definition={definition}
      state={state}
      unmet={unmet}
      minHeight={180}
      onRefresh={refreshDigest}
      isEmpty={(d) => d.total === 0}
      emptyMessage="Nothing on your watchlist yet."
    >
      {(d) => (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted">
            {d.total} name{d.total === 1 ? "" : "s"} tracked
            {d.buckets.length === 0 ? " · nothing has changed materially" : ""}
          </p>

          {d.buckets.map((b) => (
            <div key={b.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Badge variant={BUCKET_TONE[b.id]}>{b.label}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {b.symbols.map((s) => (
                  <SymbolLink key={s} symbol={s} />
                ))}
              </div>
            </div>
          ))}

          {d.upcomingEarnings.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-4">
              <span className="text-micro font-semibold uppercase tracking-wide text-muted">Upcoming earnings</span>
              <ul className="flex flex-col gap-1">
                {d.upcomingEarnings.map((e) => (
                  <li key={`${e.symbol}-${e.date}`} className="flex items-center justify-between text-xs">
                    <SymbolLink symbol={e.symbol} />
                    <span className="font-mono tabular-nums text-muted">{e.date}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </ModuleShell>
  );
}
