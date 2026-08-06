"use client";

import type { RiskItem, RiskLevel, ScoreResult } from "@/lib/types";
import {
  RECOMMENDATION_ARC,
  RECOMMENDATION_LABEL,
  RECOMMENDATION_TONE,
  scoreToRecommendation,
} from "@/lib/recommendation";
import { CountUp } from "@/app/_components/count-up";
import { LoadingPanel } from "@/app/_components/loading-panel";
import { Reveal } from "@/app/_components/reveal";
import { ScoreRing } from "@/app/_components/score-ring";
import { ValueBar } from "@/app/_components/value-bar";

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
  return <LoadingPanel height="h-[248px]" message="Scoring fundamentals, analyst consensus, and momentum…" />;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface Props {
  score: ScoreResult | null;
  loading: boolean;
  risks?: RiskItem[];
  /** Jump to the tab with the full risk list (Analysis). */
  onViewRisks?: () => void;
}

export function ConvictionBreakdown({ score, loading, risks, onViewRisks }: Props) {
  if (loading) return <Skeleton />;
  if (!score) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center text-sm text-muted">
        Conviction breakdown unavailable — connect an AI provider and ensure fundamentals are loaded.
      </div>
    );
  }

  const recColor = RECOMMENDATION_TONE[score.recommendation] ?? RECOMMENDATION_TONE.HOLD;

  return (
    <div className="flex flex-col gap-6">

      {/* ── Top row: overall score + recommendation ── */}
      <div className="card-lift flex flex-wrap items-center gap-5 rounded-xl border border-border bg-surface p-5">
        {/* Composite score ring — arc draws to the score as the number counts up */}
        <ScoreRing
          score={score.composite}
          size={80}
          strokeWidth={4}
          arcClassName={RECOMMENDATION_ARC[scoreToRecommendation(score.composite)]}
          valueClassName="text-[1.75rem] font-bold"
          label={`Composite score ${score.composite} out of 100`}
        />

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex w-fit items-center rounded-lg border px-3 py-1 text-sm font-semibold tracking-wide ${recColor}`}>
              {RECOMMENDATION_LABEL[score.recommendation] ?? score.recommendation}
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
            <div className="w-24">
              <ValueBar value={score.confidence} barClassName="bg-accent/60" />
            </div>
            <span className="text-xs text-muted">
              <CountUp value={score.confidence} format={(v) => String(Math.round(v))} durationMs={800} />% data confidence
            </span>
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
        {/* Data confidence is deliberately NOT a pillar here: it is metadata
            about input completeness, not an investment signal — it renders as
            the small labelled line in the score card above instead. */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Fundamentals", value: score.signals.fundamentals },
            { label: "Analyst Consensus", value: score.signals.analysts },
            { label: "Price Momentum", value: score.signals.momentum },
          ].map(({ label, value }, i) => (
            <Reveal key={label} index={i} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</span>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {value != null
                    ? <CountUp value={value} format={(v) => String(Math.round(v))} durationMs={800} />
                    : "—"}
                </span>
              </div>
              <ValueBar value={value ?? null} barClassName={barColor(value ?? 0)} trackClassName="bg-surface" />
            </Reveal>
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
          <span className="text-[10px] text-muted/50">All subscores normalized to /100</span>
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
          {score.buckets.map((bucket, i) => {
            const pct = Math.round((bucket.points / bucket.max) * 100);
            const conf = confidenceLabel(pct);
            const visibleFactors = bucket.factors.filter((f) => f.detail !== "n/a");
            return (
              <Reveal
                key={bucket.name}
                index={i}
                className="flex min-h-[7.5rem] flex-col gap-1.5 rounded-card border border-border bg-surface p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-foreground">{bucket.name}</span>
                  {/* Normalized to /100 — the same figure the narration quotes
                      (raw maxes of /30, /25, /24… explained nothing). */}
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted" title={`${bucket.points.toFixed(0)} of ${bucket.max} raw points`}>
                    <CountUp value={pct} format={(v) => String(Math.round(v))} durationMs={800} />
                    <span className="text-muted/40">/100</span>
                  </span>
                </div>

                {/* Confidence bar */}
                <ValueBar value={pct} barClassName={barColor(pct)} height="h-1" />

                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[10px] font-semibold ${conf.cls}`}>{conf.text}</span>
                </div>

                {/* Factor details — an empty card reads as broken, so the
                    half-credit degradation is stated instead. */}
                {visibleFactors.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    {visibleFactors.map((f) => (
                      <span key={f.label} className="truncate text-[11px] text-muted/70" title={f.detail}>
                        {f.detail}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[11px] text-muted/50">No source data — scored at half credit</span>
                )}
              </Reveal>
            );
          })}
        </div>
      </div>

    </div>
  );
}
