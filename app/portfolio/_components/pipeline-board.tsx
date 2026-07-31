"use client";

/**
 * The Idea Pipeline board (§4.5) — every tracked symbol as a decision, by stage.
 *
 * The investment loop made visible: surfaced → researching → thesis → owned,
 * with passed/exited kept off the main funnel in a de-emphasized rail. A move
 * raises a Journal prompt exactly once. Stages are descriptive: nothing here
 * blocks or warns against anything.
 *
 * ── Three data sources, one number each ────────────────────────────────────
 *  1. `/api/pipeline`      — structure (who is in which column). Pure DB read,
 *                            instant, and the only authority on stage.
 *  2. `/api/pipeline/fit`  — research inputs. Network-bound, so it lands second
 *                            and the columns never wait for it.
 *  3. `useIOS()`           — `getPortfolioFit` (the one fit engine, shared with
 *                            Watchlist/Compare/Research/Wire/DCF) and `report`,
 *                            already fetched once for the whole page, which is
 *                            where the trade engine's recommendations and the
 *                            real position weights come from.
 *
 * Relevance is then assembled by `buildIdeaAssessments` — deterministic, no
 * model, no second scorer. This component fetches and renders; it computes
 * nothing, because a component that calculates is a second source of truth.
 *
 * Ordering is by expected IMPACT, not by fit score: see the header of
 * lib/portfolio/engines/idea-relevance.ts. Low-relevance ideas are dimmed and
 * sink to the bottom of their column — never filtered out, because an idea the
 * user chose to track disappearing would make the column count a lie.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { useToast } from "@/app/_components/toast";
import { SymbolLinkRoot } from "@/app/_home/_atmosphere/symbol-link";
import { useIOSSafe } from "@/lib/ios-context";
import { PIPELINE_STAGES, TERMINAL_STAGES, STAGE_LABEL } from "@/lib/idea-stage";
import { PORTFOLIO_CLASS_LABEL } from "@/lib/portfolio/model/types";
import {
  buildIdeaAssessments,
  EMPTY_IDEA_CONTEXT,
  type IdeaAssessment,
  type IdeaPortfolioContext,
  type LinkedTrade,
} from "@/lib/portfolio/engines/idea-relevance";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";
import type { FitEnrichment } from "@/lib/watchlist-fit";
import type { IdeaStage } from "@/lib/types";
import type { PipelineResponse, PipelineRow } from "@/app/api/pipeline/route";
import type { PipelineFitResponse } from "@/app/api/pipeline/fit/route";
import { Skeleton } from "@/app/_components/ui";
import { IdeaCard } from "./pipeline/idea-card";

async function fetchPipeline(signal: AbortSignal): Promise<PipelineResponse> {
  const res = await fetch("/api/pipeline", { signal });
  if (!res.ok) throw new Error(`Couldn't load the pipeline (${res.status})`);
  return (await res.json()) as PipelineResponse;
}

const ALL_STAGES: IdeaStage[] = [...PIPELINE_STAGES, ...TERMINAL_STAGES];

/** The question each column answers, so a stage reads as a decision queue. */
const STAGE_QUESTION: Record<IdeaStage, string> = {
  surfaced: "What deserves research?",
  researching: "What am I working on?",
  thesis: "What am I ready to decide?",
  owned: "Own more, or less?",
  passed: "What did I rule out?",
  exited: "What did I sell?",
};

const SORT_LABEL = {
  impact: "Expected impact",
  fit: "Portfolio fit",
  longest: "Longest in stage",
  newest: "Newest first",
  symbol: "Symbol A–Z",
} as const;
type SortKey = keyof typeof SORT_LABEL;

interface Enriched {
  row: PipelineRow;
  assessment: IdeaAssessment | null;
}

/**
 * The impact ordering is the ENGINE's `priority`, not a second sort over
 * `impactPct`. Re-deriving it here put a card labelled #27 above one labelled
 * #26: two ideas whose impact ties at one decimal place are separated by the
 * engine on fit score, and a local comparator that tied and fell back to the
 * symbol produced a different order from the ranks it was displaying.
 *
 * The other comparators sink unassessable ideas rather than ranking them low: a
 * missing value is not a small value (AGENTS.md), and an idea with no
 * fundamentals must not outrank an evidenced one in either direction.
 */
function comparatorFor(sortKey: SortKey): (a: Enriched, b: Enriched) => number {
  const bySymbol = (a: Enriched, b: Enriched) => a.row.symbol.localeCompare(b.row.symbol);
  const numeric = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return b - a;
  };

  switch (sortKey) {
    case "impact":
      return (a, b) => {
        const ap = a.assessment?.priority;
        const bp = b.assessment?.priority;
        if (ap == null && bp == null) return bySymbol(a, b);
        if (ap == null) return 1;
        if (bp == null) return -1;
        return ap - bp;
      };
    case "fit":
      return (a, b) => numeric(a.assessment?.fit?.fitScore, b.assessment?.fit?.fitScore) || bySymbol(a, b);
    case "longest":
      return (a, b) => b.row.daysInStage - a.row.daysInStage || bySymbol(a, b);
    case "newest":
      return (a, b) => a.row.daysInStage - b.row.daysInStage || bySymbol(a, b);
    case "symbol":
      return bySymbol;
  }
}

function Column({
  stage,
  items,
  onMove,
}: {
  stage: IdeaStage;
  items: Enriched[];
  onMove: (symbol: string, name: string, to: IdeaStage) => void;
}) {
  return (
    <div className="uaa-card flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted/70">{STAGE_LABEL[stage]}</h3>
          <p className="text-[10px] text-faint">{STAGE_QUESTION[stage]}</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-[11px] text-faint">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => (
            <IdeaCard
              key={it.row.symbol}
              row={it.row}
              assessment={it.assessment}
              onMove={onMove}
              stages={ALL_STAGES}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function PipelineBoard() {
  const { data, isInitialLoading, refresh } = useDataset<PipelineResponse>("pipeline.board", null, fetchPipeline);
  const toast = useToast();
  const router = useRouter();
  const ios = useIOSSafe();
  const [showTerminal, setShowTerminal] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("impact");
  const [enrichment, setEnrichment] = useState<Map<string, FitEnrichment> | null>(null);
  const [unassessable, setUnassessable] = useState<Set<string>>(new Set());

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const symbolsKey = rows.map((r) => r.symbol).sort().join(",");

  /* Research inputs, second and independently: the columns are already correct
     without them, so this never blocks the board. */
  useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    fetch("/api/pipeline/fit")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: PipelineFitResponse | null) => {
        if (cancelled || !json?.items) return;
        setEnrichment(new Map(json.items.map((e) => [e.symbol.toUpperCase(), e])));
        setUnassessable(new Set((json.unassessable ?? []).map((s) => s.toUpperCase())));
      })
      .catch(() => {
        /* Relevance is an enhancement — the board degrades to structure only. */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the symbol SET, not the array identity
  }, [symbolsKey]);

  /* The portfolio context: read off the report the page already fetched, so the
     weights, sectors and trade recommendations here are the same objects the
     other tabs render. Nothing is recomputed.

     `report` and `profile` are lifted out of the optional context first: a memo
     whose dependencies are optional-chained off `ios` cannot be verified by the
     React compiler, which then skips memoizing the whole component. */
  const report = ios?.report ?? null;
  const profile = ios?.profile ?? null;
  const context = useMemo<IdeaPortfolioContext>(() => {
    if (!report || !profile?.hasPortfolio) return EMPTY_IDEA_CONTEXT;

    const weights = new Map<string, number>();
    const sectors = new Map<string, string>();
    for (const h of report.holdings) {
      if (!h.symbol) continue;
      weights.set(h.symbol.toUpperCase(), h.weight);
      if (h.attributes?.sector) sectors.set(h.symbol.toUpperCase(), h.attributes.sector);
    }

    const trades = new Map<string, LinkedTrade>();
    for (const d of report.decisions) {
      const symbol = d.recommendation.symbol?.toUpperCase();
      if (!symbol || trades.has(symbol)) continue;
      trades.set(symbol, {
        action: d.recommendation.action,
        title: d.recommendation.title,
        rationale: d.recommendation.rationale,
        amount: d.recommendation.amount,
        healthDelta: d.recommendation.impact?.healthDelta ?? null,
        confidence: Math.round(d.recommendation.confidence),
        alternativesEvaluated: d.alternativesEvaluated,
      });
    }

    return {
      hasPortfolio: true,
      totalValue: report.totalValue,
      positionHhi: report.risk.positionHhi,
      // `totalExact`, not `total`: every engine that differences two health
      // scores must use the unrounded one (see HealthDimension.scoreExact).
      healthScore: report.health.totalExact,
      weights,
      sectors,
      missingSectors: profile.missingSectors,
      overweightSectors: profile.overweightSectors,
      trades,
      atEquilibrium: report.atEquilibrium,
    };
  }, [report, profile]);

  /* Fit, then relevance. One call to the shared engine per row; the assessments
     are rebuilt only when their inputs change. */
  const enrichmentKey = enrichment ? [...enrichment.keys()].sort().join(",") : "";
  const assessments = useMemo(() => {
    if (!ios?.profileReady || rows.length === 0) return new Map<string, IdeaAssessment>();

    const fits = new Map<string, PortfolioFitAnalysis>();
    const prices = new Map<string, number>();
    for (const row of rows) {
      const enr = enrichment?.get(row.symbol);
      // No inputs at all → no fit. An absent score reads as "not assessable";
      // scoring it from nothing would produce a confident-looking neutral.
      if (!enr || unassessable.has(row.symbol)) continue;
      fits.set(
        row.symbol,
        ios.getPortfolioFit({
          symbol: row.symbol,
          sector: enr.sector,
          marketCap: enr.marketCap,
          compositeScores: enr.compositeScores,
          dividendYield: enr.dividendYield,
          beta: enr.beta,
          geography: enr.geography,
          isOnWatchlist: row.tracked,
        }),
      );
    }

    const built = buildIdeaAssessments({ rows, fits, prices, context });
    return new Map(built.map((a) => [a.symbol, a]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the identity of every input, not on object references
  }, [rows, enrichmentKey, unassessable, context, ios?.profileReady, ios?.profile.builtAt]);

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

  const needle = query.trim().toUpperCase();
  const visible = useMemo(() => {
    const enrichedRows: Enriched[] = rows.map((row) => ({
      row,
      assessment: assessments.get(row.symbol) ?? null,
    }));
    const matched =
      needle === ""
        ? enrichedRows
        : enrichedRows.filter(
            (e) =>
              e.row.symbol.includes(needle) ||
              e.row.name.toUpperCase().includes(needle) ||
              (e.row.assetClass ? PORTFOLIO_CLASS_LABEL[e.row.assetClass].toUpperCase().includes(needle) : false) ||
              (e.assessment?.fit?.fitTier ?? "").toUpperCase().includes(needle),
          );
    return matched.sort(comparatorFor(sortKey));
  }, [rows, assessments, needle, sortKey]);

  if (isInitialLoading && !data) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_STAGES.map((s) => (
          <Skeleton key={s} height="h-48" radius="rounded-card" className="border border-border" />
        ))}
      </div>
    );
  }

  const byStage = (stage: IdeaStage) => visible.filter((e) => e.row.stage === stage);
  const terminal = visible.filter((e) => (TERMINAL_STAGES as IdeaStage[]).includes(e.row.stage));
  const coverage = data?.coverage;
  const assessed = visible.filter((e) => e.assessment?.fit).length;

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="sr-only">Filter ideas by symbol, name, asset class or fit tier</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by symbol, name, class or fit…"
              className="w-72 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            <span>Rank by</span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:border-brand"
            >
              {Object.entries(SORT_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span aria-live="polite" className="text-[11px] text-muted">
          {needle === ""
            ? `${rows.length} ${rows.length === 1 ? "idea" : "ideas"} · ${assessed} scored`
            : `${visible.length} of ${rows.length} shown`}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_STAGES.map((stage) => (
          <Column key={stage} stage={stage} items={byStage(stage)} onMove={move} />
        ))}
      </div>

      {/* Which engine answers what, said once. Fit and the Decisions tab are
          different questions, and a reader who assumes otherwise will read one
          of them as contradicting the other. */}
      <p className="text-[11px] leading-relaxed text-faint">
        Ranked by expected impact — the share of the portfolio each idea could justifiably move, discounted by fit and by
        how much of the score is evidenced. Fit answers <em>does this belong in this portfolio</em>; the Decisions tab
        answers <em>what should I trade today</em>, by simulating each trade through the portfolio engines. Where both
        speak, the Decisions tab is quoted on the card and wins.
        {coverage && coverage.holdings > coverage.quoted ? (
          <>
            {" "}
            Owned is derived from the ledger: {coverage.quoted} of your {coverage.holdings} holdings are market-quoted —
            cash and manually-valued assets have no ticker to research and never enter the pipeline.
          </>
        ) : null}
        {ios && !ios.profile.hasPortfolio ? " No positions recorded, so fit is generic rather than personalized." : ""}
      </p>

      {/* Passed / exited — terminal outcomes, kept off the main funnel. */}
      <div className="uaa-card p-3">
        <button
          type="button"
          onClick={() => setShowTerminal((s) => !s)}
          aria-expanded={showTerminal}
          className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-widest text-muted/60 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <span>Passed &amp; exited</span>
          <span className="font-mono tabular-nums text-faint">{terminal.length} {showTerminal ? "▲" : "▼"}</span>
        </button>
        {showTerminal && terminal.length > 0 ? (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {terminal.map((e) => (
              <IdeaCard
                key={e.row.symbol}
                row={e.row}
                assessment={e.assessment}
                onMove={move}
                stages={ALL_STAGES}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </SymbolLinkRoot>
  );
}
