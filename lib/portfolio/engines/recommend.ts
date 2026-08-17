/**
 * Universal Recommendation Engine — the source of the Portfolio Decision Center.
 *
 * Two rules govern this file:
 *
 * 1. EVERY IMPACT NUMBER IS SIMULATED, NOT ASSERTED. A recommendation's "expected
 *    alignment improvement / risk reduction / diversification gain" is computed by
 *    building the post-trade portfolio and re-running the real engines on it (see
 *    ./simulate.ts). If a recommendation claims +6 alignment points, that is what the
 *    alignment score will actually read if the user makes the trade — because it is
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
import { CONCENTRATION_HYSTERESIS_PCT } from "../policy";
import { EXPOSURE_TARGETS, INFLATION_TARGET_S } from "../alignment/engine";
import { effectiveCapPct, type AlignmentThemeId } from "../alignment/policy";
import { assessConfidence } from "./confidence";

export type RecommendationAction =
  | "ADD"
  | "INCREASE"
  | "REDUCE"
  | "SELL"
  | "HOLD"
  | "REALLOCATE"
  /**
   * A researched candidate worth LOOKING AT — an opportunity to investigate,
   * explicitly not an instruction to buy. Produced by engines/discovery.ts
   * (never by the corrective loops here), always evidence-backed, and rendered
   * without a one-click trade button.
   */
  | "INVESTIGATE";

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
   * The alignment theme whose policy this recommendation serves — the SAME
   * theme ids the Alignment panel renders, so a card and the panel section it
   * answers can never disagree about what it is for. Null for the
   * instrument-quality exit path, which is fact-triggered rather than
   * theme-triggered (and gated on improving alignment anyway).
   */
  theme: AlignmentThemeId | null;
  /**
   * The investor's own rule this serves, quoted in their units ("your
   * concentration cap — ≤20% per position"). This is the (a) of every
   * decision's explainability contract: what YOU said → what the book does →
   * the mismatch → why this action closes it. Never a universal standard.
   */
  policyBasis: string;
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
  /** Measured alignment-score effect of this alternative, for direct comparison to the winner. */
  alignmentDelta: number;
  rejectedReason: string;
}

/* -------------------------------------------------------------------------- */
/* Gap detection                                                               */
/* -------------------------------------------------------------------------- */

interface Gap {
  kind: GapKind;
  severity: "high" | "medium" | "low";
  finding: string;
  /** The alignment theme whose policy this gap serves. */
  theme: AlignmentThemeId;
  /** The investor's own rule, quoted in their units. */
  policyBasis: string;
}

/**
 * Detect what the portfolio is MISSING — relative to THE INVESTOR'S OWN POLICY.
 *
 * Two rules, both consequences of "there is no universally perfect portfolio":
 *
 *  1. EVERY GAP BELONGS TO A THEME, AND AN OFF THEME GENERATES NOTHING. The old
 *     detector raised a `no_income` gap for every book yielding under 1% — the
 *     universal-weights bug in miniature: a total-return investor's stated
 *     "income is not a goal" was overridden by a hardcoded 1%. Now each gap is
 *     owned by the alignment theme whose question it answers, and a theme the
 *     investor set to Off simply cannot produce recommendations. (The downstream
 *     simulation filter already discarded most of these — this moves the respect
 *     for the policy from "filtered late" to "never asserted".)
 *
 *  2. WHERE THE INVESTOR STATED A NUMBER, THAT NUMBER IS THE TRIGGER. Cash gaps
 *     fire below the investor's own cash-band floor (not a universal 1.5%);
 *     income gaps below their required yield; inflation gaps below the response
 *     floor their protection level sets (the SAME table the alignment theme
 *     scores against); international gaps above the SAME regional ceiling the
 *     exposure theme uses — measured on the CLASSIFIED share, like the theme,
 *     so unclassified holdings cannot dilute a concentration into invisibility.
 *
 * Fact-triggered gaps with no policy number (no ballast, extreme duration, one
 * dominant asset class) keep fact thresholds, but are still owned by a theme and
 * still silenced when that theme is Off.
 *
 * Note what is not here: any notion of a "missing GICS sector". A portfolio without
 * Utilities exposure is not obviously broken.
 */
function detectGaps(evaluation: PortfolioEvaluation): Gap[] {
  const { allocation, risk, policy } = evaluation;
  const p = policy.priorities;
  const t = policy.tolerances;
  const gaps: Gap[] = [];

  const weightOf = (key: string) =>
    allocation.byAssetClass.slices.find((s) => s.key === key)?.weight ?? 0;

  const bonds = weightOf("bond");
  const equityish = weightOf("equity") + weightOf("etf");
  const cash = weightOf("cash");
  const commodities = weightOf("commodity");
  const realAssets = commodities + weightOf("reit") + weightOf("real_estate");

  /* ── Downside (resilience): ballast and rate risk ── */
  if (p.resilience > 0 && bonds < 5 && equityish > 40) {
    gaps.push({
      kind: "no_bonds",
      severity: equityish > 75 ? "high" : "medium",
      theme: "resilience",
      policyBasis: `your downside policy — you said you can sit through at most a ${t.maxDrawdownPct}% drawdown`,
      finding: `${equityish.toFixed(0)}% of the portfolio is in equities with ${bonds < 1 ? "no" : `only ${bonds.toFixed(1)}%`} bond exposure. There is nothing in the portfolio that reliably rallies when equities fall.`,
    });
  }

  if (p.resilience > 0 && risk.duration != null && risk.duration > 8) {
    gaps.push({
      kind: "duration_risk",
      severity: "medium",
      theme: "resilience",
      policyBasis: `your downside policy (≤${t.maxDrawdownPct}% drawdown tolerance)`,
      finding: `Portfolio duration is ${risk.duration.toFixed(1)} years — a +1pp move in rates costs roughly ${risk.duration.toFixed(1)}% of value.`,
    });
  }

  /* ── Inflation: only when the investor asked for protection, against the
        SAME response floor the alignment theme scores (INFLATION_TARGET_S). ── */
  const inflationFloor = INFLATION_TARGET_S[p.inflation];
  if (
    p.inflation > 0 &&
    risk.inflationSensitivity != null &&
    inflationFloor != null &&
    risk.inflationSensitivity < inflationFloor &&
    realAssets < 5
  ) {
    gaps.push({
      kind: "no_inflation_hedge",
      severity: risk.inflationSensitivity < inflationFloor - 2 ? "high" : "medium",
      theme: "inflation",
      policyBasis: `your inflation-protection setting — response no worse than ${inflationFloor}% per +1pp surprise`,
      finding: `A +1pp inflation surprise costs roughly ${Math.abs(risk.inflationSensitivity).toFixed(1)}% of portfolio value against the ${Math.abs(inflationFloor).toFixed(1)}% your protection level tolerates, and there are no real assets to offset it.`,
    });
  }

  /* ── Geography: only when the investor asked for spread, against the SAME
        regional ceiling the exposure theme uses — and measured on the
        CLASSIFIED share so unknown geography cannot dilute the reading.
        Unknown stays unknown: >50% unclassified is a data gap, not a finding. ── */
  const exposureTarget = EXPOSURE_TARGETS[p.exposure];
  const classifiedPct = Math.max(0, 100 - allocation.byGeography.unclassifiedPct);
  const topRegion = allocation.byGeography.slices[0] ?? null;
  if (p.exposure > 0 && exposureTarget && topRegion && classifiedPct >= 50) {
    const topOfClassified = (topRegion.weight / classifiedPct) * 100;
    if (topOfClassified > exposureTarget.maxTopRegionPct) {
      gaps.push({
        kind: "no_international",
        severity: "medium",
        theme: "exposure",
        policyBasis: `your geographic-spread setting — at most ${exposureTarget.maxTopRegionPct}% of classified exposure in one region`,
        finding: `${topRegion.label} carries ${topOfClassified.toFixed(0)}% of classifiable exposure against the ${exposureTarget.maxTopRegionPct}% ceiling your diversification level implies.`,
      });
    }
  }

  /* ── Liquidity: the investor's own cash-band floor is the trigger. A "locked
        away" policy (floor 0) never generates a cash nag. ── */
  const cashFloor = t.cashRangePct[0];
  if (p.liquidity > 0 && cashFloor > 0 && cash < cashFloor) {
    gaps.push({
      kind: "no_cash",
      severity: cash < cashFloor / 2 ? "medium" : "low",
      theme: "liquidity",
      policyBasis: `your liquidity policy — cash band ${t.cashRangePct[0]}–${t.cashRangePct[1]}%`,
      finding: `Cash is ${cash.toFixed(1)}% of the portfolio against the ${cashFloor}% floor of your stated band. Below it, an unexpected need forces a sale at whatever price the market offers that day.`,
    });
  }

  /* ── Income: only when the investor needs it, against THEIR required yield. ── */
  const totalIncome = evaluation.holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);
  const yieldPct = evaluation.totalValue > 0 ? (totalIncome / evaluation.totalValue) * 100 : 0;
  if (p.income > 0 && t.incomeYieldPct > 0 && yieldPct < t.incomeYieldPct) {
    gaps.push({
      kind: "no_income",
      severity: yieldPct < t.incomeYieldPct * 0.5 ? "medium" : "low",
      theme: "income",
      policyBasis: `your income requirement — ${t.incomeYieldPct}%/yr from this book`,
      finding: `Portfolio yield is ${yieldPct.toFixed(2)}% against the ${t.incomeYieldPct}% you said you need. The shortfall is roughly $${Math.round(((t.incomeYieldPct - yieldPct) / 100) * evaluation.totalValue).toLocaleString()}/yr.`,
    });
  }

  /* ── Structure: one dominant asset class (fact threshold, theme-owned). ── */
  if (p.structure > 0 && risk.topAssetClassWeight > 85) {
    gaps.push({
      kind: "equity_concentration",
      severity: "high",
      theme: "structure",
      policyBasis: `your structure policy — the mix your ${policy.goal} goal implies`,
      finding: `${risk.topAssetClassWeight.toFixed(0)}% of the portfolio sits in a single asset class.`,
    });
  }

  return gaps;
}

/* -------------------------------------------------------------------------- */
/* Sizing                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The trade sizes to TRY for a gap — sizing is a measurement, not an
 * assumption. The old single universal size (3/6/10% of book by severity
 * label) is the reason a deep policy mismatch got a token nibble: a book
 * stressing 23pp beyond the investor's tolerance was offered a 10% trade
 * because 10% was all the engine would consider, however large the gap.
 *
 * Now each candidate is simulated at several sizes and the size that MEASURES
 * best per the investor's own policy wins (the same alignmentDelta yardstick
 * as everything else). Still bounded at 15% of the book — a recommendation
 * that restructures half the portfolio will not be acted on, and honesty
 * about "one trade cannot close this gap" belongs in the narration, not in a
 * fantasy trade size.
 */
function candidateSizes(totalValue: number, severity: Gap["severity"]): number[] {
  const basePct = severity === "high" ? 0.10 : severity === "medium" ? 0.06 : 0.03;
  const pcts = [...new Set([basePct * 0.5, basePct, Math.min(basePct * 2, 0.15)])];
  return pcts.map((p) => Math.round(totalValue * p)).filter((v) => v > 0);
}

/**
 * Fit an exposure label into mid-sentence position ("Add …") WITHOUT mangling
 * it — the old blanket toLowerCase() turned "Intermediate US Treasury
 * duration" into "intermediate us treasury duration", and these titles render
 * as 26px headlines on Today. Only the LEADING word is de-capitalized, and
 * only when it isn't an acronym; the label's own casing (US, Treasury, TIPS)
 * is the author's and stays.
 */
function sentenceCaseExposure(label: string): string {
  const [first, ...rest] = label.split(" ");
  if (!first || first === first.toUpperCase()) return label;
  return [first.toLowerCase(), ...rest].join(" ");
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
 * `alignmentDelta × confidence`.
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
    const sizes = candidateSizes(evaluation.totalValue, gap.severity);
    if (sizes.length === 0) continue;

    // Try each candidate AT EACH SIZE and keep the pairing that MEASURES best
    // against the investor's policy — the engine choosing on evidence rather
    // than on the order of a hardcoded list or a one-size-fits-all amount. A
    // deep mismatch earns a structurally-sized proposal because the larger
    // simulation genuinely measures better, not because a severity label said
    // so; near-closed gaps keep small trades for the same reason.
    let best: { c: Candidate; impact: ImpactEstimate; change: PortfolioChange; amount: number } | null = null;
    const bestPerCandidate = new Map<string, { c: Candidate; impact: ImpactEstimate }>();

    for (const c of candidatesFor(gap.kind)) {
      if (seenSymbols.has(c.symbol)) continue;

      for (const amount of sizes) {
        const holding = buildCandidateHolding(c, amount, ctx);
        if (!holding) continue;

        const change: PortfolioChange = { kind: "buy", holding, amount };
        const { impact } = simulate(evaluation, [change], ctx);
        totalEvaluated++;

        const prev = bestPerCandidate.get(c.symbol);
        if (!prev || (impact.alignmentDelta ?? 0) > (prev.impact.alignmentDelta ?? 0)) {
          bestPerCandidate.set(c.symbol, { c, impact });
        }
        if (!best || (impact.alignmentDelta ?? 0) > (best.impact.alignmentDelta ?? 0)) {
          best = { c, impact, change, amount };
        }
      }
    }

    // The engine is allowed to say "this wouldn't help". A recommendation that
    // doesn't survive its own simulation has no business being shown.
    if (!best || (best.impact.alignmentDelta ?? 0) <= 0.5) continue;

    seenSymbols.add(best.c.symbol);

    const alternatives: AlternativeConsidered[] = [...bestPerCandidate.values()]
      .filter((t) => t.c.symbol !== best!.c.symbol)
      .map((t) => ({
        symbol: t.c.symbol,
        exposure: t.c.exposure,
        alignmentDelta: t.impact.alignmentDelta ?? 0,
        rejectedReason: `Measured ${(t.impact.alignmentDelta ?? 0) >= 0 ? "+" : ""}${(t.impact.alignmentDelta ?? 0).toFixed(1)} alignment points at its best size vs. ${best!.c.symbol}'s ${(best!.impact.alignmentDelta ?? 0) >= 0 ? "+" : ""}${(best!.impact.alignmentDelta ?? 0).toFixed(1)}.`,
      }));

    recs.push({
      id: `gap:${gap.kind}`,
      action: "ADD",
      title: `Add ${sentenceCaseExposure(best.c.exposure)} via ${best.c.symbol}`,
      subject: best.c.exposure,
      symbol: best.c.symbol,
      rationale: `${gap.finding} ${best.c.rationale}`,
      theme: gap.theme,
      policyBasis: gap.policyBasis,
      // Subject = the simulated candidate holding, so the buy is judged on the
      // evidence available for the asset being bought — exactly as a trim is
      // judged on the evidence for the asset being trimmed.
      ...confidenceOf(evaluation, best.change.kind === "buy" ? best.change.holding : null, best.impact),
      amount: best.amount,
      impact: best.impact,
      tradeoffs: tradeoffsFor(best.c, best.impact),
      change: best.change,
      priority: 0,
      alternatives,
      alternativesEvaluated: 0, // filled in once the whole pass's total is known
    });
  }

  /* ---- Trim holdings above THE INVESTOR'S OWN cap, each one simulated ---- */

  // The trigger and the target are the investor's stated cap — not the
  // universal 20% from lib/portfolio/policy.ts. Two failure modes died with
  // that constant here:
  //   • cap 10%, position at 15%: the universal 21.5% trigger never fired, so
  //     the Alignment panel showed a breach Decisions could not act on;
  //   • cap 35%, position at 40%: the universal target over-trimmed a
  //     deliberate concentration all the way to 20% instead of back to 35%.
  // Trimming back TO the investor's cap (never below) keeps the shared-fixed-
  // point discipline the old constants existed for; the hysteresis band is the
  // same one the trade policy uses, so quote jitter cannot flip a card in and
  // out. A cap of 100 means "no limit" and generates nothing, ever. When the
  // concentration theme is Off, position size is explicitly not a judgment the
  // investor wants — no trims are generated at all.
  if (evaluation.policy.priorities.concentration > 0) {
    for (const h of evaluation.holdings) {
      // Each position against ITS OWN cap: the general one, or the investor's
      // named exception for this symbol. A position blessed at 30% is never
      // trimmed at 25% — the exception IS the policy for that name; and when
      // it breaches its own exception, the trim targets the EXCEPTION cap.
      const cap = effectiveCapPct(evaluation.policy, h.symbol);
      const exception = h.symbol
        ? evaluation.policy.exceptions.find((e) => e.symbol === h.symbol!.toUpperCase()) ?? null
        : null;
      const trimTrigger = cap + CONCENTRATION_HYSTERESIS_PCT;
      if (h.weight <= trimTrigger || cap >= 100) continue;

      const target = cap;
      const amount = Math.round(((h.weight - target) / 100) * evaluation.totalValue);
      if (amount <= 0) continue;

      const change: PortfolioChange = { kind: "sell", holdingId: h.id, amount };
      const { impact } = simulate(evaluation, [change], ctx);
      totalEvaluated++;
      if ((impact.alignmentDelta ?? 0) <= 0.5) continue;

      const illiquidNote = h.liquidity === "illiquid" || h.liquidity === "t2"
        ? ` Note: this holding is ${h.liquidity === "illiquid" ? "illiquid" : "slow to sell"}, so trimming it is not straightforward.`
        : "";
      const capText = exception
        ? `the ${cap}% exception you set for ${h.symbol}`
        : `the ${cap}% cap you set`;

      recs.push({
        id: `trim:${h.id}`,
        action: "REDUCE",
        // Same 1-decimal precision as the rationale below — the title's rounded
        // "33%" beside the rationale's "32.9%" read as two different facts
        // (audit NI-02).
        title: `Trim ${h.symbol ?? h.name} from ${h.weight.toFixed(1)}% to ${target}%`,
        subject: h.symbol ?? h.name,
        symbol: h.symbol,
        theme: "concentration",
        policyBasis: exception
          ? `your ${cap}% exception for ${h.symbol} — even a blessed position has the limit you gave it`
          : `your concentration cap — at most ${cap}% in a single position`,
        rationale:
          `${h.symbol ?? h.name} is ${h.weight.toFixed(1)}% of the portfolio against ${capText} — ${(h.weight - cap).toFixed(1)}pp above your own limit.${illiquidNote}`,
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
    if ((impact.alignmentDelta ?? 0) <= 0.5) continue;

    recs.push({
      id: `exit:${h.id}`,
      action: "SELL",
      title: `Exit ${h.symbol ?? h.name}`,
      subject: h.symbol ?? h.name,
      symbol: h.symbol,
      // Fact-triggered (instrument quality), not theme-triggered — but it only
      // survives the filter above by measurably improving alignment with the
      // investor's policy, and the basis says so rather than implying a
      // universal "weak holdings must go" rule.
      theme: null,
      policyBasis: `an instrument-quality signal — shown only because selling also measurably improves alignment with your policy`,
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
      priority: (r.impact.alignmentDelta ?? 0) * (r.confidence / 100),
      alternativesEvaluated: totalEvaluated,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

/** The single highest-ROI change available right now. Answers the mission question. */
export function topDecision(recs: Recommendation[]): Recommendation | null {
  return recs[0] ?? null;
}
