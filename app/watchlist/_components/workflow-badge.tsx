"use client";

/**
 * The derived workflow state, rendered. Successor to the stage badge: the
 * value comes from lib/ideas/evidence.ts (evidence + the ledger), never from a
 * hand-maintained label, so the badge can no longer disagree with what the
 * user actually did.
 *
 * The palette is a progression, not a judgement — `passed` is a good outcome
 * (you looked and declined, with a reason on file), so it reads muted rather
 * than red. `working` is filled brand (effort is going in), `waiting` is the
 * outline of the same hue (armed, dormant), `ready` is warning because an
 * unmade decision is the one state that asks for the user.
 */

import { WORKFLOW_HELP, WORKFLOW_LABEL, type IdeaWorkflow } from "@/lib/ideas/evidence";

const STYLE: Record<IdeaWorkflow, string> = {
  new: "border-border bg-surface-2 text-muted",
  working: "border-brand/30 bg-brand/10 text-brand",
  ready: "border-warning/30 bg-warning/10 text-warning",
  waiting: "border-brand/40 bg-transparent text-brand/80",
  owned: "border-positive/30 bg-positive/10 text-positive",
  passed: "border-border bg-surface-2 text-muted/70",
  exited: "border-border bg-surface-2 text-muted/70",
};

export function WorkflowBadge({ workflow, className = "" }: { workflow: IdeaWorkflow; className?: string }) {
  return (
    <span
      title={WORKFLOW_HELP[workflow]}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STYLE[workflow]} ${className}`}
    >
      {WORKFLOW_LABEL[workflow]}
    </span>
  );
}
