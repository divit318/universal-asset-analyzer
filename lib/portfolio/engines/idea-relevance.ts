/**
 * The Idea Decision Engine — turns a tracked idea into an answerable decision.
 *
 * Every idea on the Watchlist has to answer one question: *should I own more of
 * this, less of this, or something else instead?* This module answers it, and
 * shows its work. It is the counterpart to `decision.ts`: that one narrates a
 * proposed TRADE, this one narrates an IDEA.
 *
 * ── Where the numbers come from ────────────────────────────────────────────
 * Nothing here computes a score. Relevance is `computePortfolioFit()`
 * (lib/ios/fit-scorer.ts) — the same deterministic engine the Watchlist,
 * Compare, Research, Wire and DCF pages already score against, so the number on
 * a board card and the number on the table row are the same number by
 * construction rather than by coincidence. This module only:
 *
 *   1. converts fit into an ACTION ORDERING (impact, not score — see below),
 *   2. states the rationale in sentences built from measured values,
 *   3. defers to the trade engine wherever the trade engine has an opinion.
 *
 * ── Why impact rather than score ───────────────────────────────────────────
 * Ranking by fitScore puts a 92-fit idea that can only justify 0.4% of the book
 * above a 71-fit idea worth 5% of it, which is the wrong order to work in. The
 * ordering is therefore
 *
 *     impactPct = movablePct × (fitScore / 100) × (confidence / 100)
 *
 * — "the share of the portfolio this idea could justifiably move, discounted by
 * how well it fits and by how much of the score is actually evidenced". Every
 * term is already computed and already displayed, the formula is monotone in all
 * three, and it is reproducible from the card's own visible numbers. `movablePct`
 * is the suggested allocation for a name you don't own, and the DISTANCE between
 * your current weight and that suggestion for one you do — so an oversized
 * holding ranks as high-impact, which is exactly the "what should I trim?"
 * question a reporting dashboard never asks.
 *
 * ── One authority per claim ────────────────────────────────────────────────
 * When the recommendation engine has simulated a trade for a symbol, its verdict
 * wins and this module quotes it (`linkedTrade`), because that engine measures a
 * real alignment delta through the real portfolio. Fit never contradicts it: fit
 * answers "does this belong in the book?", the trade engine answers "what should
 * I do about it today?". Where they would overlap, this module states the trade
 * engine's answer and labels the fit number as a sizing reference.
 *
 * Pure and synchronous: no fetching, no database, no model. Pinned by
 * tests/idea-relevance.test.ts.
 */

import type { PortfolioFitAnalysis, FitDimension, FitTier } from "../../ios/types";
import { WORKFLOW_LABEL, type IdeaWorkflow } from "../../ideas/evidence";
import type { IdeaRow } from "../../ideas/rows";
import type { ScoreExplanation } from "../../home/explain";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What this idea is FOR. Deliberately not a buy/sell rating: the Watchlist's
 * job is to route attention, and only the trade engine (which simulates) is
 * allowed to say "buy $12,000 of this".
 */
export type IdeaVerdict =
  /** No research evidence exists yet — the honest ask is to do the work. */
  | "research"
  /** Research evidence exists; the investment view hasn't been written. */
  | "thesis"
  /** A thesis exists; the remaining step is a decision. */
  | "decide"
  /** Held and sized in line with its fit — no action. */
  | "hold"
  /**
   * Tracked, assessed, and nothing in the measurement argues either way.
   *
   * Distinct from `hold`, which is an instruction about a position you have.
   * "Hold" on a name you don't own is not an instruction at all — it appeared on
   * a stablecoin the portfolio has never held, reading as advice to keep
   * something the user doesn't have.
   */
  | "no-case"
  /** Held and materially above what its fit justifies — sizing question. */
  | "review-sizing"
  /** The trade engine has a simulated trade for this symbol; go and read it. */
  | "trade-proposed"
  /** Measurably poor fit. Kept, ranked last, never removed. */
  | "deprioritize";

export const VERDICT_LABEL: Record<IdeaVerdict, string> = {
  research: "Research next",
  thesis: "Write thesis",
  decide: "Decide",
  hold: "Hold",
  "no-case": "No case yet",
  "review-sizing": "Review sizing",
  "trade-proposed": "Trade proposed",
  deprioritize: "Low relevance",
};

/** The five questions every recommendation must answer, each grounded in a number. */
export interface IdeaRationale {
  /** Why am I seeing this? — provenance plus how it entered the watchlist. */
  whySeeing: string;
  /** What problem does this solve? — the portfolio weakness it addresses. */
  whatProblem: string;
  /** Why now? — a measured timing fact, never a market-timing claim. */
  whyNow: string;
  /** Why this asset instead of another? — its rank against the real alternatives. */
  whyThisOne: string;
  /** What changes if I ignore this? — the counterfactual, stated plainly. */
  ifIgnored: string;
}

/** The measurable effect of acting, at the suggested size. */
export interface ExpectedImprovement {
  /** Share of the portfolio the idea could justifiably move. */
  movablePct: number;
  /** Dollar equivalent of `movablePct`, or null with no portfolio value. */
  movableAmount: number | null;
  /** Concentration today (position-level HHI) and after, from the fit engine. */
  positionHhiBefore: number;
  positionHhiAfter: number;
  /** Sector/class exposure this would fill, when it fills one. */
  fills: string | null;
  /** One sentence stating all of the above. Never an alignment-score claim. */
  summary: string;
}

/** A real alternative from the same watchlist — never a fabricated comparison. */
export interface IdeaPeer {
  symbol: string;
  fitScore: number;
  impactPct: number;
  /** What makes it comparable: same sector, or same asset class. */
  sharedWith: string;
}

/** The trade engine's own recommendation for this symbol, quoted verbatim. */
export interface LinkedTrade {
  action: string;
  title: string;
  rationale: string;
  amount: number;
  /** MEASURED by simulating the trade — the trade engine's number, not ours. */
  alignmentDelta: number | null;
  confidence: number;
  alternativesEvaluated: number;
}

export interface IdeaAssessment {
  symbol: string;
  workflow: IdeaWorkflow;
  fit: PortfolioFitAnalysis | null;
  /** Ordering key — see the module header. Null when fit couldn't be computed. */
  impactPct: number | null;
  /** 1-based rank across the whole assessed set, by impact. */
  priority: number;
  verdict: IdeaVerdict;
  /** The single most important sentence about this idea. */
  headline: string;
  /** The primary reason it is relevant, and the supporting ones. */
  primaryReason: string;
  secondaryReasons: string[];
  tradeoffs: string[];
  rationale: IdeaRationale;
  expected: ExpectedImprovement | null;
  peers: IdeaPeer[];
  linkedTrade: LinkedTrade | null;
  /** Decomposition for the shared explain popover — same contract as the home dashboard. */
  explanation: ScoreExplanation | null;
}

/**
 * Everything about the portfolio this engine needs, all of it already computed
 * by the report the page has in hand. Nothing here is re-derived.
 */
export interface IdeaPortfolioContext {
  hasPortfolio: boolean;
  totalValue: number;
  /**
   * HHI over INDIVIDUAL HOLDING weights (0-10000), i.e. `risk.positionHhi`.
   *
   * Named for its denominator, per the same rule as `UniversalRisk.positionHhi`:
   * this app computes an HHI over several denominators and they are not
   * interchangeable (688 over 25 holdings vs 3431 over 10 asset classes on the
   * real book). `fit.projectedHHI` is projected from the position-level figure,
   * so a bare `hhi` here would invite an asset-class value to be passed in and
   * make the before/after pair a comparison of two different scales.
   */
  positionHhi: number;
  /** Alignment score 0-100, quoted only as context — never recomputed. */
  alignmentScore: number | null;
  /** symbol → % of portfolio value, from the allocation engine. */
  weights: Map<string, number>;
  /** symbol → sector, for peer comparison. */
  sectors: Map<string, string>;
  /** Sectors the portfolio has no meaningful exposure to. */
  missingSectors: string[];
  overweightSectors: string[];
  /** symbol → the trade engine's recommendation, when it has one. */
  trades: Map<string, LinkedTrade>;
  /** True when BOTH portfolio engines report nothing left to do. */
  atEquilibrium: boolean;
}

export const EMPTY_IDEA_CONTEXT: IdeaPortfolioContext = {
  hasPortfolio: false,
  totalValue: 0,
  positionHhi: 0,
  alignmentScore: null,
  weights: new Map(),
  sectors: new Map(),
  missingSectors: [],
  overweightSectors: [],
  trades: new Map(),
  atEquilibrium: false,
};

/* -------------------------------------------------------------------------- */
/* Formatting helpers (local, tiny, and unit-explicit)                         */
/* -------------------------------------------------------------------------- */

const pct1 = (v: number) => `${v.toFixed(1)}%`;
const int = (v: number) => Math.round(v).toLocaleString("en-US");
const money = (v: number) =>
  v >= 1000 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(0)}`;

/** The materiality floor for a sizing gap: below this, "hold" is the honest read. */
const SIZING_TOLERANCE_PCT = 1;

/* -------------------------------------------------------------------------- */
/* Impact                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How much of the portfolio this idea could move.
 *
 * For an unheld name that's the fit engine's suggested allocation. For a held
 * one it's the DISTANCE to that suggestion — the part of the position that is
 * either missing or surplus — because a 6% holding whose fit justifies 3% is a
 * live decision, and its "suggested 3%" alone would understate it.
 */
export function movablePct(fit: PortfolioFitAnalysis, currentWeight: number | null): number {
  if (currentWeight == null) return fit.suggestedAllocationPct;
  return Math.abs(fit.suggestedAllocationPct - currentWeight);
}

/** See the module header. Reproducible from the three numbers on the card. */
export function impactOf(fit: PortfolioFitAnalysis, currentWeight: number | null): number {
  const movable = movablePct(fit, currentWeight);
  const scaled = movable * (fit.fitScore / 100) * (fit.confidence / 100);
  return Math.round(scaled * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Dimensions                                                                  */
/* -------------------------------------------------------------------------- */

type NamedDimension = FitDimension & { key: string };

function namedDimensions(fit: PortfolioFitAnalysis): NamedDimension[] {
  return Object.entries(fit.dimensions).map(([key, d]) => ({ ...d, key }));
}

/**
 * The dimension that actually moves the score most in the given direction.
 *
 * Ranked by CONTRIBUTION ABOVE NEUTRAL — |score − 50| × weight × confidence —
 * not by weight alone. Weight alone answered "what problem does this solve?" with
 * the heaviest dimension rather than the most informative one: a 22%-weight
 * Sector dimension scoring 100 ("adds missing Utilities exposure") lost to a
 * 24%-weight Objective dimension scoring 87 ("well-rounded fundamentals"), so the
 * card explained a specific gap-filling idea in generic terms.
 */
function strongest(fit: PortfolioFitAnalysis, impact: "positive" | "negative"): NamedDimension | null {
  const contribution = (d: NamedDimension) => Math.abs(d.score - 50) * d.weight * (d.confidence ?? 1);
  const matching = namedDimensions(fit)
    .filter((d) => d.impact === impact && (d.confidence ?? 1) > 0)
    .sort((a, b) => contribution(b) - contribution(a));
  return matching[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Verdict                                                                     */
/* -------------------------------------------------------------------------- */

const ACTIONABLE_TIERS: FitTier[] = ["excellent", "good"];

function verdictFor(
  row: IdeaRow,
  fit: PortfolioFitAnalysis | null,
  weight: number | null,
  trade: LinkedTrade | null,
): IdeaVerdict {
  // The trade engine simulated something for this symbol. It measured a real
  // alignment delta; we did not. Its answer is the answer.
  if (trade) return "trade-proposed";

  if (row.held) {
    if (!fit || weight == null) return "hold";
    const surplus = weight - fit.suggestedAllocationPct;
    return surplus > SIZING_TOLERANCE_PCT ? "review-sizing" : "hold";
  }

  // The workflow is derived from EVIDENCE (lib/ideas/evidence.ts), so these
  // verdicts can no longer contradict what the user actually did: "research"
  // is only ever said about a name with no research on record, and a written
  // thesis reads as a decision waiting, never as work still to do.
  if (row.workflow === "ready" || row.workflow === "waiting") return "decide";
  const ask: IdeaVerdict = row.workflow === "working" ? "thesis" : "research";
  if (!fit) return ask;
  if (fit.fitTier === "poor" || fit.fitTier === "avoid") return "deprioritize";
  // Never "hold" for something unheld — see the note on `no-case`.
  return ACTIONABLE_TIERS.includes(fit.fitTier) ? ask : "no-case";
}

/* -------------------------------------------------------------------------- */
/* The five questions                                                          */
/* -------------------------------------------------------------------------- */

function whySeeing(row: IdeaRow, ctx: IdeaPortfolioContext): string {
  const base = row.originLabel;
  if (row.held) return `${base}. Shown as Owned because your ledger holds it today.`;
  if (!ctx.hasPortfolio) {
    return `${base}. With no positions recorded, relevance is generic rather than personalized.`;
  }
  return `${base}. ${WORKFLOW_LABEL[row.workflow]}; last activity ${row.idleDays}d ago.`;
}

function whatProblem(
  row: IdeaRow,
  fit: PortfolioFitAnalysis | null,
  weight: number | null,
): string {
  if (!fit) {
    return "Not assessable yet — fundamentals for this symbol haven't been fetched, so no dimension has evidence behind it.";
  }
  if (fit.isGeneric) {
    return "No portfolio to solve a problem for: record holdings and this becomes a specific answer about your book.";
  }

  if (row.held && weight != null) {
    const surplus = weight - fit.suggestedAllocationPct;
    if (surplus > SIZING_TOLERANCE_PCT) {
      return `Sizing: you hold ${pct1(weight)} where its fit justifies ${pct1(fit.suggestedAllocationPct)} — a ${pct1(surplus)} surplus against your own limits.`;
    }
    return `Nothing outstanding: ${pct1(weight)} held against a fit-justified ${pct1(fit.suggestedAllocationPct)}.`;
  }

  const best = strongest(fit, "positive");
  if (best) return `${best.label}: ${best.message}.`;
  const worst = strongest(fit, "negative");
  if (worst) return `It doesn't solve one — ${worst.message.toLowerCase()}.`;
  return "No dimension moves materially either way for this portfolio.";
}

/**
 * "Why now?" — only ever a measured, checkable fact. Never a market call: no
 * part of this app knows whether today is a good day to buy something.
 */
function whyNow(row: IdeaRow, fit: PortfolioFitAnalysis | null, price: number | null): string {
  if (row.targetPrice != null && price != null && price > 0) {
    const gap = ((row.targetPrice - price) / price) * 100;
    const dir = row.targetDirection ?? (row.targetPrice < price ? "below" : "above");
    if (dir === "below" && gap >= -2 && gap <= 0) {
      return `Price is within ${pct1(Math.abs(gap))} of your ${money(row.targetPrice)} buy level.`;
    }
    if (dir === "above" && gap <= 2 && gap >= 0) {
      return `Price is within ${pct1(gap)} of your ${money(row.targetPrice)} target.`;
    }
    return `${pct1(Math.abs(gap))} from your ${money(row.targetPrice)} ${dir === "below" ? "buy level" : "target"} — no level reached.`;
  }

  if (fit?.capReason) return `A hard constraint applies today: ${fit.capReason}.`;

  if (!row.held && row.idleDays >= 30) {
    return `No timing signal. Nothing has happened to it in ${row.idleDays}d, which is itself the reason to close it out.`;
  }
  if (row.held) return "No timing signal — this is a sizing question, not an entry one.";
  return `No timing signal. Last activity ${row.idleDays}d ago; nothing here claims today is special.`;
}

function ifIgnored(
  row: IdeaRow,
  fit: PortfolioFitAnalysis | null,
  weight: number | null,
  ctx: IdeaPortfolioContext,
  expected: ExpectedImprovement | null,
): string {
  if (!fit || !expected) {
    return "Nothing measurable changes — there is no evidenced improvement to forgo.";
  }
  if (fit.fitTier === "poor" || fit.fitTier === "avoid") {
    const worst = strongest(fit, "negative");
    return `Nothing is lost. ${worst ? `${worst.message}, so` : "On the measured dimensions"} skipping it is the neutral outcome.`;
  }
  if (row.held && weight != null && weight - fit.suggestedAllocationPct > SIZING_TOLERANCE_PCT) {
    return `The ${pct1(weight - fit.suggestedAllocationPct)} surplus stays, and concentration stays at ${int(ctx.positionHhi)} HHI.`;
  }
  const parts: string[] = [];
  if (expected.fills) parts.push(`the gap it fills stays open (${expected.fills})`);
  if (expected.positionHhiAfter !== expected.positionHhiBefore) {
    parts.push(`concentration stays at ${int(expected.positionHhiBefore)} HHI instead of ${int(expected.positionHhiAfter)}`);
  }
  if (expected.movableAmount != null && expected.movableAmount > 0) {
    parts.push(`${money(expected.movableAmount)} of capital stays where it is`);
  }
  if (parts.length === 0) return "Nothing measurable changes.";
  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/* -------------------------------------------------------------------------- */
/* Expected improvement                                                        */
/* -------------------------------------------------------------------------- */

function expectedFor(
  fit: PortfolioFitAnalysis,
  weight: number | null,
  ctx: IdeaPortfolioContext,
): ExpectedImprovement {
  const movable = movablePct(fit, weight);
  const amount = ctx.totalValue > 0 ? (ctx.totalValue * movable) / 100 : null;
  const sectorDim = fit.dimensions.sector;
  // The dimension's own MESSAGE, not its label: "Sector" told the reader nothing,
  // "Adds missing Utilities exposure" names the actual gap.
  const fills =
    sectorDim.impact === "positive" && (sectorDim.confidence ?? 1) > 0 ? sectorDim.message : null;

  const summary =
    weight == null
      ? `At the suggested ${pct1(fit.suggestedAllocationPct)}${amount != null ? ` (${money(amount)})` : ""}, position-level concentration moves ${int(ctx.positionHhi)} → ${int(fit.projectedHHI)} HHI.`
      : `Holding ${pct1(weight)} against a fit-justified ${pct1(fit.suggestedAllocationPct)} — ${pct1(movable)} of the book${amount != null ? ` (${money(amount)})` : ""} is the size of the question.`;

  return {
    movablePct: movable,
    movableAmount: amount,
    positionHhiBefore: ctx.positionHhi,
    positionHhiAfter: fit.projectedHHI,
    fills,
    summary,
  };
}

/* -------------------------------------------------------------------------- */
/* Explanation (shared contract with the home dashboard's explain popover)      */
/* -------------------------------------------------------------------------- */

function explanationFor(
  fit: PortfolioFitAnalysis,
  impact: number,
  weight: number | null,
): ScoreExplanation {
  const movable = movablePct(fit, weight);
  return {
    title: `${fit.symbol} · expected impact`,
    value: `${pct1(impact)} of portfolio`,
    method:
      "impact = movable share × (fit ÷ 100) × (confidence ÷ 100). Movable share is the suggested allocation for a name you don't hold, or the distance from your current weight to it for one you do.",
    confidence: {
      label: `${Math.round(fit.confidence)}% evidenced`,
      detail:
        "The share of fit weighting backed by real data. Dimensions with no evidence are dropped from the composite rather than scored as neutral.",
    },
    factors: [
      {
        label: "Movable share of portfolio",
        display: pct1(movable),
        bar: Math.min(1, movable / 10),
        direction: movable > 0 ? 1 : 0,
        detail:
          weight == null
            ? "Suggested allocation from your position count and constraints."
            : `Distance from your current ${pct1(weight)} to the fit-justified ${pct1(fit.suggestedAllocationPct)}.`,
      },
      {
        label: "Portfolio fit",
        display: `${fit.fitScore}/100`,
        bar: fit.fitScore / 100,
        direction: fit.fitScore >= 60 ? 1 : fit.fitScore <= 40 ? -1 : 0,
        detail: fit.capReason ?? "Confidence-weighted composite of the six fit dimensions.",
      },
      {
        label: "Evidence",
        display: `×${(fit.confidence / 100).toFixed(2)}`,
        bar: fit.confidence / 100,
        direction: fit.confidence >= 60 ? 1 : -1,
        detail: "A data-poor score is discounted rather than trusted.",
        muted: fit.confidence < 40,
      },
      ...namedDimensions(fit).map((d) => ({
        label: d.label,
        display: `${d.score}/100 · w ${(d.weight * 100).toFixed(0)}%`,
        bar: d.score / 100,
        direction: (d.impact === "positive" ? 1 : d.impact === "negative" ? -1 : 0) as 1 | 0 | -1,
        detail: d.message,
        muted: (d.confidence ?? 1) === 0,
      })),
    ],
    caveats: [
      "Impact is a size-of-decision estimate, not a projected return. It says how much of the portfolio is in question, not what it would earn.",
      fit.isGeneric
        ? "No portfolio recorded — this fit is generic, not personalized."
        : "Fit answers whether an asset belongs in this portfolio. What to trade today is the Decisions tab, which simulates each trade through the real engines.",
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

function peersFor(
  row: IdeaRow,
  scored: Array<{ row: IdeaRow; fit: PortfolioFitAnalysis | null; impact: number | null }>,
  ctx: IdeaPortfolioContext,
  fit: PortfolioFitAnalysis | null,
): IdeaPeer[] {
  if (!fit) return [];
  const sector = ctx.sectors.get(row.symbol) ?? null;

  const comparable = scored.filter((c) => {
    if (c.row.symbol === row.symbol || !c.fit || c.impact == null) return false;
    // Only compare candidates to candidates: a held position is not an
    // alternative to a new idea, it's the thing being diluted.
    if (c.row.held !== row.held) return false;
    const peerSector = ctx.sectors.get(c.row.symbol) ?? null;
    if (sector && peerSector && sector === peerSector) return true;
    return c.row.assetClass != null && c.row.assetClass === row.assetClass;
  });

  return comparable
    .sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0))
    .slice(0, 3)
    .map((c) => {
      const peerSector = ctx.sectors.get(c.row.symbol) ?? null;
      return {
        symbol: c.row.symbol,
        fitScore: c.fit!.fitScore,
        impactPct: c.impact!,
        sharedWith:
          sector && peerSector && sector === peerSector
            ? `${sector} exposure`
            : `${c.row.assetClass ?? "asset"} exposure`,
      };
    });
}

function headlineFor(
  verdict: IdeaVerdict,
  row: IdeaRow,
  fit: PortfolioFitAnalysis | null,
  weight: number | null,
  trade: LinkedTrade | null,
): string {
  switch (verdict) {
    case "trade-proposed":
      return trade ? trade.title : "A trade has been proposed for this symbol.";
    case "review-sizing":
      return fit && weight != null
        ? `Held at ${pct1(weight)}; fit justifies ${pct1(fit.suggestedAllocationPct)}.`
        : "Sizing is worth a look.";
    case "hold":
      return "Sized in line with its fit — no action.";
    case "no-case":
      return fit && fit.confidence < 50
        ? `Nothing argues either way, and only ${Math.round(fit.confidence)}% of the fit score is evidenced.`
        : "Nothing in the measurement argues for or against it.";
    case "decide":
      return "A thesis exists; this is waiting on a decision, not more research.";
    case "deprioritize":
      return fit?.capReason ?? "Measurably poor fit for this portfolio.";
    case "thesis":
      // Research evidence exists — the claim is about the missing VIEW, never
      // about missing work. Saying "hasn't been researched" here was the bug
      // this whole model replaces.
      return fit
        ? `Fits this portfolio (${fit.fitScore}/100); research exists, the investment view doesn't.`
        : "Research exists; the investment view hasn't been written.";
    case "research":
      return fit ? `Fits this portfolio (${fit.fitScore}/100) — no research on record yet.` : "Not assessed yet.";
  }
}

/**
 * Assess every tracked idea. Deterministic: same rows + same fits + same context
 * produce the same output, in the same order.
 */
export function buildIdeaAssessments(input: {
  rows: IdeaRow[];
  /** symbol → the fit engine's output. Absent = not assessable yet, never zero. */
  fits: Map<string, PortfolioFitAnalysis>;
  /** symbol → live price, for the "why now?" target proximity fact. */
  prices?: Map<string, number>;
  context?: IdeaPortfolioContext;
}): IdeaAssessment[] {
  const ctx = input.context ?? EMPTY_IDEA_CONTEXT;
  const prices = input.prices ?? new Map<string, number>();

  // Pass 1 — fit, weight and impact per row.
  const scored = input.rows.map((row) => {
    const fit = input.fits.get(row.symbol.toUpperCase()) ?? null;
    const weight = row.held ? ctx.weights.get(row.symbol.toUpperCase()) ?? null : null;
    return { row, fit, weight, impact: fit ? impactOf(fit, weight) : null };
  });

  // Pass 2 — a single total ordering, so "ranks 3rd of 34" is a real statement.
  // Nulls sink in both directions: an unassessable idea is not a small one, and
  // must never outrank an evidenced one.
  const ordered = [...scored].sort((a, b) => {
    if (a.impact == null && b.impact == null) return a.row.symbol.localeCompare(b.row.symbol);
    if (a.impact == null) return 1;
    if (b.impact == null) return -1;
    if (b.impact !== a.impact) return b.impact - a.impact;
    const fitDiff = (b.fit?.fitScore ?? 0) - (a.fit?.fitScore ?? 0);
    return fitDiff !== 0 ? fitDiff : a.row.symbol.localeCompare(b.row.symbol);
  });
  const rankBySymbol = new Map(ordered.map((c, i) => [c.row.symbol, i + 1]));
  const total = ordered.length;

  return scored.map(({ row, fit, weight, impact }) => {
    const trade = ctx.trades.get(row.symbol.toUpperCase()) ?? null;
    const verdict = verdictFor(row, fit, weight, trade);
    const expected = fit ? expectedFor(fit, weight, ctx) : null;
    const peers = peersFor(row, scored, ctx, fit);
    const rank = rankBySymbol.get(row.symbol) ?? total;

    const primary = fit
      ? fit.capReason ?? fit.reasons[0] ?? strongest(fit, "positive")?.message ?? "No dimension stands out."
      : "No fit evidence yet — fundamentals for this symbol haven't been fetched.";

    return {
      symbol: row.symbol,
      workflow: row.workflow,
      fit,
      impactPct: impact,
      priority: rank,
      verdict,
      headline: headlineFor(verdict, row, fit, weight, trade),
      primaryReason: primary,
      secondaryReasons: fit ? fit.reasons.slice(1) : [],
      tradeoffs: fit ? fit.tradeoffs : [],
      rationale: {
        whySeeing: whySeeing(row, ctx),
        whatProblem: whatProblem(row, fit, weight),
        whyNow: whyNow(row, fit, prices.get(row.symbol.toUpperCase()) ?? null),
        whyThisOne: whyThisOneText(row, fit, peers, rank, total, impact),
        ifIgnored: ifIgnored(row, fit, weight, ctx, expected),
      },
      expected,
      peers,
      linkedTrade: trade,
      explanation: fit ? explanationFor(fit, impact ?? 0, weight) : null,
    };
  });
}

/**
 * "Why this one and not another" — stated against the real alternatives on the
 * watchlist, with this idea's own impact for direct comparison.
 */
function whyThisOneText(
  row: IdeaRow,
  fit: PortfolioFitAnalysis | null,
  peers: IdeaPeer[],
  rank: number,
  total: number,
  impact: number | null,
): string {
  if (!fit || impact == null) {
    return `Unranked: with no fit evidence it cannot be compared to the other ${Math.max(0, total - 1)} tracked ideas.`;
  }
  const standing = `Ranks ${rank} of ${total} tracked ideas on expected impact (${pct1(impact)} of the portfolio)`;
  if (peers.length === 0) {
    return `${standing}. Nothing else tracked shares its exposure, so the watchlist holds no like-for-like alternative.`;
  }
  const ahead = peers.filter((p) => p.impactPct < impact).length;
  const named = peers.map((p) => `${p.symbol} (fit ${p.fitScore}, ${pct1(p.impactPct)})`).join(", ");
  return `${standing}, ahead of ${ahead} of ${peers.length} tracked ${peers[0].sharedWith} alternative${peers.length === 1 ? "" : "s"}: ${named}.`;
}
