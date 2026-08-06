"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StripResponse } from "@/app/api/valuation/strip/route";
import { formatCurrency } from "@/lib/format";
import { IMPLIED_GROWTH_LABEL, IMPLIED_GROWTH_CAVEAT } from "@/lib/valuation/case";

/**
 * The Research Hub's valuation strip — read-only, by design.
 *
 * Research observes; Valuation judges. So this shows the four numbers and links
 * out, and cannot be edited here: two editable surfaces for one object is how
 * you get two answers to "what is this worth". It also never creates a case,
 * because a case appearing merely because someone opened a page would fill the
 * Register with names nobody has thought about.
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
      <div className="h-[68px] animate-pulse rounded-xl border border-border bg-surface" aria-hidden />
    );
  }

  const mos = summary.result.marginOfSafety;
  const mosTone = mos == null ? "text-muted"
    : mos >= 20 ? "text-positive"
    : mos >= 0 ? "text-yellow-500"
    : "text-negative";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <Cell label="Price" value={formatCurrency(summary.price, summary.currency)} />
        <Cell
          label="Your case"
          value={summary.result.invalidReason ? "—" : formatCurrency(summary.result.fairValue, summary.currency)}
          tone="strong"
        />
        <Cell
          label="Margin of safety"
          value={mos == null ? "—" : `${mos >= 0 ? "+" : ""}${mos.toFixed(1)}%`}
          className={mosTone}
        />
        <Cell
          label={IMPLIED_GROWTH_LABEL}
          value={summary.result.impliedGrowth != null ? `${summary.result.impliedGrowth.toFixed(1)}%` : "—"}
          title={IMPLIED_GROWTH_CAVEAT}
        />
        {summary.enginePrior?.p50 != null ? (
          <Cell
            label="Engine p50"
            value={formatCurrency(summary.enginePrior.p50, summary.currency)}
            title="Median of the quant engine's 50,000-path Monte Carlo DCF — a systematic prior, not a target."
          />
        ) : null}

        <Link href={href} className="ml-auto shrink-0 text-xs font-medium text-brand hover:underline">
          Open valuation →
        </Link>
      </div>

      <p className="text-[11px] leading-4 text-muted">
        {summary.untouched
          ? "Seeded automatically — none of these assumptions are yours yet."
          : `${summary.ownedKeys.length} of 7 assumptions are yours.`}{" "}
        v{summary.version} · updated {summary.freshnessLabel}
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
