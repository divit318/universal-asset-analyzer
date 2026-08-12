"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { findAlternatives } from "@/lib/research-engines/fund/alternatives";

/**
 * "If I want this exposure, is this the best way to buy it?"
 *
 * Deliberately a short list with a reason attached to each row, not a screen: a
 * column of tickers moves the work back onto the reader, which is what the
 * question was asking us to do. Each row states what you gain or give up
 * structurally, and hands off to Compare for the live numbers — cost and
 * performance belong to the data path, not to a hardcoded table that would rot.
 *
 * Resolved from a static map in render, so it costs nothing.
 */
export function AlternativesCard({ symbol, category }: { symbol: string; category: string | null }) {
  const { alternatives, basis } = useMemo(() => findAlternatives(symbol, category), [symbol, category]);
  if (alternatives.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Other ways to own this exposure</h3>
        <p className="text-caption text-muted">
          {basis === "curated"
            ? `How each differs from ${symbol.toUpperCase()} in what it holds — compare the live cost and performance side by side`
            : `Funds that fill the same slot as ${category ?? "this category"} — compare them on live data`}
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {alternatives.map((a) => (
          <li key={a.symbol} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-sm text-accent">{a.symbol}</span>
                <span className="text-caption text-muted">{a.name}</span>
              </span>
              <Link
                href={`/compare?symbols=${encodeURIComponent(symbol.toUpperCase())},${encodeURIComponent(a.symbol)}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-micro font-medium text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Compare <ArrowRight className="h-3 w-3" strokeWidth={2} />
              </Link>
            </div>
            <p className="text-sm leading-6 text-muted">{a.tradeoff}</p>
          </li>
        ))}
      </ul>

      <p className="border-t border-border/60 pt-3 text-micro leading-5 text-faint">
        Differences described here are structural — which index each fund tracks and what it includes. Costs,
        size and returns change, so they are deliberately not quoted here; the comparison links pull them live.
      </p>
    </section>
  );
}
