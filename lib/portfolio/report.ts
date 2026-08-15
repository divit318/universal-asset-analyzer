/**
 * The Universal Portfolio Report — the single object the Portfolio page renders.
 *
 * This is the composition root: it reads BOTH ledgers (market-priced + manual),
 * builds one MarketContext through the platform layer, normalizes everything into
 * the Universal Holdings Model, and runs the engines. Everything downstream — every
 * tab, every API route, the AI layer — consumes this.
 *
 * Server-only.
 */

import { listRawHoldings } from "./store";
import { getDataset } from "../platform";
import { maybeMetric, type Metric } from "../metric";
import { buildMarketContext } from "./context";
import { normalizeHoldings } from "./model/holding";
import { loadInvestorPolicy } from "./alignment/store";
import { evaluate, type PortfolioEvaluation } from "./engines/simulate";
import { computeConcentration, type ConcentrationFinding } from "./engines/allocation";
import { computeAttribution, type ReturnAttribution } from "./engines/attribution";
import { getPortfolioTrajectory, type PortfolioTrajectory } from "./history";
import { runAllScenarios, type ScenarioResult } from "./engines/scenario";
import { computeRecommendations, getRelevantCandidateSymbols, type Recommendation } from "./engines/recommend";
import { applyDecisionMemory } from "./engines/decision-memory";
import { computeDiscovery, type DiscoveryCandidate } from "./engines/discovery";
import { CANDIDATES } from "./engines/candidates";
import { listDecisionDismissals, listWatchlist } from "../db";
import { buildDecisionCards, type DecisionCard } from "./engines/decision";
import { optimize, DEFAULT_CONSTRAINTS, type Objective, type OptimizationResult } from "./engines/optimize";
import { buildPerformance, isEmptyPerformance, type PerformanceBlock } from "./performance";
import type { Holding, MarketContext, RawHolding } from "./model/types";
import type { PortfolioAllocation } from "./engines/allocation";
import type { UniversalRisk } from "./engines/risk";
import type { AlignmentReport } from "./alignment/engine";
import type { InvestorPolicy } from "./alignment/policy";

export interface BuiltEvaluation {
  raws: RawHolding[];
  ctx: MarketContext;
  evaluation: PortfolioEvaluation;
  totalCost: number;
  marketPricedPct: number;
  stalePct: number;
}

/**
 * The two-pass context build every portfolio-reading route needs: held
 * holdings only (pass 1), then the specific recommendation candidates this
 * portfolio's gaps actually need (pass 2, often zero symbols). Extracted so
 * the Transaction Engine's preview/execute routes can get the same real
 * `PortfolioEvaluation` + `MarketContext` objects `buildPortfolioReport()`
 * uses internally, instead of re-fetching or re-deriving anything.
 */
export async function buildEvaluation(opts: ReportOptions = {}): Promise<BuiltEvaluation> {
  const portfolioId = opts.portfolioId ?? 1;
  const raws = listRawHoldings(portfolioId);
  const extra = opts.extraCandidateSymbols ?? [];
  // The investor's own policy is part of the evaluation: alignment is facts ×
  // policy, and every downstream simulation differences evaluations under it.
  const policy = loadInvestorPolicy(portfolioId);

  let ctx = await buildMarketContext(raws, { baseCurrency: opts.baseCurrency, candidateSymbols: extra });
  let { holdings, totalCost, marketPricedPct, stalePct } = normalizeHoldings(raws, ctx);
  let evaluation: PortfolioEvaluation = evaluate(holdings, ctx, policy);

  const neededCandidates = [...new Set([...extra, ...getRelevantCandidateSymbols(evaluation)])];
  if (neededCandidates.length > extra.length) {
    ctx = await buildMarketContext(raws, { baseCurrency: opts.baseCurrency, candidateSymbols: neededCandidates });
    ({ holdings, totalCost, marketPricedPct, stalePct } = normalizeHoldings(raws, ctx));
    evaluation = evaluate(holdings, ctx, policy);
  }

  return { raws, ctx, evaluation, totalCost, marketPricedPct, stalePct };
}

export interface UniversalPortfolioReport {
  generatedAt: string;
  baseCurrency: string;

  holdingCount: number;
  totalValue: number;
  totalCost: number;
  totalReturn: number;
  totalReturnDollar: number;
  todayChangeDollar: number;
  todayChangePct: number;
  /**
   * The denominator behind `todayChangePct`: the summed current value of the
   * holdings that actually had a live quote this session. Exposed so surfaces
   * that attribute the day move per holding (the homepage's contributors) can
   * divide by the SAME population the percentage was computed over, instead of
   * re-deriving a denominator that silently disagrees (audit NI-01).
   */
  todayChangeBaseValue: number;
  /**
   * COST-WEIGHTED average holding period, in days — "how long has my money
   * actually been invested?"
   *
   * `totalReturn` is a since-inception figure with no period attached, and an
   * unqualified "+0.2%" is not a rate: it is excellent over a week and dismal over
   * six years. On a real book it sat next to "Today +0.42%", so the day's move was
   * double the entire lifetime return and both figures looked broken.
   *
   * The period must be COST-WEIGHTED, not the age of the oldest holding. The first
   * attempt used `min(acquiredAt)` and reported "+0.2% over 6.7y" for a book whose
   * capital went in 17 days ago — because one manually-valued asset (a property
   * bought in 2019) is worth 0.006% of the portfolio and set the whole period. That
   * reads as 0.03%/yr, which is worse than no period at all.
   *
   * Weighting each holding's age by its cost basis answers the question the reader
   * is actually asking, and is the same reasoning that makes money-weighted return
   * the right rate for a portfolio with irregular contributions.
   */
  holdingPeriodDays: number;

  /** Annual income across ALL sources — dividends, coupons, rent, interest, staking. */
  annualIncome: number;
  incomeYieldPct: number;

  /**
   * Data-quality disclosure. A portfolio that is 60% self-reported marks has a
   * "total value" that is largely the user's own opinion, and every percentage in
   * this report inherits that softness. We state it rather than presenting a
   * manually-marked total with the same authority as a marked-to-market one.
   */
  marketPricedPct: number;
  stalePct: number;
  /**
   * Currencies carried at 1:1 because their FX rate could not be resolved.
   *
   * Non-empty means `totalValue` and every percentage derived from it are wrong by
   * an unknown amount for those holdings — and nothing else in the UI can reveal it,
   * since a failed lookup produces a rate of exactly 1 and therefore looks like a
   * base-currency position.
   */
  unresolvedCurrencies: string[];

  holdings: Holding[];
  /**
   * Per-holding day moves as stamped Metrics (audit F-22g). `dayChange` is the
   * session move vs previous close; `sinceCost` is P&L on cost. They are
   * DIFFERENT quantities — the homepage once ranked "today's movers" on
   * sinceCost, which put a -7.6% since-purchase figure under a "today" label.
   * Only market-priced, symbol-bearing holdings appear.
   */
  dayMoves: HoldingDayMove[];
  allocation: PortfolioAllocation;
  /**
   * Where the return actually came from, and how concentrated its sources are.
   * Null when nothing in the book has a usable cost basis.
   */
  attribution: ReturnAttribution | null;
  /**
   * Whether the book is improving or deteriorating, and how the user's own
   * executed changes turned out. Null until at least two snapshots exist.
   */
  trajectory: PortfolioTrajectory | null;
  concentration: ConcentrationFinding[];
  risk: UniversalRisk;
  /** Facts × the investor's own policy — see lib/portfolio/alignment/engine.ts. */
  alignment: AlignmentReport;
  /** The policy the alignment was scored against (assumed defaults until confirmed). */
  policy: InvestorPolicy;
  scenarios: ScenarioResult[];
  recommendations: Recommendation[];
  /** Same recommendations, ranked and narrated as investment-committee decisions. */
  decisions: DecisionCard[];
  /**
   * Theses the investor dismissed and that remain suppressed — shown as a
   * restorable memory ("you declined this on …"), never re-pitched as new.
   * Because suppression happens HERE, every consumer of this report
   * (Decisions tab, Today's attention queue, home spotlight, digest) shares
   * one memory instead of independently rediscovering rejected ideas.
   */
  suppressedDecisions: {
    thesisKey: string;
    title: string;
    dismissedAt: string;
    /** What would bring it back, in plain language. */
    reviveWhen: string;
  }[];
  optimization: OptimizationResult;
  /**
   * True when BOTH engines agree there is nothing left to do for the current
   * objective: the optimizer proposes no rebalancing trades AND the recommendation
   * engine surfaces no material improvement. This is the single, jointly-true
   * "you're done" signal the two tabs previously lacked — each could only speak for
   * itself, so a converged optimizer still sat next to a Decision Center insisting
   * on a trade. A mature optimizer must be able to say "at equilibrium", and mean it
   * across the whole page.
   */
  atEquilibrium: boolean;

  /**
   * Money-weighted return, realized/unrealized split, per-position breakdown and
   * the benchmark replication — or `{ empty: true }` for a portfolio with no lot
   * history.
   *
   * Carried ON the report rather than fetched separately by the Performance tab.
   * `performance.total` is the source of `totalReturn`/`totalReturnDollar` above,
   * so the headline tile and the Performance tab are reading the same number from
   * the same snapshot — they cannot drift, and they cannot disagree on sign.
   */
  performance: PerformanceBlock;
}

export interface ReportOptions {
  baseCurrency?: string;
  objective?: Objective;
  /**
   * Additional symbols to fetch alongside the portfolio's own gap-fill
   * candidates — e.g. a Watchlist symbol under consideration that isn't held
   * and isn't a recommendation-engine candidate. Merged into both fetch passes.
   */
  extraCandidateSymbols?: string[];
  /** Which named portfolio to report on. Defaults to the Main Portfolio. */
  portfolioId?: number;
}

export interface HoldingDayMove {
  symbol: string;
  /** Session move vs previous close; null when the quote had no change. */
  dayChange: Metric<"day"> | null;
  /** Return on average cost; null when cost basis is unusable. */
  sinceCost: Metric<"sinceCost"> | null;
  /** Day move in base currency, from the holding's current value. */
  dayDollar: number | null;
  /** Unrealized P&L in base currency. */
  plDollar: number | null;
}

/** The stamped per-holding movers (audit F-22g). Pure projection of ctx quotes. */
function computeDayMoves(holdings: Holding[], ctx: MarketContext, generatedAtMs: number): HoldingDayMove[] {
  const out: HoldingDayMove[] = [];
  for (const h of holdings) {
    if (h.valuation.mode !== "market" || !h.symbol) continue;
    const q = ctx.quotes.get(h.symbol.toUpperCase());
    if (!q) continue;
    const asOf = q.asOf ?? generatedAtMs;
    const day = maybeMetric(q.changePercent, "day", asOf, "yahoo", q.sessionDate ?? null);
    const sinceCost = maybeMetric(h.unrealizedPct, "sinceCost", asOf, "yahoo");
    if (!day && !sinceCost) continue;
    out.push({
      symbol: h.symbol,
      dayChange: day,
      sinceCost,
      dayDollar: day ? h.valuation.valueBase * (day.value / 100) : null,
      plDollar: h.unrealizedPL,
    });
  }
  return out;
}

/**
 * Today's change, computed only over holdings that actually have a live quote.
 *
 * A house does not move 0.4% today just because the S&P did, and counting its
 * unchanged manual value as "flat" in the denominator would silently dilute the
 * day's percentage move toward zero.
 */
function todayChange(holdings: Holding[], ctx: MarketContext): { dollar: number; pct: number; baseValue: number } {
  let dollar = 0;
  let liveValue = 0;

  for (const h of holdings) {
    if (h.valuation.mode !== "market" || !h.symbol) continue;
    const q = ctx.quotes.get(h.symbol.toUpperCase());
    if (!q || q.changePercent == null) continue;
    dollar += h.valuation.valueBase * (q.changePercent / 100);
    liveValue += h.valuation.valueBase;
  }

  return { dollar, pct: liveValue > 0 ? (dollar / liveValue) * 100 : 0, baseValue: liveValue };
}

/**
 * The page headline's total return, taken from the performance block.
 *
 * Falls back to cost-vs-value only when there is no lot ledger at all (a portfolio
 * of nothing but manually-valued assets), where realized P&L cannot exist and the
 * two definitions coincide by construction.
 *
 * The assertion is deliberate. `performance.total.cost` is built up from the traded
 * book's cost basis plus each excluded holding's, and `totalCost` is an independent
 * sum over every normalized holding. They are derived from one snapshot, so a
 * mismatch means this file's bookkeeping is wrong — and a headline return that is
 * silently computed over the wrong denominator is exactly the failure this whole
 * change exists to remove. Loud beats plausible.
 */
function totalReturnOf(
  performance: PerformanceBlock,
  totalValue: number,
  totalCost: number,
): { pnl: number; pct: number } {
  if (isEmptyPerformance(performance)) {
    return {
      pnl: totalValue - totalCost,
      pct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    };
  }

  if (Math.abs(performance.total.cost - totalCost) > 0.01) {
    console.warn(
      `[portfolio/report] total-return denominator disagrees with totalCost by ` +
        `${(performance.total.cost - totalCost).toFixed(2)} ` +
        `(performance.total.cost=${performance.total.cost.toFixed(2)}, totalCost=${totalCost.toFixed(2)}). ` +
        `The Dashboard tile and the Performance tab will not match.`,
    );
  }

  return { pnl: performance.total.pnl, pct: performance.total.pct };
}

/**
 * The report through the platform cache (audit PF-02): one homepage load used
 * to build this three times in parallel (digest, IOS context, brief route) at
 * 8-9s each. `portfolioReport` carries a 2-minute TTL + SWR in the platform
 * registry; portfolio mutations invalidate it (and the digest cascades) via
 * `invalidateDataset("portfolioReport")`. Callers that need a guaranteed-fresh
 * build (a route responding to a mutation) pass `fresh: true`.
 */
export async function getPortfolioReport(
  opts: ReportOptions = {},
  cacheOpts: { fresh?: boolean } = {},
): Promise<UniversalPortfolioReport> {
  // The investor policy AND the decision memory are part of the REPORT'S
  // IDENTITY, not just its inputs. Invalidation alone proved insufficient: a
  // rebuild in flight when either was written could finish after the
  // invalidate and write a stale report back under the same key with a fresh
  // timestamp — SWR then served decisions computed against limits the
  // investor had already changed (observed live: six hours of "you said 15%"
  // after the tolerance was raised to 30%), or re-showed a thesis dismissed
  // seconds earlier. Keying on both versions makes the race structurally
  // impossible: a save/dismissal is a NEW key, and stale writes land on a key
  // nothing reads anymore.
  const portfolioId = opts.portfolioId ?? 1;
  const policyVersion = loadInvestorPolicy(portfolioId).updatedAt ?? "defaults";
  const dismissals = listDecisionDismissals(portfolioId);
  const memoryVersion = `${dismissals.length}:${dismissals.reduce((m, d) => (d.dismissedAt > m ? d.dismissedAt : m), "")}`;
  const { data } = await getDataset(
    "portfolioReport",
    {
      objective: opts.objective ?? "maximize_sharpe",
      portfolioId,
      baseCurrency: opts.baseCurrency ?? "USD",
      policyVersion,
      memoryVersion,
      extra: opts.extraCandidateSymbols?.slice().sort().join(",") || undefined,
    },
    () => buildPortfolioReport(opts),
    { fresh: cacheOpts.fresh, timeoutMs: 60_000 },
  );
  return data;
}

/** Build the full report. This is the one entry point the API routes call. */
export async function buildPortfolioReport(
  opts: ReportOptions = {},
): Promise<UniversalPortfolioReport> {
  // Discovery-grade context: the REPORT (and only the report — transaction
  // previews keep the lean two-pass build) also fetches the investor's most
  // recent watchlist ideas and the curated exposure list, so the discovery
  // engine researches against real quotes/history instead of skipping
  // everything for lack of data. Bounded and 2-min platform-cached.
  const watchlistSymbols = listWatchlist()
    .filter((w) => w.stage !== "passed" && w.stage !== "exited" && w.stage !== "owned")
    .sort((a, b) => (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0))
    .slice(0, 12)
    .map((w) => w.symbol);
  const discoverySymbols = [...new Set([...watchlistSymbols, ...CANDIDATES.map((c) => c.symbol)])];

  const { ctx, evaluation, totalCost, marketPricedPct, stalePct } = await buildEvaluation({
    ...opts,
    extraCandidateSymbols: [...new Set([...(opts.extraCandidateSymbols ?? []), ...discoverySymbols])],
  });
  const totalValue = evaluation.totalValue;

  // Performance is derived from THIS evaluation, not re-fetched. One snapshot for
  // the headline and the Performance tab — see lib/portfolio/performance.ts for the
  // $2,074.82 gap that two independent fetches produced.
  const performance = await buildPerformance(evaluation.holdings, ctx.asOf, opts.portfolioId ?? 1, ctx);

  // Policy-relative holding flags: the KNOW-THIS strip and the Alignment panel
  // must read the same ruler — one cap, one verdict, page-wide.
  const concentration = computeConcentration(evaluation.holdings, evaluation.allocation, evaluation.policy);
  const scenarios = runAllScenarios(evaluation.holdings, evaluation.totalValue);
  // ── Decision memory: what the investor already considered ────────────────
  // Freshly generated theses are checked against persisted dismissals BEFORE
  // any card exists — a rejected idea stays down (until something material
  // changes), and the freed attention goes to different theses and, when the
  // corrective list runs thin, to researched discovery candidates.
  const dismissals = listDecisionDismissals(opts.portfolioId ?? 1);
  const generated = computeRecommendations(evaluation, ctx);
  const memory = applyDecisionMemory(generated, dismissals, evaluation);

  // Discovery complements decisions — it never crowds out a genuine fix. It
  // runs when fewer than three corrective actions survive the memory filter,
  // which includes both "the book is fine" and "the investor declined the
  // obvious fixes": exactly the moments a research system should widen the
  // search instead of repeating itself or going silent.
  let discoveries: Recommendation[] = [];
  if (memory.active.length < 3) {
    const watchlistPool: DiscoveryCandidate[] = listWatchlist()
      .filter((w) => w.stage !== "passed" && w.stage !== "exited" && w.stage !== "owned")
      .sort((a, b) => (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0))
      .slice(0, 12)
      .map((w) => ({
        symbol: w.symbol,
        name: w.name,
        source: "watchlist" as const,
        watchlistNotes: w.notes ?? w.buyTrigger,
        watchlistConviction: w.conviction,
      }));
    const curatedPool: DiscoveryCandidate[] = CANDIDATES.map((c) => ({
      symbol: c.symbol,
      name: c.name,
      assetClass: c.assetClass,
      source: "curated" as const,
    }));
    // Only candidates whose data is ALREADY in context are researched — no
    // second fetch pass. Held symbols and the gap candidates arrive with the
    // context; watchlist symbols are included below via extraCandidateSymbols
    // when the caller asked for discovery-grade context (the report does).
    discoveries = computeDiscovery(evaluation, ctx, [...watchlistPool, ...curatedPool], {
      excludeTheses: new Set(dismissals.map((d) => d.thesisKey)),
      // A discovery must be a NEW idea: never a symbol an active card already
      // proposes, never another instrument for an asset class an active ADD
      // already covers ("Add bonds via IEF" + "worth a look: another bond" is
      // one idea told twice) — and the same bar applies to SUPPRESSED ADDs:
      // an investor who dismissed "add bond ballast" must not be re-pitched
      // the identical idea wearing a discovery card ("worth a look: USFR —
      // ballast" is gap:no_bonds in a softer coat).
      excludeSymbols: new Set(
        [...memory.active, ...memory.suppressed.map((s) => s.rec)]
          .map((r) => r.symbol)
          .filter((s): s is string => !!s),
      ),
      excludeAssetClasses: new Set(
        [...memory.active, ...memory.suppressed.map((s) => s.rec)]
          .filter((r) => r.change.kind === "buy")
          .map((r) => (r.change.kind === "buy" ? r.change.holding.assetClass : null))
          .filter((c): c is NonNullable<typeof c> => c != null),
      ),
    });
  }

  const recommendations = [...memory.active, ...discoveries];
  const decisions = buildDecisionCards(recommendations, evaluation);
  const suppressedDecisions = memory.suppressed.map(({ rec, dismissal }) => ({
    thesisKey: dismissal.thesisKey,
    title: dismissal.title || rec.title,
    dismissedAt: dismissal.dismissedAt,
    reviveWhen:
      "returns if your policy changes, the position grows ≥5pp past its dismissed size, or its theme falls ≥12 pts — or restore it here",
  }));
  const optimization = optimize(
    evaluation,
    opts.objective ?? "maximize_sharpe",
    DEFAULT_CONSTRAINTS,
    undefined,
    ctx,
  );

  const annualIncome = evaluation.holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);
  const change = todayChange(evaluation.holdings, ctx);

  // Cost-weighted average age. A holding contributes its age in proportion to the
  // capital it consumed, so a $600 collectible bought in 2019 cannot define the
  // period for a book whose $9M went in last week. Holdings with an unparseable
  // date or no cost basis are skipped rather than counted as age zero, which would
  // drag the average toward "brand new".
  let ageWeightedCost = 0;
  let ageCostBase = 0;
  const now = Date.now();
  for (const h of evaluation.holdings) {
    const t = Date.parse(h.acquiredAt);
    if (!Number.isFinite(t) || h.costBasisBase <= 0) continue;
    const days = Math.max(0, (now - t) / 86_400_000);
    ageWeightedCost += days * h.costBasisBase;
    ageCostBase += h.costBasisBase;
  }
  const holdingPeriodDays = ageCostBase > 0 ? Math.round(ageWeightedCost / ageCostBase) : 0;

  return {
    generatedAt: ctx.asOf,
    baseCurrency: ctx.baseCurrency,

    holdingCount: evaluation.holdings.length,
    totalValue,
    totalCost,

    // ── Total return: ONE definition, shared with the Performance tab ──────────
    //
    // This used to be `(totalValue - totalCost) / totalCost`, which is blind to
    // realized P&L: a sold position leaves `holdings`, so the −$9,819.50 this book
    // had banked was invisible here while the Performance tab counted it. The two
    // tiles disagreed on the SIGN of the portfolio's return (−$396.01 vs
    // +$5,359.31) with nothing on the page acknowledging it.
    //
    // `performance.total` is now the single source: realized + unrealized over
    // EVERY holding (manual assets included, which the Performance tab used to
    // omit), over capital at risk. The assertion below is what keeps it honest.
    totalReturn: totalReturnOf(performance, totalValue, totalCost).pct,
    totalReturnDollar: totalReturnOf(performance, totalValue, totalCost).pnl,
    todayChangeDollar: change.dollar,
    todayChangePct: change.pct,
    todayChangeBaseValue: change.baseValue,
    holdingPeriodDays,

    annualIncome,
    incomeYieldPct: totalValue > 0 ? (annualIncome / totalValue) * 100 : 0,

    marketPricedPct: Math.round(marketPricedPct),
    stalePct: Math.round(stalePct),
    unresolvedCurrencies: ctx.unresolvedCurrencies ?? [],

    holdings: evaluation.holdings,
    dayMoves: computeDayMoves(evaluation.holdings, ctx, Date.now()),
    allocation: evaluation.allocation,
    attribution: computeAttribution(evaluation.holdings),
    // A local SQLite read, so this costs nothing next to the provider fetches the
    // rest of the report already made.
    trajectory: getPortfolioTrajectory(),
    concentration,
    risk: evaluation.risk,
    alignment: evaluation.alignment,
    policy: evaluation.policy,
    scenarios,
    recommendations,
    decisions,
    suppressedDecisions,
    optimization,
    // Discovery cards are opportunities, not corrective work — a book can be
    // at equilibrium AND have something worth researching.
    atEquilibrium: optimization.trades.length === 0 && memory.active.length === 0,

    // Money-weighted return, realized/unrealized split, per-position breakdown and
    // the benchmark replication — from the SAME snapshot as everything above, which
    // is what lets the Performance tab render the page's own total value rather
    // than a second one taken seconds later.
    performance,
  };
}

/** Re-run everything against an in-memory portfolio. Used by what-if simulation. */
export { evaluate } from "./engines/simulate";
