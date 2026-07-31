"use client";

/**
 * The expanded row.
 *
 * Two jobs, both of which the previous version only half did.
 *
 * 1. **Answer "why is this an 83?" in place.** The fit column is one of UAA's
 *    signature numbers and it was rendered as a bare chip with no way to
 *    interrogate it. The scorer has always returned the six weighted dimensions,
 *    the reasons, the trade-offs, a data-confidence figure and a suggested
 *    allocation — none of which reached the watchlist. `PortfolioFitPanel` is the
 *    component that already renders exactly that on Research and Compare, so the
 *    answer is a reuse rather than a new surface.
 *
 * 2. **Stop repeating the row.** The old detail re-printed Added and Target,
 *    which are columns two clicks away, and duplicated the four cross-links that
 *    the row's action menu already carries. What belongs here is what does NOT
 *    fit in a cell: the range context, the full thesis text, and the alert
 *    configuration with a way to change it.
 */

import Link from "next/link";
import { PortfolioFitPanel } from "@/app/_components/portfolio-fit-panel";
import { formatCurrency, formatDate, formatPercent, toneClass } from "@/lib/format";
import { formatAge, upsidePercent } from "@/lib/watchlist-metrics";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";
import type { Quote, TargetDirection, WatchlistItem } from "@/lib/types";
import { RangeBar52Week } from "./range-bar";
import { TargetHistory } from "./target-history";

const DIRECTION_LABEL: Record<TargetDirection, string> = {
  above: "rises to or above",
  below: "falls to or below",
};

/** `formatAge` in prose. "today" and "—" are complete on their own. */
function describeAge(iso: string): string {
  const age = formatAge(iso);
  return age === "today" || age === "—" ? age : `${age} ago`;
}

export interface FiringAlert {
  type: "target_reached" | "significant_drop";
  message: string;
}

export function WatchlistRowDetail({
  item,
  quote,
  fit,
  alerts,
  direction,
  consensus,
  revisionCount,
  onEditTarget,
  onEditNotes,
}: {
  item: WatchlistItem;
  quote: Quote | undefined;
  fit: PortfolioFitAnalysis | undefined;
  alerts: FiringAlert[];
  direction: TargetDirection;
  consensus?: { mean: number | null; high: number | null; low: number | null; opinions: number | null };
  revisionCount: number;
  onEditTarget: () => void;
  onEditNotes: () => void;
}) {
  const currency = quote?.currency ?? "USD";
  const consensusUpside = upsidePercent(quote?.price ?? null, consensus?.mean ?? null);

  return (
    <div className="grid gap-5 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Left: this name's own facts */}
      <div className="flex min-w-0 flex-col gap-4">
        {alerts.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {alerts.map((a) => (
              <li
                key={a.type}
                className="rounded-lg border border-negative/30 bg-negative/[0.07] px-3 py-2 text-xs text-negative"
              >
                <span className="font-semibold">Alert · </span>
                {a.message}
              </li>
            ))}
          </ul>
        )}

        <RangeBar52Week
          price={quote?.price ?? null}
          low={quote?.fiftyTwoWeekLow}
          high={quote?.fiftyTwoWeekHigh}
          target={item.targetPrice}
          currency={currency}
        />

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">
              Target &amp; alerts
            </p>
            <button
              type="button"
              onClick={onEditTarget}
              className="rounded-control text-[11px] text-brand transition-colors hover:underline"
            >
              Edit
            </button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-muted">My target</dt>
            <dd className="font-mono tabular-nums">
              {item.targetPrice != null ? (
                <>
                  {formatCurrency(item.targetPrice, currency)}
                  <span className="ml-1.5 font-sans text-muted">
                    when price {DIRECTION_LABEL[direction]} it
                  </span>
                </>
              ) : (
                <span className="font-sans text-muted/60">Not set</span>
              )}
            </dd>
            <dt className="text-muted">Drop alert</dt>
            <dd className="font-mono tabular-nums">
              {item.alertPctDrop != null ? (
                formatPercent(-Math.abs(item.alertPctDrop))
              ) : (
                <span className="font-sans text-muted/60">Not set</span>
              )}
            </dd>
            <dt className="text-muted">Added</dt>
            {/* "today" and the unknown-date dash are already complete phrases;
                only a duration needs "ago" after it. */}
            <dd title={formatDate(item.addedAt)}>{describeAge(item.addedAt)}</dd>
            {/* The street's number, adjacent to the user's own and explicitly
                attributed, so the two can be compared without being confused. */}
            {consensus?.mean != null && (
              <>
                <dt className="text-muted">Consensus</dt>
                <dd className="font-mono tabular-nums">
                  {formatCurrency(consensus.mean, currency)}
                  {consensusUpside != null && (
                    <span className={`ml-1.5 ${toneClass(consensusUpside)}`}>
                      {formatPercent(consensusUpside)}
                    </span>
                  )}
                  {consensus.opinions != null && (
                    <span className="ml-1.5 font-sans text-muted/60">
                      {consensus.opinions} analyst{consensus.opinions === 1 ? "" : "s"}
                    </span>
                  )}
                </dd>
              </>
            )}
            {item.sector && (
              <>
                <dt className="text-muted">Sector</dt>
                <dd>{item.sector}</dd>
              </>
            )}
          </dl>

          <TargetHistory symbol={item.symbol} currency={currency} revisionCount={revisionCount} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Thesis</p>
            <button
              type="button"
              onClick={onEditNotes}
              className="rounded-control text-[11px] text-brand transition-colors hover:underline"
            >
              {item.notes ? "Edit" : "Write one"}
            </button>
          </div>
          {item.notes ? (
            <p className="whitespace-pre-line text-xs leading-relaxed text-foreground/85">{item.notes}</p>
          ) : (
            <p className="text-xs text-muted/60">
              No thesis recorded. A watchlist entry without a reason is hard to act on later.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-[11px]">
          {[
            { href: `/research?symbol=${item.symbol}`, label: "Research" },
            { href: `/valuation?symbol=${item.symbol}`, label: "Valuation" },
            { href: `/ic-report?symbol=${item.symbol}`, label: "IC Report" },
            { href: `/compare?symbols=${item.symbol}`, label: "Compare" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={(e) => e.stopPropagation()}
              className="rounded-control text-muted underline-offset-2 transition-colors hover:text-brand hover:underline"
            >
              {l.label} ↗
            </Link>
          ))}
        </div>
      </div>

      {/* Right: why this name scores what it scores against YOUR book */}
      <div className="min-w-0">
        {fit ? (
          <PortfolioFitPanel fit={fit} />
        ) : (
          <div className="rounded-xl border border-border bg-surface p-4 text-center text-xs text-muted">
            Portfolio fit is still loading for this name.
          </div>
        )}
      </div>
    </div>
  );
}
