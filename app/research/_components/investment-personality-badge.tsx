"use client";

import { useState } from "react";
import type { InvestmentPersonality, InvestmentPersonalityTag } from "@/lib/types";

const TAG_STYLE: Record<InvestmentPersonalityTag, string> = {
  Compounder:    "text-emerald-400 border-emerald-400/30 bg-emerald-400/8",
  Cyclical:      "text-amber-400 border-amber-400/30 bg-amber-400/8",
  Turnaround:    "text-blue-400 border-blue-400/30 bg-blue-400/8",
  "High Growth": "text-green-400 border-green-400/30 bg-green-400/8",
  Income:        "text-purple-400 border-purple-400/30 bg-purple-400/8",
  "Deep Value":  "text-cyan-400 border-cyan-400/30 bg-cyan-400/8",
  Defensive:     "text-slate-400 border-slate-400/30 bg-slate-400/8",
  "High Quality": "text-accent border-accent/30 bg-accent/8",
};

interface Props {
  personality: InvestmentPersonality | null;
  loading?: boolean;
}

/** Permanent investment identity badge — deterministic, not a transient AI take. See lib/scoring.ts's classifyInvestmentPersonality(). */
export function InvestmentPersonalityBadge({ personality, loading }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return <div className="h-7 w-32 animate-pulse rounded-lg bg-surface-2" />;
  }
  if (!personality) return null;

  const cls = TAG_STYLE[personality.tag];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold tracking-wide ${cls}`}
      >
        {personality.tag}
        <span className="text-[10px] opacity-60">ⓘ</span>
      </button>
      {expanded && (
        <div className="absolute left-0 top-full z-10 mt-1.5 w-72 rounded-lg border border-border bg-surface p-3 text-[11px] leading-5 text-muted shadow-lg">
          {personality.explanation}
        </div>
      )}
    </div>
  );
}
