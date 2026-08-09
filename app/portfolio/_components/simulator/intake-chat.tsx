"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Button, Input, TaskProgress } from "@/app/_components/ui";
import { useToast } from "@/app/_components/toast";
import type { IntakeQuestion, IntakeStep } from "@/lib/portfolio/simulator/intake";
import type { SimFollowUp, SimProfile, Simulation } from "@/lib/portfolio/simulator/types";

/**
 * The follow-up interview — now exception handling, not the interview.
 *
 * The standard intake topics moved into the quick form as multiple-choice
 * questions (lib/portfolio/simulator/preferences.ts), so most profiles reach
 * this component and complete immediately with nothing to ask. What arrives here
 * is a contradiction between two answers the user gave, which cannot be asked
 * before the answers exist.
 *
 * Two things about it changed with that:
 *
 *   - **Questions carry options.** The one follow-up ever observed in the wild
 *     was open-ended, and the user skipped it rather than compose prose about
 *     asset allocation. Free text is now the degraded path, used only when a model
 *     ignores the contract.
 *   - **The wait has a clock.** A turn was measured at 195 seconds behind a
 *     pulsing "Deciding what to ask next" with no elapsed time and no bound, sat
 *     next to a prominent "Finish now — use defaults". Abandoning was the rational
 *     move. The server now bounds the call and `TaskProgress` shows the elapsed
 *     time, which is the one number that is always true.
 *
 * The transcript is not component state: it is a pure render of
 * `profile.followUps` (persisted after every turn via PATCH) plus the one
 * pending question. Refreshing the page mid-interview therefore resumes
 * exactly where the user left off, because there is nothing to lose.
 */
export function IntakeChat({
  sim,
  onSimChanged,
  onCompleted,
}: {
  sim: Simulation;
  /** Fired with the fresh row after every persisted turn. */
  onSimChanged: (sim: Simulation) => void;
  /** Fired when the profile is marked complete. */
  onCompleted: (sim: Simulation) => void;
}) {
  const [pending, setPending] = useState<IntakeQuestion | null>(null);
  const [thinking, setThinking] = useState(false);
  /** When the current turn's request began, for the elapsed clock. */
  const [thinkingSince, setThinkingSince] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const toast = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const profile = sim.profile;
  const answered = profile.followUps.length;

  const patchProfile = useCallback(
    async (next: SimProfile): Promise<Simulation> => {
      const res = await fetch(`/api/portfolio/simulator?id=${encodeURIComponent(sim.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save your answer");
      return json.simulation as Simulation;
    },
    [sim.id],
  );

  const complete = useCallback(
    async (next: SimProfile) => {
      try {
        const updated = await patchProfile({ ...next, intakeComplete: true });
        onCompleted(updated);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Failed to complete intake", "error");
      }
    },
    [patchProfile, onCompleted, toast],
  );

  const fetchNext = useCallback(
    async (forProfile: SimProfile) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setThinking(true);
      setThinkingSince(Date.now());
      setError(null);
      try {
        const res = await fetch("/api/portfolio/simulator/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: forProfile }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) {
          setError({
            message: json.error ?? "The interviewer is not responding",
            offline: json.code === "ai_unavailable",
          });
          return;
        }
        const step = json.step as IntakeStep;
        if (step.done) await complete(forProfile);
        else setPending(step);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError({ message: e instanceof Error ? e.message : "Intake request failed", offline: false });
      } finally {
        if (abortRef.current === controller) setThinking(false);
      }
    },
    [complete],
  );

  // Kick off (or resume) the interview on mount. StrictMode's dev
  // double-mount runs effect → cleanup → effect: the cleanup aborts the first
  // request AND resets the guard, so the second run re-fires. (Resetting is
  // load-bearing — a guard that stays latched across the cleanup leaves the
  // aborted first request as the only one ever made: a dead interview.)
  // The server observes the abort and cancels its AI call, so the dev
  // double-mount costs one aborted HTTP request, not two model generations.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void fetchNext(profile);
    return () => {
      startedRef.current = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only kickoff; later turns are driven by submit/skip
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [answered, pending, thinking]);

  async function submitTurn(followUp: SimFollowUp) {
    if (!pending || saving) return;
    setSaving(true);
    try {
      const next: SimProfile = { ...profile, followUps: [...profile.followUps, followUp] };
      const updated = await patchProfile(next);
      onSimChanged(updated);
      setPending(null);
      setDraft("");
      void fetchNext(updated.profile);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save your answer", "error");
    } finally {
      setSaving(false);
    }
  }

  /** Record an answer, preserving the options it was chosen from. */
  const record = (text: string) => {
    if (!pending) return;
    void submitTurn({
      question: pending.question,
      answer: text,
      assumption: null,
      ...(pending.options.length > 0 ? { options: pending.options } : {}),
    });
  };

  const answer = () => {
    const text = draft.trim();
    if (text) record(text);
  };

  const skip = () => {
    if (!pending) return;
    void submitTurn({
      question: pending.question,
      answer: null,
      assumption: pending.assumptionIfSkipped,
      ...(pending.options.length > 0 ? { options: pending.options } : {}),
    });
  };

  // A `gap` question's remaining count is COUNTED, not estimated, so it is stated
  // exactly. The model's own estimate is not: it was measured returning 3 on every
  // turn regardless of history, so "of ~M" is the most it can honestly claim.
  const estTotal = answered + 1 + (pending?.estimatedRemaining ?? 0);
  const exact = pending?.source === "gap";

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-foreground">Building your profile</h3>
          <p className="text-[11px] text-muted">
            {pending || thinking
              ? `Question ${answered + 1} of ${exact ? "" : "~"}${estTotal} — only what the form could not settle`
              : `${answered} follow-up${answered === 1 ? "" : "s"} recorded`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void complete(profile)} disabled={saving}>
          Finish now — use defaults for the rest
        </Button>
      </div>

      <div className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
        {profile.followUps.map((f, i) => (
          <div key={i} className="flex flex-col gap-2">
            <AiBubble>{f.question}</AiBubble>
            {f.answer !== null ? (
              <UserBubble>{f.answer}</UserBubble>
            ) : (
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-sm border border-border bg-surface-2/60 px-4 py-2 text-xs italic text-muted">
                  Skipped — assuming: {f.assumption}
                </p>
              </div>
            )}
          </div>
        ))}

        {pending && (
          <div className="flex flex-col gap-2">
            <AiBubble>{pending.question}</AiBubble>
            {/* Options, not a prompt to write prose. The only follow-up ever seen
                in production was open-ended and was skipped. */}
            {pending.options.length > 0 && (
              <div className="flex flex-col gap-1">
                {pending.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={saving}
                    onClick={() => record(o)}
                    className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs leading-relaxed text-muted transition-colors hover:border-brand/40 hover:text-foreground disabled:opacity-60"
                  >
                    <span aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
                    <span>{o}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="pl-6 text-[11px] text-muted/80">
              If you skip: <span className="italic">{pending.assumptionIfSkipped}</span>
            </p>
          </div>
        )}

        {/* An elapsed clock, not an unlabelled pulse. This wait was measured at
            195 seconds; with no number on it, "Finish now — use defaults" was the
            only sensible thing for a user to press. */}
        {thinking && (
          <TaskProgress
            label="Checking whether anything is still missing"
            detail="Most profiles need nothing here — the form already answered the standard questions."
            startedAt={thinkingSince}
          />
        )}

        {error && (
          <div className="flex flex-col gap-2 rounded-lg border border-negative/25 bg-negative/5 p-3">
            <p className="text-xs text-negative">{error.message}</p>
            <div className="flex gap-2">
              <Button size="xs" variant="secondary" onClick={() => void fetchNext(profile)}>
                Retry
              </Button>
              {error.offline && (
                <Button size="xs" variant="ghost" onClick={() => void complete(profile)}>
                  Finish with stated defaults
                </Button>
              )}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Free text is the "Other" row when there are options, and the whole input
          when a model returned none. Either way it sits below the choices rather
          than in place of them. */}
      {pending && !thinking && (
        <div className="flex items-center gap-2 border-t border-border/60 pt-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) answer();
            }}
            placeholder={
              pending.options.length > 0 ? "Or type your own answer…" : "Type your answer…"
            }
            disabled={saving}
            autoFocus={pending.options.length === 0}
            aria-label={pending.question}
          />
          <Button variant="primary" size="md" onClick={answer} disabled={saving || !draft.trim()}>
            {saving ? "Saving…" : "Send"}
          </Button>
          <Button variant="ghost" size="md" onClick={skip} disabled={saving} title={`Skip — ${pending.assumptionIfSkipped}`}>
            Skip
          </Button>
        </div>
      )}
    </Card>
  );
}

function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="text-brand">◆</span>
        <span className="font-medium">Portfolio Architect</span>
      </div>
      <p className="max-w-[85%] text-sm leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-strong/15 px-4 py-2.5 text-sm text-foreground">
        {children}
      </div>
    </div>
  );
}
