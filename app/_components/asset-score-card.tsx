"use client";

import type { ScoreResult } from "@/lib/types";
import {
  RECOMMENDATION_ARC as ARC_COLOR,
  RECOMMENDATION_LABEL as REC_LABEL,
  RECOMMENDATION_TONE as REC_STYLE,
  scoreMeterTone,
} from "@/lib/recommendation";
import { CountUp } from "./count-up";
import { Reveal } from "./reveal";
import { ScoreRing } from "./score-ring";
import { ValueBar } from "./value-bar";

const barColor = (v: number | null) => (v == null ? "bg-border" : scoreMeterTone(v).bar);

const whole = (v: number) => String(Math.round(v));

/**
 * Shared score-card rendering for non-equity asset classes (fund, crypto, ...
 * future). Equity keeps its own ScoreCard (app/research/_components/score-card.tsx)
 * because its three signal rows — Fundamentals / Analyst consensus / Price
 * momentum — are equity-specific; every other asset class has a different
 * signal shape but the SAME visual mechanics (ring, recommendation badge,
 * confidence bar, signal rows, bucket breakdown, rationale). This component
 * is that shared mechanics; each asset class supplies its own signal-row
 * labels/details via `signalRows` rather than this component guessing them.
 */
export function AssetScoreCard({
  score,
  signalRows,
}: {
  score: ScoreResult;
  signalRows: [label: string, value: number | null, detail: string][];
}) {
  return (
    <section className="card-lift flex flex-col gap-6 rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center gap-5">
        <ScoreRing
          score={score.composite}
          size={72}
          strokeWidth={4}
          arcClassName={ARC_COLOR[score.recommendation]}
          valueClassName="text-[1.6rem] font-bold"
          label={`Composite score ${score.composite} out of 100`}
        />

        <div className="flex flex-col gap-2">
          <span
            className={`inline-flex w-fit items-center rounded-lg border px-3 py-1 text-sm font-semibold tracking-wide ${REC_STYLE[score.recommendation]}`}
          >
            {REC_LABEL[score.recommendation]}
          </span>
          <div className="flex items-center gap-2">
            <div className="w-20">
              <ValueBar value={score.confidence} barClassName="bg-brand/60" />
            </div>
            <span className="text-xs text-muted">
              <CountUp value={score.confidence} format={whole} durationMs={800} />% confidence
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {signalRows.map(([label, value, detail], i) => (
          <Reveal key={label} index={i} className="card-lift flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-caption font-medium uppercase tracking-wider text-muted">{label}</span>
              <span className="font-mono text-sm font-medium tabular-nums">
                {value != null ? <CountUp value={value} format={whole} durationMs={800} /> : "—"}
              </span>
            </div>
            <ValueBar value={value} barClassName={barColor(value)} trackClassName="bg-surface-3" />
            <span className="text-caption leading-4 text-muted/80">{detail}</span>
          </Reveal>
        ))}
      </div>

      <div className="flex flex-col gap-3.5">
        {score.buckets.map((b, i) => {
          const pct = (b.points / b.max) * 100;
          return (
            <Reveal key={b.name} index={i} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{b.name}</span>
                <span className="font-mono text-xs text-muted tabular-nums">
                  <CountUp value={b.points} format={whole} durationMs={800} />
                  <span className="text-muted/50">/{b.max}</span>
                </span>
              </div>
              <ValueBar value={pct} barClassName={barColor(pct)} height="h-1.5" />
              {b.factors.some((f) => f.detail !== "n/a" && f.detail !== "") ? (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {b.factors.map((f) =>
                    f.detail !== "n/a" && f.detail !== "" ? (
                      <span key={f.label} className="text-caption text-muted">{f.detail}</span>
                    ) : null,
                  )}
                </div>
              ) : null}
            </Reveal>
          );
        })}
      </div>

      <div className="rounded-lg border border-border/60 bg-surface-2 px-4 py-3 text-sm leading-6 text-muted">
        {score.rationale}
      </div>
    </section>
  );
}
