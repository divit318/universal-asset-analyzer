import type { Filing } from "./types";
import { getDataset } from "./platform/data-layer";

const SEC_UA =
  process.env.SEC_USER_AGENT ?? "universal-asset-analyzer divit318@gmail.com";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

/**
 * SEC fetch deadline. Every EDGAR request previously ran without one, so a
 * hung socket (SEC throttling holds connections rather than 429ing) blocked
 * its caller forever — no unbounded waits anywhere is the rule. Combined
 * with the platform's caller-abort signal when one is provided.
 */
const SEC_TIMEOUT_MS = 30_000;

function withSecDeadline(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(SEC_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

export interface CikEntry {
  cik: string; // 10-digit zero-padded
  name: string;
}

interface RawTicker {
  cik_str: number;
  ticker: string;
  title: string;
}

/** Build a ticker -> CIK lookup from SEC's company_tickers.json. Pure. */
export function parseTickerMap(
  raw: Record<string, RawTicker>,
): Map<string, CikEntry> {
  const map = new Map<string, CikEntry>();
  for (const entry of Object.values(raw)) {
    if (!entry?.ticker) continue;
    map.set(entry.ticker.toUpperCase(), {
      cik: String(entry.cik_str).padStart(10, "0"),
      name: entry.title,
    });
  }
  return map;
}

/**
 * The parsed lookup, memoized against the cache entry's version.
 *
 * The platform persists values as JSON, so the *cached* form of the index is
 * the raw SEC record; a Map would serialize to `{}`. Rebuilding the Map on
 * every lookup would mean re-parsing ~10k entries per symbol, so we keep the
 * derived Map here and rebuild it only when the underlying entry actually
 * changes — which is what `meta.version` exists to tell us.
 */
let derived: { version: number; map: Map<string, CikEntry> } | null = null;

async function loadTickerMap(): Promise<Map<string, CikEntry>> {
  const { data, meta } = await getDataset<Record<string, RawTicker>>(
    "cikMap",
    {},
    async (signal) => {
      const res = await fetch(TICKERS_URL, {
        headers: { "User-Agent": SEC_UA },
        signal: withSecDeadline(signal),
      });
      if (!res.ok) {
        throw new Error(`SEC ticker list unavailable (${res.status})`);
      }
      return (await res.json()) as Record<string, RawTicker>;
    },
  );

  if (derived?.version !== meta.version) {
    derived = { version: meta.version, map: parseTickerMap(data) };
  }
  return derived.map;
}

export async function lookupCik(symbol: string): Promise<CikEntry | null> {
  const map = await loadTickerMap();
  return map.get(symbol.toUpperCase()) ?? null;
}

interface RawSubmissions {
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
      accessionNumber?: string[];
    };
  };
}

/** Human descriptions for the SEC form types that actually show up in a
 *  company's recent-filings list. Anything unmapped falls back to "SEC filing". */
const FORM_DESCRIPTIONS: Record<string, string> = {
  "10-K": "Annual report",
  "10-K/A": "Annual report (amended)",
  "10-Q": "Quarterly report",
  "10-Q/A": "Quarterly report (amended)",
  "8-K": "Current report — material event",
  "8-K/A": "Current report (amended)",
  "3": "Initial insider ownership statement",
  "4": "Insider transaction report",
  "4/A": "Insider transaction report (amended)",
  "5": "Annual insider ownership statement",
  "144": "Notice of proposed insider sale",
  "DEF 14A": "Proxy statement",
  "DEFA14A": "Proxy soliciting material",
  "S-8": "Employee stock plan registration",
  "S-3": "Shelf registration",
  "S-3ASR": "Automatic shelf registration",
  "424B2": "Prospectus supplement",
  "424B3": "Prospectus supplement",
  "424B5": "Prospectus supplement — securities offering",
  "FWP": "Free-writing prospectus",
  "SC 13G": "Passive ownership >5% disclosure",
  "SC 13G/A": "Passive ownership disclosure (amended)",
  "SC 13D": "Activist ownership >5% disclosure",
  "SC 13D/A": "Activist ownership disclosure (amended)",
  "13F-HR": "Institutional holdings report",
  "11-K": "Employee plan annual report",
  "ARS": "Annual report to shareholders",
  "PX14A6G": "Shareholder proxy exempt solicitation",
  "25-NSE": "Delisting notification",
  "IRANNOTICE": "Iran-related disclosure notice",
  "CERT": "Exchange certification",
  "SD": "Specialized disclosure (conflict minerals)",
  "CORRESP": "SEC correspondence",
  "UPLOAD": "SEC comment letter",
};

/** Human-readable description for a filing row. Never echoes the form code
 *  back (the old fallback produced rows like "4 / FORM 4" and "144 / 144"),
 *  and never leaks raw numeric artifacts from primaryDocDescription. */
export function describeFiling(form: string, primaryDocDescription: string | undefined): string {
  const mapped = FORM_DESCRIPTIONS[form.toUpperCase()];
  const raw = (primaryDocDescription ?? "").trim();
  const normalized = raw.replace(/^FORM\s+/i, "").toUpperCase();
  const isEcho = raw === "" || normalized === form.toUpperCase();
  const isJunk = /^[\d\s\-./]+$/.test(raw); // raw IDs like "42485"
  if (!isEcho && !isJunk) return raw;
  return mapped ?? "SEC filing";
}

/**
 * Parse the most recent filings out of SEC's submissions JSON. Pure so it is
 * unit-testable against a fixture.
 */
export function parseFilings(
  raw: RawSubmissions,
  cik: string,
  max = 10,
): Filing[] {
  const recent = raw.filings?.recent;
  if (!recent?.accessionNumber) return [];

  const cikNumber = String(Number(cik)); // strip leading zeros for archive path
  const count = Math.min(recent.accessionNumber.length, max);
  const filings: Filing[] = [];

  for (let i = 0; i < count; i++) {
    const accession = recent.accessionNumber[i];
    const doc = recent.primaryDocument?.[i] ?? "";
    const accessionPath = accession.replace(/-/g, "");
    const form = recent.form?.[i] ?? "—";
    filings.push({
      form,
      filedAt: recent.filingDate?.[i] ?? "",
      description: describeFiling(form, recent.primaryDocDescription?.[i]),
      accessionNumber: accession,
      documentUrl: doc
        ? `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accessionPath}/${doc}`
        : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`,
    });
  }
  return filings;
}

/**
 * Fetch recent filings for a ticker. Returns [] when the company isn't found.
 *
 * Routed through the Platform Data Layer: SEC rate-limits aggressively, and the
 * research route, the AI context builder, and the IC report pipeline all ask for
 * the same company's filings within the same second. Deduplication turns that
 * into one request; the `filings` policy (6h TTL, persisted) keeps it that way
 * across reloads.
 *
 * The abort signal is forwarded to `fetch` so a cancelled research request
 * actually tears the SEC call down rather than leaving it to complete unobserved.
 */
export async function getRecentFilings(
  symbol: string,
  max = 10,
): Promise<Filing[]> {
  const entry = await lookupCik(symbol);
  if (!entry) return [];

  const result = await getDataset<Filing[]>(
    "filings",
    { symbol: symbol.toUpperCase(), max },
    async (signal) => {
      const res = await fetch(
        `https://data.sec.gov/submissions/CIK${entry.cik}.json`,
        { headers: { "User-Agent": SEC_UA }, signal: withSecDeadline(signal) },
      );
      if (!res.ok) {
        throw new Error(`SEC submissions unavailable for ${symbol} (${res.status})`);
      }
      const raw = (await res.json()) as RawSubmissions;
      return parseFilings(raw, entry.cik, max);
    },
  );
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Form D full-text search — private-company "search by name" for Private     */
/* Markets manual assets. A different SEC EDGAR endpoint than the ticker-     */
/* keyed lookups above (private companies have no ticker), but the same       */
/* free, no-key, User-Agent-only access model, so it lives in this file       */
/* rather than a separate client.                                             */
/* -------------------------------------------------------------------------- */

const EDGAR_FULL_TEXT_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";

export interface FormDFiling {
  cik: string;
  entityName: string;
  form: string; // "D" | "D/A"
  filedDate: string;
  accessionNumber: string;
}

interface RawFullTextSearchHit {
  _source?: {
    ciks?: string[];
    display_names?: string[];
    form?: string;
    file_date?: string;
    adsh?: string;
  };
}

interface RawFullTextSearchResponse {
  hits?: { hits?: RawFullTextSearchHit[] };
}

/** Strips the "(CIK 0001234567)" suffix EDGAR's search index appends to display names. */
function cleanEntityName(displayName: string): string {
  return displayName.replace(/\s*\(CIK\s+\d+\)\s*$/, "").trim();
}

/** Parse EDGAR's full-text search response into Form D filing rows. Pure so it is unit-testable against a fixture. */
export function parseFormDSearchHits(raw: RawFullTextSearchResponse, max = 8): FormDFiling[] {
  const hits = raw.hits?.hits ?? [];
  const filings: FormDFiling[] = [];
  for (const hit of hits) {
    const cik = hit._source?.ciks?.[0];
    const name = hit._source?.display_names?.[0];
    const accessionNumber = hit._source?.adsh;
    if (!cik || !name || !accessionNumber) continue;
    filings.push({
      cik,
      entityName: cleanEntityName(name),
      form: hit._source?.form ?? "D",
      filedDate: hit._source?.file_date ?? "",
      accessionNumber,
    });
    if (filings.length >= max) break;
  }
  return filings;
}

/**
 * Search SEC Form D (private-offering) filings by company/issuer name. Free,
 * no API key — same fair-access policy as the rest of EDGAR (User-Agent
 * header, ≤10 req/s). Returns [] on no match or any failure; never throws,
 * since this is a search-first convenience, not a required data source —
 * the manual asset form always falls back to letting the user type the
 * company name in directly.
 */
export async function searchFormD(companyName: string, max = 8): Promise<FormDFiling[]> {
  const trimmed = companyName.trim();
  if (!trimmed) return [];
  const url = new URL(EDGAR_FULL_TEXT_SEARCH_URL);
  url.searchParams.set("q", `"${trimmed}"`);
  url.searchParams.set("forms", "D");
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": SEC_UA },
      signal: withSecDeadline(),
    });
    if (!res.ok) return [];
    const raw = (await res.json()) as RawFullTextSearchResponse;
    return parseFormDSearchHits(raw, max);
  } catch {
    return [];
  }
}

export interface FormDDetails {
  entityName: string | null;
  /** ISO date the issuer first sold securities in this offering. */
  dateOfFirstSale: string | null;
  /** Total amount the offering was for — NOT the company's valuation. Form D
   *  discloses capital raised, never a share price or pre/post-money figure,
   *  so this is shown as reference context only, never used to auto-fill a
   *  "last round valuation" field. */
  totalOfferingAmount: number | null;
  totalAmountSold: number | null;
}

function xmlField(xml: string, tag: string): string | null {
  return xml.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`))?.[1] ?? null;
}

/** Nested `<tag><value>...</value></tag>` fields, used by a few Form D fields (e.g. dateOfFirstSale). */
function xmlNestedValue(xml: string, tag: string): string | null {
  return xml.match(new RegExp(`<${tag}>\\s*<value>\\s*([^<]+?)\\s*</value>`))?.[1] ?? null;
}

function xmlNumberField(xml: string, tag: string): number | null {
  const raw = xmlField(xml, tag);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extracts the handful of Form D fields this app cares about. Intentionally
 * a small targeted regex extractor rather than a general XML parser —
 * primary_doc.xml has a large, mostly-irrelevant schema (related persons,
 * exemptions claimed, sales compensation...) and pulling in a full XML
 * dependency for five flat fields isn't worth it at this scope.
 */
export function parseFormDXml(xml: string): FormDDetails {
  return {
    entityName: xmlField(xml, "entityName"),
    dateOfFirstSale: xmlNestedValue(xml, "dateOfFirstSale"),
    totalOfferingAmount: xmlNumberField(xml, "totalOfferingAmount"),
    totalAmountSold: xmlNumberField(xml, "totalAmountSold"),
  };
}

/** Fetch and parse one Form D filing's offering details. Returns null on any failure — same non-fatal convention as the rest of this module. */
export async function getFormDDetails(cik: string, accessionNumber: string): Promise<FormDDetails | null> {
  const cikNumber = String(Number(cik));
  const accessionPath = accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accessionPath}/primary_doc.xml`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SEC_UA },
      signal: withSecDeadline(),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    return parseFormDXml(xml);
  } catch {
    return null;
  }
}
