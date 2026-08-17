/**
 * Pure English-formatting helpers for numbers the engines already computed —
 * no new math, just consistent wording so the same delta doesn't read as
 * "+0.3pp" in one panel and "0.3 percentage points" in another. Mirrors
 * position-size-explain.ts's discipline (measured, not asserted) but lives in
 * app/_components because it's presentation, not domain logic.
 */

/** Below this, a volatility delta is noise relative to the engine's own 1-decimal rounding, not a real change. */
const RISK_NEGLIGIBLE_PP = 0.3;

export function describeRiskDelta(riskDelta: number | null): string {
  if (riskDelta == null) return "N/A";
  if (Math.abs(riskDelta) < RISK_NEGLIGIBLE_PP) return "No material change";
  return `${riskDelta > 0 ? "+" : ""}${riskDelta.toFixed(1)}pp ${riskDelta > 0 ? "increase" : "decrease"}`;
}

export function riskTone(riskDelta: number | null): "positive" | "negative" | undefined {
  if (riskDelta == null || Math.abs(riskDelta) < RISK_NEGLIGIBLE_PP) return undefined;
  return riskDelta < 0 ? "positive" : "negative";
}

export function describeDiversification(diversificationDelta: number): string {
  if (Math.abs(diversificationDelta) < 5) return "No material change";
  return diversificationDelta < 0 ? "Improves" : "Concentrates";
}

// A local `alignmentTone` helper was removed here (2026-08-17 ruling 3): it
// had no callers and rendered <55 as negative, contradicting the canonical
// `alignmentToneOf` in lib/portfolio/alignment/engine.ts (alignment is a fit
// diagnostic, not a directional call — its severity ceiling is warning).
