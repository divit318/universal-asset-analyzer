"use client";

import { useEffect, useState } from "react";
import type { FundamentalsData, PeerComparison } from "@/lib/types";
import { ScoreCard } from "./score-card";
import { RiskHeatmap } from "./risk-heatmap";
import { AnalystCard } from "./analyst-card";
import { InsiderTable } from "./insider-table";
import { EarningsCard } from "./earnings-card";
import { OwnershipCard } from "./ownership-card";
import { ValuationHistoryChart } from "./valuation-history-chart";
import { MarginTrendChart, PeerRadarChart, RevenueFcfChart } from "./charts";
import { AiDeepPanel } from "./ai-deep-panel";

export function FundamentalsSection({ symbol, quote }: { symbol: string; quote?: import("@/lib/types").Quote }) {
  const [data, setData] = useState<FundamentalsData | null>(null);
  const [peers, setPeers] = useState<PeerComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fundamentals + score (fast). Re-runs when the symbol changes.
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`);
        const json = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(json.error ?? "Fundamentals lookup failed");
        setData(json as FundamentalsData);
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load fundamentals");
      } finally {
        if (active) setLoading(false);
      }
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setData(null);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void load();
    return () => { active = false; };
  }, [symbol]);

  // Peer comparison (slower — fans out across the sector). Loads independently.
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(`/api/peers?symbol=${encodeURIComponent(symbol)}`);
        if (active && res.ok) setPeers((await res.json()) as PeerComparison);
      } catch { /* peers are optional */ }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeers(null);
    void load();
    return () => { active = false; };
  }, [symbol]);

  if (loading) {
    return <p className="text-sm text-muted">Loading institutional analysis…</p>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const { statements, statementsError } = data;

  // Defensive: these sections were added later, so a stale/cached or partial
  // payload may lack them. Guard every access and only render cards that have
  // meaningful content (e.g. ETFs have no earnings or ownership data).
  const earnings = data.earnings;
  const ownership = data.ownership;
  const valuation = data.valuation ?? [];

  // Detect sparse snapshot coverage (newly public companies, private placements,
  // certain ADRs) so the user understands dashes = unavailable data, not a bug.
  const KEY_METRICS: (keyof typeof data.snapshot)[] = [
    "trailingPE", "forwardPE", "returnOnEquity", "returnOnAssets",
    "grossMargins", "operatingMargins", "profitMargins",
    "revenueGrowth", "earningsGrowth", "freeCashflow",
  ];
  const nullCount = KEY_METRICS.filter((k) => data.snapshot[k] == null).length;
  const isSparseData = nullCount >= 5;

  const hasEarnings =
    !!earnings &&
    ((earnings.history?.length ?? 0) > 0 ||
      earnings.nextDate != null ||
      earnings.trailingEps != null ||
      earnings.forwardEps != null);

  const hasOwnership =
    !!ownership &&
    (ownership.institutionsPctHeld != null ||
      ownership.insidersPctHeld != null ||
      ownership.shortPctOfFloat != null ||
      (ownership.topHolders?.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">Institutional analysis</h2>

      {/* Sparse data notice — shown for recently public companies, ADRs with
          limited Yahoo Finance coverage, negative-EPS companies, etc. */}
      {isSparseData && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-400">
          <span className="shrink-0 text-base leading-5">⚠</span>
          <span>
            Limited financial data available for this symbol. Some metrics show{" "}
            <span className="font-mono">—</span> because the data has not been
            reported yet or is not covered by our sources. Displayed figures
            reflect what is currently available.
          </span>
        </div>
      )}

      {/* Composite score */}
      <ScoreCard score={data.score} momentum={data.momentum} />

      {/* Earnings — most time-sensitive section */}
      {hasEarnings ? <EarningsCard earnings={earnings} /> : null}

      {/* Financial charts grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {statements ? <MarginTrendChart statements={statements} /> : null}
        {statements ? <RevenueFcfChart statements={statements} /> : null}
        {valuation.length >= 2 ? (
          <ValuationHistoryChart valuation={valuation} snapshot={data.snapshot} />
        ) : null}
        {peers && peers.peerCount > 0 ? (
          <PeerRadarChart peers={peers} symbol={symbol} />
        ) : (
          <div className="flex h-[296px] items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">
            {peers ? "Peer data unavailable (non-S&P 500)" : "Loading peer comparison…"}
          </div>
        )}
      </div>

      {/* Analyst consensus */}
      <AnalystCard analyst={data.analyst} />

      {/* Ownership breakdown + short interest */}
      {hasOwnership ? <OwnershipCard ownership={ownership} /> : null}

      {/* Insider transactions */}
      <InsiderTable insider={data.insider} />

      {/* Risk heatmap */}
      <RiskHeatmap risks={data.risks} />

      {/* AI Deep analysis panel */}
      {quote ? (
        <AiDeepPanel quote={quote} fundamentals={data} peers={peers} />
      ) : null}

      {statementsError ? (
        <p className="text-xs text-muted">
          Note: SEC statement data unavailable ({statementsError}) — margin/FCF charts
          and some score inputs are limited.
        </p>
      ) : null}
    </div>
  );
}
