"use client";

import { useMemo } from "react";
import { Newspaper } from "lucide-react";
import type { Crosshair } from "klinecharts";
import type { HistoryPoint, NewsItem } from "@/lib/types";
import type { TechnicalSignal } from "@/lib/pattern-signals";
import { formatCompact, formatPercent } from "@/lib/format";

export interface CrosshairPanelProps {
  crosshair: Crosshair | null;
  /** The currently-loaded bars (whatever interval is active) — for %change vs the previous bar. */
  points: HistoryPoint[];
  /** Curated technical signals over the same bars, from lib/pattern-signals.ts. */
  signals: TechnicalSignal[];
  news?: NewsItem[];
  /** Whether the active interval is intraday (show time-of-day) or daily+ (date only). */
  showTime: boolean;
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * The single hover/crosshair info surface — merges what the brief described
 * as two separate features ("Chart Header" hover tooltip and "Crosshair"
 * readout) into one panel driven by one `onCrosshairChange` subscription,
 * since they're >80% the same fields and showing both would duplicate
 * information. Fixed to the pane's corner (not cursor-following) so it never
 * covers the price action it's describing.
 */
export function CrosshairPanel({ crosshair, points, signals, news, showTime }: CrosshairPanelProps) {
  const dateStr = crosshair?.dataIndex != null ? points[crosshair.dataIndex]?.date : undefined;

  const signal = useMemo(
    () => (dateStr ? signals.find((s) => s.date === dateStr) : undefined),
    [signals, dateStr],
  );

  const nearestNews = useMemo(() => {
    if (!dateStr || !news?.length) return undefined;
    return [...news]
      .filter((n) => daysBetween(n.publishedAt, dateStr) <= 5)
      .sort((a, b) => daysBetween(a.publishedAt, dateStr) - daysBetween(b.publishedAt, dateStr))[0];
  }, [news, dateStr]);

  if (!crosshair || crosshair.dataIndex == null || !crosshair.kLineData || !crosshair.timestamp) return null;
  const { kLineData, dataIndex, timestamp } = crosshair;

  const prev = points[dataIndex - 1];
  const changePct = prev && prev.close !== 0 ? ((kLineData.close - prev.close) / prev.close) * 100 : null;

  const date = new Date(timestamp);
  const dateLabel = showTime
    ? date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-xs flex-col gap-1 rounded-md border border-border bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
      <span className="font-mono text-muted">{dateLabel}</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono">
        <span className="text-faint">O <span className="text-foreground">{kLineData.open.toFixed(2)}</span></span>
        <span className="text-faint">H <span className="text-foreground">{kLineData.high.toFixed(2)}</span></span>
        <span className="text-faint">L <span className="text-foreground">{kLineData.low.toFixed(2)}</span></span>
        <span className="text-faint">C <span className="text-foreground">{kLineData.close.toFixed(2)}</span></span>
        {changePct != null && (
          <span className={changePct >= 0 ? "text-positive" : "text-negative"}>{formatPercent(changePct)}</span>
        )}
        {kLineData.volume != null && kLineData.volume > 0 && (
          <span className="text-faint">Vol <span className="text-foreground">{formatCompact(kLineData.volume)}</span></span>
        )}
      </div>
      {signal && (
        <span
          className={`w-fit rounded-full px-1.5 py-0.5 text-micro font-medium ${
            signal.direction === "bullish"
              ? "bg-positive/15 text-positive"
              : signal.direction === "bearish"
                ? "bg-negative/15 text-negative"
                : "bg-surface-3 text-muted"
          }`}
        >
          {signal.direction === "bullish" ? "▲" : signal.direction === "bearish" ? "▼" : "●"} {signal.name}
        </span>
      )}
      {nearestNews && (
        <a
          href={nearestNews.url}
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto flex items-center gap-1 truncate text-brand hover:underline"
        >
          <Newspaper className="h-3 w-3 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{nearestNews.headline}</span>
        </a>
      )}
    </div>
  );
}
