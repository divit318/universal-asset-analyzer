/**
 * Sector Rotation Engine.
 *
 * Tracks relative strength and capital rotation across the 11 GICS sector
 * ETFs over multiple lookback windows, using price history already available
 * via lib/yahoo.ts. Deterministic core only — relative strength, ranking,
 * and leadership-change detection are pure functions, testable like
 * lib/composite.ts. The "why is this rotation happening" narrative is
 * delegated to lib/movement-explainer.ts, not computed here.
 *
 * This is the single source of truth for sector ETF tickers: lib/scanner/
 * modules import SECTOR_ETF_MAP from here instead of keeping their own copy.
 */

import { getHistory } from "./yahoo";
import { getLatestSectorRotationSnapshots, putSectorRotationSnapshot } from "./db";
import { findSectorRotationEntry, sectorRotationEntryFor, deriveRotationSummary } from "./sector-rotation-utils";
import type {
  HistoryPoint,
  RotationWindow,
  RotationClass,
  SectorRotationEntry,
  SectorRotationSnapshot,
} from "./types";

export type { RotationWindow, RotationClass, SectorRotationEntry, SectorRotationSnapshot };
// Re-exported so existing callers of lib/sector-rotation.ts don't need to
// change their import path — see lib/sector-rotation-utils.ts for why the
// implementation lives in a separate zero-I/O module.
export { findSectorRotationEntry, sectorRotationEntryFor };

export interface SectorEtf {
  ticker: string;
  sector: string;
}

export const SECTOR_ETFS: SectorEtf[] = [
  { ticker: "XLK", sector: "Technology" },
  { ticker: "XLF", sector: "Financials" },
  { ticker: "XLE", sector: "Energy" },
  { ticker: "XLV", sector: "Healthcare" },
  { ticker: "XLI", sector: "Industrials" },
  { ticker: "XLY", sector: "Consumer Cyclical" },
  { ticker: "XLP", sector: "Consumer Staples" },
  { ticker: "XLU", sector: "Utilities" },
  { ticker: "XLRE", sector: "Real Estate" },
  { ticker: "XLB", sector: "Materials" },
  { ticker: "XLC", sector: "Communication Services" },
];

/** Sector name -> ETF ticker. Canonical map; other modules should import this, not duplicate it. */
export const SECTOR_ETF_MAP: Record<string, string> = Object.fromEntries(
  SECTOR_ETFS.map((e) => [e.sector, e.ticker]),
);

const WINDOW_DAYS: Record<RotationWindow, number> = {
  "1w": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
};

const PRIMARY_WINDOW: RotationWindow = "1m";

/** Percent return from the earliest point on/after `days` ago through the latest point. */
function pctReturn(history: HistoryPoint[], days: number): number | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const cutoff = new Date(last.date);
  cutoff.setDate(cutoff.getDate() - days);
  const start = history.find((p) => new Date(p.date) >= cutoff) ?? history[0];
  if (!start || start.close === 0) return null;
  return ((last.close - start.close) / start.close) * 100;
}

/** Pure: compute per-window returns for each sector from already-fetched history. */
export function computeSectorReturns(
  historyBySector: Map<string, HistoryPoint[]>,
): Map<string, Record<RotationWindow, number | null>> {
  const out = new Map<string, Record<RotationWindow, number | null>>();
  for (const [sector, history] of historyBySector) {
    out.set(sector, {
      "1w": pctReturn(history, WINDOW_DAYS["1w"]),
      "1m": pctReturn(history, WINDOW_DAYS["1m"]),
      "3m": pctReturn(history, WINDOW_DAYS["3m"]),
      "6m": pctReturn(history, WINDOW_DAYS["6m"]),
    });
  }
  return out;
}

/** RRG-style quadrant classification: strength (vs. peers) x momentum (accelerating vs. decelerating). */
function classify(relativeStrength: number, momentum: number): RotationClass {
  if (relativeStrength >= 0) return momentum >= 0 ? "leading" : "weakening";
  return momentum >= 0 ? "strengthening" : "lagging";
}

/**
 * Pure: build a rotation snapshot from per-sector returns and (optionally) the
 * prior snapshot's entries, keyed by sector name, for rank-change/momentum.
 */
export function buildSectorRotationSnapshot(
  asOf: string,
  returnsBySector: Map<string, Record<RotationWindow, number | null>>,
  previous: SectorRotationEntry[] | null,
): SectorRotationSnapshot {
  const previousBySector = new Map((previous ?? []).map((e) => [e.sector, e]));

  const primaryReturns = [...returnsBySector.values()]
    .map((r) => r[PRIMARY_WINDOW])
    .filter((v): v is number => v != null);
  const avgReturn =
    primaryReturns.length > 0
      ? primaryReturns.reduce((a, b) => a + b, 0) / primaryReturns.length
      : 0;

  const unranked = [...returnsBySector.entries()].map(([sector, returns]) => {
    const primary = returns[PRIMARY_WINDOW];
    const relativeStrength = primary != null ? primary - avgReturn : 0;
    const prior = previousBySector.get(sector);
    const momentum =
      prior != null
        ? relativeStrength - prior.relativeStrength
        : (returns["1w"] ?? 0) - (returns["3m"] ?? 0) / 4; // proxy: short-window pace vs. long-window pace when no history

    return {
      sector,
      etfTicker: SECTOR_ETF_MAP[sector] ?? "",
      returns,
      relativeStrength: Math.round(relativeStrength * 100) / 100,
      momentum: Math.round(momentum * 100) / 100,
      priorRank: prior?.rank ?? null,
    };
  });

  const ranked = [...unranked].sort((a, b) => b.relativeStrength - a.relativeStrength);

  const sectors: SectorRotationEntry[] = ranked.map((entry, idx) => {
    const rank = idx + 1;
    const rankChange = entry.priorRank != null ? entry.priorRank - rank : null;
    return {
      sector: entry.sector,
      etfTicker: entry.etfTicker,
      returns: entry.returns,
      relativeStrength: entry.relativeStrength,
      momentum: entry.momentum,
      rank,
      rankChange,
      classification: classify(entry.relativeStrength, entry.momentum),
    };
  });

  return {
    asOf,
    primaryWindow: PRIMARY_WINDOW,
    sectors,
    ...deriveRotationSummary(sectors),
  };
}

/**
 * Fetch live sector ETF history, compute today's rotation snapshot against
 * the most recently persisted snapshot, and persist the new one.
 * Best-effort: sectors whose history fetch fails are simply excluded.
 */
export async function computeSectorRotation(): Promise<SectorRotationSnapshot> {
  const today = new Date().toISOString().slice(0, 10);

  const histories = await Promise.all(
    SECTOR_ETFS.map(async (e) => ({
      sector: e.sector,
      history: await getHistory(e.ticker, WINDOW_DAYS["6m"] + 10),
    })),
  );
  const historyBySector = new Map(
    histories.filter((h) => h.history.length > 0).map((h) => [h.sector, h.history]),
  );

  const returnsBySector = computeSectorReturns(historyBySector);

  const priorSnapshots = getLatestSectorRotationSnapshots(2);
  const previous =
    priorSnapshots.find((s) => s.asOf !== today)?.sectors ?? null;

  const snapshot = buildSectorRotationSnapshot(today, returnsBySector, previous);
  putSectorRotationSnapshot(snapshot.asOf, snapshot.sectors);
  return snapshot;
}

/** Get the most recently persisted snapshot without recomputing (cheap, for pages that just need to read). */
export function getLatestSectorRotation(): SectorRotationSnapshot | null {
  const [latest] = getLatestSectorRotationSnapshots(1);
  if (!latest) return null;
  const sectors = latest.sectors;
  return {
    asOf: latest.asOf,
    primaryWindow: PRIMARY_WINDOW,
    sectors,
    ...deriveRotationSummary(sectors),
  };
}
