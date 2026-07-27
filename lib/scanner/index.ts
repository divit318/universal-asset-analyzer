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
import { extractJsonObject } from "../json-extract";
import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
import type {
  ScannerResult,
  ScannerProgressEvent,
  ScannerPartialEvent,
  ScannerPartialKey,
  ScannerStage,
  MarketEvent,
  EmergingTheme,
  RiskAlert,
  MarketRegime,
} from "../types";

/**
 * Cap on events surviving into Classification and every stage after it.
 * Ranked by corroboration (how many outlets a dedup cluster pulled in), not
 * recency — an event 4 outlets are covering is a stronger signal than a
 * single-source one. Capping once, here, shrinks Classification's batch,
 * Causal Reasoning's per-event loop, and Risk Alert extraction all together,
 * instead of bounding each stage separately.
 */
const MAX_EVENTS = 10;

export interface ScannerPipelineOptions {
  query?: string;
  india?: boolean;
  global?: boolean;
  onProgress?: (event: ScannerProgressEvent) => void;
  /** Fired as soon as each ScannerResult field is ready, before Assembly. */
  onPartial?: (event: ScannerPartialEvent) => void;
}

function emit(
  onProgress: ((e: ScannerProgressEvent) => void) | undefined,
  stage: ScannerStage,
  message: string,
  pct: number,
) {
  onProgress?.({ stage, message, pct });
}

function partial<K extends ScannerPartialKey>(
  onPartial: ((e: ScannerPartialEvent) => void) | undefined,
  key: K,
  data: ScannerResult[K],
) {
  onPartial?.({ key, data });
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

export function sanitizeTheme(item: unknown): RawEmergingTheme | null {
  if (item === null || typeof item !== "object") return null;
  const t = item as Record<string, unknown>;
  if (typeof t.name !== "string" || typeof t.description !== "string") return null;
  const momentum = Number(t.momentum);
  return {
    name: t.name,
    description: t.description,
    momentum: Number.isFinite(momentum) ? momentum : 0,
    topTickers: Array.isArray(t.topTickers)
      ? t.topTickers.filter((x): x is string => typeof x === "string")
      : [],
  };
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

${JSON_SCHEMA_LEAD_IN}
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
    const raw = await runPrompt("opportunity-engine", prompt, { maxTokens: 1200, json: true });
    const parsed = extractJsonObject(raw, { themes: [] as unknown[] });
    const themes = parsed.themes.map(sanitizeTheme).filter((t): t is RawEmergingTheme => t !== null);
    return themes.map((t) => ({
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

export function sanitizeRiskAlert(item: unknown): Omit<RiskAlert, "id"> | null {
  if (item === null || typeof item !== "object") return null;
  const a = item as Record<string, unknown>;
  if (typeof a.headline !== "string" || typeof a.rationale !== "string") return null;
  const severity = typeof a.severity === "string" ? a.severity.toLowerCase() : "";
  return {
    headline: a.headline,
    severity: (["high", "medium", "low"] as string[]).includes(severity)
      ? (severity as RiskAlert["severity"])
      : "medium",
    affectedSectors: Array.isArray(a.affectedSectors)
      ? a.affectedSectors.filter((x): x is string => typeof x === "string")
      : [],
    affectedTickers: Array.isArray(a.affectedTickers)
      ? a.affectedTickers.filter((x): x is string => typeof x === "string")
      : [],
    rationale: a.rationale,
  };
}

async function extractRiskAlerts(events: MarketEvent[]): Promise<RiskAlert[]> {
  const bearishEvents = events.filter((e) =>
    e.causalChain.some((c) => c.direction === "bearish") ||
    e.category === "geopolitics",
  );

  if (bearishEvents.length === 0) return [];

  const prompt = `Identify the top 3 market risk alerts from these events. Focus on systemic, cross-sector, or high-severity risks.

EVENTS:
${bearishEvents.slice(0, 8).map((e) => `• ${e.headline}: ${e.summary}`).join("\n")}

${JSON_SCHEMA_LEAD_IN}
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
    const raw = await runPrompt("opportunity-engine", prompt, { maxTokens: 800, json: true });
    const parsed = extractJsonObject(raw, { alerts: [] as unknown[] });
    const alerts = parsed.alerts.map(sanitizeRiskAlert).filter((a): a is Omit<RiskAlert, "id"> => a !== null);
    return alerts.slice(0, 3).map((a) => ({
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
  const { query, india = true, global: glob = true, onProgress, onPartial } = opts;

  emit(onProgress, "collecting", "Collecting signals from all sources…", 5);

  // Stage 1: Parallel data collection. Needs no LLM call, so its outputs can
  // stream immediately — News Timeline and Macro Dashboard don't have to
  // wait for anything below.
  const [newsItems, macroSignals, sectorPerf] = await Promise.all([
    fetchMarketNews({ query, india, global: glob, limit: 60 }).catch(() => []),
    fetchMacroSignals().catch(() => []),
    fetchSectorPerformance().catch(() => []),
  ]);
  partial(onPartial, "newsItems", newsItems);
  partial(onPartial, "macroSignals", macroSignals);

  emit(
    onProgress,
    "deduplicating",
    `Clustering ${newsItems.length} signals into stories…`,
    15,
  );

  // Stage 2: Semantic deduplication
  const dedupedEvents = await deduplicateIntoEvents(newsItems);

  // Cap to the most-corroborated stories before any per-event LLM stage
  // runs (see MAX_EVENTS above) — shrinks Classification's batch, Causal
  // Reasoning's loop, and Risk Alert extraction together.
  const events = [...dedupedEvents]
    .sort((a, b) => b.sources.length - a.sources.length)
    .slice(0, MAX_EVENTS);

  emit(
    onProgress,
    "classifying",
    `Classifying ${events.length} market events…`,
    25,
  );

  // Stage 3: Classification
  const classifiedEvents = await classifyEvents(events);

  // Stage 4/5 (reordered — Market Regime + Emerging Themes only need
  // category/affectedThemes, both set by Classification, not by Causal
  // Reasoning's causalChain field. Running them here means they're ready
  // and streamed well before Causal Reasoning's per-event loop even starts,
  // instead of waiting behind it for no data reason. ScannerStage's own
  // type union already lists theme_detection before causal_reasoning.)
  emit(onProgress, "theme_detection", "Detecting emerging themes…", 32);
  const emergingThemes = await detectEmergingThemes(classifiedEvents);
  const marketRegime = assessMarketRegime(macroSignals, sectorPerf, classifiedEvents);
  emit(onProgress, "theme_detection", "Emerging themes identified", 38);
  partial(onPartial, "marketRegime", marketRegime);
  partial(onPartial, "emergingThemes", emergingThemes);

  emit(onProgress, "causal_reasoning", "Building cause-and-effect chains…", 45);

  // Stage 6: causal reasoning. Sequential — Ollama serves one request at a
  // time locally, so running this concurrently with anything else wouldn't
  // actually parallelize, only queue. Sector Impact (below) genuinely needs
  // this stage's output (its prompt references each event's causal chain),
  // which is why — unlike Theme Detection/Market Regime above — it can't
  // move any earlier.
  const enrichedEvents = await buildCausalChains(classifiedEvents);
  emit(onProgress, "causal_reasoning", "Cause-and-effect chains built", 50);

  // Risk alerts (reordered — only needs enrichedEvents, not opportunities
  // or theses, so it no longer waits behind 5 more stages for nothing).
  const riskAlerts = await extractRiskAlerts(enrichedEvents);
  partial(onPartial, "events", enrichedEvents);
  partial(onPartial, "riskAlerts", riskAlerts);

  const sectorImpacts = await analyzeSectorImpacts(enrichedEvents, sectorPerf);
  emit(onProgress, "sector_impact", "Sector impact analysis complete", 58);
  partial(onPartial, "sectorImpacts", sectorImpacts);

  emit(onProgress, "company_impact", "Identifying company-level opportunities…", 62);

  // Stage 7: Company impact
  const candidates = await buildCompanyOpportunities(enrichedEvents, sectorImpacts);

  emit(
    onProgress,
    "fundamental_gate",
    `Validating ${candidates.length} candidates against fundamentals…`,
    70,
  );

  // Stage 8: Fundamental gate
  const validated = await applyFundamentalGate(candidates);

  emit(onProgress, "opportunity_scoring", "Scoring and ranking opportunities…", 78);

  // Stage 9: Opportunity scoring
  const scored = scoreOpportunities(validated, sectorImpacts, emergingThemes.map((t) => t.name));
  const { all, highConviction, developing } = segmentOpportunities(scored);
  // Ship the ranked list now, without theses — cards render immediately;
  // the thesis for each one is a progressive enhancement, not a gate.
  partial(onPartial, "opportunities", all);
  partial(onPartial, "highConviction", highConviction);
  partial(onPartial, "developing", developing);

  emit(
    onProgress,
    "thesis_building",
    `Building investment theses for ${highConviction.length} high-conviction ideas…`,
    85,
  );

  // Stage 10: Thesis building (high-conviction only)
  const highConvictionWithTheses = await buildTheses(
    highConviction,
    enrichedEvents,
    sectorImpacts,
  );

  emit(onProgress, "assembling", "Assembling intelligence report…", 95);

  // Replace highConviction with thesis-enriched versions in `all`, and refresh
  // each one's opportunity profile so the narrative reflects the real thesis.
  const refreshedHighConviction = highConvictionWithTheses.map(refreshProfileWithThesis);
  const thesisMap = new Map(refreshedHighConviction.map((o) => [o.id, o]));
  const allWithTheses = all.map((o) => thesisMap.get(o.id) ?? o);
  // Same keys as above, same opp.id per item — the frontend updates
  // already-rendered cards in place rather than rendering duplicates.
  partial(onPartial, "opportunities", allWithTheses);
  partial(onPartial, "highConviction", refreshedHighConviction);

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
