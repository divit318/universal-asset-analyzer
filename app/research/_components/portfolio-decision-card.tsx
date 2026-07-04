"use client";

import { ACTION_LABEL, type PositionRecommendation } from "@/lib/portfolio-analytics";

/**
 * Portfolio Decision Engine, surfaced for the researched symbol. Reuses
 * PortfolioReport.recommendations as-is (computed by
 * lib/portfolio-analytics.ts's computeRecommendations(), already exposed via
 * IOSContextValue.report) — no new scoring/decision logic, only a Research-
 * scoped view of the same recommendation shown in the Portfolio Decision
 * Queue for a holding.
 */

const ACTION_STYLE: Record<PositionRecommendation["action"], string> = {
  STRONG_BUY: "border-positive/60 bg-positive/15 text-positive",
  INCREASE:   "border-positive/40 bg-positive/8 text-positive",
  HOLD:       "border-warning/40 bg-warning/8 text-warning",
  REDUCE:     "border-orange-400/40 bg-orange-400/10 text-orange-400",
  SELL:       "border-negative/40 bg-negative/10 text-negative",
};

export function PortfolioDecisionCard({ recommendation }: { recommendation: PositionRecommendation }) {
  const r = recommendation;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Portfolio Decision</span>
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${ACTION_STYLE[r.action]}`}>
            {ACTION_LABEL[r.action]}
          </span>
        </div>
        <span className="font-mono text-xs text-muted">
          {r.currentWeight.toFixed(1)}% held → {r.targetWeight.toFixed(1)}% target
        </span>
      </div>

      <p className="text-xs leading-5 text-foreground/85">{r.reasoning}</p>

      {(r.catalysts.length > 0 || r.risks.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {r.catalysts.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-positive/70">Catalysts</p>
              <ul className="space-y-1">
                {r.catalysts.map((c, i) => (
                  <li key={i} className="flex gap-1.5 text-[11px] leading-5 text-muted">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-positive/50" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.risks.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-negative/70">Risks</p>
              <ul className="space-y-1">
                {r.risks.map((rk, i) => (
                  <li key={i} className="flex gap-1.5 text-[11px] leading-5 text-muted">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-negative/50" />
                    {rk}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {r.keyMetrics.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-2.5">
          {r.keyMetrics.map((m, i) => (
            <span key={i} className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-[10px] text-muted">{m}</span>
          ))}
        </div>
      )}
    </div>
  );
}
