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
import type { Metric } from "../metric";
import type { Freshness } from "../provenance";
import type { DecisionCard, WhyExplanation } from "../portfolio/engines/decision";
import type { IdeaStage, WatchlistAlert } from "../types";

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
  /** Session day (exchange TZ) `changePct` describes; null = unknown (lib/day-change). */
  sessionDate?: string | null;
  /** Epoch ms of the quote's last trade. */
  asOf?: number | null;
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
  /**
   * The 11 SPDR sector ETFs' session moves — the Today page's strong→weak
   * strip. Rides the same batched quote call as the tape (`label` carries the
   * sector name, not the ETF's). Empty when the provider degraded.
   */
  sectors: MarketTicker[];
}

/* ------------------------------------------------------------------ */
/* Module 4 — Portfolio Pulse                                          */
/* ------------------------------------------------------------------ */

/**
 * A homepage mover. `dayChange` and `sinceCost` are structurally distinct
 * stamped Metrics (audit F-22g) — the old shape's single `changePct` was
 * silently since-cost P&L rendered under a "today" label.
 */
export interface PulseMover {
  symbol: string;
  dayChange: Metric<"day"> | null;
  sinceCost: Metric<"sinceCost"> | null;
  dayDollar: number | null;
  plDollar: number | null;
}

/**
 * One row of the Book card's "top contributors (today)" list. `bps` is the
 * position's day P&L over the whole book's previous-close value ×10000 — a
 * *contribution* to the portfolio's day move, not the position's own return.
 * Computed in lib/home/pulse.ts from the report's stamped day moves; the same
 * non-stale gate the movers use applies, so a dead quote cannot contribute.
 */
export interface DayContributor {
  symbol: string;
  /** Holding display name, for the row's secondary text. */
  name: string;
  /** Contribution to the book's day move, in basis points of previous-close value. */
  bps: number;
  /** The underlying day P&L in base currency. */
  dayDollar: number;
}

/**
 * One of the book's largest positions — weight and the session's move. Read
 * from the report's holdings + stamped day moves; nothing recomputed here.
 */
export interface PulsePosition {
  symbol: string;
  name: string;
  /** % of portfolio value. */
  weightPct: number;
  /** Session move vs previous close, %; null when the quote couldn't price it. */
  dayChangePct: number | null;
}

/** One asset-class sleeve of the book — share of value, %, descending. */
export interface PulseSleeve {
  key: string;
  label: string;
  pct: number;
}

/**
 * One spoke of the Portfolio Alignment radar. Read directly from a scored
 * `AlignmentTheme` — the radar is a projection of the alignment engine's real
 * themes, never a second, invented set of axes.
 */
export interface AlignmentRadarAxis {
  /** The alignment theme's own label (e.g. "Concentration", "Liquidity"). */
  axis: string;
  /** Short label for tight radar rendering (e.g. "Concentr.", "Income"). */
  shortLabel: string;
  /** 0-100. */
  score: number;
  /** False when the theme was unrated (opted out / insufficient data) — drawn faded. */
  covered: boolean;
}

/**
 * One theme of the alignment score, carried with enough of the engine's own
 * arithmetic (priority share, renormalized over rated themes) that the client
 * can show exactly how the total was produced. Never recomputed client-side
 * beyond display math.
 */
export interface AlignmentFactor {
  label: string;
  /** The theme's own 0-100 score; null = unrated (opted out or insufficient data). */
  score: number | null;
  /** Share of the renormalized priority weight, 0-1. Null when unrated. */
  weightShare: number | null;
  /** weightShare × score — this theme's points inside the total. */
  contributionPts: number | null;
  covered: boolean;
  /** Share of portfolio value the theme's facts could see, 0-100. Disclosure only. */
  evidencePct: number;
  /** Why the theme carries no score, when it doesn't. */
  unratedReason: "opted_out" | "insufficient_data" | null;
}

export interface PortfolioPulse {
  status: CardStatus;
  /** Portfolio-alignment score vs the investor's own policy. Null = unscored. */
  alignmentScore: number | null;
  /** "Strongly aligned" … "Misaligned"; null when unscored. */
  alignmentLabel: string | null;
  /** False while the score rests on assumed defaults the investor never set. */
  alignmentConfirmed: boolean;
  /** The most severe policy mismatch, one sentence in real units. Null = none. */
  topMismatch: string | null;
  totalValue: number;
  todayChangePct: number;
  todayChangeDollar: number;
  bestPerformer: PulseMover | null;
  worstPerformer: PulseMover | null;
  /**
   * Non-null when the movers describe a FINISHED session — e.g. "Markets
   * closed · Fri, Aug 1 close" — so a recording made outside US hours reads as
   * deliberate, not stale (audit F-22 amendment 2). Null while any mover's
   * session is current.
   */
  sessionNote: string | null;
  /** Epoch ms the pulse's figures were assembled (report generation time). */
  asOf: number;
  /** Session day the aggregate day-change figures describe; null = no movers. */
  sessionDate: string | null;
  largestRisk: { title: string; description: string } | null;
  largestOpportunity: { symbol: string; reason: string } | null;
  cashPct: number | null;
  diversificationScore: number | null;
  /** Positive = overweight vs. target. Only the worst offender. */
  largestDrift: { label: string; driftPct: number } | null;
  /**
   * Cumulative return on cost across the WHOLE book, in percent — the same
   * `report.totalReturn` the /portfolio page shows in its "Total return" tile.
   *
   * This exists so the two surfaces cannot disagree. The homepage previously
   * showed the lot-ledger return here (`PortfolioPerformanceSummary.totalReturnPct`),
   * which is computed over only the positions that have a transaction history —
   * a different population from the full report. The result was Home reading
   * "−7.3% since inception" while /portfolio read "−0.1% total return" for the
   * same book at the same moment, with nothing on either screen to explain it.
   * The money-weighted (XIRR) figure is still shown, but explicitly labelled as
   * such rather than as an unqualified "return".
   */
  totalReturnOnCostPct: number | null;
  /** Share of value that is marked to market rather than self-reported. */
  marketPricedPct: number;
  /** The alignment engine's themes, projected onto radar spokes. */
  radar: AlignmentRadarAxis[];
  /** Highest-scoring rated theme — where the book best matches the policy. */
  biggestStrength: { label: string; score: number } | null;
  /** Lowest-scoring rated theme — the alignment score's biggest drag. */
  biggestWeakness: { label: string; score: number } | null;
  /** Priority-weighted evidence behind the score, 0-100. Disclosure only. */
  alignmentEvidencePct: number | null;
  /**
   * The full theme decomposition behind `alignmentScore`, for the
   * click-to-explain UI. Read from the alignment engine's own themes —
   * the homepage adds no arithmetic of its own beyond the renormalization
   * the engine itself performs.
   */
  alignmentFactors: AlignmentFactor[];
  /**
   * Today's largest contributions to the book's day move (top two positive +
   * the largest negative when the sign mix allows; otherwise the top three by
   * magnitude). Same source as the movers — the report's stamped day moves.
   */
  topContributors: DayContributor[];
  /**
   * The rest of the day move: the summed contribution of every position NOT in
   * `topContributors`, in bps of the same base. Guarantees the visible rows
   * plus this residual reconcile to the day P&L exactly (audit NI-01) — a
   * truncated list without a residual is an attribution that cannot reach its
   * own total. Null when there are no contributors at all.
   */
  topContributorsResidualBps: number | null;
  /**
   * Share of the book's value the day move could actually price (live-quoted
   * holdings over total value, 0-100). The day P&L percentage describes only
   * this slice; below ~95 the UI must say so next to the number.
   */
  dayCoveragePct: number | null;
  /** The largest positions by weight — the Today page's "top of book" table. */
  topPositions: PulsePosition[];
  /** Asset-class composition, descending by share. */
  sleeves: PulseSleeve[];
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
  /**
   * ISO time of the underlying observation, when the item describes one
   * (notification-backed alerts/actions). Dedupe keeps the NEWEST observation
   * of a story, and confidence decays with observation age (audit F-22d) —
   * the old max-score rule guaranteed the oldest, most extreme print won.
   */
  observedAt?: string | null;
  /** The one deep link into the owning tool. Verb-labeled. */
  primaryAction: { label: string; href: string };
  /** Feeder id, for degraded-state attribution. */
  source: string;
  /**
   * Cross-kind story identity (audit DU-03): when two feeders of DIFFERENT
   * kinds describe one story (the "USD Cash concentration" threat and the
   * "Trim USD Cash" action are the same story), they share this key and the
   * engine keeps the most ACTIONABLE one, merging the other's link. Null when
   * the story has no cross-kind twin.
   */
  storyKey?: string | null;
  /** Extra links merged in from deduped sibling stories (§12). */
  mergedHrefs?: { label: string; href: string }[];
  /**
   * Present when this story is the surface form of a decision thesis:
   * dismissing it then means "I considered this action" (written to the
   * shared decision memory), not merely "hide this card here".
   */
  thesis?: ActionThesis | null;
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
/**
 * The measured "current state → proposed action → resulting state" delta of a
 * decision, read verbatim from the engine's `ImpactEstimate` (which was itself
 * produced by *simulating* the trade, not estimating it). `alignmentAfter` is
 * `alignmentBefore + alignmentDelta` on the engine's exact (unrounded) score.
 * All three are null when the book is unscorable — an unknown delta is not 0.
 */
export interface ActionImpact {
  alignmentBefore: number | null;
  alignmentAfter: number | null;
  alignmentDelta: number | null;
  /** pp change in annualized volatility. Negative = less risky. Null = unmeasurable. */
  riskDeltaPp: number | null;
  /** Change in measured annual income (dividends, coupons, rent), in dollars. */
  incomeDeltaAnnual: number;
  /** Change in allocation HHI. Negative = better diversified. */
  diversificationDelta: number;
}

export interface RecommendedAction {
  id: string;
  symbol: string | null;
  /**
   * The engine's subject line for symbol-less holdings (e.g. "USD Cash") —
   * what the action is ABOUT. Used to join the action to the threat that
   * restates it (audit DU-03). Null for queue-sourced items.
   */
  subject: string | null;
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
  /** ISO time of the observation behind a queue item; null when engine-scored live. */
  observedAt?: string | null;
  /**
   * The engine's full IC memo (why / why now / why this amount / why not the
   * alternatives / why not nothing). Null for queue-sourced items, which were
   * never argued for — only flagged.
   */
  why: WhyExplanation | null;
  /** The simulated before → after portfolio state. Null for queue items. */
  impact: ActionImpact | null;
  /** Real count of simulate() runs behind this pick. Null for queue items. */
  alternativesEvaluated: number | null;
  /**
   * The underlying decision thesis (engines/decision-memory.ts) plus the
   * context a dismissal should be recorded with. Carried so that dismissing
   * this story ANYWHERE (Today included) writes the one shared decision
   * memory instead of a per-surface hide. Null for queue-sourced items.
   */
  thesis: ActionThesis | null;
}

/** The revival context a semantic dismissal stores — see decision-memory.ts. */
export interface ActionThesis {
  key: string;
  title: string;
  policyUpdatedAt: string | null;
  themeId: string | null;
  themeScore: number | null;
  subjectWeightPct: number | null;
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
 *
 * Re-exported from the engine that computes `holdingDays` rather than declared
 * again here. Three surfaces had each defined their own copy of this threshold, and
 * the Portfolio page's copy was applied to its own XIRR but not to the benchmark
 * comparison drawn from the same 18-day window — a divergence a shared constant
 * makes impossible.
 */
export { MIN_DAYS_TO_ANNUALIZE } from "../portfolio-performance";

/* ------------------------------------------------------------------ */
/* Equity curve — the Book card's 90-day portfolio-vs-benchmark line   */
/* ------------------------------------------------------------------ */

/** One day of the normalized comparison. Both values are index levels, 100 = window start. */
export interface EquityCurvePoint {
  /** YYYY-MM-DD trading day. */
  date: string;
  portfolio: number;
  /** Null when the benchmark series had no print for this day. */
  benchmark: number | null;
}

/**
 * A flow-adjusted daily return index over the trailing window, portfolio vs.
 * benchmark, both normalized to 100 at the window start so they share a scale.
 *
 * Built from the lot ledger plus daily adjusted closes (lib/home/equity-curve.ts).
 * Deliberately NOT a value line: a deposit mid-window would jump a value line
 * without any return having happened — the exact lie trajectory-panel.tsx
 * documents refusing to plot. Each day's growth factor strips that day's net
 * flow, so the line moves only when prices do.
 */
export interface EquityCurve {
  status: CardStatus;
  /** Requested trailing window, in calendar days. */
  windowDays: number;
  /** Ascending by date. May start later than the window on a young portfolio. */
  points: EquityCurvePoint[];
  /** The window's cumulative return for each line, in percent. Null when unpriceable. */
  portfolioPct: number | null;
  benchmarkPct: number | null;
  benchmarkSymbol: string;
  /** Share (0-100) of the book's end-of-window value the curve could actually price. */
  coveragePct: number | null;
}

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
 * One AI call produces all three narrative surfaces. Three separate
 * "generate a paragraph" calls would be three separate spends (and on the
 * old serializing local backend, three sequential round-trips) —
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
/* Change detection — what moved since the last visit                  */
/* ------------------------------------------------------------------ */

export type HomeChangeKind =
  | "alignment"
  | "regime"
  | "sentiment"
  | "attention-new"
  | "attention-resolved"
  | "opportunity-new"
  | "opportunity-score"
  | "threat-new"
  | "threat-escalated"
  | "watchlist-move"
  | "drift";

/**
 * The tone drives colour and ordering, not the copy: `worsened` and `new`
 * threats surface first because they are the ones that can cost money by being
 * missed. `improved` is real information too (a cleared queue, a healthier
 * book) — it is ranked, not hidden.
 */
export type HomeChangeTone = "improved" | "worsened" | "new" | "neutral";

export interface HomeChange {
  id: string;
  kind: HomeChangeKind;
  tone: HomeChangeTone;
  /** ≤ 70 chars — reads as a headline chip. */
  headline: string;
  /** One sentence, always stating the before → after so the delta is auditable. */
  detail: string;
  symbol: string | null;
  href: string | null;
  /** Ranking weight, computed by the diff engine from measured magnitudes. */
  magnitude: number;
}

/**
 * "Since your last visit". The baseline is the state at the end of the user's
 * previous session (promoted after a 45-minute gap between digest builds), so
 * refreshing within a session never resets what counts as "new".
 */
export interface ChangeFeed {
  status: CardStatus;
  /** ISO timestamp of the baseline being compared against. Null on first visit. */
  baselineAt: string | null;
  /** True the very first time the dashboard is ever built — nothing to diff yet. */
  firstVisit: boolean;
  /** Ranked, capped by the UI. Empty + !firstVisit = "nothing material changed". */
  changes: HomeChange[];
}

/* ------------------------------------------------------------------ */
/* Symbol context — the unified-intelligence join                      */
/* ------------------------------------------------------------------ */

/**
 * What the platform already knows about a symbol, joined once server-side and
 * shared by every module that renders that symbol. This is what makes the
 * dashboard feel like one brain: the queue, the radar, and the brief all see
 * the same research history, pipeline stage, and book exposure.
 */
export interface SymbolContext {
  symbol: string;
  /** % of portfolio value, when held. Null = not in the book. */
  heldWeightPct: number | null;
  /** Idea-pipeline stage, when tracked on the watchlist. Null = not tracked. */
  watchlistStage: IdeaStage | null;
  /** ISO timestamp of the most recent research session on this symbol. */
  lastResearchedAt: string | null;
}

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
  /** What changed since the last visit — the diff against the session baseline. */
  changes: ChangeFeed;
  /**
   * symbol (upper) → what the platform knows about it. One join, shared by
   * every module; modules look symbols up here rather than fetching.
   */
  symbolContext: Record<string, SymbolContext>;
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
    /** Snapshot predates the current scoring methodology — banner + rerun, never blank. */
    scannerMethodologyStale: boolean;
  };
  watchlistIntelligence: WatchlistIntelligence;
  upcomingEvents: { status: CardStatus; events: UpcomingEventLite[] };
  performance: PortfolioPerformanceSummary;
  /** The Book card's 90-day portfolio-vs-benchmark return index. */
  equityCurve: EquityCurve;
  activity: RecentActivity;
  /** Deterministic fallback text, used until (or instead of) the AI stream. */
  fallbackBriefing: string;
  /**
   * The dashboard fact layer (audit Phase 3): every cross-surface fact the
   * page renders, stamped with its unit, display precision, time window,
   * as-of, and source. Components render facts through `formatFact()` and are
   * forbidden from re-deriving or re-rounding them locally — this is what
   * structurally prevents one fact from appearing as 33% and 32.9% on the
   * same screen. Built in lib/home/facts.ts; reconciled by
   * `reconcileDashboardFacts()` in CI.
   */
  facts: DashboardFacts;
}

/* ------------------------------------------------------------------ */
/* The fact layer                                                      */
/* ------------------------------------------------------------------ */

export type FactUnit = "percent" | "currency" | "bps" | "count" | "score" | "level" | "days" | "text";

/**
 * One dashboard fact. `value` is the exact engine output (never pre-rounded);
 * `precision` is the SINGLE display precision every surface must use;
 * `window` names the time period the value describes ("today", "90d",
 * "annualized since first lot"); `source` is the computation reference
 * (module.field) a provenance affordance can open.
 */
export interface Fact<V = number> {
  value: V | null;
  unit: FactUnit;
  precision: number;
  window: string | null;
  asOf: string | null;
  source: string;
}

export interface DashboardFacts {
  /** The US market session day the page's "today" figures describe. */
  sessionDate: Fact<string>;
  totalValue: Fact;
  dayPnlPct: Fact;
  dayPnlDollar: Fact;
  /** Share of book value the day move could price (see PortfolioPulse.dayCoveragePct). */
  dayCoveragePct: Fact;
  alignmentScore: Fact;
  alignmentLabel: Fact<string>;
  cashPct: Fact;
  totalReturnOnCostPct: Fact;
  xirrPct: Fact;
  holdingDays: Fact;
  benchmarkSymbol: Fact<string>;
  benchmarkXirrPct: Fact;
  excessPct: Fact;
  curveWindowDays: Fact;
  curvePortfolioPct: Fact;
  curveBenchmarkPct: Fact;
  /** True open count of the attention queue (= items.length after dedupe/dismissals). */
  openCount: Fact;
  /** Count of engine-recommended decisions (a SUBSET of the queue, not its total). */
  decisionCount: Fact;
  unreadNotifications: Fact;
  changesCount: Fact;
  sentimentScore: Fact;
  sentimentLabel: Fact<string>;
  vixLevel: Fact;
  /** The shared VIX band label BOTH the gauge and the tile must render. */
  vixBandLabel: Fact<string>;
}

export type { DecisionCard };
