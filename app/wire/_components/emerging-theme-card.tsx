"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { EmergingTheme } from "@/lib/types";

function MomentumBar({ value }: { value: number }) {
  const color = value >= 70 ? "bg-positive" : value >= 45 ? "bg-accent" : "bg-muted/40";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-surface-3 overflow-hidden">
        <div
          className={`h-full rounded-full animate-bar-fill ${color}`}
          style={{ width: `${value}%`, "--bar-value": `${value}%` } as CSSProperties}
        />
      </div>
      <span className="w-8 text-right font-mono text-[10px] text-muted">{value}</span>
    </div>
  );
}

export function EmergingThemeCard({
  theme,
  style,
  onShowEvidence,
  evidenceCount,
  highlighted = false,
}: {
  theme: EmergingTheme;
  style?: CSSProperties;
  onShowEvidence?: () => void;
  /** Resolved source-article count backing this theme, when known. */
  evidenceCount?: number;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`card-lift animate-fade-rise flex flex-col gap-3 rounded-xl border bg-surface p-4 transition-colors hover:bg-surface-2 ${
        highlighted ? "border-accent/60 ring-2 ring-accent/40" : "border-border hover:border-border/80"
      }`}
      style={style}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight">{theme.name}</h3>
        <span className="shrink-0 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
          Theme
        </span>
      </div>

      <p className="text-xs leading-5 text-muted line-clamp-2">{theme.description}</p>

      <div className="flex flex-col gap-1">
        <span className="text-[9px] font-medium uppercase tracking-widest text-muted/60">
          Momentum
        </span>
        <MomentumBar value={theme.momentum} />
      </div>

      {theme.topTickers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {theme.topTickers.map((ticker) => (
            <Link
              key={ticker}
              href={`/stocks/${encodeURIComponent(ticker)}`}
              className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted hover:border-accent/40 hover:text-accent transition-colors"
            >
              {ticker}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        <Link
          href={theme.thematicResearchUrl}
          className="text-xs text-accent hover:underline"
        >
          Deep Thematic Research →
        </Link>
        {onShowEvidence && (
          <button
            type="button"
            onClick={onShowEvidence}
            className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-accent"
            title="Open source articles"
          >
            Evidence{evidenceCount != null ? ` · ${evidenceCount}` : ""}
          </button>
        )}
      </div>
    </div>
  );
}
