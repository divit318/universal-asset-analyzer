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

/**
 * One row of a before/after comparison — green improved, red worse, grey unchanged.
 *
 * ALWAYS renders the before → after transition, including when the two are equal.
 * An unchanged row used to collapse to a single bare value, which made one row in
 * a table of transitions look like a different KIND of fact: in the Decision
 * Center's expected-state block, "Illiquid share 0.0%" sat under "Portfolio health
 * 75 → 76" and "Annualized volatility 12.1% → 11.7%" and read as a static
 * property rather than as "this change does not move liquidity". Same shape, muted
 * tone — "no change" is an answer to the same question, not a different question.
 *
 * `format` overrides the default `toFixed(decimals) + suffix` rendering, so a
 * dollar row goes through the app's currency formatter instead of printing a raw
 * 91141, and a health row can carry its letter grade.
 */
export function StateRow({
  label,
  before,
  after,
  suffix = "",
  higherIsBetter = true,
  decimals = 1,
  format,
}: {
  label: string;
  before: number | null;
  after: number | null;
  suffix?: string;
  higherIsBetter?: boolean;
  decimals?: number;
  format?: (value: number) => string;
}) {
  if (before == null || after == null) return null;
  const render = format ?? ((v: number) => `${v.toFixed(decimals)}${suffix}`);
  const delta = after - before;
  const unchanged = Math.abs(delta) < 10 ** -decimals / 2;
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1.5 font-mono tabular-nums">
        <span className="text-muted/70">{render(before)}</span>
        <span className="text-muted/40">→</span>
        <span
          className={
            unchanged
              ? "text-foreground"
              : improved
                ? "font-semibold text-positive"
                : "font-semibold text-negative"
          }
        >
          {render(after)}
        </span>
      </span>
    </div>
  );
}
