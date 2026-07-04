"use client";

import type { GapAnalysis } from "@/lib/portfolio-analytics";

const PRIORITY_STYLE: Record<string, string> = {
  high:   "border-negative/30 bg-negative/5",
  medium: "border-amber-400/25 bg-amber-400/5",
  low:    "border-border bg-surface",
};

const PRIORITY_BADGE: Record<string, string> = {
  high:   "border-negative/40 bg-negative/10 text-negative",
  medium: "border-amber-400/40 bg-amber-400/10 text-amber-400",
  low:    "border-border text-muted",
};

export function GapAnalysisPanel({ gaps }: { gaps: GapAnalysis }) {
  const missing = gaps.missing.slice(0, 8);
  const overweight = gaps.overweight;

  return (
    <div className="flex flex-col gap-5">
      {/* Concentration score */}
      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col items-center">
          <span className="font-mono text-3xl font-bold">{gaps.concentrationScore}</span>
          <span className="text-[10px] text-muted uppercase tracking-widest">Diversification</span>
        </div>
        <div className="flex-1">
          <div className="h-2 w-full bg-surface-2 rounded-full overflow-hidden mb-1.5">
            <div
              className={`h-full rounded-full ${gaps.concentrationScore >= 70 ? "bg-positive" : gaps.concentrationScore >= 50 ? "bg-amber-400" : "bg-negative"}`}
              style={{ width: `${gaps.concentrationScore}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            {gaps.concentrationScore >= 70
              ? "Portfolio is well diversified across sectors and positions."
              : gaps.concentrationScore >= 50
                ? "Moderate diversification — some concentration risk present."
                : "High concentration — portfolio is not adequately diversified."}
          </p>
        </div>
      </div>

      {/* Overweight warnings */}
      {overweight.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Overweight Exposures</h3>
          <div className="flex flex-col gap-2">
            {overweight.map((o, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-orange-400/25 bg-orange-400/5 px-4 py-3">
                <span className="text-orange-400 mt-0.5 shrink-0">⚠</span>
                <div>
                  <span className="text-sm font-semibold">{o.sector}</span>
                  <span className="ml-2 font-mono text-sm text-orange-400">{o.currentWeight.toFixed(1)}%</span>
                  <p className="text-xs text-muted mt-0.5">{o.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing sectors */}
      {missing.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Missing Exposures</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {missing.map((m) => (
              <div key={m.name} className={`rounded-xl border p-4 ${PRIORITY_STYLE[m.priority]}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">{m.name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_BADGE[m.priority]}`}>
                    {m.priority}
                  </span>
                </div>
                <p className="text-xs text-muted leading-relaxed mb-2">{m.reason}</p>
                {m.suggestedSymbols.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {m.suggestedSymbols.slice(0, 4).map((sym) => (
                      <span key={sym} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                        {sym}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
