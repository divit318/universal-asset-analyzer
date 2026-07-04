"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import type { PositionRecommendation, PortfolioAction } from "@/lib/portfolio-analytics";
import { ACTION_LABEL } from "@/lib/portfolio-analytics";
import { formatCurrency, formatPercent } from "@/lib/format";
import { MovementExplainerCard } from "@/app/_components/movement-explainer-card";

const ACTION_STYLE: Record<PortfolioAction, string> = {
  STRONG_BUY: "border-positive/60 bg-positive/15 text-positive",
  INCREASE:   "border-positive/40 bg-positive/8 text-positive",
  HOLD:       "border-amber-400/40 bg-amber-400/8 text-amber-400",
  REDUCE:     "border-orange-400/40 bg-orange-400/10 text-orange-400",
  SELL:       "border-negative/40 bg-negative/10 text-negative",
};

function ConfidenceBar({ confidence }: { confidence: number }) {
  const color = confidence >= 70 ? "bg-positive" : confidence >= 50 ? "bg-amber-400" : "bg-muted";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-16 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${confidence}%` }} />
      </div>
      <span className="text-[10px] text-muted font-mono">{confidence}%</span>
    </div>
  );
}

function RecommendationDrawer({ rec }: { rec: PositionRecommendation }) {
  return (
    <tr className="border-t border-border/50 bg-surface-2/50">
      <td colSpan={8} className="px-4 py-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Reasoning */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">Reasoning</p>
            <p className="text-xs leading-5 text-foreground/80">{rec.reasoning}</p>
          </div>

          {/* Metrics */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">Key Metrics</p>
            {rec.keyMetrics.length > 0 ? (
              <ul className="space-y-1">
                {rec.keyMetrics.map((m, i) => (
                  <li key={i} className="text-xs text-foreground/80 font-mono">{m}</li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted">No metrics available</p>}
          </div>

          {/* Catalysts & Risks */}
          <div className="space-y-3">
            {rec.catalysts.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Catalysts</p>
                <ul className="space-y-1">
                  {rec.catalysts.map((c, i) => (
                    <li key={i} className="flex gap-1.5 text-xs text-foreground/70">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-positive/60 shrink-0" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {rec.risks.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Risks</p>
                <ul className="space-y-1">
                  {rec.risks.map((r, i) => (
                    <li key={i} className="flex gap-1.5 text-xs text-foreground/70">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-negative/60 shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4">
          <MovementExplainerCard symbol={rec.symbol} />
        </div>
      </td>
    </tr>
  );
}

function AllocationBar({ current, target }: { current: number; target: number }) {
  const max = Math.max(current, target, 5);
  return (
    <div className="flex items-center gap-1">
      <div className="relative h-3 w-20 bg-surface-2 rounded-full overflow-visible">
        {/* Current */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent/50"
          style={{ width: `${Math.min((current / max) * 100, 100)}%` }}
        />
        {/* Target marker */}
        <div
          className="absolute top-0 h-3 w-0.5 bg-positive rounded-full"
          style={{ left: `${Math.min((target / max) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function PositionRecommendations({ recommendations }: { recommendations: PositionRecommendation[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  function toggle(symbol: string) {
    setExpanded((prev) => (prev === symbol ? null : symbol));
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Position</th>
            <th className="px-4 py-3 font-medium">Action</th>
            <th className="px-4 py-3 text-right font-medium">Score</th>
            <th className="px-4 py-3 text-right font-medium">Current</th>
            <th className="px-4 py-3 text-right font-medium">Target</th>
            <th className="px-4 py-3 font-medium hidden sm:table-cell">Allocation</th>
            <th className="px-4 py-3 text-right font-medium hidden md:table-cell">Suggested</th>
            <th className="px-4 py-3 font-medium hidden lg:table-cell">Confidence</th>
            <th className="px-4 py-3 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {recommendations.map((rec) => (
            <Fragment key={rec.symbol}>
              <tr
                className="bg-surface hover:bg-surface-2 cursor-pointer"
                onClick={() => toggle(rec.symbol)}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/research?symbol=${rec.symbol}`}
                    className="font-mono font-semibold text-accent hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rec.symbol}
                  </Link>
                  <p className="text-xs text-muted truncate max-w-[120px]">{rec.name}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${ACTION_STYLE[rec.action]}`}>
                    {ACTION_LABEL[rec.action]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-sm font-semibold">{rec.composite}</span>
                  <span className="text-xs text-muted">/100</span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm">{rec.currentWeight.toFixed(1)}%</td>
                <td className="px-4 py-3 text-right font-mono text-sm">
                  <span className={rec.delta > 1 ? "text-positive" : rec.delta < -1 ? "text-negative" : ""}>
                    {rec.targetWeight.toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <AllocationBar current={rec.currentWeight} target={rec.targetWeight} />
                </td>
                <td className="px-4 py-3 text-right hidden md:table-cell">
                  <span className={`font-mono text-xs font-medium ${rec.suggestedDollar > 0 ? "text-positive" : rec.suggestedDollar < 0 ? "text-negative" : "text-muted"}`}>
                    {rec.suggestedDollar > 0 ? "+" : ""}{formatCurrency(rec.suggestedDollar)}
                  </span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <ConfidenceBar confidence={rec.confidence} />
                </td>
                <td className="px-4 py-3 text-muted text-center">
                  <span className={`text-xs transition-transform inline-block ${expanded === rec.symbol ? "rotate-180" : ""}`}>▾</span>
                </td>
              </tr>
              {expanded === rec.symbol && (
                <RecommendationDrawer rec={rec} />
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
