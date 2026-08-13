"use client";

/**
 * Results Radar — the earnings-season strip for Indian watchlist names.
 *
 * Two honest lists:
 *   - Upcoming: board-meeting dates NSE itself has scheduled (never estimated;
 *     the calendar's horizon is about a week).
 *   - Recently reported: results filings published in the last 7 days, linked
 *     to the official NSE document and to Research.
 *
 * Renders nothing when there is nothing to say — an Indian-free watchlist
 * never sees this.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import type { ResultsRadarPayload } from "@/app/api/india/results-radar/route";

export function ResultsRadar() {
  const [data, setData] = useState<ResultsRadarPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/india/results-radar")
      .then((r) => (r.ok ? (r.json() as Promise<ResultsRadarPayload>) : null))
      .then((json) => { if (!cancelled && json) setData(json); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!data || (data.upcoming.length === 0 && data.recent.length === 0)) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold">Results Radar — India</h2>
        <p className="text-xs text-muted">
          NSE-scheduled results dates and freshly filed results for your Indian watchlist names
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.upcoming.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Upcoming results</h3>
            {data.upcoming.map((u) => (
              <div key={`${u.symbol}-${u.date}`} className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface-2/50 px-3 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/research?symbol=${encodeURIComponent(u.nsSymbol)}`} className="font-medium text-foreground hover:text-accent">
                    {u.symbol}
                  </Link>
                  <span className="text-muted" title="Board meeting date from NSE's event calendar">
                    {formatDate(u.date)} · NSE-scheduled
                  </span>
                </div>
                {u.ownershipNote && (
                  <span className="text-[11px] text-muted" title={`SEBI shareholding pattern, as of ${u.ownershipAsOf}`}>
                    {u.ownershipNote} <span className="text-muted/60">· as of {u.ownershipAsOf}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {data.recent.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Recently reported</h3>
            {data.recent.map((r) => (
              <div key={`${r.symbol}-${r.reportedAt}`} className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2/50 px-3 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/research?symbol=${encodeURIComponent(r.nsSymbol)}`} className="font-medium text-foreground hover:text-accent">
                    {r.symbol}
                    {r.quarterLabel && <span className="ml-1.5 font-normal text-muted">{r.quarterLabel}</span>}
                  </Link>
                  <span className="flex items-center gap-2 text-muted">
                    Reported {formatDate(r.reportedAt)}
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                      Filing ↗
                    </a>
                  </span>
                </div>
                {(r.netProfitYoY != null || r.revenueYoY != null || r.dayMovePct != null) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
                    {r.netProfitYoY != null && (
                      <span className={r.netProfitYoY >= 0 ? "text-positive" : "text-negative"}>
                        NP {r.netProfitYoY >= 0 ? "+" : ""}{r.netProfitYoY}% YoY
                      </span>
                    )}
                    {r.revenueYoY != null && (
                      <span className={r.revenueYoY >= 0 ? "text-positive" : "text-negative"}>
                        Rev {r.revenueYoY >= 0 ? "+" : ""}{r.revenueYoY}% YoY
                      </span>
                    )}
                    {r.financingMarginPercent != null && (
                      <span className="text-muted">Fin margin {r.financingMarginPercent}%</span>
                    )}
                    {r.dayMovePct != null && (
                      <span className={r.dayMovePct >= 0 ? "text-positive" : "text-negative"} title={`Close-to-close move on ${r.dayMoveDate}`}>
                        {r.dayMovePct >= 0 ? "+" : ""}{r.dayMovePct}% on day
                      </span>
                    )}
                  </div>
                )}
                {r.ownershipNote && (
                  <span className="text-[11px] text-muted" title={`SEBI shareholding pattern, as of ${r.ownershipAsOf}. Descriptive context — not a causal claim about the result.`}>
                    {r.ownershipNote} <span className="text-muted/60">· as of {r.ownershipAsOf}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
