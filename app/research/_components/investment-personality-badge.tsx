"use client";

import { useState } from "react";
import type { InvestmentPersonality, InvestmentPersonalityTag } from "@/lib/types";
import { LoadingMark } from "@/app/_components/loading-mark";

const TAG_STYLE: Record<InvestmentPersonalityTag, string> = {
  Compounder:    "text-emerald-400 border-emerald-400/30 bg-emerald-400/8",
  Cyclical:      "text-warning border-warning/30 bg-warning/8",
  Turnaround:    "text-blue-400 border-blue-400/30 bg-blue-400/8",
  "High Growth": "text-positive border-positive/30 bg-positive/8",
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
    return (
      <div className="inline-flex h-7 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3">
        <LoadingMark size={13} label="Classifying investment personality" />
        <span className="text-micro uppercase tracking-widest text-muted">Classifying</span>
      </div>
    );
  }
  if (!personality) return null;

  const cls = TAG_STYLE[personality.tag];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold tracking-wide transition-transform active:scale-[0.97] ${cls}`}
      >
        {personality.tag}
        <span className="text-[10px] opacity-60">ⓘ</span>
      </button>
      {expanded && (
        <div className="animate-fade-rise absolute left-0 top-full z-10 mt-1.5 w-72 rounded-lg border border-border bg-surface p-3 text-[11px] leading-5 text-muted shadow-lg">
          {personality.explanation}
        </div>
      )}
    </div>
  );
}
