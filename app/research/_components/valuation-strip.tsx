"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StripResponse } from "@/app/api/valuation/strip/route";
import { formatCurrency } from "@/lib/format";
import { IMPLIED_GROWTH_LABEL, IMPLIED_GROWTH_CAVEAT } from "@/lib/valuation/case";
import { marginOfSafetyTone } from "@/lib/valuation/dcf";

/**
 * The Research Hub's valuation strip — read-only, by design.
 *
 * Research observes; Valuation judges. This shows ONE valuation message and
 * links out, and cannot be edited here: two editable surfaces for one object
 * is how you get two answers to "what is this worth".
 *
 * Authority is earned by ownership. An untouched case is a machine seed, so it
 * renders as what it is — "what does today's price imply?" — and never as a
 * fair value or a margin of safety. A −237% margin of safety in red from a
 * case the user has never reviewed reads as the product arguing with its own
 * verdict two cards above. Only once at least one assumption is genuinely the
 * user's does the strip show their fair value and the margin against it.
 */

interface Props {
  symbol: string;
  /** The Hub already has this; passing it avoids a second quote fetch. */
  price: number | null;
}

export function ValuationStrip({ symbol, price }: Props) {
  const [data, setData] = useState<StripResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTimedOut(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    const query = new URLSearchParams({ symbol });
    if (price != null) query.set("price", String(price));
    // Hard deadline on the placeholder: after 10s the pulse unmounts (the
    // fetch keeps going — the strip appears if it eventually lands).
    const timer = setTimeout(() => { if (!cancelled) setTimedOut(true); }, 10_000);
    fetch(`/api/valuation/strip?${query.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<StripResponse>) : Promise.reject(new Error("failed"))))
      .then((json) => { if (!cancelled) setData(json); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [symbol, price]);

  // A valuation is optional context on this page: if it fails, say nothing.
  if (failed) return null;
  if (!data && timedOut) return null;

  const summary = data?.summary ?? null;
  const href = `/valuation?symbol=${encodeURIComponent(symbol)}`;

  // No case yet → render nothing. The Valuation workspace is reachable from
  // the nav; an inline "nothing here yet" banner is dead space on a research
  // page that should only show what exists.
  if (data && !summary) return null;

  if (!summary) {
    return (
      <div className="h-[52px] animate-pulse rounded-xl border border-border bg-surface" aria-hidden />
    );
  }

  const implied = summary.result.impliedGrowth;
  const owned = summary.ownedKeys.length > 0;

  /* ── Untouched seed: one message — what the price implies — and the honest
        status. No fair value, no margin of safety, no verdict color. ── */
  if (!owned) {
    // Nothing worth a row: an unreviewed seed with no solvable implied growth
    // has no one-line message to offer. The workspace stays one click away.
    if (implied == null) return null;

    // Only a history seed supports "vs delivered" — a reverse-DCF seed's growth
    // IS the implied rate, so comparing the two would compare a number to itself.
    const delivered = data?.seedGrowthSource === "history" ? data.seedGrowth : null;

    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-surface px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">{IMPLIED_GROWTH_LABEL}</span>
        <span className="font-mono text-sm font-semibold tabular-nums" title={IMPLIED_GROWTH_CAVEAT}>
          {implied.toFixed(1)}%
        </span>
        {delivered != null && (
          <span className="text-xs text-muted">
            vs {delivered >= 0 ? "+" : ""}{delivered.toFixed(1)}% delivered FCF growth
          </span>
        )}
        <span
          className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted"
          title="Auto-created from the price and balance sheet. It becomes your case once you review or adopt an assumption in the Valuation workspace."
        >
          UAA baseline · not reviewed
        </span>
        {/* The seeded row's action is authorship, and the link says so — "open"
            undersold what the click is for. */}
        <Link href={href} className="ml-auto shrink-0 text-xs font-medium text-brand hover:underline">
          Create your case →
        </Link>
      </div>
    );
  }

  /* ── Owned case: the user's own fair value has earned its authority. ── */
  const mos = summary.result.marginOfSafety;
  const mosTone = marginOfSafetyTone(mos);
  // Beyond −100% a percentage stops meaning anything to a human — say it as a
  // multiple instead ("price is 3.4× your case").
  const priceMultiple = mos != null && mos <= -100 ? 1 - mos / 100 : null;

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <Cell
          label="Your case"
          value={summary.result.invalidReason ? "—" : formatCurrency(summary.result.fairValue, summary.currency)}
          tone="strong"
        />
        {priceMultiple != null ? (
          <Cell label="Vs your case" value={`price ${priceMultiple.toFixed(1)}×`} className="text-negative" />
        ) : (
          <Cell
            label="Margin of safety"
            value={mos == null ? "—" : `${mos >= 0 ? "+" : ""}${mos.toFixed(1)}%`}
            className={mosTone}
          />
        )}
        <Cell
          label={IMPLIED_GROWTH_LABEL}
          value={implied != null ? `${implied.toFixed(1)}%` : "—"}
          title={IMPLIED_GROWTH_CAVEAT}
        />

        <Link href={href} className="ml-auto shrink-0 text-xs font-medium text-brand hover:underline">
          Open valuation →
        </Link>
      </div>

      <p className="text-[11px] leading-4 text-muted">
        {summary.ownedKeys.length} of 7 assumptions yours · v{summary.version} · {summary.freshnessLabel}
        {summary.freshness === "stale" ? " · worth revisiting" : ""}
      </p>
    </div>
  );
}

function Cell({ label, value, tone, className = "", title }: {
  label: string; value: string; tone?: "strong"; className?: string; title?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-lg font-semibold ${tone === "strong" ? "text-foreground" : ""} ${className}`}>
        {value}
      </span>
    </div>
  );
}
