/**
 * Scanner v2 — sector impact analysis.
 *
 * Given classified, causally-enriched events, derives sector-level
 * directional signals with strength scores. Combines:
 *   - AI analysis of the event set
 *   - Live sector ETF performance from signals.ts
 *   - Causal chain sector mentions across all events
 */

import { describeError, scannerPrompt, type ScanRunContext } from "./llm";
import { extractJsonObject } from "../json-extract";
import type { MarketEvent, SectorImpact, SignalDirection } from "../types";
import type { SectorPerformance } from "./signals";
import { SECTOR_ETF_MAP } from "../sector-rotation";
import { GICS_SECTORS, canonicalizeSector } from "../gics-sectors";

import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
interface RawSectorImpact {
  sector: string;
  direction: SignalDirection;
  strength: number;
  rationale: string;
  keyBeneficiaries: string[];
  keyLosers: string[];
}

function sanitizeSectorImpact(item: unknown): RawSectorImpact | null {
  if (item === null || typeof item !== "object") return null;
  const s = item as Record<string, unknown>;
  if (typeof s.sector !== "string" || typeof s.rationale !== "string") return null;
  const direction = typeof s.direction === "string" ? s.direction.toLowerCase() : "";
  const strength = Number(s.strength);
  return {
    sector: s.sector,
    direction: (["bullish", "bearish", "neutral"] as string[]).includes(direction)
      ? (direction as SignalDirection)
      : "neutral",
    strength: Number.isFinite(strength) ? strength : 0,
    rationale: s.rationale,
    keyBeneficiaries: Array.isArray(s.keyBeneficiaries)
      ? s.keyBeneficiaries.filter((x): x is string => typeof x === "string")
      : [],
    keyLosers: Array.isArray(s.keyLosers)
      ? s.keyLosers.filter((x): x is string => typeof x === "string")
      : [],
  };
}

/**
 * Sector names are constrained to the canonical GICS-11 vocabulary at
 * generation time (the prompt lists the allowed names) and enforced at parse
 * time: an off-vocabulary label is re-mapped via lib/gics-sectors.ts's legacy
 * table when possible, otherwise the impact row is rejected. Both outcomes
 * are logged — an open-vocabulary label that silently passes through is how
 * the sector join to the price panel drifts.
 */
function enforceGicsSector(raw: RawSectorImpact): RawSectorImpact | null {
  if (GICS_SECTORS.includes(raw.sector)) return raw;
  const canonical = canonicalizeSector(raw.sector);
  if (canonical) {
    console.warn(`[sector-impact] re-mapped off-vocabulary sector "${raw.sector}" → "${canonical}"`);
    return { ...raw, sector: canonical };
  }
  console.warn(`[sector-impact] rejected impact with unmappable sector "${raw.sector}"`);
  return null;
}

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
- sector: EXACTLY one of these 11 names, spelled exactly as written: ${GICS_SECTORS.join(" | ")}. Fold sub-industries into their sector (e.g. banking → Financials, pharma → Healthcare, telecom → Communication Services). Any other sector name will be discarded.
- direction: bullish | bearish | neutral
- strength: 0-100 (how strong the signal is — 80+ = very significant, 40-79 = moderate, below 40 = minor)
- rationale: specific explanation of how the events impact this sector (2 sentences max)
- keyBeneficiaries: 2-3 generic company archetypes that benefit (not tickers)
- keyLosers: 2-3 generic company archetypes that lose

Only include sectors where you can make a specific, event-driven argument. Exclude sectors with no clear signal.

${JSON_SCHEMA_LEAD_IN}
{
  "sectorImpacts": [
    {
      "sector": "Financials",
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
  run?: ScanRunContext,
): Promise<SectorImpact[]> {
  if (events.length === 0) return [];

  let sectorImpacts: RawSectorImpact[];
  try {
    const raw = await scannerPrompt(
      run,
      "opportunity-engine",
      buildSectorImpactPrompt(events, sectorPerf),
      { maxTokens: 2500 },
    );
    const parsed = extractJsonObject(raw, { sectorImpacts: [] as unknown[] });
    sectorImpacts = parsed.sectorImpacts
      .map(sanitizeSectorImpact)
      .filter((s): s is RawSectorImpact => s !== null)
      .map(enforceGicsSector)
      .filter((s): s is RawSectorImpact => s !== null);
  } catch (err) {
    if (run?.signal?.aborted) throw err;
    run?.degrade?.(`sector impact analysis skipped: ${describeError(err)}`);
    return [];
  }

  if (sectorImpacts.length === 0) return [];

  // Map driving event IDs per sector via affectedSectors cross-reference.
  // Classifier output is open-vocabulary, so keys are canonicalized to the
  // same GICS names the impacts now carry — "Banking" events still drive the
  // "Financials" impact.
  const sectorEventIds = new Map<string, string[]>();
  const addEventSector = (sector: string, eventId: string) => {
    const canonical = canonicalizeSector(sector) ?? sector;
    const existing = sectorEventIds.get(canonical) ?? [];
    if (!existing.includes(eventId)) sectorEventIds.set(canonical, [...existing, eventId]);
  };
  for (const event of events) {
    for (const sector of event.affectedSectors) addEventSector(sector, event.id);
    // Also include sectors mentioned in causal chains
    for (const effect of event.causalChain) {
      for (const sector of effect.affectedSectors) addEventSector(sector, event.id);
    }
  }

  return sectorImpacts.map((raw) => ({
    sector: raw.sector,
    etfTicker: SECTOR_ETF_MAP[raw.sector] ?? null,
    direction: raw.direction,
    strength: Math.max(0, Math.min(100, raw.strength)),
    rationale: raw.rationale,
    keyBeneficiaries: raw.keyBeneficiaries,
    keyLosers: raw.keyLosers,
    drivingEvents: sectorEventIds.get(raw.sector) ?? [],
  }));
}
