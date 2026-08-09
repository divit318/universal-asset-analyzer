/**
 * Deterministic (non-AI) ownership interpretation — institutional conviction,
 * insider alignment, retail positioning, short interest — read from Yahoo's
 * ownership snapshot. Shared by the Ownership tab's UI
 * (app/research/_components/ownership-card.tsx) and the AI Copilot's context
 * blocks (lib/ai/retrieval.ts) so both surfaces give the same read instead of
 * the AI re-deriving its own interpretation from raw numbers.
 *
 * Yahoo has no historical shareholding series (screener.in does, which is why
 * India's OwnershipTimeline gets a trend and this doesn't) — this reads
 * conviction from the current snapshot, not a trend.
 */

import type { OwnershipData } from "./types";

const pct = (v: number, decimals = 1) => `${(v * 100).toFixed(decimals)}%`;

export function describeOwnership(ownership: OwnershipData): string[] {
  const { institutionsPctHeld, insidersPctHeld, shortPctOfFloat } = ownership;
  const insights: string[] = [];

  if (institutionsPctHeld != null) {
    if (institutionsPctHeld > 1) {
      // Yahoo can report >100% (double-counted 13F filings). Never narrate an
      // impossible figure as "conviction" — state the artifact explicitly.
      insights.push(`Reported institutional ownership is ${pct(institutionsPctHeld)}, above 100% of shares outstanding — a double-counting artifact in 13F filings data. Read it as near-complete institutional ownership.`);
    } else if (institutionsPctHeld > 0.70) {
      insights.push(`High institutional conviction (${pct(institutionsPctHeld)} held) — closely scrutinized by professional investors.`);
    } else if (institutionsPctHeld > 0.40) {
      insights.push(`Solid institutional backing (${pct(institutionsPctHeld)} held).`);
    } else {
      const retailImplied = Math.max(0, 1 - institutionsPctHeld - (insidersPctHeld ?? 0));
      insights.push(`Limited institutional ownership (${pct(institutionsPctHeld)}) — ~${pct(retailImplied, 0)} implied retail/other float, which can mean higher sentiment-driven volatility.`);
    }
  }

  if (insidersPctHeld != null) {
    if (insidersPctHeld > 0.05) {
      insights.push(`Meaningful insider ownership (${pct(insidersPctHeld)}) — management incentives are aligned with shareholders.`);
    } else if (insidersPctHeld > 0.01) {
      insights.push(`Modest insider stake (${pct(insidersPctHeld)}).`);
    }
    // Below 1% is typical for large-caps and not flagged — avoids a
    // misleading "low conviction" read on a mega-cap with a huge float.
  }

  if (shortPctOfFloat != null) {
    const shortPct = shortPctOfFloat * 100;
    if (shortPct > 10) {
      insights.push(`High short interest (${pct(shortPctOfFloat)} of float) — elevated bearish positioning or squeeze risk.`);
    } else if (shortPct > 5) {
      insights.push(`Moderate short interest (${pct(shortPctOfFloat)} of float) — worth monitoring.`);
    } else {
      insights.push(`Low short interest (${pct(shortPctOfFloat)} of float) — shorts are not a major factor.`);
    }
  }

  return insights;
}
