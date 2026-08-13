"use client";

/**
 * Earnings-season strip for the India screener — universe names reporting
 * soon (NSE-scheduled board meetings, ~1-week horizon) and universe names
 * whose results just hit NSE's announcements feed.
 *
 * Discovery, not a calendar app: compact chips that deep-link into Research.
 * Renders nothing outside results season / when both lists are empty.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import type { ResultsSeasonPayload } from "@/app/api/india/results-season/route";

export function IndiaResultsStrip() {
  const [data, setData] = useState<ResultsSeasonPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/india/results-season")
      .then((r) => (r.ok ? (r.json() as Promise<ResultsSeasonPayload>) : null))
      .then((json) => { if (!cancelled && json) setData(json); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!data || (data.upcoming.length === 0 && data.reported.length === 0)) return null;

  // Group upcoming by date so a busy results week reads as a schedule.
  const byDate = new Map<string, ResultsSeasonPayload["upcoming"]>();
  for (const u of data.upcoming) {
    byDate.set(u.date, [...(byDate.get(u.date) ?? []), u]);
  }

  const chip = (nsSymbol: string, symbol: string) => (
    <Link
      key={nsSymbol}
      href={`/research?symbol=${encodeURIComponent(nsSymbol)}`}
      className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:border-accent hover:text-accent"
    >
      {symbol}
    </Link>
  );

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold">Results Season</h2>
        <p className="text-xs text-muted">
          Board-meeting dates from NSE&apos;s event calendar (~1-week horizon) · latest results
          filings from the exchange feed
        </p>
      </div>

      {data.upcoming.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Reporting soon <span className="font-normal normal-case text-muted/70">· NSE-scheduled</span>
          </h3>
          {[...byDate.entries()].map(([date, entries]) => (
            <div key={date} className="flex flex-wrap items-center gap-1.5">
              <span className="w-24 shrink-0 text-[11px] text-muted">{formatDate(date)}</span>
              {entries.map((e) => chip(e.nsSymbol, e.symbol))}
            </div>
          ))}
        </div>
      )}

      {data.reported.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Just reported{" "}
            <span className="font-normal normal-case text-muted/70">
              · most recent results filings on the NSE feed
            </span>
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.reported.map((r) => (
              <Link
                key={r.nsSymbol}
                href={`/research?symbol=${encodeURIComponent(r.nsSymbol)}`}
                className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:border-accent hover:text-accent"
                title={`Results filed ${formatDate(r.reportedAt)}`}
              >
                {r.symbol}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
