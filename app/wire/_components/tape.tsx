"use client";

import { useState } from "react";
import type { TapeStory, TapeView, TapeBucket } from "@/lib/wire/tape";
import { TAPE_BUCKET_LABELS } from "@/lib/wire/tape";
import { relativeAge } from "@/lib/provenance";

/**
 * The Tape — clustered, deduped, noise-filtered story rows in time buckets.
 * All logic lives in lib/wire/tape.ts (pure, tested); this renders a TapeView.
 *
 * Density is the point: one line for the headline, one compact metadata line,
 * an inline "N sources" expander — a story covered by five outlets is one row.
 */

function TickerChips({ tickers }: { tickers: string[] }) {
  if (tickers.length === 0) return null;
  return (
    <span className="flex items-center gap-1">
      {tickers.slice(0, 4).map((t) => (
        <span key={t} className="rounded border border-border bg-surface-2 px-1 py-px font-mono text-[9px] text-muted">
          {t}
        </span>
      ))}
      {tickers.length > 4 && <span className="text-[9px] text-muted/60">+{tickers.length - 4}</span>}
    </span>
  );
}

function StoryRow({ story, now }: { story: TapeStory; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const secondary = story.items.slice(1);

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-col gap-0.5 px-3 py-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <a
            href={story.canonical.url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={`min-w-0 flex-1 truncate text-[13px] leading-5 hover:text-accent hover:underline ${
              story.stale ? "text-muted" : "text-foreground"
            }`}
            title={story.canonical.headline}
          >
            {story.canonical.headline}
          </a>
          {story.sourceCount > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              {story.sourceCount} sources {expanded ? "−" : "+"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted/70">
          <span>{story.canonical.source}</span>
          <span>·</span>
          <span title={new Date(story.latestAt).toLocaleString()}>
            {relativeAge(Math.max(0, now - new Date(story.latestAt).getTime()))}
          </span>
          {story.stale && (
            <span className="rounded border border-border px-1 py-px text-[9px] uppercase tracking-wide text-muted/60">
              stale
            </span>
          )}
          <TickerChips tickers={story.tickers} />
        </div>
      </div>

      {expanded && secondary.length > 0 && (
        <ul className="animate-menu-drop border-t border-border/60 bg-surface-2/40">
          {secondary.map((item) => (
            <li key={`${item.url}-${item.source}`} className="flex items-baseline justify-between gap-3 px-3 py-1 pl-6">
              <a
                href={item.url || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-xs leading-5 text-muted hover:text-accent hover:underline"
                title={item.headline}
              >
                {item.headline}
              </a>
              <span className="shrink-0 text-[10px] text-muted/60">{item.source}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Tape({ view }: { view: TapeView }) {
  const [showFiltered, setShowFiltered] = useState(false);

  const buckets: TapeBucket[] = ["hour", "today", "yesterday", "earlier"];
  const grouped = buckets
    .map((b) => ({ bucket: b, stories: view.stories.filter((s) => s.bucket === b) }))
    .filter((g) => g.stories.length > 0);

  if (view.stories.length === 0 && view.filtered.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {grouped.map(({ bucket, stories }) => (
        <div key={bucket} className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">
            {TAPE_BUCKET_LABELS[bucket]}
          </span>
          <ul className="rounded-xl border border-border bg-surface">
            {stories.map((s) => (
              <StoryRow key={s.id} story={s} now={view.builtAt} />
            ))}
          </ul>
        </div>
      ))}

      {/* Noise is down-ranked behind a toggle, never silently deleted. */}
      {view.filtered.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setShowFiltered((v) => !v)}
            aria-expanded={showFiltered}
            className="self-start text-xs text-muted transition-colors hover:text-foreground"
          >
            {showFiltered ? "Hide" : "Show"} filtered ({view.filtered.length})
          </button>
          {showFiltered && (
            <ul className="rounded-xl border border-border bg-surface opacity-70">
              {view.filtered.map((s) => (
                <StoryRow key={s.id} story={s} now={view.builtAt} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
