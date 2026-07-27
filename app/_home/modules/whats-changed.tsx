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

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, GitCompareArrows } from "lucide-react";
import type { HomeChange, HomeChangeTone } from "@/lib/home/contracts";
import { SymbolTag } from "../_atmosphere/symbol-link";
import { useHomeSlice } from "../home-provider";

const MAX_CHIPS = 5;

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
  const [expanded, setExpanded] = useState(false);

  const data = state.data;
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

  if (data.firstVisit) {
    return (
      <div id="whats-changed" className="flex items-center gap-3 rounded-card border border-border/60 bg-surface/60 px-4 py-2.5">
        {label}
        <span className="text-[11px] text-muted">First visit — from now on, what moved while you were away shows up here.</span>
      </div>
    );
  }

  if (data.changes.length === 0) {
    return (
      <div id="whats-changed" className="flex items-center gap-3 rounded-card border border-border/60 bg-surface/60 px-4 py-2.5">
        {label}
        <span className="text-[11px] text-muted">Nothing material changed. Your queue and scores are where you left them.</span>
      </div>
    );
  }

  const chips = data.changes.slice(0, MAX_CHIPS);
  const overflow = data.changes.length - chips.length;

  return (
    <div id="whats-changed" className="uaa-card flex flex-col px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {label}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <ChangeChip key={c.id} c={c} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="inline-flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-[11px] font-medium text-brand outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={2} />
          {expanded ? "Less" : overflow > 0 ? `Details (+${overflow})` : "Details"}
        </button>
      </div>

      {expanded ? (
        <ul className="mt-2 flex flex-col divide-y divide-hairline border-t border-hairline pt-1">
          {data.changes.map((c) => (
            <DetailRow key={c.id} c={c} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
