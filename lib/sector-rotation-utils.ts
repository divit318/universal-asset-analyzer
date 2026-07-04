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

/** Look up a single sector's current rotation entry, e.g. for portfolio holding context. */
export function findSectorRotationEntry(
  snapshot: SectorRotationSnapshot | null | undefined,
  sector: string | null | undefined,
): SectorRotationEntry | null {
  if (!snapshot || !sector) return null;
  return snapshot.sectors.find((s) => s.sector === sector) ?? null;
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
