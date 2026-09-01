/**
 * Pure Sector Rotation helpers with zero I/O.
 *
 * Split out of lib/sector-rotation.ts, which statically imports lib/db.ts
 * (node:sqlite, server-only) and lib/yahoo.ts. Dual-use files like
 * lib/portfolio-analytics.ts — imported by both server routes and client
 * components for their exported types/constants — must never pull in a
 * db.ts-reaching import, or the client bundle breaks (see ARCHITECTURE.md,
 * "Watchlist Intelligence" section, for the incident this fixed).
 *
 * lib/sector-rotation.ts re-exports findSectorRotationEntry from here so
 * existing callers (lib/movement-explainer.ts, lib/scanner/opportunity-scorer.ts)
 * don't need to change their import path.
 */

import type { SectorRotationSnapshot, SectorRotationEntry } from "./types";
import { detectMarket } from "./market";

/** Look up a single sector's current rotation entry, e.g. for portfolio holding context. */
export function findSectorRotationEntry(
  snapshot: SectorRotationSnapshot | null | undefined,
  sector: string | null | undefined,
): SectorRotationEntry | null {
  if (!snapshot || !sector) return null;
  return snapshot.sectors.find((s) => s.sector === sector) ?? null;
}

/**
 * The rotation entry a specific LISTING may use — null for anything not
 * US-listed.
 *
 * The whole rotation snapshot is computed from the 11 US SPDR sector ETFs
 * (SECTOR_ETFS in lib/sector-rotation.ts) and entries are keyed by sector
 * name alone, so before this gate existed TCS.NS inherited XLK's momentum
 * and POLYCAB.NS inherited XLI's — a US signal scoring an Indian stock
 * (Phase 2 audit, CRITICAL). Every symbol-scoped consumer must use this
 * instead of findSectorRotationEntry; no NIFTY-sector rotation exists yet,
 * so for non-US listings the honest answer is "no reading", not a proxy.
 */
export function sectorRotationEntryFor(
  symbol: string,
  snapshot: SectorRotationSnapshot | null | undefined,
  sector: string | null | undefined,
): SectorRotationEntry | null {
  const market = detectMarket({ symbol, currency: "", exchange: null, assetType: null });
  if (market !== "US") return null;
  return findSectorRotationEntry(snapshot, sector);
}

/**
 * Derive leaders/laggards/leadershipChanges from a ranked sectors array.
 * Shared by lib/sector-rotation.ts's buildSectorRotationSnapshot() (fresh
 * computation) and getLatestSectorRotation() (reading a persisted snapshot)
 * so the two paths can never drift out of sync.
 */
export function deriveRotationSummary(
  sectors: SectorRotationEntry[],
): Pick<SectorRotationSnapshot, "leaders" | "laggards" | "leadershipChanges"> {
  return {
    leaders: sectors.slice(0, 3).map((s) => s.sector),
    laggards: sectors.slice(-3).map((s) => s.sector).reverse(),
    leadershipChanges: sectors
      .filter((s) => s.rankChange != null && Math.abs(s.rankChange) >= 2)
      .map((s) => ({ sector: s.sector, fromRank: s.rank - (s.rankChange ?? 0), toRank: s.rank })),
  };
}
