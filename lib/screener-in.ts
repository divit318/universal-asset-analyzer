/**
 * Screener.in data adapter — HTML scraper.
 *
 * Screener.in no longer exposes a public REST API for company fundamentals.
 * We resolve the company via their search API, then scrape the HTML company
 * page for key ratios, and fetch peers via their internal AJAX endpoint.
 *
 * Flow:
 *   1. GET /api/company/search/?q={symbol}  → companyId + warehouseId + url
 *   2. GET /company/{symbol}/consolidated/  → HTML page with top-ratios, meta
 *   3. GET /api/company/{warehouseId}/peers/ → HTML peers table
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

export interface ScreenerInCompany {
  name: string;
  symbol: string;
  bseCode: string | null;
  marketCap: number | null;     // crores INR
  currentPrice: number | null;  // INR
  high52w: number | null;
  low52w: number | null;
  pe: number | null;
  bookValue: number | null;
  dividendYield: number | null; // %
  roce: number | null;          // %
  roe: number | null;           // %
  debt: number | null;          // crores INR (from meta if available)
  changePercent: number | null;
  promoterHolding: number | null; // % from meta description
  ratios: ScreenerInRatio[];
  peers: ScreenerInPeer[];
  shareholding: ScreenerInShareholding[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  // Remove commas, %, ₹ etc.
  const s = String(v).replace(/[,₹%\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Strip .NS / .BO suffix; uppercase. */
function normalise(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/i, "").toUpperCase();
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/json,*/*",
  "Referer": "https://www.screener.in/",
};

/** Extract text between two regex patterns. Returns "" if not found. */
function between(html: string, start: RegExp | string, end: RegExp | string): string {
  const s = typeof start === "string" ? html.indexOf(start) : html.search(start);
  if (s === -1) return "";
  const sub = html.slice(s);
  const e = typeof end === "string" ? sub.indexOf(end) : sub.search(end);
  return e === -1 ? sub : sub.slice(0, e);
}

/** Strip all HTML tags from a string. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

/* -------------------------------------------------------------------------- */
/* Search → resolve companyId + warehouseId                                  */
/* -------------------------------------------------------------------------- */

interface SearchResult {
  id: number;
  name: string;
  url: string;
}

async function resolveCompany(symbol: string): Promise<{ name: string; companyId: number; warehouseId: number; slug: string } | null> {
  const res = await fetch(
    `https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}`,
    { headers: HEADERS, signal: AbortSignal.timeout(8_000) },
  );
  if (!res.ok) return null;
  const results = (await res.json()) as SearchResult[];
  // Find exact match (NSE symbol = slug) or first result
  const match = results.find((r) => {
    const slug = r.url.split("/").filter(Boolean)[1]?.toUpperCase();
    return slug === symbol;
  }) ?? results[0];
  if (!match) return null;

  // Extract the slug from URL e.g. /company/RELIANCE/consolidated/
  const slug = match.url.split("/").filter(Boolean)[1] ?? symbol;

  // Fetch the company page HTML to get warehouseId
  const pageRes = await fetch(
    `https://www.screener.in/company/${slug}/consolidated/`,
    { headers: HEADERS, signal: AbortSignal.timeout(10_000) },
  );
  if (!pageRes.ok) return null;
  const html = await pageRes.text();

  const whMatch = html.match(/data-warehouse-id="(\d+)"/);
  const cidMatch = html.match(/data-company-id="(\d+)"/);
  if (!whMatch || !cidMatch) return null;

  return {
    name: match.name,
    companyId: parseInt(cidMatch[1]),
    warehouseId: parseInt(whMatch[1]),
    slug,
  };
}

/* -------------------------------------------------------------------------- */
/* Scrape top-ratios from company HTML                                        */
/* -------------------------------------------------------------------------- */

function scrapeTopRatios(html: string): Record<string, number | null> {
  const block = between(html, 'id="top-ratios"', "</ul>");
  // Each <li> has <span class="name">Label</span> ... <span class="number">Val</span>
  const items = [...block.matchAll(/<span class="name">([\s\S]*?)<\/span>[\s\S]*?<span class="number">([\s\S]*?)<\/span>/g)];
  const result: Record<string, number | null> = {};
  for (const [, name, val] of items) {
    result[stripTags(name).trim()] = num(val);
  }
  // High/Low is rendered as two numbers — grab 52W High from the value span
  const hlMatch = html.match(/High \/ Low[\s\S]*?<span class="number">([^<]+)<\/span>\s*\/\s*<span class="number">([^<]+)<\/span>/);
  if (hlMatch) {
    result["52W High"] = num(hlMatch[1]);
    result["52W Low"] = num(hlMatch[2]);
  }
  return result;
}

/** Extract promoter holding % from the meta description. */
function scrapePromoterFromMeta(html: string): number | null {
  const m = html.match(/Promoter Holding:\s*([\d.]+)%/);
  return m ? num(m[1]) : null;
}

/** Scrape annual ratios table (Debtor Days, D/E, Interest Coverage, etc.). */
function scrapeRatiosTable(html: string): ScreenerInRatio[] {
  const section = between(html, 'id="ratios"', 'id="shareholding"') ||
                  between(html, 'id="ratios"', 'id="');
  if (!section) return [];

  const rows = [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  const ratios: ScreenerInRatio[] = [];

  // Get header row for year labels
  const headerRow = rows[0]?.[1] ?? "";
  const headerCells = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map(([, c]) => stripTags(c).trim())
    .filter(Boolean);

  for (const [, row] of rows.slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(([, c]) => stripTags(c).trim());
    if (cells.length < 2) continue;
    const name = cells[0];
    const values = cells.slice(1).map((v, i) => ({
      period: headerCells[i + 1] ?? String(i),
      value: v,
    }));
    if (name) ratios.push({ name, values });
  }
  return ratios;
}

/* -------------------------------------------------------------------------- */
/* Fetch peers via AJAX endpoint                                              */
/* -------------------------------------------------------------------------- */

function parsePeersHtml(html: string): ScreenerInPeer[] {
  const rows = [...html.matchAll(/data-row-company-id="\d+"[^>]*>([\s\S]*?)<\/tr>/g)];
  return rows.map(([, row]) => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(([, c]) => stripTags(c).trim());
    // Columns: S.No, Name, CMP, P/E, Mar Cap, Div Yld, NP Qtr, Qtr Profit Var, Sales Qtr, Qtr Sales Var, ROCE
    const link = row.match(/href="([^"]+)"/)?.[1] ?? "";
    return {
      name: cells[1] ?? "",
      url: link,
      current_price: cells[2] ?? null,
      pe: cells[3] ?? null,
      market_cap: cells[4] ?? null,
      dividend_yield: cells[5] ?? null,
      book_value: null,
      high_low: null,
      roce: cells[10] ?? null,
      roe: null,
    };
  }).filter((p) => p.name);
}

/* -------------------------------------------------------------------------- */
/* Cache + public fetch function                                              */
/* -------------------------------------------------------------------------- */

const cache = new Map<string, { data: ScreenerInCompany; ts: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

export async function getScreenerInCompany(symbol: string): Promise<ScreenerInCompany | null> {
  const sym = normalise(symbol);
  const cached = cache.get(sym);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const resolved = await resolveCompany(sym);
    if (!resolved) return null;

    const { name, companyId, warehouseId, slug } = resolved;

    // Fetch company page HTML + peers HTML in parallel
    const [pageRes, peersRes] = await Promise.allSettled([
      fetch(`https://www.screener.in/company/${slug}/consolidated/`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(`https://www.screener.in/api/company/${warehouseId}/peers/`, {
        headers: { ...HEADERS, "X-Requested-With": "XMLHttpRequest", "Referer": `https://www.screener.in/company/${slug}/consolidated/` },
        signal: AbortSignal.timeout(8_000),
      }),
    ]);

    const html = pageRes.status === "fulfilled" && pageRes.value.ok
      ? await pageRes.value.text()
      : "";
    const peersHtml = peersRes.status === "fulfilled" && peersRes.value.ok
      ? await peersRes.value.text()
      : "";

    const topRatios = scrapeTopRatios(html);
    const ratios = scrapeRatiosTable(html);
    const peers = parsePeersHtml(peersHtml);
    const promoterHolding = scrapePromoterFromMeta(html);

    const data: ScreenerInCompany = {
      name,
      symbol: sym,
      bseCode: null,
      marketCap: topRatios["Market Cap"] ?? null,
      currentPrice: topRatios["Current Price"] ?? null,
      high52w: topRatios["52W High"] ?? null,
      low52w: topRatios["52W Low"] ?? null,
      pe: topRatios["Stock P/E"] ?? null,
      bookValue: topRatios["Book Value"] ?? null,
      dividendYield: topRatios["Dividend Yield"] ?? null,
      roce: topRatios["ROCE"] ?? null,
      roe: topRatios["ROE"] ?? null,
      debt: null,
      changePercent: null,
      promoterHolding,
      ratios,
      peers,
      shareholding: promoterHolding != null
        ? [{ holding: "promoter", name: "Promoters", values: [String(promoterHolding)] }]
        : [],
    };

    cache.set(sym, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Derived helpers                                                            */
/* -------------------------------------------------------------------------- */

export function getRatio(company: ScreenerInCompany, name: string): number | null {
  const ratio = company.ratios.find((r) =>
    r.name.toLowerCase().includes(name.toLowerCase()),
  );
  if (!ratio) return null;
  const last = ratio.values.at(-1)?.value ?? ratio.values[0]?.value;
  return last != null ? num(last) : null;
}

export function getPeers(company: ScreenerInCompany): ScreenerInPeer[] {
  return company.peers;
}

export function getPromoterHolding(company: ScreenerInCompany): number | null {
  return company.promoterHolding ?? null;
}

export function getFIIHolding(company: ScreenerInCompany): number | null {
  const row = company.shareholding.find(
    (s) => s.name.toLowerCase().includes("fii") || s.name.toLowerCase().includes("foreign"),
  );
  if (!row) return null;
  return num(row.values.at(-1) ?? null);
}

export function getDIIHolding(company: ScreenerInCompany): number | null {
  const row = company.shareholding.find(
    (s) => s.name.toLowerCase().includes("dii") || s.name.toLowerCase().includes("domestic"),
  );
  if (!row) return null;
  return num(row.values.at(-1) ?? null);
}
