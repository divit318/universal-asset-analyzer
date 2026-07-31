"use client";

/**
 * AI Watchlist Intelligence.
 *
 * Extracted from the page, and given the two states it was missing: failure and
 * idle. The panel used to render a skeleton, then unmount silently if Ollama was
 * offline — so the user saw an analysis start and then evaporate, with nothing to
 * retry and no indication of what had happened.
 *
 * Generation is OPT-IN, so idle is the state the panel is usually in: it must
 * carry the control that starts the run. Returning null when `digest` is absent
 * — correct while this auto-fired on load — would now make the feature
 * unreachable, since nothing else ever sets `digest`.
 */

import type { WatchlistDigest } from "@/lib/ai-watchlist";

interface Props {
  digest: WatchlistDigest | null;
  loading: boolean;
  error: string | null;
  /** Runs the digest: first generation, "Try again" after a failure, and "Regenerate". */
  onGenerate: () => void;
}

function Bullets({
  label,
  tone,
  items,
}: {
  label: string;
  tone: "positive" | "negative" | "brand";
  items: string[];
}) {
  if (items.length === 0) return null;
  const labelTone =
    tone === "positive" ? "text-positive/80" : tone === "negative" ? "text-negative/80" : "text-muted";
  const dotTone = tone === "positive" ? "bg-positive/60" : tone === "negative" ? "bg-negative/60" : "bg-brand/60";
  return (
    <div>
      <p className={`mb-2 text-label font-semibold uppercase tracking-widest ${labelTone}`}>{label}</p>
      <ul className="space-y-1">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
            <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotTone}`} />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WatchlistDigestPanel({ digest, loading, error, onGenerate }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-brand/20 bg-brand/5 p-5" aria-busy="true">
        <div className="mb-3 flex items-center gap-3">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-2" />
          <div className="ml-auto h-4 w-16 animate-pulse rounded-full bg-surface-2" />
        </div>
        <div className="space-y-2">
          {[90, 75, 60].map((w) => (
            <div key={w} className="h-3 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
          ))}
        </div>
        <p className="mt-3 animate-pulse text-[11px] text-muted">Local AI is reading your watchlist…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-label font-semibold uppercase tracking-widest text-muted/60">
            AI Watchlist Intelligence
          </p>
          <p className="mt-0.5 text-xs text-muted">{error}</p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-surface-2"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-label font-semibold uppercase tracking-widest text-muted/60">
            AI Watchlist Intelligence
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Reads every name on this list and returns picks, concerns and action items. Runs on
            your machine, so it takes a moment and starts only when you ask for it.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-surface-2"
        >
          Generate
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand/20 bg-brand/5 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-label font-semibold uppercase tracking-widest text-brand/70">
          AI Watchlist Intelligence
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-full border border-border px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Regenerate
          </button>
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-brand">
            Local AI
          </span>
        </div>
      </div>
      <p className="mb-4 text-sm leading-6 text-foreground/90">{digest.summary}</p>
      {(digest.topPicks.length > 0 || digest.topConcerns.length > 0) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Bullets label="Top picks" tone="positive" items={digest.topPicks} />
          <Bullets label="Concerns" tone="negative" items={digest.topConcerns} />
        </div>
      )}
      {digest.actionItems.length > 0 && (
        <div className="border-t border-border pt-3">
          <Bullets label="Action items" tone="brand" items={digest.actionItems} />
        </div>
      )}
    </div>
  );
}
