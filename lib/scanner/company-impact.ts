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

import { describeError, scannerPrompt, type ScanRunContext } from "./llm";
import { extractJsonObject } from "../json-extract";
import { getFreshFundamentals } from "../db";
import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
import { logPipeline } from "../debug-pipeline";
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

function sanitizeMatch(item: unknown): CompanyMatchRaw | null {
  if (item === null || typeof item !== "object") return null;
  const m = item as Record<string, unknown>;
  if (typeof m.symbol !== "string" || typeof m.rationale !== "string") return null;
  const direction = typeof m.direction === "string" ? m.direction.toLowerCase() : "";
  const timeframe = typeof m.timeframe === "string" ? m.timeframe.toLowerCase() : "";
  const confidence = Number(m.confidence);
  return {
    symbol: m.symbol,
    direction: direction === "bearish" ? "bearish" : "bullish",
    rationale: m.rationale,
    timeframe: (["short", "medium", "long"] as string[]).includes(timeframe)
      ? (timeframe as SignalTimeframe)
      : "medium",
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
  };
}

function buildCompanyMatchPrompt(
  sector: SectorImpact,
  drivingEvents: MarketEvent[],
  companies: { symbol: string; name: string; sector: string | null; industry: string | null }[],
): string {
  const eventContext = drivingEvents
    .map((e) => `• ${e.headline} — ${e.summary}`)
    .join("\n");

  // The model is asked for 3-8 names, so 40 well-known candidates are ample.
  // The old 200-row list cost real money for nothing: prompt eval measured at
  // ~40 tok/s on this class of host (2026-07-31), so ~1.6k extra tokens of
  // list was ~40s of pure prompt processing per sector — and pushed the
  // prompt past a small default context window besides. Callers pre-rank
  // by market cap so the cut keeps the names the model can actually reason
  // about.
  const companyList = companies
    .slice(0, 40)
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

${JSON_SCHEMA_LEAD_IN}
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
  run?: ScanRunContext,
): Promise<ScannerOpportunity[]> {
  // Load screener DB (7-day cache OK — we just need sector/industry for filtering)
  const { rows: dbRows } = getFreshFundamentals(7 * 24 * 60 * 60 * 1000);
  if (dbRows.length === 0) return [];

  // Build sector → companies map. Rows are pre-ranked by company size so the
  // prompt's 40-company cap (see buildCompanyMatchPrompt) keeps the largest,
  // most recognizable names. Cached fundamentals deliberately exclude market
  // cap (it lives in the live price layer), so EBITDA with cash-flow
  // fallbacks is the size proxy — banks report no EBITDA but do report OCF.
  const sizeOf = (r: (typeof dbRows)[number]) =>
    r.ebitda ?? r.operatingCashflow ?? r.freeCashflow ?? 0;
  const ranked = [...dbRows].sort((a, b) => sizeOf(b) - sizeOf(a));
  const sectorCompanyMap = new Map<
    string,
    { symbol: string; name: string; sector: string | null; industry: string | null }[]
  >();
  for (const row of ranked) {
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

  // Process sectors with meaningful signals (up to 6 to control AI calls).
  // Sequential — a policy from the serializing local backend,
  // so firing these concurrently would only queue them behind each other
  // while each one's own timeout keeps counting down.
  const toProcess = significantSectors.slice(0, 6);
  run?.setUnits?.(toProcess.length);

  for (const sector of toProcess) {
    run?.item?.(`${sector.sector} (${toProcess.indexOf(sector) + 1} of ${toProcess.length})`);
    // Find companies in this sector (and related sector names)
    const sectorVariants = getSectorVariants(sector.sector);
    const sectorCompanies: { symbol: string; name: string; sector: string | null; industry: string | null }[] = [];
    for (const variant of sectorVariants) {
      const companies = sectorCompanyMap.get(variant) ?? [];
      sectorCompanies.push(...companies);
    }

    if (sectorCompanies.length === 0) {
      run?.tick?.();
      continue;
    }

    // Get driving events for this sector
    const drivingEvents = events.filter((e) =>
      sector.drivingEvents.includes(e.id),
    );
    if (drivingEvents.length === 0) {
      run?.tick?.();
      continue;
    }

    let matches: CompanyMatchRaw[];
    const sectorStartedAt = Date.now();
    const prompt = buildCompanyMatchPrompt(sector, drivingEvents, sectorCompanies);
    logPipeline({
      type: "company_impact_sector_start",
      sector: sector.sector,
      sectorIndex: toProcess.indexOf(sector) + 1,
      sectorTotal: toProcess.length,
      companies: sectorCompanies.length,
      drivingEvents: drivingEvents.length,
      promptChars: prompt.length,
    });
    try {
      const raw = await scannerPrompt(run, "opportunity-engine", prompt, { maxTokens: 1500 });
      const parsed = extractJsonObject(raw, { matches: [] as unknown[] });
      matches = parsed.matches.map(sanitizeMatch).filter((m): m is CompanyMatchRaw => m !== null);
      logPipeline({
        type: "company_impact_sector_end",
        sector: sector.sector,
        durationMs: Date.now() - sectorStartedAt,
        rawChars: raw.length,
        matches: matches.length,
      });
      run?.tick?.();
    } catch (err) {
      if (run?.signal?.aborted) throw err;
      logPipeline({
        type: "company_impact_sector_error",
        sector: sector.sector,
        durationMs: Date.now() - sectorStartedAt,
        message: err instanceof Error ? err.message : String(err),
      });
      run?.degrade?.(`${sector.sector} opportunities skipped: ${describeError(err)}`);
      run?.tick?.();
      continue;
    }

    if (matches.length === 0) continue;

    for (const match of matches) {
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

      allOpportunities.push({
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
        // sanitizeMatch coerces a missing/invalid confidence to 0, which here
        // means "not stated", not "zero confidence" — store null so the
        // profile's fallback applies instead of rendering 0%.
        matchConfidence: match.confidence > 0 ? match.confidence : null,
        profile: null,          // set by opportunity-scorer
      });
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
