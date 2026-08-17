"use client";

/**
 * The one thing that moves an idea forward, as a button.
 *
 * The label and grounds come from `nextActionFor` (lib/ideas/evidence.ts) —
 * deterministic, evidence-backed, one per idea. This component only maps the
 * action's KIND to an affordance and a tone; what actually happens on click is
 * the page's business (`onAct`), because the same kind opens different
 * surfaces depending on where the button lives.
 *
 * Only the kinds that ask for a decision carry colour; routine ones stay
 * quiet. `none` renders a plain dash — a terminal idea asks for nothing.
 */

import type { NextAction, NextActionKind } from "@/lib/ideas/evidence";

/** "pass" is a secondary affordance (never a computed next action), so the
 *  handler accepts it alongside the derived kinds. */
export type IdeaActHandler = (kind: NextActionKind | "pass", symbol: string) => void;

const TONE: Record<NextActionKind, string> = {
  decide: "border-warning/40 text-warning hover:bg-warning/10",
  review: "border-warning/40 text-warning hover:bg-warning/10",
  triage: "border-warning/30 text-warning/90 hover:bg-warning/10",
  research: "border-brand/40 text-brand hover:bg-brand/10",
  thesis: "border-brand/40 text-brand hover:bg-brand/10",
  monitor: "border-border text-muted hover:bg-surface-2 hover:text-foreground",
  portfolio: "",
  reconsider: "",
  none: "",
};

/**
 * Routine, non-asking kinds render as quiet text links rather than buttons:
 * a table with 23 owned rows otherwise shows 23 identical "Manage" buttons,
 * and a column of buttons that ask for nothing teaches the user to ignore
 * the column — which then mutes the four kinds that DO ask.
 */
const LINK_KINDS: NextActionKind[] = ["portfolio", "reconsider"];

export function NextActionButton({
  action,
  symbol,
  onAct,
  className = "",
}: {
  action: NextAction;
  symbol: string;
  onAct: IdeaActHandler;
  className?: string;
}) {
  if (action.kind === "none") {
    return (
      <span title={action.detail} className={`text-[11px] text-faint ${className}`}>
        —
      </span>
    );
  }
  if (LINK_KINDS.includes(action.kind)) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAct(action.kind, symbol);
        }}
        title={action.detail}
        className={`whitespace-nowrap rounded-control text-[11px] text-muted underline-offset-2 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
      >
        {action.label} →
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAct(action.kind, symbol);
      }}
      title={action.detail}
      className={`inline-flex items-center whitespace-nowrap rounded-control border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${TONE[action.kind]} ${className}`}
    >
      {action.label}
    </button>
  );
}
