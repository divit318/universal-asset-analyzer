"use client";

/**
 * What changed since you last looked at this screen.
 *
 * The single biggest shift available to a screener: a saved screen stops being a
 * query you re-run and becomes a **standing definition** that reports its own
 * changes. "PANW left your Quality screen" is worth more than the other
 * forty-nine rows put together, because the list is mostly the same as last time
 * and the delta is the only new information in it.
 *
 * Entries lead over exits deliberately. An entry is an idea — something that
 * newly meets a bar you already decided you cared about — while an exit is
 * hygiene. Both are shown; only one is why you came back.
 */

import Link from "next/link";
import { Badge } from "@/app/_components/ui";

interface Props {
  screenName: string;
  since: string | null;
  entered: string[];
  exited: string[];
  onDismiss: () => void;
}

function relative(iso: string | null): string {
  if (!iso) return "last run";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "last run";
  const hours = ms / 3_600_000;
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function ScreenDiff({ screenName, since, entered, exited, onDismiss }: Props) {
  if (entered.length === 0 && exited.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-brand/25 bg-brand/5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">
          {screenName} — {entered.length + exited.length} change
          {entered.length + exited.length === 1 ? "" : "s"} since {relative(since)}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss changes"
          className="shrink-0 text-xs text-muted transition-colors hover:text-fg"
        >
          ×
        </button>
      </div>

      {entered.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="positive">Entered</Badge>
          {entered.map((symbol) => (
            <Link
              key={symbol}
              href={`/research?symbol=${encodeURIComponent(symbol)}`}
              className="rounded-md border border-positive/30 bg-positive/10 px-1.5 py-0.5 text-[11px] font-medium text-positive transition-colors hover:border-positive/60"
            >
              {symbol}
            </Link>
          ))}
        </div>
      ) : null}

      {exited.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="neutral">Left</Badge>
          {exited.map((symbol) => (
            <span
              key={symbol}
              // Not a link: an exited name is no longer in the result set, so
              // there is no row to go to — the useful action is noticing it.
              className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted line-through decoration-muted/40"
            >
              {symbol}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
