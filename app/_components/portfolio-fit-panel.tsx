"use client";

/**
 * PortfolioFitPanel — full IOS fit analysis for a single asset.
 *
 * Shows the fit score ring, dimensional breakdown, reasons, trade-offs,
 * and suggested allocation. Used on Research, Compare, and any page that
 * wants to show detailed personalized context for an asset.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { PortfolioFitAnalysis, FitTier, FitDimension } from "@/lib/ios/types";
import { ScoreRing } from "./score-ring";
import { ValueBar } from "./value-bar";
import { CountUp } from "./count-up";

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
      <ValueBar value={dim.score} barClassName={barColor} />
    </div>
  );
}

function FitScoreRing({ score, tier }: { score: number; tier: FitTier }) {
  const colors = TIER_COLORS[tier];
  return (
    <ScoreRing
      score={score}
      size={56}
      arcClassName={colors.ring}
      valueClassName={`text-sm font-bold font-mono ${colors.ring}`}
      caption="/100"
      label={`Portfolio fit ${score} out of 100`}
    />
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
  /** One frame behind `expanded` on the first open, so the 0fr→1fr grid
   *  transition has a starting frame to animate from (same mechanism as
   *  CollapsibleSection). */
  const [open, setOpen] = useState(!collapsible);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- deferring the class by a frame is the mechanism */
    if (!expanded) {
      setOpen(false);
      return;
    }
    const handle = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(handle);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [expanded]);

  if (fit.isGeneric) return <NoPortfolio />;

  const colors = TIER_COLORS[fit.fitTier];
  const dims = Object.values(fit.dimensions);

  return (
    <div className={`rounded-xl border border-border bg-surface overflow-hidden ${className}`}>
      {/* Header */}
      <div
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? expanded : undefined}
        className={`flex items-center justify-between gap-3 p-4 ${collapsible ? "cursor-pointer hover:bg-surface-2/40" : ""}`}
        onClick={collapsible ? () => setExpanded((e) => !e) : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((ex) => !ex);
                }
              }
            : undefined
        }
      >
        <div className="flex items-center gap-3 min-w-0">
          <FitScoreRing score={fit.fitScore} tier={fit.fitTier} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className={`uaa-swap inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold ${colors.badge}`}
                title={`${fit.fitScore}/100 fit score`}
              >
                <span className="uaa-swap-base">{colors.label}</span>
                <span className="uaa-swap-alt font-mono">{fit.fitScore}/100 fit score</span>
              </span>
              {fit.confidence < 60 && (
                <span
                  className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[9px] font-medium text-muted"
                  title={`Only ${fit.confidence}% of the fit score is backed by available data. Add fundamentals (open Research) for a fuller assessment.`}
                >
                  {fit.confidence}% data
                </span>
              )}
            </div>
            <p className="text-xs text-muted truncate">
              {headline ?? (fit.reasons[0] ?? "Evaluate portfolio impact before investing")}
            </p>
          </div>
        </div>
        {collapsible && (
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        )}
      </div>

      <div className={`collapse-grid ${open ? "is-open" : ""}`} aria-hidden={!expanded}>
        <div className="min-h-0 overflow-hidden">
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
                    <CountUp
                      value={fit.suggestedAllocationPct}
                      format={(v) => `${v.toFixed(1)}%`}
                    />
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
        </div>
      </div>
    </div>
  );
}
