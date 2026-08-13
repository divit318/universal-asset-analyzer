"use client";

/**
 * The expanded row — the per-name decision file.
 *
 * Three jobs:
 *
 * 1. **Answer "why is this an 83?" in place.** `PortfolioFitPanel` renders the
 *    fit score's six weighted dimensions, reasons and confidence — the same
 *    component Research and Compare use.
 *
 * 2. **Answer "what changed?"** The `WhatsNew` column carries alerts that fired
 *    since the last visit, the deterministic thesis-drift read, and recent
 *    developments with sources — so the question that used to require opening
 *    Research is answered where the decision is made.
 *
 * 3. **Hold the thesis as a real object.** Not just prose: the buy trigger, the
 *    invalidation condition, conviction, horizon, and when it was last
 *    reviewed — with "Mark reviewed" for the re-read that changes nothing but
 *    still counts.
 *
 * What does NOT belong here: columns the row already shows, and the cross-links
 * the action menu already carries (kept as a single compact row at the bottom).
 */

import Link from "next/link";
import { PortfolioFitPanel } from "@/app/_components/portfolio-fit-panel";
import { IDEA_SOURCE_LABEL, describeOrigin } from "@/lib/idea-source";
import { formatCurrency, formatDate, formatPercent, toneClass } from "@/lib/format";
import { formatAge, upsidePercent } from "@/lib/watchlist-metrics";
import { agoLabel } from "@/lib/provenance";
import { daysUntil, type SymbolPulse } from "@/lib/watchlist-pulse";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";
import type { Conviction, Quote, TargetDirection, ThesisHorizon, WatchlistItem } from "@/lib/types";
import { RangeBar52Week } from "./range-bar";
import { TargetHistory } from "./target-history";
import { WhatsNew } from "./whats-new";

const DIRECTION_LABEL: Record<TargetDirection, string> = {
  above: "rises to or above",
  below: "falls to or below",
};

const CONVICTION_LABEL: Record<Conviction, string> = { low: "Low", medium: "Medium", high: "High" };
const CONVICTION_TONE: Record<Conviction, string> = {
  low: "border-border text-muted",
  medium: "border-warning/40 text-warning",
  high: "border-positive/40 text-positive",
};
const HORIZON_LABEL: Record<ThesisHorizon, string> = { short: "< 1y", medium: "1–3y", long: "3y+" };

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
  pulse,
  checking,
  revisionCount,
  onEditTarget,
  onEditThesis,
  onMarkReviewed,
}: {
  item: WatchlistItem;
  quote: Quote | undefined;
  fit: PortfolioFitAnalysis | undefined;
  alerts: FiringAlert[];
  direction: TargetDirection;
  consensus?: { mean: number | null; high: number | null; low: number | null; opinions: number | null };
  pulse: SymbolPulse | null;
  checking: boolean;
  revisionCount: number;
  onEditTarget: () => void;
  onEditThesis: () => void;
  onMarkReviewed: () => void;
}) {
  const currency = quote?.currency ?? "USD";
  const consensusUpside = upsidePercent(quote?.price ?? null, consensus?.mean ?? null);
  const earningsIn = daysUntil(pulse?.earningsDate ?? null);
  const hasThesis = Boolean(item.notes || item.buyTrigger || item.sellTrigger);

  return (
    <div className="grid gap-5 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
      {/* Left: this name's own facts and levels */}
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
            {/* Next scheduled catalyst, when the calendar knows one. */}
            {pulse?.earningsDate && (
              <>
                <dt className="text-muted">Earnings</dt>
                <dd className={earningsIn != null && earningsIn <= 7 ? "font-medium text-warning" : undefined}>
                  {formatDate(pulse.earningsDate)}
                  {earningsIn != null && earningsIn >= 0 && earningsIn <= 14 && (
                    <span className="ml-1.5 text-muted/70">
                      {earningsIn === 0 ? "today" : earningsIn === 1 ? "tomorrow" : `in ${earningsIn}d`}
                    </span>
                  )}
                </dd>
              </>
            )}
            <dt className="text-muted">Added</dt>
            {/* "today" and the unknown-date dash are already complete phrases;
                only a duration needs "ago" after it. The origin — which surface
                produced this idea — rides along, because "why is this here?" is
                the first question a stale row raises. NULL renders as nothing:
                an unrecorded origin must never read as a fact. */}
            <dd title={describeOrigin({ source: item.source, detail: item.sourceDetail, at: item.addedAt })}>
              {describeAge(item.addedAt)}
              {item.source && (
                <span className="ml-1.5 text-muted/70">via {IDEA_SOURCE_LABEL[item.source]}</span>
              )}
            </dd>
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

      {/* Middle: the thesis as a decision object */}
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Thesis</p>
          <button
            type="button"
            onClick={onEditThesis}
            className="rounded-control text-[11px] text-brand transition-colors hover:underline"
          >
            {hasThesis ? "Edit" : "Write one"}
          </button>
        </div>

        {(item.conviction || item.horizon) && (
          <div className="flex flex-wrap gap-1.5">
            {item.conviction && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${CONVICTION_TONE[item.conviction]}`}>
                {CONVICTION_LABEL[item.conviction]} conviction
              </span>
            )}
            {item.horizon && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted">
                {HORIZON_LABEL[item.horizon]} horizon
              </span>
            )}
          </div>
        )}

        {item.notes ? (
          <p className="whitespace-pre-line text-xs leading-relaxed text-foreground/85">{item.notes}</p>
        ) : (
          <p className="text-xs text-muted/60">
            No thesis recorded. A watchlist entry without a reason is hard to act on later.
          </p>
        )}

        {item.buyTrigger && (
          <div className="rounded-lg border border-positive/20 bg-positive/[0.05] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-positive/70">Would buy</p>
            <p className="mt-0.5 text-xs leading-[1.4] text-foreground/85">{item.buyTrigger}</p>
          </div>
        )}
        {item.sellTrigger && (
          <div className="rounded-lg border border-negative/20 bg-negative/[0.05] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-negative/70">Would walk away</p>
            <p className="mt-0.5 text-xs leading-[1.4] text-foreground/85">{item.sellTrigger}</p>
          </div>
        )}

        {hasThesis && (
          <p className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted/60">
            {item.lastReviewedAt != null
              ? `Reviewed ${agoLabel(item.lastReviewedAt)}`
              : "Never reviewed"}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkReviewed();
              }}
              className="rounded-control text-brand transition-colors hover:underline"
              title="Record that you re-read this thesis and it still stands — no edits needed."
            >
              Mark reviewed
            </button>
          </p>
        )}
      </div>

      {/* Right: what changed, then why this name scores what it scores */}
      <div className="flex min-w-0 flex-col gap-4">
        <WhatsNew pulse={pulse} checking={checking} />
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
