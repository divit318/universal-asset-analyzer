/**
 * Alignment score → severity — the ONE place alignment severity lives
 * (2026-08-17 ruling 3), on the same 70/55 edges as `alignmentLabelOf` in
 * ./engine.ts (contract-tested together in tests/alignment-tone.test.ts).
 *
 * Alignment is a fit diagnostic, not a directional call, so its severity
 * ceiling is WARNING: rendering a Strained book as negative/red would assert
 * a market judgment the score never made (the same logic that keeps
 * non-banded quality chips from rendering red — see lib/score-kinds.ts).
 * "Mixed" (55-69) is neutral: the label already says the book and the policy
 * disagree in places; amber would double-count that as alarm.
 *
 * Every surface that colors an alignment score derives from this; none may
 * re-band it. Pure, zero-dependency, client-safe — kept out of ./engine.ts
 * so client components can import it without pulling the scenario engines.
 */
export type AlignmentTone = "positive" | "neutral" | "warning";

export function alignmentToneOf(score: number | null): AlignmentTone {
  if (score == null) return "neutral";
  if (score >= 70) return "positive";
  if (score >= 55) return "neutral";
  return "warning";
}
