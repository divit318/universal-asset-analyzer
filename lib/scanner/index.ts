/**
 * Scanner v2 — main pipeline orchestrator.
 *
 * runScannerPipeline() executes the full multi-stage intelligence pipeline
 * and returns a ScannerResult. Accepts an optional onProgress callback for
 * streaming progress events to the API route.
 *
 * Pipeline:
 *   1. Signal Collection   — news + macro + sector data (parallel)
 *   2. Deduplication       — semantic story clustering
 *   3. Classification      — event categorization + sector/theme tagging
 *   4. Causal Reasoning    — first/second-order effects for macro events
 *   5. Theme Detection     — proactive emerging theme identification
 *   6. Sector Impact       — sector-level winner/loser analysis
 *   7. Company Impact      — company-specific opportunity candidates
 *   8. Fundamental Gate    — cross-reference screener DB + live quotes
 *   9. Opportunity Scoring — composite OpportunityScore per candidate
 *  10. Thesis Building     — InvestmentThesis for high-conviction opportunities
 *  11. Assembly            — package into ScannerResult
 */

import { fetchMarketNews } from "../news";
import {
  fetchMacroSignals,
  fetchSectorPerformance,
  computeMarketBreadth,
} from "./signals";
import { deduplicateIntoEvents } from "./dedup";
import { classifyEvents } from "./classifier";
import { buildCausalChains } from "./causal-engine";
import { analyzeSectorImpacts } from "./sector-impact";
import { buildCompanyOpportunities } from "./company-impact";
import { applyFundamentalGate } from "./fundamental-gate";
import { scoreOpportunities, segmentOpportunities, refreshProfileWithThesis } from "./opportunity-scorer";
import { buildTheses } from "./thesis-builder";
import { runPrompt } from "../ai";
import { extractJson } from "../json-extract";
import type {
  ScannerResult,
  ScannerProgressEvent,
  ScannerStage,
  MarketEvent,
  EmergingTheme,
  RiskAlert,
  MarketRegime,
} from "../types";

export interface ScannerPipelineOptions {
  query?: string;
  india?: boolean;
  global?: boolean;
  onProgress?: (event: ScannerProgressEvent) => void;
}

function emit(
  onProgress: ((e: ScannerProgressEvent) => void) | undefined,
  stage: ScannerStage,
  message: string,
  pct: number,
) {
  onProgress?.({ stage, message, pct });
}

/* -------------------------------------------------------------------------- */
/* Theme detection                                                             */
/* -------------------------------------------------------------------------- */

interface RawEmergingTheme {
  name: string;
  description: string;
  momentum: number;
  topTickers: string[];
}

async function detectEmergingThemes(
  events: MarketEvent[],
): Promise<EmergingTheme[]> {
  if (events.length === 0) return [];

  const eventSummary = events
    .slice(0, 12)
    .map((e) => `• [${e.category}] ${e.headline}`)
    .join("\n");

  const prompt = `You are a thematic research analyst. Identify the 3-5 strongest emerging investment themes active in today's market based on these events.

EVENTS:
${eventSummary}

A "theme" is a multi-month investment narrative that multiple companies can benefit from.
Examples: "AI Infrastructure Build-Out", "India Rate Cycle Turning", "Defense Spending Surge", "Copper Supply Squeeze"

For each theme:
- name: 3-6 words, specific and investable
- description: 1-2 sentences on what the theme is and why it's relevant now
- momentum: 0-100 (how strongly the current events support this theme)
- topTickers: 2-4 most obvious tickers to research (NSE format for Indian stocks, no suffixes)

Return ONLY valid JSON:
{
  "themes": [
    {
      "name": "India Rate Cycle Turning",
      "description": "RBI has begun cutting rates after a prolonged pause, benefiting rate-sensitive sectors and compressing bank margins.",
      "momentum": 82,
      "topTickers": ["HDFCBANK", "LT", "DLF"]
    }
  ]
}`;

  try {
    const raw = await runPrompt(prompt, { maxTokens: 1200, json: true });
    const parsed = extractJson<{ themes: RawEmergingTheme[] }>(raw);
    return (parsed.themes ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      momentum: Math.max(0, Math.min(100, t.momentum)),
      drivingEvents: events
        .filter((e) =>
          e.affectedThemes.some((et) =>
            t.name.toLowerCase().includes(et.toLowerCase().split(" ")[0]),
          ),
        )
        .map((e) => e.id)
        .slice(0, 3),
      topTickers: t.topTickers ?? [],
      thematicResearchUrl: `/thematic?theme=${encodeURIComponent(t.name)}`,
    }));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Risk alert extraction                                                       */
/* -------------------------------------------------------------------------- */

async function extractRiskAlerts(events: MarketEvent[]): Promise<RiskAlert[]> {
  const bearishEvents = events.filter((e) =>
    e.causalChain.some((c) => c.direction === "bearish") ||
    e.category === "geopolitics",
  );

  if (bearishEvents.length === 0) return [];

  const prompt = `Identify the top 3 market risk alerts from these events. Focus on systemic, cross-sector, or high-severity risks.

EVENTS:
${bearishEvents.slice(0, 8).map((e) => `• ${e.headline}: ${e.summary}`).join("\n")}

Return ONLY valid JSON:
{
  "alerts": [
    {
      "headline": "<risk in 8 words>",
      "severity": "high" | "medium" | "low",
      "affectedSectors": ["Banking", "Real Estate"],
      "affectedTickers": [],
      "rationale": "<1 sentence on why this is a risk>"
    }
  ]
}`;

  try {
    const raw = await runPrompt(prompt, { maxTokens: 800, json: true });
    const parsed = extractJson<{ alerts: Omit<RiskAlert, "id">[] }>(raw);
    return (parsed.alerts ?? []).slice(0, 3).map((a) => ({
      ...a,
      id: crypto.randomUUID(),
    }));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Market regime assessment                                                   */
/* -------------------------------------------------------------------------- */

export function assessMarketRegime(
  macroSignals: Awaited<ReturnType<typeof fetchMacroSignals>>,
  sectorPerf: Awaited<ReturnType<typeof fetchSectorPerformance>>,
  events: MarketEvent[],
): MarketRegime {
  const breadthPct = computeMarketBreadth(sectorPerf);

  // Derive trend from macro signals
  const sp500 = macroSignals.find((m) => m.ticker === "^GSPC");
  const vix = macroSignals.find((m) => m.ticker === "^VIX");

  let trend: MarketRegime["trend"] = "neutral";
  if (sp500?.trend === "rising" && (vix?.changePercent ?? 0) < 0) {
    trend = "risk-on";
  } else if (sp500?.trend === "falling" || (vix?.trend === "rising")) {
    trend = "risk-off";
  }

  // Dominant sectors: those advancing strongly
  const dominantSectors = sectorPerf
    .filter((s) => (s.changePercent ?? 0) > 0.5)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
    .slice(0, 3)
    .map((s) => s.sector);

  // Dominant themes from events
  const allThemes = events.flatMap((e) => e.affectedThemes);
  const themeCounts = new Map<string, number>();
  for (const t of allThemes) {
    themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
  }
  const dominantThemes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  const breadthDesc =
    breadthPct != null
      ? `${breadthPct}% of sectors advancing`
      : "breadth data unavailable";

  return {
    trend,
    breadthPct,
    dominantSectors,
    dominantThemes,
    summary: `Market is ${trend === "risk-on" ? "in risk-on mode" : trend === "risk-off" ? "in risk-off mode" : "mixed/neutral"}. ${breadthDesc}. ${dominantSectors.length > 0 ? `Leading: ${dominantSectors.join(", ")}.` : ""}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Main pipeline                                                               */
/* -------------------------------------------------------------------------- */

export async function runScannerPipeline(
  opts: ScannerPipelineOptions = {},
): Promise<ScannerResult> {
  const { query, india = true, global: glob = true, onProgress } = opts;

  emit(onProgress, "collecting", "Collecting signals from all sources…", 5);

  // Stage 1: Parallel data collection
  const [newsItems, macroSignals, sectorPerf] = await Promise.all([
    fetchMarketNews({ query, india, global: glob, limit: 60 }).catch(() => []),
    fetchMacroSignals().catch(() => []),
    fetchSectorPerformance().catch(() => []),
  ]);

  emit(
    onProgress,
    "deduplicating",
    `Clustering ${newsItems.length} signals into stories…`,
    15,
  );

  // Stage 2: Semantic deduplication
  const events = await deduplicateIntoEvents(newsItems);

  emit(
    onProgress,
    "classifying",
    `Classifying ${events.length} market events…`,
    25,
  );

  // Stage 3: Classification
  const classifiedEvents = await classifyEvents(events);

  emit(onProgress, "causal_reasoning", "Building cause-and-effect chains…", 35);

  // Stages 4 + 5 + 6: Causal reasoning, theme detection, sector impact — parallel
  const [enrichedEvents, emergingThemes, sectorImpacts] = await Promise.all([
    buildCausalChains(classifiedEvents),
    detectEmergingThemes(classifiedEvents),
    analyzeSectorImpacts(classifiedEvents, sectorPerf),
  ]);

  emit(onProgress, "theme_detection", "Emerging themes identified", 45);
  emit(onProgress, "sector_impact", "Sector impact analysis complete", 50);

  emit(onProgress, "company_impact", "Identifying company-level opportunities…", 55);

  // Stage 7: Company impact
  const candidates = await buildCompanyOpportunities(enrichedEvents, sectorImpacts);

  emit(
    onProgress,
    "fundamental_gate",
    `Validating ${candidates.length} candidates against fundamentals…`,
    65,
  );

  // Stage 8: Fundamental gate
  const validated = await applyFundamentalGate(candidates);

  emit(onProgress, "opportunity_scoring", "Scoring and ranking opportunities…", 75);

  // Stage 9: Opportunity scoring
  const scored = scoreOpportunities(validated, sectorImpacts, emergingThemes.map((t) => t.name));
  const { all, highConviction, developing } = segmentOpportunities(scored);

  emit(
    onProgress,
    "thesis_building",
    `Building investment theses for ${highConviction.length} high-conviction ideas…`,
    82,
  );

  // Stage 10: Thesis building (high-conviction only)
  const highConvictionWithTheses = await buildTheses(
    highConviction,
    enrichedEvents,
    sectorImpacts,
  );

  emit(onProgress, "assembling", "Assembling intelligence report…", 92);

  // Assemble remaining components
  const [riskAlerts, marketRegime] = await Promise.all([
    extractRiskAlerts(enrichedEvents),
    Promise.resolve(assessMarketRegime(macroSignals, sectorPerf, enrichedEvents)),
  ]);

  // Replace highConviction with thesis-enriched versions in `all`, and refresh
  // each one's opportunity profile so the narrative reflects the real thesis.
  const refreshedHighConviction = highConvictionWithTheses.map(refreshProfileWithThesis);
  const thesisMap = new Map(refreshedHighConviction.map((o) => [o.id, o]));
  const allWithTheses = all.map((o) => thesisMap.get(o.id) ?? o);

  const result: ScannerResult = {
    scannedAt: new Date().toISOString(),
    pipelineVersion: 2,
    marketRegime,
    macroSignals,
    sectorImpacts,
    emergingThemes,
    events: enrichedEvents,
    opportunities: allWithTheses,
    highConviction: refreshedHighConviction,
    developing,
    riskAlerts,
    newsItems,
    aiSummary: marketRegime.summary,
  };

  emit(onProgress, "done", "Scan complete", 100);
  return result;
}
