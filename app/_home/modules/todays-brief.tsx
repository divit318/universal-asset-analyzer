"use client";

/**
 * AI Executive Brief — the hero, and the UAA signature screen.
 *
 * The institutional morning note: the AI headline (or the digest's deterministic
 * briefing until/instead of it), a living regime indicator, the strip of figures
 * that headline is about (value, today's move, health grade, actions), the top
 * contributor/detractor, an honest reading-time estimate, and the three verbs
 * that start the day.
 *
 * Unlike the other modules this one does not use ModuleShell: the hero is a
 * bespoke, cinematic surface — a lit pane of glass floating over the page's
 * Aurora — not a card in the grid. It still selects its slices through
 * `useHomeSlice`, so it fetches nothing and shares the one digest request, and
 * it is always able to render *something true* (the deterministic fallback ships
 * in the digest), so it never blocks on Ollama.
 */

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight, ExternalLink, X, Clock, Trophy, TrendingDown } from "lucide-react";
import { getHomeModule } from "@/lib/home/registry";
import { fmtSignedPct, fmtMoney } from "../_viz/format";
import { useCountUp } from "../_atmosphere/use-count-up";
import { SymbolTag } from "../_atmosphere/symbol-link";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("todays-brief");

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
 *  badge always agree. */
function regimeTone(trend: string | null | undefined): { dot: string; text: string } {
  if (!trend) return { dot: "bg-brand", text: "text-brand" };
  const t = trend.toLowerCase();
  if (t.includes("off") || t.includes("bear") || t.includes("defensive"))
    return { dot: "bg-warning", text: "text-warning" };
  if (t.includes("on") || t.includes("bull") || t.includes("expansion"))
    return { dot: "bg-positive", text: "text-positive" };
  return { dot: "bg-brand", text: "text-brand" };
}

/** A hero figure: micro label over a large tabular value, separated by a hairline. */
function Stat({
  label,
  value,
  tone = "text-foreground",
  primary = false,
}: {
  label: string;
  value: string;
  tone?: string;
  primary?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label uppercase tracking-[0.14em] text-faint">{label}</span>
      <span
        className={`font-mono font-semibold tabular-nums tracking-tight ${tone} ${
          primary ? "text-2xl leading-none sm:text-[30px]" : "text-lg leading-none"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function TodaysBriefModule() {
  const { brief, refreshBrief } = useHome();
  const fallbackSlice = useHomeSlice("fallbackBriefing");
  const pulse = useHomeSlice("portfolioPulse");
  const actions = useHomeSlice("recommendedActions");
  const market = useHomeSlice("marketIntelligence");
  const activity = useHomeSlice("activity");
  const [dismissed, setDismissed] = useState(false);

  // Resume chip — the retired `continue` module's job, folded into the brief's
  // footer (§4.1). The most recent place the user was working.
  const resume = activity.data?.entries?.[0] ?? null;

  const headline = brief.data?.headline || fallbackSlice.data || "";
  const isAi = !!brief.data?.headline && brief.data.aiGenerated;
  const loading = !headline && fallbackSlice.status === "loading";

  const readLabel = useMemo(() => {
    const note = brief.data?.note;
    const noteText = note ? Object.values(note).flat().join(" ") : "";
    return readingTime(`${headline} ${noteText}`);
  }, [headline, brief.data?.note]);

  const p = pulse.data;
  const hasPulse = !!p && p.status !== "empty";
  const actionCount = actions.data?.actions.length ?? 0;
  const regime = market.data?.regime?.trend ?? null;
  const tone = regimeTone(regime);

  // The one place the hero's chrome borrows a data colour: a hairline accent on
  // the top edge, driven by the portfolio's move today (green up / red down),
  // or a neutral machined line when there's no book yet.
  const accentLine = hasPulse
    ? p!.todayChangePct >= 0
      ? "var(--positive)"
      : "var(--negative)"
    : "color-mix(in oklab, var(--foreground) 16%, transparent)";

  // The signature roll-up. Hooks run unconditionally; the values only surface
  // when there's a portfolio to show.
  const animValue = useCountUp(hasPulse ? p!.totalValue : 0);
  const animToday = useCountUp(hasPulse ? p!.todayChangePct : 0);

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

  return (
    <div
      className="uaa-hero uaa-topline relative h-full overflow-hidden"
      style={{ "--accent-line": accentLine } as CSSProperties}
    >
      <div className="relative flex h-full flex-col gap-4 p-5 sm:p-7">
        {/* Eyebrow + live regime + meta */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} /> AI Executive Brief
            </span>
            {regime ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-surface-2 px-2 py-0.5">
                <span className={`uaa-breathe h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${tone.text}`}>{regime}</span>
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" strokeWidth={2} /> {readLabel}
            </span>
            {isAi ? (
              <span className="rounded-full bg-brand/10 px-1.5 py-0.5 font-medium text-brand">AI</span>
            ) : (
              <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-medium text-muted">Computed</span>
            )}
          </div>
        </div>

        {/* The headline — the moment. */}
        {loading ? (
          <div className="flex flex-1 flex-col gap-2.5 py-2">
            <div className="h-6 w-3/4 animate-pulse rounded bg-surface-2" />
            <div className="h-6 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-6 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        ) : (
          <p className="max-w-[46ch] text-balance text-[26px] font-semibold leading-[1.16] tracking-[-0.022em] text-foreground sm:text-[31px] sm:leading-[1.12]">
            {headline}
          </p>
        )}

        {/* Contributor / detractor line — read straight from the pulse. */}
        {p && (p.bestPerformer || p.worstPerformer) ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            {p.bestPerformer ? (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <Trophy className="h-3.5 w-3.5 text-positive" strokeWidth={2} />
                Top{" "}
                <SymbolTag symbol={p.bestPerformer.symbol} className="font-mono font-semibold text-foreground">
                  {p.bestPerformer.symbol}
                </SymbolTag>
                <span className="font-mono text-positive">{fmtSignedPct(p.bestPerformer.changePct)}</span>
              </span>
            ) : null}
            {p.worstPerformer ? (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <TrendingDown className="h-3.5 w-3.5 text-negative" strokeWidth={2} />
                Weakest{" "}
                <SymbolTag symbol={p.worstPerformer.symbol} className="font-mono font-semibold text-foreground">
                  {p.worstPerformer.symbol}
                </SymbolTag>
                <span className="font-mono text-negative">{fmtSignedPct(p.worstPerformer.changePct)}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {/* The hero figure strip — large tabular numbers, hairline-divided. */}
        <div className="mt-auto flex flex-wrap items-end gap-x-7 gap-y-4 border-t border-hairline pt-4">
          {hasPulse ? (
            <>
              <Stat label="Portfolio Value" value={fmtMoney(animValue)} primary />
              <Stat
                label="Today"
                value={fmtSignedPct(animToday)}
                tone={p!.todayChangePct >= 0 ? "text-positive" : "text-negative"}
              />
              {p!.healthGrade ? (
                <Stat label="Grade" value={`${p!.healthGrade} · ${p!.healthScore ?? "—"}`} />
              ) : null}
            </>
          ) : null}
          <Stat
            label="Actions"
            value={String(actionCount)}
            tone={actionCount > 0 ? "text-brand" : "text-muted"}
          />
        </div>

        {/* The three verbs. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={scrollToActions}
            className="inline-flex items-center gap-1.5 rounded-control bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Open Action Center <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
          <Link
            href="/portfolio"
            className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface-2 px-3 py-2 text-xs font-medium text-foreground outline-none transition-colors hover:border-brand/40 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} /> Open Portfolio
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-2 text-xs font-medium text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} /> Dismiss
          </button>
          {brief.status === "loading" && !isAi ? (
            <button
              type="button"
              onClick={refreshBrief}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-foreground"
            >
              <span className="uaa-breathe h-1.5 w-1.5 rounded-full bg-brand" /> Writing AI brief…
            </button>
          ) : null}
        </div>

        {/* Resume chip — pick up where you left off (§4.1 footer). */}
        {resume ? (
          <Link
            href={resume.href}
            className="inline-flex w-fit items-center gap-1.5 text-[11px] text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <span className="text-faint">Resume:</span>
            <span className="font-medium text-foreground/80">{resume.label}</span>
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
