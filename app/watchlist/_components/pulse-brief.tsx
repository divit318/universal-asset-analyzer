"use client";

/**
 * The triage ledger — the first thing the page says, before any table.
 *
 * Answers exactly two questions on arrival: "what happened since I last
 * looked?" and "which names deserve my attention right now, and why?" The
 * layer is deliberately a ranked LIST, not a card grid: triage is a reading
 * order, and the strongest claim on the user's attention reads first, with its
 * evidence as chips beside it. Clicking a line opens that row's decision file
 * in the table below.
 *
 * Honesty rules, enforced here:
 * - No numeric "attention score" is ever shown. Reasons are the product.
 * - The quiet state says so in one line and takes no more space than that.
 * - The baseline time is always stated, because "since your last visit" is a
 *   claim about a specific moment.
 * - Reasons derive from live prices + delivered alerts + persisted events —
 *   deterministic, and each chip names its evidence.
 */

import { agoLabel } from "@/lib/provenance";
import type { AttentionResult, SinceVisitSummary } from "@/lib/watchlist-pulse";

export interface PulseBriefRow {
  symbol: string;
  name: string;
  attention: AttentionResult;
}

const CHIP_TONE: Record<string, string> = {
  positive: "border-positive/30 bg-positive/[0.08] text-positive",
  negative: "border-negative/30 bg-negative/[0.08] text-negative",
  warning: "border-warning/30 bg-warning/[0.08] text-warning",
  neutral: "border-border bg-surface-2 text-muted",
};

function summaryPhrases(s: SinceVisitSummary): string[] {
  const parts: string[] = [];
  if (s.targetsCrossed > 0) parts.push(`${s.targetsCrossed} crossed your target`);
  if (s.alertsFired > 0) parts.push(`${s.alertsFired} fired alert${s.alertsFired === 1 ? "" : "s"}`);
  if (s.newDevelopments > 0) parts.push(`${s.newDevelopments} with new developments`);
  if (s.earningsSoon > 0) parts.push(`${s.earningsSoon} reporting within a week`);
  return parts;
}

export function PulseBrief({
  rows,
  summary,
  baselineAt,
  firstVisit,
  loading,
  error,
  checkingCount,
  onOpenRow,
  onShowAll,
}: {
  /** Rows at act/watch level, strongest first, already capped by the caller. */
  rows: PulseBriefRow[];
  summary: SinceVisitSummary;
  baselineAt: number | null;
  firstVisit: boolean;
  loading: boolean;
  error: string | null;
  /** Names whose news/filings are being checked in the background. */
  checkingCount: number;
  onOpenRow: (symbol: string) => void;
  /** Applies the "Needs attention" filter to the table. */
  onShowAll: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-3.5" aria-busy="true">
        <div className="h-3 w-56 animate-pulse rounded bg-surface-2" />
        <div className="mt-2.5 h-3 w-80 animate-pulse rounded bg-surface-2 opacity-60" />
      </div>
    );
  }

  const since =
    baselineAt != null ? `since your last visit (${agoLabel(baselineAt)})` : "since your last visit";

  /* A failed pulse degrades, it does not blank: live-price signals (crossed or
     approaching targets) are computed client-side and still deserve the queue.
     Only when there is also nothing live to show does the error stand alone. */
  if (error && rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface px-5 py-3 text-xs text-muted">
        Change tracking is unavailable right now ({error}). Prices, targets and alerts below are unaffected.
      </p>
    );
  }

  if (firstVisit) {
    return (
      <p className="rounded-xl border border-border bg-surface px-5 py-3 text-xs text-muted">
        <span className="font-semibold text-foreground">First visit recorded.</span> From your next visit on, this
        space opens with what changed while you were away — crossed targets, fired alerts, new developments.
      </p>
    );
  }

  const phrases = summaryPhrases(summary);

  if (rows.length === 0) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-2 rounded-xl border border-border bg-surface px-5 py-3 text-xs">
        <span className="font-semibold text-positive">Nothing needs your attention.</span>
        <span className="text-muted">
          {summary.quiet} name{summary.quiet === 1 ? "" : "s"} quiet {since}.
          {checkingCount > 0 && ` Checking ${checkingCount} for developments…`}
        </span>
      </p>
    );
  }

  return (
    <section aria-label="Needs attention" className="overflow-hidden rounded-xl border border-brand/25 bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border bg-brand/[0.04] px-5 py-2.5">
        {/* The count IS the filter — clicking it narrows the table to these
            names, the same contract as the header's alert chip. */}
        <button
          type="button"
          onClick={onShowAll}
          title="Filter the table to the names that need attention"
          className="rounded-control text-label font-semibold uppercase tracking-widest text-brand/80 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          Needs attention · {rows.length}
        </button>
        <p className="text-[11px] text-muted">
          {error
            ? "change tracking unavailable — reasons from live prices only"
            : `${phrases.length > 0 ? `${phrases.join(" · ")} — ` : ""}${summary.quiet} quiet, ${since}`}
          {checkingCount > 0 && ` · checking ${checkingCount}…`}
        </p>
      </header>
      <ol className="divide-y divide-hairline">
        {rows.map((r) => (
          <li key={r.symbol}>
            <button
              type="button"
              onClick={() => onOpenRow(r.symbol)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40"
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  r.attention.level === "act" ? "bg-alert" : "bg-warning"
                }`}
              />
              <span className="w-14 shrink-0 font-mono text-sm font-semibold text-brand">{r.symbol}</span>
              <span className="hidden max-w-40 truncate text-[11px] text-muted sm:block">{r.name}</span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {r.attention.signals.slice(0, 3).map((s) => (
                  <span
                    key={s.kind}
                    title={s.detail ?? undefined}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${CHIP_TONE[s.tone]}`}
                  >
                    {s.label}
                  </span>
                ))}
                {r.attention.signals[0]?.detail && (
                  <span className="hidden min-w-0 truncate text-[11px] text-muted/80 lg:inline">
                    {r.attention.signals[0].detail}
                  </span>
                )}
              </span>
              <span aria-hidden="true" className="shrink-0 text-xs text-muted/50">
                →
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
