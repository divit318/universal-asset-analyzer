"use client";

import Link from "next/link";
import type { PersonalImpact, AffectedName } from "@/lib/wire/personal";
import { Skeleton } from "@/app/_components/ui";

/**
 * For You — one section answering "what does this scan mean for what I own
 * and follow", near the top of the page. Replaces the two near-identical
 * Watchlist Impact / Portfolio Impact panels that used to sit at the bottom.
 *
 * The readout line is composed deterministically in lib/wire/personal.ts
 * from the scan's already-scored output; nothing here is model prose.
 */

const DIR_STYLE = {
  bullish: { badge: "text-positive bg-positive/10 border-positive/25", arrow: "↑" },
  bearish: { badge: "text-negative bg-negative/10 border-negative/25", arrow: "↓" },
  neutral: { badge: "text-muted bg-muted/10 border-muted/20", arrow: "→" },
};

function AffectedRow({ name }: { name: AffectedName }) {
  const dir = DIR_STYLE[name.direction];
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-2">
      <span className="flex min-w-0 items-center gap-2">
        <Link
          href={`/stocks/${encodeURIComponent(name.ticker)}`}
          className="shrink-0 font-mono text-xs font-semibold text-accent hover:underline"
        >
          {name.ticker}
        </Link>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-label font-semibold uppercase ${dir.badge}`}
          aria-label={name.direction}
        >
          {dir.arrow}
        </span>
        <span className="truncate text-caption text-muted">{name.rationale}</span>
      </span>
      <span
        className="shrink-0 font-mono text-label font-bold text-foreground"
        title="Composite opportunity score (0–100, deterministic)"
      >
        {name.composite}
      </span>
    </li>
  );
}

function Bucket({
  title,
  linkHref,
  tracked,
  affected,
  emptyText,
}: {
  title: string;
  linkHref: string;
  tracked: number;
  affected: AffectedName[];
  emptyText: string;
}) {
  if (tracked === 0) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label font-semibold uppercase tracking-widest text-muted/60">
          {title}
          <span className="ml-1.5 font-mono normal-case tracking-normal text-muted/50">
            {affected.length} of {tracked}
          </span>
        </span>
        <Link href={linkHref} className="text-xs text-accent hover:underline">
          View →
        </Link>
      </div>
      {affected.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {affected.slice(0, 5).map((n) => (
            <AffectedRow key={n.opportunityId} name={n} />
          ))}
          {affected.length > 5 && (
            <li className="px-2.5 pt-0.5 text-caption text-muted/60">
              +{affected.length - 5} more in the full ideas list below
            </li>
          )}
        </ul>
      ) : (
        <p className="px-0.5 text-xs text-muted/60">{emptyText}</p>
      )}
    </div>
  );
}

export function ForYou({
  impact,
  scanLoading,
  symbolsLoading,
  symbolsFailed,
  onRetrySymbols,
  trackedCounts,
}: {
  /** Null until the scan has produced opportunities to join against. */
  impact: PersonalImpact | null;
  scanLoading: boolean;
  symbolsLoading: boolean;
  symbolsFailed: string[];
  onRetrySymbols: () => void;
  trackedCounts: { portfolio: number; watchlist: number };
}) {
  if (symbolsLoading) {
    return <Skeleton height="h-24" radius="rounded-xl" className="border border-border" />;
  }

  const nothingTracked =
    symbolsFailed.length === 0 && trackedCounts.portfolio === 0 && trackedCounts.watchlist === 0;

  return (
    <div className="flex flex-col gap-3">
      {symbolsFailed.length > 0 && (
        <p className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <span>
            Couldn&apos;t load your {symbolsFailed.join(" and ")} — impact matching below
            {symbolsFailed.length === 2 ? " is unavailable" : " is incomplete"}.
          </span>
          <button
            type="button"
            onClick={onRetrySymbols}
            className="shrink-0 rounded border border-warning/40 px-2 py-0.5 text-xs transition-colors hover:bg-warning/20"
          >
            Retry
          </button>
        </p>
      )}

      {nothingTracked ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-5 text-center text-sm text-muted">
          Nothing tracked yet — add names to your{" "}
          <Link href="/watchlist" className="text-accent hover:underline">
            watchlist
          </Link>{" "}
          or holdings to your{" "}
          <Link href="/portfolio" className="text-accent hover:underline">
            portfolio
          </Link>{" "}
          and every scan will flag signals on what you own or follow.
        </p>
      ) : impact == null ? (
        scanLoading ? (
          <Skeleton height="h-24" radius="rounded-xl" className="border border-border" />
        ) : (
          <p className="rounded-xl border border-border bg-surface px-4 py-5 text-sm text-muted">
            Run a scan to check this against your names.
          </p>
        )
      ) : (
        <div className="animate-fade-rise flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          {impact.readout ? (
            <div className="flex flex-col gap-1 border-b border-border pb-3">
              <p className="text-sm leading-6 text-foreground/90">{impact.readout}</p>
              {impact.commonThread && (
                <p className="text-caption text-muted">
                  Common thread:{" "}
                  <span className="text-foreground/75">{impact.commonThread.theme}</span> —{" "}
                  <span className="font-mono">{impact.commonThread.tickers.join(", ")}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="border-b border-border pb-3 text-sm text-muted">
              This scan doesn&apos;t touch anything you own or follow.
            </p>
          )}
          <div className="flex flex-col gap-5 sm:flex-row">
            <Bucket
              title="Portfolio"
              linkHref="/portfolio"
              tracked={impact.portfolio.tracked}
              affected={impact.portfolio.affected}
              emptyText="No signal from this scan touches a position you hold."
            />
            <Bucket
              title="Watchlist"
              linkHref="/watchlist"
              tracked={impact.watchlist.tracked}
              affected={impact.watchlist.affected}
              emptyText="No signal from this scan touches a name you follow."
            />
          </div>
          <p className="text-caption text-muted/60">
            Holdings headlines live in{" "}
            <a href="#feed" className="text-accent hover:underline">
              The Feed ↓
            </a>{" "}
            under &ldquo;Your holdings&rdquo;.
          </p>
        </div>
      )}
    </div>
  );
}
