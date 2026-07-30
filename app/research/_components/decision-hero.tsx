"use client";

import { useCallback, useRef, type PointerEvent } from "react";
import type { InvestmentVerdict } from "@/app/api/ai/verdict/route";
import type { ScoreResult } from "@/lib/types";
import { CountUp } from "@/app/_components/count-up";
import { ValueBar } from "@/app/_components/value-bar";
import { LoadingMark } from "@/app/_components/loading-mark";
import { Reveal } from "@/app/_components/reveal";

/* -------------------------------------------------------------------------- */
/* Verdict color palette                                                       */
/* -------------------------------------------------------------------------- */

const COLORS = {
  bullish: {
    label:  "text-positive",
    border: "border-positive/20",
    bg:     "bg-positive/5",
    badge:  "text-positive border-positive/40 bg-positive/10",
    bar:    "bg-positive",
    dot:    "bg-positive/70",
    bullet: "bg-positive/50",
  },
  bearish: {
    label:  "text-negative",
    border: "border-negative/20",
    bg:     "bg-negative/5",
    badge:  "text-negative border-negative/40 bg-negative/10",
    bar:    "bg-negative",
    dot:    "bg-negative/70",
    bullet: "bg-negative/50",
  },
  neutral: {
    label:  "text-warning",
    border: "border-warning/20",
    bg:     "bg-warning/5",
    badge:  "text-warning border-warning/40 bg-warning/10",
    bar:    "bg-warning",
    dot:    "bg-warning/70",
    bullet: "bg-warning/50",
  },
} as const;

const SIGNAL_CLASS = {
  positive: "text-positive",
  negative: "text-negative",
  neutral:  "text-muted",
} as const;

/* -------------------------------------------------------------------------- */
/* Loading skeleton                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The page's headline answer is worth waiting on explicitly — the brand mark
 * doing the work, plus what it's doing and roughly how long — rather than a
 * mosaic of grey bars implying content that is already there.
 */
function Skeleton() {
  return (
    <div className="flex min-h-[184px] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface p-8">
      <LoadingMark size={30} label="Building the investment verdict" />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-medium text-foreground">Building the investment verdict</p>
        <p className="text-caption text-muted">
          Reasoning over fundamentals, filings, and news — typically 20–40 s on a local model.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface Props {
  verdict: InvestmentVerdict | null;
  loading: boolean;
  /** Optional: score.confidence used to show numeric confidence when available */
  score?: ScoreResult | null;
  /** Overrides the numeric confidence (India uses the screener.in composite so
   *  the hero never shows the Yahoo score alongside the India snapshot). */
  confidenceOverride?: number | null;
}

export function DecisionHero({ verdict, loading, score, confidenceOverride }: Props) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  /** Cursor-aware sheen (see .uaa-cursor-sheen, app/globals.css) — the hero is
   *  the one surface deliberate enough to warrant a light that tracks the
   *  pointer; everywhere else stays still. rAF-throttled so it never runs
   *  more than once per frame. */
  const rafRef = useRef(0);
  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const el = heroRef.current;
    if (!el) return;
    cancelAnimationFrame(rafRef.current);
    const { clientX, clientY } = e;
    rafRef.current = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--spot-x", `${((clientX - rect.left) / rect.width) * 100}%`);
      el.style.setProperty("--spot-y", `${((clientY - rect.top) / rect.height) * 100}%`);
    });
  }, []);

  if (loading) return <Skeleton />;
  if (!verdict) return null;

  const c = COLORS[verdict.verdict];
  const confidenceNum = confidenceOverride ?? score?.confidence ?? null;

  return (
    <div
      ref={heroRef}
      onPointerMove={onPointerMove}
      className={`uaa-cursor-sheen rounded-xl border ${c.border} ${c.bg} p-6`}
    >

      {/* ── Header row ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          {/* Primary verdict label */}
          <div className="flex items-center gap-3">
            <span className={`rounded-lg border px-3 py-1 text-sm font-bold uppercase tracking-widest ${c.badge}`}>
              {verdict.verdict}
            </span>
            {confidenceNum != null && (
              <span className={`font-mono text-2xl font-bold tabular-nums ${c.label}`}>
                <CountUp value={confidenceNum} format={(v) => String(Math.round(v))} durationMs={800} />
                <span className="text-base font-normal text-muted">%</span>
              </span>
            )}
          </div>
          {/* Investment headline */}
          <p className="text-base font-semibold leading-snug text-foreground">
            {verdict.headline}
          </p>
        </div>

        {/* Metadata: confidence level + time horizon */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-3 text-caption">
            <span className="uppercase tracking-widest text-muted">Confidence</span>
            <span className={`font-semibold uppercase ${
              verdict.confidence === "high" ? "text-positive" :
              verdict.confidence === "medium" ? "text-warning" : "text-negative"
            }`}>
              {verdict.confidence}
            </span>
          </div>
          <div className="flex items-center gap-3 text-caption">
            <span className="uppercase tracking-widest text-muted">Horizon</span>
            <span className="text-foreground">{verdict.timeHorizon}</span>
          </div>
          {/* Confidence bar (numeric, when score available) */}
          {confidenceNum != null && (
            <div className="mt-1 flex items-center gap-2">
              <div className="w-28">
                <ValueBar value={confidenceNum} barClassName={c.bar} />
              </div>
              <span className="text-label text-muted tabular-nums">
                <CountUp value={confidenceNum} format={(v) => String(Math.round(v))} durationMs={800} />/100
              </span>
            </div>
          )}
          <span className="rounded-full border border-brand/25 bg-brand/8 px-2 py-0.5 text-micro font-semibold uppercase tracking-widest text-brand">
            Local AI
          </span>
        </div>
      </div>

      {/* ── Thesis ── */}
      <p className="mb-5 text-sm leading-6 text-foreground/90">
        {verdict.thesis}
      </p>

      {/* ── Catalysts / Risks ── */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2.5 text-label font-semibold uppercase tracking-widest text-positive/70">
            Why Own
          </p>
          <ul className="space-y-1.5">
            {verdict.catalysts.map((cat, i) => (
              <Reveal key={i} as="li" index={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${c.bullet}`} />
                {cat}
              </Reveal>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2.5 text-label font-semibold uppercase tracking-widest text-negative/70">
            Why Avoid
          </p>
          <ul className="space-y-1.5">
            {verdict.risks.map((risk, i) => (
              <Reveal key={i} as="li" index={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-negative/50" />
                {risk}
              </Reveal>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Key metrics strip ── */}
      {verdict.keyMetrics.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-white/5 pt-4">
          {verdict.keyMetrics.map((m, i) => (
            <div
              key={i}
              className="card-lift flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5"
            >
              <span className="text-caption text-muted">{m.label}</span>
              <span className={`font-mono text-caption font-semibold ${SIGNAL_CLASS[m.signal]}`}>
                {m.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
