"use client";

import type { MomentumSignal, ScoreResult } from "@/lib/types";
import {
  RECOMMENDATION_ARC as ARC_COLOR,
  RECOMMENDATION_LABEL as REC_LABEL,
  RECOMMENDATION_TONE as REC_STYLE,
} from "@/lib/recommendation";
import { CountUp } from "@/app/_components/count-up";
import { Reveal } from "@/app/_components/reveal";
import { ScoreRing } from "@/app/_components/score-ring";
import { ValueBar } from "@/app/_components/value-bar";

/** Track bar color based on a 0-100 value */
function barColor(v: number | null) {
  if (v == null) return "bg-border";
  if (v >= 60)   return "bg-positive";
  if (v >= 42)   return "bg-warning";
  return "bg-negative";
}

const pct1 = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export function ScoreCard({
  score,
  momentum,
}: {
  score: ScoreResult;
  momentum?: MomentumSignal | null;
}) {
  const signalRows: [string, number | null, string][] = [
    ["Fundamentals",     score.signals.fundamentals, "Valuation, quality, growth & balance sheet"],
    ["Analyst consensus",score.signals.analysts,     "Ratings mix, price-target upside, revisions"],
    [
      "Price momentum",
      score.signals.momentum,
      momentum
        ? `Trend ${momentum.trend} · ${pct1(momentum.vsSma200)} vs 200d SMA`
        : "Technical trend vs moving averages",
    ],
  ];

  return (
    <section className="card-lift flex flex-col gap-6 rounded-xl border border-border bg-surface p-6">
      {/* Header row: ring + label + confidence */}
      <div className="flex flex-wrap items-center gap-5">
        {/* Composite score ring — arc draws to the score as the number counts up */}
        <ScoreRing
          score={score.composite}
          size={72}
          strokeWidth={4}
          arcClassName={ARC_COLOR[score.recommendation]}
          valueClassName="text-[1.6rem] font-bold"
          label={`Composite score ${score.composite} out of 100`}
        />

        {/* Recommendation + confidence */}
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
              <CountUp value={score.confidence} format={(v) => String(Math.round(v))} durationMs={800} />% confidence
            </span>
          </div>
        </div>
      </div>

      {/* Three independent signal scores */}
      <div className="grid gap-3 sm:grid-cols-3">
        {signalRows.map(([label, value, detail], i) => (
          <Reveal
            key={label}
            index={i}
            className="card-lift flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-caption font-medium uppercase tracking-wider text-muted">
                {label}
              </span>
              <span className="font-mono text-sm font-medium tabular-nums">
                {value != null
                  ? <CountUp value={value} format={(v) => String(Math.round(v))} durationMs={800} />
                  : "—"}
              </span>
            </div>
            <ValueBar value={value} barClassName={barColor(value)} trackClassName="bg-surface-3" />
            <span className="text-caption leading-4 text-muted/80">{detail}</span>
          </Reveal>
        ))}
      </div>

      {/* Fundamental factor buckets */}
      <div className="flex flex-col gap-3.5">
        {score.buckets.map((b, i) => {
          const pct = (b.points / b.max) * 100;
          return (
            <Reveal key={b.name} index={i} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{b.name}</span>
                <span className="font-mono text-xs text-muted tabular-nums">
                  <CountUp value={b.points} format={(v) => String(Math.round(v))} durationMs={800} />
                  <span className="text-muted/50">/{b.max}</span>
                </span>
              </div>
              <ValueBar value={pct} barClassName={barColor(pct)} height="h-1.5" />
              {b.factors.some((f) => f.detail !== "n/a") ? (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {b.factors.map((f) =>
                    f.detail !== "n/a" ? (
                      <span key={f.label} className="text-caption text-muted">
                        {f.detail}
                      </span>
                    ) : null,
                  )}
                </div>
              ) : null}
            </Reveal>
          );
        })}
      </div>

      {/* Rationale */}
      <div className="rounded-lg border border-border/60 bg-surface-2 px-4 py-3 text-sm leading-6 text-muted">
        {score.rationale}
      </div>
    </section>
  );
}
