/**
 * Access to Yahoo Finance's live screener endpoint.
 *
 * Rather than screening a static constituent list, this queries the entire
 * listed universe for a given quoteType and applies the filters server-side, so
 * a universe is exact rather than a curated sample. The endpoint needs a
 * crumb + cookie pair, which we fetch once and cache.
 *
 * There used to be a second, criteria-object-based query builder here
 * (`runScreener`/`buildQuery`/`mapScreenerRow`) hardcoded to EQUITY and to one
 * fixed row shape. It was the last remnant of the pre-registry screener, and
 * `pageRawScreener` + `q` below replaced it entirely — keeping two query
 * builders for the same endpoint is exactly the duplication the universal
 * screener exists to remove.
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

/** POST one screener query, minting a fresh session when asked to. */
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

/* -------------------------------------------------------------------------- */
/* Generic screener access (multi-asset)                                      */
/* -------------------------------------------------------------------------- */

/**
 * A raw Yahoo screener row. Deliberately untyped beyond `symbol` — each asset
 * class reads a different subset of the ~60 fields Yahoo returns (an ETF row
 * carries netExpenseRatio and netAssets; a crypto row carries circulatingSupply
 * and maxSupply; neither carries the other's), so narrowing here would mean
 * maintaining a union of every field any class might want. The universe
 * providers in lib/screener/universes/ do the narrowing, each for its own class.
 */
export type RawQuoteRow = Record<string, unknown> & { symbol?: string };

export type ScreenerQuoteType =
  | "EQUITY"
  | "ETF"
  | "MUTUALFUND"
  | "CRYPTOCURRENCY"
  | "FUTURE"
  | "INDEX";

export interface RawScreenerOptions {
  quoteType: ScreenerQuoteType;
  /** Yahoo query tree. Callers build this with `eq`/`gte`/`and` operands. */
  query: Operand;
  sortField: string;
  sortDir?: "asc" | "desc";
  size?: number;
  offset?: number;
}

/**
 * Run one page of a Yahoo screener query, for any quoteType.
 *
 * Note for anyone extending this: `quoteType: "CURRENCY"` is accepted by the
 * endpoint but returns **zero rows** — verified. Forex therefore cannot be
 * screened this way and uses a curated pair list instead
 * (lib/assets/reference/policy-rates.ts). Likewise "FUTURE" returns individual
 * dated + TAS contracts rather than anything you'd want to screen, which is why
 * commodities use a curated contract list too.
 */
export async function runRawScreener(opts: RawScreenerOptions): Promise<{
  rows: RawQuoteRow[];
  total: number;
}> {
  const body = {
    size: Math.min(Math.max(opts.size ?? 100, 1), 250),
    offset: Math.max(opts.offset ?? 0, 0),
    sortField: opts.sortField,
    sortType: (opts.sortDir ?? "desc").toUpperCase(),
    quoteType: opts.quoteType,
    query: opts.query,
    userId: "",
    userIdType: "guid",
  };

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
      result?: { total?: number; quotes?: RawQuoteRow[] }[];
      error?: { description?: string } | null;
    };
  };
  if (json.finance?.error) {
    throw new Error(json.finance.error.description ?? "Screener query rejected");
  }
  const result = json.finance?.result?.[0];
  const rows = (result?.quotes ?? []).filter((q) => typeof q.symbol === "string");
  return { rows, total: result?.total ?? rows.length };
}

/** Page a screener query until `limit` rows are collected or Yahoo runs out. */
export async function pageRawScreener(
  opts: Omit<RawScreenerOptions, "size" | "offset">,
  limit: number,
): Promise<RawQuoteRow[]> {
  const out: RawQuoteRow[] = [];
  const seen = new Set<string>();
  const PAGE = 250;

  for (let offset = 0; offset < limit; offset += PAGE) {
    const { rows } = await runRawScreener({
      ...opts,
      size: Math.min(PAGE, limit - offset),
      offset,
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const sym = r.symbol as string;
      if (seen.has(sym)) continue;
      seen.add(sym);
      out.push(r);
    }
    if (rows.length < PAGE) break; // last page
  }

  return out;
}

/** Operand helpers, so providers don't hand-build Yahoo's query trees. */
export const q = {
  eq: (field: string, value: string | number): Operand => ({
    operator: "eq",
    operands: [field, value],
  }),
  gte: (field: string, value: number): Operand => ({ operator: "gte", operands: [field, value] }),
  lte: (field: string, value: number): Operand => ({ operator: "lte", operands: [field, value] }),
  and: (...operands: Operand[]): Operand => ({ operator: "and", operands }),
  or: (...operands: Operand[]): Operand => ({ operator: "or", operands }),
};
