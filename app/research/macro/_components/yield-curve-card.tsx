import type { MacroSummary } from "@/lib/macro-analysis";

const SHAPE_LABEL: Record<NonNullable<MacroSummary["shape"]>, string> = {
  normal: "Normal (upward-sloping)",
  flat: "Flat",
  inverted: "Inverted",
};

const TREND_LABEL: Record<NonNullable<MacroSummary["curveTrend"]>, string> = {
  steepening: "Steepening",
  flattening: "Flattening",
  stable: "Stable",
};

/**
 * No score ring here — a yield curve doesn't have a BUY/SELL call. This is
 * a shape/trend display, the same "informational, not scored" treatment
 * Derivatives got.
 */
export function YieldCurveCard({ summary }: { summary: MacroSummary }) {
  return (
    <section className="card-lift flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">US Treasury Yield Curve</h3>
        <span className="text-xs text-muted">
          {summary.tenYearMinusThreeMonth != null
            ? `10Y−3M: ${summary.tenYearMinusThreeMonth >= 0 ? "+" : ""}${summary.tenYearMinusThreeMonth.toFixed(2)}pp`
            : "—"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {summary.curve.map((p) => (
          <div key={p.tenor} className="flex flex-col gap-1 bg-surface p-3">
            <dt className="text-caption uppercase tracking-wide text-muted">{p.label}</dt>
            <dd className="font-mono text-sm">{p.yieldPercent != null ? `${p.yieldPercent.toFixed(2)}%` : "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-4 text-xs text-muted">
        <span>
          Shape: <span className="font-medium text-foreground">{summary.shape ? SHAPE_LABEL[summary.shape] : "—"}</span>
        </span>
        <span>
          Trend (~20 trading days): <span className="font-medium text-foreground">{summary.curveTrend ? TREND_LABEL[summary.curveTrend] : "—"}</span>
        </span>
      </div>

      {summary.shape === "inverted" && (
        <p className="rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning">
          An inverted curve (10-year below 3-month) has historically preceded US recessions, though with variable lag — not a precise timing signal.
        </p>
      )}
    </section>
  );
}
