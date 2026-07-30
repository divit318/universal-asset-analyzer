"use client";

/**
 * Radar — ideas entering the pipeline (§4.1).
 *
 * Merges the retired `opportunity-feed` (scanner hits ranked by fit to the book)
 * with the buy-candidate half of `watchlist-intelligence`. Where the Attention
 * Queue answers "what needs a decision now", the Radar answers "what's worth a
 * look next" — the top of the funnel, not the middle.
 *
 * Reads the same digest slices those modules read; no scoring here.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { Plus, Check } from "lucide-react";
import { Badge } from "@/app/_components/ui";
import { useToast } from "@/app/_components/toast";
import type { OpportunitySnapshotItem, SymbolContext } from "@/lib/home/contracts";
import { getHomeModule } from "@/lib/home/registry";
import { STAGE_LABEL } from "@/lib/idea-stage";
import { SymbolTag } from "../_atmosphere/symbol-link";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("radar");

const TIER: Record<string, "positive" | "brand" | "neutral" | "warning"> = {
  excellent: "positive",
  good: "brand",
  neutral: "neutral",
  poor: "warning",
  avoid: "warning",
};

function AddButton({ symbol, reason }: { symbol: string; reason?: string | null }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");

  const add = useCallback(async () => {
    if (state !== "idle") return;
    setState("adding");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Provenance (lib/idea-source.ts): the Radar's own fit summary is the
        // reason this appeared, so it travels with the idea into the pipeline.
        body: JSON.stringify({ symbol, source: "radar", sourceDetail: reason ?? null }),
      });
      if (!res.ok) throw new Error();
      setState("added");
      toast(`${symbol} added to watchlist`, "success");
    } catch {
      setState("idle");
      toast(`Couldn't add ${symbol}`, "error");
    }
  }, [state, symbol, reason, toast]);

  return (
    <button
      type="button"
      onClick={add}
      disabled={state !== "idle"}
      aria-label={state === "added" ? `${symbol} added to watchlist` : `Add ${symbol} to watchlist`}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-border text-muted outline-none transition-colors hover:border-brand/40 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60"
    >
      {state === "added" ? <Check className="h-3.5 w-3.5 text-positive" strokeWidth={2.5} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2} />}
    </button>
  );
}

function radarDaysAgo(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function RadarRow({ o, ctx, isNew }: { o: OpportunitySnapshotItem; ctx: SymbolContext | undefined; isNew: boolean }) {
  return (
    <li className="uaa-linkable flex items-center gap-2.5 rounded-control border border-border bg-surface-2/40 p-2.5">
      <SymbolTag symbol={o.symbol} className="font-mono text-sm font-semibold text-foreground">
        {o.symbol}
      </SymbolTag>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant={TIER[o.fitTier] ?? "neutral"}>{o.fitTier} fit</Badge>
          <span className="font-mono text-[11px] tabular-nums text-muted">{Math.round(o.combinedScore)}</span>
          {isNew ? (
            <span className="rounded-full bg-brand/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand">New</span>
          ) : null}
          {ctx?.lastResearchedAt ? (
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">researched {radarDaysAgo(ctx.lastResearchedAt)}</span>
          ) : null}
          {ctx?.watchlistStage && ctx.watchlistStage !== "surfaced" ? (
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{STAGE_LABEL[ctx.watchlistStage]}</span>
          ) : null}
        </span>
        <span className="truncate text-[11px] text-muted">{o.fitSummary}</span>
      </span>
      <AddButton symbol={o.symbol} reason={o.fitSummary} />
    </li>
  );
}

export function RadarModule() {
  const state = useHomeSlice("opportunityFeed");
  const watchlist = useHomeSlice("watchlistIntelligence");
  const symbolContext = useHomeSlice("symbolContext");
  const changes = useHomeSlice("changes");
  const { refreshDigest } = useHome();

  // Ideas the change engine marked as new since the last visit.
  const newSymbols = new Set(
    (changes.data?.changes ?? []).filter((c) => c.kind === "opportunity-new" && c.symbol).map((c) => c.symbol as string),
  );

  const buyCount =
    watchlist.data?.buckets.find((b) => b.id === "buy")?.symbols.length ?? 0;
  const nearBuyCount =
    watchlist.data?.buckets.find((b) => b.id === "near-buy")?.symbols.length ?? 0;

  return (
    <ModuleShell
      definition={definition}
      state={state}
      minHeight={200}
      onRefresh={refreshDigest}
      isEmpty={(d) => d.opportunities.length === 0 && buyCount === 0 && nearBuyCount === 0}
      emptyMessage="No new ideas today — run the Screener →"
    >
      {(d) => (
        <div className="flex flex-col gap-3">
          {d.scannerFreshness && d.scannerFreshness.level === "stale" ? (
            <p className="text-[11px] text-warning">From a stale scan — re-run the scanner for current signals.</p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {d.opportunities.slice(0, 5).map((o) => (
              <RadarRow
                key={o.symbol}
                o={o}
                ctx={symbolContext.data?.[o.symbol.toUpperCase()]}
                isNew={newSymbols.has(o.symbol.toUpperCase())}
              />
            ))}
          </ul>

          {buyCount > 0 || nearBuyCount > 0 ? (
            <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 text-[11px] text-muted">
              <span>
                Watchlist: {buyCount} buy{buyCount === 1 ? "" : "s"} · {nearBuyCount} near-buy{nearBuyCount === 1 ? "" : "s"}
              </span>
              <Link href="/watchlist" className="font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40">
                Open →
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </ModuleShell>
  );
}
