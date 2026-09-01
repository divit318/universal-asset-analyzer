/**
 * AMFI provider — official scheme-level TER for Indian mutual funds.
 *
 * Yahoo/Morningstar carries NO expense ratio for Indian mutual funds (it
 * encodes the gap as a literal 0 — see mapFundProfile in lib/yahoo.ts).
 * AMFI, the industry body, publishes every scheme's Total Expense Ratio
 * monthly, split into Regular-plan and Direct-plan figures. This module
 * fetches that table per AMC and matches a Yahoo fund name onto it.
 *
 * Endpoints (verified live, 2026-08; pagination re-verified 2026-09):
 *   GET www.amfiindia.com/api/populate-ter-month?year=<FY "2026-2027">
 *     → [{ MonthYear: "July-2026", MonthNumber: "07-2026" }, …] newest first
 *   GET www.amfiindia.com/api/populate-te-rdata-revised
 *         ?MF_ID=<id>&Month=<MM-YYYY>&strCat=-1&strType=-1&page=<n>&pageSize=…
 *     → { data: [{ Scheme_Name, R_TER, D_TER, TER_Date, … }],
 *         meta: { page, pageSize, total, pageCount } }
 *       (one row per scheme per day; TER is flat within a month, so rows are
 *        deduped keeping the latest TER_Date. The API now CAPS pageSize at
 *        100 regardless of what is requested — PPFAS, MF_ID 64, reports
 *        total 217 / pageCount 3 — so every page must be fetched and merged
 *        before parsing, or schemes beyond row 100 silently never match.)
 *   GET www.amfiindia.com/spages/NAVAll.txt  (redirects to portal.amfiindia.com)
 *     → the AMFI scheme master: every live scheme's code, ISINs, name, plan,
 *       option, NAV and — via section headers — its SEBI category. This is
 *       the category/plan source for getAmfiSchemeInfo.
 *
 * Failures are non-fatal by design: every public function returns null rather
 * than throwing, so an AMFI outage degrades an Indian fund back to "expense
 * ratio unavailable" — never to a broken fund profile.
 */

import { getDataset } from "./platform/data-layer";

const BASE = "https://www.amfiindia.com/api";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

/* -------------------------------------------------------------------------- */
/* AMC resolution                                                             */
/* -------------------------------------------------------------------------- */

/**
 * AMFI's internal fund-house ids, matched against Yahoo's `fundProfile.family`
 * strings ("HDFC Asset Management Co Ltd" → HDFC Mutual Fund, id 9).
 *
 * A curated list, same pattern as ISSUER_PATTERNS in the ETF universe: the raw
 * strings on the two sides never match verbatim, and the id space moves about
 * once a year (a new AMC launching). Ids verified against the live TER page's
 * own AMC dropdown (56 entries, 2026-08). Word boundaries matter: without
 * them "LIC" matches "public" and "ITI" matches "Securities".
 */
const AMC_PATTERNS: [RegExp, number][] = [
  [/\b360\s?one\b/i, 62],
  [/\babakkus\b/i, 85],
  [/\baditya birla\b|\bbirla sun ?life\b/i, 3],
  [/\balphagrep\b/i, 86],
  [/\bangel one\b/i, 80],
  // Generic English words as AMC brands ("ASK", "Trust", "Choice") are
  // anchored to the START of the family string: "Trust Asset Management Pvt
  // Ltd" is the AMC, "Securities Trust of America" is not.
  [/^ask\b/i, 87],
  [/\baxis\b/i, 53],
  [/\bbajaj\b/i, 75],
  [/\bbandhan\b|\bidfc\b/i, 48],
  [/\bbank of india\b|\bboi\b/i, 46],
  [/\bbaroda\b/i, 4],
  [/\bcanara\b/i, 32],
  [/\bcapitalmind\b/i, 81],
  [/\bcarnelian\b/i, 91],
  [/^choice\b/i, 84],
  [/\bdsp\b/i, 6],
  [/\bedelweiss\b/i, 47],
  [/\bfranklin\b/i, 27],
  [/\bgroww\b|\bindiabulls\b/i, 63],
  [/\bhdfc\b/i, 9],
  [/\bhelios\b/i, 76],
  [/\bhsbc\b|\bl&t\b/i, 37],
  [/\bicici\b/i, 20],
  [/\binvesco\b/i, 42],
  [/\biti\b/i, 70],
  [/\bjio\s?blackrock\b/i, 82],
  [/\bjm financial\b/i, 16],
  [/\bkotak\b/i, 17],
  [/\blakshya\b/i, 88],
  [/\blic\b/i, 18],
  [/\bmahindra\b/i, 69],
  [/\bmirae\b/i, 45],
  [/\bmonarch\b/i, 89],
  [/\bmotilal\b/i, 55],
  [/\bnavi\b/i, 54],
  [/\bnippon\b/i, 21],
  [/\bnj\b/i, 73],
  [/\bnuvama\b/i, 90],
  [/\bold bridge\b/i, 78],
  [/\bpgim\b/i, 58],
  [/\bppfas\b|\bparag parikh\b/i, 64],
  [/\bquantum\b/i, 41],
  [/\bquant\b/i, 13], // after "quantum" — \b keeps them distinct, order is belt-and-braces
  [/\bsamco\b/i, 74],
  [/\bsbi\b/i, 22],
  [/\bshriram\b/i, 67],
  [/\bsundaram\b/i, 33],
  [/\btata\b/i, 25],
  [/\btaurus\b/i, 26],
  [/\bwealth company\b/i, 83],
  [/^trust\b/i, 72],
  [/\bunifi\b/i, 79],
  [/\bunion\b/i, 61],
  [/\buti\b/i, 28],
  [/\bwhite\s?oak\b/i, 71],
  [/\bzerodha\b/i, 77],
];

/** Resolve Yahoo's fund family string to an AMFI fund-house id, or null. */
export function amfiAmcId(family: string | null | undefined): number | null {
  if (!family) return null;
  for (const [pattern, id] of AMC_PATTERNS) if (pattern.test(family)) return id;
  return null;
}

/**
 * The AMC pattern a Yahoo family string matches — the same regex also matches
 * the AMC's NAVAll subsection name ("PPFAS Mutual Fund"), which is how the
 * scheme master gets restricted to one fund house without an id mapping.
 */
function amfiAmcPattern(family: string | null | undefined): RegExp | null {
  if (!family) return null;
  for (const [pattern] of AMC_PATTERNS) if (pattern.test(family)) return pattern;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Scheme-name matching                                                       */
/* -------------------------------------------------------------------------- */

// Words that describe the wrapper, not the strategy — identical across every
// scheme of an AMC, so they only add noise to a similarity score.
const STOPWORDS = new Set(["fund", "scheme", "plan", "option", "the", "of", "an", "a"]);

// Morningstar's (Yahoo's) compressed share-class suffixes. These describe the
// plan/option, which AMFI's scheme-level TER table doesn't key on — the plan
// only decides WHICH of the two TER columns (R_TER/D_TER) applies. Stripped
// from the END only: "Growth" is a class suffix in "HDFC Large Cap Gr" but
// part of the scheme's identity in "HDFC Growth Opportunities Fund".
const TRAILING_CLASS_TOKEN =
  /\s+(dir|direct|gr|growth|idcw(-[rp])?|bns|bonus|reg|regular|payout|reinv(estment)?|div(idend)?|daily|weekly|fortnightly|monthly|quarterly|half yearly|annual(ly)?)$/i;

function normalizeTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Strip Yahoo's trailing share-class suffixes down to the scheme's own name. */
export function yahooSchemeBase(name: string): string {
  let s = name.trim();
  for (;;) {
    const next = s.replace(TRAILING_CLASS_TOKEN, "");
    if (next === s) return s;
    s = next;
  }
}

/** Is this Yahoo fund name a Direct-plan share class? Defaults to Regular. */
export function isDirectPlan(name: string): boolean {
  return /\bdir(ect)?\b/i.test(name);
}

/**
 * Match a Yahoo fund name against an AMC's AMFI scheme names.
 *
 * Token-set Jaccard over normalized names, with two guards learned from the
 * real failure modes: a 0.75 floor (so "HDFC Large Cap" can never fall back
 * to some unrelated HDFC scheme when the right one is missing), and a strict-
 * best requirement (a tie between "Large & Mid Cap" and "Large Cap" is an
 * ambiguity, not a match — returning either would be a guess).
 */
export function matchAmfiScheme<T extends { schemeName: string }>(
  yahooName: string,
  schemes: T[],
): T | null {
  const query = new Set(normalizeTokens(yahooSchemeBase(yahooName)));
  if (query.size === 0) return null;

  let best: T | null = null;
  let bestScore = 0;
  let tied = false;

  for (const scheme of schemes) {
    const tokens = new Set(normalizeTokens(scheme.schemeName));
    if (tokens.size === 0) continue;
    let shared = 0;
    for (const t of query) if (tokens.has(t)) shared++;
    const score = shared / (query.size + tokens.size - shared);
    if (score > bestScore) {
      best = scheme;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0 && scheme.schemeName !== best?.schemeName) {
      tied = true;
    }
  }

  return bestScore >= 0.75 && !tied ? best : null;
}

/* -------------------------------------------------------------------------- */
/* TER fetch                                                                  */
/* -------------------------------------------------------------------------- */

export interface AmfiSchemeTer {
  schemeName: string;
  category: string | null;
  /** Regular-plan TER as a fraction (0.0156 = 1.56%). */
  regularTer: number | null;
  /** Direct-plan TER as a fraction. */
  directTer: number | null;
  /** The TER_Date of the row kept (latest in the month), ISO date. */
  asOf: string | null;
}

interface RawTerRow {
  Scheme_Name?: string;
  SchemeCat_Desc?: string;
  R_TER?: string;
  D_TER?: string;
  TER_Date?: string;
}

export interface TerPageMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  pageCount?: number;
}

// A month has at most 31 rows per scheme; 500 pages of 100 is far beyond the
// largest AMC. Anything above it is a garbage meta, not a bigger table.
const MAX_TER_PAGES = 500;

/** How many pages the TER API is holding, from the first response's meta. */
export function terPageCount(meta: TerPageMeta | undefined): number {
  const declared =
    meta?.pageCount ??
    (meta?.total && meta?.pageSize ? Math.ceil(meta.total / meta.pageSize) : 1);
  if (!Number.isFinite(declared)) return 1;
  return Math.min(Math.max(Math.floor(declared), 1), MAX_TER_PAGES);
}

/**
 * Concatenate a paginated fetch's pages, or null if ANY page is missing —
 * matching a Yahoo name against a partial table would silently return the
 * wrong scheme's TER, which is worse than returning nothing.
 */
export function mergeTerPages<T>(pages: (T[] | null | undefined)[]): T[] | null {
  const merged: T[] = [];
  for (const page of pages) {
    if (!page) return null;
    merged.push(...page);
  }
  return merged;
}

interface TerPage {
  data?: RawTerRow[];
  meta?: TerPageMeta;
}

/**
 * One month's full row set across every page the API is holding. The API caps
 * pageSize at 100 server-side, so page 1's meta decides how many more pages
 * exist; those are fetched with bounded concurrency and merged. Null (rather
 * than a partial set) if any page comes back without rows.
 */
async function fetchTerMonth(mfId: number, month: string, signal: AbortSignal): Promise<RawTerRow[] | null> {
  const pageUrl = (page: number, pageSize: number) =>
    `${BASE}/populate-te-rdata-revised?MF_ID=${mfId}&Month=${encodeURIComponent(month)}&strCat=-1&strType=-1&page=${page}&pageSize=${pageSize}`;
  const first = await fetchJson<TerPage>(pageUrl(1, 10_000), signal);
  const pages = terPageCount(first.meta);
  if (pages <= 1) return first.data ?? [];

  // Follow-up pages MUST use the server's effective pageSize — offsets are
  // computed from the requested size, so asking for page 2 of 10000 would skip.
  const pageSize = first.meta?.pageSize && first.meta.pageSize > 0 ? first.meta.pageSize : 100;
  const rest: (RawTerRow[] | null)[] = new Array(pages - 1).fill(null);
  let next = 2;
  const worker = async () => {
    for (;;) {
      const page = next++;
      if (page > pages) return;
      const payload = await fetchJson<TerPage>(pageUrl(page, pageSize), signal);
      rest[page - 2] = payload.data ?? null;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pages - 1) }, worker));
  return mergeTerPages([first.data ?? null, ...rest]);
}

const terPct = (v: string | undefined): number | null => {
  const n = Number(v);
  // AMFI reports percent ("1.5600"); zero here is Yahoo's disease too — a
  // scheme with a genuinely-zero TER does not exist under SEBI's fee rules.
  return Number.isFinite(n) && n > 0 ? n / 100 : null;
};

/** Indian financial year label ("2026-2027") for a date — FY starts in April. */
function financialYear(d: Date): string {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!res.ok) throw new Error(`AMFI ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** Newest-first published TER months, across this FY and (if needed) the last. */
async function latestTerMonths(signal: AbortSignal): Promise<string[]> {
  const now = new Date();
  const years = [financialYear(now), financialYear(new Date(now.getFullYear() - 1, now.getMonth(), 1))];
  for (const year of years) {
    const months = await fetchJson<{ MonthNumber?: string }[]>(
      `${BASE}/populate-ter-month?year=${encodeURIComponent(year)}`,
      signal,
    ).catch(() => []);
    const numbers = months.map((m) => m.MonthNumber).filter((m): m is string => !!m);
    if (numbers.length > 0) return numbers;
  }
  return [];
}

/** Parse one month's rows into per-scheme records, keeping each scheme's latest day. */
export function parseTerRows(rows: RawTerRow[]): AmfiSchemeTer[] {
  const bySc = new Map<string, { row: RawTerRow; date: string }>();
  for (const row of rows) {
    const name = row.Scheme_Name?.trim();
    if (!name) continue;
    const date = row.TER_Date ?? "";
    const prev = bySc.get(name);
    if (!prev || date > prev.date) bySc.set(name, { row, date });
  }
  return [...bySc.entries()].map(([schemeName, { row, date }]) => ({
    schemeName,
    category: row.SchemeCat_Desc ?? null,
    regularTer: terPct(row.R_TER),
    directTer: terPct(row.D_TER),
    asOf: date ? date.slice(0, 10) : null,
  }));
}

/**
 * Every scheme's TER for one fund house, from the most recent month AMFI has
 * published rows for. Cached per AMC (3d TTL / 7d SWR, persisted) — the table
 * changes monthly at most.
 */
export async function getAmfiTerTable(mfId: number): Promise<AmfiSchemeTer[] | null> {
  try {
    const { data } = await getDataset<AmfiSchemeTer[]>(
      "amfiTer",
      { mfId },
      async (signal) => {
        // Early in a month AMFI may list the month with no rows yet — walk
        // back up to two published months before concluding there's nothing.
        const months = await latestTerMonths(signal);
        for (const month of months.slice(0, 2)) {
          const rows = await fetchTerMonth(mfId, month, signal);
          if (rows == null) throw new Error(`AMFI: partial TER page set for AMC ${mfId}`);
          const parsed = parseTerRows(rows);
          if (parsed.length > 0) return parsed;
        }
        // Throw rather than return [] so the platform never pins "no TER
        // exists for this AMC" for three days off the back of an outage.
        throw new Error(`AMFI: no TER rows for AMC ${mfId}`);
      },
    );
    return data;
  } catch {
    return null;
  }
}

/**
 * The one call the fund pipeline makes: the TER for the share class a Yahoo
 * fund name describes. Null whenever any link of the chain (AMC id, scheme
 * match, plan column) can't be established honestly.
 */
export async function getAmfiTerForFund(
  yahooName: string,
  family: string | null,
): Promise<{ ter: number; schemeName: string; asOf: string | null } | null> {
  const mfId = amfiAmcId(family);
  if (mfId == null) return null;
  const table = await getAmfiTerTable(mfId);
  if (!table) return null;
  const scheme = matchAmfiScheme(yahooName, table);
  if (!scheme) return null;
  const ter = isDirectPlan(yahooName) ? scheme.directTer : scheme.regularTer;
  return ter != null ? { ter, schemeName: scheme.schemeName, asOf: scheme.asOf } : null;
}

/* -------------------------------------------------------------------------- */
/* Scheme master (NAVAll) — SEBI category + plan resolution                   */
/* -------------------------------------------------------------------------- */

export type AmfiCategoryGroup = "equity" | "debt" | "hybrid" | "solution" | "other";

export interface AmfiCategory {
  group: AmfiCategoryGroup;
  /** Normalized SEBI category ("Large Cap", "Liquid", "Balanced Advantage", …). */
  category: string;
  /** The section name as AMFI printed it ("Equity Scheme - Large Cap Fund"). */
  raw: string;
}

/**
 * One row of the NAVAll scheme master. The feed's current shape (verified
 * live 2026-09) is 8 semicolon-separated columns — Plan and Option are their
 * own fields; the older 6-column shape folded them into the scheme name, and
 * the parser accepts both since AMFI has changed this before.
 */
export interface AmfiNavEntry {
  schemeCode: number;
  schemeName: string;
  isins: string[];
  nav: number | null;
  amcName: string;
  /** From the section header: "Open Ended", "Close Ended", "Interval Fund". */
  schemeType: string;
  /** The parenthesized section category, verbatim. */
  rawCategory: string;
  /** "Direct Plan" / "Regular Plan" when the feed carries the column. */
  plan: string | null;
  /** "Growth", "Monthly IDCW Payout", … when the feed carries the column. */
  option: string | null;
}

export interface AmfiSchemeInfo {
  schemeCode: number;
  schemeName: string;
  category: AmfiCategory;
  isDirect: boolean;
  isGrowth: boolean;
  nav: number | null;
}

/**
 * Raw section name → normalized SEBI-2017 category. Ordered: within a group
 * the more specific pattern comes first ("Large & Mid Cap" before "Large
 * Cap", "10-year Constant Maturity" before "Gilt"). Rules are matched against
 * the whole raw string, lowercased; the section's leading words pick the
 * group, so "Income/Debt Oriented Schemes - Sectoral Fund" stays debt.
 */
const CATEGORY_RULES: [AmfiCategoryGroup, RegExp, string][] = [
  ["equity", /large\s*(&|and)\s*mid\s*cap/, "Large & Mid Cap"],
  ["equity", /large\s*cap/, "Large Cap"],
  ["equity", /mid\s*cap/, "Mid Cap"],
  ["equity", /small\s*cap/, "Small Cap"],
  ["equity", /multi\s*cap/, "Multi Cap"],
  ["equity", /flexi\s*cap/, "Flexi Cap"],
  ["equity", /elss|tax\s*sav/, "ELSS"],
  ["equity", /sectoral|thematic/, "Sectoral/Thematic"],
  ["equity", /focused/, "Focused"],
  ["equity", /value/, "Value"],
  ["equity", /contra/, "Contra"],
  ["equity", /dividend\s*yield/, "Dividend Yield"],
  ["debt", /overnight/, "Overnight"],
  ["debt", /liquid/, "Liquid"],
  ["debt", /ultra\s*short/, "Ultra Short Duration"],
  ["debt", /low\s*duration/, "Low Duration"],
  ["debt", /money\s*market/, "Money Market"],
  ["debt", /medium\s*to\s*long/, "Medium to Long Duration"],
  ["debt", /short\s*(duration|term)/, "Short Duration"],
  ["debt", /medium\s*(duration|term)/, "Medium Duration"],
  ["debt", /long\s*(duration|term)/, "Long Duration"],
  ["debt", /dynamic\s*bond/, "Dynamic Bond"],
  ["debt", /corporate\s*bond/, "Corporate Bond"],
  ["debt", /credit\s*risk/, "Credit Risk"],
  ["debt", /banking\s*(and|&)\s*psu/, "Banking and PSU"],
  ["debt", /10[\s-]*year|constant\s*(maturity|duration)/, "Gilt with 10 year Constant Duration"],
  ["debt", /gilt/, "Gilt"],
  ["debt", /float/, "Floater"],
  ["hybrid", /aggressive\s*hybrid/, "Aggressive Hybrid"],
  ["hybrid", /conservative\s*hybrid/, "Conservative Hybrid"],
  ["hybrid", /balanced\s*hybrid/, "Balanced Hybrid"],
  ["hybrid", /balanced\s*advantage|dynamic\s*asset\s*allocation/, "Balanced Advantage"],
  ["hybrid", /multi\s*asset/, "Multi Asset Allocation"],
  ["hybrid", /arbitrage/, "Arbitrage"],
  ["hybrid", /equity\s*savings/, "Equity Savings"],
  ["solution", /retirement/, "Retirement"],
  ["solution", /child/, "Children's"],
  ["other", /gold/, "Gold ETF"],
  ["other", /silver/, "Silver ETF"],
  ["other", /etf|exchange\s*traded/, "ETF"],
  ["other", /index/, "Index Fund"],
  ["other", /(fof|fund\s*of\s*funds).*overseas|overseas.*(fof|fund\s*of\s*funds)/, "FoF Overseas"],
  ["other", /fof|fund\s*of\s*funds/, "FoF Domestic"],
];

function categoryGroup(raw: string): AmfiCategoryGroup {
  const s = raw.toLowerCase();
  if (/etf|exchange\s*traded|index\s*fund|fof|fund\s*of\s*funds|gold|silver|^other/.test(s)) return "other";
  if (/solution|child|retirement|life\s*cycle/.test(s)) return "solution";
  if (/hybrid|arbitrage|balanced/.test(s)) return "hybrid";
  if (/debt|income|liquid|money\s*market|gilt|float/.test(s)) return "debt";
  if (/equity|elss|growth/.test(s)) return "equity";
  return "other";
}

/** Normalize a raw NAVAll section name to its SEBI category, best-effort. */
export function normalizeAmfiCategory(raw: string): AmfiCategory {
  const group = categoryGroup(raw);
  const s = raw.toLowerCase();
  for (const [ruleGroup, pattern, category] of CATEGORY_RULES) {
    if (ruleGroup === group && pattern.test(s)) return { group, category, raw };
  }
  return { group, category: raw, raw };
}

// "Open Ended Schemes(Equity Scheme - Large Cap Fund)" — the category may
// itself contain parens ("Exchange Traded Funds (ETFs) - Equity ETF"), so
// the capture is greedy up to the line's closing paren.
const SECTION_RE = /^(.+?)\s+Schemes?\s*\((.+)\)\s*$/;

const NOT_AN_ISIN = /^-?$|^n\.?a\.?$/i;

/**
 * Parse the NAVAll scheme-master text. State machine over three line kinds:
 * section headers set the type/category, bare lines set the AMC, semicolon
 * rows are schemes. Malformed rows (non-numeric code, wrong column count,
 * rows before the first section) are skipped, never fatal.
 */
export function parseNavAll(text: string): AmfiNavEntry[] {
  const entries: AmfiNavEntry[] = [];
  let schemeType = "";
  let rawCategory = "";
  let amcName = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (!line) continue;

    if (!line.includes(";")) {
      const section = line.match(SECTION_RE);
      if (section) {
        schemeType = section[1].trim();
        rawCategory = section[2].trim();
      } else {
        amcName = line;
      }
      continue;
    }

    const fields = line.split(";").map((f) => f.trim());
    if (fields.length !== 8 && fields.length !== 6) continue;
    const schemeCode = Number(fields[0]);
    if (!Number.isInteger(schemeCode) || !fields[3] || !rawCategory) continue;

    const eight = fields.length === 8;
    const nav = Number(eight ? fields[6] : fields[4]);
    entries.push({
      schemeCode,
      schemeName: fields[3],
      isins: [fields[1], fields[2]].filter((v) => !NOT_AN_ISIN.test(v)),
      nav: Number.isFinite(nav) && nav > 0 ? nav : null,
      amcName,
      schemeType,
      rawCategory,
      plan: eight && fields[4] ? fields[4] : null,
      option: eight && fields[5] ? fields[5] : null,
    });
  }
  return entries;
}

// "HDFC Dividend Yield Fund - IDCW" is an income option; "HDFC Dividend
// Yield Fund - Growth" is not, despite the word "dividend" in its strategy.
const INCOME_OPTION = /idcw|payout|reinv|bonus|\bbns\b|dividend(?!\s*yield)|\bdiv\b(?!\s*yield)/i;

function entryIsDirect(entry: AmfiNavEntry): boolean {
  return entry.plan ? /direct/i.test(entry.plan) : isDirectPlan(entry.schemeName);
}

function entryIsGrowth(entry: AmfiNavEntry): boolean {
  const source = entry.option ?? entry.schemeName;
  return !INCOME_OPTION.test(source);
}

/** Is this Yahoo fund name a growth option? IDCW markers say no; default yes. */
function wantsGrowth(yahooName: string): boolean {
  return !INCOME_OPTION.test(yahooName);
}

// Legacy 6-column NAVAll names decorate the scheme with its plan/option
// ("HDFC Large Cap Fund - Regular Plan - Growth"); those words would dilute
// the Jaccard score below its floor, so matching runs on the bare scheme name.
const NAME_DECORATION =
  /\s*[-–]\s*(direct|regular|growth|idcw|div(idend)?|bonus|payout|reinv(estment)?|daily|weekly|fortnightly|monthly|quarterly|half\s*yearly|annual)\b.*$/i;

function schemeNameBase(name: string): string {
  let s = name.trim();
  for (;;) {
    const next = s.replace(NAME_DECORATION, "");
    if (next === s) return s;
    s = next;
  }
}

/**
 * The full parsed scheme master, cached for a day-scale window (the file is
 * republished daily; names/categories churn far slower). Rides the amfiTer
 * dataset policy (3d TTL / 7d SWR, persisted) under its own cache key — the
 * DatasetId registry lives outside this module.
 */
export async function getAmfiSchemeMaster(): Promise<AmfiNavEntry[] | null> {
  try {
    const { data } = await getDataset<AmfiNavEntry[]>(
      "amfiTer",
      { feed: "navAll" },
      async (signal) => {
        const res = await fetch("https://www.amfiindia.com/spages/NAVAll.txt", {
          headers: { "User-Agent": HEADERS["User-Agent"], Accept: "text/plain" },
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });
        if (!res.ok) throw new Error(`AMFI NAVAll ${res.status}`);
        const entries = parseNavAll(await res.text());
        // The live master carries ~15k schemes; a fraction of that is a
        // truncated download or a format change, not a smaller industry.
        if (entries.length < 1000) throw new Error(`AMFI NAVAll: only ${entries.length} rows parsed`);
        return entries;
      },
    );
    return data;
  } catch {
    return null;
  }
}

/**
 * Pure core of getAmfiSchemeInfo: restrict to the AMC when the family maps,
 * then to plan-consistent entries (a "Reg Gr" name must never resolve to a
 * Direct plan), prefer option-consistent ones, and reuse the token-Jaccard
 * matcher with its tie-is-ambiguity contract.
 */
export function matchAmfiSchemeInfo(
  yahooName: string,
  family: string | null | undefined,
  entries: AmfiNavEntry[],
): AmfiSchemeInfo | null {
  const amcPattern = amfiAmcPattern(family);
  const amcPool = amcPattern ? entries.filter((e) => amcPattern.test(e.amcName)) : entries;
  const pool = amcPool.length > 0 ? amcPool : entries;

  const wantDirect = isDirectPlan(yahooName);
  const planPool = pool.filter((e) => entryIsDirect(e) === wantDirect);
  const wantGrowth = wantsGrowth(yahooName);
  const optionPool = planPool.filter((e) => entryIsGrowth(e) === wantGrowth);

  const candidates = (optionPool.length > 0 ? optionPool : planPool).map((entry) => ({
    schemeName: schemeNameBase(entry.schemeName),
    entry,
  }));
  const match = matchAmfiScheme(yahooName, candidates)?.entry ?? null;
  if (!match) return null;
  return {
    schemeCode: match.schemeCode,
    schemeName: match.schemeName,
    category: normalizeAmfiCategory(match.rawCategory),
    isDirect: entryIsDirect(match),
    isGrowth: entryIsGrowth(match),
    nav: match.nav,
  };
}

/**
 * Resolve a Yahoo fund name to its AMFI scheme: SEBI category, plan and
 * option. Null whenever the master can't be fetched or the name doesn't
 * match one scheme unambiguously — same philosophy as getAmfiTerForFund.
 */
export async function getAmfiSchemeInfo(
  yahooName: string,
  family: string | null | undefined,
): Promise<AmfiSchemeInfo | null> {
  try {
    const master = await getAmfiSchemeMaster();
    if (!master) return null;
    return matchAmfiSchemeInfo(yahooName, family, master);
  } catch {
    return null;
  }
}
