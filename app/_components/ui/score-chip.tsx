"use client";

import { useState } from "react";
import { scoreKind, type ScoreKindId } from "@/lib/score-kinds";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, scoreToRecommendation } from "@/lib/recommendation";

/**
 * A 0-100 score, rendered so it can never be confused with a different one.
 *
 * Three rules, all of them learned from what the app was doing before:
 *
 * 1. **Always named.** The number is shown with the label of its kind, never as a
 *    bare `NN/100` or as "Overall". Two engines' outputs sitting on adjacent
 *    pages under the same wordless presentation is what made the product look
 *    like it was contradicting itself.
 *
 * 2. **Always explainable.** The chip exposes its engine and inputs on demand, so
 *    a reader who sees two different numbers can find out why in one click rather
 *    than concluding one of them is wrong.
 *
 * 3. **Only banded when it is a call.** `fit`, `quality` and `health` are not
 *    Buy/Hold/Sell judgements, so they get no recommendation label — colouring a
 *    portfolio-fit of 45 as "Sell" would assert something the number never meant.
 *
 * Confidence, when supplied, is rendered as an explicit `NN% conf` suffix. It is
 * deliberately NOT `/{confidence}%`, which produced strings like "68/80%" that
 * read as a fraction in a column headed SCORE.
 */

export interface ScoreChipProps {
  kind: ScoreKindId;
  /** 0-100, or null for "no basis" — which is rendered as such, never as 50. */
  score: number | null;
  /** 0-100 data confidence, when the producing engine reports one. */
  confidence?: number | null;
  /** Short reasons from the engine, appended to the explainer. */
  why?: string[];
  size?: "sm" | "md" | "lg";
  /** Show the Buy/Hold/Sell label for banded kinds. Defaults to true. */
  showRecommendation?: boolean;
  /** Render the label next to the number. Defaults to true. */
  showLabel?: boolean;
  className?: string;
}

const SIZE = {
  sm: { num: "text-sm", suffix: "text-[10px]", label: "text-[10px]" },
  md: { num: "text-lg", suffix: "text-[11px]", label: "text-[11px]" },
  lg: { num: "text-3xl", suffix: "text-xs", label: "text-xs" },
} as const;

/** Tone for a non-banded score: neutral-to-positive, never a buy/sell signal. */
function neutralTone(score: number): string {
  if (score >= 65) return "text-positive";
  if (score >= 40) return "text-foreground";
  return "text-muted";
}

export function ScoreChip({
  kind,
  score,
  confidence = null,
  why,
  size = "md",
  showRecommendation = true,
  showLabel = true,
  className = "",
}: ScoreChipProps) {
  const [open, setOpen] = useState(false);
  const spec = scoreKind(kind);
  const s = SIZE[size];

  if (score == null) {
    return (
      <span
        className={`font-mono ${s.suffix} text-muted/50 ${className}`}
        title={`${spec.label}: no basis. ${spec.inputs}`}
      >
        no basis
      </span>
    );
  }

  const rec = spec.banded ? scoreToRecommendation(score) : null;
  const tone = spec.banded && rec ? RECOMMENDATION_TONE[rec].split(" ")[0] : neutralTone(score);

  const explainer = [
    `${spec.label} — ${spec.question}`,
    spec.inputs,
    `Produced by: ${spec.engine}.`,
    confidence != null ? `Data confidence ${confidence}%.` : null,
    why?.length ? why.join(". ") + "." : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <span className={`relative inline-flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          // The chip frequently sits inside a clickable row (Holdings, Screener),
          // and asking what a score means must not also expand or navigate that
          // row. Without this, the parent handler fires too and the popover is
          // closed by the same click that opened it.
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        title={explainer}
        className="inline-flex items-baseline gap-1.5 rounded-control outline-none transition-colors hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {showLabel && (
          <span className={`${s.label} uppercase tracking-widest text-muted`}>{spec.label}</span>
        )}
        <span className={`font-mono font-semibold tabular-nums ${s.num} ${tone}`}>{score}</span>
        <span className={`font-mono ${s.suffix} text-muted/50`}>/100</span>
        {confidence != null && (
          <span className={`font-mono ${s.suffix} tabular-nums text-muted/60`}>{confidence}% conf</span>
        )}
      </button>

      {showRecommendation && rec && (
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${RECOMMENDATION_TONE[rec]}`}
        >
          {RECOMMENDATION_LABEL[rec]}
        </span>
      )}

      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-2 w-80 animate-popover-in rounded-panel border border-border bg-surface p-3 text-left shadow-popover"
        >
          <span className="block text-[11px] font-semibold text-foreground">{spec.label}</span>
          <span className="mt-0.5 block text-[11px] text-muted">{spec.question}</span>
          <span className="mt-2 block text-[11px] leading-relaxed text-muted">{spec.inputs}</span>
          {why && why.length > 0 && (
            <span className="mt-2 block text-[11px] leading-relaxed text-foreground/80">
              {why.join(". ")}.
            </span>
          )}
          <span className="mt-2 block text-[10px] uppercase tracking-widest text-faint">
            {spec.engine}
            {confidence != null ? ` · ${confidence}% data confidence` : ""}
          </span>
          {!spec.banded && (
            <span className="mt-2 block text-[10px] leading-relaxed text-faint">
              This is not a buy or sell call.
            </span>
          )}
        </span>
      )}
    </span>
  );
}
