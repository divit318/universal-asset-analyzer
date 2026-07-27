"use client";

import type { NewsItem } from "@/lib/types";
import { NewsItemRow } from "./news-item";

const MAX_ITEMS = 20;

/**
 * News Timeline — the raw, de-duped headline feed the pipeline already
 * collects (`result.newsItems`) but never rendered anywhere. Chronological,
 * unfiltered — the counterpart to Portfolio Watch, which is the same
 * NewsItemRow narrowed to symbols you hold.
 */
export function NewsTimeline({ newsItems }: { newsItems: NewsItem[] }) {
  if (newsItems.length === 0) return null;

  const sorted = [...newsItems]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_ITEMS);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">News Timeline</h2>
      <ul className="rounded-xl border border-border bg-surface">
        {sorted.map((item, i) => (
          <NewsItemRow key={`${item.url}-${item.publishedAt}`} item={item} style={{ animationDelay: `${i * 30}ms` }} />
        ))}
      </ul>
    </section>
  );
}
