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
import { pickModel } from "../ai/router";
import { extractJsonObject } from "../json-extract";
import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
import { logPipeline, timeStage } from "../debug-pipeline";
import { runStagedPipeline, type StageDef } from "../platform/runner";
import { describeError, scannerPrompt, type ScanRunContext } from "./llm";
import type {
  ScannerResult,
  ScannerProgressEvent,
  ScannerPartialEvent,
  ScannerPartialKey,
  ScannerStage,
  ScannerStageEvent,
  ScannerOpportunity,
  SectorImpact,
  NewsItem,
  MarketEvent,
  EmergingTheme,
  RiskAlert,
  MarketRegime,
} from "../types";
import type { SectorPerformance } from "./signals";

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
  /** Cancels the scan: in-flight model calls abort server-side, the pipeline throws. */
  signal?: AbortSignal;
  onProgress?: (event: ScannerProgressEvent) => void;
  /** Fired as soon as each ScannerResult field is ready, before Assembly. */
  onPartial?: (event: ScannerPartialEvent) => void;
  /** Stage degradations and stall notices, streamed as they happen. */
  onStageEvent?: (event: ScannerStageEvent) => void;
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
  run?: ScanRunContext,
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
    const raw = await scannerPrompt(run, "opportunity-engine", prompt, { maxTokens: 1200 });
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
  } catch (err) {
    if (run?.signal?.aborted) throw err;
    run?.degrade?.(`theme detection skipped: ${describeError(err)}`);
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

async function extractRiskAlerts(
  events: MarketEvent[],
  run?: ScanRunContext,
): Promise<RiskAlert[]> {
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
    const raw = await scannerPrompt(run, "opportunity-engine", prompt, { maxTokens: 800 });
    const parsed = extractJsonObject(raw, { alerts: [] as unknown[] });
    const alerts = parsed.alerts.map(sanitizeRiskAlert).filter((a): a is Omit<RiskAlert, "id"> => a !== null);
    return alerts.slice(0, 3).map((a) => ({
      ...a,
      id: crypto.randomUUID(),
    }));
  } catch (err) {
    if (run?.signal?.aborted) throw err;
    run?.degrade?.(`risk alerts skipped: ${describeError(err)}`);
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
  const { query, india = true, global: glob = true, signal, onProgress, onPartial, onStageEvent } = opts;

  // TEMPORARY (DEBUG_PIPELINE): per-scan scope so concurrent scans are
  // distinguishable in the NDJSON log.
  const scanId = `scan-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
  logPipeline({ type: "pipeline_start", scope: scanId, query: query ?? null, india, global: glob });

  // One model for the whole scan's opportunity-engine calls. Without the pin,
  // a health cooldown mid-scan swapped one 9GB model for another (measured
  // 2026-07-31: 145s cold load + the original's reload after) — see
  // lib/scanner/llm.ts. Resolved here so every stage agrees.
  const pinnedModel = await pickModel("opportunity-engine");

  // Shared mutable context the stages fill in order. Each field is written by
  // exactly one stage and read only by later ones.
  const ctx = {
    newsItems: [] as NewsItem[],
    macroSignals: [] as Awaited<ReturnType<typeof fetchMacroSignals>>,
    sectorPerf: [] as SectorPerformance[],
    events: [] as MarketEvent[],
    classifiedEvents: [] as MarketEvent[],
    emergingThemes: [] as EmergingTheme[],
    marketRegime: null as MarketRegime | null,
    enrichedEvents: [] as MarketEvent[],
    riskAlerts: [] as RiskAlert[],
    sectorImpacts: [] as SectorImpact[],
    candidates: [] as ScannerOpportunity[],
    all: [] as ScannerOpportunity[],
    highConviction: [] as ScannerOpportunity[],
    developing: [] as ScannerOpportunity[],
    refreshedHighConviction: [] as ScannerOpportunity[],
    allWithTheses: [] as ScannerOpportunity[],
  };

  type Ctx = typeof ctx;

  // Adapts the runner's StageApi to the per-stage ScanRunContext the stage
  // modules take (signal for cancellation, pinned model, tick/degrade).
  const runCtx = (api: Parameters<StageDef<Ctx>["run"]>[1]): ScanRunContext => ({
    signal: api.signal,
    model: pinnedModel,
    setUnits: api.setUnits,
    tick: api.tick,
    item: api.item,
    degrade: api.fail,
  });

  const stages: StageDef<Ctx>[] = [
    {
      id: "collecting",
      label: "Collecting signals from all sources",
      units: 1,
      timeoutMs: 60_000,
      run: async (c, api) => {
        // Parallel data collection. Needs no LLM call, so its outputs can
        // stream immediately — News Timeline and Macro Dashboard don't have
        // to wait for anything below.
        const [newsItems, macroSignals, sectorPerf] = await timeStage(scanId, "collecting", () =>
          Promise.all([
            fetchMarketNews({ query, india, global: glob, limit: 60 }).catch(() => []),
            fetchMacroSignals().catch(() => []),
            fetchSectorPerformance().catch(() => []),
          ]),
          { limit: 60 },
        );
        c.newsItems = newsItems;
        c.macroSignals = macroSignals;
        c.sectorPerf = sectorPerf;
        api.tick();
        partial(onPartial, "newsItems", newsItems);
        partial(onPartial, "macroSignals", macroSignals);
      },
    },
    {
      id: "deduplicating",
      label: "Clustering headlines into stories",
      units: 1,
      run: async (c, api) => {
        const deduped = await timeStage(scanId, "deduplicating", () =>
          deduplicateIntoEvents(c.newsItems, runCtx(api)),
          { newsItems: c.newsItems.length },
        );
        // Cap to the most-corroborated stories before any per-event LLM stage
        // runs (see MAX_EVENTS above) — shrinks Classification's batch, Causal
        // Reasoning's loop, and Risk Alert extraction together.
        c.events = [...deduped]
          .sort((a, b) => b.sources.length - a.sources.length)
          .slice(0, MAX_EVENTS);
      },
    },
    {
      id: "classifying",
      label: "Classifying market events",
      units: 1,
      run: async (c, api) => {
        c.classifiedEvents = await timeStage(scanId, "classifying", () =>
          classifyEvents(c.events, runCtx(api)),
          { events: c.events.length },
        );
      },
    },
    {
      // Reordered before Causal Reasoning — Market Regime + Emerging Themes
      // only need category/affectedThemes, both set by Classification, so
      // they're ready and streamed well before the per-event causal loop.
      id: "theme_detection",
      label: "Detecting emerging themes",
      units: 1,
      run: async (c, api) => {
        c.emergingThemes = await timeStage(scanId, "theme_detection", () =>
          detectEmergingThemes(c.classifiedEvents, runCtx(api)),
          { events: c.classifiedEvents.length },
        );
        c.marketRegime = assessMarketRegime(c.macroSignals, c.sectorPerf, c.classifiedEvents);
        partial(onPartial, "marketRegime", c.marketRegime);
        partial(onPartial, "emergingThemes", c.emergingThemes);
      },
    },
    {
      // Sequential per event — a policy from the serializing local backend; kept as-is.
      // Sector Impact genuinely needs this stage's output (its prompt
      // references each event's causal chain), which is why — unlike Theme
      // Detection/Market Regime above — it can't move any earlier.
      id: "causal_reasoning",
      label: "Building cause-and-effect chains",
      units: 4,
      run: async (c, api) => {
        c.enrichedEvents = await timeStage(scanId, "causal_reasoning", () =>
          buildCausalChains(c.classifiedEvents, runCtx(api)),
          { events: c.classifiedEvents.length },
        );
      },
    },
    {
      // Only needs enrichedEvents, not opportunities or theses, so it doesn't
      // wait behind 5 more stages for nothing.
      id: "risk_alerts",
      label: "Extracting risk alerts",
      units: 1,
      run: async (c, api) => {
        c.riskAlerts = await timeStage(scanId, "risk_alerts", () =>
          extractRiskAlerts(c.enrichedEvents, runCtx(api)),
          { events: c.enrichedEvents.length },
        );
        partial(onPartial, "events", c.enrichedEvents);
        partial(onPartial, "riskAlerts", c.riskAlerts);
      },
    },
    {
      id: "sector_impact",
      label: "Analyzing sector impact",
      units: 1,
      run: async (c, api) => {
        c.sectorImpacts = await timeStage(scanId, "sector_impact", () =>
          analyzeSectorImpacts(c.enrichedEvents, c.sectorPerf, runCtx(api)),
          { events: c.enrichedEvents.length },
        );
        partial(onPartial, "sectorImpacts", c.sectorImpacts);
      },
    },
    {
      id: "company_impact",
      label: "Identifying company opportunities",
      units: 4,
      run: async (c, api) => {
        c.candidates = await timeStage(scanId, "company_impact", () =>
          buildCompanyOpportunities(c.enrichedEvents, c.sectorImpacts, runCtx(api)),
          { events: c.enrichedEvents.length, sectorImpacts: c.sectorImpacts.length },
        );
      },
    },
    {
      id: "fundamental_gate",
      label: "Validating candidates against fundamentals",
      units: 1,
      timeoutMs: 60_000,
      run: async (c, api) => {
        const validated = await timeStage(scanId, "fundamental_gate", () =>
          applyFundamentalGate(c.candidates),
          { candidates: c.candidates.length },
        );
        const scored = scoreOpportunities(
          validated,
          c.sectorImpacts,
          c.emergingThemes.map((t) => t.name),
        );
        const { all, highConviction, developing } = segmentOpportunities(scored);
        c.all = all;
        c.highConviction = highConviction;
        c.developing = developing;
        api.tick();
        // Ship the ranked list now, without theses — cards render immediately;
        // the thesis for each one is a progressive enhancement, not a gate.
        partial(onPartial, "opportunities", all);
        partial(onPartial, "highConviction", highConviction);
        partial(onPartial, "developing", developing);
      },
    },
    {
      id: "thesis_building",
      label: "Building investment theses",
      units: 2,
      run: async (c, api) => {
        const withTheses = await timeStage(scanId, "thesis_building", () =>
          buildTheses(c.highConviction, c.enrichedEvents, c.sectorImpacts, runCtx(api)),
          { highConviction: c.highConviction.length },
        );
        // Replace highConviction with thesis-enriched versions in `all`, and
        // refresh each one's opportunity profile so the narrative reflects the
        // real thesis. Same keys and opp.id per item as the partials above —
        // the frontend updates already-rendered cards in place.
        c.refreshedHighConviction = withTheses.map(refreshProfileWithThesis);
        const thesisMap = new Map(c.refreshedHighConviction.map((o) => [o.id, o]));
        c.allWithTheses = c.all.map((o) => thesisMap.get(o.id) ?? o);
        partial(onPartial, "opportunities", c.allWithTheses);
        partial(onPartial, "highConviction", c.refreshedHighConviction);
      },
    },
  ];

  const { failures } = await runStagedPipeline(stages, ctx, {
    signal,
    onEvent: (event) => {
      if (event.type === "progress") {
        onProgress?.({
          stage: event.stage as ScannerStage,
          message: event.message,
          pct: event.pct,
          currentItem: event.currentItem,
          unitsDone: event.unitsDone,
          unitsTotal: event.unitsTotal,
        });
      } else {
        logPipeline({ scope: scanId, ...event, type: `scan_${event.type}` });
        onStageEvent?.(event);
      }
    },
  });

  emit(onProgress, "assembling", "Assembling intelligence report", 99);

  const marketRegime =
    ctx.marketRegime ?? assessMarketRegime(ctx.macroSignals, ctx.sectorPerf, ctx.classifiedEvents);

  const result: ScannerResult = {
    scannedAt: new Date().toISOString(),
    pipelineVersion: 2,
    marketRegime,
    macroSignals: ctx.macroSignals,
    sectorImpacts: ctx.sectorImpacts,
    emergingThemes: ctx.emergingThemes,
    // Fallbacks keep a partially-failed scan honest but non-empty: a thrown
    // stage leaves its ctx field unset, so read the best upstream value.
    events: ctx.enrichedEvents.length > 0 ? ctx.enrichedEvents : ctx.classifiedEvents,
    opportunities: ctx.allWithTheses.length > 0 ? ctx.allWithTheses : ctx.all,
    highConviction:
      ctx.refreshedHighConviction.length > 0 ? ctx.refreshedHighConviction : ctx.highConviction,
    developing: ctx.developing,
    riskAlerts: ctx.riskAlerts,
    newsItems: ctx.newsItems,
    aiSummary: marketRegime.summary,
    stageFailures: failures,
  };

  emit(onProgress, "done", "Scan complete", 100);
  logPipeline({
    type: "pipeline_end",
    scope: scanId,
    opportunities: ctx.allWithTheses.length,
    events: ctx.enrichedEvents.length,
    stageFailures: failures.length,
  });
  return result;
}
