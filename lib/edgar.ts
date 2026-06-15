import type { Filing } from "./types";

const SEC_UA =
  process.env.SEC_USER_AGENT ?? "universal-asset-analyzer divit318@gmail.com";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

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

let tickerCache: Map<string, CikEntry> | null = null;

async function loadTickerMap(): Promise<Map<string, CikEntry>> {
  if (tickerCache) return tickerCache;
  const res = await fetch(TICKERS_URL, {
    headers: { "User-Agent": SEC_UA },
  });
  if (!res.ok) {
    throw new Error(`SEC ticker list unavailable (${res.status})`);
  }
  const raw = (await res.json()) as Record<string, RawTicker>;
  tickerCache = parseTickerMap(raw);
  return tickerCache;
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
    filings.push({
      form: recent.form?.[i] ?? "—",
      filedAt: recent.filingDate?.[i] ?? "",
      description: recent.primaryDocDescription?.[i] || recent.form?.[i] || "Filing",
      accessionNumber: accession,
      documentUrl: doc
        ? `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accessionPath}/${doc}`
        : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`,
    });
  }
  return filings;
}

/** Fetch recent filings for a ticker. Returns [] when the company isn't found. */
export async function getRecentFilings(
  symbol: string,
  max = 10,
): Promise<Filing[]> {
  const entry = await lookupCik(symbol);
  if (!entry) return [];

  const res = await fetch(
    `https://data.sec.gov/submissions/CIK${entry.cik}.json`,
    { headers: { "User-Agent": SEC_UA } },
  );
  if (!res.ok) {
    throw new Error(`SEC submissions unavailable for ${symbol} (${res.status})`);
  }
  const raw = (await res.json()) as RawSubmissions;
  return parseFilings(raw, entry.cik, max);
}
