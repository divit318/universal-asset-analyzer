import { pageRawScreener, q, type RawQuoteRow } from "./yahoo-screener";

/** One company in an investable universe (symbol + display name). */
export interface UniverseEntry {
  symbol: string;
  name: string;
}

const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000; // refresh the symbol lists daily

/**
 * Equities: the largest US listings by market cap, PLUS a liquid small/mid-cap
 * tranche.
 *
 * The second tranche exists because a pure top-N-by-market-cap ranking is a
 * poor universe for anything but large caps. Measured against the live
 * screener: rank 1,000 is a $9.7B company. So a "sub-$10B" small-cap screen run
 * against the top 1,000 could only ever reach names ranked ~990-1,000 — it
 * matched five companies, and read as a broken filter rather than as a universe
 * that simply stops before small caps begin.
 *
 * Small/mid caps are therefore fetched deliberately rather than hoped for as
 * the tail of a large-cap list: everything between $300M and $10B, ranked by
 * *dollar volume* rather than market cap. Re-ranking that band by market cap
 * would just return the $8-10B names tranche 1 already has; ranking it by
 * liquidity yields small caps spread across the whole band that someone can
 * actually trade, and skips the illiquid micro-cap tail no screen should
 * surface anyway.
 */
const LARGE_CAP_LIMIT = Number(process.env.SCREENER_UNIVERSE_LIMIT) || 1000;
const SMALL_CAP_LIMIT = Number(process.env.SCREENER_SMALLCAP_LIMIT) || 600;

/** REITs are their own screening domain, so they get their own universe. */
const REIT_LIMIT = Number(process.env.SCREENER_REIT_LIMIT) || 300;

/** Primary US exchanges only — keeps out OTC/pink-sheet ADRs whose financials are in another currency. */
const PRIMARY_EXCHANGES = q.or(
  q.eq("exchange", "NMS"),
  q.eq("exchange", "NYQ"),
  q.eq("exchange", "ASE"),
);
const US = q.eq("region", "us");

/** Foreign listings / derivatives (.TO, =F, ^IDX). Hyphenated US share classes (BRK-B) are kept. */
const isCleanUsSymbol = (symbol: string): boolean => !/[.=^]/.test(symbol);

/**
 * Preferred-stock tickers (NYSE/NASDAQ convention: TICKER-P + series letter,
 * e.g. SPG-PJ, PSA-PH, VNO-PM) pass Yahoo's screener as quoteType "EQUITY"
 * with sector "Real Estate", so they leaked into the REIT universe — ~28 of
 * 237 names (11.8%) in live verification. Yahoo returns marketCap: undefined
 * for the preferred-share ticker itself (it prices off the common), which
 * then silently nulls every market-cap-dependent metric (P/FFO, payout
 * ratio, FCF yield) for that row. This is distinct from a genuine common
 * dual-class ticker like BRK-A/BRK-B, which is a single letter with no "P"
 * prefix and is deliberately kept.
 */
const isPreferredShare = (symbol: string): boolean => /-P[A-Z]$/.test(symbol);

function toEntries(rows: RawQuoteRow[], seen: Set<string>): UniverseEntry[] {
  const out: UniverseEntry[] = [];
  for (const r of rows) {
    const symbol = r.symbol as string;
    if (!symbol || seen.has(symbol) || !isCleanUsSymbol(symbol) || isPreferredShare(symbol)) continue;
    seen.add(symbol);
    const name =
      (r.longName as string) ?? (r.displayName as string) ?? (r.shortName as string) ?? symbol;
    out.push({ symbol, name });
  }
  return out;
}

/**
 * Indian equities: NSE listings above ~₹1,000 Cr market cap, largest first.
 * Yahoo's screener returns BOTH exchanges' lines for dual-listed companies
 * (RELIANCE.NS + RELIANCE.BO), so the query pins exchange NSI and the mapper
 * additionally de-dupes on the base ticker — one company, one row.
 */
const INDIA_LIMIT = Number(process.env.SCREENER_INDIA_LIMIT) || 500;
const INDIA_MIN_MCAP_INR = 1e10; // ₹1,000 Cr — keeps out the illiquid micro-cap tail

function toIndiaEntries(rows: RawQuoteRow[], seen: Set<string>): UniverseEntry[] {
  const out: UniverseEntry[] = [];
  for (const r of rows) {
    const symbol = r.symbol as string;
    if (!symbol || !/\.NS$/.test(symbol)) continue;
    const base = symbol.replace(/\.NS$/, "");
    if (seen.has(base)) continue;
    seen.add(base);
    const name =
      (r.longName as string) ?? (r.displayName as string) ?? (r.shortName as string) ?? symbol;
    out.push({ symbol, name });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Equity universe                                                            */
/* -------------------------------------------------------------------------- */

let equityCache: { entries: UniverseEntry[]; at: number } | null = null;

export async function getUniverse(
  limit = LARGE_CAP_LIMIT + SMALL_CAP_LIMIT,
): Promise<UniverseEntry[]> {
  if (equityCache && Date.now() - equityCache.at < UNIVERSE_TTL_MS) {
    return equityCache.entries.slice(0, limit);
  }

  const seen = new Set<string>();

  // Tranche 1: the large-cap core — same query and ordering as before, so every
  // name the screener has always had is still there, in the same order.
  const large = await pageRawScreener(
    {
      quoteType: "EQUITY",
      query: q.and(US, PRIMARY_EXCHANGES),
      sortField: "intradaymarketcap",
      sortDir: "desc",
    },
    LARGE_CAP_LIMIT,
  );

  // Tranche 2: liquid small/mid caps. The $10B ceiling deliberately overlaps the
  // bottom of tranche 1 (rank 1,000 ≈ $9.7B); `seen` de-dupes the overlap.
  const small = await pageRawScreener(
    {
      quoteType: "EQUITY",
      query: q.and(
        US,
        PRIMARY_EXCHANGES,
        q.gte("intradaymarketcap", 3e8),
        q.lte("intradaymarketcap", 1e10),
        q.gte("dayvolume", 200_000),
      ),
      sortField: "dayvolume",
      sortDir: "desc",
    },
    SMALL_CAP_LIMIT,
  );

  const entries = [...toEntries(large, seen), ...toEntries(small, seen)];
  equityCache = { entries, at: Date.now() };
  return entries.slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* REIT universe                                                              */
/* -------------------------------------------------------------------------- */

let reitCache: { entries: UniverseEntry[]; at: number } | null = null;

/**
 * Listed real estate, as its own universe rather than as whatever happened to
 * survive a market-cap cutoff built for something else.
 *
 * REIT screening previously ran over the Real Estate slice of the top-1,000
 * equity universe: 55 names, because REITs are mostly mid-caps and that list
 * stops at $9.7B. There are 364 Real Estate companies on the primary US
 * exchanges. Screening a sixth of the sector and calling it "REITs" was the
 * single biggest thing wrong with that asset class.
 *
 * A $200M market-cap floor drops the shells and non-traded stubs (~238 names
 * clear it), and REIT_LIMIT sits above that so the floor, not the limit, binds.
 */
export async function getReitUniverse(limit = REIT_LIMIT): Promise<UniverseEntry[]> {
  if (reitCache && Date.now() - reitCache.at < UNIVERSE_TTL_MS) {
    return reitCache.entries.slice(0, limit);
  }

  const rows = await pageRawScreener(
    {
      quoteType: "EQUITY",
      query: q.and(
        US,
        PRIMARY_EXCHANGES,
        q.eq("sector", "Real Estate"),
        q.gte("intradaymarketcap", 2e8),
      ),
      sortField: "intradaymarketcap",
      sortDir: "desc",
    },
    limit,
  );

  const entries = toEntries(rows, new Set<string>());
  reitCache = { entries, at: Date.now() };
  return entries.slice(0, limit);
}

let indiaCache: { entries: UniverseEntry[]; at: number } | null = null;

/**
 * The Indian equity universe — the ~500 largest NSE listings by market cap
 * (floor ≈ ₹1,000 Cr). Auto-refreshing (24h TTL) from Yahoo's own screener,
 * so index changes, new listings and renames flow through without anyone
 * maintaining a list: a company enters when its market cap ranks it in,
 * leaves when it doesn't.
 */
export async function getIndiaUniverse(limit = INDIA_LIMIT): Promise<UniverseEntry[]> {
  if (indiaCache && Date.now() - indiaCache.at < UNIVERSE_TTL_MS) {
    return indiaCache.entries.slice(0, limit);
  }

  const rows = await pageRawScreener(
    {
      quoteType: "EQUITY",
      query: q.and(
        q.eq("region", "in"),
        q.eq("exchange", "NSI"),
        q.gte("intradaymarketcap", INDIA_MIN_MCAP_INR),
      ),
      sortField: "intradaymarketcap",
      sortDir: "desc",
    },
    // Over-fetch: BSE lines that slip past the exchange pin and dual-listing
    // duplicates are dropped by toIndiaEntries, shrinking the page.
    Math.round(limit * 1.2),
  );

  const entries = toIndiaEntries(rows, new Set<string>()).slice(0, limit);
  indiaCache = { entries, at: Date.now() };
  return entries;
}
