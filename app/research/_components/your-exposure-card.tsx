"use client";

/**
 * "You already own some of this" — the Research page's exposure card.
 *
 * Replaces GraphPreviewCard, which listed a symbol's knowledge-graph
 * neighbours ("Technology", "Watchlist", "10-Q filed"). Its own header comment
 * conceded that the graph part did not survive the trip into a small card, and
 * the list that remained restated facts already on the page.
 *
 * This answers a question the Research page genuinely cannot: while you are
 * deciding whether to buy NVDA, how much of it do you already own — counting
 * the funds you never associated with it? Everything is read off the exposure
 * model the portfolio already computed (lib/exposure), so the card costs one
 * cached request and states its own floors-not-totals caveat.
 *
 * Renders nothing when the book has no exposure to the symbol. A card that says
 * "0.00%" on every unheld name is noise.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { LoadingPanel } from "@/app/_components/loading-panel";
import type { ExposureModel } from "@/lib/exposure/types";

interface Route {
  via: string;
  pct: number;
  innerPct: number;
}

interface Exposure {
  effectivePct: number;
  directPct: number;
  indirectPct: number;
  routes: Route[];
}

export function YourExposureCard({ symbol }: { symbol: string }) {
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */

    void fetch("/api/exposure", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((model: ExposureModel | null) => {
        if (cancelled || !model) return;
        const target = symbol.toUpperCase();
        const issuer = model.issuers.find((i) => i.symbol === target);
        if (!issuer) return;
        const routes = model.edges
          .filter((e) => e.to === issuer.id && (e.kind === "IS" || e.kind === "CONTAINS"))
          .map((e) => ({
            via: e.kind === "IS" ? "direct" : e.from.slice("position:".length),
            pct: e.bookPct ?? 0,
            innerPct: e.innerPct ?? 0,
          }))
          .sort((a, b) => b.pct - a.pct);
        setExposure({
          effectivePct: issuer.effectivePct,
          directPct: issuer.directPct,
          indirectPct: issuer.indirectPct,
          routes,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol]);

  if (loading) return <LoadingPanel height="h-28" markSize={18} />;
  if (!exposure) return null;

  const hidden = exposure.effectivePct - exposure.directPct;

  return (
    <div className="card-lift flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">You already own this</h3>
        <Link href="/exposure" className="text-xs text-accent hover:underline">
          Trace it →
        </Link>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
          {exposure.effectivePct.toFixed(2)}%
        </span>
        <span className="text-xs text-muted">
          of your portfolio, effective
          {hidden > 0.05 ? (
            <>
              {" "}
              — <span className="text-foreground">{hidden.toFixed(2)}pp</span> of it inside funds
            </>
          ) : null}
        </span>
      </div>

      <ul className="space-y-1">
        {exposure.routes.map((r) => (
          <li key={r.via} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="font-mono text-muted">
              {r.via === "direct" ? "Held directly" : r.via}
            </span>
            <span className="flex items-baseline gap-2">
              {r.via !== "direct" ? (
                <span className="text-[10px] text-faint">{r.innerPct.toFixed(1)}% of it</span>
              ) : null}
              <span className="font-mono tabular-nums text-foreground">{r.pct.toFixed(2)}%</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[10px] leading-relaxed text-faint">
        Fund look-through sees each fund&rsquo;s ten largest disclosed holdings, so this is a floor —
        the true figure can only be higher.
      </p>
    </div>
  );
}
