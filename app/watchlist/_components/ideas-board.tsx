"use client";

/**
 * The board view — the funnel of undecided capital, four columns of ACTIVE
 * ideas plus an outcomes rail.
 *
 * Successor to the portfolio's Idea Pipeline board, rebuilt on derived state:
 * columns are the evidence-derived workflow (never a hand-dragged label), so
 * a card moves by the user actually doing the work — researching, writing the
 * thesis, arming a trigger, buying, passing. There is deliberately no
 * drag-and-drop and no stage dropdown: the board is a read of reality with
 * one next action per card, not a place to curate labels.
 *
 * Owned/Passed/Exited are outcomes, not funnel stages. Owned names are
 * MANAGED in Portfolio → Decisions (this page never duplicates the trade
 * engine); passed names keep their journaled reason and a Reconsider
 * affordance; exited names are history.
 *
 * Cards render structure first (symbol, evidence, action — all local data);
 * relevance (impact, fit, the five questions) layers in when the assessments
 * arrive. The board never waits for the network.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { SymbolLinkRoot, SymbolTag } from "@/app/_home/_atmosphere/symbol-link";
import { ExplainableValue } from "@/app/_home/_atmosphere/explain-popover";
import {
  ACTIVE_WORKFLOWS,
  passReason,
  WORKFLOW_LABEL,
  WORKFLOW_QUESTION,
  type IdeaEvidence,
  type IdeaWorkflow,
  type NextAction,
} from "@/lib/ideas/evidence";
import { VERDICT_LABEL, type IdeaAssessment } from "@/lib/portfolio/engines/idea-relevance";
import { describeOrigin } from "@/lib/idea-source";
import { formatCurrency } from "@/lib/format";
import type { Conviction, WatchlistItem } from "@/lib/types";
import { EvidenceTrail } from "./evidence-trail";
import { NextActionButton, type IdeaActHandler } from "./next-action-button";

export interface BoardEntry {
  item: WatchlistItem;
  workflow: IdeaWorkflow;
  evidence: IdeaEvidence;
  action: NextAction;
  assessment: IdeaAssessment | null;
  price: number | null;
  currency: string;
  /** Days since last recorded activity — the staleness the column sorts on. */
  idle: number;
}

/** Verdict chrome. Only the chips that ask for action carry colour. */
const VERDICT_TONE: Record<IdeaAssessment["verdict"], string> = {
  research: "border-brand/40 text-brand",
  thesis: "border-brand/40 text-brand",
  decide: "border-warning/40 text-warning",
  "trade-proposed": "border-warning/40 text-warning",
  "review-sizing": "border-warning/40 text-warning",
  hold: "border-border text-muted",
  "no-case": "border-border text-faint",
  deprioritize: "border-border text-faint",
};

const CONVICTION_WORD: Record<Conviction, string> = { low: "Low", medium: "Med", high: "High" };

/** Empty-column copy: an invitation to act, never a bare dash. */
const COLUMN_EMPTY: Record<"new" | "working" | "ready" | "waiting", string> = {
  new: "Nothing new. Surface ideas in the Screener, Scanner or Radar — they land here.",
  working: "No ideas in work. Open one in Research and the evidence trail starts itself.",
  ready: "No unresolved decisions — every worked idea is decided or waiting.",
  waiting: "No armed triggers. Decide on a thesis with “Wait at a level” to put one here.",
};

function RationaleRow({ q, a }: { q: string; a: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">{q}</dt>
      <dd className="text-[11px] leading-snug text-muted">{a}</dd>
    </div>
  );
}

function BoardCard({ entry, onAct }: { entry: BoardEntry; onAct: IdeaActHandler }) {
  const [open, setOpen] = useState(false);
  const { item, assessment, action } = entry;
  const fit = assessment?.fit ?? null;
  // Deprioritized visually, never removed — an idea the user chose to track
  // disappearing would make the column count a lie.
  const dimmed = assessment?.verdict === "deprioritize" || assessment?.verdict === "no-case";

  return (
    <li
      className={`rounded-control border border-border bg-surface-2/40 transition-opacity ${dimmed ? "opacity-60 hover:opacity-100" : ""}`}
    >
      <div className="uaa-linkable flex flex-col gap-1.5 px-2.5 py-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <SymbolTag symbol={item.symbol} className="font-mono text-[13px] font-semibold text-foreground">
            {item.symbol}
          </SymbolTag>
          {assessment ? (
            <span
              className={`shrink-0 rounded-sm border px-1 text-[9px] font-semibold uppercase tracking-wide ${VERDICT_TONE[assessment.verdict]}`}
            >
              {VERDICT_LABEL[assessment.verdict]}
            </span>
          ) : null}
          {item.conviction ? (
            <span className="shrink-0 rounded-sm border border-border px-1 text-[9px] uppercase tracking-wide text-faint">
              {CONVICTION_WORD[item.conviction]} conviction
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-faint" title="Days since the last recorded activity">
            {entry.idle}d
          </span>
        </span>

        <span className="truncate text-[11px] text-muted">{item.name}</span>

        {/* Compact: recency + thesis always, other artifacts once they exist.
            The full six-chip trail lives in the expanded row — on a card it
            wraps to two lines of dashes and buries the two facts that matter. */}
        <EvidenceTrail item={item} evidence={entry.evidence} compact />

        {/* Relevance layers in when assessed; the card is complete without it. */}
        {fit && assessment ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
            {assessment.explanation ? (
              <ExplainableValue explanation={assessment.explanation} className="text-[10px]">
                <span className="font-mono tabular-nums text-foreground">
                  {assessment.impactPct != null ? `${assessment.impactPct.toFixed(1)}%` : "—"}
                </span>
                <span className="ml-1 text-faint">impact</span>
              </ExplainableValue>
            ) : null}
            <span className="text-muted">
              fit <span className="font-mono tabular-nums">{fit.fitScore}</span>
            </span>
            <span className="text-faint">{Math.round(fit.confidence)}% evidenced</span>
            <span className="text-faint">#{assessment.priority}</span>
          </span>
        ) : null}

        {assessment ? (
          <span className="text-[11px] leading-snug text-foreground/80">{assessment.headline}</span>
        ) : null}

        {/* Waiting cards restate their armed level — the whole point of the column. */}
        {entry.workflow === "waiting" && item.targetPrice != null ? (
          <span className="text-[10px] text-muted">
            Level: {item.targetDirection === "above" ? "above" : "below"}{" "}
            <span className="font-mono tabular-nums">{formatCurrency(item.targetPrice, entry.currency)}</span>
            {entry.price != null ? (
              <>
                {" · now "}
                <span className="font-mono tabular-nums">{formatCurrency(entry.price, entry.currency)}</span>
              </>
            ) : null}
          </span>
        ) : null}

        <span className="mt-0.5 flex items-center justify-between gap-2">
          <NextActionButton action={action} symbol={item.symbol} onAct={onAct} />
          <span className="flex items-center gap-2">
            <Link
              href={`/research?symbol=${encodeURIComponent(item.symbol)}`}
              className="text-[10px] text-muted underline-offset-2 hover:text-brand hover:underline"
            >
              Research
            </Link>
            <button
              type="button"
              onClick={() => onAct("pass", item.symbol)}
              className="text-[10px] text-muted underline-offset-2 hover:text-warning hover:underline"
            >
              Pass…
            </button>
          </span>
        </span>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 border-t border-hairline px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-faint outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span>{open ? "Hide reasoning" : "Why this, why now"}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-hairline px-2.5 py-2.5">
          {assessment ? (
            <>
              {assessment.linkedTrade ? (
                <div className="rounded-control border border-warning/30 bg-warning/5 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-warning">
                    The Decisions tab has a simulated trade for this
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-foreground/90">{assessment.linkedTrade.title}</p>
                  <p className="mt-0.5 text-[10px] leading-snug text-muted">{assessment.linkedTrade.rationale}</p>
                </div>
              ) : null}

              <dl className="flex flex-col gap-2">
                <RationaleRow q="Why am I seeing this?" a={assessment.rationale.whySeeing} />
                <RationaleRow q="What problem does it solve?" a={assessment.rationale.whatProblem} />
                <RationaleRow q="Why now?" a={assessment.rationale.whyNow} />
                <RationaleRow q="Why this and not another?" a={assessment.rationale.whyThisOne} />
                <RationaleRow q="What if I ignore it?" a={assessment.rationale.ifIgnored} />
              </dl>

              {assessment.tradeoffs.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Trade-offs</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {assessment.tradeoffs.map((t) => (
                      <li key={t} className="text-[11px] leading-snug text-warning/90">
                        · {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[11px] text-muted">
              Relevance is still loading. The column, the evidence and the action above are already final.
            </p>
          )}

          <p className="border-t border-hairline pt-2 text-[10px] leading-snug text-faint">
            {describeOrigin({ source: item.source, detail: item.sourceDetail, at: item.addedAt })}
          </p>
        </div>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Outcomes rail                                                               */
/* -------------------------------------------------------------------------- */

function OutcomeGroup({
  label,
  caption,
  entries,
  children,
}: {
  label: string;
  caption: string;
  entries: BoardEntry[];
  children: (e: BoardEntry) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-xs font-semibold uppercase tracking-widest text-muted/60 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span>{label}</span>
        <span className="font-mono tabular-nums text-faint">
          {entries.length} {open ? "▲" : "▼"}
        </span>
      </button>
      <p className="mt-0.5 text-[10px] text-faint">{caption}</p>
      {open && entries.length > 0 ? <ul className="mt-2 flex flex-col gap-1.5">{entries.map((e) => children(e))}</ul> : null}
    </div>
  );
}

export function IdeasBoard({ entries, onAct }: { entries: BoardEntry[]; onAct: IdeaActHandler }) {
  const byWorkflow = useMemo(() => {
    const map = new Map<IdeaWorkflow, BoardEntry[]>();
    for (const e of entries) {
      const list = map.get(e.workflow) ?? [];
      list.push(e);
      map.set(e.workflow, list);
    }
    // Within a column: relevance-engine priority first, then the longest-idle
    // (the stalest asks loudest), then symbol for a stable order.
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ap = a.assessment?.priority ?? null;
        const bp = b.assessment?.priority ?? null;
        if (ap != null && bp != null && ap !== bp) return ap - bp;
        if (ap != null && bp == null) return -1;
        if (ap == null && bp != null) return 1;
        return b.idle - a.idle || a.item.symbol.localeCompare(b.item.symbol);
      });
    }
    return map;
  }, [entries]);

  return (
    <SymbolLinkRoot className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ACTIVE_WORKFLOWS.map((wf) => {
          const list = byWorkflow.get(wf) ?? [];
          return (
            <div key={wf} className="uaa-card flex flex-col gap-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted/70">{WORKFLOW_LABEL[wf]}</h3>
                  <p className="text-[10px] text-faint">{WORKFLOW_QUESTION[wf]}</p>
                </div>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <p className="py-3 text-[11px] leading-snug text-faint">{COLUMN_EMPTY[wf as keyof typeof COLUMN_EMPTY]}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {list.map((e) => (
                    <BoardCard key={e.item.symbol} entry={e} onAct={onAct} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        Columns are derived from evidence and the ledger — researching a name, writing its thesis, arming a trigger,
        buying or passing is what moves a card. Ranked within each column by expected impact where fit inputs exist.
      </p>

      {/* Outcomes — off the funnel by design. */}
      <div className="uaa-card flex flex-col gap-4 p-3 sm:flex-row sm:gap-8">
        <OutcomeGroup
          label="Owned"
          caption="Held in the ledger — sizing and trades live in Portfolio → Decisions."
          entries={byWorkflow.get("owned") ?? []}
        >
          {(e) => (
            <li key={e.item.symbol} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-baseline gap-2">
                <SymbolTag symbol={e.item.symbol} className="font-mono font-semibold text-foreground">
                  {e.item.symbol}
                </SymbolTag>
                <span className="truncate text-faint">{e.item.name}</span>
              </span>
              <Link href="/portfolio?tab=decisions" className="shrink-0 text-[10px] text-brand underline-offset-2 hover:underline">
                Decisions →
              </Link>
            </li>
          )}
        </OutcomeGroup>

        <OutcomeGroup
          label="Passed"
          caption="Declined with a reason on file. Reconsider reopens the idea."
          entries={byWorkflow.get("passed") ?? []}
        >
          {(e) => (
            <li key={e.item.symbol} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono font-semibold text-foreground">{e.item.symbol}</span>
                <span className="truncate text-faint" title={passReason(e.evidence) ?? undefined}>
                  {passReason(e.evidence) ?? "Reason not recorded"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onAct("reconsider", e.item.symbol)}
                className="shrink-0 text-[10px] text-brand underline-offset-2 hover:underline"
              >
                Reconsider
              </button>
            </li>
          )}
        </OutcomeGroup>

        <OutcomeGroup
          label="Exited"
          caption="Previously owned; the ledger shows the position closed."
          entries={byWorkflow.get("exited") ?? []}
        >
          {(e) => (
            <li key={e.item.symbol} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-baseline gap-2">
                <SymbolTag symbol={e.item.symbol} className="font-mono font-semibold text-foreground">
                  {e.item.symbol}
                </SymbolTag>
                <span className="truncate text-faint">{e.item.name}</span>
              </span>
              <button
                type="button"
                onClick={() => onAct("reconsider", e.item.symbol)}
                className="shrink-0 text-[10px] text-brand underline-offset-2 hover:underline"
              >
                Re-open
              </button>
            </li>
          )}
        </OutcomeGroup>
      </div>
    </SymbolLinkRoot>
  );
}
