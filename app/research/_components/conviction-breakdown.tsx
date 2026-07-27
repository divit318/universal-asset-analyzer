"use client";

import type { InvestmentVerdict } from "@/app/api/ai/verdict/route";
import type { RiskItem, RiskLevel, ScoreResult } from "@/lib/types";

const REC_LABEL: Record<string, string> = {
  STRONG_BUY:  "Strong Buy",
  BUY:         "Buy",
  HOLD:        "Hold",
  SELL:        "Sell",
  STRONG_SELL: "Strong Sell",
};

const REC_COLOR: Record<string, string> = {
  STRONG_BUY:  "text-positive border-positive/40 bg-positive/10",
  BUY:         "text-positive border-positive/30 bg-positive/8",
  HOLD:        "text-warning border-warning/40 bg-warning/10",
  SELL:        "text-negative border-negative/30 bg-negative/8",
  STRONG_SELL: "text-negative border-negative/40 bg-negative/10",
};

function barColor(pct: number) {
  if (pct >= 65) return "bg-positive";
  if (pct >= 42) return "bg-warning";
  return "bg-negative";
}

function confidenceLabel(pct: number) {
  if (pct >= 70) return { text: "High confidence", cls: "text-positive" };
  if (pct >= 45) return { text: "Medium confidence", cls: "text-warning" };
  return { text: "Low confidence", cls: "text-negative" };
}

const RISK_CHIP: Record<RiskLevel, { label: string; cls: string }> = {
  low:    { label: "Low risk",    cls: "text-positive border-positive/30 bg-positive/8" },
  medium: { label: "Medium risk", cls: "text-warning border-warning/30 bg-warning/8" },
  high:   { label: "High risk",   cls: "text-negative border-negative/30 bg-negative/8" },
};

function worstRisk(risks: RiskItem[]): RiskItem | null {
  const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return risks.reduce<RiskItem | null>(
    (worst, r) => (!worst || rank[r.level] > rank[worst.level] ? r : worst),
    null,
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                    */
/* -------------------------------------------------------------------------- */

function Skeleton() {
  return (
    <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-6">
      <div className="h-4 w-48 animate-pulse rounded bg-surface-2" />
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <div className="h-3 w-32 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-16 animate-pulse rounded bg-surface-2" />
            </div>
            <div className="h-1.5 w-full animate-pulse rounded-full bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface Props {
  score: ScoreResult | null;
  loading: boolean;
  verdict?: InvestmentVerdict | null;
  risks?: RiskItem[];
  /** Jump to the tab with the full Risk Heatmap (Details). */
  onViewRisks?: () => void;
}

export function ConvictionBreakdown({ score, loading, verdict, risks, onViewRisks }: Props) {
  if (loading) return <Skeleton />;
  if (!score) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted">
        Conviction breakdown unavailable — start Ollama and ensure fundamentals are loaded.
      </div>
    );
  }

  const recColor = REC_COLOR[score.recommendation] ?? REC_COLOR.HOLD;

  return (
    <div className="flex flex-col gap-6">

      {/* ── Top row: overall score + recommendation ── */}
      <div className="flex flex-wrap items-center gap-5 rounded-xl border border-border bg-surface p-5">
        {/* Composite score ring */}
        <div className="relative flex h-[80px] w-[80px] shrink-0 flex-col items-center justify-center rounded-full border-2 border-accent/40">
          <span className="text-[1.75rem] font-bold leading-none tabular-nums">{score.composite}</span>
          <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-muted">/ 100</span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex w-fit items-center rounded-lg border px-3 py-1 text-sm font-semibold tracking-wide ${recColor}`}>
              {REC_LABEL[score.recommendation] ?? score.recommendation}
            </span>
            {risks && risks.length > 0 && (() => {
              const worst = worstRisk(risks);
              if (!worst) return null;
              const chip = RISK_CHIP[worst.level];
              return (
                <button
                  type="button"
                  onClick={onViewRisks}
                  disabled={!onViewRisks}
                  className={`inline-flex items-center rounded-lg border px-3 py-1 text-xs font-semibold tracking-wide ${chip.cls} ${onViewRisks ? "cursor-pointer hover:opacity-80" : ""}`}
                  title={worst.reason}
                >
                  {chip.label}
                  {onViewRisks && <span className="ml-1.5 text-[10px] opacity-70">Details →</span>}
                </button>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 w-24 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent/60" style={{ width: `${score.confidence}%` }} />
            </div>
            <span className="text-xs text-muted">{score.confidence}% data confidence</span>
          </div>
          {score.rationale && (
            <p className="max-w-lg text-[11px] leading-5 text-muted">{score.rationale}</p>
          )}
        </div>
      </div>

      {/* ── Investment signal pillars ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted">Signal Pillars</h3>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Fundamentals", value: score.signals.fundamentals },
            { label: "Analyst Consensus", value: score.signals.analysts },
            { label: "Price Momentum", value: score.signals.momentum },
            { label: "Data Confidence", value: score.confidence },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</span>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {value != null ? value : "—"}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${barColor(value ?? 0)}`}
                  style={{ width: `${value ?? 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Investment assumptions (score buckets) ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Investment Assumptions
          </h3>
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] text-muted/50">Confidence based on available data</span>
        </div>

        {/* A grid, not a stack.
        
            These six buckets carry ~18 numbers between them. As full-width rows
            they occupied ~450px of vertical space with the entire middle of every
            row empty — 900px of horizontal run for one label, one score and three
            short chips. In two or three columns the same information reads in a
            third of the height, and — more importantly — the six scores can be
            compared against each other at a glance, which is the only reason to
            show them together. */}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {score.buckets.map((bucket) => {
            const pct = Math.round((bucket.points / bucket.max) * 100);
            const conf = confidenceLabel(pct);
            const visibleFactors = bucket.factors.filter((f) => f.detail !== "n/a");
            return (
              <div
                key={bucket.name}
                className="flex flex-col gap-1.5 rounded-card border border-border bg-surface p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-foreground">{bucket.name}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                    {bucket.points}<span className="text-muted/40">/{bucket.max}</span>
                  </span>
                </div>

                {/* Confidence bar */}
                <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${barColor(pct)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[10px] font-semibold ${conf.cls}`}>{conf.text}</span>
                </div>

                {/* Factor details */}
                {visibleFactors.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    {visibleFactors.map((f) => (
                      <span key={f.label} className="truncate text-[11px] text-muted/70" title={f.detail}>
                        {f.detail}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── AI verdict headline cross-reference ── */}
      {verdict && (
        <div className="rounded-lg border border-border/60 bg-surface-2 px-4 py-3 text-sm leading-6 text-muted">
          <span className="mr-2 text-[10px] font-semibold uppercase tracking-widest text-muted/60">AI Thesis</span>
          {verdict.thesis}
        </div>
      )}
    </div>
  );
}
