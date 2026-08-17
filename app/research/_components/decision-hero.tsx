"use client";

import { useCallback, useRef, type PointerEvent } from "react";
import type { InvestmentVerdict } from "@/app/api/ai/verdict/route";
import type { Recommendation } from "@/lib/types";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, scoreDirection } from "@/lib/recommendation";
import { CountUp } from "@/app/_components/count-up";
import { LoadingMark } from "@/app/_components/loading-mark";
import { Reveal } from "@/app/_components/reveal";
import { TaskProgress } from "@/app/_components/ui";
import { GroundingBadge } from "@/app/_components/grounding-badge";

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
 * The `stage` line is a real progress statement, and the elapsed clock ticks
 * from `startedAt` — it must never freeze during the silent phases (readiness
 * gate, data assembly, time-to-first-token), which are exactly the waits it
 * exists to describe.
 *
 * Copy note: the verdict reasons over the fundamentals, the computed score,
 * analyst consensus, momentum, risk flags, and recent headlines. It does NOT
 * read filing documents — filings metadata is fetched for the page, but no
 * filing text enters the verdict prompt — so the copy must not claim it does.
 */
function Skeleton({ stage, startedAt }: { stage: string; startedAt: number | null }) {
  return (
    <div className="flex min-h-[184px] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface p-8">
      <LoadingMark size={30} label="Building the investment verdict" />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-medium text-foreground">Building the investment verdict</p>
        <p className="text-caption text-muted">
          Reasoning over the fundamentals, score, analyst views, momentum, and recent news — typically
          5–10 s depending on the model.
        </p>
      </div>
      <StreamStatus stage={stage} startedAt={startedAt} />
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
 *
 * `startedAt` (not a pre-computed `elapsedMs`) so TaskProgress ticks its own
 * clock every second: an event-driven elapsed figure only updates when stream
 * frames arrive, which froze the counter at 0:00 through the whole silent
 * phase before the first frame.
 */
function StreamStatus({ stage, startedAt }: { stage: string; startedAt: number | null }) {
  return <TaskProgress className="mt-4" label={stage} startedAt={startedAt} />;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface Props {
  verdict: InvestmentVerdict | null;
  loading: boolean;
  /**
   * THE canonical headline call — the deterministic composite score and its
   * recommendation, computed once (lib/scoring.ts or the asset-class scorer,
   * screener.in snapshot for India) and shared with the Conviction tab. The
   * hero renders this; the AI verdict word is only a fallback when no score
   * exists (e.g. macro).
   */
  headlineScore?: { composite: number; recommendation: Recommendation } | null;
  /** Data confidence (0–100) — metadata about input completeness, NOT
   *  conviction. Rendered as a small labelled line, never as a headline. */
  dataConfidence?: number | null;
  /** Which fields have streamed in. Omit to treat the verdict as complete. */
  received?: ReadonlySet<string>;
  /** True while more fields are still arriving. */
  streaming?: boolean;
  /** Epoch ms the current wait began (gate included). Drives a self-ticking
   *  elapsed clock; null when nothing is pending. */
  startedAt?: number | null;
  /** Generation failed. Shown inline so a partial report keeps its content. */
  error?: string | null;
  onRetry?: () => void;
}

export function DecisionHero({
  verdict,
  loading,
  headlineScore,
  dataConfidence,
  received,
  streaming = false,
  startedAt = null,
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

  // The deterministic call NEVER waits on the AI.
  //
  // This used to read `if (loading || (!verdict && streaming))` → full-page
  // skeleton, which meant the composite score and its recommendation — already
  // computed and already on the client from the research bundle (~0.6s) — were
  // hidden behind a spinner until the model's first field landed. The page's
  // single most important answer was gated on its least reliable input.
  //
  // Now the skeleton is only for the case where there is genuinely nothing to
  // show: no score AND no verdict. Whenever a score exists the hero renders
  // immediately with the real call, and the AI's prose shimmers in around it
  // (see `pending`, below). If the AI never arrives, the hero is still correct
  // and complete — it just has no narration.
  const pending = loading || streaming;
  if (!verdict && !headlineScore) {
    if (pending) {
      return (
        <Skeleton
          stage="Analyzing the data and writing the investment verdict…"
          startedAt={startedAt}
        />
      );
    }
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
  // A null verdict (score-only hero, AI still working or failed) has nothing.
  const has = (id: string) => (verdict ? (received ? received.has(id) : true) : false);
  // Color follows the CANONICAL direction: the score's tier when a score
  // exists, the AI verdict word only when there is nothing to compute from.
  const direction = headlineScore ? scoreDirection(headlineScore.composite) : verdict!.verdict;
  const c = COLORS[direction];
  /**
   * The AI half will not arrive.
   *
   * Two shapes reach here. Either nothing streamed at all (`!has("thesis")`
   * once pending has cleared — the router's wall-clock budget guarantees that
   * happens within `budgetMs` rather than never), or the server sent its
   * offline fallback, whose `model` is the sentinel "unavailable".
   *
   * The second case matters for the UI: that fallback's `catalysts`/`risks`
   * are recovery instructions ("No AI provider reachable"), not investment
   * evidence, and rendering them under "What supports it" / "What worries me"
   * states something false about the company. Both cases collapse to one
   * honest line, and the deterministic score above is untouched either way.
   */
  const aiUnavailable = (!pending && !has("thesis")) || verdict?.model === "unavailable";
  /** Generated prose — suppressed wholesale when the AI half is unavailable. */
  const aiText = (id: string) => has(id) && !aiUnavailable;

  return (
    <div
      ref={heroRef}
      onPointerMove={onPointerMove}
      className={`uaa-cursor-sheen rounded-xl border ${c.border} ${c.bg} p-6`}
    >

      {/* ── Header row ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          {/* THE verdict + THE headline score — one call, one number, shared
              with the Conviction tab (both read the same ScoreResult). */}
          <div className="flex items-center gap-3">
            {headlineScore ? (
              <>
                <span className={`rounded-lg border px-3 py-1 text-sm font-bold uppercase tracking-widest ${RECOMMENDATION_TONE[headlineScore.recommendation]}`}>
                  {RECOMMENDATION_LABEL[headlineScore.recommendation]}
                </span>
                <span className={`font-mono text-2xl font-bold tabular-nums ${c.label}`}>
                  <CountUp value={headlineScore.composite} format={(v) => String(Math.round(v))} durationMs={800} />
                  <span className="text-base font-normal text-muted">/100</span>
                </span>
              </>
            ) : has("verdict") ? (
              <span className={`rounded-lg border px-3 py-1 text-sm font-bold uppercase tracking-widest ${c.badge}`}>
                {verdict!.verdict}
              </span>
            ) : (
              <span className="h-7 w-24 animate-pulse rounded-lg bg-surface-2" />
            )}
          </div>
          {/* Investment headline */}
          {aiText("headline") ? (
            <p className="text-base font-semibold leading-snug text-foreground">
              {verdict!.headline}
            </p>
          ) : aiUnavailable ? null : (
            <div className="h-4 w-64 animate-pulse rounded bg-surface-2" />
          )}
        </div>

        {/* Metadata rail — at most three lines, all label: value, all one case. */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {has("timeHorizon") && (
            <div className="flex items-center gap-3 text-caption">
              <span className="uppercase tracking-widest text-muted">Horizon</span>
              <span className="uppercase text-foreground">{verdict!.timeHorizon.replace("-", " ")}</span>
            </div>
          )}
          {dataConfidence != null && (
            <div className="flex items-center gap-3 text-caption" title="How complete the underlying data is — metadata, not conviction.">
              <span className="uppercase tracking-widest text-muted">Data confidence</span>
              <span className="font-mono uppercase tabular-nums text-foreground">{Math.round(dataConfidence)}/100</span>
            </div>
          )}
          {/* The verification layer's receipt: every figure in the prose above
              was traced back to the evidence block. This is the product's
              central claim — it belongs on the flagship verdict, not only on
              the copilot/IC/compare surfaces. */}
          {verdict?.grounding && <GroundingBadge grounding={verdict.grounding} />}
        </div>
      </div>

      {/* ── The central tension — the one line that earns the AI's place on
             this page. Everything else here restates or summarises data the
             user can see; this names the conflict between signals and says
             which side the verdict lands on. Given visual weight to match. ── */}
      {aiText("tension") && verdict!.tension.trim() !== "" && (
        <p className={`mb-4 border-l-2 ${c.border.replace("/20", "/50")} pl-3 text-sm font-medium leading-6 text-foreground`}>
          {verdict!.tension}
        </p>
      )}

      {/* ── Thesis ── */}
      {aiText("thesis") ? (
        <p className="mb-5 text-sm leading-6 text-foreground/90">
          {verdict!.thesis}
        </p>
      ) : aiUnavailable ? (
        // The score above is the real call and stands on its own. Say plainly
        // that only the narration is missing, rather than shimmering forever.
        <p className="mb-5 text-sm leading-6 text-muted">
          AI synthesis unavailable — the score, its breakdown, and all research below are computed
          locally and remain complete.
          {onRetry && (
            <button onClick={onRetry} className="ml-2 underline underline-offset-2 hover:text-foreground">
              Retry synthesis
            </button>
          )}
        </p>
      ) : (
        <div className="mb-5">
          <PendingLines widths={[100, 92, 68]} />
        </div>
      )}

      {/* ── Catalysts / Risks — top two per side. The FULL lists live on the
             Analysis tab (WhySection); the hero is the summary, not the copy. ── */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2.5 text-label font-semibold uppercase tracking-widest text-positive/70">
            What supports it
          </p>
          {aiText("catalysts") ? (
            <ul className="space-y-1.5">
              {verdict!.catalysts.slice(0, 2).map((cat, i) => (
                <Reveal key={i} as="li" index={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${c.bullet}`} />
                  {cat}
                </Reveal>
              ))}
            </ul>
          ) : aiUnavailable ? null : (
            <PendingLines widths={[80, 70, 60]} />
          )}
        </div>
        <div>
          <p className="mb-2.5 text-label font-semibold uppercase tracking-widest text-negative/70">
            What worries me
          </p>
          {aiText("risks") ? (
            <ul className="space-y-1.5">
              {verdict!.risks.slice(0, 2).map((risk, i) => (
                <Reveal key={i} as="li" index={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-negative/50" />
                  {risk}
                </Reveal>
              ))}
            </ul>
          ) : aiUnavailable ? null : (
            <PendingLines widths={[75, 65, 55]} />
          )}
        </div>
      </div>

      {/* ── What would change the verdict — the closing line, and the one the
             user can actually check next quarter. Deliberately last: it is what
             you carry away once the call itself has been read. ── */}
      {aiText("triggers") && verdict!.triggers.length > 0 && (
        <div className="mb-5 rounded-lg border border-border bg-surface/60 p-3">
          <p className="mb-2 text-label font-semibold uppercase tracking-widest text-muted">
            What changes the verdict
          </p>
          <ul className="space-y-1.5">
            {verdict!.triggers.slice(0, 2).map((t, i) => (
              <li key={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Key metrics strip — non-equity classes only. The equity prompt no
             longer requests it: those five figures are rendered as cards on
             this same page, so re-emitting them was cost without information. ── */}
      {(verdict?.keyMetrics.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {verdict!.keyMetrics.map((m, i) => (
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
        <StreamStatus stage="Still writing the rest of the report…" startedAt={startedAt} />
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
