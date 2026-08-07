/**
 * POST /api/portfolio/buy/recommendation
 *
 * The Watchlist's "should I buy this, and how much" answer. Powers the
 * Investment Recommendation modal — replaces the old Buy modal's "pick an
 * asset class, pick a dollar amount" with a portfolio-aware recommendation
 * built entirely from the existing engines:
 *
 *   - lib/portfolio/report.ts's buildEvaluation() for the real portfolio state
 *     (same two-pass MarketContext build every portfolio route uses)
 *   - risk-models.ts's assetClassFromQuoteType() for the asset
 *     class — the user is never asked to classify the asset
 *   - lib/portfolio/engines/position-size.ts for the recommended size, the
 *     marginal-benefit curve, and alternative-size scenarios
 *   - lib/portfolio/engines/recommend.ts's computeRecommendations() for
 *     REDUCE/SELL candidates when cash on hand doesn't cover the recommended
 *     amount — the exact same trade-recommendation engine the Decision Center
 *     uses, not a new heuristic
 *   - lib/portfolio/engines/position-size-explain.ts for the deterministic,
 *     "measured not asserted" narration
 *   - lib/portfolio/engines/asset-signal.ts to carry the Research page's own
 *     verdict (composite score, valuation upside, risk flags) into the sizing
 *     decision, so this modal can never contradict the report beside it
 */
import { NextResponse } from "next/server";
import { isValidSymbol } from "@/lib/market";
import { getQuotes } from "@/lib/yahoo";
import { getValuationCase } from "@/lib/db";
import { summarizeForDisplay } from "@/lib/valuation/summary";
import { buildFundamentalsData } from "@/lib/fundamentals-data";
import { buildEvaluation } from "@/lib/portfolio/report";
import { computePositionSizing, computePositionSizingAtAmount } from "@/lib/portfolio/engines/position-size";
import { deriveAssetSignal, type AssetSignal } from "@/lib/portfolio/engines/asset-signal";
import { computeRecommendations } from "@/lib/portfolio/engines/recommend";
import { isIndivisibleHolding } from "@/lib/portfolio/engines/transaction";
import { OBJECTIVES, DEFAULT_CONSTRAINTS, type Objective, type Constraints } from "@/lib/portfolio/engines/optimize";
import { type PortfolioAssetClass } from "@/lib/portfolio/model/types";
import { assetClassFromQuoteType } from "@/lib/portfolio/classes/reference/risk-models";
import { buildAiExplanation, buildHeadline, buildPositionSizingWhy, buildSummary } from "@/lib/portfolio/engines/position-size-explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard budget for the research fetch — the modal must not hang on a slow EDGAR day. Underlying data is platform-cached (4-12h), so warm paths return in ms. */
const SIGNAL_TIMEOUT_MS = 12_000;

/**
 * The Research page's own analysis for this symbol, shaped for the sizing
 * engine. Best-effort by design: a bond ETF, a commodity or a Yahoo outage
 * yields null and the engine falls back to its signal-free geometric path —
 * a degraded recommendation beats a failed one.
 */
async function loadAssetSignal(symbol: string, livePrice: number | null): Promise<AssetSignal | null> {
  try {
    const data = await Promise.race([
      buildFundamentalsData(symbol),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SIGNAL_TIMEOUT_MS)),
    ]);
    if (!data) return null;

    // The user's own valuation case outranks analyst consensus when one exists.
    let caseUpside: number | null = null;
    try {
      const vcase = getValuationCase(symbol);
      if (vcase) {
        const summary = summarizeForDisplay(vcase, livePrice, null);
        if (!summary.result.invalidReason) caseUpside = summary.result.impliedUpside;
      }
    } catch {
      // A broken valuation case must not take down the whole signal.
    }

    return deriveAssetSignal(symbol, data, caseUpside);
  } catch {
    return null;
  }
}

interface RecommendationBody {
  symbol?: string;
  name?: string;
  objective?: Objective;
  customTarget?: Partial<Record<PortfolioAssetClass, number>>;
  constraints?: Partial<Constraints>;
  /**
   * Live Preview override: when set, the response describes THIS amount
   * (however the modal's active sizing mode resolved it — dollars, shares,
   * %portfolio, %cash) instead of the engine's own optimal size. Powers the
   * "customize investment" flow so every downstream number (impact, funding
   * shortfall, sell suggestions, warnings) stays correct for whatever the
   * user actually typed, not just the recommendation they started from.
   */
  amount?: number;
}

/** How much can be funded from cash on hand alone, vs. how much would need to come from selling something. */
function fundingShortfall(recommendedAmount: number, cashAvailable: number) {
  return Math.max(0, Math.round(recommendedAmount - cashAvailable));
}

export async function POST(request: Request) {
  let body: RecommendationBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "`symbol` must be a valid ticker (e.g. AAPL)" }, { status: 400 });
  }

  const objective = body.objective ?? "maximize_sharpe";
  if (!(objective in OBJECTIVES)) {
    return NextResponse.json(
      { error: `\`objective\` must be one of: ${Object.keys(OBJECTIVES).join(", ")}` },
      { status: 400 },
    );
  }
  if (objective === "target_allocation" && !body.customTarget) {
    return NextResponse.json({ error: "`customTarget` is required for the target_allocation objective" }, { status: 400 });
  }

  try {
    const quotes = await getQuotes([symbol]);
    const quote = quotes[0];
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
      return NextResponse.json({ error: `No live price available for ${symbol}` }, { status: 502 });
    }
    const assetClass = assetClassFromQuoteType(symbol, quote.name ?? symbol, quote.assetType);
    const name = body.name?.trim() || quote.name || symbol;

    // The portfolio evaluation and the research signal are independent — fetch both at once.
    const [{ ctx, evaluation }, signal] = await Promise.all([
      buildEvaluation({ objective, extraCandidateSymbols: [symbol] }),
      loadAssetSignal(symbol, quote.price),
    ]);

    const constraints = body.constraints ? { ...DEFAULT_CONSTRAINTS, ...body.constraints } : DEFAULT_CONSTRAINTS;
    const hasAmountOverride = body.amount != null && Number.isFinite(body.amount) && body.amount > 0;
    const plan = hasAmountOverride
      ? computePositionSizingAtAmount(evaluation, { symbol, name, assetClass }, body.amount!, objective, ctx, signal)
      : computePositionSizing(evaluation, { symbol, name, assetClass }, objective, ctx, constraints, body.customTarget, signal);

    const cashAvailable = Math.round(
      evaluation.holdings.reduce((s, h) => s + (h.assetClass === "cash" ? h.valuation.valueBase : 0), 0),
    );
    const shortfall = fundingShortfall(plan.recommendedAmount, cashAvailable);

    // Reuse the exact same trade-recommendation engine the Decision Center uses to
    // find what to sell — never a new "what should I trim" heuristic. Only computed
    // when there's an actual shortfall to fund, so a well-funded buy never pays for it.
    const sellSuggestions: Array<{ holdingId: string; symbol: string | null; name: string; amount: number; rationale: string }> = [];
    if (shortfall > 0) {
      const recs = computeRecommendations(evaluation, ctx)
        .filter((r) => r.action === "REDUCE" || r.action === "SELL")
        .sort((a, b) => b.priority - a.priority);

      let remaining = shortfall;
      for (const r of recs) {
        if (remaining <= 0) break;
        if (r.change.kind !== "sell") continue;
        // Funding offers a DOLLAR AMOUNT of a holding, so it may only ever offer
        // holdings the ledger can sell in part. The Decision Center is right to
        // say "your home is 40% of the portfolio" — that trim recommendation is
        // real advice — but a manually-valued asset has no share ledger, so
        // "$40,000 of the home" is a trade that does not exist, and offering it
        // here put a specific dollar figure beside the asset's own name under
        // "no review needed". Filtered at the funding boundary rather than in
        // recommend.ts, so the advice is unchanged and only the automated
        // execution path is constrained.
        if (isIndivisibleHolding(r.change.holdingId)) continue;
        const amount = Math.min(r.amount, remaining);
        if (amount <= 0) continue;
        sellSuggestions.push({ holdingId: r.change.holdingId, symbol: r.symbol, name: r.subject, amount: Math.round(amount), rationale: r.rationale });
        remaining -= amount;
      }
    }

    return NextResponse.json({
      ...plan,
      cashAvailable,
      fundingShortfall: shortfall,
      fundingFullyCoveredByCash: shortfall === 0,
      sellSuggestions,
      sellSuggestionsCoverShortfall: sellSuggestions.reduce((s, x) => s + x.amount, 0) >= shortfall,
      why: buildPositionSizingWhy(plan),
      aiExplanation: buildAiExplanation(plan),
      summary: buildSummary(plan),
      headline: buildHeadline(plan),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build recommendation";
    console.error("[portfolio/buy/recommendation]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
