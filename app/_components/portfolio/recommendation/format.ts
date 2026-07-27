/**
 * Pure English-formatting helpers for numbers the engines already computed —
 * no new math, just consistent wording so the same delta doesn't read as
 * "+0.3pp" in one panel and "0.3 percentage points" in another. Mirrors
 * position-size-explain.ts's discipline (measured, not asserted) but lives in
 * app/_components because it's presentation, not domain logic.
 */

import type { HealthGrade } from "@/lib/portfolio/engines/health";

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

export const GRADE_TONE: Record<HealthGrade, "positive" | "negative" | undefined> = {
  A: "positive",
  B: "positive",
  C: undefined,
  D: "negative",
  F: "negative",
};
