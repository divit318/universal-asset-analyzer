"use client";

import { useEffect, useState } from "react";
import type { MarketRegime, MacroSignal } from "@/lib/types";
import { Skeleton } from "@/app/_components/ui";

/** Sits above MarketRegimeBanner + SectorRotationPanel — the AI narrates what those two already computed. */
export function MarketSummaryCard({
  regime,
  macroSignals,
  scannedAt,
}: {
  regime: MarketRegime;
  macroSignals: MacroSignal[];
  scannedAt: string;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/market-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regime, macroSignals }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSummary(data.summary ?? null);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-summarize only when a new scan result arrives, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedAt]);

  if (loading) {
    return <Skeleton height="h-20" radius="rounded-xl" className="border border-border" />;
  }
  // A failed fetch must not silently unmount the card — the section header
  // above it would remain, pointing at nothing. The regime's deterministic
  // summary is always available as the honest floor.
  if (!summary) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-4">
        <p className="text-sm leading-6 text-muted">{regime.summary}</p>
        <p className="mt-2 text-caption text-muted/60">
          AI interpretation unavailable — showing the measured regime readout instead.
        </p>
      </div>
    );
  }

  // Section title ("AI Market Summary") is provided by the WireSection wrapper
  // in page.tsx — this card only owns the interpreted-content styling.
  return (
    <div className="animate-fade-rise rounded-xl border border-accent/20 bg-accent/5 px-5 py-4">
      <p className="text-sm leading-6 text-foreground/85">{summary}</p>
      <p className="mt-2 border-t border-accent/10 pt-2 text-caption text-muted/70">
        AI interpretation of the measured panels on this page — where they disagree, the panels win.
      </p>
    </div>
  );
}
