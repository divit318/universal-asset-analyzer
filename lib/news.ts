import { getNews, type RawNews } from "./yahoo";
import type { NewsItem } from "./ai/types";

/** Map a raw Yahoo news hit into a clean NewsItem, dropping linkless rows. Pure. */
export function mapNews(raw: RawNews): NewsItem | null {
  if (!raw.link || !raw.title) return null;
  const ts = raw.providerPublishTime;
  const publishedAt =
    ts != null ? new Date(typeof ts === "number" ? ts * 1000 : ts).toISOString() : null;
  return {
    title: raw.title,
    publisher: raw.publisher ?? null,
    link: raw.link,
    publishedAt,
  };
}

/** Recent, de-duplicated news for a symbol, newest first. Best-effort. */
export async function getCompanyNews(symbol: string, count = 8): Promise<NewsItem[]> {
  const raw = await getNews(symbol, count);
  const seen = new Set<string>();
  return raw
    .map(mapNews)
    .filter((n): n is NewsItem => {
      if (!n || seen.has(n.link)) return false;
      seen.add(n.link);
      return true;
    })
    .sort((a, b) => (a.publishedAt ?? "") < (b.publishedAt ?? "") ? 1 : -1);
}
