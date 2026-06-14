import type { ScreenerCriteria, ScreenerRow, ScreenerSortField } from "./types";

/**
 * Universal equity screener backed by Yahoo Finance's live screener endpoint.
 *
 * Unlike a static constituent list, this scans the *entire* US-listed equity
 * universe (~10k names) and applies every filter server-side, so results are
 * exact rather than limited to a curated sample. The endpoint needs a
 * crumb + cookie pair, which we fetch once and cache.
 */

// A minimal UA is deliberate: Yahoo's auth endpoints throttle the verbose
// desktop-Chrome UA string (returning "Too Many Requests") but serve this one.
const UA = "Mozilla/5.0";

interface Auth {
  cookie: string;
  crumb: string;
  expires: number;
}
let cachedAuth: Auth | null = null;
const AUTH_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Fetch (and cache) the cookie + crumb Yahoo requires for screener POSTs. */
async function getAuth(): Promise<Auth> {
  if (cachedAuth && cachedAuth.expires > Date.now()) return cachedAuth;

  // fc.yahoo.com sets the session cookie; getcrumb mints a matching crumb.
  // `no-store` is essential: Next.js instruments global fetch with caching, and
  // a cached crumb/cookie would desync and get rejected (401/429).
  const seed = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    cache: "no-store",
  }).catch(() => null);
  const cookie = seed?.headers.get("set-cookie") ?? "";

  const crumbRes = await fetch(
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
    { headers: { "User-Agent": UA, cookie }, cache: "no-store" },
  );
  const crumb = (await crumbRes.text()).trim();
  // A real crumb is a short token with no whitespace/markup. Anything else
  // ("Too Many Requests", an HTML error page, an empty body) means the auth
  // handshake was rejected — surface it rather than POSTing a garbage crumb.
  if (!crumb || crumb.length > 16 || /[\s<>]/.test(crumb)) {
    throw new Error("Could not obtain a Yahoo screener session (rate-limited)");
  }

  cachedAuth = { cookie, crumb, expires: Date.now() + AUTH_TTL_MS };
  return cachedAuth;
}

/* -------------------------------------------------------------------------- */
/* Query building (pure / testable)                                           */
/* -------------------------------------------------------------------------- */

type Operand =
  | { operator: "gt" | "lt" | "gte" | "lte" | "eq"; operands: [string, string | number] }
  | { operator: "and" | "or"; operands: Operand[] };

const SORT_FIELD: Record<ScreenerSortField, string> = {
  marketCap: "intradaymarketcap",
  changePercent: "percentchange",
  price: "intradayprice",
  volume: "dayvolume",
  peRatio: "peratio.lasttwelvemonths",
};

/**
 * Yahoo's screener `sector` operand uses its own taxonomy (not GICS). These are
 * the 11 sectors it recognises, surfaced in the UI dropdown.
 */
export const SCREENER_SECTORS = [
  "Basic Materials",
  "Communication Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Energy",
  "Financial Services",
  "Healthcare",
  "Industrials",
  "Real Estate",
  "Technology",
  "Utilities",
] as const;

/** Translate criteria into a Yahoo screener query tree. Pure. */
export function buildQuery(c: ScreenerCriteria): Operand {
  const operands: Operand[] = [{ operator: "eq", operands: ["region", "us"] }];
  const add = (op: "gt" | "lt" | "gte" | "lte" | "eq", field: string, v: number | string | null | undefined) => {
    if (v != null && v !== "") operands.push({ operator: op, operands: [field, v] });
  };

  if (c.sector) operands.push({ operator: "eq", operands: ["sector", c.sector] });
  add("gte", "intradayprice", c.minPrice);
  add("lte", "intradayprice", c.maxPrice);
  add("gte", "percentchange", c.minChangePercent);
  add("lte", "percentchange", c.maxChangePercent);
  add("gte", "intradaymarketcap", c.minMarketCap);
  add("lte", "intradaymarketcap", c.maxMarketCap);
  add("gte", "peratio.lasttwelvemonths", c.minPE);
  add("lte", "peratio.lasttwelvemonths", c.maxPE);
  add("gte", "dayvolume", c.minVolume);

  return { operator: "and", operands };
}

/* -------------------------------------------------------------------------- */
/* Response mapping                                                           */
/* -------------------------------------------------------------------------- */

interface RawScreenerQuote {
  symbol?: string;
  longName?: string;
  shortName?: string;
  displayName?: string;
  sector?: string;
  sectorDisp?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  marketCap?: number;
  trailingPE?: number;
  regularMarketVolume?: number;
}

export function mapScreenerRow(q: RawScreenerQuote): ScreenerRow | null {
  if (!q.symbol || q.regularMarketPrice == null) return null;
  return {
    symbol: q.symbol,
    name: q.longName ?? q.displayName ?? q.shortName ?? q.symbol,
    sector: q.sectorDisp ?? q.sector ?? "—",
    price: q.regularMarketPrice,
    changePercent: q.regularMarketChangePercent ?? 0,
    marketCap: q.marketCap ?? null,
    peRatio: q.trailingPE ?? null,
    volume: q.regularMarketVolume ?? null,
  };
}

export interface ScreenerResult {
  rows: ScreenerRow[];
  total: number;
}

/**
 * Run a live screen over the full US equity universe. `size` is capped at 250
 * (Yahoo's per-request maximum); `offset` paginates.
 */
async function postScreener(
  body: object,
  forceFresh: boolean,
): Promise<Response> {
  if (forceFresh) cachedAuth = null;
  const auth = await getAuth();
  return fetch(
    `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(auth.crumb)}`,
    {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "content-type": "application/json",
        cookie: auth.cookie,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
}

export async function runScreener(
  criteria: ScreenerCriteria,
  size = 100,
  offset = 0,
): Promise<ScreenerResult> {
  const body = {
    size: Math.min(Math.max(size, 1), 250),
    offset: Math.max(offset, 0),
    sortField: SORT_FIELD[criteria.sortField ?? "marketCap"],
    sortType: (criteria.sortDir ?? "desc").toUpperCase(),
    quoteType: "EQUITY",
    query: buildQuery(criteria),
    userId: "",
    userIdType: "guid",
  };

  // A stale/throttled crumb (401/403/429) is retried once with a fresh session.
  let res = await postScreener(body, false);
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    res = await postScreener(body, true);
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Yahoo is rate-limiting requests — wait a moment and retry");
    }
    throw new Error(`Screener request failed (${res.status})`);
  }

  const json = (await res.json()) as {
    finance?: {
      result?: { total?: number; quotes?: RawScreenerQuote[] }[];
      error?: { description?: string } | null;
    };
  };
  if (json.finance?.error) {
    throw new Error(json.finance.error.description ?? "Screener query rejected");
  }
  const result = json.finance?.result?.[0];
  const rows = (result?.quotes ?? [])
    .map(mapScreenerRow)
    .filter((r): r is ScreenerRow => r != null)
    // The screener payload omits per-row sector; when the screen is scoped to a
    // sector, every row is that sector, so backfill it for the table.
    .map((r) =>
      r.sector === "—" && criteria.sector ? { ...r, sector: criteria.sector } : r,
    );

  return { rows, total: result?.total ?? rows.length };
}
