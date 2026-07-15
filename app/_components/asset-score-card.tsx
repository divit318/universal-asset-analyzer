import type { ScoreResult } from "@/lib/types";
import {
  RECOMMENDATION_LABEL as REC_LABEL,
  RECOMMENDATION_TONE as REC_STYLE,
  RECOMMENDATION_RING as RING_COLOR,
} from "@/lib/recommendation";

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
    <section className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center gap-5">
        <div
          className={`relative flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center rounded-full border-2 ${RING_COLOR[score.recommendation]}`}
        >
          <span className="text-[1.6rem] font-bold leading-none tabular-nums">{score.composite}</span>
          <span className="mt-0.5 text-micro font-medium uppercase tracking-wide text-muted">/ 100</span>
        </div>

        <div className="flex flex-col gap-2">
          <span
            className={`inline-flex w-fit items-center rounded-lg border px-3 py-1 text-sm font-semibold tracking-wide ${REC_STYLE[score.recommendation]}`}
          >
            {REC_LABEL[score.recommendation]}
          </span>
          <div className="flex items-center gap-2">
            <div className="h-1 w-20 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand/60" style={{ width: `${score.confidence}%` }} />
            </div>
            <span className="text-xs text-muted">{score.confidence}% confidence</span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {signalRows.map(([label, value, detail]) => (
          <div key={label} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-caption font-medium uppercase tracking-wider text-muted">{label}</span>
              <span className="font-mono text-sm font-medium tabular-nums">{value != null ? value : "—"}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full transition-all duration-500 ${value == null ? "bg-border" : value >= 60 ? "bg-positive" : value >= 42 ? "bg-warning" : "bg-negative"}`}
                style={{ width: `${value ?? 0}%` }}
              />
            </div>
            <span className="text-caption leading-4 text-muted/80">{detail}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3.5">
        {score.buckets.map((b) => {
          const pct = (b.points / b.max) * 100;
          return (
            <div key={b.name} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{b.name}</span>
                <span className="font-mono text-xs text-muted tabular-nums">
                  {b.points}<span className="text-muted/50">/{b.max}</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${pct >= 60 ? "bg-positive" : pct >= 42 ? "bg-warning" : "bg-negative"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {b.factors.some((f) => f.detail !== "n/a" && f.detail !== "") ? (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {b.factors.map((f) =>
                    f.detail !== "n/a" && f.detail !== "" ? (
                      <span key={f.label} className="text-caption text-muted">{f.detail}</span>
                    ) : null,
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-border/60 bg-surface-2 px-4 py-3 text-sm leading-6 text-muted">
        {score.rationale}
      </div>
    </section>
  );
}
