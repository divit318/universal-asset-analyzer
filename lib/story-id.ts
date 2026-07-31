/**
 * Stable article identity for evidence linking.
 *
 * Every ingested article gets a storyId minted at collection time
 * (lib/news.ts) and carried through the pipeline as additive fields, so any
 * insight — theme, causal event, sector sentiment, opportunity — can point
 * back at the exact articles it came from, and an article can be traced
 * forward to everything it produced.
 *
 * The id is a pure function of the article's identity (URL when present,
 * headline+source otherwise), NOT a random UUID: payloads cached before the
 * field existed can have their ids re-derived deterministically, so the
 * evidence drawer degrades gracefully on stale data instead of throwing.
 *
 * Zero-I/O literal module (like lib/gics-sectors.ts) so client components can
 * import it freely.
 */

/** FNV-1a — tiny, stable, dependency-free. Same algorithm as lib/wire/tape.ts ids. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface StoryIdentity {
  url: string;
  headline: string;
  source: string;
}

/** Deterministic story id — same article in, same id out, forever. */
export function storyIdFor(item: StoryIdentity): string {
  const basis = item.url.trim() !== "" ? item.url.trim() : `${item.headline}|${item.source}`;
  return `s${fnv1a(basis)}`;
}
