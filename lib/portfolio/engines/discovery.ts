/**
 * Investment Discovery — researched candidates worth INVESTIGATING, for a book
 * whose corrective work is done (or whose corrective ideas the investor has
 * already considered and declined).
 *
 * The rules that keep this from being "AI stock picks":
 *
 *   1. NO INVENTED UNIVERSE. Candidates come only from places with real
 *      standing: the investor's own WATCHLIST (their theses, their conviction,
 *      their triggers — ideas they asked UAA to track) and the curated
 *      exposure list in engines/candidates.ts. Nothing is conjured by a model.
 *   2. NO DATA → NO PROPOSAL. A candidate without a live quote and a usable
 *      return history in the market context is skipped, not guessed at.
 *   3. THE POLICY GATES. Every candidate is SIMULATED through the same engines
 *      as everything else, at a deliberately modest exploratory size. One that
 *      fights the investor's policy (alignment falls materially, or any theme
 *      drops hard) is rejected — with the measurement, not a vibe.
 *   4. EVIDENCE IS VISIBLE. Each proposal carries the measured facts it rests
 *      on: role vs the book (correlation to the investor's largest positions),
 *      class-adapter quality score when available, fundamentals from the
 *      context, the investor's own watchlist thesis, and the simulated
 *      per-theme impact. All real, all attributable.
 *   5. AN OPPORTUNITY, NOT AN ORDER. Discovery emits action "INVESTIGATE";
 *      the UI renders research as the primary step and never a one-click buy.
 *
 * Deterministic given the same inputs. No model call anywhere in this file.
 */

import { pearson } from "../../portfolio-analytics";
import { datedReturns, alignPair } from "./series";
import { normalizeHoldings } from "../model/holding";
import { simulate, type PortfolioEvaluation, type ImpactEstimate } from "./simulate";
import { assessConfidence } from "./confidence";
import { effectiveCapPct } from "../alignment/policy";
import { assetClassFromQuoteType } from "../classes/reference/risk-models";
import type { Holding, MarketContext, PortfolioAssetClass, RawHolding } from "../model/types";
import type { Recommendation } from "./recommend";

/** One candidate the discovery engine may research. Provenance is mandatory. */
export interface DiscoveryCandidate {
  symbol: string;
  name?: string | null;
  assetClass?: PortfolioAssetClass | null;
  source: "watchlist" | "curated";
  /** The investor's own notes/thesis from the watchlist row, when present. */
  watchlistNotes?: string | null;
  watchlistConviction?: string | null;
}

/** Exploratory sizing: enough to matter in simulation, small enough to be a look. */
const EXPLORATORY_PCT = 0.04;
/** A discovery must not fight the policy: reject below this simulated delta. */
const MIN_ALIGNMENT_DELTA = -0.25;
/** …and must not sacrifice any single theme materially, whatever the net. */
const MAX_THEME_SACRIFICE_PTS = 1.5;
/** Cap on proposals per build — fewer, better, per the product principle. */
const MAX_DISCOVERIES = 2;
/** Correlation below this vs the book's large positions reads as genuine diversification. */
const DIVERSIFIER_R = 0.4;

interface ResearchedCandidate {
  c: DiscoveryCandidate;
  holding: Holding;
  impact: ImpactEstimate;
  amount: number;
  /** Weight-averaged correlation vs the book's largest positions (null = not computable). */
  avgR: number | null;
  role: string;
  fitRank: number;
}

/**
 * Weight-averaged correlation between the candidate and the book's largest
 * return-bearing positions. Null when there is no overlapping history — an
 * unknown correlation is disclosed as unknown, never scored as zero (the
 * "perfect diversifier" lie risk.ts documents).
 */
function correlationVsBook(symbol: string, evaluation: PortfolioEvaluation, ctx: MarketContext): number | null {
  const candCloses = ctx.history.get(symbol.toUpperCase());
  if (!candCloses || candCloses.length < 40) return null;
  const cand = datedReturns(candCloses);

  const tops = evaluation.holdings
    .filter((h) => h.symbol && ctx.history.has(h.symbol.toUpperCase()))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
  let weighted = 0;
  let weightSum = 0;
  for (const h of tops) {
    const series = datedReturns(ctx.history.get(h.symbol!.toUpperCase())!);
    const aligned = alignPair(cand, series);
    if (!aligned || aligned[0].length < 30) continue;
    weighted += pearson(aligned[0], aligned[1]) * h.weight;
    weightSum += h.weight;
  }
  return weightSum > 0 ? weighted / weightSum : null;
}

/** The role this candidate would play — derived from measurements, stated in plain language. */
function roleOf(holding: Holding, avgR: number | null, yieldPct: number | null): string {
  if (holding.assetClass === "bond") return "Ballast — a sleeve that historically holds up when equities fall";
  if (avgR != null && avgR < DIVERSIFIER_R) {
    return `Diversifier — moves largely independently of your biggest positions (avg r ${avgR.toFixed(2)})`;
  }
  if (yieldPct != null && yieldPct >= 2.5) return `Income — pays ~${yieldPct.toFixed(1)}%/yr while held`;
  const beta = holding.factors.equityBeta;
  if (beta != null && beta >= 1.1) return "Growth addition — extends the book's growth engine";
  return "Portfolio addition — complements the current mix";
}

/**
 * Research one candidate against the actual book and policy. Returns null when
 * any evidence requirement fails — a silent skip, never a padded proposal.
 */
function research(
  c: DiscoveryCandidate,
  evaluation: PortfolioEvaluation,
  ctx: MarketContext,
): ResearchedCandidate | null {
  const symbol = c.symbol.toUpperCase();
  const quote = ctx.quotes.get(symbol);
  if (!quote?.price || quote.price <= 0) return null; // rule 2: no data, no proposal

  // Already a meaningful position → this is a top-up question for the buy
  // flow, not a discovery. (Dust from prior experiments doesn't disqualify.)
  const held = evaluation.holdings.find((h) => h.symbol?.toUpperCase() === symbol);
  if (held && held.weight >= 1) return null;

  const amount = Math.max(1, Math.round(evaluation.totalValue * EXPLORATORY_PCT));
  const assetClass = c.assetClass ?? assetClassFromQuoteType(symbol, quote.name ?? symbol, quote.assetType);
  const raw: RawHolding = {
    id: `discover:${symbol}`,
    assetClass,
    symbol,
    name: c.name ?? quote.name ?? symbol,
    currency: quote.currency ?? "USD",
    quantity: amount / quote.price,
    unit: "shares",
    costBasis: amount,
    acquiredAt: new Date(0).toISOString(),
    manualValue: null,
    manualValueAsOf: null,
    meta: { candidate: true },
  };
  const { holdings } = normalizeHoldings([raw], ctx);
  const holding = holdings[0];
  if (!holding) return null;

  // Rule 3: the policy gates, by measurement.
  const { impact } = simulate(evaluation, [{ kind: "buy", holding, amount }], ctx);
  if (impact.alignmentDelta != null && impact.alignmentDelta < MIN_ALIGNMENT_DELTA) return null;
  if (impact.themeDeltas.some((t) => t.delta < -MAX_THEME_SACRIFICE_PTS)) return null;
  // An exploratory position must also respect the investor's own cap trivially.
  const capPct = effectiveCapPct(evaluation.policy, symbol);
  if (EXPLORATORY_PCT * 100 > capPct) return null;

  const avgR = correlationVsBook(symbol, evaluation, ctx);
  const yieldPct = holding.income && holding.valuation.valueBase > 0
    ? (holding.income.annual / holding.valuation.valueBase) * 100
    : null;

  // Rank: measured policy fit first, then independence from the book, then the
  // class adapter's own quality read. Deterministic and documented:
  //   fitRank = alignmentDelta + 2×(independence bonus) + score/50
  const independence = avgR != null ? Math.max(0, DIVERSIFIER_R - avgR) : 0;
  const fitRank = (impact.alignmentDelta ?? 0) + independence * 2 + (holding.score ? holding.score.score / 50 : 0);

  return { c, holding, impact, amount, avgR, role: roleOf(holding, avgR, yieldPct), fitRank };
}

/**
 * Propose up to MAX_DISCOVERIES researched candidates. Runs only when the
 * corrective pipeline has little left to say (the caller decides) — discovery
 * complements decisions, it never crowds out a genuine policy fix.
 */
export function computeDiscovery(
  evaluation: PortfolioEvaluation,
  ctx: MarketContext,
  pool: DiscoveryCandidate[],
  opts: {
    excludeTheses?: Set<string>;
    /** Symbols already proposed by ACTIVE corrective recommendations — a discovery must add a NEW idea, not restate one. */
    excludeSymbols?: Set<string>;
    /** Asset classes an active ADD already covers — "worth a look: another bond" beside "Add bonds" is repetition, not discovery. */
    excludeAssetClasses?: Set<string>;
    max?: number;
  } = {},
): Recommendation[] {
  if (evaluation.holdings.length === 0 || evaluation.totalValue <= 0) return [];
  const max = opts.max ?? MAX_DISCOVERIES;
  const exclude = opts.excludeTheses ?? new Set<string>();
  const excludeSymbols = new Set([...(opts.excludeSymbols ?? [])].map((s) => s.toUpperCase()));

  const researched: ResearchedCandidate[] = [];
  const seen = new Set<string>();
  for (const c of pool) {
    const symbol = c.symbol.trim().toUpperCase();
    if (!symbol || seen.has(symbol) || exclude.has(`discover:${symbol}`) || excludeSymbols.has(symbol)) continue;
    seen.add(symbol);
    const r = research(c, evaluation, ctx);
    if (r && !opts.excludeAssetClasses?.has(r.holding.assetClass)) researched.push(r);
  }

  researched.sort((a, b) => b.fitRank - a.fitRank);

  // Diversity over volume: one proposal per ROLE. Two "ballast" cards are one
  // idea told twice — the second slot must earn its place with a different
  // thesis or stay empty.
  const picked: ResearchedCandidate[] = [];
  const seenRoles = new Set<string>();
  for (const r of researched) {
    const roleKey = r.role.split(" — ")[0];
    if (seenRoles.has(roleKey)) continue;
    seenRoles.add(roleKey);
    picked.push(r);
    if (picked.length >= max) break;
  }

  return picked.map((r) => {
    const symbol = r.holding.symbol!;
    const gains = r.impact.themeDeltas.filter((t) => t.delta >= 0.25).slice(0, 2);
    const evidence: string[] = [
      r.role + ".",
      r.avgR != null
        ? `Measured correlation to your five largest positions: ${r.avgR.toFixed(2)}.`
        : "Correlation to your book could not be measured (insufficient overlapping history) — treat diversification claims accordingly.",
    ];
    if (r.holding.score) {
      evidence.push(
        `Scores ${r.holding.score.score}/100 on ${r.holding.assetClass} metrics at ${r.holding.score.confidence}% evidence coverage.`,
      );
    }
    if (gains.length > 0) {
      evidence.push(`Simulated at ${(EXPLORATORY_PCT * 100).toFixed(0)}% of the book it improves ${gains.map((g) => `${g.label} (+${g.delta.toFixed(1)})`).join(" and ")}.`);
    }
    if (r.c.watchlistNotes) evidence.push(`Your own watchlist notes: “${r.c.watchlistNotes}”.`);

    return {
      id: `discover:${symbol}`,
      action: "INVESTIGATE" as const,
      title: `Worth a look: ${symbol} — ${r.role.split(" — ")[0].toLowerCase()}`,
      subject: r.holding.name,
      symbol,
      rationale: evidence.join(" "),
      theme: null,
      policyBasis:
        r.c.source === "watchlist"
          ? `investment discovery from YOUR watchlist — researched against your policy; an opportunity to investigate, not an instruction to buy`
          : `investment discovery from the curated exposure list — researched against your policy; an opportunity to investigate, not an instruction to buy`,
      ...(() => {
        const assessed = assessConfidence(evaluation, r.holding, { riskMeasured: r.impact.riskDelta != null });
        return { confidence: assessed.score, confidenceBasis: assessed.basis };
      })(),
      amount: r.amount,
      impact: r.impact,
      tradeoffs: [
        "Uses cash (or requires selling something) if you decide to act after researching it.",
        r.avgR != null && r.avgR >= DIVERSIFIER_R
          ? `Correlated with what you already own (avg r ${r.avgR.toFixed(2)}) — it extends existing bets more than it spreads them.`
          : "Any new position adds a name to monitor.",
      ],
      change: { kind: "buy" as const, holding: r.holding, amount: r.amount },
      priority: 0,
      alternatives: [],
      alternativesEvaluated: 0,
    };
  });
}
