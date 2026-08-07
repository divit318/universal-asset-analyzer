"use client";

import { useEffect, useState, useMemo, type CSSProperties } from "react";
import type { SectorImpact, SectorRotationSnapshot, RotationClass } from "@/lib/types";
import { buildUnifiedSectorTiles, type UnifiedSectorTile } from "@/lib/wire/sector-divergence";
import { Skeleton } from "@/app/_components/ui";

/**
 * Unified Sector Rotation — one tile per sector carrying BOTH datasets that
 * used to render as two identically-titled grids: the continuous price-rank
 * panel (fetched here from /api/sector-rotation, same contract as the shared
 * SectorRotationPanel, which stays untouched for its other callers) and this
 * scan's news-sentiment signal (`sectorImpacts` prop).
 *
 * Divergence is the point of the merge, so it is the primary visual
 * affordance: flagged tiles sort first and carry the warning treatment. All
 * join/threshold logic lives in lib/wire/sector-divergence.ts (pure, tested);
 * a failed join renders the data it has plus an explicit absence — never an
 * inferred divergence.
 */

const CLASS_STYLE: Record<RotationClass, { text: string; label: string }> = {
  leading: { text: "text-positive", label: "Leading" },
  strengthening: { text: "text-accent", label: "Strengthening" },
  weakening: { text: "text-amber-500 light:text-amber-700", label: "Weakening" },
  lagging: { text: "text-negative", label: "Lagging" },
};

const DIR_STYLE = {
  bullish: { text: "text-positive", arrow: "↑" },
  bearish: { text: "text-negative", arrow: "↓" },
  neutral: { text: "text-muted", arrow: "→" },
};

function StrengthBar({ value }: { value: number }) {
  const color = value >= 70 ? "bg-positive" : value >= 40 ? "bg-accent" : "bg-muted/40";
  return (
    <div className="h-0.5 w-full rounded-full bg-surface-3 overflow-hidden">
      <div
        className={`h-full rounded-full animate-bar-fill ${color}`}
        style={{ width: `${value}%`, "--bar-value": `${value}%` } as CSSProperties}
      />
    </div>
  );
}

function RankChangeBadge({ change }: { change: number | null }) {
  if (change == null || change === 0) return null;
  const up = change > 0;
  return (
    <span className={`text-[10px] font-semibold ${up ? "text-positive" : "text-negative"}`}>
      {up ? "▲" : "▼"} {Math.abs(change)}
    </span>
  );
}

function DivergenceBadge({ tile }: { tile: UnifiedSectorTile }) {
  if (!tile.divergence?.flagged) return null;
  const newsAhead = tile.divergence.kind === "news_ahead_of_price";
  return (
    <span
      className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning"
      title={`Sentiment and price disagree by ${tile.divergence.magnitude} points (threshold 60)`}
    >
      {newsAhead ? "News ↑ · Price ↓" : "Price ↑ · News ↓"}
    </span>
  );
}

function SectorTile({
  tile,
  scanLoading,
  style,
  onShowEvidence,
  highlighted = false,
}: {
  tile: UnifiedSectorTile;
  scanLoading: boolean;
  style?: CSSProperties;
  onShowEvidence?: () => void;
  highlighted?: boolean;
}) {
  const flagged = tile.divergence?.flagged ?? false;
  const dir = tile.sentiment ? DIR_STYLE[tile.sentiment.direction] : null;

  return (
    <div
      className={`card-lift animate-fade-rise flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 ${
        flagged ? "border-warning/40 bg-warning/5" : "border-border bg-surface"
      } ${highlighted ? "ring-2 ring-accent/40" : ""}`}
      style={style}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-foreground">{tile.sector}</span>
        <DivergenceBadge tile={tile} />
      </div>

      {/* Price half — rank, 1m performance, classification */}
      {tile.price ? (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="font-mono font-bold text-foreground">
            #{tile.price.rank}
            {tile.price.perf1mPct != null && (
              <span className={`ml-1.5 ${tile.price.perf1mPct >= 0 ? "text-positive" : "text-negative"}`}>
                {tile.price.perf1mPct >= 0 ? "+" : ""}
                {tile.price.perf1mPct.toFixed(1)}% 1m
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <RankChangeBadge change={tile.price.rankChange} />
            <span className={`text-[9px] font-medium uppercase tracking-wide ${CLASS_STYLE[tile.price.classification].text}`}>
              {CLASS_STYLE[tile.price.classification].label}
            </span>
          </span>
        </div>
      ) : (
        <span className="text-[10px] text-muted/60">No price data for this sector</span>
      )}

      {/* Sentiment half — this scan's event-driven signal */}
      {tile.sentiment && dir ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className={`font-bold ${dir.text}`}>
              {dir.arrow} {tile.sentiment.direction} {tile.sentiment.strength}
            </span>
            {onShowEvidence ? (
              <button
                type="button"
                onClick={onShowEvidence}
                className="text-[9px] uppercase tracking-wide text-muted/60 transition-colors hover:text-accent"
                title="Open source articles"
              >
                News sentiment ↗
              </button>
            ) : (
              <span className="text-[9px] uppercase tracking-wide text-muted/60">News sentiment</span>
            )}
          </div>
          <StrengthBar value={tile.sentiment.strength} />
          <p className="text-[10px] leading-4 text-muted line-clamp-2">{tile.sentiment.rationale}</p>
        </div>
      ) : scanLoading ? (
        <Skeleton height="h-8" radius="rounded" />
      ) : (
        <span className="text-[10px] text-muted/60">No sentiment data from this scan</span>
      )}
    </div>
  );
}

export function UnifiedSectorRotation({
  impacts,
  scanLoading,
  onShowEvidence,
  highlightedSectors,
}: {
  /** This scan's news-sentiment signals; undefined while the stage hasn't streamed in. */
  impacts: SectorImpact[] | undefined;
  scanLoading: boolean;
  /** Opens the evidence drawer for one sector's sentiment signal. */
  onShowEvidence?: (sector: string) => void;
  /** Sectors lit up by a Tape trace. */
  highlightedSectors?: Set<string>;
}) {
  const [snapshot, setSnapshot] = useState<SectorRotationSnapshot | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sector-rotation")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSnapshot(data.snapshot ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPriceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tiles = useMemo(
    () => buildUnifiedSectorTiles(impacts ?? [], snapshot?.sectors ?? []),
    [impacts, snapshot],
  );

  if (priceLoading && !impacts) {
    return <Skeleton height="h-40" radius="rounded-xl" className="border border-border" />;
  }
  if (tiles.length === 0) return null;

  const diverging = tiles.filter((t) => t.divergence?.flagged).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] uppercase tracking-widest text-muted/60">
        <span>Price rank (continuous) + news sentiment (this scan) · sorted by divergence</span>
        {snapshot && snapshot.leaders.length > 0 && <span>Leaders: {snapshot.leaders.join(", ")}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tiles.map((tile, i) => (
          <SectorTile
            key={tile.sector}
            tile={tile}
            scanLoading={scanLoading}
            style={{ animationDelay: `${i * 40}ms` }}
            onShowEvidence={tile.sentiment && onShowEvidence ? () => onShowEvidence(tile.sector) : undefined}
            highlighted={highlightedSectors?.has(tile.sector) ?? false}
          />
        ))}
      </div>
      {diverging === 0 && !scanLoading && (impacts?.length ?? 0) > 0 && (
        <p className="text-[11px] text-muted/60">
          No sector diverges meaningfully between price trend and news sentiment in this scan.
        </p>
      )}
    </div>
  );
}
