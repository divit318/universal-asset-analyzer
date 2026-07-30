import { Card, Badge } from "@/app/_components/ui";
import type { HealthScore, ScoreTrend } from "@/lib/portfolio/engines/health";

/**
 * The Universal Portfolio Health Score.
 *
 * The visible difference from the old score: dimensions can ABSTAIN. The old engine
 * had 8 dimensions, 5 of which read an equity-only structure and returned a
 * fabricated 50 for any non-equity portfolio — so an all-bond portfolio scored
 * "average" on Quality, Growth, Valuation and Financial Health, not because it was
 * average but because the engine had nothing to say and said it anyway.
 *
 * Abstained dimensions are rendered as abstained, and their weight is redistributed
 * across the ones that can actually speak.
 */

const GRADE_TONE: Record<string, string> = {
  A: "text-positive",
  B: "text-positive",
  C: "text-foreground",
  D: "text-warning",
  F: "text-negative",
};

/**
 * Bar tone per dimension, keyed off the engine's own `trend` classification
 * (health.ts's trendOf()) rather than a second score-band guess in the UI.
 *
 * This replaces a previous local band (`score >= 45 ? "bg-brand" : …`) that
 * colored the 45-69 range brand-blue — an accent color with no severity
 * meaning, so a middling dimension (e.g. Holding Quality at 69) rendered in a
 * color unrelated to the red-to-green scale every other bar used, reading as a
 * distinct, unexplained category rather than "fair." "neutral" now renders in
 * the same true-neutral gray the health grade's own "C" band already uses.
 */
const TREND_TONE: Record<ScoreTrend, string> = {
  strong: "bg-positive",
  good: "bg-positive",
  neutral: "bg-muted",
  weak: "bg-warning",
  poor: "bg-negative",
};

export function HealthPanel({ health }: { health: HealthScore }) {
  const scored = health.dimensions.filter((d) => d.score != null);
  const abstained = health.dimensions.filter((d) => d.score == null);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Portfolio health
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{health.summary}</p>
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className={`font-mono text-3xl font-bold tabular-nums ${GRADE_TONE[health.grade]}`}>
            {health.total}
          </span>
          <span className={`font-mono text-lg font-bold ${GRADE_TONE[health.grade]}`}>
            {health.grade}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {scored.map((d) => {
          const score = d.score!;
          const tone = TREND_TONE[d.trend!];

          return (
            <li key={d.name} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-foreground">{d.name}</span>
                <span className="flex shrink-0 items-baseline gap-1.5">
                  {/* Effective weight, after redistribution — so the user can see how
                      much this dimension actually counted. */}
                  <span className="font-mono text-[10px] tabular-nums text-muted/60">
                    {(d.effectiveWeight * 100).toFixed(0)}%
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                    {score}
                  </span>
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <div className={`h-full rounded-full ${tone}`} style={{ width: `${score}%` }} />
              </div>
              <p className="text-[11px] leading-snug text-muted/70">{d.explanation}</p>
            </li>
          );
        })}
      </ul>

      {abstained.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/30 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            Not applicable ({abstained.length}) — weight redistributed, not scored 50
          </span>
          <ul className="flex flex-col gap-1">
            {abstained.map((d) => (
              <li key={d.name} className="text-[11px] leading-snug">
                <span className="text-foreground">{d.name}</span>
                <span className="text-muted/70"> — {d.explanation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Badge variant="neutral">{health.coveragePct}% of scoring weight applicable</Badge>
      </div>
    </Card>
  );
}
