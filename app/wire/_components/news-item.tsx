"use client";

import type { CSSProperties } from "react";
import type { NewsItem } from "@/lib/types";
import { formatDate } from "@/lib/format";

export function NewsItemRow({ item, style }: { item: NewsItem; style?: CSSProperties }) {
  return (
    <li className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0 animate-fade-rise" style={style}>
      <div className="flex items-start justify-between gap-3">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-sm leading-5 hover:text-accent hover:underline"
        >
          {item.headline}
        </a>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 shrink-0 text-xs text-accent hover:underline"
          >
            ↗
          </a>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>{item.source}</span>
        <span>·</span>
        <span>{formatDate(item.publishedAt)}</span>
        {item.tickers.length > 0 ? (
          <>
            <span>·</span>
            <span className="font-mono">{item.tickers.slice(0, 3).join(", ")}</span>
          </>
        ) : null}
      </div>
    </li>
  );
}
