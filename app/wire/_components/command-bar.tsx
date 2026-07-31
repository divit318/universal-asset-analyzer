"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ScannerProgressEvent } from "@/lib/types";
import { relativeAge } from "@/lib/provenance";
import { InlineScanProgress } from "./progress-stream";

/** Popular Focus — region shortcuts (replaces the old India/Global checkboxes). */
export type Focus = "global" | "us" | "india" | "europe" | "china" | "asia";

export const FOCUS_CHIPS: { id: Focus; label: string; emoji: string }[] = [
  { id: "global", label: "Global", emoji: "🌍" },
  { id: "us", label: "US", emoji: "🇺🇸" },
  { id: "india", label: "India", emoji: "🇮🇳" },
  { id: "europe", label: "Europe", emoji: "🇪🇺" },
  { id: "china", label: "China", emoji: "🇨🇳" },
  { id: "asia", label: "Asia", emoji: "🌏" },
];

/** Ticks every 30s so "updated 4m ago" stays honest without re-rendering the page. */
function UpdatedAgo({ scannedAt }: { scannedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const ms = now - new Date(scannedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return (
    <span className="font-mono text-xs text-muted/60" title={new Date(scannedAt).toLocaleString()}>
      updated {relativeAge(Math.max(0, ms))}
    </span>
  );
}

/**
 * The Wire's sticky command bar — title, LIVE indicator, relative scan age,
 * focus input, region chips, inline scan progress, and The Desk link. Scan
 * status lives here, not in a mid-page block, so it's visible wherever the
 * user has scrolled.
 *
 * Deliberately NOT wrapped in `Reveal`: its fade-rise animation applies a
 * transform, and a transformed ancestor silently disables position:sticky.
 */
export function CommandBar({
  query,
  onQueryChange,
  focus,
  onSelectFocus,
  onSubmit,
  loading,
  progress,
  scannedAt,
  fromCache,
  onRefresh,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  focus: Focus;
  onSelectFocus: (f: Focus) => void;
  onSubmit: (e?: React.FormEvent) => void;
  loading: boolean;
  progress: ScannerProgressEvent | null;
  scannedAt: string | null;
  fromCache: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="sticky top-14 z-30 -mx-6 border-b border-border bg-surface/85 px-6 py-3 backdrop-blur-xl">
      <div className="flex flex-col gap-2.5">
        {/* Row 1 — identity + freshness + The Desk */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">The Wire</h1>
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-label font-medium uppercase tracking-widest text-muted">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
                </span>
                Live
              </span>
            </div>
            {scannedAt && <UpdatedAgo scannedAt={scannedAt} />}
            {fromCache && (
              <span className="font-mono text-xs text-muted/60">
                · Cached ·{" "}
                <button className="text-brand hover:underline" onClick={onRefresh}>
                  refresh
                </button>
              </span>
            )}
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            The Desk →
          </Link>
        </div>

        {/* Row 2 — focus input + region chips */}
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="6" cy="6" r="4.5" />
              <path d="M9.5 9.5L13 13" />
            </svg>
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Focus on a theme, sector, or event — or leave blank to auto-scan"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-4 text-sm outline-none placeholder:text-muted focus:border-brand"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-brand-strong px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Scan"}
          </button>
          <div className="flex flex-wrap items-center gap-1.5">
            {FOCUS_CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectFocus(c.id)}
                aria-pressed={focus === c.id}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  focus === c.id
                    ? "border-brand/40 bg-brand/10 text-brand"
                    : "border-border text-muted hover:border-brand/30 hover:text-brand"
                }`}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </form>

        {/* Row 3 — inline scan progress, only while a scan is running */}
        {loading && <InlineScanProgress event={progress} />}
      </div>
    </div>
  );
}
