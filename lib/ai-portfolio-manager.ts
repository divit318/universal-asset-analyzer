/**
 * AI Portfolio Manager — shared evidence layer.
 *
 * Both the CIO audit memo (/api/portfolio/audit) and the daily brief
 * (/api/ai/portfolio-brief) independently need the same two evidence
 * sources — Sector Rotation and Watchlist Intelligence — woven into their
 * prompts. This file is the single source of truth for gathering and
 * formatting that evidence, so the two routes cannot drift out of sync.
 *
 * Gathering is server-only (reads lib/db.ts via lib/sector-rotation.ts and
 * lib/ai-watchlist.ts); formatting is pure and independently testable
 * without any I/O — see tests/ai-portfolio-manager.test.ts.
 */

import { getLatestSectorRotation } from "./sector-rotation";
import { gatherWatchlistAlerts } from "./ai-watchlist";
import type { SectorRotationSnapshot, WatchlistAlert } from "./types";

export interface PortfolioManagerEvidence {
  rotation: SectorRotationSnapshot | null;
  watchlistAlerts: WatchlistAlert[];
}

/**
 * Gather Sector Rotation + Watchlist Intelligence evidence. Best-effort —
 * gatherWatchlistAlerts() never throws, and getLatestSectorRotation() is a
 * cheap synchronous read, so this itself never throws either.
 */
export async function gatherPortfolioManagerEvidence(
  watchlistAlertLimit = 3,
): Promise<PortfolioManagerEvidence> {
  const rotation = getLatestSectorRotation();
  const watchlistAlerts = await gatherWatchlistAlerts(undefined, { alertLimit: watchlistAlertLimit });
  return { rotation, watchlistAlerts };
}

/** Pure, testable: one-line summary of sector leadership. */
export function formatSectorRotationEvidence(rotation: SectorRotationSnapshot | null): string {
  if (!rotation) return "not available";
  return `Leaders: ${rotation.leaders.join(", ")}. Laggards: ${rotation.laggards.join(", ")}.`;
}

/** Pure, testable: one-line summary of the highest-priority watchlist alerts. */
export function formatWatchlistEvidence(alerts: WatchlistAlert[]): string {
  if (alerts.length === 0) return "no active watchlist alerts";
  return alerts.map((a) => `[${a.severity.toUpperCase()}] ${a.title}`).join("; ");
}

/**
 * Pure, testable: multi-line, labeled evidence block for the CIO audit memo
 * prompt (verbose institutional style — used by /api/portfolio/audit).
 */
export function buildAuditEvidenceBlock(evidence: PortfolioManagerEvidence): string {
  return [
    `SECTOR ROTATION (continuous relative-strength engine): ${formatSectorRotationEvidence(evidence.rotation)}`,
    `WATCHLIST INTELLIGENCE (top alerts from tracked-but-unheld symbols): ${formatWatchlistEvidence(evidence.watchlistAlerts)}`,
  ].join("\n");
}

/**
 * Pure, testable: short inline evidence suffix for the daily brief's compact
 * prompt (used by /api/ai/portfolio-brief). Omits a source entirely when
 * there's nothing to say, rather than printing "not available" — the brief
 * is meant to stay terse.
 */
export function buildBriefEvidenceSuffix(evidence: PortfolioManagerEvidence): string {
  const parts: string[] = [];
  if (evidence.rotation) {
    parts.push(`\nSECTOR ROTATION: ${formatSectorRotationEvidence(evidence.rotation)}`);
  }
  if (evidence.watchlistAlerts.length > 0) {
    parts.push(`\nWATCHLIST INTELLIGENCE: ${formatWatchlistEvidence(evidence.watchlistAlerts)}`);
  }
  return parts.join("");
}
