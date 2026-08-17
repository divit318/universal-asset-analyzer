"use client";

/**
 * AI Executive Brief — the hero, and the UAA signature screen.
 *
 * The institutional morning note, machined into four bands:
 *
 *   1. Header — eyebrow + live regime, and the visit's meta (what changed,
 *      reading time, generation time) on one line.
 *   2. KPI strip — the four figures the headline is about (value, today's
 *      move, alignment score, actions), promoted ABOVE the narrative so the
 *      numbers land before the prose does.
 *   3. Narrative — the AI headline split client-side into a display-size
 *      verdict (first sentence) and a receding supporting paragraph.
 *   4. Context + actions — the session note and the day's movers, then the
 *      three verbs that start the day (Open Action Center / Resume / Dismiss).
 *
 * Unlike the other modules this one does not use ModuleShell: the hero is a
 * bespoke, cinematic surface — a lit pane of glass floating over the page —
 * not a card in the grid. It still selects its slices through `useHomeSlice`,
 * so it fetches nothing and shares the one digest request, and it is always
 * able to render *something true* (the deterministic fallback ships in the
 * digest), so it never blocks on the AI.
 */

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight, CirclePlay } from "lucide-react";
import { explainAlignment } from "@/lib/home/explain";
import { fmtSignedPct, fmtSignedMoney, fmtMoney, alignmentToneViz } from "../_viz/format";
import { MetricDelta } from "../_viz/stamped";
import { SymbolTag } from "../_atmosphere/symbol-link";
import { ExplainableValue } from "../_atmosphere/explain-popover";
import { useHome, useHomeSlice } from "../home-provider";
import { Skeleton } from "@/app/_components/ui";

/** Reading-time estimate at ~200 wpm, floored so a two-sentence brief isn't "0s". */
function readingTime(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const secs = Math.max(15, Math.round((words / 200) * 60));
  return secs < 90 ? `${secs}s read` : `${Math.round(secs / 60)} min read`;
}

function scrollToActions() {
  document.getElementById("action-center")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Regime string → mood, matching the Aurora's reading so the room and the
 *  badge always agree. A neutral regime reads as muted slate — the amber
 *  accent is reserved for the CTA and the ACTIONS count. */
function regimeTone(trend: string | null | undefined): { dot: string; text: string } {
  if (!trend) return { dot: "bg-muted", text: "text-foreground/55" };
  const t = trend.toLowerCase();
  if (t.includes("off") || t.includes("bear") || t.includes("defensive"))
    return { dot: "bg-warning", text: "text-warning" };
  if (t.includes("on") || t.includes("bull") || t.includes("expansion"))
    return { dot: "bg-positive", text: "text-positive" };
  return { dot: "bg-muted", text: "text-foreground/55" };
}

/** The shared type scale's section label (11px / 600 / caps / 0.09em / 55%). */
const LABEL = "text-[11px] font-semibold uppercase tracking-[0.09em] text-foreground/55";
/** Every number on the page renders in the mono face with tabular figures. */
const NUM = "font-mono tabular-nums";

/**
 * Splits the brief's single text block into a verdict (the first sentence) and
 * the supporting paragraph — presentation only, the generation prompt is
 * untouched. The lookahead for a capital keeps decimals ("+0.1%,") and most
 * abbreviations from ending the verdict early.
 */
function splitNarrative(text: string): { verdict: string; support: string } {
  const m = text.match(/^(.+?[.!?])\s+(?=[A-Z0-9"'])([\s\S]+)$/);
  return m ? { verdict: m[1], support: m[2] } : { verdict: text, support: "" };
}

/** Matches the numeric tokens prose can carry: +0.1%, $3.49M, 27%, Aug 6… */
const NUMERIC_TOKEN = /([+\-−]?\$?\d[\d,.]*[%KMB]?)/g;

/**
 * Renders a prose string with every numeric token in the mono face with
 * tabular figures — the type system's "no exceptions" rule, applied without
 * asking the model to mark its own numbers up.
 */
function MonoNumbers({ text }: { text: string }) {
  const parts = text.split(NUMERIC_TOKEN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={NUM}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** A KPI cell: section label over a 30px tabular-mono value on a shared baseline. */
function Kpi({
  label,
  value,
  tone = "text-foreground",
  caption,
  captionTone = "text-foreground/60",
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  caption?: string;
  captionTone?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className={LABEL}>{label}</span>
      <span className={`${NUM} text-[30px] font-semibold leading-none ${tone}`}>{value}</span>
      {caption ? <span className={`${NUM} text-sm leading-tight ${captionTone}`}>{caption}</span> : null}
    </div>
  );
}

export function TodaysBriefModule() {
  const { brief, refreshBrief, refreshDigest } = useHome();
  const fallbackSlice = useHomeSlice("fallbackBriefing");
  const pulse = useHomeSlice("portfolioPulse");
  const actions = useHomeSlice("recommendedActions");
  const attention = useHomeSlice("attention");
  const market = useHomeSlice("marketIntelligence");
  const activity = useHomeSlice("activity");
  const changes = useHomeSlice("changes");
  const [dismissed, setDismissed] = useState(false);

  // The header's change chip: counts only, worst tone first — the full ranked
  // list lives in the change band this chip scrolls to.
  const changeSummary = useMemo(() => {
    const feed = changes.data;
    if (!feed || feed.firstVisit || feed.changes.length === 0) return null;
    return {
      count: feed.changes.length,
      worsened: feed.changes.filter((c) => c.tone === "worsened").length,
      fresh: feed.changes.filter((c) => c.tone === "new").length,
    };
  }, [changes.data]);

  // Resume chip — the retired `continue` module's job, folded into the brief's
  // action row (§4.1). The most recent place the user was working.
  const resume = activity.data?.entries?.[0] ?? null;

  const headline = brief.data?.headline || fallbackSlice.data || "";
  const isAi = !!brief.data?.headline && brief.data.aiGenerated;
  const loading = !headline && fallbackSlice.status === "loading";
  // A failed digest is an ERROR, not a quiet day: without this branch the hero
  // rendered "ACTIONS 0", a "15s read" of nothing, and a live CTA over a dead
  // page (audit ST-02).
  const failed = !headline && fallbackSlice.status === "error";
  const narrative = useMemo(() => splitNarrative(headline), [headline]);

  const readLabel = useMemo(() => {
    const note = brief.data?.note;
    const noteText = note ? Object.values(note).flat().join(" ") : "";
    return readingTime(`${headline} ${noteText}`);
  }, [headline, brief.data?.note]);

  const p = pulse.data;
  const hasPulse = !!p && p.status !== "empty";
  // The queue's true open count — the SAME number the Attention header shows,
  // so the stat and the surface it points at can never disagree (audit NI-04:
  // "ACTIONS 1" sat above a CTA that landed on "19 open"). Null until loaded;
  // never coerced to 0 (that fabricates an all-clear on error, ST-02).
  const openCount = attention.data ? attention.data.openCount : null;
  const decisionCount = actions.data ? actions.data.actions.length : null;
  const regime = market.data?.regime?.trend ?? null;
  const tone = regimeTone(regime);
  const alignTone = hasPulse ? alignmentToneViz(p!.alignmentScore) : null;

  // The one place the hero's chrome borrows a data colour: a hairline accent on
  // the top edge, driven by the portfolio's move today (green up / red down),
  // or a neutral machined line when there's no book yet.
  const accentLine = hasPulse
    ? p!.todayChangePct >= 0
      ? "var(--positive)"
      : "var(--negative)"
    : "color-mix(in oklab, var(--foreground) 16%, transparent)";

  if (failed) {
    return (
      <div className="uaa-hero uaa-topline relative flex h-full min-h-48 flex-col items-start justify-center gap-3 overflow-hidden px-7 py-6">
        <span className={`inline-flex items-center gap-2 ${LABEL}`}>
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} /> AI Executive Brief
        </span>
        <p className="text-base text-foreground/72">
          Couldn&apos;t load your dashboard. Nothing on this page is current until it reloads.
        </p>
        <button
          type="button"
          onClick={refreshDigest}
          className="inline-flex items-center gap-2 rounded-lg border border-foreground/12 px-5 py-2.5 text-sm font-medium text-foreground outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          Retry
        </button>
      </div>
    );
  }

  if (dismissed) {
    return (
      <div className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2.5 shadow-card">
        <span className="flex items-center gap-2 text-xs text-muted">
          <Sparkles className="h-3.5 w-3.5 text-brand" strokeWidth={2} /> Executive brief dismissed
        </span>
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className="text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          Show
        </button>
      </div>
    );
  }

  const hairline = <span aria-hidden className="h-3 w-px bg-foreground/10" />;

  return (
    <div
      className="uaa-hero uaa-topline relative h-full overflow-hidden"
      style={{ "--accent-line": accentLine } as CSSProperties}
    >
      <div className="relative flex h-full flex-col">
        {/* ── Band 1 · header — eyebrow + regime, then the visit's meta ── */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-foreground/8 px-7 py-5">
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-2 ${LABEL}`}>
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} /> AI Executive Brief
            </span>
            {regime ? (
              <span className="inline-flex items-center gap-1.5">
                <span className={`uaa-breathe h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                <span className={`${LABEL} ${tone.text}`}>{regime}</span>
              </span>
            ) : null}
            {!isAi && headline ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">Computed</span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-sm text-foreground/60">
            {changeSummary ? (
              <>
                <button
                  type="button"
                  onClick={() => document.getElementById("whats-changed")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
                    changeSummary.worsened > 0
                      ? "border-negative/30 text-negative hover:border-negative/60"
                      : "border-foreground/10 text-foreground/60 hover:border-foreground/25"
                  }`}
                >
                  <span className={NUM}>{changeSummary.count}</span> change{changeSummary.count === 1 ? "" : "s"}
                  {changeSummary.worsened > 0 ? (
                    <>
                      , <span className={NUM}>{changeSummary.worsened}</span> worsened
                    </>
                  ) : changeSummary.fresh > 0 ? (
                    <>
                      , <span className={NUM}>{changeSummary.fresh}</span> new
                    </>
                  ) : null}
                </button>
                {hairline}
              </>
            ) : null}
            {headline ? <span className={NUM}>{readLabel}</span> : null}
            {/* The brief's own as-of (audit F-22 amendment 1): a cached
                generation is honest about WHEN it was written. */}
            {brief.data?.generatedAt ? (
              <>
                {hairline}
                <span className={NUM}>
                  {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(brief.data.generatedAt))}
                </span>
              </>
            ) : null}
          </div>
        </div>

        {/* ── Band 2 · the KPI strip — the figures the headline is about ── */}
        <div className="px-7 py-7">
          <div className="grid grid-cols-2 gap-y-6 lg:grid-cols-4 lg:gap-y-0">
            {hasPulse ? (
              <>
                {/* Count-up animation removed (DESIGN §5 / DU): a value
                    interpolating for 760 ms is a false value on a page whose
                    whole point is true values. */}
                <Kpi label="Portfolio Value" value={fmtMoney(p!.totalValue)} className="pr-6" />
                <Kpi
                  label="Today"
                  value={fmtSignedPct(p!.todayChangePct)}
                  tone={p!.todayChangePct >= 0 ? "text-positive" : "text-negative"}
                  caption={fmtSignedMoney(p!.todayChangeDollar)}
                  captionTone={p!.todayChangeDollar >= 0 ? "text-positive" : "text-negative"}
                  className="border-l border-foreground/8 px-6"
                />
                {p!.alignmentScore != null ? (
                  <div className="flex flex-col gap-1 pr-6 lg:border-l lg:border-foreground/8 lg:px-6">
                    <span className={LABEL}>Alignment</span>
                    <ExplainableValue explanation={explainAlignment(p!)} underline={false}>
                      <span className={`${NUM} text-[30px] font-semibold leading-none ${alignTone!.text}`}>
                        {p!.alignmentScore}
                      </span>
                    </ExplainableValue>
                  </div>
                ) : null}
                <Kpi
                  label="Open items"
                  value={openCount != null ? String(openCount) : "—"}
                  tone={openCount != null && openCount > 0 ? "text-brand" : "text-muted"}
                  caption={decisionCount != null && decisionCount > 0 ? `${decisionCount} engine decision${decisionCount === 1 ? "" : "s"}` : undefined}
                  className="border-l border-foreground/8 pl-6"
                />
              </>
            ) : (
              <Kpi
                label="Open items"
                value={openCount != null ? String(openCount) : "—"}
                tone={openCount != null && openCount > 0 ? "text-brand" : "text-muted"}
              />
            )}
          </div>
        </div>
        <div aria-hidden className="mx-7 border-b border-foreground/8" />

        {/* ── Band 3 · narrative — the verdict, then the reasoning behind it ── */}
        {loading ? (
          <div className="flex flex-1 flex-col gap-3 px-7 py-7">
            <Skeleton height="h-9" width="w-3/4" />
            <Skeleton height="h-9" width="w-1/2" />
            <div className="mt-3 flex flex-col gap-2">
              <Skeleton height="h-4" />
              <Skeleton height="h-4" width="w-11/12" />
              <Skeleton height="h-4" width="w-4/5" />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-6 px-7 py-7">
            <p className="line-clamp-3 max-w-[68ch] text-balance text-[34px] font-semibold leading-[1.25] tracking-[-0.02em] text-foreground lg:line-clamp-2">
              <MonoNumbers text={narrative.verdict} />
            </p>
            {narrative.support ? (
              <p className="max-w-[68ch] text-base leading-[1.65] text-foreground/72">
                <MonoNumbers text={narrative.support} />
              </p>
            ) : null}
          </div>
        )}
        <div aria-hidden className="mx-7 border-b border-foreground/8" />

        {/* ── Band 4a · context — the session, and the day's movers, stamped (F-22g) ── */}
        {p && (p.sessionNote || p.bestPerformer || p.worstPerformer) ? (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-7 py-5">
              {p.sessionNote ? (
                <span className={LABEL}>
                  <MonoNumbers text={p.sessionNote} />
                </span>
              ) : null}
              {p.bestPerformer ? (
                <span className="inline-flex items-center gap-2 text-sm text-foreground/60">
                  Top{" "}
                  <SymbolTag symbol={p.bestPerformer.symbol} className={`${NUM} font-semibold text-foreground`}>
                    {p.bestPerformer.symbol}
                  </SymbolTag>
                  <MetricDelta metric={p.bestPerformer.dayChange} className="text-sm" suppressSessionLabel={!!p.sessionNote} />
                </span>
              ) : null}
              {p.bestPerformer && p.worstPerformer ? hairline : null}
              {p.worstPerformer ? (
                <span className="inline-flex items-center gap-2 text-sm text-foreground/60">
                  Weakest{" "}
                  <SymbolTag symbol={p.worstPerformer.symbol} className={`${NUM} font-semibold text-foreground`}>
                    {p.worstPerformer.symbol}
                  </SymbolTag>
                  <MetricDelta metric={p.worstPerformer.dayChange} className="text-sm" suppressSessionLabel={!!p.sessionNote} />
                </span>
              ) : null}
            </div>
            <div aria-hidden className="mx-7 border-b border-foreground/8" />
          </>
        ) : null}

        {/* ── Band 4b · the three verbs. The CTA names its destination (the
            Attention queue) and carries the SAME count as the stat above and
            the queue's own header (audit NI-04 / IA-05). It only renders once
            the queue has actually loaded — a live CTA over a dead page is a
            fabricated all-clear (ST-02). ── */}
        <div className="flex flex-wrap items-center gap-3 px-7 py-6">
          {openCount != null ? (
            <button
              type="button"
              onClick={scrollToActions}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-7 py-3.5 text-sm font-semibold text-background shadow-sm outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {openCount > 0 ? (
                <>
                  Open queue <span className={NUM}>({openCount})</span>
                </>
              ) : (
                "Queue is clear"
              )}{" "}
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          ) : null}
          {resume ? (
            <Link
              href={resume.href}
              title={resume.label}
              className="inline-flex items-center gap-2 rounded-lg border border-foreground/12 px-7 py-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <CirclePlay className="h-4 w-4 text-foreground/60" strokeWidth={2} />
              Resume: <span className={`${NUM} max-w-[10rem] truncate font-semibold`}>{resume.ref || resume.label}</span>
            </Link>
          ) : null}
          {brief.status === "loading" && !isAi ? (
            <button
              type="button"
              onClick={refreshBrief}
              className="inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
            >
              <span className="uaa-breathe h-1.5 w-1.5 rounded-full bg-muted" /> Writing AI brief…
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="ml-auto inline-flex items-center rounded-lg border border-foreground/8 px-5 py-3.5 text-sm font-medium text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
