"use client";

import type { PeerComparison } from "@/lib/types";

/**
 * US competitive-positioning narrative, above PeerRadarChart. Same pattern
 * as India's CompetitivePositionSummary (ranked-peers.tsx) — gap-vs-median
 * narrative explaining WHY the company sits where it does — but built
 * against PeerComparison's target/median shape (lib/peers.ts) rather than
 * a full per-peer list: Yahoo-derived PeerComparison only carries the
 * sector median, not individual peer rows, so there's no discrete rank
 * (#2/8) to compute here, only a gap-to-median read. That's an honest
 * reflection of the data available, not a missing feature.
 */
export function PeerCompetitivePosition({ peers, symbol }: { peers: PeerComparison; symbol: string }) {
  const { target, median } = peers;
  const points: string[] = [];

  if (target.roe != null && median.roe != null && median.roe !== 0) {
    const gapPp = (target.roe - median.roe) * 100;
    if (Math.abs(gapPp) >= 3) {
      points.push(
        gapPp > 0
          ? `${symbol} delivers ROE ${gapPp.toFixed(1)}pp above the ${peers.sector} median — a capital-efficiency advantage.`
          : `ROE lags the ${peers.sector} median by ${Math.abs(gapPp).toFixed(1)}pp — worth watching capital allocation.`,
      );
    }
  }

  if (target.pe != null && median.pe != null && median.pe > 0) {
    const ratio = target.pe / median.pe;
    if (ratio >= 1.15) {
      points.push(`Trading at a premium to peers (P/E ${target.pe.toFixed(1)}x vs. median ${median.pe.toFixed(1)}x) — the market is pricing in above-peer growth or quality expectations.`);
    } else if (ratio <= 0.85) {
      points.push(`Trading at a discount to peers (P/E ${target.pe.toFixed(1)}x vs. median ${median.pe.toFixed(1)}x) — relatively inexpensive versus the sector.`);
    }
  }

  if (target.revenueGrowth != null && median.revenueGrowth != null) {
    const gapPp = (target.revenueGrowth - median.revenueGrowth) * 100;
    if (Math.abs(gapPp) >= 3) {
      points.push(
        gapPp > 0
          ? `Growing ${gapPp.toFixed(1)}pp faster than the peer median — outpacing the sector.`
          : `Growing ${Math.abs(gapPp).toFixed(1)}pp slower than the peer median — losing relative share of sector growth.`,
      );
    }
  }

  if (target.debtToEquity != null && median.debtToEquity != null && median.debtToEquity > 0) {
    const ratio = target.debtToEquity / median.debtToEquity;
    if (ratio >= 1.3) {
      points.push(`Carries more leverage than peers (D/E ${target.debtToEquity.toFixed(2)} vs. median ${median.debtToEquity.toFixed(2)}).`);
    } else if (ratio <= 0.7) {
      points.push(`Carries less leverage than peers (D/E ${target.debtToEquity.toFixed(2)} vs. median ${median.debtToEquity.toFixed(2)}) — more balance-sheet flexibility.`);
    }
  }

  if (points.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Competitive Position</span>
      {points.map((p, i) => (
        <p key={i} className="text-xs leading-5 text-muted">{p}</p>
      ))}
    </div>
  );
}
