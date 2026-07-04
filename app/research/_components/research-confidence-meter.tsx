"use client";

import { useEffect, useState } from "react";
import type { CopilotCoverage } from "./copilot/use-copilot";

/**
 * Page-level, always-visible data-quality meter. Reuses the same coverage
 * computation the Copilot's empty state already shows (research-copilot.tsx
 * Hero()) via the same /api/research/context endpoint — this is a render
 * relocation, not new logic.
 */

const DATASETS: { key: keyof CopilotCoverage; label: string }[] = [
  { key: "hasFundamentals", label: "Fundamentals" },
  { key: "hasStatements",   label: "Financial statements" },
  { key: "hasAnalyst",      label: "Analyst coverage" },
  { key: "hasPeers",        label: "Peer comparison" },
  { key: "hasProfile",      label: "Company profile" },
];

function barColor(pct: number) {
  if (pct >= 80) return "bg-positive";
  if (pct >= 50) return "bg-amber-400";
  return "bg-negative";
}

export function ResearchConfidenceMeter({ symbol }: { symbol: string }) {
  const [coverage, setCoverage] = useState<CopilotCoverage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setCoverage(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    void fetch(`/api/research/context?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.coverage) setCoverage(data.coverage as CopilotCoverage);
      })
      .catch(() => { /* best-effort */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (loading) {
    return <div className="h-10 w-full animate-pulse rounded-lg bg-surface-2" />;
  }
  if (!coverage) return null;

  const available = DATASETS.filter((d) => coverage[d.key]);
  const missing = DATASETS.filter((d) => !coverage[d.key]);
  const pct = Math.round((available.length / DATASETS.length) * 100);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Research Confidence</span>
        <span className="font-mono text-xs tabular-nums text-muted">
          {available.length}/{DATASETS.length} datasets · {coverage.filings} filings · {coverage.news} news
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full ${barColor(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      {missing.length > 0 && (
        <p className="text-[10px] text-muted/70">
          Missing: {missing.map((d) => d.label).join(", ")} — AI confidence reflects this gap.
        </p>
      )}
    </div>
  );
}
