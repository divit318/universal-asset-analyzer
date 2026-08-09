"use client";

import { CountUp } from "@/app/_components/count-up";
import { LoadingLine } from "@/app/_components/loading-panel";
import { ValueBar } from "@/app/_components/value-bar";
import type { FundamentalsData, PeerComparison } from "@/lib/types";

/**
 * Page-level data-coverage meter.
 *
 * Reads the SAME store entries the page renders from (fundamentals, peers,
 * filings, news), so it can never contradict the tabs below it. The previous
 * version asked /api/research/context — a separate fetch with its own failure
 * modes — and routinely reported "Missing: Financial statements" eight lines
 * above a fully populated Financials tab.
 *
 * A dataset still in flight is counted as PENDING, not missing: "missing" is
 * only claimed once its fetch has actually settled without data.
 */

interface Props {
  fundamentals: FundamentalsData | null;
  fundamentalsLoading: boolean;
  peers: PeerComparison | null;
  peersLoading: boolean;
  filingsCount: number;
  newsCount: number;
}

function barColor(pct: number) {
  if (pct >= 80) return "bg-positive";
  if (pct >= 50) return "bg-warning";
  return "bg-negative";
}

export function ResearchConfidenceMeter({
  fundamentals,
  fundamentalsLoading,
  peers,
  peersLoading,
  filingsCount,
  newsCount,
}: Props) {
  if (fundamentalsLoading && !fundamentals) {
    return (
      <div className="flex h-10 items-center rounded-lg border border-border bg-surface-2 px-4">
        <LoadingLine message="Checking data coverage…" className="text-caption" />
      </div>
    );
  }
  if (!fundamentals) return null;

  const analystCovered =
    !!fundamentals.analyst &&
    (fundamentals.analyst.numberOfOpinions ?? 0) > 0;

  const datasets: { label: string; ok: boolean; pending: boolean }[] = [
    { label: "Fundamentals", ok: fundamentals.snapshot != null, pending: false },
    { label: "Financial statements", ok: fundamentals.statements != null, pending: false },
    { label: "Analyst coverage", ok: analystCovered, pending: false },
    { label: "Peer comparison", ok: (peers?.peerCount ?? 0) > 0, pending: peersLoading },
    { label: "Company profile", ok: fundamentals.snapshot?.sector != null, pending: false },
  ];

  const available = datasets.filter((d) => d.ok);
  const missing = datasets.filter((d) => !d.ok && !d.pending);
  const pct = Math.round((available.length / datasets.length) * 100);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Research Confidence</span>
        <span className="font-mono text-xs tabular-nums text-muted">
          {available.length}/{datasets.length} datasets ·{" "}
          <CountUp value={filingsCount} format={(v) => String(Math.round(v))} /> filings ·{" "}
          <CountUp value={newsCount} format={(v) => String(Math.round(v))} /> news
        </span>
      </div>
      <ValueBar value={pct} barClassName={barColor(pct)} trackClassName="bg-surface" />
      {missing.length > 0 && (
        <p className="text-[10px] text-muted/70">
          Missing: {missing.map((d) => d.label).join(", ")} — AI confidence reflects this gap.
        </p>
      )}
    </div>
  );
}
