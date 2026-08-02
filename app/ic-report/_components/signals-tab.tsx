"use client";

/**
 * IC Report — signals tab (Phase 5.13).
 *
 * Shows ALL evaluated signal checks: fired, passed, and could-not-evaluate.
 * Negative results are information. Each check carries its evidence source,
 * firing threshold and the numbers behind it, and fired signals trace to the
 * questions and agents they spawned (Phase 3.10).
 */

import type { SignalCheck } from "@/lib/ic-signals";
import { AGENT_LABELS, type InvestigativeQuestion } from "@/lib/ic-questions";
import { Card, SeverityChip, EmptyState } from "./shared";

export function SignalsTab({
  checks,
  questions,
}: {
  checks: SignalCheck[] | undefined;
  questions: InvestigativeQuestion[] | undefined;
}) {
  if (!checks || checks.length === 0) {
    return <EmptyState title="No signal checks yet" detail="Signal detection runs first; results appear within seconds of starting a report." />;
  }

  const fired = checks.filter((c) => c.fired);
  const passed = checks.filter((c) => c.evaluated && !c.fired);
  const unavailable = checks.filter((c) => !c.evaluated);
  const questionsBySignal = new Map<string, InvestigativeQuestion[]>();
  for (const q of questions ?? []) {
    for (const sid of q.sourceSignals) {
      const list = questionsBySignal.get(sid) ?? [];
      list.push(q);
      questionsBySignal.set(sid, list);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Fired signals">
        <h3 className="mb-3 text-sm font-semibold">
          Fired ({fired.length} of {checks.length} checks evaluated for this market)
        </h3>
        {fired.length === 0 ? (
          <p className="text-sm text-muted">No checks fired. That is a finding: the detectors below all evaluated clean.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {fired.map((c) => {
              const s = c.signal!;
              const qs = questionsBySignal.get(s.id) ?? [];
              return (
                <Card key={c.category}>
                  <div className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
                    <span className="font-medium">{c.label}</span>
                    <SeverityChip severity={s.severity} />
                  </div>
                  <p className="text-sm leading-5">{s.description}</p>
                  {s.dataPoints.length > 0 && (
                    <p className="mt-1.5 font-mono text-label text-muted">{s.dataPoints.join(" · ")}</p>
                  )}
                  <dl className="mt-2 space-y-0.5 border-t border-border pt-2 text-label text-muted">
                    <div><dt className="inline font-medium">Evidence: </dt><dd className="inline">{c.evidence}</dd></div>
                    <div><dt className="inline font-medium">Fires when: </dt><dd className="inline">{c.threshold}</dd></div>
                    {qs.length > 0 && (
                      <div>
                        <dt className="inline font-medium">Investigated by: </dt>
                        <dd className="inline">
                          {[...new Set(qs.flatMap((q) => q.assignedAgents))].map((a) => AGENT_LABELS[a]).join(", ")} ({qs.length} question{qs.length === 1 ? "" : "s"})
                        </dd>
                      </div>
                    )}
                  </dl>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section aria-label="Checks that passed">
        <h3 className="mb-3 text-sm font-semibold text-muted">Evaluated and passed ({passed.length})</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {passed.map((c) => (
            <div key={c.category} className="rounded-lg border border-border bg-surface px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-positive/40 bg-positive/10 text-label text-positive" aria-hidden="true">✓</span>
                <span className="text-sm font-medium">{c.label}</span>
              </div>
              <p className="mt-1 text-label leading-4 text-muted">Fires when: {c.threshold}</p>
            </div>
          ))}
        </div>
      </section>

      {unavailable.length > 0 && (
        <section aria-label="Checks that could not run">
          <h3 className="mb-3 text-sm font-semibold text-muted">Could not evaluate ({unavailable.length})</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unavailable.map((c) => (
              <div key={c.category} className="rounded-lg border border-dashed border-border bg-surface px-3 py-2.5">
                <span className="text-sm font-medium text-muted">{c.label}</span>
                <p className="mt-1 text-label leading-4 text-muted">{c.unavailableReason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {questions && questions.length > 0 && (
        <section aria-label="Generated questions">
          <h3 className="mb-3 text-sm font-semibold text-muted">
            Investigative questions ({questions.filter((q) => q.kind === "signal").length} signal-derived, {questions.filter((q) => q.kind === "baseline").length} standing checklist)
          </h3>
          <div className="space-y-2">
            {questions.map((q) => (
              <div key={q.id} className="flex gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                <div className="flex shrink-0 flex-col items-start gap-1">
                  <span
                    className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-label font-semibold uppercase ${
                      q.priority === "high" ? "bg-negative/10 text-negative" : q.priority === "medium" ? "bg-warning/10 text-warning" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {q.priority}
                  </span>
                  <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-label uppercase ${q.kind === "signal" ? "bg-brand/10 text-brand" : "bg-surface-2 text-muted"}`}>
                    {q.kind === "signal" ? "signal-derived" : "baseline"}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-muted">{q.question}</p>
                  <p className="mt-1 text-label text-muted">→ {q.assignedAgents.map((a) => AGENT_LABELS[a]).join(", ")}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
