"use client";

import { useState } from "react";
import { LoadingLine } from "@/app/_components/loading-panel";
import type { FundamentalsData, PeerComparison } from "@/lib/types";

/**
 * Page-level data-coverage indicator.
 *
 * Reads the SAME store entries the page renders from (fundamentals, peers,
 * filings, news), so it can never contradict the tabs below it.
 *
 * Metadata earns visual weight only when it affects the decision: with full
 * coverage this is one quiet caption line the eye can skip; with datasets
 * genuinely missing it turns amber and names them. The full dataset list is
 * one click away either way. (It used to be a full-width card with a green
 * progress bar — a whole row announcing that nothing was wrong.)
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

export function ResearchConfidenceMeter({
  fundamentals,
  fundamentalsLoading,
  peers,
  peersLoading,
  filingsCount,
  newsCount,
}: Props) {
  const [open, setOpen] = useState(false);

  if (fundamentalsLoading && !fundamentals) {
    return (
      <div className="flex justify-end px-1">
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
  const degraded = missing.length > 0;

  return (
    <div className="flex flex-col items-end gap-1 px-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Coverage of the research inputs on this page — metadata, not a signal. The AI verdict's data confidence reflects any gap."
        className={`inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5 text-caption tabular-nums transition-colors hover:bg-surface-2 ${
          degraded ? "text-warning" : "text-muted"
        }`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${degraded ? "bg-warning" : "bg-positive/70"}`} />
        <span>
          Data coverage {available.length}/{datasets.length}
          {degraded ? ` — missing ${missing.map((d) => d.label).join(", ")}` : ""}
        </span>
        <span aria-hidden className={`text-[9px] transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-caption text-muted">
          {datasets.map((d) => (
            <span key={d.label} className="inline-flex items-center gap-1">
              <span aria-hidden className={d.ok ? "text-positive" : d.pending ? "text-muted" : "text-warning"}>
                {d.ok ? "✓" : d.pending ? "…" : "–"}
              </span>
              {d.label}
            </span>
          ))}
          <span className="tabular-nums">{filingsCount} filings · {newsCount} news</span>
        </div>
      )}
    </div>
  );
}
