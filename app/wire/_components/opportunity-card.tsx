"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import type { ScannerOpportunity } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { InvestmentThesisPanel } from "./investment-thesis-panel";
import { useIOSSafe } from "@/lib/ios-context";
import { PortfolioFitBadge } from "@/app/_components/portfolio-fit-badge";

const CONVICTION_STYLE: Record<string, string> = {
  High: "bg-positive/15 text-positive border-positive/30",
  Medium: "bg-accent/15 text-accent border-accent/30",
  Low: "bg-muted/15 text-muted border-muted/30",
};

const VOLATILITY_STYLE: Record<string, string> = {
  Low: "text-positive",
  Medium: "text-accent",
  High: "text-negative",
};

const DIR_STYLE = {
  bullish: {
    badge: "bg-positive/15 text-positive border-positive/30",
    glow: "border-positive/20 shadow-[0_0_0_1px_rgba(74,222,128,0.05)]",
    arrow: "↑",
  },
  bearish: {
    badge: "bg-negative/15 text-negative border-negative/30",
    glow: "border-negative/20",
    arrow: "↓",
  },
  neutral: {
    badge: "bg-muted/15 text-muted border-muted/30",
    glow: "border-border",
    arrow: "→",
  },
};

const VERDICT_STYLE = {
  exceptional: "bg-positive text-background",
  strong:      "bg-positive/80 text-background",
  moderate:    "bg-accent text-background",
  weak:        "bg-muted/40 text-foreground",
};

function ScoreBar({
  label,
  value,
  color = "bg-accent",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-widest text-muted/60">
        {label}
      </span>
      <div className="flex-1 h-1 rounded-full bg-surface-3 overflow-hidden">
        <div
          className={`h-full rounded-full animate-bar-fill ${color}`}
          style={{ width: `${Math.max(4, value)}%`, "--bar-value": `${Math.max(4, value)}%` } as CSSProperties}
        />
      </div>
      <span className="w-6 text-right font-mono text-[10px] text-muted shrink-0">{value}</span>
    </div>
  );
}

export function OpportunityCard({
  opportunity,
  style,
  triggerEvent,
  inWatchlist = false,
  onAddToWatchlist,
  onDismiss,
  onShowEvidence,
  highlighted = false,
}: {
  opportunity: ScannerOpportunity;
  style?: CSSProperties;
  /** The market event that produced this idea, joined from sourceEventIds. */
  triggerEvent?: { headline: string; sourceCount: number } | null;
  inWatchlist?: boolean;
  onAddToWatchlist?: () => void;
  onDismiss?: () => void;
  onShowEvidence?: () => void;
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const dir = DIR_STYLE[opportunity.direction];
  const score = opportunity.opportunityScore;
  const profile = opportunity.profile;
  const hasThesis = opportunity.thesis != null;
  const positive = (opportunity.quote?.changePercent ?? 0) >= 0;
  const researchHref = `/stocks/${encodeURIComponent(opportunity.ticker)}`;

  const ios = useIOSSafe();
  const fit = ios?.profileReady && ios.profile.hasPortfolio
    ? ios.getPortfolioFit({
        symbol: opportunity.ticker,
        sector: null,
        marketCap: opportunity.quote?.marketCap ?? null,
        compositeScores: opportunity.compositeScores,
        dividendYield: opportunity.dividendYieldPct,
      })
    : null;

  const highPriority = score.verdict === "exceptional" || score.verdict === "strong";

  return (
    <div
      className={`card-lift animate-fade-rise flex flex-col rounded-xl border bg-surface transition-colors hover:bg-surface-2 ${dir.glow} ${highPriority ? "animate-border-shimmer" : ""} ${
        highlighted ? "ring-2 ring-accent/40" : ""
      }`}
      style={style}
    >
      {/* Header */}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={researchHref}
                className="font-mono font-semibold text-accent hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {opportunity.ticker}
              </Link>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${dir.badge}`}
              >
                {dir.arrow} {opportunity.direction}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${VERDICT_STYLE[score.verdict]}`}
              >
                {score.composite}
              </span>
            </div>
            <span className="truncate text-xs text-muted">{opportunity.name}</span>
          </div>

          {opportunity.quote && (
            <div className="shrink-0 text-right">
              <div className="font-mono text-sm font-medium">
                {formatCurrency(opportunity.quote.price, opportunity.quote.currency)}
              </div>
              <div className={`font-mono text-xs ${positive ? "animate-winner-positive" : "animate-winner-negative"}`}>
                {formatPercent(opportunity.quote.changePercent)}
              </div>
            </div>
          )}
        </div>

        {/* Theme + timeframe */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground">
            {opportunity.theme}
          </span>
          <span className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted capitalize">
            {opportunity.timeframe}-term
          </span>
          <span className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted capitalize">
            {opportunity.category}
          </span>
        </div>

        {/* Opportunity profile: conviction, confidence, horizon, volatility, portfolio fit */}
        {profile && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${CONVICTION_STYLE[profile.conviction]}`}>
              {profile.conviction} Conviction
            </span>
            <span
              className="text-[10px] text-muted"
              title="Model-estimated confidence in the thesis — corroborate via the source articles below"
            >
              {profile.confidence}% confidence
            </span>
            <span className="text-[10px] text-muted">· {profile.suggestedHoldingPeriod}</span>
            <span className={`text-[10px] font-medium ${VOLATILITY_STYLE[profile.expectedVolatility]}`}>
              · {profile.expectedVolatility} volatility
            </span>
            {fit && <PortfolioFitBadge score={fit.fitScore} tier={fit.fitTier} showScore={false} />}
          </div>
        )}

        {/* Thesis headline or rationale */}
        <p className="text-xs leading-5 text-muted line-clamp-2">
          {opportunity.thesis?.headline ?? opportunity.rationale}
        </p>

        {/* Triggering event + corroboration — the "why now" behind the idea;
            clicking it opens the evidence drawer with the source articles. */}
        {triggerEvent && (
          <button
            type="button"
            onClick={onShowEvidence}
            disabled={!onShowEvidence}
            className={`flex items-baseline gap-1.5 text-left text-[10px] leading-4 text-muted/70 ${
              onShowEvidence ? "transition-colors hover:text-accent" : ""
            }`}
            title={onShowEvidence ? "Open source articles" : triggerEvent.headline}
          >
            <span className="shrink-0 text-accent" aria-hidden>⚡</span>
            <span className="line-clamp-1">{triggerEvent.headline}</span>
            <span className="shrink-0 text-muted/50">
              · {triggerEvent.sourceCount} source{triggerEvent.sourceCount === 1 ? "" : "s"}
            </span>
          </button>
        )}

        {/* Score bars */}
        <div className="flex flex-col gap-1">
          <ScoreBar label="Catalyst"  value={score.catalystStrength}  color="bg-accent" />
          <ScoreBar label="Quality"   value={score.fundamentalQuality} color="bg-positive" />
          <ScoreBar label="Valuation" value={score.valuation}          color="bg-blue-400" />
          <ScoreBar label="Momentum"  value={score.momentum}           color="bg-purple-400" />
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {onAddToWatchlist && (
            <button
              onClick={onAddToWatchlist}
              disabled={inWatchlist}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                inWatchlist
                  ? "border-positive/30 text-positive cursor-default"
                  : "border-border text-muted hover:border-accent/40 hover:text-accent"
              }`}
            >
              {inWatchlist ? "✓ Watchlisted" : "+ Watchlist"}
            </button>
          )}
          <Link
            href={researchHref}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
            onClick={(e) => e.stopPropagation()}
          >
            Research
          </Link>
          <Link
            href={`/valuation?symbol=${encodeURIComponent(opportunity.ticker)}`}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
            onClick={(e) => e.stopPropagation()}
          >
            DCF
          </Link>
          <Link
            href={`/compare?a=${encodeURIComponent(opportunity.ticker)}`}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
            onClick={(e) => e.stopPropagation()}
          >
            Compare
          </Link>
        </div>
        <div className="flex items-center gap-1.5">
          {hasThesis && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              Thesis {expanded ? "−" : "+"}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              title="Dismiss this opportunity"
              aria-label={`Dismiss ${opportunity.ticker}`}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted/60 transition-colors hover:border-negative/40 hover:text-negative"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Expanded thesis */}
      {expanded && hasThesis && (
        <div className="border-t border-border">
          <InvestmentThesisPanel thesis={opportunity.thesis!} ticker={opportunity.ticker} />
        </div>
      )}
    </div>
  );
}
