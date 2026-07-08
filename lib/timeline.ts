/**
 * Investment Timeline — the historical memory of a company, ETF, portfolio,
 * or watchlist.
 *
 * Composes existing engines instead of duplicating them:
 *   - lib/news.ts, lib/edgar.ts        -> raw event sources
 *   - lib/sector-rotation.ts / db.ts   -> sector leadership-change events
 *   - lib/ai-watchlist.ts              -> structured portfolio/watchlist alerts
 *   - lib/scanner/*  (via scanner_cache)-> Opportunity Engine evidence, best-effort
 *   - lib/ai.ts (runPrompt)            -> AI narrative for the detail panel only
 *
 * Classification, importance/confidence scoring, and impact direction are
 * deterministic pure functions (testable, no I/O) — "AI explains, engines
 * decide", the same split used throughout lib/scanner/* and
 * lib/movement-explainer.ts. Events are persisted once (id = hash of the
 * natural key) so re-syncing never duplicates history.
 */

import { createHash } from "node:crypto";
import { getCompanyNews } from "./news";
import { getRecentFilings } from "./edgar";
import { getFundamentals } from "./fundamentals";
import { getHistory, getQuote } from "./yahoo";
import { runPrompt } from "./ai";
import { extractJson } from "./json-extract";
import { gatherWatchlistAlerts } from "./ai-watchlist";
import {
  listPortfolio,
  listWatchlist,
  listTimelineEvents,
  listTimelineEventsForSymbols,
  putTimelineEvents,
  getLatestSectorRotationSnapshots,
  getScannerCache,
  putScannerCache,
} from "./db";
import type {
  TimelineEvent,
  TimelineEventCategory,
  TimelineImpact,
  CatalystStatus,
  TimelineEventSource,
  TimelineSourceKind,
  TimelineFilters,
  TimelineFeed,
  TimelineScope,
  TimelineEventDetail,
  ThesisEvolution,
  ThesisEvolutionPoint,
  ThesisDirection,
  WhatChangedResult,
  NewsItem,
  Filing,
  ScannerResult,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Deterministic classification & scoring — pure, unit-testable               */
/* -------------------------------------------------------------------------- */

const CATEGORY_PATTERNS: [TimelineEventCategory, RegExp][] = [
  ["ceo_change", /\bceo\b.*(steps? down|resign|retir|appoint|named|succeed|replac)|names? .*\bceo\b|new ceo/i],
  ["executive_departure", /\b(cfo|coo|cto|chief \w+ officer|president)\b.*(resign|depart|steps? down|leaves|ousted|retir)/i],
  ["acquisition", /\b(to acquire|acquisition|acquires|merger|to merge|takeover|all-cash deal|buyout)\b/i],
  ["divestiture", /\b(divest|spin-?off|carve-?out|sell(?:s|ing)? (?:its|the) .*(?:unit|division|business))\b/i],
  ["share_buyback", /\b(buyback|share repurchase|repurchase program)\b/i],
  ["dividend", /\bdividend\b/i],
  ["lawsuit", /\b(lawsuit|sues|sued|litigation|class action|court ruling)\b/i],
  ["regulatory_action", /\b(sec probe|ftc|doj|antitrust|investigat|regulator|subpoena|fined|settlement)\b/i],
  ["analyst_upgrade", /\b(upgrade[sd]?|raises? (?:price target|rating)|initiates? .*(?:buy|outperform|overweight))\b/i],
  ["analyst_downgrade", /\b(downgrade[sd]?|cuts? (?:price target|rating)|lowers? (?:price target|rating))\b/i],
  ["insider_buying", /\binsider\b.*\bbuy|bought shares|form 4.*purchase/i],
  ["insider_selling", /\binsider\b.*\bsell|sold shares|form 4.*sale/i],
  ["capacity_expansion", /\b(expands? (?:capacity|production)|new (?:factory|plant|fab)|breaks? ground)\b/i],
  ["margin_expansion", /\bmargins? (?:expand|improv|widen)/i],
  ["margin_compression", /\bmargins? (?:compress|shrink|narrow|under pressure|declin)/i],
  ["demand_shift", /\b(demand (?:surges?|slumps?|weakens?|softens?|drops?|jumps?)|orders? (?:surge|slump|weaken|drop))\b/i],
  ["competitive_threat", /\b(competitor|rival)\b.*(launch|threat|undercut|market share)/i],
  ["product_launch", /\b(launches?|unveils?|introduces?|debuts?)\b.*(product|device|model|service|chip)|new product/i],
  ["partnership", /\b(partners? with|partnership|collaborat|joint venture|teams? up)\b/i],
  ["valuation_inflection", /\b(valuation|multiple)\b.*(re-?rat|compress|expand)/i],
  ["technical_breakout", /\bbreaks? (?:out|above|below)|52-week (?:high|low)\b/i],
  ["ai_developments", /\b(artificial intelligence|generative ai|machine learning|large language model|\bllm\b)\b/i],
  ["guidance", /\bguidance\b|\boutlook\b.*(raise|cut|lower|reaffirm)/i],
  ["earnings", /\bearnings\b|\bquarterly results\b|\beps\b|beats? (?:estimate|consensus|expectations)|misses? (?:estimate|consensus|expectations)/i],
  ["macro_event", /\b(federal reserve|\bfomc\b|interest rate|inflation|\bcpi\b|\bgdp\b|recession|tariff)\b/i],
];

/** Pure: classify free text into one of the 28 timeline categories. */
export function classifyTimelineCategory(
  text: string,
  fallback: TimelineEventCategory = "industry_event",
): TimelineEventCategory {
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return fallback;
}

const FORM_CATEGORY_FALLBACK: Record<string, TimelineEventCategory> = {
  "10-K": "earnings",
  "10-Q": "earnings",
  "8-K": "industry_event",
  "4": "insider_selling",
  "DEF 14A": "regulatory_action",
};

const CATEGORY_BASE_IMPORTANCE: Record<TimelineEventCategory, number> = {
  earnings: 80,
  guidance: 75,
  product_launch: 55,
  acquisition: 85,
  divestiture: 70,
  ceo_change: 80,
  executive_departure: 60,
  share_buyback: 55,
  dividend: 40,
  regulatory_action: 70,
  lawsuit: 65,
  macro_event: 55,
  industry_event: 45,
  ai_developments: 55,
  partnership: 50,
  capacity_expansion: 55,
  margin_expansion: 60,
  margin_compression: 60,
  demand_shift: 55,
  competitive_threat: 55,
  analyst_upgrade: 45,
  analyst_downgrade: 45,
  insider_buying: 50,
  insider_selling: 45,
  valuation_inflection: 50,
  technical_breakout: 40,
  sector_rotation: 50,
  portfolio_impact: 60,
};

const SOURCE_CONFIDENCE: Record<TimelineSourceKind, number> = {
  filing: 90,
  earnings_calendar: 85,
  scanner: 75,
  sector_rotation: 80,
  watchlist_alert: 65,
  portfolio_alert: 65,
  news: 55,
};

/** Pure: deterministic confidence score from source reliability + data completeness. */
export function scoreConfidence(kind: TimelineSourceKind, hasDetail: boolean): number {
  const base = SOURCE_CONFIDENCE[kind];
  return Math.max(0, Math.min(100, hasDetail ? base : base - 15));
}

/** Pure: deterministic importance score from category + confidence + severity boost. */
export function scoreImportance(
  category: TimelineEventCategory,
  confidenceScore: number,
  severityBoost = 0,
): number {
  const base = CATEGORY_BASE_IMPORTANCE[category];
  const confidenceAdj = (confidenceScore - 70) * 0.2;
  return Math.max(0, Math.min(100, Math.round(base + confidenceAdj + severityBoost)));
}

const BULLISH_WORDS = /\b(beats?|surges?|jumps?|rall(?:y|ies)|upgrades?|raises?|expands?|record|strong|outperform|accelerat)\b/i;
const BEARISH_WORDS = /\b(misses?|plunges?|drops?|falls?|downgrades?|cuts?|lowers?|lawsuit|investigat|fined?|penalt|resigns?|compress|weak|declin|recall|breach)\b/i;

const CATEGORY_DEFAULT_IMPACT: Partial<Record<TimelineEventCategory, TimelineImpact>> = {
  analyst_upgrade: "bullish",
  analyst_downgrade: "bearish",
  insider_buying: "bullish",
  insider_selling: "bearish",
  margin_expansion: "bullish",
  margin_compression: "bearish",
  share_buyback: "bullish",
  lawsuit: "bearish",
  regulatory_action: "bearish",
  competitive_threat: "bearish",
  capacity_expansion: "bullish",
};

/** Pure: bullish/bearish/neutral from text keywords, falling back to category defaults. */
export function deriveImpact(category: TimelineEventCategory, text: string): TimelineImpact {
  const bull = BULLISH_WORDS.test(text);
  const bear = BEARISH_WORDS.test(text);
  if (bull && !bear) return "bullish";
  if (bear && !bull) return "bearish";
  return CATEGORY_DEFAULT_IMPACT[category] ?? "neutral";
}

const FORWARD_LOOKING_CATEGORIES = new Set<TimelineEventCategory>([
  "earnings", "guidance", "product_launch", "acquisition", "regulatory_action", "macro_event", "capacity_expansion",
]);

/** Pure: whether an event still represents a live catalyst, already played out, or is background context. */
export function deriveCatalystStatus(category: TimelineEventCategory, timestampIso: string, importance: number): CatalystStatus {
  const isFuture = new Date(timestampIso).getTime() > Date.now();
  if (isFuture) return "pending";
  if (FORWARD_LOOKING_CATEGORIES.has(category) && importance >= 50) return "realized";
  return "not_catalyst";
}

/** Deterministic id from a natural key so re-syncing the same source never duplicates an event. */
export function buildEventId(symbol: string, kind: TimelineSourceKind, naturalKey: string): string {
  return createHash("sha1").update(`${symbol}:${kind}:${naturalKey}`).digest("hex").slice(0, 24);
}

/* -------------------------------------------------------------------------- */
/* Event assembly — one function per raw source, all deterministic            */
/* -------------------------------------------------------------------------- */

function eventFromNews(symbol: string, item: NewsItem): TimelineEvent {
  const text = `${item.headline} ${item.summary ?? ""}`;
  const category = classifyTimelineCategory(text);
  const confidenceScore = scoreConfidence("news", item.summary != null);
  const importanceScore = scoreImportance(category, confidenceScore);
  const source: TimelineEventSource = { kind: "news", url: item.url, description: item.source };
  return {
    id: buildEventId(symbol, "news", item.url || item.headline),
    symbol,
    timestamp: item.publishedAt,
    title: item.headline,
    category,
    importanceScore,
    confidenceScore,
    impact: deriveImpact(category, text),
    affectedSegment: null,
    relatedMetrics: [],
    source,
    thesisImpact: null,
    catalystStatus: deriveCatalystStatus(category, item.publishedAt, importanceScore),
  };
}

function eventFromFiling(symbol: string, filing: Filing): TimelineEvent | null {
  if (!filing.filedAt) return null;
  const text = filing.description || filing.form;
  const category = classifyTimelineCategory(text, FORM_CATEGORY_FALLBACK[filing.form] ?? "industry_event");
  const confidenceScore = scoreConfidence("filing", true);
  const importanceScore = scoreImportance(category, confidenceScore);
  const timestamp = new Date(filing.filedAt).toISOString();
  const source: TimelineEventSource = { kind: "filing", url: filing.documentUrl, description: `SEC ${filing.form}` };
  return {
    id: buildEventId(symbol, "filing", filing.accessionNumber),
    symbol,
    timestamp,
    title: `${filing.form}: ${filing.description}`,
    category,
    importanceScore,
    confidenceScore,
    impact: deriveImpact(category, text),
    affectedSegment: null,
    relatedMetrics: [],
    source,
    thesisImpact: null,
    catalystStatus: deriveCatalystStatus(category, timestamp, importanceScore),
  };
}

/** Sector leadership changes affecting this symbol's sector -> "sector_rotation" events. */
function eventsFromSectorRotation(symbol: string, sector: string | null): TimelineEvent[] {
  if (!sector) return [];
  const snapshots = getLatestSectorRotationSnapshots(120); // ~4 months of daily snapshots, newest first
  const events: TimelineEvent[] = [];
  for (let i = 0; i < snapshots.length - 1; i++) {
    const current = snapshots[i].sectors.find((s) => s.sector === sector) ?? null;
    const prior = snapshots[i + 1].sectors.find((s) => s.sector === sector) ?? null;
    if (!current || !prior) continue;
    if (current.classification === prior.classification) continue;
    const confidenceScore = scoreConfidence("sector_rotation", true);
    const impact: TimelineImpact =
      current.classification === "leading" || current.classification === "strengthening" ? "bullish" : "bearish";
    events.push({
      id: buildEventId(symbol, "sector_rotation", `${sector}:${snapshots[i].asOf}`),
      symbol,
      timestamp: new Date(snapshots[i].asOf).toISOString(),
      title: `${sector} sector shifted to "${current.classification}" (rank #${current.rank}/11 by relative strength)`,
      category: "sector_rotation",
      importanceScore: scoreImportance("sector_rotation", confidenceScore, current.rank <= 3 ? 10 : 0),
      confidenceScore,
      impact,
      affectedSegment: sector,
      relatedMetrics: ["relative strength", "1m return"],
      source: { kind: "sector_rotation", url: null, description: `Sector Rotation Engine, as of ${snapshots[i].asOf}` },
      thesisImpact: null,
      catalystStatus: "not_catalyst",
    });
  }
  return events;
}

/** Reuses lib/ai-watchlist.ts's alert pipeline (deterministic) as one-per-symbol-per-day "portfolio_impact" events. */
async function eventsFromAlerts(symbol: string, name: string): Promise<TimelineEvent[]> {
  const alerts = await gatherWatchlistAlerts(undefined, {
    items: [{ symbol, name, addedAt: new Date().toISOString(), targetPrice: null, alertPctDrop: null, notes: null }],
  });
  const today = new Date().toISOString().slice(0, 10);
  return alerts
    .filter((a) => a.symbol === symbol)
    .map((a) => {
      const confidenceScore = scoreConfidence("watchlist_alert", true);
      const severityBoost = a.severity === "high" ? 15 : a.severity === "medium" ? 5 : 0;
      const impact: TimelineImpact =
        a.type === "deteriorating" ? "bearish" : a.type === "new_opportunity" || a.type === "breakout" ? "bullish" : "neutral";
      return {
        id: buildEventId(symbol, "watchlist_alert", `${a.type}:${today}`),
        symbol,
        timestamp: new Date().toISOString(),
        title: a.title,
        category: "portfolio_impact" as TimelineEventCategory,
        importanceScore: scoreImportance("portfolio_impact", confidenceScore, severityBoost),
        confidenceScore,
        impact,
        affectedSegment: null,
        relatedMetrics: [],
        source: { kind: "watchlist_alert" as TimelineSourceKind, url: null, description: a.description },
        thesisImpact: null,
        catalystStatus: "not_catalyst" as CatalystStatus,
      };
    });
}

/** Best-effort: pulls Opportunity Engine evidence from the last cached auto-scan (no live pipeline run). */
function eventsFromScannerCache(symbol: string, sector: string | null): TimelineEvent[] {
  const cached = getScannerCache("v2::true:true");
  if (!cached) return [];
  let result: ScannerResult;
  try {
    result = JSON.parse(cached) as ScannerResult;
  } catch {
    return [];
  }
  const events: TimelineEvent[] = [];
  for (const marketEvent of result.events) {
    const matchesSymbol = marketEvent.affectedTickers.includes(symbol);
    const matchesSector = sector != null && marketEvent.affectedSectors.includes(sector);
    if (!matchesSymbol && !matchesSector) continue;
    const confidenceScore = scoreConfidence("scanner", marketEvent.causalChain.length > 0);
    const text = `${marketEvent.headline} ${marketEvent.summary}`;
    const category = classifyTimelineCategory(text, "industry_event");
    events.push({
      id: buildEventId(symbol, "scanner", marketEvent.id),
      symbol,
      timestamp: marketEvent.publishedAt,
      title: marketEvent.headline,
      category,
      importanceScore: scoreImportance(category, confidenceScore, matchesSymbol ? 10 : 0),
      confidenceScore,
      impact: deriveImpact(category, text),
      affectedSegment: sector,
      relatedMetrics: [],
      source: {
        kind: "scanner",
        url: marketEvent.sources[0]?.url ?? null,
        description: "Scanner Opportunity Engine",
      },
      thesisImpact: null,
      catalystStatus: "not_catalyst",
    });
  }
  return events;
}

/* -------------------------------------------------------------------------- */
/* Sync — fetch raw sources, classify, persist (idempotent)                   */
/* -------------------------------------------------------------------------- */

/**
 * Fetch fresh news/filings/rotation/alerts for one symbol and persist
 * newly-seen events. Idempotent (event ids are content-hashed) and
 * rate-limited via scanner_cache's 15-minute TTL so repeated page views
 * don't re-hit news/EDGAR on every request.
 */
export async function syncTimelineEvents(symbol: string): Promise<void> {
  const syncKey = `timeline-sync:${symbol}`;
  if (getScannerCache(syncKey)) return; // synced within the last 15 minutes

  const [news, filings, fundamentals, quote] = await Promise.all([
    getCompanyNews(symbol, 25).catch(() => [] as NewsItem[]),
    getRecentFilings(symbol, 15).catch(() => [] as Filing[]),
    getFundamentals(symbol).catch(() => null),
    getQuote(symbol).catch(() => null),
  ]);
  const alertEvents = await eventsFromAlerts(symbol, quote?.name ?? symbol).catch(() => [] as TimelineEvent[]);

  const sector = fundamentals?.snapshot.sector ?? null;
  const events: TimelineEvent[] = [
    ...news.map((n) => eventFromNews(symbol, n)),
    ...filings.map((f) => eventFromFiling(symbol, f)).filter((e): e is TimelineEvent => e != null),
    ...eventsFromSectorRotation(symbol, sector),
    ...eventsFromScannerCache(symbol, sector),
    ...alertEvents,
  ];

  putTimelineEvents(events);
  putScannerCache(syncKey, "1"); // marker only — presence + scanner_cache's 15-min TTL is the rate limit
}

/**
 * Sync a sector-level timeline (scope "sector"): sector-rotation leadership
 * changes + cached Scanner events tagged with this sector. No per-symbol news
 * fetch — sector timelines are intentionally sourced only from engines that
 * reason at the sector level, not diluted with single-company headlines.
 * Stored under `symbol = SECTOR.toUpperCase()` so lookups stay consistent
 * with listTimelineEvents()'s case-normalizing query.
 */
export function syncSectorTimeline(sector: string): void {
  const syncKey = `timeline-sync:sector:${sector}`;
  if (getScannerCache(syncKey)) return;
  const symbolKey = sector.toUpperCase();
  const events = [...eventsFromSectorRotation(symbolKey, sector), ...eventsFromScannerCache(symbolKey, sector)];
  putTimelineEvents(events);
  putScannerCache(syncKey, "1");
}

/* -------------------------------------------------------------------------- */
/* Feed assembly — read, filter, merge thesis evolution                       */
/* -------------------------------------------------------------------------- */

function applyFilters(events: TimelineEvent[], filters?: TimelineFilters): TimelineEvent[] {
  if (!filters) return events;
  return events.filter((e) => {
    if (filters.fromDate && e.timestamp < filters.fromDate) return false;
    if (filters.toDate && e.timestamp > filters.toDate) return false;
    if (filters.categories && filters.categories.length > 0 && !filters.categories.includes(e.category)) return false;
    if (filters.minImportance != null && e.importanceScore < filters.minImportance) return false;
    if (filters.minConfidence != null && e.confidenceScore < filters.minConfidence) return false;
    if (filters.impact && e.impact !== filters.impact) return false;
    if (filters.affectedSegment && e.affectedSegment !== filters.affectedSegment) return false;
    if (filters.relatedMetric && !e.relatedMetrics.includes(filters.relatedMetric)) return false;
    if (filters.catalystOnly && e.catalystStatus !== "pending" && e.catalystStatus !== "realized") return false;
    if (filters.openThesisOnly && e.catalystStatus !== "pending") return false;
    return true;
  });
}

/** Resolve a scope + id into the concrete symbol set it covers. */
export function resolveScopeSymbols(scope: TimelineScope, id: string): { symbols: string[]; label: string } {
  if (scope === "symbol" || scope === "sector") return { symbols: [id.toUpperCase()], label: id };
  if (scope === "portfolio") {
    const holdings = listPortfolio().slice(0, 12);
    return { symbols: holdings.map((h) => h.symbol), label: "Portfolio" };
  }
  const watch = listWatchlist().slice(0, 12);
  return { symbols: watch.map((w) => w.symbol), label: "Watchlist" };
}

/** Read persisted events for a scope, apply filters, attach thesis evolution (symbol scope only). */
export function getTimelineFeed(scope: TimelineScope, id: string, filters?: TimelineFilters): TimelineFeed {
  const { symbols } = resolveScopeSymbols(scope, id);
  const raw = symbols.length === 1 ? listTimelineEvents(symbols[0]) : listTimelineEventsForSymbols(symbols);
  const thesisEvolution = scope === "symbol" ? computeThesisEvolution(id.toUpperCase(), raw) : null;

  const withThesis = thesisEvolution
    ? raw.map((e) => {
        const point = thesisEvolution.points.find((p) => p.eventId === e.id);
        return point ? { ...e, thesisImpact: point.direction } : e;
      })
    : raw;

  const events = applyFilters(withThesis, filters).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    scope,
    id,
    symbols,
    events,
    thesisEvolution,
    generatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Thesis Evolution — deterministic bounded walk over important events        */
/* -------------------------------------------------------------------------- */

const THESIS_MIN_IMPORTANCE = 50;

/** Pure: walk chronologically through important events, tracking a bounded thesis-confidence score. */
export function computeThesisEvolution(symbol: string, events: TimelineEvent[]): ThesisEvolution {
  const chronological = [...events]
    .filter((e) => e.importanceScore >= THESIS_MIN_IMPORTANCE)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let confidence = 50;
  const points: ThesisEvolutionPoint[] = chronological.map((e) => {
    const magnitude = (e.importanceScore / 100) * 8; // each important event moves the needle up to ~8 points
    const direction: ThesisDirection = e.impact === "bullish" ? "strengthened" : e.impact === "bearish" ? "weakened" : "unchanged";
    if (direction === "strengthened") confidence = Math.min(100, confidence + magnitude);
    else if (direction === "weakened") confidence = Math.max(0, confidence - magnitude);

    return {
      eventId: e.id,
      timestamp: e.timestamp,
      title: e.title,
      direction,
      reason: `${e.category.replace(/_/g, " ")} (${e.impact}, importance ${e.importanceScore}/100)`,
      thesisConfidence: Math.round(confidence),
    };
  });

  const currentStance: ThesisDirection =
    points.length === 0 ? "unchanged" : points[points.length - 1].direction;

  return { symbol, points, currentConfidence: Math.round(confidence), currentStance };
}

/** Look up one persisted event by id within a symbol's history. */
export function findTimelineEvent(symbol: string, eventId: string): { event: TimelineEvent; allEvents: TimelineEvent[] } | null {
  const allEvents = listTimelineEvents(symbol);
  const event = allEvents.find((e) => e.id === eventId);
  return event ? { event, allEvents } : null;
}

/* -------------------------------------------------------------------------- */
/* AI-backed event detail panel (on-demand, cached)                           */
/* -------------------------------------------------------------------------- */

interface RawDetailResponse {
  executiveSummary: string;
  background: string;
  rootCause: string;
  immediateReaction: string;
  longTermImplications: string;
  supportingEvidence: string[];
  bullCase: string[];
  bearCase: string[];
  historicalContext: string;
  currentRelevance: string;
  investmentTakeaway: string;
  confidence: number;
}

function buildDetailPrompt(event: TimelineEvent, related: TimelineEvent[]): string {
  const relatedDesc = related.length
    ? related.map((r) => `- [${r.timestamp.slice(0, 10)}] ${r.title} (${r.category}, ${r.impact})`).join("\n")
    : "No closely related events found in the timeline.";

  return `You are an institutional equity analyst writing a detailed note on one event in ${event.symbol}'s investment timeline.

EVENT: ${event.title}
CATEGORY: ${event.category.replace(/_/g, " ")}
DATE: ${event.timestamp.slice(0, 10)}
IMPACT: ${event.impact}
SOURCE: ${event.source.description}

RELATED EVENTS IN THE TIMELINE:
${relatedDesc}

Using only the facts above (do not invent numbers or events not present here), write an institutional research note.

Return ONLY valid JSON:
{
  "executiveSummary": "<2-3 sentences: what happened and why it matters>",
  "background": "<context needed to understand this event>",
  "rootCause": "<what caused this event>",
  "immediateReaction": "<how markets/investors likely reacted>",
  "longTermImplications": "<what this means for the business over time>",
  "supportingEvidence": ["<fact 1>", "<fact 2>"],
  "bullCase": ["<reason this is good for the investment thesis>"],
  "bearCase": ["<reason this is bad for the investment thesis>"],
  "historicalContext": "<how this compares to similar past events for this company/sector>",
  "currentRelevance": "<is this still relevant today, or has it been superseded>",
  "investmentTakeaway": "<one actionable sentence for an investor today>",
  "confidence": <0-100 integer, how confident you are in this analysis given the available evidence>
}`;
}

/** AI-generated rich detail panel for one timeline event. Cached (scanner_cache, 15-min TTL). */
export async function explainTimelineEvent(event: TimelineEvent, allEvents: TimelineEvent[]): Promise<TimelineEventDetail> {
  const cacheKey = `timeline-detail:${event.id}`;
  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as TimelineEventDetail;
    } catch {
      // fall through and regenerate
    }
  }

  const related = allEvents
    .filter((e) => e.id !== event.id && Math.abs(new Date(e.timestamp).getTime() - new Date(event.timestamp).getTime()) < 90 * 86_400_000)
    .slice(0, 5);

  let parsed: RawDetailResponse | null = null;
  try {
    const raw = await runPrompt("timeline-analysis", buildDetailPrompt(event, related), { maxTokens: 1800, json: true });
    parsed = extractJson<RawDetailResponse>(raw);
  } catch {
    parsed = null;
  }

  const detail: TimelineEventDetail = {
    eventId: event.id,
    executiveSummary: parsed?.executiveSummary ?? "Unable to generate an explanation — AI unavailable.",
    background: parsed?.background ?? "",
    rootCause: parsed?.rootCause ?? "",
    immediateReaction: parsed?.immediateReaction ?? "",
    longTermImplications: parsed?.longTermImplications ?? "",
    supportingEvidence: parsed?.supportingEvidence ?? [],
    bullCase: parsed?.bullCase ?? [],
    bearCase: parsed?.bearCase ?? [],
    historicalContext: parsed?.historicalContext ?? "",
    currentRelevance: parsed?.currentRelevance ?? "",
    investmentTakeaway: parsed?.investmentTakeaway ?? "",
    confidence: Math.max(0, Math.min(100, parsed?.confidence ?? 0)),
    relatedEventIds: related.map((r) => r.id),
    generatedAt: new Date().toISOString(),
  };

  putScannerCache(cacheKey, JSON.stringify(detail));
  return detail;
}

/* -------------------------------------------------------------------------- */
/* "What Changed Since Then?"                                                 */
/* -------------------------------------------------------------------------- */

interface RawWhatChangedResponse {
  assumptionsValidated: string[];
  assumptionsFailed: string[];
  managementExecution: string;
  currentRelevance: string;
}

function buildWhatChangedPrompt(
  fromEvent: TimelineEvent,
  subsequent: TimelineEvent[],
  stockResponsePercent: number | null,
): string {
  const subsequentDesc = subsequent.length
    ? subsequent.slice(0, 12).map((e) => `- [${e.timestamp.slice(0, 10)}] ${e.title} (${e.category}, ${e.impact})`).join("\n")
    : "No further events recorded since then.";
  const responseDesc =
    stockResponsePercent != null ? `${stockResponsePercent >= 0 ? "+" : ""}${stockResponsePercent.toFixed(1)}%` : "unavailable";

  return `You are an institutional analyst reviewing how a past event in ${fromEvent.symbol}'s timeline played out.

ORIGINAL EVENT: ${fromEvent.title} (${fromEvent.timestamp.slice(0, 10)}, ${fromEvent.category.replace(/_/g, " ")}, ${fromEvent.impact})

SUBSEQUENT EVENTS:
${subsequentDesc}

STOCK PRICE RESPONSE SINCE THIS EVENT: ${responseDesc}

Using only the facts above, assess what changed. Return ONLY valid JSON:
{
  "assumptionsValidated": ["<assumption from the original event that proved correct>"],
  "assumptionsFailed": ["<assumption that did not hold up>"],
  "managementExecution": "<1-2 sentences on how management executed against what was signaled>",
  "currentRelevance": "<is the original event still relevant to the thesis today>"
}`;
}

/** "What Changed Since Then?" — deterministic subsequent-event lookup + stock response, AI narrative. */
export async function computeWhatChanged(symbol: string, eventId: string): Promise<WhatChangedResult | null> {
  const all = listTimelineEvents(symbol);
  const fromEvent = all.find((e) => e.id === eventId);
  if (!fromEvent) return null;

  const subsequentEvents = all
    .filter((e) => e.id !== eventId && e.timestamp > fromEvent.timestamp)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const history = await getHistory(symbol, 3650).catch(() => []);
  const fromDate = new Date(fromEvent.timestamp);
  const startPoint = history.find((p) => new Date(p.date) >= fromDate) ?? null;
  const endPoint = history[history.length - 1] ?? null;
  const stockResponsePercent =
    startPoint && endPoint && startPoint.close > 0
      ? ((endPoint.close - startPoint.close) / startPoint.close) * 100
      : null;

  let parsed: RawWhatChangedResponse | null = null;
  try {
    const raw = await runPrompt("timeline-analysis", buildWhatChangedPrompt(fromEvent, subsequentEvents, stockResponsePercent), {
      maxTokens: 1000,
      json: true,
    });
    parsed = extractJson<RawWhatChangedResponse>(raw);
  } catch {
    parsed = null;
  }

  return {
    fromEventId: eventId,
    subsequentEvents: subsequentEvents.slice(0, 20),
    assumptionsValidated: parsed?.assumptionsValidated ?? [],
    assumptionsFailed: parsed?.assumptionsFailed ?? [],
    managementExecution: parsed?.managementExecution ?? "Unable to generate — AI unavailable.",
    stockResponsePercent,
    currentRelevance: parsed?.currentRelevance ?? "",
    generatedAt: new Date().toISOString(),
  };
}
