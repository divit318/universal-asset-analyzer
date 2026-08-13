/**
 * Indian company news & developments engine.
 *
 * Yahoo's `.NS` news feed is largely irrelevant for Indian companies (broad
 * market wrap-ups tagged with every ticker), so Indian symbols get their own
 * per-symbol pipeline built entirely on free sources:
 *
 *   1. NSE corporate announcements (official exchange filings, per-symbol
 *      JSON endpoint) — categorized, with the actual filing PDF link. For an
 *      Indian investor these are usually MORE important than media stories:
 *      results, board meetings, orders won, ratings, management changes.
 *   2. Google News India RSS, queried by the company's *name* (quoted) plus
 *      curated aliases — this aggregates Economic Times, Moneycontrol,
 *      Business Standard, Mint, Reuters India, CNBC-TV18, NDTV Profit etc.
 *      without scraping any of those sites directly.
 *
 * Both sources are routed through the platform data layer (`indiaAnnouncements`
 * and `indiaNews` cache policies), so refresh cadence, dedup, and SWR behave
 * like every other dataset. Company matching is defensive by design: a story
 * only attaches to a symbol when the headline names the company's distinctive
 * phrase, a curated alias, or the ticker — under-showing beats padding the
 * feed with stories about a similarly-named company (HDFC Bank ≠ HDFC Life,
 * Reliance Industries ≠ Reliance Power).
 *
 * `.BO` (BSE) symbols are served through the same NSE endpoint via their base
 * ticker — virtually every actively-researched BSE name is dual-listed. BSE's
 * own API needs no additional infrastructure for that reason.
 */

import { getDataset } from "./platform/data-layer";
import { fetchRss, isoNow, safeIso, cleanFeedText } from "./feed";
import { getQuote } from "./yahoo";
import type { Filing, NewsItem } from "./types";

/* -------------------------------------------------------------------------- */
/* Symbol / name handling                                                     */
/* -------------------------------------------------------------------------- */

/** Indian listing: NSE (.NS) or BSE (.BO) suffix. */
export function isIndianEquitySymbol(symbol: string): boolean {
  return /\.(NS|BO)$/i.test(symbol.trim());
}

/** "RELIANCE.NS" → "RELIANCE" (the symbol NSE's own API expects). */
export function nseBaseSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, "");
}

/** Legal/structural suffixes that never help identify a company in a headline. */
const LEGAL_SUFFIX_RE =
  /\s*\(india\)\s*$|\s+(limited|ltd\.?|private|pvt\.?|company|corporation|corp\.?|india)\s*$/i;

/**
 * The shortest phrase that still uniquely names the company: the first two
 * distinctive words of its legal name (one, for single-word names), with
 * legal suffixes and a leading "The" stripped.
 *
 *   "Reliance Industries Limited"              → "Reliance Industries"
 *   "HDFC Bank Limited"                        → "HDFC Bank"
 *   "Adani Ports and Special Economic Zone…"   → "Adani Ports"
 *   "The Tata Power Company Limited"           → "Tata Power"
 *   "Infosys Limited"                          → "Infosys"
 *
 * Two words — not one — because Indian corporate groups share first words
 * across many listed entities (HDFC, Tata, Adani, Bajaj, Reliance, JSW…);
 * matching on "HDFC" alone would attach HDFC Life stories to HDFC Bank.
 */
export function distinctivePhrase(name: string): string {
  let n = name.trim().replace(/^the\s+/i, "");
  // Strip legal suffixes repeatedly ("… Company Limited" → "…").
  for (let i = 0; i < 3; i++) {
    const stripped = n.replace(LEGAL_SUFFIX_RE, "");
    if (stripped === n) break;
    n = stripped;
  }
  const words = n.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w) && !/^(and|of|the|&)$/i.test(w));
  return words.slice(0, 2).join(" ");
}

/**
 * Curated aliases for widely-covered names whose headlines rarely use the
 * legal name ("RIL", "HUL", "L&T"…). Keyed by NSE base symbol. Used both to
 * widen the Google News query and to accept headlines in the relevance check.
 */
export const INDIA_COMPANY_ALIASES: Record<string, string[]> = {
  RELIANCE: ["RIL"],
  TCS: ["TCS", "Tata Consultancy"],
  INFY: ["Infosys"],
  HDFCBANK: ["HDFC Bank"],
  ICICIBANK: ["ICICI Bank"],
  SBIN: ["SBI", "State Bank of India"],
  LT: ["L&T", "Larsen & Toubro"],
  "M&M": ["M&M", "Mahindra & Mahindra"],
  HINDUNILVR: ["HUL", "Hindustan Unilever"],
  BHARTIARTL: ["Bharti Airtel", "Airtel"],
  MARUTI: ["Maruti Suzuki"],
  SUNPHARMA: ["Sun Pharma"],
  ULTRACEMCO: ["UltraTech Cement", "UltraTech"],
  ASIANPAINT: ["Asian Paints"],
  BAJFINANCE: ["Bajaj Finance"],
  KOTAKBANK: ["Kotak Mahindra Bank", "Kotak Bank"],
  HCLTECH: ["HCLTech", "HCL Tech"],
  ONGC: ["ONGC"],
  POWERGRID: ["Power Grid"],
  ADANIENT: ["Adani Enterprises"],
  ADANIPORTS: ["Adani Ports"],
  JSWSTEEL: ["JSW Steel"],
  NESTLEIND: ["Nestle India"],
  DRREDDY: ["Dr Reddy's", "Dr Reddys"],
  DIVISLAB: ["Divi's Labs", "Divis Labs"],
  COALINDIA: ["Coal India"],
  HDFCLIFE: ["HDFC Life"],
  SBILIFE: ["SBI Life"],
  DMART: ["DMart", "Avenue Supermarts"],
  ETERNAL: ["Eternal", "Zomato"],
  PAYTM: ["Paytm", "One97"],
  VEDL: ["Vedanta"],
  INDIGO: ["IndiGo", "InterGlobe Aviation"],
  BEL: ["Bharat Electronics"],
  HAL: ["Hindustan Aeronautics"],
  IRCTC: ["IRCTC"],
  BAJAJFINSV: ["Bajaj Finserv"],
  TATAMOTORS: ["Tata Motors"],
  TATASTEEL: ["Tata Steel"],
  TATAPOWER: ["Tata Power"],
  // Unambiguous single-word majors — listed so they match as STRONG evidence
  // (an uncurated lone token is treated as weak and needs market context).
  WIPRO: ["Wipro"],
  ITC: ["ITC"],
  CIPLA: ["Cipla"],
  BRITANNIA: ["Britannia"],
  DABUR: ["Dabur"],
  MARICO: ["Marico"],
  DLF: ["DLF"],
  BIOCON: ["Biocon"],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Phrase → regex that matches the words contiguously across any punctuation. */
function phraseRe(phrase: string): RegExp | null {
  const words = phrase.split(/\s+/).filter(Boolean).map(escapeRe);
  if (words.length === 0) return null;
  return new RegExp(`\\b${words.join("[\\W_]+")}\\b`, "i");
}

/**
 * SEO landing pages and social reposts that Google News surfaces alongside
 * real journalism ("… Option Chain - Live Data, OI", "Find X Q4 Results |",
 * LinkedIn/Facebook mirrors). Observed live 2026-08-10 on RELIANCE.NS.
 */
const JUNK_HEADLINE_RE =
  /option chain|share price target|price prediction|live.*\bOI\b|\bfind\b.+\bresults?\b.*\||stock screener|(share|stock) price(,| today| live|$)|stock price, news, quote|outlook for the week/i;
const JUNK_SOURCE_RE = /^(facebook|linkedin|youtube|instagram|reddit|pinterest|x)(\.com)?$/i;

export function isJunkStory(headline: string, source: string, companyName?: string | null): boolean {
  if (JUNK_HEADLINE_RE.test(headline) || JUNK_SOURCE_RE.test(source.trim())) return true;
  // Bare company-name stubs ("Astral Limited" — Reuters' company landing page).
  if (companyName) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const h = norm(headline);
    if (h === norm(companyName) || h === norm(distinctivePhrase(companyName))) return true;
  }
  return false;
}

/**
 * Financial-context terms — the tie-breaker for single-word company names
 * that are also ordinary English words. "Astral" (the pipes maker) collided
 * live with ResMed's Astral ventilator, an "Astral Bodies" art series, and
 * ASUS' "ROG Astral" GPU; a lone generic token only counts when the headline
 * reads like an Indian market story.
 */
const CONTEXT_RE =
  /india|nse|bse|sensex|nifty|share|stock|equity|crore|₹|\brs\.?\s?\d|rupee|dividend|results?|profit|revenue|earnings|\bq[1-4]\b|fy\s?\d{2}|ipo|sebi|rbi|\bbuy\b|\bsell\b|\bhold\b|target|rating|board|merger|acquisition|order|contract|\bltd\b|limited/i;

/** A ticker on someone else's exchange — an "(ASX:AAR)" story is never ours. */
const FOREIGN_EXCHANGE_RE = /\b(ASX|LSE|NYSE|NASDAQ|HKEX|SGX|MYX|KLSE|TSX)\s*[:)]/i;

/**
 * When a weak lone token is immediately followed by a company-forming noun,
 * the headline is about a DIFFERENT entity that shares the word: "Astral
 * Resources" (ASX gold miner) is not "Astral" (the NSE pipes maker).
 */
const NEXT_WORD_ENTITY_RE =
  /^(Resources|Technologies|Systems|Industries|Power|Energy|Group|Corp(oration)?|Inc|Holdings|Media|Aviation|Motors|Steel|Bank|Life|Capital|Infra(structure)?|Foundation|Institute|Studios?|Labs?|Bodies)\b/;

/** Product/model codes ("ROG Astral RTX 5090") — but not market acronyms. */
const PRODUCT_CODE_RE = /^[A-Z]{2,6}\d*$/;
const CAPS_ALLOW = new Set([
  "AGM", "EGM", "IPO", "NSE", "BSE", "CEO", "CFO", "MD", "JV", "ESG", "EPS", "PAT",
  "YOY", "QOQ", "FY", "CV", "EV", "LTD", "OFS", "QIP", "NCLT", "SEBI", "RBI", "US", "UK", "USFDA",
]);

/** The word right after a weak match, if the match is followed by more text. */
function wordAfter(headline: string, endIndex: number): string | null {
  const rest = headline.slice(endIndex).replace(/^['’]s\b/, "").trimStart();
  if (!rest || !/^[A-Za-z]/.test(rest)) return null;
  return rest.split(/\s+/)[0] ?? null;
}

/**
 * Is this headline actually about the company?
 *
 * Two tiers of evidence:
 *   - STRONG: a multi-word distinctive phrase ("HDFC Bank", "Adani Ports")
 *     or a curated alias — these are unambiguous, so a match is enough.
 *   - WEAK: a single lone token (uncurated single-word name, or the bare
 *     ticker of a company outside the alias map). One token can collide with
 *     unrelated uses of the word, so it only counts when the headline also
 *     reads like a market story (CONTEXT_RE) and the token appears early —
 *     as the subject, not a passing mention.
 *
 * Deliberately strict — a dropped-but-relevant story costs less than an
 * HDFC Life headline shown on HDFC Bank's page.
 */
export function isRelevantToIndianCompany(
  headline: string,
  symbol: string,
  companyName: string | null,
): boolean {
  const base = nseBaseSymbol(symbol);
  const phrase = companyName ? distinctivePhrase(companyName) : null;
  const phraseWords = phrase ? phrase.toUpperCase().split(/\s+/) : [];
  const curated = INDIA_COMPANY_ALIASES[base] ?? [];

  const strong: string[] = [...curated];
  const weak: string[] = [];
  if (phrase) (phraseWords.length > 1 ? strong : weak).push(phrase);
  // The bare ticker is a valid signal ("IRCTC", "ONGC") — EXCEPT when it is
  // also the shared group word of a multi-word name: "RELIANCE" matching the
  // word "Reliance" would re-admit Reliance Power stories that the two-word
  // phrase rule exists to keep out.
  if (phraseWords.length <= 1 || phraseWords[0] !== base) {
    (curated.length > 0 ? strong : weak).push(base);
  }

  if (strong.some((c) => phraseRe(c)?.test(headline))) return true;

  if (FOREIGN_EXCHANGE_RE.test(headline)) return false;
  return weak.some((c) => {
    const match = phraseRe(c)?.exec(headline);
    if (match == null || match.index >= 48 || !CONTEXT_RE.test(headline)) return false;
    const next = wordAfter(headline, match.index + match[0].length);
    if (next != null) {
      if (NEXT_WORD_ENTITY_RE.test(next)) return false;
      if (PRODUCT_CODE_RE.test(next) && !CAPS_ALLOW.has(next.toUpperCase())) return false;
    }
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Categorization                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Development categories for Indian listings. NSE's `desc` field is close to
 * an enum, so exchange filings categorize almost perfectly; media headlines
 * get a best-effort keyword pass.
 */
export type IndiaNewsCategory =
  | "results"
  | "corporate-action"
  | "board-meeting"
  | "management"
  | "orders"
  | "m&a"
  | "regulatory"
  | "credit-rating"
  | "investor-meet"
  | "announcement"
  | "news";

const CATEGORY_PATTERNS: [IndiaNewsCategory, RegExp][] = [
  ["results", /financial result|quarterly result|q[1-4]\s*(fy)?\d*\s*result|earnings|net profit|revenue (rise|fall|jump|drop)|profit (rise|fall|jump|surge|slump)/i],
  ["corporate-action", /dividend|bonus issue|stock split|sub-?division|rights issue|buy-?back|record date|book closure/i],
  ["m&a", /acquisition|acquire|amalgamation|merger|demerger|scheme of arrangement|stake (buy|sale|purchase)|takeover|delisting|open offer/i],
  ["orders", /award of order|receipt of order|bagging|bags order|order (win|won|book)|contract (win|won|award)|letter of intent/i],
  ["management", /change in director|key managerial personnel|resignation|appointment of|new (ceo|cfo|md|chairman)|managing director|steps down/i],
  ["credit-rating", /credit rating|rating (upgrade|downgrade|action|revised)|crisil|icra|care ratings/i],
  ["regulatory", /sebi|rbi|penalty|show cause|regulatory|clarification|gst|income tax|enforcement directorate|cci approv/i],
  ["board-meeting", /board meeting|outcome of board|notice of.*meeting|agm|egm|postal ballot|shareholders meeting/i],
  ["investor-meet", /analyst|institutional investor meet|con(ference)?\.? call|investor presentation|earnings call/i],
];

export function categorizeIndianDevelopment(text: string): IndiaNewsCategory {
  for (const [category, re] of CATEGORY_PATTERNS) {
    if (re.test(text)) return category;
  }
  return "news";
}

/**
 * Routine compliance filings that clutter a developments feed (they remain in
 * the full filings list — they're just not "news"): newspaper-ad copies,
 * trading-window closures, share-certificate administrivia, ESOP allotments,
 * RTA certificates, investor-complaint statements.
 */
const ROUTINE_FILING_RE =
  /newspaper|trading window|loss of share certificate|duplicate share|allotment of (esop|esps|shares under)|certificate under (sebi|regulation)|reg\.?\s*74|investor complaint|registrar.*share transfer|book closure intimation|compliance certificate|change in registered office/i;

export function isRoutineFiling(text: string): boolean {
  return ROUTINE_FILING_RE.test(text);
}

/* -------------------------------------------------------------------------- */
/* Source: NSE corporate announcements (per-symbol)                           */
/* -------------------------------------------------------------------------- */

interface RawNseAnnouncement {
  subject?: string;
  symbol?: string;
  desc?: string;
  attchmntText?: string;
  attchmntFile?: string;
  an_dt?: string;
  sort_date?: string;
  exchdisstime?: string;
  seq_id?: string;
  sm_name?: string;
  bm_desc?: string;
}

export interface NseAnnouncement {
  symbol: string;
  company: string;
  /** NSE's near-enum filing type, e.g. "Financial Results", "Award of Order/Receipt of Order". */
  type: string;
  /** Filing body text (attachment abstract). */
  text: string;
  /** Direct link to the filing PDF on nsearchives.nseindia.com. */
  url: string;
  publishedAt: string; // ISO
  id: string;
  category: IndiaNewsCategory;
  routine: boolean;
}

/** NSE timestamps ("07-Aug-2026 17:07:35" / "2026-08-07 17:07:35") are IST. */
export function parseNseDate(raw: string | undefined): string {
  if (!raw) return isoNow();
  const trimmed = raw.trim();
  const dmy = trimmed.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (dmy) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const mm = months[dmy[2].toLowerCase()];
    if (mm) {
      const d = new Date(`${dmy[3]}-${mm}-${dmy[1]}T${dmy[4]}+05:30`);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  const ymd = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (ymd) {
    const d = new Date(`${ymd[1]}T${ymd[2]}+05:30`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return safeIso(trimmed);
}

/** NSE's verbose filing-type strings, shortened for badges and titles. */
const SHORT_TYPE: [RegExp, string][] = [
  [/analysts?\/institutional investor meet/i, "Investor Meet"],
  [/change in directors?\/\s*key managerial personnel/i, "Management Change"],
  [/award of order\s*\/\s*receipt of order/i, "Order Win"],
  [/copy of newspaper publication/i, "Newspaper Publication"],
  [/certificate under sebi/i, "Compliance Certificate"],
  [/disclosure under sebi \(sast\)|takeover regulations/i, "SAST Disclosure"],
  [/amalgamation\s*\/\s*merger/i, "Merger"],
  [/notice of.*shareholders? meeting/i, "Shareholder Meeting"],
];

export function shortenNseType(type: string): string {
  for (const [re, short] of SHORT_TYPE) {
    if (re.test(type)) return short;
  }
  return type;
}

export function mapNseAnnouncement(raw: RawNseAnnouncement): NseAnnouncement | null {
  const symbol = raw.symbol?.trim();
  if (!symbol) return null;
  const fullType = cleanFeedText(raw.desc ?? "Corporate announcement");
  const type = shortenNseType(fullType);
  const text = cleanFeedText(raw.attchmntText ?? raw.subject ?? raw.bm_desc ?? "");
  // Categorize from NSE's ORIGINAL type string — the shortened label loses
  // the phrases the category patterns key on.
  const combined = `${fullType} ${text}`;
  return {
    symbol,
    company: cleanFeedText(raw.sm_name ?? symbol),
    type,
    text,
    url: raw.attchmntFile?.trim() || "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
    publishedAt: parseNseDate(raw.sort_date ?? raw.an_dt ?? raw.exchdisstime),
    id: raw.seq_id ?? `${symbol}-${raw.sort_date ?? raw.an_dt ?? ""}`,
    category: categorizeIndianDevelopment(combined),
    routine: isRoutineFiling(combined),
  };
}

const NSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

/** NSE's API requires the cookies its homepage sets — one bootstrap round-trip. */
async function nseCookies(): Promise<string> {
  const session = await fetch("https://www.nseindia.com", {
    headers: { ...NSE_HEADERS, Accept: "text/html" },
    signal: AbortSignal.timeout(6000),
  });
  const setCookie = session.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) return setCookie.map((c) => c.split(";")[0]).join("; ");
  return session.headers.get("set-cookie") ?? "";
}

/**
 * Corporate announcements from NSE's public endpoint — per-symbol when given,
 * market-wide otherwise. Cached via the `indiaAnnouncements` policy (30 min
 * TTL, persisted) so page views and the AI context share one fetch.
 */
export async function fetchNseCorporateAnnouncements(
  symbol?: string,
  limit = 25,
): Promise<NseAnnouncement[]> {
  const base = symbol ? nseBaseSymbol(symbol) : null;
  try {
    const result = await getDataset<NseAnnouncement[]>(
      "indiaAnnouncements",
      { symbol: base ?? "__market__" },
      async (signal) => {
        const cookies = await nseCookies();
        const url = new URL("https://www.nseindia.com/api/corporate-announcements");
        url.searchParams.set("index", "equities");
        if (base) url.searchParams.set("symbol", base);
        const res = await fetch(url.toString(), {
          headers: {
            ...NSE_HEADERS,
            Accept: "application/json",
            Cookie: cookies,
            Referer: "https://www.nseindia.com",
          },
          signal,
        });
        if (!res.ok) throw new Error(`NSE announcements HTTP ${res.status}`);
        const raw = (await res.json()) as RawNseAnnouncement[];
        if (!Array.isArray(raw)) return [];
        return raw
          .map(mapNseAnnouncement)
          .filter((a): a is NseAnnouncement => a != null)
          .slice(0, 60);
      },
      { symbol: base ?? undefined },
    );
    return result.data.slice(0, limit);
  } catch {
    return [];
  }
}

/** An NSE announcement rendered on the shared NewsItem shape. */
export function announcementToNewsItem(a: NseAnnouncement): NewsItem {
  return {
    headline: a.text ? `${a.type}: ${a.text.slice(0, 160)}${a.text.length > 160 ? "…" : ""}` : a.type,
    source: "NSE Filing",
    url: a.url,
    publishedAt: a.publishedAt,
    tickers: [`${a.symbol}.NS`],
    summary: a.text || null,
    category: a.category === "news" ? "announcement" : a.category,
  };
}

/**
 * NSE announcements on the shared Filing shape, so the research page's
 * filings section (and the AI context's filings slot) render exchange
 * filings for Indian listings the same way EDGAR filings render for US ones.
 */
export async function getIndianFilings(symbol: string, max = 15): Promise<Filing[]> {
  const announcements = await fetchNseCorporateAnnouncements(symbol, max);
  return announcements.map((a) => ({
    form: a.type,
    filedAt: a.publishedAt,
    description: a.text || a.type,
    accessionNumber: a.id,
    documentUrl: a.url,
  }));
}

/* -------------------------------------------------------------------------- */
/* Source: Google News India RSS (media coverage)                             */
/* -------------------------------------------------------------------------- */

/**
 * Media stories via Google News India RSS — one aggregation point over ET,
 * Moneycontrol, Business Standard, Mint, Reuters, CNBC-TV18 etc. Queried by
 * the quoted company phrase (plus aliases), which does most of the relevance
 * work; the strict headline filter does the rest.
 */
async function fetchGoogleIndiaNews(
  symbol: string,
  companyName: string | null,
  limit: number,
): Promise<NewsItem[]> {
  const base = nseBaseSymbol(symbol);
  const phrase = companyName ? distinctivePhrase(companyName) : base;
  const aliases = (INDIA_COMPANY_ALIASES[base] ?? []).slice(0, 2);
  const terms = [phrase, ...aliases.filter((a) => a.toLowerCase() !== phrase.toLowerCase())]
    .map((t) => `"${t}"`)
    .join(" OR ");
  const query = `(${terms}) when:14d`;

  try {
    const result = await getDataset<NewsItem[]>(
      "indiaNews",
      { symbol: base, q: query },
      async () => {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
        const items = await fetchRss(url);
        return items.slice(0, 40).map((i) => {
          // Google News titles end in " - Publisher"; prefer the <source> tag,
          // fall back to the suffix, and strip it from the shown headline.
          const suffixMatch = i.title.match(/^(.*)\s+-\s+([^-]{2,40})$/);
          const headline = suffixMatch ? suffixMatch[1].trim() : i.title;
          const source = i.sourceName ?? suffixMatch?.[2]?.trim() ?? "Google News";
          return {
            headline,
            source,
            url: i.link,
            publishedAt: safeIso(i.pubDate),
            tickers: [symbol.toUpperCase()],
            summary: null,
            category: categorizeIndianDevelopment(headline),
          } satisfies NewsItem;
        });
      },
      { symbol: base },
    );
    return result.data
      .filter((n) => !isJunkStory(n.headline, n.source, companyName))
      .filter((n) => isRelevantToIndianCompany(n.headline, symbol, companyName))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Aggregation                                                                */
/* -------------------------------------------------------------------------- */

/** Dedupe by normalized headline prefix — same rule fetchMarketNews uses. */
function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Categories where the exchange filing IS the story — always worth surfacing. */
const MATERIAL_CATEGORIES: ReadonlySet<IndiaNewsCategory> = new Set([
  "results", "corporate-action", "m&a", "orders", "management", "credit-rating", "regulatory",
]);

/**
 * Recent developments for an Indian listing: material NSE filings blended
 * with relevance-filtered media coverage, newest first.
 *
 * Material filings are guaranteed a seat (up to a third of the list) even
 * when the media feed is chattier — a quarterly result or an order win
 * matters more than a fourth story about the share price.
 */
export async function getIndianCompanyNews(symbol: string, count = 8): Promise<NewsItem[]> {
  const name = await getQuote(symbol).then((q) => q.name || null, () => null);

  const [announcements, media] = await Promise.all([
    fetchNseCorporateAnnouncements(symbol, 25),
    fetchGoogleIndiaNews(symbol, name, count * 2),
  ]);

  const filingItems = announcements
    .filter((a) => !a.routine)
    .map(announcementToNewsItem);
  const materialFilings = filingItems
    .filter((n) => n.category != null && MATERIAL_CATEGORIES.has(n.category as IndiaNewsCategory))
    .slice(0, Math.max(2, Math.floor(count / 3)));

  const blended = dedupe([...materialFilings, ...media, ...filingItems])
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  // Re-guarantee the material filings survive the recency sort + slice.
  const top = blended.slice(0, count);
  for (const f of materialFilings) {
    if (!top.includes(f)) {
      top.pop();
      top.push(f);
    }
  }
  return top.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/* -------------------------------------------------------------------------- */
/* NSE results intelligence                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Official quarterly-results metadata from NSE's corporates-financial-results
 * endpoint, with bank asset-quality figures extracted from the attached XBRL
 * where the filing carries them.
 *
 * IMPORTANT LIMITATION (observed live, 2026-08): this NSE endpoint can lag
 * screener.in by several quarters. Consumers must therefore match `periodEnd`
 * against the quarter they are displaying before presenting `reportedAt` or
 * the NPA figures as belonging to it — never assume this is the latest quarter.
 */
export interface NseResultsMeta {
  symbol: string;
  /** "First Quarter" | "Third Quarter" | … as NSE words it. */
  relatingTo: string | null;
  /** Period end, ISO date ("2026-06-30"). */
  periodEnd: string | null;
  /** When the results hit the exchange, ISO datetime — the "reported on" date. */
  reportedAt: string | null;
  audited: boolean;
  consolidated: boolean;
  /** Bank/NBFC asset quality from the standalone XBRL, percent units (1.42 = 1.42%). */
  grossNpaPercent: number | null;
  netNpaPercent: number | null;
  /** Capital adequacy ratio when the XBRL carries it, percent units. */
  capitalAdequacyPercent: number | null;
  xbrlUrl: string | null;
}

interface RawNseResult {
  relatingTo?: string;
  toDate?: string;
  broadCastDate?: string;
  audited?: string;
  consolidated?: string;
  xbrl?: string;
  bank?: string;
}

function parseNseDateTime(raw: string | undefined): string | null {
  if (!raw) return null;
  // "23-Jan-2025 12:27:21" / "31-Dec-2024"
  const m = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]} ${m[3]} ${m[4] ?? "00:00:00"} UTC`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Extract a percent-unit figure from an XBRL fraction tag (0.0142 → 1.42). */
function xbrlPercent(xml: string, ...tags: string[]): number | null {
  for (const tag of tags) {
    const m = xml.match(new RegExp(`<in-bse-fin:${tag}[^>]*>([\\d.]+)<`));
    if (m) {
      const v = Number(m[1]) * 100;
      // Sanity gate: NPA/CAR outside (0, 60)% is a parse artifact, not data.
      if (Number.isFinite(v) && v > 0 && v < 60) return Number(v.toFixed(2));
    }
  }
  return null;
}

/**
 * Latest filed quarterly result for a symbol. Banks/NBFCs (`wantBankMetrics`)
 * additionally get Gross/Net NPA % and CAR from the standalone XBRL — the
 * figures screener.in login-gates. Values are only ever read from the filing
 * itself; nothing is inferred.
 */
export async function getLatestResultsMeta(
  symbol: string,
  opts: { wantBankMetrics?: boolean } = {},
): Promise<NseResultsMeta | null> {
  const base = nseBaseSymbol(symbol);
  try {
    const { data } = await getDataset<NseResultsMeta | null>(
      "indiaResults",
      { symbol: base, bank: opts.wantBankMetrics ?? false },
      async (signal) => {
        const cookies = await nseCookies();
        const res = await fetch(
          `https://www.nseindia.com/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(base)}&period=Quarterly`,
          {
            headers: { ...NSE_HEADERS, Accept: "application/json", Cookie: cookies, Referer: "https://www.nseindia.com" },
            signal,
          },
        );
        if (!res.ok) throw new Error(`NSE results HTTP ${res.status}`);
        const raw = (await res.json()) as RawNseResult[];
        if (!Array.isArray(raw) || raw.length === 0) return null;

        const sorted = [...raw].sort((a, b) => {
          const ta = parseNseDateTime(a.toDate) ?? "";
          const tb = parseNseDateTime(b.toDate) ?? "";
          return tb.localeCompare(ta);
        });
        // "Reported on" prefers the consolidated filing when both exist for the
        // newest period; bank metrics come from the standalone XBRL (that is
        // where lenders report NPA).
        const newestPeriod = sorted[0]?.toDate ?? null;
        const ofNewest = sorted.filter((r) => r.toDate === newestPeriod);
        const headline = ofNewest.find((r) => r.consolidated === "Consolidated") ?? ofNewest[0];
        const standalone = ofNewest.find((r) => r.consolidated !== "Consolidated") ?? headline;

        let grossNpaPercent: number | null = null;
        let netNpaPercent: number | null = null;
        let capitalAdequacyPercent: number | null = null;
        if (opts.wantBankMetrics && standalone?.xbrl) {
          try {
            const xml = await fetch(standalone.xbrl, {
              headers: NSE_HEADERS,
              signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
            }).then((r) => (r.ok ? r.text() : ""));
            if (xml) {
              grossNpaPercent = xbrlPercent(xml, "PercentageOfGrossNpa", "PercentageOfGrossNonPerformingAssets");
              netNpaPercent = xbrlPercent(xml, "PercentageOfNpa", "PercentageOfNetNpa", "PercentageOfNetNonPerformingAssets");
              capitalAdequacyPercent = xbrlPercent(xml, "CapitalAdequacyRatio", "TotalCapitalAdequacyRatio");
            }
          } catch {
            /* XBRL is best-effort — the metadata stands on its own */
          }
        }

        return {
          symbol: base,
          relatingTo: headline?.relatingTo ?? null,
          periodEnd: parseNseDateTime(headline?.toDate)?.slice(0, 10) ?? null,
          reportedAt: parseNseDateTime(headline?.broadCastDate),
          audited: headline?.audited === "Audited",
          consolidated: headline?.consolidated === "Consolidated",
          grossNpaPercent,
          netNpaPercent,
          capitalAdequacyPercent,
          xbrlUrl: standalone?.xbrl ?? null,
        };
      },
      { symbol: base },
    );
    return data;
  } catch {
    return null;
  }
}

/** An upcoming (or very recent) board-meeting date whose purpose includes results. */
export interface NseUpcomingResults {
  date: string;      // ISO date
  purpose: string;   // as NSE words it, e.g. "Financial Results"
}

/**
 * Next scheduled results date from NSE's event calendar. Only ever returns a
 * date NSE itself lists — never an estimate — and only when it is today or
 * in the future.
 */
export async function getUpcomingResultsDate(symbol: string): Promise<NseUpcomingResults | null> {
  const base = nseBaseSymbol(symbol);
  try {
    const { data } = await getDataset<NseUpcomingResults | null>(
      "indiaEvents",
      { symbol: base },
      async (signal) => {
        const cookies = await nseCookies();
        const res = await fetch(
          `https://www.nseindia.com/api/event-calendar?index=equities&symbol=${encodeURIComponent(base)}`,
          {
            headers: { ...NSE_HEADERS, Accept: "application/json", Cookie: cookies, Referer: "https://www.nseindia.com" },
            signal,
          },
        );
        if (!res.ok) throw new Error(`NSE event calendar HTTP ${res.status}`);
        const raw = (await res.json()) as { purpose?: string; date?: string }[];
        if (!Array.isArray(raw)) return null;

        const today = new Date().toISOString().slice(0, 10);
        const upcoming = raw
          .filter((e) => /result/i.test(e.purpose ?? ""))
          .map((e) => ({ date: parseNseDateTime(e.date)?.slice(0, 10) ?? "", purpose: e.purpose ?? "" }))
          .filter((e) => e.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date));
        return upcoming[0] ?? null;
      },
      { symbol: base },
    );
    return data;
  } catch {
    return null;
  }
}

/** One scheduled results board meeting from NSE's market-wide calendar. */
export interface NseCalendarEntry {
  symbol: string;    // base NSE symbol
  company: string;
  date: string;      // ISO date NSE lists — a scheduled meeting, not a promise
  purpose: string;
}

/**
 * The market-wide results calendar — ONE call for every NSE company with a
 * scheduled board meeting whose purpose includes financial results (observed
 * horizon: about a week ahead). This is the primitive behind "results this
 * week" surfaces; per-symbol lookups should filter this rather than making
 * 500 per-symbol calls.
 *
 * BSE alternative investigated (2026-08, Phase 8): api.bseindia.com
 * Corpforthresults responds with structured JSON when sent browser
 * Referer/Origin headers (2,195 companies live) — but its horizon was the
 * SAME ~1 week as NSE's (both are deadline-driven disclosures), and identity
 * is BSE scrip-code rather than NSE symbol. No horizon benefit, extra
 * mapping risk → NSE stays authoritative.
 */
export async function getMarketResultsCalendar(): Promise<NseCalendarEntry[]> {
  try {
    const { data } = await getDataset<NseCalendarEntry[]>(
      "indiaEvents",
      { symbol: "__market__" },
      async (signal) => {
        const cookies = await nseCookies();
        const res = await fetch("https://www.nseindia.com/api/event-calendar?index=equities", {
          headers: { ...NSE_HEADERS, Accept: "application/json", Cookie: cookies, Referer: "https://www.nseindia.com" },
          signal,
        });
        if (!res.ok) throw new Error(`NSE event calendar HTTP ${res.status}`);
        const raw = (await res.json()) as { symbol?: string; company?: string; purpose?: string; date?: string }[];
        if (!Array.isArray(raw)) return [];
        return raw
          .filter((e) => /result/i.test(e.purpose ?? "") && e.symbol)
          .map((e) => ({
            symbol: (e.symbol ?? "").toUpperCase(),
            company: e.company ?? e.symbol ?? "",
            date: parseNseDateTime(e.date)?.slice(0, 10) ?? "",
            purpose: e.purpose ?? "",
          }))
          .filter((e) => e.date !== "")
          .sort((a, b) => a.date.localeCompare(b.date));
      },
    );
    return data;
  } catch {
    return [];
  }
}
