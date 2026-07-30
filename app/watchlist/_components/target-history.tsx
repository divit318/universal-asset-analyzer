"use client";

/**
 * Target revision history.
 *
 * Lives inside the expanded row and loads on demand, which is the answer to
 * "without cluttering the main table": history is per-symbol, several entries
 * deep, and read rarely — so it earns a place behind one click but not a column.
 * The list payload carries only a *count*, so the row can decide whether the
 * affordance is worth showing at all without fetching anything.
 *
 * What it is for: reviewing your own changes of mind. A target quietly walked
 * from $260 to $220 to $180 as a stock fell is the single most useful piece of
 * evidence that a thesis was drifting to fit the price, and it was previously
 * unrecoverable — each edit overwrote the last.
 */

import { useCallback, useState } from "react";
import type { TargetDirection, TargetRevision } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { formatAge } from "@/lib/watchlist-metrics";

const DIRECTION_LABEL: Record<TargetDirection, string> = { above: "exit", below: "buy limit" };

/** Percent change between two targets, or null when one side is absent. */
function revisionDelta(revision: TargetRevision): number | null {
  const { previousTarget: from, newTarget: to } = revision;
  if (from == null || to == null || from <= 0) return null;
  return ((to - from) / from) * 100;
}

function describe(revision: TargetRevision): { headline: string; tone: string; glyph: string } {
  const { previousTarget: from, newTarget: to } = revision;
  if (from == null && to != null) return { headline: "Target set", tone: "text-brand", glyph: "+" };
  if (from != null && to == null) return { headline: "Target cleared", tone: "text-muted", glyph: "×" };
  const delta = revisionDelta(revision);
  if (delta == null) return { headline: "Target changed", tone: "text-muted", glyph: "→" };
  if (delta > 0) return { headline: "Raised", tone: "text-positive", glyph: "↑" };
  if (delta < 0) return { headline: "Cut", tone: "text-negative", glyph: "↓" };
  // Same number, different trigger direction.
  return { headline: "Trigger changed", tone: "text-muted", glyph: "→" };
}

export function TargetHistory({
  symbol,
  currency,
  revisionCount,
}: {
  symbol: string;
  currency: string;
  revisionCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<TargetRevision[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetched from the toggle handler rather than from an effect on `open`.
   *
   * Opening a disclosure is a user action, and modelling it as one keeps the
   * request out of the render cycle entirely — no synchronous setState in an
   * effect, no cleanup race between a fast double-click and an in-flight
   * response. Fetched at most once per mount; the panel closes and reopens
   * against already-loaded data.
   */
  const toggle = useCallback(() => {
    const opening = !open;
    setOpen(opening);
    // Outside the state updater on purpose: React may invoke an updater twice in
    // StrictMode, which would fire the request twice.
    if (!opening || revisions != null || loading) return;
    setLoading(true);
    setError(null);
    fetch(`/api/watchlist/target-history?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Could not load target history");
        setRevisions(json.revisions as TargetRevision[]);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Could not load target history");
      })
      .finally(() => setLoading(false));
  }, [open, revisions, loading, symbol]);

  // Nothing has ever been recorded — say nothing rather than showing an empty box.
  if (revisionCount === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 self-start rounded-control text-[10px] font-semibold uppercase tracking-widest text-muted/60 transition-colors hover:text-foreground"
      >
        <span aria-hidden="true" className="text-[9px]">{open ? "▾" : "▸"}</span>
        Target history
        <span className="font-mono normal-case tracking-normal text-muted/50">
          {revisionCount} change{revisionCount === 1 ? "" : "s"}
        </span>
      </button>

      {open && (
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          {loading && <p className="text-[11px] text-muted">Loading…</p>}
          {error && <p role="alert" className="text-[11px] text-negative">{error}</p>}
          {revisions != null && revisions.length === 0 && (
            <p className="text-[11px] text-muted">No changes recorded yet.</p>
          )}
          {revisions != null && revisions.length > 0 && (
            <ol className="flex flex-col gap-2">
              {revisions.map((rev) => {
                const { headline, tone, glyph } = describe(rev);
                const delta = revisionDelta(rev);
                return (
                  <li key={rev.id} className="flex gap-2 text-[11px]">
                    <span aria-hidden="true" className={`mt-px shrink-0 font-mono ${tone}`}>{glyph}</span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className={`font-medium ${tone}`}>{headline}</span>
                        <span className="font-mono tabular-nums text-muted">
                          {rev.previousTarget != null ? formatCurrency(rev.previousTarget, currency) : "—"}
                          {" → "}
                          <span className="text-foreground">
                            {rev.newTarget != null ? formatCurrency(rev.newTarget, currency) : "—"}
                          </span>
                        </span>
                        {delta != null && delta !== 0 && (
                          <span className={`font-mono tabular-nums ${tone}`}>({formatPercent(delta)})</span>
                        )}
                        {rev.newDirection && rev.newDirection !== rev.previousDirection && (
                          <span className="rounded-full border border-border px-1.5 text-[9px] uppercase tracking-wide text-muted">
                            {DIRECTION_LABEL[rev.newDirection]}
                          </span>
                        )}
                        <span
                          className="text-muted/60"
                          title={new Date(rev.changedAt).toLocaleString("en-US")}
                        >
                          {formatAge(new Date(rev.changedAt).toISOString())}
                        </span>
                      </span>
                      {rev.note && <span className="italic text-muted/90">“{rev.note}”</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
