"use client";

import { useEffect, useState } from "react";
import type { FundamentalsData, PeerComparison } from "@/lib/types";
import { ScoreCard } from "./score-card";
import { RiskHeatmap } from "./risk-heatmap";
import { AnalystCard } from "./analyst-card";
import { InsiderTable } from "./insider-table";
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
    return () => {
      active = false;
    };
  }, [symbol]);

  // Peer comparison (slower — fans out across the sector). Loads independently.
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(`/api/peers?symbol=${encodeURIComponent(symbol)}`);
        if (active && res.ok) setPeers((await res.json()) as PeerComparison);
      } catch {
        /* peers are optional */
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeers(null);
    void load();
    return () => {
      active = false;
    };
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

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">Institutional analysis</h2>

      <ScoreCard score={data.score} momentum={data.momentum} />

      <div className="grid gap-4 lg:grid-cols-2">
        {statements ? <MarginTrendChart statements={statements} /> : null}
        {statements ? <RevenueFcfChart statements={statements} /> : null}
        {peers && peers.peerCount > 0 ? (
          <PeerRadarChart peers={peers} symbol={symbol} />
        ) : (
          <div className="flex h-[296px] items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">
            {peers ? "Peer data unavailable (non-S&P 500)" : "Loading peer comparison…"}
          </div>
        )}
      </div>

      <RiskHeatmap risks={data.risks} />
      <AnalystCard analyst={data.analyst} />
      <InsiderTable insider={data.insider} />

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
