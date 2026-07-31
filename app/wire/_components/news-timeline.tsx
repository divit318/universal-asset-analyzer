"use client";

import type { NewsItem } from "@/lib/types";
import { NewsItemRow } from "./news-item";

const MAX_ITEMS = 20;

/**
 * The Tape's raw headline feed (`result.newsItems`), chronological. Section
 * chrome (title, count badge, collapse) is provided by the WireSection wrapper
 * in page.tsx; this renders only the list. Clustering, dedupe, and the noise
 * filter land in lib/wire/tape.ts and replace this flat list.
 */
export function NewsTimeline({ newsItems }: { newsItems: NewsItem[] }) {
  if (newsItems.length === 0) return null;

  const sorted = [...newsItems]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_ITEMS);

  return (
    <ul className="rounded-xl border border-border bg-surface">
      {sorted.map((item, i) => (
        <NewsItemRow key={`${item.url}-${item.publishedAt}`} item={item} style={{ animationDelay: `${i * 30}ms` }} />
      ))}
    </ul>
  );
}
