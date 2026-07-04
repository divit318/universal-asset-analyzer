"use client";

import { useState } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio-context";
import { OBJECTIVE_CONFIG } from "@/lib/portfolio-analytics";
import type { NewPositionRecommendation } from "@/lib/portfolio-analytics";
import { formatCurrency } from "@/lib/format";
import { TradeImpactModal } from "./trade-impact-modal";
import { useIOSSafe } from "@/lib/ios-context";
import { PortfolioFitBadge } from "@/app/_components/portfolio-fit-badge";

/* ─────────────── Score bar ─────────────── */

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? "bg-positive" : value >= 50 ? "bg-warning" : "bg-negative";
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-muted">{label}</span>
        <span className="font-mono font-semibold">{value}</span>
      </div>
      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/* ─────────────── Impact badge ─────────────── */

function ImpactBadge({ label, value }: { label: string; value: string }) {
  const colors: Record<string, string> = {
    improves: "border-positive/40 bg-positive/8 text-positive",
    reduces:  "border-positive/40 bg-positive/8 text-positive",
    high:     "border-positive/40 bg-positive/8 text-positive",
    neutral:  "border-border text-muted",
    increases:"border-negative/30 bg-negative/8 text-negative",
    low:      "border-border text-muted",
    medium:   "border-warning/40 bg-warning/8 text-warning",
  };
  const colorClass = colors[value] ?? "border-border text-muted";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium ${colorClass}`}>
      <span className="text-muted/60 capitalize">{label}</span>
      <span className="capitalize">{value}</span>
    </span>
  );
}

/* ─────────────── Recommendation card ─────────────── */

function RecommendationCard({ rec, rank }: { rec: NewPositionRecommendation; rank: number }) {
  const { report } = usePortfolio();
  const ios = useIOSSafe();
  const [expanded, setExpanded] = useState(false);
  const [showImpact, setShowImpact] = useState(false);

  const iosFit = ios?.profileReady
    ? ios.getPortfolioFit({
        symbol: rec.symbol,
        sector: rec.sector ?? null,
        marketCap: null,
        scoreResult: null,
        dividendYield: null,
        geography: "US",
        isOnWatchlist: false,
      })
    : null;

  const confColor = rec.confidenceScore >= 70 ? "text-positive" : rec.confidenceScore >= 50 ? "text-warning" : "text-negative";
  const confBg    = rec.confidenceScore >= 70 ? "border-positive/30 bg-positive/5" : rec.confidenceScore >= 50 ? "border-warning/30 bg-warning/5" : "border-negative/30 bg-negative/5";

  return (
    <>
      <div className={`rounded-xl border p-5 transition-all ${confBg}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface font-mono text-xs font-bold text-muted shrink-0">
              {rank}
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/research?symbol=${rec.symbol}`}
                  className="font-mono text-base font-bold text-accent hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {rec.symbol}
                </Link>
                <span className="text-sm text-muted">{rec.name}</span>
                {rec.autoQualified ? (
                  <span className="rounded-full border border-positive/40 bg-positive/8 px-2 py-0.5 text-[10px] font-semibold text-positive">
                    ✦ Auto-qualified from Watchlist
                  </span>
                ) : rec.fromWatchlist && (
                  <span className="rounded-full border border-accent/40 bg-accent/8 px-2 py-0.5 text-[10px] font-semibold text-accent">
                    ★ Watchlist
                  </span>
                )}
                {iosFit && !iosFit.isGeneric && (
                  <PortfolioFitBadge score={iosFit.fitScore} tier={iosFit.fitTier} size="sm" />
                )}
              </div>
              <p className="text-[11px] text-muted mt-0.5">{rec.sector}</p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${confBg}`}>
              <span className={confColor}>{rec.confidenceScore}</span>
              <span className="text-muted">confidence</span>
            </div>
            <p className="font-mono text-sm font-semibold text-positive">
              {formatCurrency(rec.suggestedDollarAmount)}
            </p>
            <p className="text-[10px] text-muted">{rec.suggestedAllocationPct}% of portfolio</p>
          </div>
        </div>

        {/* Reason */}
        <p className="text-sm leading-5 text-foreground/85 mb-3">{rec.reason}</p>

        {/* Gap addressed */}
        <div className="flex items-start gap-1.5 mb-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
          <span className="text-[10px] font-bold text-accent uppercase tracking-wide shrink-0 mt-0.5">Gap</span>
          <p className="text-xs text-foreground/75">{rec.weaknessAddressed}</p>
        </div>

        {/* Impact tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <ImpactBadge label="Diversification" value={rec.expectedImpact.diversification} />
          <ImpactBadge label="Risk" value={rec.expectedImpact.risk} />
          <ImpactBadge label="Growth" value={rec.expectedImpact.growthPotential} />
          <ImpactBadge label="Income" value={rec.expectedImpact.incomePotential} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-3 border-t border-border/50">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            {expanded ? "Hide" : "Show"} breakdown
            <span className={`transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
          </button>
          {report && (
            <button
              onClick={() => setShowImpact(true)}
              className="flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/8 px-3 py-1.5 text-xs text-accent hover:bg-accent/15 transition-colors"
            >
              Preview Impact →
            </button>
          )}
          <Link
            href={`/research?symbol=${rec.symbol}`}
            className="ml-auto text-xs text-muted hover:text-accent transition-colors"
          >
            Research →
          </Link>
        </div>

        {/* Expandable breakdown */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-border/50 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Score Breakdown</p>
              <div className="space-y-2">
                <ScoreBar label="Portfolio Fit"  value={rec.breakdown.portfolioFitScore} />
                <ScoreBar label="Fundamentals"   value={rec.breakdown.fundamentalScore} />
                <ScoreBar label="Valuation"      value={rec.breakdown.valuationScore} />
                <ScoreBar label="Technical"      value={rec.breakdown.technicalScore} />
                <ScoreBar label="Momentum"       value={rec.breakdown.momentumScore} />
              </div>
            </div>
            {rec.supportingFactors.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Supporting Factors</p>
                <div className="space-y-1.5">
                  {rec.supportingFactors.map((f, i) => (
                    <div key={i} className="flex gap-2 text-xs text-foreground/75">
                      <span className="mt-1 h-1 w-1 rounded-full bg-accent shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showImpact && report && (
        <TradeImpactModal
          symbol={rec.symbol}
          name={rec.name}
          allocationPct={rec.suggestedAllocationPct}
          dollarAmount={rec.suggestedDollarAmount}
          report={report}
          onClose={() => setShowImpact(false)}
        />
      )}
    </>
  );
}

/* ─────────────── Loading skeleton ─────────────── */

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse rounded-xl border border-border bg-surface p-5">
          <div className="flex gap-3 mb-3">
            <div className="h-7 w-7 rounded-full bg-surface-2" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 bg-surface-2 rounded" />
              <div className="h-3 w-20 bg-surface-2 rounded" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-surface-2 rounded w-full" />
            <div className="h-3 bg-surface-2 rounded w-4/5" />
          </div>
        </div>
      ))}
      <p className="text-center text-xs text-muted">
        AI is analyzing your portfolio and generating personalized recommendations…
      </p>
    </div>
  );
}

/* ─────────────── Main panel ─────────────── */

export function NewPositionsPanel() {
  const {
    newPositionRecs,
    newPositionRecsLoading,
    newPositionRecsError,
    fetchNewPositionRecs,
    objective,
    report,
  } = usePortfolio();

  const objectiveLabel = objective.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const hasRecs = newPositionRecs.length > 0;
  const hasReport = !!report;

  if (!hasReport) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">New Position Ideas</h3>
          <p className="text-xs text-muted mt-0.5">
            AI recommends NEW stocks to add — tailored to your portfolio gaps and the&nbsp;
            <span className="font-medium text-foreground/80">{objectiveLabel}</span> objective.
          </p>
        </div>
        <button
          onClick={() => void fetchNewPositionRecs()}
          disabled={newPositionRecsLoading || !hasReport}
          className="shrink-0 rounded-lg border border-accent/50 bg-accent/8 px-4 py-2 text-xs font-semibold text-accent hover:bg-accent/15 disabled:opacity-50 transition-colors"
        >
          {newPositionRecsLoading ? "Analyzing…" : hasRecs ? "↻ Refresh" : "Generate Ideas"}
        </button>
      </div>

      {newPositionRecsError && (
        <div className="rounded-lg border border-negative/30 bg-negative/8 px-4 py-3 text-xs text-negative">
          {newPositionRecsError.includes("ollama_unavailable") || newPositionRecsError.includes("Ollama")
            ? "Ollama is offline — start Ollama to enable AI recommendations."
            : newPositionRecsError}
          <button
            onClick={() => void fetchNewPositionRecs()}
            className="ml-2 text-accent underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {newPositionRecsLoading && <LoadingSkeleton />}

      {!newPositionRecsLoading && !hasRecs && !newPositionRecsError && (
        <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center">
          <p className="text-2xl mb-3">✦</p>
          <p className="text-sm font-semibold mb-1">AI Portfolio Recommendations</p>
          <p className="text-xs text-muted max-w-sm mx-auto mb-4 leading-5">
            Generate personalized stock recommendations based on your portfolio&apos;s gaps,
            health score, and your selected{" "}
            <span className="font-medium text-foreground/80">{objectiveLabel}</span> objective.
          </p>
          <button
            onClick={() => void fetchNewPositionRecs()}
            disabled={!hasReport}
            className="rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            Generate New Position Ideas →
          </button>
        </div>
      )}

      {!newPositionRecsLoading && hasRecs && (
        <div className="flex flex-col gap-4">
          {newPositionRecs.map((rec, i) => (
            <RecommendationCard key={rec.symbol} rec={rec} rank={i + 1} />
          ))}
          <p className="text-center text-[11px] text-muted/60">
            AI recommendations are generated by local Ollama — not financial advice. Always do your own research.
          </p>
        </div>
      )}
    </div>
  );
}
