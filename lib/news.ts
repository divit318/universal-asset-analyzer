/**
 * News aggregation layer.
 *
 * Sources (all free / no auth required unless noted):
 *   1. Yahoo Finance per-symbol news (yahoo-finance2) — used by the research copilot
 *   2. Yahoo Finance trending symbols (yahoo-finance2) — used by the market scanner
 *   3. Google News RSS — global + India-specific queries
 *   4. Economic Times RSS feed
 *   5. NSE India corporate announcements (public JSON endpoint)
 *   6. NewsAPI.org — optional, set NEWSAPI_KEY env var for ~100 req/day free
 *   7. Moneycontrol RSS
 */

import YahooFinance from "yahoo-finance2";
import { getNews, type RawNews } from "./yahoo";
import { storyIdFor } from "./story-id";
import type { NewsItem } from "./types";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isoNow(): string {
  return new Date().toISOString();
}

/** Parse a date string from an RSS feed without throwing on malformed values. */
function safeIso(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? isoNow() : d.toISOString();
  } catch {
    return isoNow();
  }
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  hellip: "…",
};

/**
 * Normalize one text node from a feed into something safe to display.
 *
 * Every feed field goes through this, because the CDATA-aware regexes below
 * only match *well-formed* `<title><![CDATA[…]]></title>`. Real feeds are not
 * reliably well-formed, and when the strict pattern missed, the permissive
 * fallback captured the wrapper itself — putting the literal string
 * `<![CDATA[US Stoc…` on screen as a Knowledge Graph node label.
 *
 * Order matters: unwrap CDATA, then strip tags, then decode entities, then
 * collapse whitespace. Decoding before stripping would let an encoded `&lt;b&gt;`
 * become a real tag after the stripper had already run.
 */
export function cleanFeedText(raw: string): string {
  return raw
    // Unwrap complete CDATA sections, then any stray opener/closer left by a
    // truncated or malformed one.
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

/** Very minimal RSS/Atom parser — extracts <item> blocks without a dependency. */
function parseRssItems(xml: string): { title: string; link: string; pubDate: string; description: string }[] {
  const items: { title: string; link: string; pubDate: string; description: string }[] = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1]
      ?? block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?? "";
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]
      ?? block.match(/<link\s+href="([^"]+)"/i)?.[1]
      ?? "";
    const pubDate = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1]
      ?? block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1]
      ?? isoNow();
    const description = block.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1]
      ?? block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1]
      ?? "";

    const cleanTitle = cleanFeedText(title);
    if (cleanTitle) {
      items.push({
        title: cleanTitle,
        link: cleanFeedText(link),
        pubDate: pubDate.trim(),
        description: cleanFeedText(description),
      });
    }
  }
  return items;
}

async function fetchRss(url: string): Promise<{ title: string; link: string; pubDate: string; description: string }[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "universal-asset-analyzer/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return parseRssItems(await res.text());
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Per-symbol news — for the research copilot context                         */
/* -------------------------------------------------------------------------- */

/** Map a raw Yahoo news hit into a clean NewsItem, dropping linkless rows. */
function mapRawNews(raw: RawNews): NewsItem | null {
  if (!raw.link || !raw.title) return null;
  const ts = raw.providerPublishTime;
  const publishedAt =
    ts != null ? new Date(typeof ts === "number" ? ts * 1000 : ts).toISOString() : isoNow();
  return {
    headline: cleanFeedText(raw.title),
    source: raw.publisher ?? "Yahoo Finance",
    url: raw.link,
    publishedAt,
    tickers: [],
    summary: null,
  };
}

/** Recent, de-duplicated news for a specific symbol, newest first. Best-effort. */
export async function getCompanyNews(symbol: string, count = 8): Promise<NewsItem[]> {
  const raw = await getNews(symbol, count);
  const seen = new Set<string>();
  return raw
    .map(mapRawNews)
    .filter((n): n is NewsItem => {
      if (!n || seen.has(n.url)) return false;
      seen.add(n.url);
      return true;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/* -------------------------------------------------------------------------- */
/* Source: Yahoo Finance market news (scanner)                                */
/* -------------------------------------------------------------------------- */

interface RawNewsItem {
  title?: string;
  link?: string;
  publisher?: string;
  providerPublishTime?: number | Date;
  relatedTickers?: string[];
  summary?: string;
}

export async function fetchYahooNews(query?: string, limit = 20): Promise<NewsItem[]> {
  try {
    const res = (await yahooFinance.search(query ?? "market", {
      newsCount: limit,
      quotesCount: 0,
    } as unknown as Parameters<typeof yahooFinance.search>[1])) as unknown as { news?: RawNewsItem[] };

    return (res.news ?? [])
      .filter((n) => n.title)
      .map((n) => {
        let publishedAt = isoNow();
        if (n.providerPublishTime) {
          const t = n.providerPublishTime;
          publishedAt = t instanceof Date
            ? t.toISOString()
            : new Date(typeof t === "number" ? t * 1000 : t).toISOString();
        }
        return {
          headline: cleanFeedText(n.title!),
          source: n.publisher ?? "Yahoo Finance",
          url: n.link ?? "",
          publishedAt,
          tickers: n.relatedTickers ?? [],
          summary: n.summary ?? null,
        };
      });
  } catch {
    return [];
  }
}

export async function fetchYahooTickerNews(symbol: string, limit = 10): Promise<NewsItem[]> {
  return fetchYahooNews(symbol, limit);
}

/* -------------------------------------------------------------------------- */
/* Source: Google News RSS                                                     */
/* -------------------------------------------------------------------------- */

const GOOGLE_NEWS_BASE = "https://news.google.com/rss/search";

async function fetchGoogleNews(query: string, limit = 15): Promise<NewsItem[]> {
  const url = `${GOOGLE_NEWS_BASE}?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const items = await fetchRss(url);
  return items.slice(0, limit).map((i) => ({
    headline: i.title,
    source: "Google News",
    url: i.link,
    publishedAt: safeIso(i.pubDate),
    tickers: [],
    summary: i.description || null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Source: Economic Times RSS                                                  */
/* -------------------------------------------------------------------------- */

async function fetchEconomicTimesNews(limit = 15): Promise<NewsItem[]> {
  const feeds = [
    "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2146842.cms",
  ];
  const results = await Promise.all(feeds.map(fetchRss));
  return results
    .flat()
    .slice(0, limit)
    .map((i) => ({
      headline: i.title,
      source: "Economic Times",
      url: i.link,
      publishedAt: safeIso(i.pubDate),
      tickers: [],
      summary: i.description || null,
    }));
}

/* -------------------------------------------------------------------------- */
/* Source: NSE India corporate announcements                                  */
/* -------------------------------------------------------------------------- */

interface RawNseAnnouncement {
  subject?: string;
  symbol?: string;
  company?: string;
  bm_desc?: string;
  exchdisstime?: string;
}

async function fetchNseAnnouncements(limit = 20): Promise<NewsItem[]> {
  try {
    const session = await fetch("https://www.nseindia.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(6000),
    });
    const cookies = session.headers.get("set-cookie") ?? "";

    const res = await fetch(
      "https://www.nseindia.com/api/corporate-announcements?index=equities",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "application/json",
          Cookie: cookies,
          Referer: "https://www.nseindia.com",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];
    const raw = (await res.json()) as RawNseAnnouncement[];
    return raw.slice(0, limit).map((a) => ({
      headline: cleanFeedText(`[${a.symbol ?? "NSE"}] ${a.subject ?? a.bm_desc ?? "Corporate announcement"}`),
      source: "NSE India",
      url: "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
      publishedAt: a.exchdisstime ? new Date(a.exchdisstime).toISOString() : isoNow(),
      tickers: a.symbol ? [`${a.symbol}.NS`] : [],
      summary: a.bm_desc ?? null,
    }));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Source: NewsAPI.org (optional, free tier 100 req/day)                      */
/* -------------------------------------------------------------------------- */

interface NewsApiArticle {
  title?: string;
  description?: string;
  url?: string;
  source?: { name?: string };
  publishedAt?: string;
}

async function fetchNewsApi(query: string, limit = 20): Promise<NewsItem[]> {
  const key = process.env.NEWSAPI_KEY;
  if (!key) return [];
  try {
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", query);
    url.searchParams.set("language", "en");
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", String(limit));
    const res = await fetch(url.toString(), {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { articles?: NewsApiArticle[] };
    return (data.articles ?? [])
      .filter((a) => a.title && a.title !== "[Removed]")
      .map((a) => ({
        headline: cleanFeedText(a.title!),
        source: a.source?.name ?? "NewsAPI",
        url: a.url ?? "",
        publishedAt: a.publishedAt ?? isoNow(),
        tickers: [],
        summary: a.description ?? null,
      }));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Source: Moneycontrol RSS                                                    */
/* -------------------------------------------------------------------------- */

async function fetchMoneycontrolNews(limit = 15): Promise<NewsItem[]> {
  const items = await fetchRss("https://www.moneycontrol.com/rss/marketoutlook.xml");
  return items.slice(0, limit).map((i) => ({
    headline: i.title,
    source: "Moneycontrol",
    url: i.link,
    publishedAt: safeIso(i.pubDate),
    tickers: [],
    summary: i.description || null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Public API — market scanner                                                */
/* -------------------------------------------------------------------------- */

export interface NewsFetchOptions {
  /** Free-text theme query to focus the scan on (e.g. "RBI rate cut inflation"). */
  query?: string;
  /** Include Indian market sources. Default true. */
  india?: boolean;
  /** Include global sources. Default true. */
  global?: boolean;
  /** Max total items returned (de-duped by headline). */
  limit?: number;
}

/** Aggregate news from all available sources into a de-duped list. */
export async function fetchMarketNews(opts: NewsFetchOptions = {}): Promise<NewsItem[]> {
  const { query, india = true, global: glob = true, limit = 60 } = opts;

  const tasks: Promise<NewsItem[]>[] = [];

  if (glob) {
    tasks.push(fetchYahooNews(query ?? "stock market economy", 20));
    tasks.push(fetchNewsApi(query ?? "stock market economy finance", 20));
    if (query) tasks.push(fetchGoogleNews(query, 15));
  }

  if (india) {
    tasks.push(fetchEconomicTimesNews(20));
    tasks.push(fetchNseAnnouncements(20));
    tasks.push(fetchMoneycontrolNews(15));
    tasks.push(fetchGoogleNews((query ? `${query} ` : "") + "nifty sensex india stock market", 15));
  }

  const results = await Promise.allSettled(tasks);
  const all: NewsItem[] = results
    .filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  // De-duplicate by normalised headline prefix (first 60 chars).
  const seen = new Set<string>();
  const deduped: NewsItem[] = [];
  for (const item of all) {
    const key = item.headline.toLowerCase().slice(0, 60);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  // Sort newest-first, best-effort (some sources return inaccurate dates).
  deduped.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  // Mint the stable evidence id at the single aggregation choke point rather
  // than in each source adapter — every article leaves here traceable.
  return deduped.slice(0, limit).map((item) => ({ ...item, storyId: storyIdFor(item) }));
}
