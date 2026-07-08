/**
 * Scanner v2 — company impact analysis.
 *
 * Maps sector-level signals to specific companies using the screener DB.
 * For each sector with a strong directional signal (strength >= 45),
 * queries the fundamentals cache and asks the AI which companies are most
 * exposed to the identified catalysts/risks.
 *
 * Returns ScannerOpportunity candidates (pre-scoring) for the fundamental
 * gate and opportunity scorer to process.
 */

import { runPrompt } from "../ai";
import { extractJson } from "../json-extract";
import { getFreshFundamentals } from "../db";
import type {
  MarketEvent,
  SectorImpact,
  ScannerOpportunity,
  SignalDirection,
  SignalTimeframe,
  SignalCategory,
} from "../types";

interface CompanyMatchRaw {
  symbol: string;
  direction: SignalDirection;
  rationale: string;
  timeframe: SignalTimeframe;
  confidence: number; // 0-100
}

interface CompanyMatchResponse {
  matches: CompanyMatchRaw[];
}

function buildCompanyMatchPrompt(
  sector: SectorImpact,
  drivingEvents: MarketEvent[],
  companies: { symbol: string; name: string; sector: string | null; industry: string | null }[],
): string {
  const eventContext = drivingEvents
    .map((e) => `• ${e.headline} — ${e.summary}`)
    .join("\n");

  const companyList = companies
    .slice(0, 200)
    .map((c) => `${c.symbol} | ${c.name} | ${c.industry ?? c.sector ?? ""}`)
    .join("\n");

  return `You are a sector equity analyst. The following market events are driving a ${sector.direction.toUpperCase()} signal for the ${sector.sector} sector (strength: ${sector.strength}/100).

DRIVING EVENTS:
${eventContext}

SECTOR ANALYSIS: ${sector.rationale}

COMPANIES IN THIS SECTOR (symbol | name | industry):
${companyList}

Identify the 3-8 companies MOST exposed to these specific catalysts.
For each company, explain exactly why — reference the specific event or mechanism.
Assign:
- direction: bullish or bearish (based on event impact on this specific company)
- rationale: one specific sentence linking the event to this company's business model
- timeframe: short (days-weeks) | medium (weeks-months) | long (months-years)
- confidence: 0-100 (how confident are you this company is meaningfully impacted)

Only include companies where the link is specific and clear. Do not include companies just because they're in the sector.

Return ONLY valid JSON:
{
  "matches": [
    {
      "symbol": "HDFCBANK",
      "direction": "bearish",
      "rationale": "HDFC Bank's NIM will compress as RBI rate cut forces loan repricing ahead of deposit rate adjustments.",
      "timeframe": "medium",
      "confidence": 78
    }
  ]
}`;
}

function uid(): string {
  return crypto.randomUUID();
}

/** Build ScannerOpportunity candidates from sector impacts + screener DB. */
export async function buildCompanyOpportunities(
  events: MarketEvent[],
  sectorImpacts: SectorImpact[],
): Promise<ScannerOpportunity[]> {
  // Load screener DB (7-day cache OK — we just need sector/industry for filtering)
  const { rows: dbRows } = getFreshFundamentals(7 * 24 * 60 * 60 * 1000);
  if (dbRows.length === 0) return [];

  // Build sector → companies map
  const sectorCompanyMap = new Map<
    string,
    { symbol: string; name: string; sector: string | null; industry: string | null }[]
  >();
  for (const row of dbRows) {
    const sectorKey = row.sector ?? "Unknown";
    const existing = sectorCompanyMap.get(sectorKey) ?? [];
    sectorCompanyMap.set(sectorKey, [
      ...existing,
      { symbol: row.symbol, name: row.name, sector: row.sector, industry: row.industry },
    ]);
  }

  // Also build a flat symbol→fundamentals map for the opportunity objects
  const fundamentalsMap = new Map(dbRows.map((r) => [r.symbol, r]));

  // Filter to sectors with meaningful signals
  const significantSectors = sectorImpacts.filter((s) => s.strength >= 45);

  if (significantSectors.length === 0) return [];

  const allOpportunities: ScannerOpportunity[] = [];
  const seen = new Set<string>(); // deduplicate by ticker

  // Process sectors with meaningful signals (up to 6 to control Ollama calls)
  const toProcess = significantSectors.slice(0, 6);

  const results = await Promise.allSettled(
    toProcess.map(async (sector) => {
      // Find companies in this sector (and related sector names)
      const sectorVariants = getSectorVariants(sector.sector);
      const sectorCompanies: { symbol: string; name: string; sector: string | null; industry: string | null }[] = [];
      for (const variant of sectorVariants) {
        const companies = sectorCompanyMap.get(variant) ?? [];
        sectorCompanies.push(...companies);
      }

      if (sectorCompanies.length === 0) return [];

      // Get driving events for this sector
      const drivingEvents = events.filter((e) =>
        sector.drivingEvents.includes(e.id),
      );
      if (drivingEvents.length === 0) return [];

      let parsed: CompanyMatchResponse | null = null;
      try {
        const raw = await runPrompt(
          "opportunity-engine",
          buildCompanyMatchPrompt(sector, drivingEvents, sectorCompanies),
          { maxTokens: 1500, json: true },
        );
        parsed = extractJson<CompanyMatchResponse>(raw);
      } catch {
        return [];
      }

      if (!parsed?.matches?.length) return [];

      const opportunities: ScannerOpportunity[] = [];
      for (const match of parsed.matches) {
        if (seen.has(match.symbol)) continue;
        seen.add(match.symbol);

        const fund = fundamentalsMap.get(match.symbol);
        const isIndian =
          match.symbol.endsWith(".NS") ||
          match.symbol.endsWith(".BO") ||
          (fund?.exchange === "NSE" || fund?.exchange === "BSE");

        // Determine category from driving events
        const primaryCategory: SignalCategory =
          drivingEvents[0]?.category ?? "company";

        // Find main theme from driving events
        const themes = drivingEvents.flatMap((e) => e.affectedThemes);
        const theme = themes[0] ?? sector.sector;

        opportunities.push({
          id: uid(),
          ticker: match.symbol,
          name: fund?.name ?? match.symbol,
          isIndian,
          direction: match.direction,
          theme,
          category: primaryCategory,
          rationale: match.rationale,
          timeframe: match.timeframe,
          quote: null, // enriched later by fundamental-gate
          compositeScores: null, // enriched by fundamental-gate
          opportunityScore: {
            catalystStrength: sector.strength,
            fundamentalQuality: 0,  // set by fundamental-gate
            valuation: 0,           // set by fundamental-gate
            momentum: 0,            // set by fundamental-gate
            composite: 0,           // computed by opportunity-scorer
            verdict: "weak",        // finalized by opportunity-scorer
          },
          thesis: null, // generated by thesis-builder for high-conviction
          sourceEventIds: sector.drivingEvents,
          dividendYieldPct: null, // set by fundamental-gate
          profile: null,          // set by opportunity-scorer
        });
      }
      return opportunities;
    }),
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      allOpportunities.push(...r.value);
    }
  }

  return allOpportunities;
}

// Maps UAA sector names to screener DB sector names (which may differ slightly)
function getSectorVariants(sector: string): string[] {
  const map: Record<string, string[]> = {
    "Banking":              ["Financial Services", "Banks", "Financials", "Banking"],
    "Financials":           ["Financial Services", "Financials", "Banks", "Banking"],
    "IT Services":          ["Technology", "IT Services", "Information Technology"],
    "Technology":           ["Technology", "IT Services", "Information Technology"],
    "Pharma":               ["Healthcare", "Pharma", "Biotechnology", "Drug Manufacturers"],
    "Healthcare":           ["Healthcare", "Pharma", "Biotechnology"],
    "Auto":                 ["Consumer Cyclical", "Auto", "Automobiles", "Auto Parts"],
    "Consumer Cyclical":    ["Consumer Cyclical", "Auto", "Retail"],
    "FMCG":                 ["Consumer Staples", "FMCG", "Beverages", "Food Products"],
    "Consumer Staples":     ["Consumer Staples", "FMCG"],
    "Infrastructure":       ["Industrials", "Infrastructure", "Construction"],
    "Industrials":          ["Industrials", "Infrastructure", "Construction"],
    "Power":                ["Utilities", "Power", "Electric Utilities"],
    "Utilities":            ["Utilities", "Power"],
    "Metals":               ["Materials", "Metals & Mining", "Steel", "Metals"],
    "Materials":            ["Materials", "Metals & Mining", "Steel"],
    "Telecom":              ["Communication Services", "Telecom"],
    "Communication Services": ["Communication Services", "Telecom"],
    "Energy":               ["Energy", "Oil & Gas"],
    "Real Estate":          ["Real Estate", "REIT"],
  };
  return map[sector] ?? [sector];
}
