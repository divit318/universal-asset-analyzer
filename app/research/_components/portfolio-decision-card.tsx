"use client";

import { formatCurrency } from "@/lib/format";
import type { Recommendation } from "@/lib/portfolio/engines/recommend";

/**
 * Portfolio Decision Engine, surfaced for the researched symbol.
 *
 * Reuses UniversalPortfolioReport.recommendations as-is (computed by
 * lib/portfolio/engines/recommend.ts, already exposed via IOSContextValue.report)
 * — no new scoring/decision logic, only a Research-scoped view of the same
 * recommendation shown in the Portfolio Decision Center. Every impact figure below
 * is SIMULATED, not asserted — see the engine's docstring.
 */

const ACTION_STYLE: Record<Recommendation["action"], string> = {
  ADD:        "border-positive/60 bg-positive/15 text-positive",
  INCREASE:   "border-positive/40 bg-positive/8 text-positive",
  HOLD:       "border-warning/40 bg-warning/8 text-warning",
  REDUCE:     "border-orange-400/40 bg-orange-400/10 text-orange-400",
  SELL:       "border-negative/40 bg-negative/10 text-negative",
  REALLOCATE: "border-brand/40 bg-brand/8 text-brand",
};

const ACTION_LABEL: Record<Recommendation["action"], string> = {
  ADD: "Add", INCREASE: "Increase", HOLD: "Hold", REDUCE: "Reduce", SELL: "Sell", REALLOCATE: "Reallocate",
};

export function PortfolioDecisionCard({ recommendation }: { recommendation: Recommendation }) {
  const r = recommendation;
  const i = r.impact;

  return (
    <div className="card-lift flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Portfolio Decision</span>
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${ACTION_STYLE[r.action]}`}>
            {ACTION_LABEL[r.action]}
          </span>
        </div>
        <span className="font-mono text-xs text-muted">
          {formatCurrency(r.amount)} · {r.confidence}% confidence
        </span>
      </div>

      <p className="text-xs leading-5 text-foreground/85">{r.rationale}</p>

      <div className="flex flex-wrap gap-3 border-t border-border pt-2.5 text-[11px]">
        <span>
          <span className="text-muted">Health: </span>
          <span className={`font-mono font-semibold ${i.healthDelta >= 0 ? "text-positive" : "text-negative"}`}>
            {i.healthDelta >= 0 ? "+" : ""}{i.healthDelta.toFixed(1)}pts
          </span>
        </span>
        {i.riskDelta != null && (
          <span>
            <span className="text-muted">Volatility: </span>
            <span className={`font-mono font-semibold ${i.riskDelta <= 0 ? "text-positive" : "text-negative"}`}>
              {i.riskDelta >= 0 ? "+" : ""}{i.riskDelta.toFixed(1)}pp
            </span>
          </span>
        )}
        {i.incomeDelta !== 0 && (
          <span>
            <span className="text-muted">Income: </span>
            <span className={`font-mono font-semibold ${i.incomeDelta > 0 ? "text-positive" : "text-negative"}`}>
              {i.incomeDelta > 0 ? "+" : "−"}{formatCurrency(Math.abs(i.incomeDelta))}/yr
            </span>
          </span>
        )}
      </div>

      {r.tradeoffs.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted/70">Tradeoffs</p>
          <ul className="space-y-1">
            {r.tradeoffs.map((t, idx) => (
              <li key={idx} className="flex gap-1.5 text-[11px] leading-5 text-muted">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted/50" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
