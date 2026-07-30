"use client";

import { useState } from "react";
import { Card, Badge } from "@/app/_components/ui";
import type { HealthDimension, HealthScore, ScoreTrend } from "@/lib/portfolio/engines/health";

/**
 * The Universal Portfolio Health Score.
 *
 * The engine's own honesty rule — dimensions ABSTAIN rather than fabricating a 50
 * for a question that does not apply — is preserved and rendered explicitly.
 *
 * ── What changed, and why ─────────────────────────────────────────────────────
 *
 * This panel used to render all twelve dimensions as one flat list of bars in
 * declaration order. On a real book that produced twelve near-identical green bars
 * (89, 90, 83, 100, 36, 32, 55, 59, 87, 80, 93, 71), each with a sentence beneath
 * it, ordered so that the two genuinely poor dimensions sat fifth and sixth.
 *
 * Two problems, both of them about decisions rather than aesthetics:
 *
 *  1. THE VISUAL SIGNAL WAS BACKWARDS. Ten green bars and two amber ones read as
 *     "everything is fine", when the honest summary was "two dimensions are poor
 *     and ten are good". Colour was arguing against the content.
 *
 *  2. IT WAS A SCORECARD, NOT A TO-DO LIST. An investor does not need to read
 *     twelve rows to learn that Inflation Protection is 32. They need the weak
 *     dimensions first, the strong ones available but out of the way, and — for
 *     each weakness — the sentence explaining what is actually wrong.
 *
 * So dimensions are now TRIAGED by score: what needs attention, what is adequate,
 * what is strong. Strong dimensions collapse behind a summary, because "this is
 * fine" needs one line, not five. Ordering is by severity within each band, which
 * means the first thing on screen is always the thing most worth fixing.
 */

const GRADE_TONE: Record<string, string> = {
  A: "text-positive",
  B: "text-positive",
  C: "text-foreground",
  D: "text-warning",
  F: "text-negative",
};

/**
 * Bar tone per dimension, keyed off the engine's own `trend` classification
 * (health.ts's trendOf()) rather than a second score-band guess in the UI.
 */
const TREND_TONE: Record<ScoreTrend, string> = {
  strong: "bg-positive",
  good: "bg-positive",
  neutral: "bg-muted",
  weak: "bg-warning",
  poor: "bg-negative",
};

/**
 * Triage bands.
 *
 * Both boundaries are lifted verbatim from the engine's own `trendOf()` — 45 is
 * where it stops calling a dimension "weak", and 78 is where it starts calling one
 * "strong" — rather than introducing a third set of thresholds in the UI. A
 * dimension the engine colours amber must not be filed under "adequate" here, which
 * is exactly how two surfaces end up disagreeing about the same number.
 *
 * The middle band therefore spans trendOf's "neutral" and "good" together, which is
 * the intent: both mean "fine, not remarkable", and splitting them would give the
 * user three lists to read instead of two.
 */
const NEEDS_ATTENTION_BELOW = 45;
const STRONG_AT_OR_ABOVE = 78;

type Band = "attention" | "adequate" | "strong";

function bandOf(score: number): Band {
  if (score < NEEDS_ATTENTION_BELOW) return "attention";
  if (score >= STRONG_AT_OR_ABOVE) return "strong";
  return "adequate";
}

function DimensionRow({ d, emphasis }: { d: HealthDimension; emphasis: boolean }) {
  const score = d.score!;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate ${emphasis ? "text-xs font-medium text-foreground" : "text-xs text-foreground"}`}>
          {d.name}
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          {/* Effective weight, after redistribution — so the user can see how much
              this dimension actually counted toward the total. */}
          <span
            className="font-mono text-[10px] tabular-nums text-muted/60"
            title={`This dimension carried ${(d.effectiveWeight * 100).toFixed(0)}% of the total score${
              d.coverage < 1 ? `, discounted because it rests on ${(d.coverage * 100).toFixed(0)}% of portfolio value` : ""
            }.`}
          >
            {(d.effectiveWeight * 100).toFixed(0)}%
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{score}</span>
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${TREND_TONE[d.trend!]}`} style={{ width: `${score}%` }} />
      </div>
      {/* The explanation is the actionable part, so it is always shown for a
          weakness and only on demand for a strength. */}
      {emphasis && <p className="text-[11px] leading-snug text-muted/70">{d.explanation}</p>}
    </li>
  );
}

export function HealthPanel({ health }: { health: HealthScore }) {
  const [showStrong, setShowStrong] = useState(false);

  const scored = health.dimensions.filter((d) => d.score != null);
  const abstained = health.dimensions.filter((d) => d.score == null);

  // Weakest first within every band: the first row on screen is always the one
  // most worth acting on.
  const bySeverity = [...scored].sort((a, b) => a.score! - b.score!);
  const attention = bySeverity.filter((d) => bandOf(d.score!) === "attention");
  const adequate = bySeverity.filter((d) => bandOf(d.score!) === "adequate");
  const strong = bySeverity.filter((d) => bandOf(d.score!) === "strong");

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Portfolio health
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{health.summary}</p>
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className={`font-mono text-3xl font-bold tabular-nums ${GRADE_TONE[health.grade]}`}>
            {health.total}
          </span>
          <span className={`font-mono text-lg font-bold ${GRADE_TONE[health.grade]}`}>
            {health.grade}
          </span>
        </div>
      </div>

      {/* ── Needs attention ── */}
      {attention.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/25 bg-warning/[0.04] p-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">
            Needs attention ({attention.length})
          </span>
          <ul className="flex flex-col gap-2.5">
            {attention.map((d) => <DimensionRow key={d.name} d={d} emphasis />)}
          </ul>
        </div>
      )}

      {/* ── Adequate ── */}
      {adequate.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            Adequate ({adequate.length})
          </span>
          <ul className="flex flex-col gap-2.5">
            {adequate.map((d) => <DimensionRow key={d.name} d={d} emphasis />)}
          </ul>
        </div>
      )}

      {/* ── Strong: one line, expandable ──────────────────────────────────────
          "This is fine" is worth one line, not five. Collapsing the strong
          dimensions is what makes the weak ones visible at a glance, and the
          scores stay listed so nothing is hidden. */}
      {strong.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowStrong((v) => !v)}
            aria-expanded={showStrong}
            className="flex items-baseline justify-between gap-2 text-left"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-positive">
              Strong ({strong.length}) {showStrong ? "▲" : "▼"}
            </span>
            {/* A range, not seven truncated names. Splitting each label on its
                first word produced "Expected 80 · Asset 89" — abbreviations that
                cost the reader more than the scores were worth. The useful summary
                of a collapsed group of strengths is simply how strong they are. */}
            {!showStrong && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted/60">
                {strong.length === 1
                  ? `scoring ${strong[0].score}`
                  : `scoring ${strong[0].score}–${strong[strong.length - 1].score}`}
              </span>
            )}
          </button>
          {showStrong && (
            <ul className="flex flex-col gap-2.5">
              {strong.map((d) => <DimensionRow key={d.name} d={d} emphasis={false} />)}
            </ul>
          )}
        </div>
      )}

      {abstained.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/30 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            Not applicable ({abstained.length}) — weight redistributed, not scored 50
          </span>
          <ul className="flex flex-col gap-1">
            {abstained.map((d) => (
              <li key={d.name} className="text-[11px] leading-snug">
                <span className="text-foreground">{d.name}</span>
                <span className="text-muted/70"> — {d.explanation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Badge variant="neutral">{health.coveragePct}% of scoring weight applicable</Badge>
      </div>
    </Card>
  );
}
