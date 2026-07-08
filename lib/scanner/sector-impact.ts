/**
 * Scanner v2 — sector impact analysis.
 *
 * Given classified, causally-enriched events, derives sector-level
 * directional signals with strength scores. Combines:
 *   - AI analysis of the event set
 *   - Live sector ETF performance from signals.ts
 *   - Causal chain sector mentions across all events
 */

import { runPrompt } from "../ai";
import { extractJson } from "../json-extract";
import type { MarketEvent, SectorImpact, SignalDirection } from "../types";
import type { SectorPerformance } from "./signals";
import { SECTOR_ETF_MAP as CANONICAL_SECTOR_ETF_MAP } from "../sector-rotation";

interface RawSectorImpact {
  sector: string;
  direction: SignalDirection;
  strength: number;
  rationale: string;
  keyBeneficiaries: string[];
  keyLosers: string[];
}

interface SectorImpactResponse {
  sectorImpacts: RawSectorImpact[];
}

// India-specific sector names have no direct GICS ETF equivalent; map them to
// the closest US sector ETF for live price context. Merged with the canonical
// map from lib/sector-rotation.ts (single source of truth for GICS sectors).
const SECTOR_ETF_MAP: Record<string, string> = {
  ...CANONICAL_SECTOR_ETF_MAP,
  "Banking":        "XLF",
  "IT Services":    "XLK",
  "Pharma":         "XLV",
  "Auto":           "XLY",
  "FMCG":           "XLP",
  "Infrastructure": "XLI",
  "Power":          "XLU",
  "Metals":         "XLB",
  "Telecom":        "XLC",
};

function buildSectorImpactPrompt(
  events: MarketEvent[],
  sectorPerf: SectorPerformance[],
): string {
  const eventSummary = events
    .slice(0, 15)
    .map(
      (e) =>
        `[${e.category.toUpperCase()}] ${e.headline}\n  → ${e.summary}\n  → Causal effects: ${
          e.causalChain.length > 0
            ? e.causalChain.map((c) => `(${c.order}st/nd) ${c.description}`).join("; ")
            : "none analyzed"
        }`,
    )
    .join("\n\n");

  const perfContext = sectorPerf
    .filter((s) => s.changePercent != null)
    .map(
      (s) =>
        `${s.sector}: ${s.changePercent! >= 0 ? "+" : ""}${s.changePercent!.toFixed(2)}% today`,
    )
    .join(", ");

  return `You are a sector analyst at a top-tier institutional investment firm.

TODAY'S MARKET EVENTS:
${eventSummary}

LIVE SECTOR PERFORMANCE (today):
${perfContext || "Not available"}

Based on the events and their causal effects, assess the investment impact on each affected sector.

For each sector with a clear signal, provide:
- direction: bullish | bearish | neutral
- strength: 0-100 (how strong the signal is — 80+ = very significant, 40-79 = moderate, below 40 = minor)
- rationale: specific explanation of how the events impact this sector (2 sentences max)
- keyBeneficiaries: 2-3 generic company archetypes that benefit (not tickers)
- keyLosers: 2-3 generic company archetypes that lose

Only include sectors where you can make a specific, event-driven argument. Exclude sectors with no clear signal.

Return ONLY valid JSON:
{
  "sectorImpacts": [
    {
      "sector": "Banking",
      "direction": "bearish",
      "strength": 65,
      "rationale": "RBI rate cut compresses net interest margins for banks as they reprice deposits slower than loans. Weaker NIM guidance expected in next earnings cycle.",
      "keyBeneficiaries": [],
      "keyLosers": ["Large PSU banks", "Housing finance companies with variable-rate books"]
    }
  ]
}`;
}

/** Analyze sector-level impact from a set of classified, enriched events. */
export async function analyzeSectorImpacts(
  events: MarketEvent[],
  sectorPerf: SectorPerformance[],
): Promise<SectorImpact[]> {
  if (events.length === 0) return [];

  let parsed: SectorImpactResponse | null = null;
  try {
    const raw = await runPrompt(
      "opportunity-engine",
      buildSectorImpactPrompt(events, sectorPerf),
      { maxTokens: 2500, json: true },
    );
    parsed = extractJson<SectorImpactResponse>(raw);
  } catch {
    return [];
  }

  if (!parsed?.sectorImpacts?.length) return [];

  // Map driving event IDs per sector via affectedSectors cross-reference
  const sectorEventIds = new Map<string, string[]>();
  for (const event of events) {
    for (const sector of event.affectedSectors) {
      const existing = sectorEventIds.get(sector) ?? [];
      sectorEventIds.set(sector, [...existing, event.id]);
    }
    // Also include sectors mentioned in causal chains
    for (const effect of event.causalChain) {
      for (const sector of effect.affectedSectors) {
        const existing = sectorEventIds.get(sector) ?? [];
        sectorEventIds.set(sector, [...existing, event.id]);
      }
    }
  }

  return parsed.sectorImpacts.map((raw) => ({
    sector: raw.sector,
    etfTicker: SECTOR_ETF_MAP[raw.sector] ?? null,
    direction: raw.direction,
    strength: Math.max(0, Math.min(100, raw.strength)),
    rationale: raw.rationale,
    keyBeneficiaries: raw.keyBeneficiaries ?? [],
    keyLosers: raw.keyLosers ?? [],
    drivingEvents: sectorEventIds.get(raw.sector) ?? [],
  }));
}
