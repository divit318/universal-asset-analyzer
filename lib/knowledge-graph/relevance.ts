/**
 * Event relevance for the knowledge graph. Pure, testable, no I/O.
 *
 * Three deterministic gates that were missing and produced the worst graphs
 * this feature ever shipped (see docs/kg/01_AUDIT.md):
 *
 * 1. Subject linkage (KG-011): the timeline store attaches scanner headlines
 *    to a symbol by co-mention (any event whose affectedTickers OR sector
 *    matches). "Meta's Bold $6.5B Power Move" is not an Apple event. A
 *    news/scanner headline enters a symbol's graph only when the symbol or
 *    the company name is materially present in the title. Filings, earnings
 *    dates, and alert sources are intrinsically about their symbol and always
 *    pass.
 *
 * 2. Region scoping (KG-012): scanner feeds carry NSE-listed corporate
 *    announcements; nothing stopped them from leaking into US sector graphs.
 *    An event qualifies for a US-scoped graph only when at least one affected
 *    ticker is plausibly US-listed.
 *
 * 3. Near-duplicate collapse (KG-013): the same story from two wires must be
 *    one node. Titles are normalized for identity.
 */

import type { TimelineEvent } from "../types";

/** Corporate suffixes that never help identify a company in a headline. */
const NAME_STOPWORDS = new Set([
  "inc", "inc.", "corp", "corp.", "corporation", "co", "co.", "company",
  "ltd", "ltd.", "plc", "sa", "nv", "se", "ag", "the", "holdings", "group",
  "class", "a", "b", "c", "trust", "fund", "etf", "usd",
]);

/** Meaningful name tokens: "Apple Inc" -> ["apple"], "Taiwan Semiconductor Manufacturing" -> ["taiwan", "semiconductor", "manufacturing"]. */
export function companyNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

/**
 * Is this headline materially about the symbol? True when the ticker appears
 * as a word, or when the identifying part of the company name does. This is
 * a linkage gate, not a relevance ranking: it exists to stop co-mention
 * artefacts ("Dollar slides against the yen..." tagged AAPL), not to score
 * how central the subject is beyond presence.
 */
export function isMateriallyAbout(title: string, symbol: string, companyName: string | null): boolean {
  const t = title.toLowerCase();
  const sym = symbol.toLowerCase().replace(/-usd$/, "");
  const symbolRe = new RegExp(`(^|[^a-z0-9])${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  if (symbolRe.test(t)) return true;
  if (companyName) {
    const tokens = companyNameTokens(companyName);
    // The first identifying token is usually the household name ("apple",
    // "broadcom"); require it as a whole word.
    const first = tokens[0];
    if (first && new RegExp(`(^|[^a-z0-9])${first}([^a-z0-9]|$)`).test(t)) return true;
  }
  return false;
}

/**
 * Should this timeline event link to its symbol in the graph?
 * Symbol-intrinsic sources always pass; broadcast sources (news, scanner)
 * must pass the material-mention gate.
 */
export function timelineEventLinks(event: TimelineEvent, companyName: string | null): boolean {
  const kind = event.source.kind;
  if (kind === "filing" || kind === "earnings_calendar" || kind === "watchlist_alert" || kind === "portfolio_alert" || kind === "sector_rotation") {
    return true;
  }
  return isMateriallyAbout(event.title, event.symbol, companyName);
}

/**
 * Plausibly a US listing: 1-5 letters, optionally a share-class or preferred
 * suffix. Excludes foreign-exchange suffixes (.NS, .BO, .L, .T, ...) and the
 * long bare names Indian feeds use (JSWSTEEL, BRITANNIA).
 */
export function isUsListedTicker(ticker: string): boolean {
  return /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(ticker.toUpperCase()) && !/\.(NS|BO|L|T|HK|TW|KS|SW|PA|DE|AS|AX|TO|SI)$/i.test(ticker);
}

/**
 * Region gate for US-scoped graphs: at least one affected ticker must be
 * plausibly US-listed. Events with no tickers at all pass (macro headlines
 * are region-scoped by their sectors, not by a listing).
 */
export function eventQualifiesForUsScope(affectedTickers: string[]): boolean {
  if (affectedTickers.length === 0) return true;
  return affectedTickers.some(isUsListedTicker);
}

/** Normalized identity for near-duplicate story collapse. */
export function normalizedTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}
