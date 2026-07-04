"use client";

/**
 * PortfolioFitPanel — full IOS fit analysis for a single asset.
 *
 * Shows the fit score ring, dimensional breakdown, reasons, trade-offs,
 * and suggested allocation. Used on Research, Compare, and any page that
 * wants to show detailed personalized context for an asset.
 */

import { useState } from "react";
import Link from "next/link";
import type { PortfolioFitAnalysis, FitTier, FitDimension } from "@/lib/ios/types";

/* -------------------------------------------------------------------------- */
/* Color palette by tier                                                       */
/* -------------------------------------------------------------------------- */

const TIER_COLORS: Record<FitTier, { ring: string; badge: string; label: string; bar: string }> = {
  excellent: {
    ring:  "text-positive",
    badge: "border-positive/40 bg-positive/10 text-positive",
    label: "Excellent Portfolio Fit",
    bar:   "bg-positive",
  },
  good: {
    ring:  "text-emerald-400",
    badge: "border-emerald-400/30 bg-emerald-400/8 text-emerald-400",
    label: "Good Portfolio Fit",
    bar:   "bg-emerald-400",
  },
  neutral: {
    ring:  "text-muted",
    badge: "border-border bg-surface-2 text-muted",
    label: "Neutral Portfolio Fit",
    bar:   "bg-muted",
  },
  poor: {
    ring:  "text-warning",
    badge: "border-warning/30 bg-warning/8 text-warning",
    label: "Poor Portfolio Fit",
    bar:   "bg-warning",
  },
  avoid: {
    ring:  "text-negative",
    badge: "border-negative/30 bg-negative/8 text-negative",
    label: "Avoid — Poor Fit",
    bar:   "bg-negative",
  },
};

const IMPACT_ICON: Record<FitDimension["impact"], string> = {
  positive: "↑",
  neutral:  "→",
  negative: "↓",
};

const IMPACT_TEXT: Record<FitDimension["impact"], string> = {
  positive: "text-positive",
  neutral:  "text-muted",
  negative: "text-negative",
};

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function DimensionRow({ dim }: { dim: FitDimension }) {
  const barWidth = `${dim.score}%`;
  const barColor =
    dim.score >= 65 ? "bg-positive" : dim.score >= 45 ? "bg-warning" : "bg-negative";

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] text-muted">{dim.label}</span>
        <span className={`text-[10px] font-mono font-semibold ${IMPACT_TEXT[dim.impact]}`}>
          {IMPACT_ICON[dim.impact]} {dim.score}
        </span>
      </div>
      <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: barWidth }}
        />
      </div>
    </div>
  );
}

function FitScoreRing({ score, tier }: { score: number; tier: FitTier }) {
  const colors = TIER_COLORS[tier];
  const circumference = 2 * Math.PI * 22;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="56" height="56" className="-rotate-90">
        <circle cx="28" cy="28" r="22" fill="none" stroke="currentColor" strokeWidth="3" className="text-surface-2" />
        <circle
          cx="28"
          cy="28"
          r="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${colors.ring} transition-all duration-700`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-sm font-bold font-mono leading-none ${colors.ring}`}>{score}</span>
        <span className="text-[8px] text-muted leading-tight">/100</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state (no portfolio)                                                  */
/* -------------------------------------------------------------------------- */

function NoPortfolio() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-center">
      <p className="text-xs text-muted mb-2">
        Add holdings to your portfolio to see personalized fit analysis for every asset.
      </p>
      <Link
        href="/portfolio"
        className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent hover:bg-accent/15 transition-colors"
      >
        Set up portfolio →
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main panel                                                                  */
/* -------------------------------------------------------------------------- */

interface Props {
  fit: PortfolioFitAnalysis;
  /** If true, dimensions are collapsed initially and toggled on click. */
  collapsible?: boolean;
  /** If provided, shown as the personalized headline instead of the tier label. */
  headline?: string;
  className?: string;
}

export function PortfolioFitPanel({ fit, collapsible = false, headline, className = "" }: Props) {
  const [expanded, setExpanded] = useState(!collapsible);

  if (fit.isGeneric) return <NoPortfolio />;

  const colors = TIER_COLORS[fit.fitTier];
  const dims = Object.values(fit.dimensions);

  return (
    <div className={`rounded-xl border border-border bg-surface overflow-hidden ${className}`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between gap-3 p-4 ${collapsible ? "cursor-pointer hover:bg-surface-2/40" : ""}`}
        onClick={collapsible ? () => setExpanded((e) => !e) : undefined}
      >
        <div className="flex items-center gap-3 min-w-0">
          <FitScoreRing score={fit.fitScore} tier={fit.fitTier} />
          <div className="min-w-0">
            <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold mb-1 ${colors.badge}`}>
              {colors.label}
            </span>
            <p className="text-xs text-muted truncate">
              {headline ?? (fit.reasons[0] ?? "Evaluate portfolio impact before investing")}
            </p>
          </div>
        </div>
        {collapsible && (
          <span className="text-muted text-sm shrink-0">{expanded ? "▲" : "▼"}</span>
        )}
      </div>

      {expanded && (
        <>
          {/* Dimension breakdown */}
          <div className="px-4 pb-3 space-y-2.5 border-t border-border pt-3">
            <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">Fit Breakdown</p>
            {dims.map((d) => (
              <DimensionRow key={d.label} dim={d} />
            ))}
          </div>

          {/* Reasons + Trade-offs */}
          {(fit.reasons.length > 0 || fit.tradeoffs.length > 0) && (
            <div className="px-4 pb-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
              {fit.reasons.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Why it fits</p>
                  <ul className="space-y-1">
                    {fit.reasons.map((r) => (
                      <li key={r} className="flex gap-1.5 text-[11px] text-foreground">
                        <span className="text-positive shrink-0 mt-0.5">✓</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {fit.tradeoffs.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Trade-offs</p>
                  <ul className="space-y-1">
                    {fit.tradeoffs.map((t) => (
                      <li key={t} className="flex gap-1.5 text-[11px] text-muted">
                        <span className="text-warning shrink-0 mt-0.5">△</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Suggested allocation */}
          {fit.suggestedAllocationPct > 0 && (
            <div className="px-4 pb-4 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-0.5">Suggested Allocation</p>
                  <p className="text-base font-bold font-mono">
                    {fit.suggestedAllocationPct.toFixed(1)}%
                    {fit.suggestedAmount > 0 && (
                      <span className="text-xs font-normal text-muted ml-2">
                        ≈ ${fit.suggestedAmount.toLocaleString()}
                      </span>
                    )}
                  </p>
                </div>
                {fit.concentrationWarning && (
                  <span className="text-[10px] text-warning border border-warning/30 bg-warning/8 rounded px-2 py-0.5">
                    Concentration risk
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
