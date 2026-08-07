/**
 * Universal Recommendation Engine — the source of the Portfolio Decision Center.
 *
 * Two rules govern this file:
 *
 * 1. EVERY IMPACT NUMBER IS SIMULATED, NOT ASSERTED. A recommendation's "expected
 *    health improvement / risk reduction / diversification gain" is computed by
 *    building the post-trade portfolio and re-running the real engines on it (see
 *    ./simulate.ts). If a recommendation claims +6 health points, that is what the
 *    health score will actually read if the user makes the trade — because it is
 *    literally the same function that produced it.
 *
 * 2. RECOMMENDATIONS ARE CROSS-ASSET. The old engine could only shuffle weights
 *    between existing equity holdings; the closest it got to "you need bonds" was a
 *    hardcoded list of US large-cap tickers per GICS sector. This one detects gaps
 *    in the ASSET ALLOCATION and proposes the exposure that fills them.
 *
 * A recommendation that does not survive simulation — i.e. one whose measured
 * impact is negligible or negative — is DISCARDED rather than shown with a
 * hand-waved rationale. The engine is allowed to conclude the portfolio is fine.
 */

import { candidateToRaw, candidatesFor, type Candidate, type GapKind } from "./candidates";
import { simulate, type PortfolioEvaluation, type ImpactEstimate, type PortfolioChange } from "./simulate";
import { normalizeHoldings } from "../model/holding";
import type { Holding, MarketContext } from "../model/types";
import { PORTFOLIO_CLASS_LABEL } from "../model/types";
import { TRIM_TRIGGER_PCT, TRIM_TARGET_PCT } from "../policy";
import { assessConfidence } from "./confidence";

export type RecommendationAction = "ADD" | "INCREASE" | "REDUCE" | "SELL" | "HOLD" | "REALLOCATE";

export interface Recommendation {
  id: string;
  action: RecommendationAction;
  /** What to do, in one line. */
  title: string;
  /** The exposure or holding this concerns. */
  subject: string;
  symbol: string | null;
  /** Why — grounded in a specific measured weakness. */
  rationale: string;
  /**
   * 0-100. ONE meaning for every action type: how much of the evidence behind
   * this card's numbers was actually observed rather than assumed. See
   * engines/confidence.ts. It says nothing about how large the impact is, how
   * urgent the gap is, or how big the position is — those are the Impact chips,
   * `why.whyNow` and the title respectively.
   */
  confidence: number;
  /** Why the confidence is what it is, one deterministic sentence per factor. */
  confidenceBasis: string[];
  /** Dollar size of the proposed trade. */
  amount: number;
  /** MEASURED, by simulating the trade through the real engines. */
  impact: ImpactEstimate;
  /** What you give up. Every real decision has one. */
  tradeoffs: string[];
  /** The change, so the UI can re-simulate or execute it. */
  change: PortfolioChange;
  priority: number;
  /**
   * Every OTHER real candidate the engine actually simulated for this same gap and
   * rejected — never a fabricated list. Empty for trim/exit actions, which only
   * ever had one candidate: this specific holding.
   */
  alternatives: AlternativeConsidered[];
  /**
   * How many distinct portfolio modifications were actually simulated while
   * building THIS report's full recommendation set (every candidate tried across
   * every gap, plus every trim/exit trial) — a real count, not an illustrative one.
   */
  alternativesEvaluated: number;
}

export interface AlternativeConsidered {
  symbol: string;
  exposure: string;
  /** Measured health-score effect of this alternative, for direct comparison to the winner. */
  healthDelta: number;
  rejectedReason: string;
}

/* -------------------------------------------------------------------------- */
/* Gap detection                                                               */
/* -------------------------------------------------------------------------- */

interface Gap {
  kind: GapKind;
  severity: "high" | "medium" | "low";
  finding: string;
}

/**
 * Detect what the portfolio is MISSING, at the asset-allocation level.
 *
 * Note what is not here: any notion of a "missing GICS sector". A portfolio without
 * Utilities exposure is not obviously broken. A portfolio without any bonds, any
 * inflation protection, or any cash buffer is a structurally different animal, and
 * those are the gaps that actually change outcomes.
 */
function detectGaps(evaluation: PortfolioEvaluation): Gap[] {
  const { allocation, risk } = evaluation;
  const gaps: Gap[] = [];

  const weightOf = (key: string) =>
    allocation.byAssetClass.slices.find((s) => s.key === key)?.weight ?? 0;

  const bonds = weightOf("bond");
  const equityish = weightOf("equity") + weightOf("etf");
  const cash = weightOf("cash");
  const commodities = weightOf("commodity");
  const realAssets = commodities + weightOf("reit") + weightOf("real_estate");

  if (bonds < 5 && equityish > 40) {
    gaps.push({
      kind: "no_bonds",
      severity: equityish > 75 ? "high" : "medium",
      finding: `${equityish.toFixed(0)}% of the portfolio is in equities with ${bonds < 1 ? "no" : `only ${bonds.toFixed(1)}%`} bond exposure. There is nothing in the portfolio that reliably rallies when equities fall.`,
    });
  }

  if (risk.inflationSensitivity != null && risk.inflationSensitivity < -0.3 && realAssets < 5) {
    gaps.push({
      kind: "no_inflation_hedge",
      severity: risk.inflationSensitivity < -0.8 ? "high" : "medium",
      finding: `A +1pp inflation surprise costs roughly ${Math.abs(risk.inflationSensitivity).toFixed(1)}% of portfolio value, and there are no real assets to offset it.`,
    });
  }

  const usPct = allocation.byGeography.slices.find((s) => /united states|usa|us/i.test(s.label))?.weight ?? 0;
  if (usPct > 80 && allocation.byGeography.unclassifiedPct < 50) {
    gaps.push({
      kind: "no_international",
      severity: "medium",
      finding: `${usPct.toFixed(0)}% of classifiable holdings are US-domiciled. The portfolio is an undiversified bet on US outperformance and the dollar.`,
    });
  }

  if (cash < 1.5) {
    gaps.push({
      kind: "no_cash",
      severity: cash < 0.5 ? "medium" : "low",
      finding: `Cash is ${cash.toFixed(1)}% of the portfolio. There is no buffer — an unexpected need forces a sale at whatever price the market offers that day.`,
    });
  }

  const totalIncome = evaluation.holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);
  const yieldPct = evaluation.totalValue > 0 ? (totalIncome / evaluation.totalValue) * 100 : 0;
  if (yieldPct < 1 && evaluation.totalValue > 0) {
    gaps.push({
      kind: "no_income",
      severity: "low",
      finding: `Portfolio yield is ${yieldPct.toFixed(2)}%. Returns depend entirely on price appreciation.`,
    });
  }

  if (risk.duration != null && risk.duration > 8) {
    gaps.push({
      kind: "duration_risk",
      severity: "medium",
      finding: `Portfolio duration is ${risk.duration.toFixed(1)} years — a +1pp move in rates costs roughly ${risk.duration.toFixed(1)}% of value.`,
    });
  }

  if (risk.topAssetClassWeight > 85) {
    gaps.push({
      kind: "equity_concentration",
      severity: "high",
      finding: `${risk.topAssetClassWeight.toFixed(0)}% of the portfolio sits in a single asset class.`,
    });
  }

  return gaps;
}

/* -------------------------------------------------------------------------- */
/* Sizing                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How large a trade to propose. Deliberately conservative — a recommendation that
 * requires restructuring half the portfolio will not be acted on, and an
 * "expected impact" computed on an unrealistically large trade is a lie by framing.
 */
function proposedSize(totalValue: number, severity: Gap["severity"]): number {
  const pct = severity === "high" ? 0.10 : severity === "medium" ? 0.06 : 0.03;
  return Math.round(totalValue * pct);
}

/* -------------------------------------------------------------------------- */
/* Build recommendations                                                       */
/* -------------------------------------------------------------------------- */

function buildCandidateHolding(
  c: Candidate,
  amount: number,
  ctx: MarketContext,
): Holding | null {
  const price = ctx.quotes.get(c.symbol.toUpperCase())?.price ?? null;
  const raw = candidateToRaw(c, amount, price);
  const { holdings } = normalizeHoldings([raw], ctx);
  return holdings[0] ?? null;
}

/*
 * Confidence is NOT computed here any more.
 *
 * It has one definition for every recommendation type, in engines/confidence.ts,
 * and it answers exactly one question: how much of the evidence behind this card's
 * numbers was actually observed. What used to live at this spot blended gap
 * severity (urgency), |healthDelta| (effect size) and mark quality into a single
 * percentage, while the trim path used position weight and the exit path used the
 * holding's score confidence — three incomparable meanings under one label. The
 * effect-size term also double-counted, since decisionScore is already
 * `healthDelta × confidence`.
 *
 * Severity and effect size did not lose their home; they never belonged here.
 * Severity still sizes the recommendation (`proposedSize`) and is narrated in
 * `why.whyNow`; effect size IS the Impact chips and the ranking's first term.
 */
function confidenceOf(
  evaluation: PortfolioEvaluation,
  subject: Holding | null,
  impact: ImpactEstimate,
): { confidence: number; confidenceBasis: string[] } {
  const assessed = assessConfidence(evaluation, subject, { riskMeasured: impact.riskDelta != null });
  return { confidence: assessed.score, confidenceBasis: assessed.basis };
}

function tradeoffsFor(c: Candidate, impact: ImpactEstimate): string[] {
  const out: string[] = [];

  if (impact.riskDelta != null && impact.riskDelta > 0.2) {
    out.push(`Increases portfolio volatility by ${impact.riskDelta.toFixed(1)}pp.`);
  }
  if (impact.incomeDelta < 0) {
    out.push(`Reduces annual income by roughly $${Math.abs(impact.incomeDelta).toLocaleString()}.`);
  }
  if (c.assetClass === "bond") {
    out.push("Bonds lower expected long-run return in exchange for the drawdown protection.");
  }
  if (c.assetClass === "commodity") {
    out.push("Commodities pay no income and have no cash flows to value them on — this is a hedge, not a compounding asset.");
  }
  if (c.symbol === "TIP" || c.symbol === "IEF") {
    out.push("Rate-sensitive: a further rise in rates would push the price down.");
  }
  if (c.assetClass === "etf" && c.exposure.includes("Ex-US")) {
    out.push("Adds currency risk — returns now depend partly on the dollar.");
  }

  if (out.length === 0) out.push("Uses cash or requires selling something else to fund it.");
  return out.slice(0, 3);
}

/* -------------------------------------------------------------------------- */

/**
 * Which candidate symbols this portfolio's recommendations could actually use —
 * i.e. only the candidates relevant to gaps this specific portfolio has.
 *
 * This exists so the market context doesn't have to fetch the entire ~10-symbol
 * candidate universe on every report load. Gap detection only needs the HELD
 * holdings' data (already fetched for the rest of the report), so callers can
 * compute gaps first, ask this for the short list of symbols that actually matter,
 * and only then pay for a handful of extra fetches — typically 2-6 symbols instead
 * of all ~10, and often zero for an already-well-allocated portfolio.
 */
export function getRelevantCandidateSymbols(evaluation: PortfolioEvaluation): string[] {
  if (evaluation.holdings.length === 0 || evaluation.totalValue <= 0) return [];
  const gaps = detectGaps(evaluation);
  const symbols = new Set<string>();
  for (const gap of gaps) {
    for (const c of candidatesFor(gap.kind)) symbols.add(c.symbol);
  }
  return [...symbols];
}

export function computeRecommendations(
  evaluation: PortfolioEvaluation,
  ctx: MarketContext,
  limit = 8,
): Recommendation[] {
  if (evaluation.holdings.length === 0 || evaluation.totalValue <= 0) return [];

  const recs: Recommendation[] = [];
  const gaps = detectGaps(evaluation);

  // Every simulate() call across every loop below, so "N alternatives evaluated"
  // is a real count of the work this function actually did, not an estimate.
  let totalEvaluated = 0;

  /* ---- Gap-filling ADDs, each one simulated ---- */

  const seenSymbols = new Set<string>();

  for (const gap of gaps) {
    const amount = proposedSize(evaluation.totalValue, gap.severity);
    if (amount <= 0) continue;

    // Try each candidate for this gap and keep the one that MEASURES best. This is
    // the engine choosing on evidence rather than on the order of a hardcoded list.
    let best: { c: Candidate; impact: ImpactEstimate; change: PortfolioChange } | null = null;
    const tried: { c: Candidate; impact: ImpactEstimate }[] = [];

    for (const c of candidatesFor(gap.kind)) {
      if (seenSymbols.has(c.symbol)) continue;

      const holding = buildCandidateHolding(c, amount, ctx);
      if (!holding) continue;

      const change: PortfolioChange = { kind: "buy", holding, amount };
      const { impact } = simulate(evaluation, [change], ctx);
      totalEvaluated++;
      tried.push({ c, impact });

      if (!best || impact.healthDelta > best.impact.healthDelta) {
        best = { c, impact, change };
      }
    }

    // The engine is allowed to say "this wouldn't help". A recommendation that
    // doesn't survive its own simulation has no business being shown.
    if (!best || best.impact.healthDelta <= 0.5) continue;

    seenSymbols.add(best.c.symbol);

    const alternatives: AlternativeConsidered[] = tried
      .filter((t) => t.c.symbol !== best!.c.symbol)
      .map((t) => ({
        symbol: t.c.symbol,
        exposure: t.c.exposure,
        healthDelta: t.impact.healthDelta,
        rejectedReason: `Measured ${t.impact.healthDelta >= 0 ? "+" : ""}${t.impact.healthDelta.toFixed(1)} health points vs. ${best!.c.symbol}'s ${best!.impact.healthDelta >= 0 ? "+" : ""}${best!.impact.healthDelta.toFixed(1)}.`,
      }));

    recs.push({
      id: `gap:${gap.kind}`,
      action: "ADD",
      title: `Add ${best.c.exposure.toLowerCase()} via ${best.c.symbol}`,
      subject: best.c.exposure,
      symbol: best.c.symbol,
      rationale: `${gap.finding} ${best.c.rationale}`,
      // Subject = the simulated candidate holding, so the buy is judged on the
      // evidence available for the asset being bought — exactly as a trim is
      // judged on the evidence for the asset being trimmed.
      ...confidenceOf(evaluation, best.change.kind === "buy" ? best.change.holding : null, best.impact),
      amount,
      impact: best.impact,
      tradeoffs: tradeoffsFor(best.c, best.impact),
      change: best.change,
      priority: 0,
      alternatives,
      alternativesEvaluated: 0, // filled in once the whole pass's total is known
    });
  }

  /* ---- Trim over-concentrated holdings, each one simulated ---- */

  for (const h of evaluation.holdings) {
    // Only flag a position that exceeds the portfolio's single-holding cap by more
    // than the hysteresis band, and trim it back TO the cap — never below it. The
    // optimizer targets exactly this cap for a high-conviction name, so trimming
    // below it (the old code trimmed any ≥20% holding down to 15%) set up an
    // infinite 15%↔20% ping-pong: trim to 15, optimizer rebuilds to 20, repeat.
    // Sharing the cap via lib/portfolio/policy.ts makes it a true shared fixed point.
    if (h.weight <= TRIM_TRIGGER_PCT) continue;

    const target = TRIM_TARGET_PCT;
    const amount = Math.round(((h.weight - target) / 100) * evaluation.totalValue);
    if (amount <= 0) continue;

    const change: PortfolioChange = { kind: "sell", holdingId: h.id, amount };
    const { impact } = simulate(evaluation, [change], ctx);
    totalEvaluated++;
    if (impact.healthDelta <= 0.5) continue;

    const illiquidNote = h.liquidity === "illiquid" || h.liquidity === "t2"
      ? ` Note: this holding is ${h.liquidity === "illiquid" ? "illiquid" : "slow to sell"}, so trimming it is not straightforward.`
      : "";

    recs.push({
      id: `trim:${h.id}`,
      action: "REDUCE",
      // Same 1-decimal precision as the rationale below — the title's rounded
      // "33%" beside the rationale's "32.9%" read as two different facts
      // (audit NI-02).
      title: `Trim ${h.symbol ?? h.name} from ${h.weight.toFixed(1)}% to ${target}%`,
      subject: h.symbol ?? h.name,
      symbol: h.symbol,
      rationale:
        `${h.symbol ?? h.name} is ${h.weight.toFixed(1)}% of the portfolio. A single holding this size means the portfolio's outcome is largely this one asset's outcome, regardless of how good it is.${illiquidNote}`,
      ...confidenceOf(evaluation, h, impact),
      amount,
      impact,
      tradeoffs: [
        "Realizes gains and any tax due on them.",
        "Gives up upside if this holding continues to outperform.",
      ],
      change,
      priority: 0,
      alternatives: [],
      alternativesEvaluated: 0,
    });
  }

  /* ---- Exit genuinely weak holdings ---- */

  for (const h of evaluation.holdings) {
    // Only act on a LOW score we're CONFIDENT in. A low score at low confidence is
    // a data gap, not a sell signal — conflating the two is how the old engine
    // could recommend selling a bond because it "scored 50".
    if (!h.score || h.score.score >= 35 || h.score.confidence < 55) continue;
    if (h.weight < 2) continue;

    const amount = Math.round(h.valuation.valueBase);
    const change: PortfolioChange = { kind: "sell", holdingId: h.id, amount };
    const { impact } = simulate(evaluation, [change], ctx);
    totalEvaluated++;
    if (impact.healthDelta <= 0.5) continue;

    recs.push({
      id: `exit:${h.id}`,
      action: "SELL",
      title: `Exit ${h.symbol ?? h.name}`,
      subject: h.symbol ?? h.name,
      symbol: h.symbol,
      rationale:
        `${h.symbol ?? h.name} scores ${h.score.score}/100 on ${PORTFOLIO_CLASS_LABEL[h.assetClass].toLowerCase()} metrics at ${h.score.confidence}% confidence. ${h.score.why.join(". ")}.`,
      ...confidenceOf(evaluation, h, impact),
      amount,
      impact,
      tradeoffs: ["Realizes any loss.", "The thesis may simply need more time."],
      change,
      priority: 0,
      alternatives: [],
      alternativesEvaluated: 0,
    });
  }

  /* ---- Rank by measured impact ---- */

  return recs
    .map((r) => ({
      ...r,
      // Rank on what the change actually achieves, weighted by how sure we are.
      priority: r.impact.healthDelta * (r.confidence / 100),
      alternativesEvaluated: totalEvaluated,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

/** The single highest-ROI change available right now. Answers the mission question. */
export function topDecision(recs: Recommendation[]): Recommendation | null {
  return recs[0] ?? null;
}
