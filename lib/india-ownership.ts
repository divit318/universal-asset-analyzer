/**
 * Universe-wide Indian ownership + ROE/ROCE enrichment for the screener.
 *
 * Source: screener.in's per-company page — the same data the Research Hub
 * already parses (shareholding pattern with quarterly periods, top-ratio
 * ROE/ROCE). The problem this module solves is COVERAGE without load: the
 * screener has ~500 names, and 500 live scrapes per build is neither polite
 * nor necessary.
 *
 * Design:
 *   1. A compact per-symbol EXTRACT (ownership %s + period + ROE/ROCE) is
 *      stored under its own long-lived cache dataset (`indiaOwnership`,
 *      7d TTL / 30d SWR, persisted). Shareholding changes quarterly; a week
 *      of staleness is honest as long as the period label rides along.
 *   2. Reads NEVER trigger a fetch. `readIndiaOwnership` peeks the full
 *      screenerIn cache row first (fresh research visits contribute for
 *      free) and falls back to the stored extract.
 *   3. Coverage is built by an explicitly BOUNDED background trickle:
 *      at most TRICKLE_BATCH uncached names per screener load, paced
 *      TRICKLE_GAP_MS apart, largest first — so the names people actually
 *      screen fill in within days, without ever bursting screener.in.
 */

import {
  getScreenerInCompany,
  getPromoterHolding,
  getFIIHolding,
  getDIIHolding,
  type ScreenerInCompany,
} from "./screener-in";
import { readCache, writeCache } from "./platform/cache";
import { cacheKey } from "./platform/registry";
import { trendsFromHistory, type OwnershipObservation, type OwnershipTrends } from "./india-ownership-trends";

export type { OwnershipObservation, OwnershipTrends } from "./india-ownership-trends";

export interface IndiaOwnership {
  /** Base NSE symbol, no suffix. */
  symbol: string;
  /** Latest disclosed quarter, e.g. "Jun 2026" — every % below is AS OF this. */
  period: string | null;
  promoterHolding: number | null;
  fiiHolding: number | null;
  diiHolding: number | null;
  /** Prior disclosed quarter, for QoQ deltas. */
  prevPeriod: string | null;
  promoterPrev: number | null;
  fiiPrev: number | null;
  diiPrev: number | null;
  /**
   * Up to the last 12 DISCLOSED quarters, oldest → newest. Only quarters
   * screener.in actually shows appear here — gaps are simply absent, never
   * estimated. Optional because extracts written before Phase 7 lack it;
   * readers must treat a missing history as "trend unknown".
   */
  history?: OwnershipObservation[];
  /** Extract-shape version — bump EXTRACT_VERSION when derivation logic changes
   *  so stored extracts refresh from cached full rows / the trickle. */
  v?: number;
  /** screener.in top ratios (latest FY, page's reporting basis), percent units. */
  roe: number | null;
  roce: number | null;
  basis: "consolidated" | "standalone" | null;
  fetchedAt: number;
}

/** Trickle bounds — deliberately conservative (see module doc). */
const TRICKLE_BATCH = 25;
const TRICKLE_GAP_MS = 4_000;
const TRICKLE_MIN_INTERVAL_MS = 30 * 60 * 1000;

const SCREENER_IN_PARSER_VERSION = 6; // must match lib/screener-in.ts PARSER_VERSION
/** v3 (Phase 7): quarterly-table-scoped history (parser v6) — v2 extracts
 *  were built from a parse that mislabeled yearly rows as quarters. */
const EXTRACT_VERSION = 3;

function base(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/i, "");
}

/** Last two aligned samples of a shareholding row (source values are strings like "50.11%"). */
function lastTwo(company: ScreenerInCompany, holding: string): [number | null, number | null] {
  const row = company.shareholding?.find((r) => r.holding === holding);
  if (!row || row.values.length === 0) return [null, null];
  const num = (v: string | undefined): number | null => {
    if (v == null) return null;
    const n = Number.parseFloat(v.replace(/[%,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return [num(row.values.at(-1)), row.values.length >= 2 ? num(row.values.at(-2)) : null];
}

/** Parse a "50.11%"-style shareholding cell; null on anything non-numeric. */
function parseHolding(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number.parseFloat(v.replace(/[%,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * The full disclosed series (≤12 quarters), oldest → newest, exact values.
 *
 * Alignment: screener.in's rows can carry FEWER cells than the period header
 * (observed live: 12 periods, 11 values). The LATEST cell is verified to be
 * the latest period (cross-checked against screener.in in Phase 5), so rows
 * are right-aligned to the periods; header periods with no cell get null —
 * never a shifted value.
 */
function buildHistory(company: ScreenerInCompany): OwnershipObservation[] {
  const periods = company.shareholdingPeriods ?? [];
  if (periods.length === 0) return [];
  const row = (holding: string) => company.shareholding?.find((r) => r.holding === holding) ?? null;
  const holders = { promoter: row("promoter"), fii: row("fii"), dii: row("dii") };
  const at = (r: { values: string[] } | null, i: number): number | null => {
    if (!r) return null;
    const j = i - (periods.length - r.values.length); // right-align to periods
    return j >= 0 ? parseHolding(r.values[j]) : null;
  };

  const out: OwnershipObservation[] = [];
  for (let i = 0; i < periods.length; i++) {
    out.push({ period: periods[i], promoter: at(holders.promoter, i), fii: at(holders.fii, i), dii: at(holders.dii, i) });
  }
  return out.slice(-12);
}

export function extractOwnership(company: ScreenerInCompany, now = Date.now()): IndiaOwnership {
  const periods = company.shareholdingPeriods ?? [];
  const [, promoterPrev] = lastTwo(company, "promoter");
  const [, fiiPrev] = lastTwo(company, "fii");
  const [, diiPrev] = lastTwo(company, "dii");
  return {
    symbol: base(company.symbol),
    period: periods.at(-1) ?? null,
    promoterHolding: getPromoterHolding(company),
    fiiHolding: getFIIHolding(company),
    diiHolding: getDIIHolding(company),
    prevPeriod: periods.length >= 2 ? periods.at(-2) ?? null : null,
    promoterPrev,
    fiiPrev,
    diiPrev,
    history: buildHistory(company),
    v: EXTRACT_VERSION,
    roe: company.roe,
    roce: company.roce,
    basis: company.basis,
    fetchedAt: now,
  };
}

function extractKey(sym: string): string {
  return cacheKey("indiaOwnership", { symbol: sym });
}

/**
 * Read-only lookup — never fetches. Prefers a live screenerIn cache row
 * (a recent research visit) and refreshes the long-lived extract from it.
 */
export function readIndiaOwnership(symbol: string): IndiaOwnership | null {
  const sym = base(symbol);

  const full = readCache<ScreenerInCompany>(
    cacheKey("screenerIn", { symbol: sym, parser: SCREENER_IN_PARSER_VERSION }),
  );
  if (full) {
    const extract = extractOwnership(full.value, full.meta.fetchedAt);
    const stored = readCache<IndiaOwnership>(extractKey(sym));
    // Rewrite when newer OR when the stored extract predates the current
    // derivation version — the cached full row upgrades it for free.
    if (!stored || stored.value.fetchedAt < extract.fetchedAt || stored.value.v !== EXTRACT_VERSION) {
      writeCache("indiaOwnership", extractKey(sym), extract, sym);
    }
    return extract;
  }

  return readCache<IndiaOwnership>(extractKey(sym))?.value ?? null;
}

/* -------------------------------------------------------------------------- */
/* Bounded background trickle                                                 */
/* -------------------------------------------------------------------------- */

let trickleRunning = false;
let lastTrickleAt = 0;

/**
 * Fill missing extracts for up to TRICKLE_BATCH of the given symbols
 * (assumed pre-sorted by importance — the universe is market-cap ordered).
 * Fire-and-forget; concurrent calls and rapid re-triggers are no-ops.
 */
export function trickleEnrichIndiaOwnership(symbols: string[]): void {
  if (trickleRunning || Date.now() - lastTrickleAt < TRICKLE_MIN_INTERVAL_MS) return;

  // Missing entirely, written by an older derivation version, or served
  // stale-while-revalidate past the 7d TTL — the trickle is the "kick a
  // background refresh" the SWR contract expects.
  const staleBefore = Date.now() - 7 * 24 * 3_600_000;
  const missing = symbols
    .map(base)
    .filter((s) => {
      const own = readIndiaOwnership(s);
      return own == null || own.v !== EXTRACT_VERSION || own.fetchedAt < staleBefore;
    })
    .slice(0, TRICKLE_BATCH);
  if (missing.length === 0) return;

  trickleRunning = true;
  lastTrickleAt = Date.now();

  void (async () => {
    try {
      for (const sym of missing) {
        // getScreenerInCompany caches the full row; the extract write happens
        // in readIndiaOwnership on the next screen. Write it eagerly anyway so
        // coverage survives the full row's shorter TTL.
        const company = await getScreenerInCompany(sym).catch(() => null);
        if (company) writeCache("indiaOwnership", extractKey(sym), extractOwnership(company), sym);
        await new Promise((r) => setTimeout(r, TRICKLE_GAP_MS));
      }
    } finally {
      trickleRunning = false;
    }
  })();
}

/** Coverage census for diagnostics/tests. */
export function indiaOwnershipCoverage(symbols: string[]): { total: number; covered: number } {
  const covered = symbols.filter((s) => readIndiaOwnership(s) != null).length;
  return { total: symbols.length, covered };
}

/* -------------------------------------------------------------------------- */
/* QoQ derivations                                                            */
/* -------------------------------------------------------------------------- */

export interface OwnershipQoQ {
  /** Percentage-POINT changes vs the previous disclosed quarter (e.g. +1.4
   * means 50.1% → 51.5%), null when either side is undisclosed. */
  promoterChangeQoQ: number | null;
  fiiChangeQoQ: number | null;
  diiChangeQoQ: number | null;
}

function ppChange(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null) return null;
  return Number((curr - prev).toFixed(2));
}

/** Percentage-point QoQ deltas from an extract — deterministic, no fetches. */
export function ownershipQoQ(own: IndiaOwnership | null): OwnershipQoQ {
  return {
    promoterChangeQoQ: ppChange(own?.promoterHolding ?? null, own?.promoterPrev ?? null),
    fiiChangeQoQ: ppChange(own?.fiiHolding ?? null, own?.fiiPrev ?? null),
    diiChangeQoQ: ppChange(own?.diiHolding ?? null, own?.diiPrev ?? null),
  };
}

/* -------------------------------------------------------------------------- */
/* Multi-quarter trend derivations                                            */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic multi-quarter trends from a stored extract. The math lives in
 * lib/india-ownership-trends.ts (client-safe, dependency-free) so the
 * screener, Research Hub, Results Radar and notifications all share ONE
 * implementation of streaks / 4Q changes / missing-data handling.
 */
export function ownershipTrends(own: IndiaOwnership | null): OwnershipTrends {
  return trendsFromHistory(own?.history);
}
