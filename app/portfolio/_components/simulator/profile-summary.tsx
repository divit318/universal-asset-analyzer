"use client";

import { Card, Badge, Button } from "@/app/_components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { OBJECTIVES } from "@/lib/portfolio/engines/optimize";
import {
  PREFERENCE_QUESTIONS,
  answerLabel,
  isAnswered,
} from "@/lib/portfolio/simulator/preferences";
import type { Simulation } from "@/lib/portfolio/simulator/types";

const HORIZON_LABEL = { short: "Short (< 2 years)", medium: "Medium (2–7 years)", long: "Long (7+ years)" } as const;

/**
 * The completed investor profile — every fact the generated portfolio will be
 * designed against, including the assumptions the AI substituted for skipped
 * questions. Assumptions are rendered as loudly as answers: a portfolio built
 * on a default the user never saw is advice malpractice, not convenience.
 */
export function ProfileSummary({
  sim,
  onEditForm,
  onReopenIntake,
  busy,
}: {
  sim: Simulation;
  /** Re-open the Step A quick form. */
  onEditForm: () => void;
  /** Resume the Step B interview (marks the profile incomplete again). */
  onReopenIntake: () => void;
  busy: boolean;
}) {
  const p = sim.profile;
  const objective = OBJECTIVES[p.objective];
  // Assumptions from BOTH sources. A preference left blank in the form is exactly
  // as load-bearing as a skipped follow-up — the portfolio is built on a default
  // the user did not choose — so it is counted and shown the same way.
  const skippedFollowUps = p.followUps.filter((f) => f.answer === null);
  const prefRows = PREFERENCE_QUESTIONS.map((q) => {
    const a = p.preferences?.[q.topic];
    return isAnswered(a)
      ? { question: q.question, value: answerLabel(q.topic, a), assumed: false }
      : { question: q.question, value: q.defaultLabel, assumed: true };
  });
  const assumedCount = skippedFollowUps.length + prefRows.filter((r) => r.assumed).length;

  const facts: { label: string; value: string }[] = [
    { label: "Investable cash", value: formatCurrency(p.cash, p.currency) },
    // formatDate, not the raw ISO string: this is the one place the target date
    // is read back, and "2045-06-30" here beside "Jun 30, 2045" everywhere else
    // is the same inconsistency the entry field had.
    {
      label: "Horizon",
      value: `${HORIZON_LABEL[p.horizon]}${p.targetDate ? ` · ${formatDate(p.targetDate)}` : ""}`,
    },
    { label: "Objective", value: objective?.label ?? p.objective },
    { label: "Risk appetite", value: `${p.riskAppetite}/10 · max drawdown ~${p.maxDrawdownPct}%` },
    {
      label: "Role",
      value:
        p.role === "complement"
          ? `Complements ${p.complementRef?.kind === "real" ? "your real portfolio" : "a saved simulation"}`
          : "Standalone portfolio",
    },
  ];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Investor profile</h3>
          <Badge variant="positive">Complete</Badge>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onEditForm} disabled={busy}>
            Edit quick form
          </Button>
          <Button variant="ghost" size="sm" onClick={onReopenIntake} disabled={busy}>
            Resume questions
          </Button>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.label} className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-muted">{f.label}</dt>
            <dd className="text-sm text-foreground">{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Constraints and preferences
        </h4>
        <ul className="flex flex-col gap-2">
          {prefRows.map((r) => (
            <li key={r.question} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted">{r.question}</span>
              {r.assumed ? (
                <span className="text-sm italic text-warning">Assumed: {r.value}</span>
              ) : (
                <span className="text-sm text-foreground">{r.value}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {p.followUps.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Follow-up answers ({p.followUps.length})
          </h4>
          <ul className="flex flex-col gap-2">
            {p.followUps.map((f, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{f.question}</span>
                {f.answer !== null ? (
                  <span className="text-sm text-foreground">{f.answer}</span>
                ) : (
                  <span className="text-sm italic text-warning">Assumed: {f.assumption}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {assumedCount > 0 && (
        <p className="rounded-lg border border-warning/25 bg-warning/[0.04] px-3 py-2 text-[11px] leading-relaxed text-muted">
          {assumedCount} answer{assumedCount === 1 ? " was" : "s were"} skipped — the portfolio will
          be designed on the stated assumption{assumedCount === 1 ? "" : "s"} above. Edit the quick
          form any time to replace them with real answers.
        </p>
      )}
    </Card>
  );
}
