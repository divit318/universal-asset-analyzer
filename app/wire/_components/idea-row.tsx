"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import type { ScannerOpportunity } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { InvestmentThesisPanel } from "./investment-thesis-panel";
import { modelReadTier, MODEL_READ_LABEL, MODEL_READ_TITLE, corroborationLabel, isUncorroborated } from "@/lib/wire/labels";

/**
 * IdeaRow — the compact default rendering of one opportunity: a single
 * scannable line with the score, the price, and the one-line reason. The
 * full detail (score decomposition, profile, thesis, actions) lives behind
 * the expander — progressive disclosure instead of a 15-datapoint card.
 *
 * Takes the same props shape as OpportunityCard so both share the page's
 * card wiring.
 */

const DIR_STYLE = {
  bullish: { badge: "bg-positive/15 text-positive border-positive/30", arrow: "↑" },
  bearish: { badge: "bg-negative/15 text-negative border-negative/30", arrow: "↓" },
  neutral: { badge: "bg-muted/15 text-muted border-muted/30", arrow: "→" },
};

const VERDICT_STYLE = {
  exceptional: "bg-positive text-background",
  strong: "bg-positive/80 text-background",
  moderate: "bg-accent text-background",
  weak: "bg-muted/40 text-foreground",
};

function ScoreBar({
  label,
  value,
  estimated,
  color = "bg-accent",
}: {
  label: string;
  value: number;
  /** True when this component fell back to 50 for missing fundamentals. */
  estimated?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-label uppercase tracking-widest text-muted/60">
        {label}
      </span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className={`h-full rounded-full animate-bar-fill ${estimated ? "bg-muted/40" : color}`}
          style={{ width: `${Math.max(4, value)}%`, "--bar-value": `${Math.max(4, value)}%` } as CSSProperties}
        />
      </div>
      <span
        className="w-10 shrink-0 text-right font-mono text-label text-muted"
        title={estimated ? "No fundamentals data — neutral placeholder, not a measurement" : undefined}
      >
        {value}
        {estimated ? " est" : ""}
      </span>
    </div>
  );
}

export function IdeaRow({
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
  const positive = (opportunity.quote?.changePercent ?? 0) >= 0;
  const researchHref = `/stocks/${encodeURIComponent(opportunity.ticker)}`;
  const reason = opportunity.thesis?.headline ?? opportunity.rationale;
  const readTier = modelReadTier(profile?.confidence);
  const noFundamentals = opportunity.compositeScores == null;

  return (
    <li
      className={`flex flex-col border-b border-border last:border-b-0 animate-fade-rise ${
        highlighted ? "bg-accent/5 ring-1 ring-inset ring-accent/40" : ""
      }`}
      style={style}
    >
      {/* Line 1 — identity, score, price, expander */}
      <div className="flex items-center gap-3 px-4 pt-2.5">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-label font-bold ${VERDICT_STYLE[score.verdict]}`}
          title={`Composite ${score.composite} — ${score.verdict}. Weighted blend of catalyst, quality, valuation, momentum (deterministic).`}
        >
          {score.composite}
        </span>
        <Link
          href={researchHref}
          className="shrink-0 font-mono text-sm font-semibold text-accent hover:underline"
        >
          {opportunity.ticker}
        </Link>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-label font-semibold uppercase ${dir.badge}`}
        >
          {dir.arrow} {opportunity.direction}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{opportunity.name}</span>
        {opportunity.quote && (
          <span className="hidden shrink-0 items-baseline gap-1.5 font-mono sm:flex">
            <span className="text-xs font-medium">
              {formatCurrency(opportunity.quote.price, opportunity.quote.currency)}
            </span>
            <span className={`text-label ${positive ? "text-positive" : "text-negative"}`}>
              {formatPercent(opportunity.quote.changePercent)}
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${opportunity.ticker} detail`}
          className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
        >
          {expanded ? "−" : "+"}
        </button>
      </div>

      {/* Line 2 — the reason + corroboration */}
      <div className="flex items-baseline gap-2 px-4 pb-2.5 pt-1">
        <p className="min-w-0 flex-1 truncate text-xs leading-5 text-muted" title={reason}>
          {reason}
        </p>
        {triggerEvent && (
          <button
            type="button"
            onClick={onShowEvidence}
            disabled={!onShowEvidence}
            className={`shrink-0 font-mono text-label uppercase tracking-wide ${
              isUncorroborated(triggerEvent.sourceCount) ? "text-warning" : "text-muted/60"
            } ${onShowEvidence ? "transition-colors hover:text-accent hover:underline" : ""}`}
            title={onShowEvidence ? `Open source articles — ${triggerEvent.headline}` : triggerEvent.headline}
          >
            {corroborationLabel(triggerEvent.sourceCount)}
          </button>
        )}
      </div>

      {/* Expanded detail — profile, decomposition, thesis, actions */}
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border bg-surface-2/40 px-4 py-3">
          {triggerEvent && (
            <p className="flex items-baseline gap-1.5 text-caption leading-4 text-muted/80">
              <span className="shrink-0 text-accent" aria-hidden>⚡</span>
              <span className="min-w-0">{triggerEvent.headline}</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-label text-muted">
            {profile && (
              <span className="rounded-full border border-border px-2 py-0.5 font-semibold">
                {profile.conviction} conviction
              </span>
            )}
            {readTier && (
              <span className="rounded-full border border-border px-2 py-0.5" title={MODEL_READ_TITLE}>
                {MODEL_READ_LABEL[readTier]}
              </span>
            )}
            {profile && <span>· {profile.suggestedHoldingPeriod}</span>}
            {profile && <span>· {profile.expectedVolatility} volatility</span>}
            <span className="capitalize">· {opportunity.timeframe}-term</span>
            <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground">
              {opportunity.theme}
            </span>
          </div>
          <div className="flex max-w-md flex-col gap-1">
            <ScoreBar label="Catalyst" value={score.catalystStrength} color="bg-accent" />
            <ScoreBar label="Quality" value={score.fundamentalQuality} estimated={noFundamentals} color="bg-positive" />
            <ScoreBar label="Valuation" value={score.valuation} estimated={noFundamentals || opportunity.compositeScores?.value == null} color="bg-chart-2" />
            <ScoreBar label="Momentum" value={score.momentum} color="bg-purple-400 light:bg-purple-600" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {onAddToWatchlist && (
              <button
                onClick={onAddToWatchlist}
                disabled={inWatchlist}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  inWatchlist
                    ? "cursor-default border-positive/30 text-positive"
                    : "border-border text-muted hover:border-accent/40 hover:text-accent"
                }`}
              >
                {inWatchlist ? "✓ Watchlisted" : "+ Watchlist"}
              </button>
            )}
            <Link
              href={researchHref}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              Research
            </Link>
            <Link
              href={`/valuation?symbol=${encodeURIComponent(opportunity.ticker)}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              DCF
            </Link>
            <Link
              href={`/compare?a=${encodeURIComponent(opportunity.ticker)}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              Compare
            </Link>
            {onDismiss && (
              <button
                onClick={onDismiss}
                title="Dismiss this idea"
                aria-label={`Dismiss ${opportunity.ticker}`}
                className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-muted/60 transition-colors hover:border-negative/40 hover:text-negative"
              >
                Dismiss ✕
              </button>
            )}
          </div>
          {opportunity.thesis && (
            <div className="rounded-lg border border-border">
              <InvestmentThesisPanel thesis={opportunity.thesis} ticker={opportunity.ticker} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
