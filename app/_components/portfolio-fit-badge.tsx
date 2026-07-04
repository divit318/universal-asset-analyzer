"use client";

/**
 * PortfolioFitBadge — compact inline chip showing fit score + tier.
 * Used everywhere a symbol appears: scanner results, screener table,
 * watchlist rows, compare table.
 */

import type { FitTier } from "@/lib/ios/types";

const TIER_STYLES: Record<FitTier, string> = {
  excellent: "border-green-400/40 bg-green-400/10 text-green-400",
  good:      "border-emerald-500/30 bg-emerald-500/8 text-emerald-400",
  neutral:   "border-border bg-surface-2 text-muted",
  poor:      "border-amber-400/30 bg-amber-400/8 text-amber-400",
  avoid:     "border-red-400/30 bg-red-400/8 text-red-400",
};

const TIER_LABELS: Record<FitTier, string> = {
  excellent: "Excellent Fit",
  good:      "Good Fit",
  neutral:   "Neutral Fit",
  poor:      "Poor Fit",
  avoid:     "Avoid",
};

interface Props {
  score: number;
  tier: FitTier;
  /** Show the numeric score alongside the tier label (default: true). */
  showScore?: boolean;
  /** "sm" = tighter padding (default), "md" = more spacious. */
  size?: "sm" | "md";
}

export function PortfolioFitBadge({ score, tier, showScore = true, size = "sm" }: Props) {
  const style = TIER_STYLES[tier];
  const padding = size === "md" ? "px-2.5 py-1" : "px-2 py-0.5";
  const textSize = size === "md" ? "text-xs" : "text-[10px]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border font-medium ${style} ${padding} ${textSize}`}
      title={`Portfolio Fit: ${score}/100 — ${TIER_LABELS[tier]}`}
    >
      <span className="opacity-70">Fit</span>
      {showScore && (
        <span className="font-mono font-semibold">{score}</span>
      )}
      <span>{TIER_LABELS[tier]}</span>
    </span>
  );
}

/** Tiny dot-only variant for use inside dense tables. */
export function FitDot({ tier }: { tier: FitTier }) {
  const colors: Record<FitTier, string> = {
    excellent: "bg-green-400",
    good:      "bg-emerald-500",
    neutral:   "bg-muted",
    poor:      "bg-amber-400",
    avoid:     "bg-red-400",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[tier]}`}
      title={TIER_LABELS[tier]}
    />
  );
}
