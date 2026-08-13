"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { buildTape } from "@/lib/wire/tape";
import { Tape } from "./tape";
import { Skeleton } from "@/app/_components/ui";

interface HoldingNews {
  symbol: string;
  items: NewsItem[];
}

/** Rows shown before "Show all" — enough to scan, not a firehose. */
const MAX_VISIBLE_STORIES = 8;

function symbolKey(s: string): string {
  return s.replace(/\.(NS|BO)$/, "").toUpperCase();
}

/**
 * Portfolio Watch — news for your holdings, streamed one holding at a time
 * from /api/scanner/portfolio-news (bounded-concurrency NDJSON, same
 * reader-loop pattern as the main scan in page.tsx's runScan()).
 * Self-contained: loads independently of the /api/scanner/v2 pipeline, so
 * it's the first real content on the page rather than gated behind the
 * slow AI scan.
 *
 * Rendering goes through the SAME clustering/dedupe/noise pipeline as The
 * Tape (lib/wire/tape.ts): one story covered by four outlets is one row, the
 * exact same article arriving via two holdings' feeds is one article, and
 * every row carries the holding ticker that surfaced it. The flat per-item
 * list this replaced rendered ~30 rows with duplicates and no attribution.
 */
export function PortfolioWatch() {
  const [holdings, setHoldings] = useState<HoldingNews[]>([]);
  const [loading, setLoading] = useState(true);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

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
              continue; // skip malformed line
            }
            if (msg.type === "holding") {
              setHoldings((prev) => [...prev, { symbol: msg.symbol, items: msg.items }]);
            }
          }
        }
      } catch {
        // Best-effort — Portfolio Watch failing shouldn't break the page.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Tag every article with the holding whose feed surfaced it (many arrive
  // with empty tickers), then cluster. buildTape dedupes exact-URL repeats
  // across holdings, unioning their tickers.
  const tapeView = useMemo(() => {
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

  if (!loading && holdings.length === 0) return null;

  // Renders inside the "Portfolio Impact" WireSection (which owns the h2), so
  // this block identifies itself with a sub-label: it is the holdings-news half
  // of that zone, beside the scan-derived impact cards.
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted/60">
          Holdings News
        </span>
        {tapeView && (
          <span className="text-caption text-muted/60">
            {tapeView.stories.length} stor{tapeView.stories.length === 1 ? "y" : "ies"} across{" "}
            {holdings.length} holding{holdings.length === 1 ? "" : "s"}
          </span>
        )}
        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
            </span>
            streaming…
          </span>
        )}
      </div>
      {tapeView ? (
        <Tape view={tapeView} maxVisible={MAX_VISIBLE_STORIES} />
      ) : (
        <Skeleton height="h-24" radius="rounded-xl" className="border border-border" />
      )}
    </div>
  );
}
