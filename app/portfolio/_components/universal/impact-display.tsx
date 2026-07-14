"use client";

import { formatCurrency } from "@/lib/format";
import type { ImpactEstimate } from "@/lib/portfolio/engines/simulate";

/**
 * Shared measured-impact display primitives. Used by the Decision Center
 * (per-recommendation impact) and the Optimize tab's Live Preview Panel
 * (per-selection impact) — one rendering, reused rather than duplicated.
 */

/** One measured consequence of a change. */
export function ImpactChip({
  label,
  value,
  good,
  suffix = "",
}: {
  label: string;
  value: number | null;
  good: boolean | null;
  suffix?: string;
}) {
  if (value == null || Math.abs(value) < 0.01) return null;
  const tone = good == null ? "text-muted" : good ? "text-positive" : "text-negative";
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface/50 px-2.5 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted/70">{label}</span>
      <span className={`font-mono text-xs font-semibold tabular-nums ${tone}`}>
        {value > 0 ? "+" : ""}{value.toFixed(suffix === "$" ? 0 : 1)}{suffix === "$" ? "" : suffix}
      </span>
    </div>
  );
}

export function ImpactRow({ impact }: { impact: ImpactEstimate }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <ImpactChip label="Health" value={impact.healthDelta} good={impact.healthDelta > 0} suffix=" pts" />
      {/* Lower volatility is better, so a negative riskDelta is good. */}
      <ImpactChip label="Volatility" value={impact.riskDelta} good={impact.riskDelta != null ? impact.riskDelta < 0 : null} suffix="pp" />
      {/* Lower HHI = better diversified. */}
      <ImpactChip
        label="Diversification"
        value={impact.diversificationDelta !== 0 ? -impact.diversificationDelta / 100 : null}
        good={impact.diversificationDelta < 0}
        suffix=""
      />
      <ImpactChip label="Inflation" value={impact.inflationDelta} good={impact.inflationDelta != null ? impact.inflationDelta > 0 : null} />
      {impact.incomeDelta !== 0 && (
        <div className="flex flex-col rounded-lg border border-border bg-surface/50 px-2.5 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted/70">Income</span>
          <span className={`font-mono text-xs font-semibold tabular-nums ${impact.incomeDelta > 0 ? "text-positive" : "text-negative"}`}>
            {impact.incomeDelta > 0 ? "+" : "−"}{formatCurrency(Math.abs(impact.incomeDelta))}/yr
          </span>
        </div>
      )}
    </div>
  );
}

/** One row of a before/after comparison — green improved, red worse, grey unchanged. */
export function StateRow({
  label,
  before,
  after,
  suffix = "",
  higherIsBetter = true,
  decimals = 1,
}: {
  label: string;
  before: number | null;
  after: number | null;
  suffix?: string;
  higherIsBetter?: boolean;
  decimals?: number;
}) {
  if (before == null || after == null) return null;
  const delta = after - before;
  if (Math.abs(delta) < 10 ** -decimals / 2) {
    return (
      <div className="flex items-center justify-between gap-3 py-1 text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono tabular-nums text-foreground">{before.toFixed(decimals)}{suffix}</span>
      </div>
    );
  }
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1.5 font-mono tabular-nums">
        <span className="text-muted/70">{before.toFixed(decimals)}{suffix}</span>
        <span className="text-muted/40">→</span>
        <span className={improved ? "font-semibold text-positive" : "font-semibold text-negative"}>
          {after.toFixed(decimals)}{suffix}
        </span>
      </span>
    </div>
  );
}
