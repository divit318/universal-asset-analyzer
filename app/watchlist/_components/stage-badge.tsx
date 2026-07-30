"use client";

/**
 * The idea-lifecycle stage, rendered.
 *
 * Every watchlist row already carried a `stage` (§4.5) — the column, the CRUD,
 * the auto-transitions on buy/sell and the Pipeline board that edits it were all
 * shipped. The Watchlist, which is where a user actually decides that a name has
 * moved from "surfaced" to "researching", never displayed it. This is the
 * "shipped-but-unwired" pattern AGENTS.md warns about, so the column is now the
 * same object the Pipeline board writes to.
 *
 * The palette is a progression, not a judgement: a `passed` idea is a good
 * outcome (you looked and declined), so it reads muted rather than red.
 */

import { STAGE_LABEL } from "@/lib/idea-stage";
import type { IdeaStage } from "@/lib/types";

const STAGE_STYLE: Record<IdeaStage, string> = {
  surfaced: "border-border bg-surface-2 text-muted",
  researching: "border-brand/30 bg-brand/10 text-brand",
  thesis: "border-warning/30 bg-warning/10 text-warning",
  owned: "border-positive/30 bg-positive/10 text-positive",
  passed: "border-border bg-surface-2 text-muted/70",
  exited: "border-border bg-surface-2 text-muted/70",
};

const STAGE_HELP: Record<IdeaStage, string> = {
  surfaced: "On the list, not yet worked.",
  researching: "Actively being researched.",
  thesis: "A written thesis exists; waiting on price or catalyst.",
  owned: "Held in the portfolio.",
  passed: "Looked at and declined.",
  exited: "Position closed.",
};

export function StageBadge({ stage }: { stage: IdeaStage }) {
  return (
    <span
      title={STAGE_HELP[stage]}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STAGE_STYLE[stage]}`}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}
