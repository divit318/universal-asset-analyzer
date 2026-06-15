/**
 * Screener.in data adapter.
 *
 * Screener.in exposes public JSON endpoints for Indian listed companies:
 *   https://www.screener.in/api/company/<symbol>/
 *
 * No API key is required for public data. The symbol must be the NSE symbol
 * WITHOUT the .NS suffix (e.g. "RELIANCE", "HDFCBANK", "INFY").
 *
 * Data returned:
 *   - 10-year P&L, balance sheet, cash flow
 *   - Quarterly results
 *   - Promoter/DII/FII/retail shareholding
 *   - Peer comparison table
 *   - Valuation ratios (P/E, P/B, EV/EBITDA, etc.)
 */

export interface ScreenerInRatio {
  name: string;
  values: { period?: string; value: string }[];
}

export interface ScreenerInPeer {
  name: string;
  url: string;
  market_cap: string | null;
  current_price: string | null;
  high_low: string | null;
  pe: string | null;
  book_value: string | null;
  dividend_yield: string | null;
  roce: string | null;
  roe: string | null;
}

export interface ScreenerInShareholding {
  holding: string;
  name: string;
  values: string[];
}

interface RawScreenerCompany {
  name?: string;
  bse_code?: string;
  nse_id?: string;
  market_cap?: number | string | null;
  current_price?: number | string | null;
  high?: number | string | null;
  low?: number | string | null;
  stock_pe?: number | string | null;
  book_value?: number | string | null;
  dividend_yield?: number | string | null;
  roce?: number | string | null;
  roe?: number | string | null;
  debt?: number | string | null;
  change?: number | string | null;
  ratios?: ScreenerInRatio[];
  peers?: ScreenerInPeer[];
  shareholding?: ScreenerInShareholding[];
  peer_comparison?: ScreenerInPeer[];
}

export interface ScreenerInCompany {
  name: string;
  symbol: string;
  bseCode: string | null;
  marketCap: number | null;        // crores INR
  currentPrice: number | null;     // INR
  high52w: number | null;
  low52w: number | null;
  pe: number | null;
  bookValue: number | null;
  dividendYield: number | null;    // %
  roce: number | null;             // %
  roe: number | null;              // %
  debt: number | null;             // crores INR
  changePercent: number | null;    // %
  ratios: ScreenerInRatio[];
  peers: ScreenerInPeer[];
  shareholding: ScreenerInShareholding[];
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCompany(symbol: string, raw: RawScreenerCompany): ScreenerInCompany {
  return {
    name: raw.name ?? symbol,
    symbol,
    bseCode: raw.bse_code ? String(raw.bse_code) : null,
    marketCap: num(raw.market_cap),
    currentPrice: num(raw.current_price),
    high52w: num(raw.high),
    low52w: num(raw.low),
    pe: num(raw.stock_pe),
    bookValue: num(raw.book_value),
    dividendYield: num(raw.dividend_yield),
    roce: num(raw.roce),
    roe: num(raw.roe),
    debt: num(raw.debt),
    changePercent: num(raw.change),
    ratios: raw.ratios ?? [],
    peers: raw.peers ?? raw.peer_comparison ?? [],
    shareholding: raw.shareholding ?? [],
  };
}

/** Strip .NS / .BO suffix if caller passes Yahoo-style symbol. */
function normalise(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/i, "").toUpperCase();
}

const cache = new Map<string, { data: ScreenerInCompany; ts: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

/** Fetch company data from screener.in. Returns null if not found. */
export async function getScreenerInCompany(
  symbol: string,
): Promise<ScreenerInCompany | null> {
  const sym = normalise(symbol);
  const cached = cache.get(sym);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const res = await fetch(`https://www.screener.in/api/company/${sym}/`, {
      headers: {
        "User-Agent": "universal-asset-analyzer/1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`screener.in returned ${res.status} for ${sym}`);
    const raw = (await res.json()) as RawScreenerCompany;
    const data = parseCompany(sym, raw);
    cache.set(sym, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Derived helpers for the research / scanner layers                          */
/* -------------------------------------------------------------------------- */

/** Extract a named ratio's most recent value (e.g. "Price to Earning"). */
export function getRatio(company: ScreenerInCompany, name: string): number | null {
  const ratio = company.ratios.find((r) =>
    r.name.toLowerCase().includes(name.toLowerCase()),
  );
  if (!ratio) return null;
  const last = ratio.values.at(-1)?.value ?? ratio.values[0]?.value;
  return last != null ? num(last) : null;
}

/** Get the peer comparison table as a clean array. */
export function getPeers(company: ScreenerInCompany): ScreenerInPeer[] {
  return company.peers;
}

/** Latest promoter holding %. Returns null if unavailable. */
export function getPromoterHolding(company: ScreenerInCompany): number | null {
  const row = company.shareholding.find((s) =>
    s.name.toLowerCase().includes("promoter"),
  );
  if (!row) return null;
  const last = row.values.at(-1);
  return last != null ? num(last) : null;
}

/** Latest FII holding %. */
export function getFIIHolding(company: ScreenerInCompany): number | null {
  const row = company.shareholding.find(
    (s) => s.name.toLowerCase().includes("fii") || s.name.toLowerCase().includes("foreign"),
  );
  if (!row) return null;
  return num(row.values.at(-1) ?? null);
}

/** Latest DII holding %. */
export function getDIIHolding(company: ScreenerInCompany): number | null {
  const row = company.shareholding.find(
    (s) => s.name.toLowerCase().includes("dii") || s.name.toLowerCase().includes("domestic inst"),
  );
  if (!row) return null;
  return num(row.values.at(-1) ?? null);
}
