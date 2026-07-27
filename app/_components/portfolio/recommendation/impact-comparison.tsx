import { Card } from "@/app/_components/ui";
import type { PortfolioEvaluation } from "@/lib/portfolio/engines/simulate";

function Row({ label, before, after, unit = "" }: { label: string; before: string; after: string; unit?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2 font-mono tabular-nums">
        <span className="text-muted/70">{before}{unit}</span>
        <span aria-hidden className="text-muted/50">→</span>
        <span className="font-semibold text-foreground">{after}{unit}</span>
      </span>
    </div>
  );
}

type AllocationDimension = "byAssetClass" | "bySector" | "byGeography" | "byCurrency";

/** Top N weight shifts for an allocation dimension between before and after — derived, never a hardcoded list of "interesting" categories. */
function topShifts(before: PortfolioEvaluation, after: PortfolioEvaluation, dimension: AllocationDimension, n = 3) {
  const b = before.allocation[dimension].slices;
  const a = after.allocation[dimension].slices;
  const keys = new Set([...b.map((s) => s.key), ...a.map((s) => s.key)]);
  const shifts = [...keys].map((key) => ({
    key,
    label: a.find((s) => s.key === key)?.label ?? b.find((s) => s.key === key)?.label ?? key,
    before: b.find((s) => s.key === key)?.weight ?? 0,
    after: a.find((s) => s.key === key)?.weight ?? 0,
  }));
  return shifts
    .map((s) => ({ ...s, delta: Math.abs(s.after - s.before) }))
    .filter((s) => s.delta > 0.3)
    .sort((a2, b2) => b2.delta - a2.delta)
    .slice(0, n);
}

/** Before/after score for a named health dimension — omitted entirely when either side honestly abstains (score === null), matching the engine's own discipline of never scoring what it can't measure. */
function dimensionRow(before: PortfolioEvaluation, after: PortfolioEvaluation, name: string, label: string) {
  const b = before.health.dimensions.find((d) => d.name === name);
  const a = after.health.dimensions.find((d) => d.name === name);
  if (b?.score == null || a?.score == null) return null;
  return <Row key={name} label={label} before={b.score.toFixed(0)} after={a.score.toFixed(0)} />;
}

/** Section 6 — Expected Portfolio Impact. Only metrics actually calculated by the engines — never invented. */
export function ImpactComparison({ before, after }: { before: PortfolioEvaluation; after: PortfolioEvaluation }) {
  const sectorShifts = topShifts(before, after, "bySector");
  const classShifts = topShifts(before, after, "byAssetClass");
  const geoShifts = topShifts(before, after, "byGeography");
  const currencyShifts = topShifts(before, after, "byCurrency");

  const dimensionRows = [
    dimensionRow(before, after, "Diversification", "Diversification score"),
    dimensionRow(before, after, "Concentration", "Concentration score"),
    dimensionRow(before, after, "Liquidity", "Liquidity score"),
    dimensionRow(before, after, "Income", "Income score"),
    dimensionRow(before, after, "Inflation Protection", "Inflation protection score"),
    dimensionRow(before, after, "Currency Diversification", "Currency diversification score"),
    dimensionRow(before, after, "Geographic Diversification", "Geographic diversification score"),
    dimensionRow(before, after, "Correlation", "Correlation score"),
    dimensionRow(before, after, "Expected Drawdown", "Expected drawdown score"),
  ].filter(Boolean);

  return (
    <Card className="flex flex-col gap-1 p-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Expected portfolio impact</h3>

      <Row label="Portfolio health" before={before.health.total.toFixed(1)} after={after.health.total.toFixed(1)} />
      {before.risk.annualizedVolatility != null && after.risk.annualizedVolatility != null && (
        <Row label="Annualized volatility" before={before.risk.annualizedVolatility.toFixed(1)} after={after.risk.annualizedVolatility.toFixed(1)} unit="%" />
      )}
      <Row
        label="Cash allocation"
        before={(before.allocation.byAssetClass.slices.find((s) => s.key === "cash")?.weight ?? 0).toFixed(1)}
        after={(after.allocation.byAssetClass.slices.find((s) => s.key === "cash")?.weight ?? 0).toFixed(1)}
        unit="%"
      />

      {classShifts
        .filter((s) => s.key !== "cash")
        .map((s) => (
          <Row key={`class-${s.key}`} label={`${s.label} exposure`} before={s.before.toFixed(1)} after={s.after.toFixed(1)} unit="%" />
        ))}
      {sectorShifts.map((s) => (
        <Row key={`sector-${s.key}`} label={`${s.label} exposure`} before={s.before.toFixed(1)} after={s.after.toFixed(1)} unit="%" />
      ))}
      {geoShifts.map((s) => (
        <Row key={`geo-${s.key}`} label={`${s.label} exposure`} before={s.before.toFixed(1)} after={s.after.toFixed(1)} unit="%" />
      ))}
      {currencyShifts.map((s) => (
        <Row key={`ccy-${s.key}`} label={`${s.label} exposure`} before={s.before.toFixed(1)} after={s.after.toFixed(1)} unit="%" />
      ))}

      {dimensionRows.length > 0 && <div className="my-1 h-px bg-border/60" aria-hidden="true" />}
      {dimensionRows}
    </Card>
  );
}
