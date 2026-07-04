"use client";

import { useState } from "react";
import Link from "next/link";
import type { OpportunityMapNode } from "@/lib/opportunity-map";
import type { FitTier } from "@/lib/ios/types";
import { formatCurrency, formatMarketCap, formatPercent } from "@/lib/format";
import { MovementExplainerCard } from "@/app/_components/movement-explainer-card";
import { PortfolioFitBadge } from "@/app/_components/portfolio-fit-badge";
import { useIntelligence } from "@/lib/intelligence/context";

function BulletList({ items, variant }: { items: string[]; variant: "bull" | "bear" }) {
  if (items.length === 0) return <p className="text-xs text-muted/60">None identified.</p>;
  const color = variant === "bull" ? "text-positive" : "text-negative";
  const dot = variant === "bull" ? "▲" : "▼";
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-xs leading-5">
          <span className={`mt-0.5 shrink-0 text-[10px] ${color}`}>{dot}</span>
          <span className="text-muted">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Lazily fetches Portfolio Fit for this node's symbol — never precomputed for every node upfront. */
function LazyPortfolioFit({ node }: { node: OpportunityMapNode }) {
  const [fit, setFit] = useState<{ fitScore: number; fitTier: FitTier } | null>(null);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);

  async function load() {
    setOpened(true);
    if (fit) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ symbol: node.symbol });
      if (node.marketCap != null) params.set("marketCap", String(node.marketCap));
      const res = await fetch(`/api/ios/fit?${params.toString()}`);
      const json = await res.json();
      setFit({ fitScore: json.fitScore, fitTier: json.fitTier });
    } catch {
      setFit(null);
    } finally {
      setLoading(false);
    }
  }

  if (!opened) {
    return (
      <button
        type="button"
        onClick={load}
        className="self-start rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground"
      >
        Check portfolio fit
      </button>
    );
  }
  if (loading) return <span className="text-xs text-muted">Scoring…</span>;
  if (!fit) return <span className="text-xs text-muted">Fit unavailable.</span>;
  return <PortfolioFitBadge score={fit.fitScore} tier={fit.fitTier} size="md" />;
}

export function OpportunityDetailPanel({ node }: { node: OpportunityMapNode }) {
  const { navigate } = useIntelligence();
  const [showMovement, setShowMovement] = useState(false);
  // Reset the lazy Movement Explainer when the selected node changes.
  const [trackedId, setTrackedId] = useState(node.id);
  if (node.id !== trackedId) {
    setTrackedId(node.id);
    setShowMovement(false);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-accent">{node.symbol}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">{node.categoryLabel}</span>
          </div>
          <p className="text-xs text-muted">{node.name}</p>
        </div>
        <div className="text-right">
          {node.price != null && <div className="font-mono text-sm font-medium">{formatCurrency(node.price)}</div>}
          {node.changePercent != null && (
            <div className={`font-mono text-xs ${node.changePercent >= 0 ? "text-positive" : "text-negative"}`}>
              {formatPercent(node.changePercent)}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-surface-2 p-2">
          <div className="text-sm font-semibold text-foreground">{node.opportunityScore}</div>
          <div className="text-[9px] uppercase tracking-wide text-muted/60">Score</div>
        </div>
        <div className="rounded-lg bg-surface-2 p-2">
          <div className="text-sm font-semibold text-foreground">{node.conviction}</div>
          <div className="text-[9px] uppercase tracking-wide text-muted/60">Conviction</div>
        </div>
        <div className="rounded-lg bg-surface-2 p-2">
          <div className="text-sm font-semibold text-foreground">{node.expectedVolatility}</div>
          <div className="text-[9px] uppercase tracking-wide text-muted/60">Risk</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
        <span className="rounded-md bg-surface-2 px-2 py-0.5">{node.theme}</span>
        <span className="rounded-md border border-border px-2 py-0.5">{node.timeHorizon}</span>
        {node.marketCap != null && <span className="rounded-md border border-border px-2 py-0.5">{formatMarketCap(node.marketCap)}</span>}
        {node.dividendYieldPct != null && <span className="rounded-md border border-border px-2 py-0.5">{node.dividendYieldPct.toFixed(1)}% yield</span>}
        {node.inPortfolio && <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent">In Portfolio</span>}
        {node.inWatchlist && <span className="rounded-md border border-border px-2 py-0.5">On Watchlist</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-positive">Bull Case</h4>
          <BulletList items={node.bullCase} variant="bull" />
        </div>
        <div>
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-negative">Bear Case</h4>
          <BulletList items={node.bearCase} variant="bear" />
        </div>
      </div>

      {(node.keyCatalyst || node.primaryRisk) && (
        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          {node.keyCatalyst && (
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted/60">Key Catalyst</h4>
              <p className="text-xs text-muted">{node.keyCatalyst}</p>
            </div>
          )}
          {node.primaryRisk && (
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted/60">Primary Risk</h4>
              <p className="text-xs text-muted">{node.primaryRisk}</p>
            </div>
          )}
        </div>
      )}

      <LazyPortfolioFit node={node} />

      {showMovement ? (
        <MovementExplainerCard symbol={node.symbol} />
      ) : (
        <button
          type="button"
          onClick={() => setShowMovement(true)}
          className="self-start rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground"
        >
          Why did {node.symbol} move?
        </button>
      )}

      <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => navigate("timeline", { scope: "symbol", id: node.symbol })}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-accent/40 hover:text-accent transition-colors"
        >
          Timeline
        </button>
        <button
          type="button"
          onClick={() => navigate("graph", { scope: "symbol", id: node.symbol })}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-accent/40 hover:text-accent transition-colors"
        >
          Graph
        </button>
        <Link href={`/compare?symbols=${encodeURIComponent(node.symbol)}`} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-accent/40 hover:text-accent transition-colors">
          Compare
        </Link>
        <Link href={`/research?symbol=${encodeURIComponent(node.symbol)}`} className="ml-auto rounded-md bg-accent-strong px-2.5 py-1 text-xs font-medium text-background hover:opacity-90 transition-opacity">
          Deep Research →
        </Link>
      </div>
    </div>
  );
}
