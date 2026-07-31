"use client";

import { useEffect, useRef, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { classifyNoise } from "@/lib/wire/tape";
import { NewsItemRow } from "./news-item";
import { Skeleton } from "@/app/_components/ui";

interface HoldingNews {
  symbol: string;
  items: NewsItem[];
}

/**
 * Portfolio Watch — news for your holdings, rendered one holding at a time
 * as it streams in from /api/scanner/portfolio-news (bounded-concurrency
 * NDJSON, same reader-loop pattern as the main scan in page.tsx's runScan()).
 * Self-contained: loads independently of the /api/scanner/v2 pipeline, so
 * it's the first real content on the page rather than gated behind the
 * slow AI scan.
 */
export function PortfolioWatch() {
  const [holdings, setHoldings] = useState<HoldingNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFiltered, setShowFiltered] = useState(false);
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

  if (!loading && holdings.length === 0) return null;

  const rows = holdings.flatMap((h) => h.items.map((item) => ({ item, symbol: h.symbol })));
  // Holdings-sourced does not mean relevant: generic personal-finance content
  // arrives via the same ticker feeds. Same rules module and same "show
  // filtered (N)" affordance as The Tape — down-ranked, never deleted.
  const visible = rows.filter(({ item }) => !classifyNoise(item).filtered);
  const noisy = rows.filter(({ item }) => classifyNoise(item).filtered);

  // Renders inside the "Portfolio Impact" WireSection (which owns the h2), so
  // this block identifies itself with a sub-label: it is the holdings-news half
  // of that zone, beside the scan-derived impact cards.
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted/60">
          Holdings News
        </span>
        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
            </span>
            streaming…
          </span>
        )}
      </div>
      {rows.length > 0 ? (
        <>
          <ul className="rounded-xl border border-border bg-surface">
            {visible.map(({ item, symbol }, i) => (
              <NewsItemRow key={`${symbol}-${item.url}`} item={item} style={{ animationDelay: `${i * 30}ms` }} />
            ))}
            {visible.length === 0 && (
              <li className="px-4 py-3 text-xs text-muted">
                All {rows.length} holding-related items were filtered as noise.
              </li>
            )}
          </ul>
          {noisy.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowFiltered((v) => !v)}
                aria-expanded={showFiltered}
                className="self-start text-xs text-muted transition-colors hover:text-foreground"
              >
                {showFiltered ? "Hide" : "Show"} filtered ({noisy.length})
              </button>
              {showFiltered && (
                <ul className="rounded-xl border border-border bg-surface opacity-70">
                  {noisy.map(({ item, symbol }) => (
                    <NewsItemRow key={`filtered-${symbol}-${item.url}`} item={item} />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      ) : (
        <Skeleton height="h-24" radius="rounded-xl" className="border border-border" />
      )}
    </div>
  );
}
