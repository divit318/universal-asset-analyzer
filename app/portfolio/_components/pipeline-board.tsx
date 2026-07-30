"use client";

/**
 * The Idea Pipeline board (§4.5) — every tracked symbol as a column by stage.
 *
 * The investment loop made visible: surfaced → researching → thesis → owned,
 * with passed/exited kept off the main funnel in a de-emphasized rail. Rows
 * carry the symbol (Neural-Flow linked), name, days-in-stage, and one explicit
 * stage control — no drag-drop in v1. A move raises a Journal prompt exactly
 * once. Stages are descriptive: nothing here blocks or warns against anything.
 *
 * Machined Instrument: matte `.uaa-card` columns, monochrome chrome, colour
 * only where it carries data (the "held" dot, the days-in-stage warmth).
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { useToast } from "@/app/_components/toast";
import { SymbolLinkRoot, SymbolTag } from "@/app/_home/_atmosphere/symbol-link";
import { PIPELINE_STAGES, TERMINAL_STAGES, STAGE_LABEL } from "@/lib/idea-stage";
import type { IdeaStage } from "@/lib/types";
import type { PipelineRow } from "@/app/api/pipeline/route";
import { Skeleton } from "@/app/_components/ui";

async function fetchPipeline(signal: AbortSignal): Promise<{ rows: PipelineRow[] }> {
  const res = await fetch("/api/pipeline", { signal });
  if (!res.ok) throw new Error(`Couldn't load the pipeline (${res.status})`);
  return (await res.json()) as { rows: PipelineRow[] };
}

const ALL_STAGES: IdeaStage[] = [...PIPELINE_STAGES, ...TERMINAL_STAGES];

function StageSelect({ row, onMove }: { row: PipelineRow; onMove: (to: IdeaStage) => void }) {
  return (
    <select
      value={row.stage}
      onChange={(e) => onMove(e.target.value as IdeaStage)}
      aria-label={`Stage for ${row.symbol}`}
      className="rounded-control border border-border bg-surface-2 px-1.5 py-1 text-[11px] text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      {ALL_STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function Row({ row, onMove }: { row: PipelineRow; onMove: (symbol: string, name: string, to: IdeaStage) => void }) {
  return (
    <li className="uaa-linkable flex items-center gap-2 rounded-control border border-border bg-surface-2/40 px-2.5 py-2">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          {row.held ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-positive" title="Currently held" /> : null}
          <SymbolTag symbol={row.symbol} className="font-mono text-[13px] font-semibold text-foreground">
            {row.symbol}
          </SymbolTag>
        </span>
        <span className="truncate text-[11px] text-muted">{row.name}</span>
      </span>
      <span className="shrink-0 text-right text-[10px] text-faint">
        {row.daysInStage}d
        {!row.tracked ? <span className="block text-[9px] uppercase tracking-wide text-faint">untracked</span> : null}
      </span>
      <StageSelect row={row} onMove={(to) => onMove(row.symbol, row.name, to)} />
    </li>
  );
}

function Column({ stage, rows, onMove }: { stage: IdeaStage; rows: PipelineRow[]; onMove: (symbol: string, name: string, to: IdeaStage) => void }) {
  return (
    <div className="uaa-card flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted/70">{STAGE_LABEL[stage]}</h3>
        <span className="font-mono text-[11px] tabular-nums text-faint">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-[11px] text-faint">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <Row key={r.symbol} row={r} onMove={onMove} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function PipelineBoard() {
  const { data, isInitialLoading, refresh } = useDataset<{ rows: PipelineRow[] }>("pipeline.board", null, fetchPipeline);
  const toast = useToast();
  const router = useRouter();
  const [showTerminal, setShowTerminal] = useState(false);

  const move = useCallback(
    async (symbol: string, name: string, to: IdeaStage) => {
      try {
        const res = await fetch("/api/pipeline", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, stage: to, name }),
        });
        const json = (await res.json()) as { changed?: boolean; from?: IdeaStage | null };
        if (!res.ok) throw new Error();
        refresh();
        // A Journal prompt, exactly once per real transition (§4.5). Dismissing
        // it (or letting it lapse) never re-prompts — it fires only on a change.
        if (json.changed) {
          const fromLabel = json.from ? STAGE_LABEL[json.from] : "the pipeline";
          const note = `Moved ${symbol} from ${fromLabel} to ${STAGE_LABEL[to]}.`;
          toast(`You moved ${symbol} to ${STAGE_LABEL[to]} — log your reasoning?`, "info", {
            durationMs: 10_000,
            action: {
              label: "Log reasoning",
              onClick: () => router.push(`/journal?symbol=${encodeURIComponent(symbol)}&note=${encodeURIComponent(note)}`),
            },
          });
        }
      } catch {
        toast(`Couldn't move ${symbol}`, "error");
      }
    },
    [refresh, toast, router],
  );

  if (isInitialLoading && !data) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_STAGES.map((s) => (
          <Skeleton key={s} height="h-48" radius="rounded-card" className="border border-border" />
        ))}
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const byStage = (stage: IdeaStage) => rows.filter((r) => r.stage === stage);
  const terminalRows = rows.filter((r) => (TERMINAL_STAGES as IdeaStage[]).includes(r.stage));

  if (rows.length === 0) {
    return (
      <div className="uaa-card flex flex-col items-start gap-2 p-6">
        <p className="text-sm text-muted">No tracked symbols yet.</p>
        <p className="text-xs text-faint">Add names to your watchlist or buy a position — they enter the pipeline automatically.</p>
      </div>
    );
  }

  return (
    <SymbolLinkRoot className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_STAGES.map((stage) => (
          <Column key={stage} stage={stage} rows={byStage(stage)} onMove={move} />
        ))}
      </div>

      {/* Passed / exited — terminal outcomes, kept off the main funnel. */}
      <div className="uaa-card p-3">
        <button
          type="button"
          onClick={() => setShowTerminal((s) => !s)}
          aria-expanded={showTerminal}
          className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-widest text-muted/60 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <span>Passed &amp; exited</span>
          <span className="font-mono tabular-nums text-faint">{terminalRows.length} {showTerminal ? "▲" : "▼"}</span>
        </button>
        {showTerminal && terminalRows.length > 0 ? (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {terminalRows.map((r) => (
              <Row key={r.symbol} row={r} onMove={move} />
            ))}
          </ul>
        ) : null}
      </div>
    </SymbolLinkRoot>
  );
}
