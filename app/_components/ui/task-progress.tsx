"use client";

import { useEffect, useState } from "react";

/**
 * Honest progress for long-running local work.
 *
 * ## Why this is a shared primitive
 *
 * Every expensive thing in UAA runs on the user's own machine against a
 * long multi-stage pipeline, so waits are measured in tens of seconds to
 * minutes rather than milliseconds. The Scanner already solved this well —
 * named stage, percent, elapsed, remaining, and an estimated wall-clock finish
 * time — while every other slow surface showed an undifferentiated `animate-pulse`
 * that communicated nothing and was indistinguishable from a hung page.
 *
 * The difference between those two experiences is entirely presentational, so it
 * belongs in one component rather than in whichever page happened to care.
 *
 * ## The rules it encodes
 *
 * - **Never imply precision that does not exist.** With no `pct`, the bar is
 *   explicitly indeterminate rather than animating toward a fake target.
 * - **Always show elapsed.** It is the one number that is always true, and it is
 *   what tells a user "working" apart from "stuck".
 * - **Only show a remaining estimate when there is a basis for one.** A countdown
 *   invented from nothing is worse than no countdown.
 */

function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The current time, re-read once a second.
 *
 * A clock is an external system, so it is subscribed to in an effect and read
 * from state — never called during render. `Date.now()` in a render body is
 * impure: it makes the component's output depend on when React happened to
 * re-render it.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  return now;
}

/** A live-ticking elapsed counter. Restarts whenever `startedAt` changes. */
export function useElapsedMs(startedAt: number | null): number {
  const now = useNow(startedAt != null);
  return startedAt != null ? Math.max(0, now - startedAt) : 0;
}

export interface TaskProgressStep {
  id: string;
  label: string;
  /** Optional one-line "what this stage actually does", shown in checklist layout. */
  detail?: string;
  /** Optional one-line finding shown once the step is DONE (checklist layout) —
   *  e.g. "Bottleneck score: 8/10". Turns a progress list into a live summary. */
  result?: string;
}

/**
 * How `steps` is drawn.
 *
 * - `strip` (default): a row of thin segments. Right for work whose stages are
 *   interchangeable to the user — the Scanner's batches are all "more of the
 *   same", so naming each one buys nothing and costs vertical space.
 * - `checklist`: a labelled line per stage with its own state. Right when the
 *   stages are genuinely DIFFERENT pieces of work and the wait is long enough
 *   that "which part is this?" and "how much is left?" are real questions. A
 *   single bar reading "Designing the asset-class allocation…" for two minutes
 *   tells a user nothing about the four stages still to come, so it reads as one
 *   slow step rather than the first of five.
 */
export type TaskProgressStepLayout = "strip" | "checklist";

type StepState = "done" | "active" | "pending";

/** A stage's mark: settled check, live pulse, or an empty slot. */
function StepMark({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[9px] font-bold text-brand">
        ✓
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-brand opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      <span className="h-2 w-2 rounded-full border border-border" />
    </span>
  );
}

export interface TaskProgressProps {
  /** What is happening right now, in the user's language. */
  label: string;
  /** Optional extra detail from the worker (e.g. "Clustering 60 signals…"). */
  detail?: string | null;
  /** 0-100. Omit for indeterminate work — the bar will say so rather than lie. */
  pct?: number | null;
  /** Epoch ms the work began. Drives the elapsed counter. */
  startedAt?: number | null;
  /** Pre-computed elapsed ms, for callers that already track it (e.g. a stream). */
  elapsedMs?: number;
  /** Estimated ms still to go. Omit when there is no honest basis for an estimate. */
  remainingMs?: number | null;
  /** Ordered stages. Drawn per `stepLayout`. */
  steps?: TaskProgressStep[];
  /** Which step in `steps` is currently running. */
  activeStepId?: string | null;
  /** Defaults to `strip` so existing callers are untouched. */
  stepLayout?: TaskProgressStepLayout;
  /** Rendered beside the label — a Cancel control, typically. */
  action?: React.ReactNode;
  className?: string;
}

export function TaskProgress({
  label,
  detail,
  pct = null,
  startedAt = null,
  elapsedMs,
  remainingMs = null,
  steps,
  activeStepId = null,
  stepLayout = "strip",
  action,
  className = "",
}: TaskProgressProps) {
  // The clock ticks whenever there is a live elapsed or remaining figure to keep
  // current. `now` comes from state, never from a render-time Date.now().
  const now = useNow(startedAt != null || remainingMs != null);
  const elapsed = elapsedMs ?? (startedAt != null ? Math.max(0, now - startedAt) : 0);

  const completionTime =
    remainingMs != null
      ? new Date(now + remainingMs).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  const activeIndex = steps && activeStepId ? steps.findIndex((s) => s.id === activeStepId) : -1;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-sm text-muted">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
          <span className="truncate">
            <span className="font-medium text-foreground">{label}</span>
            {detail && detail !== label && <span className="text-muted"> — {detail}</span>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {pct != null && <span className="font-mono text-xs text-muted/60">{Math.round(pct)}%</span>}
          {action}
        </div>
      </div>

      {/* Determinate bar when we know the fraction; an indeterminate sweep when we
          don't. The sweep is deliberately not a fake percentage. */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
        {pct != null ? (
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-indeterminate rounded-full bg-brand/70" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted/70">
        <span>
          Elapsed <span className="font-mono text-foreground/80">{formatClock(elapsed)}</span>
        </span>
        {remainingMs != null && (
          <span>
            ~<span className="font-mono text-foreground/80">{formatClock(remainingMs)}</span> remaining
          </span>
        )}
        {completionTime && (
          <span>
            Est. completion <span className="font-mono text-foreground/80">{completionTime}</span>
          </span>
        )}
      </div>

      {steps && steps.length > 0 && stepLayout === "strip" && (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
          {steps.map((step, i) => {
            const done = activeIndex >= 0 && i < activeIndex;
            const active = step.id === activeStepId;
            return (
              <div
                key={step.id}
                className={`h-1 rounded-full transition-all ${
                  done ? "bg-brand" : active ? "animate-pulse bg-brand/60" : "bg-surface-3"
                }`}
                title={step.label}
              />
            );
          })}
        </div>
      )}

      {/* Every stage named, with its own state — so the four stages nobody has
          reached yet are visible as work still to come rather than absent. The
          list is `aria-live="polite"`: a screen reader is otherwise told only the
          headline label, which changes wording without saying that a stage
          finished. */}
      {steps && steps.length > 0 && stepLayout === "checklist" && (
        <ol className="flex flex-col gap-1.5" aria-live="polite">
          {steps.map((step, i) => {
            // A finished run (pct 100, past the last named stage) has to settle to
            // all-done; leaving the final stage pulsing forever reads as stuck.
            const complete = pct != null && pct >= 100;
            const state: StepState = complete
              ? "done"
              : activeIndex >= 0 && i < activeIndex
                ? "done"
                : step.id === activeStepId
                  ? "active"
                  : "pending";
            return (
              <li key={step.id} className="flex items-start gap-2">
                <span className="mt-px">
                  <StepMark state={state} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={`text-[11px] leading-relaxed ${
                      state === "active"
                        ? "font-medium text-foreground"
                        : state === "done"
                          ? "text-muted"
                          : "text-muted/50"
                    }`}
                  >
                    {step.label}
                  </span>
                  {step.detail && state === "active" && (
                    <span className="text-[10px] leading-relaxed text-muted/60">{step.detail}</span>
                  )}
                </span>
                {step.result && state === "done" && (
                  <span className="ml-auto min-w-0 shrink truncate pl-4 text-[11px] leading-relaxed text-muted/70">
                    {step.result}
                  </span>
                )}
                <span className="sr-only">
                  {state === "done" ? "complete" : state === "active" ? "in progress" : "pending"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
