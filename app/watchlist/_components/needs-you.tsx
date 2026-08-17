"use client";

/**
 * Needs You — the open DECISIONS on your ideas, ranked.
 *
 * Deliberately disjoint from the Pulse brief above it: the pulse owns "what
 * happened" (targets crossed, alerts fired, filings landed — market events);
 * this strip owns "what are you sitting on" (a thesis with no decision,
 * research with no view, an idea going stale, a trigger that hit). The two
 * must never report the same fact, or the page becomes six lists again.
 *
 * Every entry is derived: kind ranking + relevance-engine priority +
 * idleness, computed in lib/ideas/evidence.ts (`rankNeedsYou`). Acting on an
 * entry clears it by changing the underlying state — there is no dismiss,
 * because none of these items is noise; they are the user's own unfinished
 * decisions.
 */

import type { NeedsYouInput } from "@/lib/ideas/evidence";
import { NextActionButton, type IdeaActHandler } from "./next-action-button";

const CAP = 5;

export function NeedsYou({
  entries,
  total,
  onAct,
  onOpen,
}: {
  /** Already ranked by `rankNeedsYou`; this component only caps and renders. */
  entries: NeedsYouInput[];
  /** Uncapped count, so "and N more" is honest. */
  total: number;
  onAct: IdeaActHandler;
  /** Open the idea's row/card (the entry surface for context before acting). */
  onOpen: (symbol: string) => void;
}) {
  if (total === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted/60">Needs you</span>
        <span className="ml-3 text-xs text-muted">
          You&rsquo;re clear — no open decisions on your ideas.
        </span>
      </div>
    );
  }

  const visible = entries.slice(0, CAP);
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted/60">
          Needs you <span className="ml-1 font-mono tabular-nums text-faint">{total}</span>
        </h2>
        <p className="text-[10px] text-faint">Open decisions on your ideas — from evidence, not alerts</p>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {visible.map((e) => (
          <li
            key={e.symbol}
            className="flex min-w-0 flex-col gap-1.5 rounded-control border border-hairline bg-surface-2/50 p-2.5"
          >
            <button
              type="button"
              onClick={() => onOpen(e.symbol)}
              className="flex min-w-0 items-baseline gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              title={`Open ${e.symbol}`}
            >
              <span className="font-mono text-[13px] font-semibold text-foreground">{e.symbol}</span>
              <span className="truncate text-[10px] text-faint">{e.name}</span>
            </button>
            <p className="line-clamp-2 min-h-[2em] text-[11px] leading-snug text-muted">{e.action.detail}</p>
            <NextActionButton action={e.action} symbol={e.symbol} onAct={onAct} className="self-start" />
          </li>
        ))}
      </ul>
      {total > CAP ? (
        <p className="mt-2 text-[10px] text-faint">
          and {total - CAP} more below — sort the table by <span className="text-muted">Next action</span> to work
          through them.
        </p>
      ) : null}
    </div>
  );
}
