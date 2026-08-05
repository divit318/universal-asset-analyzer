/**
 * AMFI provider — official scheme-level TER for Indian mutual funds.
 *
 * Yahoo/Morningstar carries NO expense ratio for Indian mutual funds (it
 * encodes the gap as a literal 0 — see mapFundProfile in lib/yahoo.ts).
 * AMFI, the industry body, publishes every scheme's Total Expense Ratio
 * monthly, split into Regular-plan and Direct-plan figures. This module
 * fetches that table per AMC and matches a Yahoo fund name onto it.
 *
 * Endpoints (verified live, 2026-08):
 *   GET www.amfiindia.com/api/populate-ter-month?year=<FY "2026-2027">
 *     → [{ MonthYear: "July-2026", MonthNumber: "07-2026" }, …] newest first
 *   GET www.amfiindia.com/api/populate-te-rdata-revised
 *         ?MF_ID=<id>&Month=<MM-YYYY>&strCat=-1&strType=-1&page=1&pageSize=10000
 *     → { data: [{ Scheme_Name, R_TER, D_TER, TER_Date, … }], meta: { total } }
 *       (one row per scheme per day; TER is flat within a month, so rows are
 *        deduped keeping the latest TER_Date)
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
          const payload = await fetchJson<{ data?: RawTerRow[] }>(
            `${BASE}/populate-te-rdata-revised?MF_ID=${mfId}&Month=${encodeURIComponent(month)}&strCat=-1&strType=-1&page=1&pageSize=10000`,
            signal,
          );
          const parsed = parseTerRows(payload.data ?? []);
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
