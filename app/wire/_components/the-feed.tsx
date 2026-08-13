"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { buildTape, type TapeStory, type TapeView } from "@/lib/wire/tape";
import { Tape } from "./tape";
import { Skeleton } from "@/app/_components/ui";

/**
 * The Feed — the Wire's one raw-headline surface, replacing the separate
 * "The Tape" and "Holdings News" sections that ran the same clustering
 * pipeline twice on two screens' worth of page.
 *
 *   - "Top stories": this scan's full feed, clustered/deduped/noise-filtered
 *     (lib/wire/tape.ts), with Trace → to light up downstream insights.
 *   - "Your holdings": per-holding news streamed from
 *     /api/scanner/portfolio-news — fetched lazily, the FIRST time the tab
 *     is opened, so the page never pays for a stream nobody looks at.
 */

const MAX_VISIBLE_STORIES = 10;

interface HoldingNews {
  symbol: string;
  items: NewsItem[];
}

function symbolKey(s: string): string {
  return s.replace(/\.(NS|BO)$/, "").toUpperCase();
}

type FeedTab = "market" | "holdings";

export function TheFeed({
  tapeView,
  onTrace,
  tracedStoryId,
}: {
  /** The scan feed, pre-clustered by the page (null while collecting). */
  tapeView: TapeView | null;
  onTrace?: (story: TapeStory) => void;
  tracedStoryId?: string | null;
}) {
  const [tab, setTab] = useState<FeedTab>("market");
  const [holdings, setHoldings] = useState<HoldingNews[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingsDone, setHoldingsDone] = useState(false);
  const startedRef = useRef(false);

  // Lazy stream: only runs once, and only after "Your holdings" is opened.
  useEffect(() => {
    if (tab !== "holdings" || startedRef.current) return;
    startedRef.current = true;
    setHoldingsLoading(true);

    void (async () => {
      try {
        const res = await fetch("/api/scanner/portfolio-news");
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let msg: { type: "holding"; symbol: string; items: NewsItem[] };
            try {
              msg = JSON.parse(line);
            } catch {
              continue;
            }
            if (msg.type === "holding") {
              setHoldings((prev) => [...prev, { symbol: msg.symbol, items: msg.items }]);
            }
          }
        }
      } catch {
        // Best-effort — a failed holdings stream must not break the feed.
      } finally {
        setHoldingsLoading(false);
        setHoldingsDone(true);
      }
    })();
  }, [tab]);

  // Tag each article with the holding whose feed surfaced it, then cluster —
  // same pipeline as the market tab, so one story from four outlets is one row.
  const holdingsView = useMemo(() => {
    if (holdings.length === 0) return null;
    const items = holdings.flatMap((h) =>
      h.items.map((item) =>
        item.tickers.some((t) => symbolKey(t) === symbolKey(h.symbol))
          ? item
          : { ...item, tickers: [h.symbol, ...item.tickers] },
      ),
    );
    return buildTape(items);
  }, [holdings]);

  const tabClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-brand/40 bg-brand/10 text-brand"
        : "border-border text-muted hover:border-brand/30 hover:text-brand"
    }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setTab("market")} aria-pressed={tab === "market"} className={tabClass(tab === "market")}>
          Top stories
          {tapeView ? ` (${tapeView.stories.length})` : ""}
        </button>
        <button type="button" onClick={() => setTab("holdings")} aria-pressed={tab === "holdings"} className={tabClass(tab === "holdings")}>
          Your holdings
          {holdingsView ? ` (${holdingsView.stories.length})` : ""}
        </button>
        {tab === "holdings" && holdingsLoading && (
          <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
            </span>
            streaming…
          </span>
        )}
        {tab === "holdings" && holdingsView && (
          <span className="text-caption text-muted/60">
            {holdingsView.stories.length} stor{holdingsView.stories.length === 1 ? "y" : "ies"} across{" "}
            {holdings.length} holding{holdings.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {tab === "market" ? (
        tapeView ? (
          <Tape
            view={tapeView}
            maxVisible={MAX_VISIBLE_STORIES}
            onTrace={onTrace}
            tracedStoryId={tracedStoryId}
          />
        ) : (
          <Skeleton height="h-40" radius="rounded-xl" className="border border-border" />
        )
      ) : holdingsView ? (
        <Tape view={holdingsView} maxVisible={MAX_VISIBLE_STORIES} />
      ) : holdingsDone ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          No holdings news — either your portfolio is empty or none of your names have recent coverage.
        </p>
      ) : (
        <Skeleton height="h-24" radius="rounded-xl" className="border border-border" />
      )}
    </div>
  );
}
