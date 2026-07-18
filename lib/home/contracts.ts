/**
 * Home data contracts — the shapes that cross the server/client boundary.
 *
 * Kept separate from `digest.ts` (which imports the engines, and therefore
 * `node:sqlite`) so that presentation components can import the types without
 * dragging the server into the client bundle. Every module's props are one of
 * these slices.
 *
 * Each slice carries its own `status`, not just its data: a module that has no
 * portfolio, a module whose Scanner snapshot is stale, and a module that failed
 * are three different facts and the UI must be able to tell them apart. This is
 * the same `CardStatus` discipline lib/mission-control.ts already uses.
 */

import type { CardStatus, ActionQueueItem, OpportunitySnapshotItem, UpcomingEventLite, SectorAttentionChange } from "../mission-control";
import type { Freshness } from "../provenance";
import type { TrackRecord } from "../decision-journal";
import type { DecisionCard } from "../portfolio/engines/decision";
import type { WatchlistAlert } from "../types";

export type { CardStatus, ActionQueueItem, OpportunitySnapshotItem, UpcomingEventLite, SectorAttentionChange };

/* ------------------------------------------------------------------ */
/* Module 5 — Market Intelligence                                      */
/* ------------------------------------------------------------------ */

/** One instrument on the market tape. `null` price/change means the feed omitted it. */
export interface MarketTicker {
  symbol: string;
  label: string;
  price: number | null;
  changePct: number | null;
  /**
   * A short recent-close series for the card's sparkline, oldest→newest.
   * Null when no history was fetched for this symbol (only the curated Market
   * Pulse instruments carry one — fetching a series for all ~17 tape symbols on
   * every digest would be overhead the platform mandate exists to prevent).
   */
  series?: number[] | null;
}

export type MarketGroupId = "indices" | "volatility" | "rates" | "commodities" | "currencies" | "crypto";

export interface MarketGroup {
  id: MarketGroupId;
  label: string;
  tickers: MarketTicker[];
}

/**
 * An in-house sentiment gauge. This is NOT CNN's Fear & Greed Index — there is
 * no free API for that one, and inventing a number and calling it theirs would
 * be a lie. This is computed from inputs we already fetch (see
 * lib/home/sentiment.ts), and every surface that renders it must say so.
 */
export interface SentimentGauge {
  /** 0 = extreme fear, 100 = extreme greed. */
  score: number;
  label: "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed";
  /** The components that produced the score, so the number is auditable rather than magic. */
  components: { name: string; value: number | null; contribution: number }[];
  /** How many of the three components had data. A 1-of-3 gauge is much weaker than a 3-of-3. */
  confidence: "high" | "medium" | "low";
}

export interface MarketIntelligence {
  status: CardStatus;
  groups: MarketGroup[];
  breadthPct: number | null;
  sentiment: SentimentGauge | null;
  regime: { trend: string; summary: string; breadthPct: number | null } | null;
  /**
   * Sector leadership changes, filtered to sectors the user actually holds.
   * Carried here (rather than as its own module) because a rotation you have no
   * exposure to is trivia, and one you do have exposure to is market context —
   * which is what this module is.
   */
  sectorAttention: SectorAttentionChange[];
}

/* ------------------------------------------------------------------ */
/* Module 4 — Portfolio Pulse                                          */
/* ------------------------------------------------------------------ */

export interface PulseMover {
  symbol: string;
  changePct: number;
  changeDollar: number;
}

/**
 * One spoke of the Portfolio Health radar. Read directly from a scored
 * `HealthDimension` — the radar is a projection of the health engine's real
 * dimensions, never a second, invented set of axes.
 */
export interface HealthRadarAxis {
  /** The health dimension's own name (e.g. "Diversification", "Liquidity"). */
  axis: string;
  /** Short label for tight radar rendering (e.g. "Divers.", "Income"). */
  shortLabel: string;
  /** 0-100. */
  score: number;
  /** False when the dimension abstained or was thinly evidenced — drawn faded. */
  covered: boolean;
}

export interface PortfolioPulse {
  status: CardStatus;
  healthScore: number | null;
  healthGrade: string | null;
  totalValue: number;
  todayChangePct: number;
  todayChangeDollar: number;
  bestPerformer: PulseMover | null;
  worstPerformer: PulseMover | null;
  largestRisk: { title: string; description: string } | null;
  largestOpportunity: { symbol: string; reason: string } | null;
  cashPct: number | null;
  diversificationScore: number | null;
  /** Positive = overweight vs. target. Only the worst offender. */
  largestDrift: { label: string; driftPct: number } | null;
  /** Share of value that is marked to market rather than self-reported. */
  marketPricedPct: number;
  /** The health engine's dimensions, projected onto radar spokes. */
  radar: HealthRadarAxis[];
  /** Highest-scoring covered dimension — what the book does best. */
  biggestStrength: { label: string; score: number } | null;
  /** Lowest-scoring covered dimension — the health score's biggest drag. */
  biggestWeakness: { label: string; score: number } | null;
  /** Coverage-adjusted share of health weight that was actually scoreable, 0-100. */
  healthCoveragePct: number | null;
}

/* ------------------------------------------------------------------ */
/* Threat Center — portfolio vulnerabilities                           */
/* ------------------------------------------------------------------ */

export type ThreatCategory =
  | "inflation"
  | "rates"
  | "currency"
  | "concentration"
  | "liquidity"
  | "drawdown"
  | "correlation"
  | "credit"
  | "scenario";

/**
 * One portfolio vulnerability. Every field is read from an engine that already
 * measured it — `risk` (duration, inflation/credit sensitivity, FX%, illiquid%,
 * VaR), `concentration` findings, or the harshest stress `scenario`. The module
 * ranks and narrates; it does not invent a risk number.
 */
export interface ThreatItem {
  id: string;
  title: string;
  category: ThreatCategory;
  severity: "high" | "medium" | "low";
  /** 0-1 likelihood when the source expresses one (scenarios do); else null. */
  probability: number | null;
  /** Estimated % of portfolio value at risk if it materializes. Negative = loss. */
  impactPct: number | null;
  detail: string;
  mitigation: string;
  href: string;
}

export interface ThreatCenter {
  status: CardStatus;
  threats: ThreatItem[];
  /** Portfolio drawdown under the single harshest modelled scenario, in %. */
  worstCasePct: number | null;
}

/* ------------------------------------------------------------------ */
/* Performance Attribution — what drove the return                     */
/* ------------------------------------------------------------------ */

export type AttributionKind = "holding" | "sector" | "cash" | "income" | "benchmark";

/**
 * One contribution row. Attribution is on cumulative unrealized P&L (which the
 * report carries per-holding), not intraday — the digest ships no per-holding
 * live quote to the client, so an honest "today by holding" is not derivable
 * here. Cumulative attribution is, and it is labelled as such.
 */
export interface AttributionRow {
  id: string;
  label: string;
  kind: AttributionKind;
  /** Contribution to total return, in percentage points of cost basis. */
  contributionPct: number;
  contributionDollar: number;
}

export interface PerformanceAttribution {
  status: CardStatus;
  totalReturnPct: number;
  totalReturnDollar: number;
  /** Top positive and negative contributors, interleaved and ranked by magnitude. */
  byHolding: AttributionRow[];
  bySector: AttributionRow[];
  /** Cash drag: the opportunity cost of the idle-cash weight. Null when no cash. */
  cashDrag: AttributionRow | null;
  benchmark: { symbol: string; excessPct: number } | null;
}

/* ------------------------------------------------------------------ */
/* Timeline & Intelligence — the event feeds                           */
/* ------------------------------------------------------------------ */

export type TimelineKind = "activity" | "notification" | "alert" | "event";
export type TimelineTone = "positive" | "negative" | "warning" | "neutral";

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  /** ISO timestamp. Past for history; future for upcoming events (countdown). */
  at: string;
  /** True when `at` is in the future — the UI shows a countdown, not "ago". */
  upcoming: boolean;
  tone: TimelineTone;
  symbol: string | null;
  href: string | null;
}

export interface TimelineFeed {
  status: CardStatus;
  items: TimelineItem[];
}

/* ------------------------------------------------------------------ */
/* The Attention Queue — one ranked, finishable stream                 */
/* ------------------------------------------------------------------ */

/**
 * The five things that can need a decision. Deliberately kind-tagged rather
 * than source-tagged: the user's question is "what needs me?", and a threat, a
 * triggered alert, and an upcoming catalyst are all answers to it regardless of
 * which engine produced them. The kind drives the chip label and the tie-break
 * precedence, never a separate ranking heuristic — one score ranks them all.
 */
export type AttentionKind = "action" | "threat" | "alert" | "event" | "signal";

/**
 * One item in the Attention Queue. Every field except `score`, `id`, and
 * `mergedHrefs` is supplied by a feeder (a pure transform of a digest slice);
 * `score` is computed by `lib/home/attention.ts` alone (§4.2), never by a
 * feeder. This is the single unit of importance that makes cross-module ranking
 * possible — the contract RC3 said never existed.
 */
export interface AttentionItem {
  /** Stable per story instance — used as the React key and focus target. */
  id: string;
  /**
   * Story identity, severity band included (§12). Two feeders describing the
   * same story collide here (dedupe); a *materially worse* version of the same
   * story has a different band and therefore a different key, so it resurfaces
   * past a prior dismissal (§19.4).
   */
  dedupeKey: string;
  kind: AttentionKind;
  symbol: string | null;
  /** ≤ 60 chars. */
  headline: string;
  /** One sentence. */
  rationale: string;
  /** 0–100, geometric mean of the three inputs. Computed by the engine only. */
  score: number;
  /** The three 0–1 inputs, kept for calibration/debugging and score audit. */
  impact: number;
  urgency: number;
  confidence: number;
  /** ISO, for dated catalysts; null for undated items. */
  occursAt: string | null;
  /** The one deep link into the owning tool. Verb-labeled. */
  primaryAction: { label: string; href: string };
  /** Feeder id, for degraded-state attribution. */
  source: string;
  /** Extra links merged in from deduped sibling stories (§12). */
  mergedHrefs?: { label: string; href: string }[];
}

/** What a feeder emits — the engine assigns `score`, `id`, and `mergedHrefs`. */
export type AttentionSeed = Omit<AttentionItem, "score" | "mergedHrefs">;

/**
 * A persisted dismissal. `expiresAt` is an epoch-ms deadline after which the
 * story is allowed back into the queue (per-kind TTL, §12); events store their
 * catalyst time so the dismissal simply lapses when the date passes.
 */
export interface AttentionDismissal {
  dedupeKey: string;
  dismissedAt: number;
  expiresAt: number;
}

export interface AttentionQueue {
  status: CardStatus;
  /** Ranked, deduped, dismissal-filtered. The UI caps how many it *shows*. */
  items: AttentionItem[];
  /** True open count, even when the UI caps the visible rows (§12, §18). */
  openCount: number;
  /** Feeder ids that threw — drives the degraded footer, never a blank zone (§11). */
  degradedFeeders: string[];
  /** When the queue was last assembled — the "you're clear" timestamp (§11). */
  reviewedAt: string;
}

/* ------------------------------------------------------------------ */
/* Module 3 — Top Recommended Actions                                  */
/* ------------------------------------------------------------------ */

/**
 * The homepage's action row. Built from the portfolio engine's `DecisionCard`
 * (which already carries decisionScore / priority / confidence / expected
 * benefit / why) when a portfolio exists, and falls back to Mission Control's
 * lighter `ActionQueueItem` (alerts, watchlist triggers, notifications) when it
 * doesn't. No ranking math is done here — both sources arrive pre-ranked.
 */
export interface RecommendedAction {
  id: string;
  symbol: string | null;
  /** e.g. "ADD", "REDUCE", "REVIEW". */
  action: string;
  title: string;
  reason: string;
  /** 0-100. Null for queue items, which carry severity instead of a score. */
  decisionScore: number | null;
  priority: number;
  /** 0-1. Null when the source doesn't quantify it. */
  confidence: number | null;
  expectedImpact: string | null;
  expectedImprovement: string | null;
  severity: "high" | "medium" | "low";
  href: string;
  source: "decision" | "queue";
}

export interface RecommendedActions {
  status: CardStatus;
  actions: RecommendedAction[];
  /** True when actions come from the full decision engine rather than the alert queue. */
  fromDecisionEngine: boolean;
  /**
   * Whether a portfolio exists at all.
   *
   * Needed to tell two very different situations apart, which `fromDecisionEngine:
   * false` alone conflates: "you have no portfolio, so there is nothing to
   * optimize" versus "you have 18 holdings and the engine found no trade worth
   * making". The second is a *good* outcome and must not be reported as the
   * first — telling a user with a full book to "add holdings" is nonsense.
   */
  hasPortfolio: boolean;
}

/* ------------------------------------------------------------------ */
/* Module 7 — Watchlist Intelligence                                   */
/* ------------------------------------------------------------------ */

export interface WatchlistBucket {
  id: "buy" | "near-buy" | "high-risk";
  label: string;
  symbols: string[];
}

export interface WatchlistIntelligence {
  status: CardStatus;
  total: number;
  buckets: WatchlistBucket[];
  alerts: WatchlistAlert[];
  upcomingEarnings: { symbol: string; date: string }[];
}

/* ------------------------------------------------------------------ */
/* Module 9 — Portfolio Performance                                    */
/* ------------------------------------------------------------------ */

export interface PortfolioPerformanceSummary {
  status: CardStatus;
  /**
   * Annualized money-weighted return, in percent.
   *
   * Null when the portfolio is too young to annualize (see `holdingDays`) or
   * when the lot ledger can't solve for a rate. Annualizing a few days of
   * history is arithmetically valid and completely meaningless: a real 3-day-old
   * portfolio down 4.8% produced an XIRR of −99.98%/yr, which the card duly
   * reported as "−100.0%/yr". That is not a performance figure, it is an
   * extrapolation artifact, and showing it next to a benchmark implies a
   * comparison that does not exist.
   */
  xirrPct: number | null;
  /** How long the oldest lot has been held. Drives the annualization gate above. */
  holdingDays: number;
  /** Cumulative (NOT annualized) return, in percent. Always meaningful. */
  totalReturnPct: number;
  totalReturnDollar: number;
  benchmark: { symbol: string; portfolioPct: number; benchmarkPct: number; excessPct: number } | null;
}

/**
 * Below this, an annualized return says more about the calendar than about the
 * portfolio. A quarter is the shortest window over which the extrapolation is
 * not actively misleading.
 */
export const MIN_DAYS_TO_ANNUALIZE = 90;

/* ------------------------------------------------------------------ */
/* Module 10 — Continue Where You Left Off                             */
/* ------------------------------------------------------------------ */

export type ActivityKind = "research" | "screen" | "report" | "portfolio" | "watchlist" | "compare";

export interface ActivityEntry {
  id: number;
  kind: ActivityKind;
  ref: string;
  label: string;
  href: string;
  at: string;
}

export interface RecentActivity {
  status: CardStatus;
  entries: ActivityEntry[];
}

/* ------------------------------------------------------------------ */
/* Modules 1, 2 — the AI brief (streamed separately from the digest)   */
/* ------------------------------------------------------------------ */

/**
 * One AI call produces all three narrative surfaces. Ollama serializes
 * requests, so three separate "generate a paragraph" calls would queue behind
 * each other and the homepage would take three model round-trips to settle —
 * a cost this codebase has already measured and rejected once (see
 * lib/platform's notes on per-section AI generation).
 *
 * Sections stream in as they complete, so Today's Brief paints while the longer
 * note is still being written.
 */
export interface HomeBrief {
  /** Module 1 — 2-4 sentences. */
  headline: string;
  /** Module 2 — the long-form PM note. */
  note: {
    regime: string;
    opportunities: string;
    risks: string;
    portfolio: string;
    sectors: string;
    macro: string;
    recommendations: string[];
  } | null;
  /** Module 4's narrative line. */
  portfolioSummary: string;
  aiGenerated: boolean;
  generatedAt: string;
}

/** Streaming envelope: each chunk fills in part of the brief. */
export type HomeBriefChunk =
  | { type: "headline"; text: string }
  | { type: "portfolioSummary"; text: string }
  | { type: "note"; note: NonNullable<HomeBrief["note"]> }
  | { type: "done"; aiGenerated: boolean; generatedAt: string }
  | { type: "error"; message: string };

/* ------------------------------------------------------------------ */
/* The digest                                                          */
/* ------------------------------------------------------------------ */

/**
 * Everything the homepage needs in one deterministic payload. Explicitly does
 * NOT include the AI brief: the digest must paint immediately, and AI is slow
 * and optional. The brief arrives over its own stream.
 */
export interface HomeDigest {
  generatedAt: string;
  /**
   * The Attention Queue — the page's centerpiece. One ranked, dismissible
   * stream merging the action/threat/alert/event/signal feeders. Rides the
   * digest (deterministic, no AI in its paint path).
   */
  attention: AttentionQueue;
  marketIntelligence: MarketIntelligence;
  portfolioPulse: PortfolioPulse;
  recommendedActions: RecommendedActions;
  threats: ThreatCenter;
  attribution: PerformanceAttribution;
  opportunityFeed: {
    status: CardStatus;
    opportunities: OpportunitySnapshotItem[];
    scannerFreshness: Freshness | null;
  };
  /** Full chronological feed of meaningful events (past + upcoming). */
  timeline: TimelineFeed;
  /** The high-signal, needs-interpretation subset — a filtered view of the feed. */
  intelligence: TimelineFeed;
  watchlistIntelligence: WatchlistIntelligence;
  upcomingEvents: { status: CardStatus; events: UpcomingEventLite[] };
  performance: PortfolioPerformanceSummary;
  activity: RecentActivity;
  calibration: { status: CardStatus; trackRecord: TrackRecord | null; eligible: boolean };
  /** Deterministic fallback text, used until (or instead of) the AI stream. */
  fallbackBriefing: string;
}

export type { DecisionCard };
