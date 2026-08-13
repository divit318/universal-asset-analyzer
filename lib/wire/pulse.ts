/**
 * Market Pulse — the Wire's Tier-1 data: live macro quotes, sector day moves,
 * breadth, and the deterministic regime read, with no LLM and no news fetch.
 *
 * Exists so the top of the Wire renders in ~a second, independent of the
 * multi-minute intelligence pipeline: quotes only, one Yahoo batch, cached
 * for PULSE_TTL_MS in-process. The scan's own regime (which also folds in
 * event themes) supersedes nothing here — this is the measured floor the
 * page always has, even when every AI stage is down.
 */

import {
  fetchMacroSignals,
  fetchSectorPerformance,
  computeMarketBreadth,
  type SectorPerformance,
} from "../scanner/signals";
import type { MacroSignal, MarketRegime } from "../types";
import { assessMarketRegime } from "../scanner";

export const PULSE_TTL_MS = 60_000;

export interface WirePulse {
  asOf: string; // ISO
  macroSignals: MacroSignal[];
  sectorPerf: SectorPerformance[];
  breadthPct: number | null;
  /** Deterministic regime from quotes alone (no events → no dominantThemes). */
  regime: MarketRegime;
}

let cache: { pulse: WirePulse; at: number } | null = null;

/** Build (or serve the ≤60s-old cached) pulse. Degrades to empty arrays, never throws. */
export async function getWirePulse(now: number = Date.now()): Promise<WirePulse> {
  if (cache && now - cache.at < PULSE_TTL_MS) return cache.pulse;

  const [macroSignals, sectorPerf] = await Promise.all([
    fetchMacroSignals().catch(() => [] as MacroSignal[]),
    fetchSectorPerformance().catch(() => [] as SectorPerformance[]),
  ]);

  const pulse: WirePulse = {
    asOf: new Date(now).toISOString(),
    macroSignals,
    sectorPerf,
    breadthPct: computeMarketBreadth(sectorPerf),
    regime: assessMarketRegime(macroSignals, sectorPerf, []),
  };
  // Only cache a pulse that actually carries data — an all-failed fetch
  // should be retried on the next request, not served for a minute.
  if (macroSignals.length > 0 || sectorPerf.length > 0) {
    cache = { pulse, at: now };
  }
  return pulse;
}

/** Test hook. */
export function __clearPulseCache(): void {
  cache = null;
}
