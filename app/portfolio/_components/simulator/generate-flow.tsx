"use client";

import { useRef, useState } from "react";
import { Card, Button, TaskProgress, type TaskProgressStep } from "@/app/_components/ui";
import type { SimEvaluation } from "@/lib/portfolio/simulator/evaluate";
import type { Simulation } from "@/lib/portfolio/simulator/types";

/**
 * The five stages `generatePortfolio` actually runs, named as work rather than
 * as internals — and all five shown at once.
 *
 * A single bar captioned "Designing the asset-class allocation…" was accurate
 * and still misleading: it is stage one of five, and for the minutes it sits
 * there it looks like the whole job. Listing the stages makes the shape of the
 * wait visible, and makes a genuine stall distinguishable from slow progress.
 *
 * Nothing aspirational goes in this list. Each `id` is a real
 * `GenerationStage` the server emits, so a stage can never light up for work
 * that isn't happening.
 */
const STEPS: TaskProgressStep[] = [
  {
    id: "allocate",
    label: "Designing the asset-class allocation",
    detail: "The model adjusts the objective's strategic target for your answers.",
  },
  {
    id: "select",
    label: "Selecting the instruments for each class",
    detail: "Real tickers from the curated menu, with a reason for each.",
  },
  {
    id: "size",
    label: "Validating tickers against live quotes and sizing positions",
    detail: "Anything that cannot be priced is discarded here rather than saved.",
  },
  {
    id: "evaluate",
    label: "Scoring health, risk and stress scenarios",
    detail: "The same engines your real portfolio is scored with.",
  },
  {
    id: "narrate",
    label: "Writing the strategy summary",
    detail: "The thesis and the per-holding rationales.",
  },
];

interface ProgressState {
  stage: string;
  message: string;
  pct: number;
  startedAt: number;
}

/**
 * The generation step: a CTA that runs the pipeline and streams its staged
 * progress. Generation may take minutes on a busy local model — the staged
 * bar plus elapsed clock is the honest version of that wait.
 */
export function GenerateFlow({
  sim,
  regenerate,
  onGenerated,
  onCancel,
}: {
  sim: Simulation;
  /** True when holdings already exist and this run replaces them. */
  regenerate: boolean;
  onGenerated: (
    sim: Simulation,
    evaluation: SimEvaluation,
    fallbacks: string[],
    /** Picks the mandate's exclusions dropped — reported so a thin book is explained. */
    excluded: string[],
  ) => void;
  /** Only offered for a regenerate — a first run has nothing to go back to. */
  onCancel?: () => void;
}) {
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setCancelled(false);
    setProgress({ stage: "allocate", message: "Starting…", pct: 0, startedAt: Date.now() });

    try {
      const res = await fetch("/api/portfolio/simulator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sim.id }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Generation failed to start");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let settled = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "progress"; stage: string; message: string; pct: number }
            | {
                type: "result";
                simulation: Simulation;
                evaluation: SimEvaluation;
                fallbacks: string[];
                excluded?: string[];
              }
            | { type: "error"; message: string; code?: string };
          if (event.type === "progress") {
            setProgress((p) => ({
              stage: event.stage,
              message: event.message,
              pct: event.pct,
              startedAt: p?.startedAt ?? Date.now(),
            }));
          } else if (event.type === "result") {
            settled = true;
            onGenerated(event.simulation, event.evaluation, event.fallbacks, event.excluded ?? []);
          } else {
            settled = true;
            setError({ message: event.message, offline: event.code === "ollama_unavailable" });
            setProgress(null);
          }
        }
      }
      if (!settled) {
        // Stream ended without a result or an error event — connection drop.
        setError({ message: "The generation stream ended unexpectedly. Try again.", offline: false });
        setProgress(null);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError({ message: e instanceof Error ? e.message : "Generation failed", offline: false });
      setProgress(null);
    }
  }

  /**
   * Abandon the run in flight and go back to the editable state.
   *
   * The abort propagates: the route passes `request.signal` into
   * `generatePortfolio`, which checks it between stages and re-throws rather
   * than falling back, so cancelling actually frees the local model instead of
   * just hiding a request that keeps running. Nothing is persisted until a run
   * completes, so there is no half-written book to undo — and the profile lives
   * in the database, so every answer is still there to correct.
   *
   * Offered for a first run as much as for a regenerate: the case this exists
   * for is noticing a wrong number of zeros in Investable Cash ten seconds in,
   * and that is most likely on the very first attempt.
   */
  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(null);
    setError(null);
    setCancelled(true);
  }

  if (progress) {
    return (
      <Card className="flex flex-col gap-3 p-5">
        <h3 className="text-sm font-semibold text-foreground">
          {regenerate ? "Regenerating portfolio" : "Generating portfolio"}
        </h3>
        <TaskProgress
          label={progress.message}
          pct={progress.pct}
          startedAt={progress.startedAt}
          steps={STEPS}
          activeStepId={progress.stage}
          stepLayout="checklist"
          action={
            <Button variant="ghost" size="xs" onClick={stop}>
              Cancel
            </Button>
          }
        />
        <p className="text-[11px] leading-relaxed text-muted">
          Live quotes, history and fundamentals are fetched for every candidate, and the local
          model designs the book — a few minutes when the model is busy. Cancelling is safe:
          nothing is saved until the run finishes, and your answers are kept either way.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">
          {regenerate ? "Regenerate this portfolio" : "Generate the portfolio"}
        </h3>
        <p className="text-[11px] leading-relaxed text-muted">
          {regenerate
            ? "Designs a fresh book from the current profile and replaces the existing holdings. The saved profile itself is untouched."
            : "The AI designs an asset-class allocation for this mandate, selects real instruments, sizes them against live prices, and scores the result with the same health, risk and stress-test engines as your real portfolio."}
        </p>
      </div>

      {error && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-negative/25 bg-negative/5 p-3">
          <p className="text-xs text-negative">{error.message}</p>
          {error.offline && (
            <p className="text-[11px] text-muted">
              Generation needs the local model for allocation and selection — there is no
              defaults-only path that would still be advice-grade.
            </p>
          )}
        </div>
      )}

      {/* Cancelling is a neutral outcome, not a failure, so it is not styled as
          one. What it does need to say is that nothing was lost and where the
          answers are, since the whole reason to cancel is to go and fix one. */}
      {cancelled && !error && (
        <div className="rounded-lg border border-border/60 bg-surface/40 p-3">
          <p className="text-[11px] leading-relaxed text-muted">
            Generation cancelled — nothing was saved and your profile answers are unchanged.{" "}
            {regenerate ? (
              <>
                The existing holdings are untouched; <strong className="text-foreground">Keep
                current holdings</strong> returns to them, where <strong className="text-foreground">
                Profile</strong> reopens the answers.
              </>
            ) : (
              <>
                Use <strong className="text-foreground">Edit quick form</strong> above to correct an
                answer, then generate again.
              </>
            )}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="primary" size="md" onClick={run}>
          {error ? "Try again" : cancelled ? "Start again" : regenerate ? "Regenerate portfolio" : "Generate portfolio →"}
        </Button>
        {regenerate && onCancel && (
          <Button variant="ghost" size="md" onClick={onCancel}>
            Keep current holdings
          </Button>
        )}
      </div>
    </Card>
  );
}
