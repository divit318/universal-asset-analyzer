"use client";

/**
 * What Changed — the change-detection band (§ Decision Dashboard: deltas first).
 *
 * A slim full-width strip between the command row and the Attention Queue:
 * "since your last visit" as ranked chips, expandable to the auditable
 * before → after sentences. The diff itself is computed server-side
 * (lib/home/changes.ts) against the previous session's baseline; this module
 * renders it and adds nothing.
 *
 * Three honest states, all quiet:
 *   - first visit ever  → one line saying deltas start next visit
 *   - no material change → one line saying so, with the baseline time
 *   - changes            → the chips
 * A dashboard that invents "changes" to fill this band would teach the user to
 * ignore it, which is worse than not having it.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, GitCompareArrows, Sparkles } from "lucide-react";
import type { HomeChange, HomeChangeTone } from "@/lib/home/contracts";
import { SymbolTag } from "../_atmosphere/symbol-link";
import { useHome, useHomeSlice } from "../home-provider";

const MAX_CHIPS = 5;

/**
 * First sentence of the brief's headline — the AI's one surviving line on the
 * default page (audit 06 restructure B: the verdict captions the diff it
 * summarizes; the retired hero gave a restatement 34px and half the fold).
 */
function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(?:\s|$)/);
  return m ? m[1] : text;
}

/**
 * Collapses per-symbol chips of one kind into a single reference chip (audit
 * RD-06): "New idea: ALL fits your book (79)" four times is one fact, "4 new
 * ideas in the Radar", stated once and pointed at its owner.
 */
function groupChanges(changes: HomeChange[]): HomeChange[] {
  const ideaChips = changes.filter((c) => c.kind === "opportunity-new");
  if (ideaChips.length < 2) return changes;
  const grouped: HomeChange = {
    id: "grouped-ideas",
    kind: "opportunity-new",
    tone: "new",
    headline: `${ideaChips.length} new ideas in the Radar`,
    detail: ideaChips.map((c) => c.headline).join(" · "),
    symbol: null,
    href: "#radar",
    magnitude: Math.max(...ideaChips.map((c) => c.magnitude)),
  };
  const rest = changes.filter((c) => c.kind !== "opportunity-new");
  return [grouped, ...rest].sort((a, b) => b.magnitude - a.magnitude);
}

const TONE_CHIP: Record<HomeChangeTone, string> = {
  improved: "border-positive/30 text-positive bg-positive/8",
  worsened: "border-negative/30 text-negative bg-negative/8",
  new: "border-brand/30 text-brand bg-brand/8",
  neutral: "border-border text-muted bg-surface-2/60",
};

const TONE_DOT: Record<HomeChangeTone, string> = {
  improved: "bg-positive",
  worsened: "bg-negative",
  new: "bg-brand",
  neutral: "bg-foreground/40",
};

function sinceLabel(iso: string): string {
  const at = new Date(iso);
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return `${at.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`;
}

function ChangeChip({ c }: { c: HomeChange }) {
  const body = (
    <>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[c.tone]}`} aria-hidden />
      <span className="truncate text-[11px] font-medium">{c.headline}</span>
    </>
  );
  const cls = `inline-flex max-w-[280px] items-center gap-1.5 rounded-full border px-2.5 py-1 outline-none transition-colors ${TONE_CHIP[c.tone]}`;
  return c.href ? (
    <Link href={c.href} className={`${cls} hover:border-current focus-visible:ring-2 focus-visible:ring-brand/40`} title={c.detail}>
      {body}
    </Link>
  ) : (
    <span className={cls} title={c.detail}>
      {body}
    </span>
  );
}

function DetailRow({ c }: { c: HomeChange }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[c.tone]}`} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[12px] font-medium text-foreground/90">
          {c.symbol ? (
            <SymbolTag symbol={c.symbol} className="font-mono text-[12px] font-semibold text-foreground">
              {c.symbol}
            </SymbolTag>
          ) : null}
          {c.headline}
        </span>
        <span className="text-[11px] leading-snug text-muted">{c.detail}</span>
      </div>
      {c.href ? (
        <Link href={c.href} className="shrink-0 pt-0.5 text-[11px] font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40">
          Open →
        </Link>
      ) : null}
    </li>
  );
}

export function WhatsChangedModule() {
  const state = useHomeSlice("changes");
  const fallback = useHomeSlice("fallbackBriefing");
  const { brief } = useHome();
  const [expanded, setExpanded] = useState(false);

  const data = state.data;
  const grouped = useMemo(() => (data ? groupChanges(data.changes) : []), [data]);

  // The AI's one line on the default page. Deterministic fallback until (or
  // instead of) the model's text; the full note lives in the disclosure.
  const headline = brief.data?.headline || fallback.data || "";
  const verdict = headline ? firstSentence(headline) : null;
  const isAi = !!brief.data?.headline && brief.data.aiGenerated;
  const note = brief.data?.note ?? null;

  // A loading or degraded change feed renders nothing at all: this band earns
  // its place by having something true to say, never by holding space.
  if (!data || data.status === "degraded") return null;

  const label = (
    <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
      <GitCompareArrows className="h-3.5 w-3.5" strokeWidth={2} />
      Since last visit
      {data.baselineAt ? <span className="font-normal normal-case tracking-normal text-faint">· {sinceLabel(data.baselineAt)}</span> : null}
    </span>
  );

  // The verdict row: the AI's (or the deterministic briefing's) one sentence,
  // labelled for what it is, with the full morning note in the disclosure.
  const verdictRow = verdict ? (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-hairline pt-2">
      <span className="inline-flex shrink-0 translate-y-px items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand/80">
        <Sparkles className="h-3 w-3" strokeWidth={2.5} aria-hidden />
        {isAi ? "AI read" : "Computed"}
      </span>
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-foreground/85">{verdict}</p>
      {brief.data?.generatedAt && isAi ? (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
          {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(brief.data.generatedAt))}
        </span>
      ) : null}
    </div>
  ) : null;

  const emptyLine = data.firstVisit
    ? "First visit. From now on, what moved while you were away shows up here."
    : grouped.length === 0
      ? "Nothing material changed. Your queue and scores are where you left them."
      : null;

  const chips = grouped.slice(0, MAX_CHIPS);
  const overflow = grouped.length - chips.length;
  const hasDisclosure = grouped.length > 0 || note != null;

  return (
    <div id="whats-changed" className="uaa-card flex flex-col px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {label}
        {emptyLine ? (
          <span className="min-w-0 flex-1 text-[11px] text-muted">{emptyLine}</span>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <ChangeChip key={c.id} c={c} />
            ))}
          </div>
        )}
        {hasDisclosure ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="inline-flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-[11px] font-medium text-brand outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={2} />
            {expanded ? "Less" : overflow > 0 ? `Details (+${overflow})` : note ? "Morning note" : "Details"}
          </button>
        ) : null}
      </div>

      {verdictRow ? <div className="mt-2">{verdictRow}</div> : null}

      {expanded ? (
        <>
          {grouped.length > 0 ? (
            <ul className="mt-2 flex flex-col divide-y divide-hairline border-t border-hairline pt-1">
              {grouped.map((c) => (
                <DetailRow key={c.id} c={c} />
              ))}
            </ul>
          ) : null}
          {note ? (
            <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 border-t border-hairline pt-3 sm:grid-cols-2">
              {(
                [
                  ["Regime", note.regime],
                  ["Portfolio", note.portfolio],
                  ["Opportunities", note.opportunities],
                  ["Risks", note.risks],
                  ["Sectors", note.sectors],
                  ["Macro", note.macro],
                ] as const
              )
                .filter(([, text]) => !!text)
                .map(([title, text]) => (
                  <div key={title} className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{title}</span>
                    <p className="text-[12px] leading-relaxed text-foreground/80">{text}</p>
                  </div>
                ))}
              {note.recommendations.length > 0 ? (
                <div className="flex flex-col gap-0.5 sm:col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Recommendations</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] leading-relaxed text-foreground/80">
                    {note.recommendations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
