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

import { getDataset } from "./platform/data-layer";

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

export interface ScreenerInAnnualPL {
  period: string;
  sales: number | null;
  netProfit: number | null;
  opmPercent: number | null;
  /** Extended rows (2026-08 parser v2). All in ₹ Cr except % / per-share. */
  expenses?: number | null;
  operatingProfit?: number | null;
  otherIncome?: number | null;
  interest?: number | null;
  depreciation?: number | null;
  profitBeforeTax?: number | null;
  eps?: number | null;               // ₹ per share
  dividendPayoutPercent?: number | null;
  /** Banks/NBFCs only — screener.in swaps the operating rows for these. */
  financingProfit?: number | null;
  financingMarginPercent?: number | null;
}

export interface ScreenerInQuarterlyPL {
  period: string;
  sales: number | null;
  netProfit: number | null;
  opmPercent: number | null;
  expenses?: number | null;
  operatingProfit?: number | null;
  otherIncome?: number | null;
  interest?: number | null;
  depreciation?: number | null;
  profitBeforeTax?: number | null;
  eps?: number | null;
  financingProfit?: number | null;
  financingMarginPercent?: number | null;
  /** Banks/NBFCs only — reported quarterly on screener.in. */
  grossNpaPercent?: number | null;
  netNpaPercent?: number | null;
}

/**
 * A scraped statement table (balance sheet / cash flow), periods preserved
 * exactly as the source orders them (oldest → newest). Every row is kept —
 * including sector-specific ones like a bank's "Deposits" — so nothing is
 * thrown away because it doesn't fit a generic schema. Values are ₹ Cr.
 */
export interface ScreenerInStatementRow {
  name: string;                  // display name, e.g. "Borrowings", "Deposits"
  values: (number | null)[];     // aligned 1:1 with `periods`
}

export interface ScreenerInStatements {
  periods: string[];
  rows: ScreenerInStatementRow[];
}

/** A dated document link from the screener.in "Documents" section. */
export interface ScreenerInDocumentLink {
  label: string;          // "Financial Year 2026", "Rating update"
  url: string;
  /** Source note as shown ("from bse", "3 Jul from care"). */
  note: string | null;
}

export interface ScreenerInConcall {
  date: string;           // "Jul 2026" as rendered
  transcriptUrl: string | null;
  pptUrl: string | null;
  recordingUrl: string | null;
}

/**
 * Company documents scraped from the same page: annual report PDFs (BSE/NSE),
 * earnings-call transcripts/presentations, and credit-rating updates. All
 * links point at the OFFICIAL documents (bseindia.com / nsearchives / rating
 * agencies) — screener.in is the index, not the source.
 */
export interface ScreenerInDocuments {
  annualReports: ScreenerInDocumentLink[];
  concalls: ScreenerInConcall[];
  creditRatings: ScreenerInDocumentLink[];
}

export interface ScreenerInCompany {
  name: string;
  symbol: string;
  bseCode: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;     // crores INR
  currentPrice: number | null;  // INR
  high52w: number | null;
  low52w: number | null;
  pe: number | null;
  bookValue: number | null;
  dividendYield: number | null; // %
  roce: number | null;          // %
  roe: number | null;           // %
  debt: number | null;          // crores INR — latest Borrowings from the balance sheet
  changePercent: number | null;
  promoterHolding: number | null; // % from meta description
  ratios: ScreenerInRatio[];
  peers: ScreenerInPeer[];
  shareholding: ScreenerInShareholding[];
  shareholdingPeriods: string[];
  annualPL: ScreenerInAnnualPL[];
  quarterlyPL: ScreenerInQuarterlyPL[];
  /** Full balance sheet / cash-flow tables (₹ Cr), null if the section is absent. */
  balanceSheet: ScreenerInStatements | null;
  cashFlow: ScreenerInStatements | null;
  /**
   * Reporting basis as stated by the source page ("Consolidated Figures in
   * Rs. Crores" vs "Standalone …"). Standalone-only companies serve their
   * standalone statements under the /consolidated/ URL, so this is the ONLY
   * reliable indicator of what the numbers actually are.
   */
  basis: "consolidated" | "standalone" | null;
  /**
   * "financial" when screener.in reports bank/NBFC-shaped statements
   * (Financing Profit / Financing Margin instead of Operating Profit / OPM).
   * Generic leverage math (D/E, interest coverage) is NOT meaningful then.
   */
  statementKind: "industrial" | "financial";
  /**
   * Company-specific operating KPIs screener.in publishes in the ratios
   * table beyond the standard efficiency set — e.g. a bank's "CASA ratio %",
   * an insurer's persistency, Reliance's retail store count. Preserved
   * verbatim for sector-specific surfaces.
   */
  kpis: ScreenerInRatio[];
  /** Annual reports / concalls / credit ratings — null when the section is absent. */
  documents: ScreenerInDocuments | null;
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

/** Decode the HTML entities screener.in actually emits (labels come as
 * `Sales&nbsp;+`; without this, row lookups like rowMap.get("sales") miss). */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\u00a0/g, " ");
}

/** Strip all HTML tags from a string. */
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).trim();
}

/* -------------------------------------------------------------------------- */
/* Search → resolve companyId + warehouseId                                  */
/* -------------------------------------------------------------------------- */

interface SearchResult {
  id: number;
  name: string;
  url: string;
}

async function resolveCompany(symbol: string): Promise<{ name: string; companyId: number; warehouseId: number; slug: string; html: string } | null> {
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

  // Honor screener.in's OWN canonical view. The search API returns
  // "/company/X/consolidated/" for companies whose consolidated statements
  // are current, and "/company/X/" for standalone-primary reporters. Forcing
  // /consolidated/ on the latter served data that was quarters stale
  // (observed live: JYOTHYLAB's consolidated view ended Mar 2025 while its
  // standalone view carried Jun 2026). The page's basis marker is scraped
  // downstream, so the user always sees which basis they got.
  const pagePath = match.url.includes("/consolidated")
    ? `/company/${slug}/consolidated/`
    : `/company/${slug}/`;

  // Fetch the company page HTML to get warehouseId. The HTML is returned to
  // the caller and parsed directly — screener.in is rate-sensitive, and
  // re-fetching the same page a second time doubled our request footprint.
  const pageRes = await fetch(
    `https://www.screener.in${pagePath}`,
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
    html,
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

/** Scrape sector and industry from the company page HTML. */
function scrapeSector(html: string): { sector: string | null; industry: string | null } {
  // Try several patterns screener.in uses
  // Pattern 1: "Sector: X" in meta description
  const sectorMeta = html.match(/Sector:\s*([^,|"<\n]+)/i);
  if (sectorMeta) return { sector: sectorMeta[1].trim(), industry: null };

  // Pattern 2: screen links with sector in href
  const sectorLink = html.match(/href="\/screen[^"]*"[^>]*>([^<]{3,40})<\/a>\s*(?:&rsaquo;|»|›|&raquo;)\s*<a[^>]*href="\/screen[^"]*"[^>]*>([^<]{3,40})<\/a>/i);
  if (sectorLink) return { sector: sectorLink[1].trim(), industry: sectorLink[2].trim() };

  // Pattern 3: "belongs to" pattern
  const belongsTo = html.match(/belongs?\s+to\s+(?:the\s+)?([^.<]{3,50}?)\s+sector/i);
  if (belongsTo) return { sector: belongsTo[1].trim(), industry: null };

  return { sector: null, industry: null };
}

/** "Sales&nbsp;+" → "Sales" (display) / "sales" (lookup key). */
function cleanRowName(raw: string): string {
  return raw.replace(/\s*\+$/, "").replace(/\s+/g, " ").trim();
}

/** Generic table scraper: returns { periods, rowMap, entries } for any screener.in section. */
interface ParsedTable {
  periods: string[];
  rowMap: Map<string, string[]>;
  /** Ordered rows with display-cased names, for schema-preserving consumers. */
  entries: { name: string; cells: string[] }[];
}

function scrapeTableSection(html: string, startId: string, endId: string): ParsedTable {
  const section = between(html, `id="${startId}"`, `id="${endId}"`) ||
                  between(html, `id="${startId}"`, '</section>') ||
                  between(html, `id="${startId}"`, `id="`);
  return parseTableHtml(section);
}

/** Parse an already-sliced table fragment (header periods + data rows). */
function parseTableHtml(section: string): ParsedTable {
  if (!section) return { periods: [], rowMap: new Map(), entries: [] };

  const rows = [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  const periods: string[] = [];
  const rowMap = new Map<string, string[]>();
  const entries: { name: string; cells: string[] }[] = [];

  // Header row — extract period labels. The first <th> is the (empty) label
  // column; do NOT filter empties before slicing, or the first real period
  // gets dropped and every value pairs with the previous period's label.
  const headerRow = rows[0]?.[1] ?? "";
  const headerCells = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map(([, c]) => stripTags(c).trim());
  for (const h of headerCells.slice(1)) {
    if (h) periods.push(h);
  }

  for (const [, row] of rows.slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(([, c]) => stripTags(c).trim());
    if (cells.length < 2) continue;
    const display = cleanRowName(cells[0]);
    const name = display.toLowerCase();
    if (!name) continue;
    rowMap.set(name, cells.slice(1));
    entries.push({ name: display, cells: cells.slice(1) });
  }

  return { periods, rowMap, entries };
}

/**
 * Scrape a full statement table (balance sheet / cash flow), preserving every
 * row. Rows whose cells are all non-numeric (e.g. the quarters table's "Raw
 * PDF" link row, or the growth-summary sub-tables' "10 Years:" rows that lack
 * a full period series) are dropped; values align 1:1 with periods.
 * Exported for tests.
 */
export function scrapeStatements(html: string, startId: string, endId: string): ScreenerInStatements | null {
  const { periods, entries } = scrapeTableSection(html, startId, endId);
  if (periods.length === 0) return null;

  const rows: ScreenerInStatementRow[] = [];
  for (const { name, cells } of entries) {
    if (cells.length < periods.length) continue;   // summary sub-tables, link rows
    const values = periods.map((_, i) => num(cells[i]));
    if (values.every((v) => v == null)) continue;
    rows.push({ name, values });
  }
  return rows.length > 0 ? { periods, rows } : null;
}

/** Reporting basis, as stated by the page itself ("Consolidated Figures in Rs. Crores"). */
export function scrapeBasis(html: string): "consolidated" | "standalone" | null {
  const m = html.match(/(Consolidated|Standalone)\s+Figures in/i);
  if (!m) return null;
  return m[1].toLowerCase() === "standalone" ? "standalone" : "consolidated";
}

/** Slice a documents sub-block: from its <h3> heading to the next <h3> (or end). */
function docBlock(docsHtml: string, heading: string): string {
  const start = docsHtml.indexOf(`${heading}</h3>`);
  if (start === -1) return "";
  const rest = docsHtml.slice(start);
  const next = rest.indexOf("<h3", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/** `<li><a href="…">Label <div class="ink-600 smaller">note</div></a></li>` rows. */
function parseDocumentLinks(block: string): ScreenerInDocumentLink[] {
  const out: ScreenerInDocumentLink[] = [];
  for (const [, href, inner] of block.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const note = inner.match(/<div[^>]*>([\s\S]*?)<\/div>/);
    const label = stripTags(inner.replace(/<div[\s\S]*?<\/div>/g, ""));
    if (!label) continue;
    out.push({ label, url: href, note: note ? stripTags(note[1]) || null : null });
  }
  return out;
}

/**
 * Scrape the "Documents" section: annual reports, concalls, credit ratings.
 * Markup verified live (2026-08): each concall <li> carries a date div plus
 * Transcript / PPT / REC anchors (class="concall-link"). Exported for tests.
 */
export function scrapeDocuments(html: string): ScreenerInDocuments | null {
  const start = html.indexOf('id="documents"');
  if (start === -1) return null;
  const docs = html.slice(start, start + 60_000);

  const annualReports = parseDocumentLinks(docBlock(docs, "Annual reports")).slice(0, 15);
  const creditRatings = parseDocumentLinks(docBlock(docs, "Credit ratings")).slice(0, 10);

  const concalls: ScreenerInConcall[] = [];
  const ccBlock = docBlock(docs, "Concalls");
  for (const [, li] of ccBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const date = stripTags(li.match(/<div[^>]*nowrap[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "");
    if (!date) continue;
    const link = (title: RegExp) => {
      for (const [, href, text] of li.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        if (title.test(stripTags(text))) return href;
      }
      return null;
    };
    const transcriptUrl = link(/transcript/i);
    const pptUrl = link(/ppt/i);
    const recordingUrl = link(/rec/i);
    if (transcriptUrl || pptUrl || recordingUrl) {
      concalls.push({ date, transcriptUrl, pptUrl, recordingUrl });
    }
    if (concalls.length >= 12) break;
  }

  if (annualReports.length === 0 && concalls.length === 0 && creditRatings.length === 0) return null;
  return { annualReports, concalls, creditRatings };
}

/** Scrape annual ratios table (Debtor Days, D/E, Interest Coverage, etc.). Exported for tests. */
export function scrapeRatiosTable(html: string): ScreenerInRatio[] {
  const section = between(html, 'id="ratios"', 'id="shareholding"') ||
                  between(html, 'id="ratios"', 'id="');
  if (!section) return [];

  const rows = [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  const ratios: ScreenerInRatio[] = [];

  // Header row for year labels — keep the empty first (label-column) <th> so
  // headerCells[i + 1] stays aligned with each row's cells.slice(1)[i].
  const headerRow = rows[0]?.[1] ?? "";
  const headerCells = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map(([, c]) => stripTags(c).trim());

  for (const [, row] of rows.slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(([, c]) => stripTags(c).trim());
    if (cells.length < 2) continue;
    const name = cells[0];
    // Premium-gated rows render masked labels/values like "xx", "x.xx",
    // "x,xxx" — skip them so getRatio() never matches placeholder garbage.
    if (!name || /^[x,.\s]+$/i.test(name)) continue;
    const values = cells.slice(1).map((v, i) => ({
      period: headerCells[i + 1] ?? String(i),
      value: v,
    }));
    ratios.push({ name, values });
  }
  return ratios;
}

/**
 * Shared row extraction for the annual and quarterly P&L tables.
 *
 * Industrial companies report: Sales, Expenses, Operating Profit, OPM %,
 * Other Income, Interest, Depreciation, PBT, Tax %, Net Profit, EPS.
 * Banks/NBFCs report instead: Revenue, Interest, Expenses, Financing Profit,
 * Financing Margin %, … plus Gross/Net NPA % on the quarterly table.
 * Both shapes verified live (RELIANCE vs HDFCBANK/CHOLAFIN, 2026-08).
 */
function extractPLRow(rowMap: Map<string, string[]>, i: number) {
  const g = (...names: string[]) => {
    for (const n of names) {
      const v = num(rowMap.get(n)?.[i]);
      if (v != null) return v;
    }
    return null;
  };
  return {
    sales: g("sales", "revenue", "net sales"),
    netProfit: g("net profit", "profit after tax", "pat"),
    opmPercent: g("opm %", "operating profit margin"),
    expenses: g("expenses"),
    operatingProfit: g("operating profit"),
    otherIncome: g("other income"),
    interest: g("interest"),
    depreciation: g("depreciation"),
    profitBeforeTax: g("profit before tax"),
    eps: g("eps in rs", "eps"),
    financingProfit: g("financing profit"),
    financingMarginPercent: g("financing margin %"),
  };
}

/** Scrape annual P&L history. Exported for tests. */
export function scrapeAnnualPL(html: string): ScreenerInAnnualPL[] {
  const { periods, rowMap } = scrapeTableSection(html, "profit-loss", "balance-sheet");
  if (periods.length === 0) return [];

  return periods.map((period, i) => ({
    period,
    ...extractPLRow(rowMap, i),
    dividendPayoutPercent: num(rowMap.get("dividend payout %")?.[i]),
  })).filter((d) => d.sales != null);
}

/** Scrape quarterly P&L. Exported for tests. */
export function scrapeQuarterlyPL(html: string): ScreenerInQuarterlyPL[] {
  const { periods, rowMap } = scrapeTableSection(html, "quarters", "profit-loss");
  if (periods.length === 0) return [];

  return periods.map((period, i) => ({
    period,
    ...extractPLRow(rowMap, i),
    grossNpaPercent: num(rowMap.get("gross npa %")?.[i]),
    netNpaPercent: num(rowMap.get("net npa %")?.[i]),
  })).filter((d) => d.sales != null);
}

/** Scrape the full shareholding pattern table (all categories, all periods). */
function scrapeShareholdingFull(html: string): {
  data: ScreenerInShareholding[];
  periods: string[];
} {
  // The shareholding section contains TWO tables: id="quarterly-shp" and
  // id="yearly-shp". Scraping the whole section merged the yearly table's
  // rows under the quarterly header — the last two columns happened to
  // coincide (both tables end at the current quarter), which made latest/prev
  // reads correct while silently mislabeling the deeper history (observed
  // live 2026-08: SBIN "Dec 2023" showing the Mar-2018 yearly value). Scope
  // to the quarterly sub-table when it exists.
  // NOTE the marker shape: the tab BUTTONS carry data-tab-id="quarterly-shp",
  // which contains the substring id="quarterly-shp" — a plain-id lookup lands
  // on the button and slices 139 empty bytes. The <div prefix pins the match
  // to the actual tab-content container.
  let result = parseTableHtml(between(html, '<div id="quarterly-shp"', '<div id="yearly-shp"'));
  if (result.periods.length === 0) result = scrapeTableSection(html, "shareholding", "corporate-actions");
  if (result.periods.length === 0) result = scrapeTableSection(html, "shareholding", "concall");
  if (result.periods.length === 0) result = scrapeTableSection(html, "shareholding", "documents");

  const { periods: usePeriods, rowMap: useRowMap } = result;

  const data: ScreenerInShareholding[] = [];
  const skipPatterns = ["no. of", "number of", "total"];

  for (const [rawName, values] of useRowMap.entries()) {
    // Skip summary/count rows
    if (skipPatterns.some((p: string) => rawName.includes(p))) continue;
    if (values.length === 0) continue;
    // Only include rows that look like percentage holdings (values ≤ 100)
    if (!values.some((v: string) => num(v) != null && (num(v) ?? 0) <= 100)) continue;

    const holding = rawName.includes("promoter") ? "promoter"
      : rawName.includes("fii") || rawName.includes("foreign") ? "fii"
      : rawName.includes("dii") || rawName.includes("domestic") ? "dii"
      : rawName.includes("public") || rawName.includes("retail") ? "retail"
      : rawName.includes("government") || rawName.includes("govt") ? "govt"
      : "other";

    // Restore display name (title-case from raw name)
    const displayName = rawName.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    data.push({ holding, name: displayName, values });
  }

  return { data, periods: usePeriods };
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
/* Public fetch function                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Parser schema version, part of the platform cache key. Bump it whenever the
 * scraper's OUTPUT SHAPE changes (new fields, fixed alignment, …): cached rows
 * store the *parsed* result, so without this a parser fix would keep serving
 * the old shape for up to the 6h TTL + 1d SWR.
 *
 * v2 (2026-08): entity decoding, period alignment, balance sheet + cash flow,
 * extended P&L rows (EPS, interest, bank Financing/NPA), basis, KPIs.
 * v3 (2026-08): honor screener.in's canonical consolidated/standalone view —
 * standalone-primary reporters previously served stale consolidated data.
 * v4 (2026-08): documents (annual reports, concalls, credit ratings).
 * v5-v6 (2026-08): shareholding scoped to the QUARTERLY sub-table — the
 * section previously merged yearly-table rows under the quarterly header
 * (latest two columns coincided, so latest/prev were right; deeper history
 * was yearly data mislabeled as quarters). v6 fixes the sub-table marker
 * (the tab button's data-tab-id matched the naive id lookup).
 */
const PARSER_VERSION = 6;

/**
 * Fetch a screener.in company through the platform data layer.
 *
 * Freshness lives in lib/platform/registry.ts (`screenerIn`), not here. Failures
 * — including "no such company" — deliberately return null WITHOUT caching, so a
 * transient screener.in outage never pins an empty result for six hours.
 */
export async function getScreenerInCompany(symbol: string): Promise<ScreenerInCompany | null> {
  const sym = normalise(symbol);

  try {
    const { data } = await getDataset<ScreenerInCompany>(
      "screenerIn",
      { symbol: sym, parser: PARSER_VERSION },
      (signal) => fetchScreenerInCompany(sym, signal),
      { symbol: sym },
    );
    return data;
  } catch {
    return null;
  }
}

/** Standard efficiency rows screener.in shows for most companies; everything
 * else in the ratios table is a company-specific operating KPI. */
const STANDARD_RATIO_NAMES = new Set([
  "debtor days", "inventory days", "days payable", "cash conversion cycle",
  "working capital days", "roce %", "roe %",
]);

/** Throws on any failure — the platform layer only caches resolved values. */
async function fetchScreenerInCompany(
  sym: string,
  signal: AbortSignal,
): Promise<ScreenerInCompany> {
  const resolved = await resolveCompany(sym);
  if (!resolved) throw new Error(`screener.in: no company for ${sym}`);

  const { name, companyId, warehouseId, slug, html } = resolved;
  void companyId; // used only to confirm resolution

  // The company page HTML already came back with resolution — only the peers
  // AJAX call remains, and it is a bonus: its failure never blocks the record.
  const peersRes = await fetch(`https://www.screener.in/api/company/${warehouseId}/peers/`, {
    headers: { ...HEADERS, "X-Requested-With": "XMLHttpRequest", "Referer": `https://www.screener.in/company/${slug}/consolidated/` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
  }).catch(() => null);

  const peersHtml = peersRes?.ok ? await peersRes.text() : "";

  const topRatios = scrapeTopRatios(html);
  const ratios = scrapeRatiosTable(html);
  const peers = parsePeersHtml(peersHtml);
  const promoterHolding = scrapePromoterFromMeta(html);
  const annualPL = scrapeAnnualPL(html);
  const quarterlyPL = scrapeQuarterlyPL(html);
  const balanceSheet = scrapeStatements(html, "balance-sheet", "cash-flow");
  const cashFlow = scrapeStatements(html, "cash-flow", "ratios");
  const basis = scrapeBasis(html);
  const documents = scrapeDocuments(html);
  const { sector, industry } = scrapeSector(html);

  // A page that yields neither headline ratios nor any statement table is a
  // layout change or an interstitial, not a company record — throw so the
  // partial parse is never cached as truth for the next six hours.
  if (topRatios["Market Cap"] == null && topRatios["Current Price"] == null &&
      annualPL.length === 0 && balanceSheet == null) {
    throw new Error(`screener.in: page for ${sym} parsed empty (layout change or block page?)`);
  }

  // Banks/NBFCs report Financing Profit instead of Operating Profit — the
  // signal that generic leverage/coverage math does not apply.
  const statementKind: "industrial" | "financial" =
    annualPL.some((r) => r.financingProfit != null) || quarterlyPL.some((r) => r.financingProfit != null)
      ? "financial"
      : "industrial";

  const kpis = ratios.filter((r) => !STANDARD_RATIO_NAMES.has(r.name.toLowerCase().trim()));

  // Latest borrowings from the balance sheet (banks: excludes deposits).
  const borrowingsRow = balanceSheet?.rows.find((r) => /^borrowings?$/i.test(r.name));
  const debt = borrowingsRow?.values.at(-1) ?? null;

  // Scrape full shareholding pattern
  const shareholdingResult = scrapeShareholdingFull(html);
  let shareholding = shareholdingResult.data;
  const shareholdingPeriods = shareholdingResult.periods;

  // Fall back to single-period promoter if full scrape yielded nothing
  if (shareholding.length === 0 && promoterHolding != null) {
    shareholding = [{ holding: "promoter", name: "Promoters", values: [String(promoterHolding)] }];
  }

  return {
    name,
    symbol: sym,
    bseCode: null,
    sector,
    industry,
    marketCap: topRatios["Market Cap"] ?? null,
    currentPrice: topRatios["Current Price"] ?? null,
    high52w: topRatios["52W High"] ?? null,
    low52w: topRatios["52W Low"] ?? null,
    pe: topRatios["Stock P/E"] ?? null,
    bookValue: topRatios["Book Value"] ?? null,
    dividendYield: topRatios["Dividend Yield"] ?? null,
    roce: topRatios["ROCE"] ?? null,
    roe: topRatios["ROE"] ?? null,
    debt,
    changePercent: null,
    promoterHolding,
    ratios,
    peers,
    shareholding,
    shareholdingPeriods,
    annualPL,
    quarterlyPL,
    balanceSheet,
    cashFlow,
    basis,
    statementKind,
    kpis,
    documents,
  };
}

/* -------------------------------------------------------------------------- */
/* Derived helpers                                                            */
/* -------------------------------------------------------------------------- */
/* NOTE: pure statement accessors (statementRow/latestStatementValue) live in
 * lib/india-snapshot.ts — this module reaches the platform data layer
 * (node:sqlite) and must never be a runtime import of client components.   */

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
