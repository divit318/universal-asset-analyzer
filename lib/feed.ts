/**
 * Shared RSS/Atom feed utilities.
 *
 * Extracted from lib/news.ts so lib/india-news.ts can reuse the same parser
 * without a news.ts ↔ india-news.ts import cycle (news.ts routes Indian
 * symbols into india-news.ts; both consume feeds).
 */

export function isoNow(): string {
  return new Date().toISOString();
}

/** Parse a date string from an RSS feed without throwing on malformed values. */
export function safeIso(dateStr: string): string {
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

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  /** Publisher from Google News' `<source>` element, when present. */
  sourceName: string | null;
}

/** Very minimal RSS/Atom parser — extracts <item> blocks without a dependency. */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
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
    const sourceName = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? null;

    const cleanTitle = cleanFeedText(title);
    if (cleanTitle) {
      items.push({
        title: cleanTitle,
        link: cleanFeedText(link),
        pubDate: pubDate.trim(),
        description: cleanFeedText(description),
        sourceName: sourceName ? cleanFeedText(sourceName) : null,
      });
    }
  }
  return items;
}

export async function fetchRss(url: string): Promise<RssItem[]> {
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
