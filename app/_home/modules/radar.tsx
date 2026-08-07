"use client";

/**
 * Radar — ideas entering the pipeline (§4.1).
 *
 * Merges the retired `opportunity-feed` (scanner hits ranked by fit to the book)
 * with the buy-candidate half of `watchlist-intelligence`. Where the Attention
 * Queue answers "what needs a decision now", the Radar answers "what's worth a
 * look next" — the top of the funnel, not the middle.
 *
 * Reads the same digest slices those modules read; no scoring here. Bespoke
 * like the queue beside it (the header carries its own icon + count treatment
 * a ModuleShell cannot express); the Section primitive still owns the
 * loading / empty / error state machine.
 *
 * The number on every tile is the FIT score (rankByFit's blend: 0.6 × scanner
 * quality + 0.4 × portfolio fit, 0–100) — deliberately a different scale from
 * the Attention queue's priority number beside it, and labelled so the same
 * ticker carrying two numbers reads as two measurements.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Plus, Radar, RefreshCw, TrendingUp } from "lucide-react";
import { useToast } from "@/app/_components/toast";
import type { OpportunitySnapshotItem } from "@/lib/home/contracts";
import { explainOpportunityScore } from "@/lib/home/explain";
import { getHomeModule } from "@/lib/home/registry";
import { SymbolTag } from "../_atmosphere/symbol-link";
import { ExplainableValue } from "../_atmosphere/explain-popover";
import { CategoryPill, IconWell, NumericText, type PillTone } from "../_atmosphere/stream-primitives";
import { useHome, useHomeSlice } from "../home-provider";
import { Section, Skeleton } from "@/app/_components/ui";

const definition = getHomeModule("radar");

/** How long the confirmation check shows before the tile animates out. */
const ADDED_MS = 1500;
const EXIT_MS = 150;

const TIER_TONE: Record<string, PillTone> = {
  excellent: "positive",
  good: "positive",
  neutral: "neutral",
  poor: "warning",
  avoid: "warning",
};

/**
 * The tile's reason line. Prefers the fit analysis's *second* distinct driver
 * (`fitDetail`) because the first one is already the Attention queue's
 * rationale for the same symbol — two panels must never repeat a sentence
 * verbatim. When only one driver exists, the row's own scanner-quality number
 * (which the summary never carries) is appended so the string still differs
 * and stays row-specific.
 */
function radarReason(o: OpportunitySnapshotItem): string {
  if (o.fitDetail) return o.fitDetail;
  if (o.absoluteScore != null) return `${o.fitSummary}, quality ${Math.round(o.absoluteScore)}/100`;
  return o.fitSummary;
}

/* ------------------------------------------------------------------ */
/* Tile                                                                */
/* ------------------------------------------------------------------ */

type AddPhase = "idle" | "added" | "exiting" | "gone";

function RadarTile({ o, isNew }: { o: OpportunitySnapshotItem; isNew: boolean }) {
  const toast = useToast();
  const [phase, setPhase] = useState<AddPhase>("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const add = useCallback(() => {
    if (phase !== "idle") return;
    // Optimistic: confirm immediately, animate the tile out after 1.5s, and
    // roll the whole sequence back (with a toast) if the persist fails.
    setPhase("added");
    timers.current.push(window.setTimeout(() => setPhase("exiting"), ADDED_MS));
    timers.current.push(window.setTimeout(() => setPhase("gone"), ADDED_MS + EXIT_MS));

    fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Provenance (lib/idea-source.ts): the Radar's own fit summary is the
      // reason this appeared, so it travels with the idea into the pipeline.
      body: JSON.stringify({ symbol: o.symbol, source: "radar", sourceDetail: o.fitSummary ?? null }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
        setPhase("idle");
        toast(`Couldn't add ${o.symbol} to your watchlist`, "error");
      });
  }, [phase, o.symbol, o.fitSummary, toast]);

  if (phase === "gone") return null;

  const tone = TIER_TONE[o.fitTier] ?? "neutral";
  const explanation = explainOpportunityScore(o);

  return (
    <li
      className={`uaa-linkable grid grid-cols-[40px_minmax(0,1fr)_36px] items-start gap-3 rounded-[10px] border border-hairline bg-surface-2/50 p-3.5 ${
        phase === "exiting" ? "uaa-queue-exit" : ""
      }`}
    >
      <IconWell toneClass="bg-positive/10 text-positive">
        <TrendingUp className="h-4.5 w-4.5" strokeWidth={2} />
      </IconWell>

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <SymbolTag symbol={o.symbol} className="font-mono text-[15px] font-semibold leading-none text-foreground">
            {o.symbol}
          </SymbolTag>
          <CategoryPill tone={tone} ariaLabel={`Portfolio fit tier: ${o.fitTier}`}>
            {o.fitTier} fit
          </CategoryPill>
          <span className="inline-flex items-center gap-1">
            <span
              className="text-label uppercase tracking-[0.08em] text-muted"
              title="Fit: how good this idea is for this book, 0–100. 0.6 × scanner quality + 0.4 × portfolio fit — click the score for its decomposition."
            >
              Fit
            </span>
            <ExplainableValue explanation={explanation} align="end" underline={false}>
              <span
                className="font-mono text-sm tabular-nums text-foreground/70"
                aria-label={`Fit score ${Math.round(o.combinedScore)} of 100`}
              >
                {Math.round(o.combinedScore)}
              </span>
            </ExplainableValue>
          </span>
          {isNew ? (
            <CategoryPill tone="brand" ariaLabel="New since your last visit">
              New
            </CategoryPill>
          ) : null}
        </div>
        <p className="line-clamp-2 text-[13px] leading-normal text-muted">
          <NumericText text={radarReason(o)} />
        </p>
      </div>

      <button
        type="button"
        onClick={add}
        disabled={phase !== "idle"}
        aria-label={phase === "idle" ? `Add ${o.symbol} to watchlist` : `${o.symbol} added to watchlist`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-foreground/12 text-foreground/50 outline-none transition-colors hover:border-positive/40 hover:text-positive focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none"
      >
        {phase === "idle" ? (
          <Plus className="h-4 w-4" strokeWidth={2} />
        ) : (
          <Check className="h-4 w-4 text-positive" strokeWidth={2.5} />
        )}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export function RadarModule() {
  const state = useHomeSlice("opportunityFeed");
  const watchlist = useHomeSlice("watchlistIntelligence");
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
    // Deliberately not h-full: the card ends after its last tile + footer
    // rather than stretching to match the taller queue beside it.
    <div className="uaa-card flex flex-col">
      {/* Header */}
      <div className="flex flex-col gap-1 p-5.5 pb-4">
        <div className="flex items-center gap-2.5">
          <Radar className="h-4.5 w-4.5 shrink-0 text-brand" strokeWidth={2} aria-hidden />
          <h2 className="text-xl font-semibold leading-none text-foreground">{definition.title}</h2>
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={refreshDigest}
            aria-label="Refresh Radar"
            className="rounded-control p-1.5 text-foreground/40 outline-none transition-colors hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <RefreshCw className={`h-4 w-4 ${state.revalidating ? "animate-spin" : ""}`} strokeWidth={2} />
          </button>
          {definition.navTarget ? (
            <Link
              href={definition.navTarget.href}
              className="rounded-control text-sm font-medium text-brand outline-none transition-colors hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {definition.navTarget.label}
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-muted">{definition.description}</p>
      </div>

      {/* Candidates */}
      <Section
        bare
        state={state}
        isEmpty={(d) => d.opportunities.length === 0}
        emptyMessage="No new candidates today."
        minHeight={120}
        onRetry={refreshDigest}
        className="px-5.5"
        skeleton={
          <ul aria-hidden className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {[0, 1, 2].map((i) => (
              <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)_36px] items-start gap-3 rounded-[10px] border border-hairline bg-surface-2/50 p-3.5">
                <Skeleton height="h-9" width="w-9" radius="rounded-[10px]" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton height="h-4" width="w-2/3" />
                  <Skeleton height="h-3.5" width="w-5/6" />
                </div>
                <Skeleton height="h-9" width="w-9" radius="rounded-control" />
              </li>
            ))}
          </ul>
        }
      >
        {(d) => (
          <div className="flex flex-col gap-3">
            {d.scannerFreshness && d.scannerFreshness.level === "stale" ? (
              <p className="text-caption text-warning">From a stale scan — re-run the scanner for current signals.</p>
            ) : null}
            <ul role="list" aria-label="Radar candidates" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {d.opportunities.slice(0, 5).map((o) => (
                <RadarTile key={o.symbol} o={o} isNew={newSymbols.has(o.symbol.toUpperCase())} />
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Footer — sits directly below the last tile; counts from the real watchlist */}
      <div className="mx-5.5 mt-4 flex items-center justify-between gap-2 border-t border-hairline py-4.5">
        <span className="text-[13px] text-muted">
          Watchlist: <span className="font-mono tabular-nums">{buyCount}</span> buy{buyCount === 1 ? "" : "s"},{" "}
          <span className="font-mono tabular-nums">{nearBuyCount}</span> near-buy{nearBuyCount === 1 ? "" : "s"}
        </span>
        <Link
          href="/watchlist"
          className="group/open inline-flex items-center gap-1 rounded-control text-sm font-medium text-brand outline-none transition-colors hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          Open
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}
