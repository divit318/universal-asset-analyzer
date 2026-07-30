"use client";

import { useCallback, useRef, type PointerEvent } from "react";
import type { InvestmentVerdict } from "@/app/api/ai/verdict/route";
import type { ScoreResult } from "@/lib/types";
import { CountUp } from "@/app/_components/count-up";
import { ValueBar } from "@/app/_components/value-bar";
import { LoadingMark } from "@/app/_components/loading-mark";
import { Reveal } from "@/app/_components/reveal";
import { TaskProgress } from "@/app/_components/ui";

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
 *
 * Shown only before the first field arrives (~4s), not for the whole generation.
 * The `stage` line is a real progress statement from the stream, not a guess: it
 * reports elapsed time and what is being waited on.
 */
function Skeleton({ stage, elapsedMs }: { stage: string; elapsedMs: number }) {
  return (
    <div className="flex min-h-[184px] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface p-8">
      <LoadingMark size={30} label="Building the investment verdict" />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-medium text-foreground">Building the investment verdict</p>
        <p className="text-caption text-muted">
          Reasoning over fundamentals, filings, and news — typically 20–40 s on a local model.
        </p>
      </div>
      <StreamStatus stage={stage} elapsedMs={elapsedMs} />
    </div>
  );
}

/** Shimmer for a section that has not streamed yet. */
function PendingLines({ widths }: { widths: number[] }) {
  return (
    <div className="space-y-2">
      {widths.map((w, i) => (
        <div key={i} className="h-2.5 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/**
 * Progress for the verdict generation.
 *
 * `pct` is deliberately omitted: the report streams a variable number of
 * sections at model-dependent speed, so there is no honest completion fraction —
 * only the elapsed time and which sections have landed. `<TaskProgress>` renders
 * an indeterminate sweep for exactly this case rather than inventing a target.
 */
function StreamStatus({ stage, elapsedMs }: { stage: string; elapsedMs: number }) {
  return <TaskProgress className="mt-4" label={stage} elapsedMs={elapsedMs} />;
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
  /** Which fields have streamed in. Omit to treat the verdict as complete. */
  received?: ReadonlySet<string>;
  /** True while more fields are still arriving. */
  streaming?: boolean;
  /** Wall-clock ms of the current generation, for the progress line. */
  elapsedMs?: number;
  /** Generation failed. Shown inline so a partial report keeps its content. */
  error?: string | null;
  onRetry?: () => void;
}

export function DecisionHero({
  verdict,
  loading,
  score,
  confidenceOverride,
  received,
  streaming = false,
  elapsedMs = 0,
  error = null,
  onRetry,
}: Props) {
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

  if (loading || (!verdict && streaming)) {
    return (
      <Skeleton
        stage="Reading the filings and building the investment verdict…"
        elapsedMs={elapsedMs}
      />
    );
  }
  if (!verdict) {
    if (!error) return null;
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="text-sm text-muted">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-3 rounded-control border border-border px-3 py-1.5 text-caption text-foreground transition-colors hover:bg-surface-2"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  // When `received` is omitted the verdict is complete, so every field renders.
  const has = (id: string) => (received ? received.has(id) : true);
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
            {/* The call itself streams LAST (it is the model's conclusion), so
                until it lands this shows the numeric score's own tier rather
                than a placeholder "neutral" the model never said. */}
            {has("verdict") ? (
              <span className={`rounded-lg border px-3 py-1 text-sm font-bold uppercase tracking-widest ${c.badge}`}>
                {verdict.verdict}
              </span>
            ) : (
              <span className="h-7 w-24 animate-pulse rounded-lg bg-surface-2" />
            )}
            {confidenceNum != null && (
              <span className={`font-mono text-2xl font-bold tabular-nums ${c.label}`}>
                <CountUp value={confidenceNum} format={(v) => String(Math.round(v))} durationMs={800} />
                <span className="text-base font-normal text-muted">%</span>
              </span>
            )}
          </div>
          {/* Investment headline */}
          {has("headline") ? (
            <p className="text-base font-semibold leading-snug text-foreground">
              {verdict.headline}
            </p>
          ) : (
            <div className="h-4 w-64 animate-pulse rounded bg-surface-2" />
          )}
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
      {has("thesis") ? (
        <p className="mb-5 text-sm leading-6 text-foreground/90">
          {verdict.thesis}
        </p>
      ) : (
        <div className="mb-5">
          <PendingLines widths={[100, 92, 68]} />
        </div>
      )}

      {/* ── Catalysts / Risks ── */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2.5 text-label font-semibold uppercase tracking-widest text-positive/70">
            Why Own
          </p>
          {has("catalysts") ? (
            <ul className="space-y-1.5">
              {verdict.catalysts.map((cat, i) => (
                <Reveal key={i} as="li" index={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${c.bullet}`} />
                  {cat}
                </Reveal>
              ))}
            </ul>
          ) : (
            <PendingLines widths={[80, 70, 60]} />
          )}
        </div>
        <div>
          <p className="mb-2.5 text-label font-semibold uppercase tracking-widest text-negative/70">
            Why Avoid
          </p>
          {has("risks") ? (
            <ul className="space-y-1.5">
              {verdict.risks.map((risk, i) => (
                <Reveal key={i} as="li" index={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-negative/50" />
                  {risk}
                </Reveal>
              ))}
            </ul>
          ) : (
            <PendingLines widths={[75, 65, 55]} />
          )}
        </div>
      </div>

      {/* ── Key metrics strip ── */}
      {verdict.keyMetrics.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
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

      {/* Progress stays visible while later sections are still generating, so
          the user knows the report is incomplete rather than assuming it ended. */}
      {streaming && (
        <StreamStatus stage="Still writing the rest of the report…" elapsedMs={elapsedMs} />
      )}
      {error && !streaming && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-caption text-warning">
          <span>Generation stopped early — the sections above are complete.</span>
          {onRetry && (
            <button onClick={onRetry} className="underline underline-offset-2 hover:text-foreground">
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
