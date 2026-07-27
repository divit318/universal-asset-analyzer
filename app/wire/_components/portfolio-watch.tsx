"use client";

import { useEffect, useRef, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { NewsItemRow } from "./news-item";

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

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Portfolio Watch</h2>
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
        <ul className="rounded-xl border border-border bg-surface">
          {rows.map(({ item, symbol }, i) => (
            <NewsItemRow key={`${symbol}-${item.url}`} item={item} style={{ animationDelay: `${i * 30}ms` }} />
          ))}
        </ul>
      ) : (
        <div className="h-24 animate-pulse rounded-xl border border-border bg-surface" />
      )}
    </section>
  );
}
