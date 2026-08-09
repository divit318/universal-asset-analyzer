/**
 * "Why do I own this?" — on-demand, per-holding explanation.
 *
 * Unlike the Portfolio Thesis (which regenerates automatically), this is
 * strictly user-triggered: a click per holding. Eager generation for every row would be pure spend, so
 * this must never be auto-fired for every row on page load — see
 * lib/platform/ARCHITECTURE notes on per-section AI generation being measured
 * and rejected. One click, one call, cached by (holding, portfolio) content
 * hash so re-opening the same holding doesn't re-generate.
 *
 * Reuses "portfolio-intelligence" (already declared as "portfolio brief + new-
 * position suggestions (JSON)") rather than a new task type — this is the same
 * kind of output, just scoped to one holding.
 */

import { runPrompt } from "@/lib/ai";
import { extractJsonObject } from "@/lib/json-extract";
import { getScannerCache, putScannerCache } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { PORTFOLIO_CLASS_LABEL } from "./model/types";
import type { Holding } from "./model/types";
import type { PortfolioEvaluation } from "./engines/simulate";
import type { Recommendation } from "./engines/recommend";
import { AI_NARRATIVE_UNAVAILABLE, AI_RECOVERY_HINT } from "../ai/availability";

export interface HoldingExplanation {
  explanation: string;
  /** 0-100. Grounded in this holding's own score confidence when one exists — never invented. */
  confidence: number;
  generatedAt: string;
  source: "ai" | "fallback";
}

function hashOf(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function cacheKeyFor(holding: Holding, evaluation: PortfolioEvaluation): string {
  // Round weight to the nearest whole percent, same reasoning as the Portfolio
  // Thesis cache key — a live quote nudging this holding's weight by 0.1pp
  // should not force a fresh AI call.
  const portfolioShape = evaluation.holdings
    .map((h) => `${h.assetClass}:${h.symbol ?? h.name}:${Math.round(h.weight)}`)
    .sort()
    .join("|");
  return `holding-explain:${holding.id}:${Math.round(holding.weight)}:${hashOf(portfolioShape)}`;
}

export function confidenceFor(holding: Holding): number {
  if (holding.score) return holding.score.confidence;
  // No class score exists for this asset class (e.g. cash, structured products
  // with no honest scoring basis) — fall back to data-quality: a live market
  // price backs a more confident explanation than a self-reported mark.
  return holding.valuation.mode === "market" && !holding.valuation.stale ? 70 : 40;
}

function activeRecommendationFor(holding: Holding, recommendations: Recommendation[]): Recommendation | null {
  return recommendations.find((r) => r.change.kind === "sell" && r.change.holdingId === holding.id)
    ?? recommendations.find((r) => r.change.kind === "buy" && r.symbol === holding.symbol)
    ?? null;
}

export function fallbackExplanation(holding: Holding, evaluation: PortfolioEvaluation, activeRec: Recommendation | null): string {
  const label = PORTFOLIO_CLASS_LABEL[holding.assetClass];
  const parts: string[] = [
    `${holding.symbol ?? holding.name} is ${holding.weight.toFixed(1)}% of the portfolio (${formatCurrency(holding.valuation.valueBase)}), classified as ${label.toLowerCase()}.`,
  ];
  if (holding.score) {
    parts.push(`It scores ${holding.score.score}/100 on ${label.toLowerCase()} metrics at ${holding.score.confidence}% confidence. ${holding.score.why.join(". ")}.`);
  } else {
    parts.push(`This asset class has no honest basis for a comparable score from available data.`);
  }
  if (holding.income) {
    parts.push(`It contributes ${formatCurrency(holding.income.annual)}/yr in income (${holding.income.yieldPct.toFixed(2)}% yield).`);
  }
  if (activeRec) {
    parts.push(`The decision engine currently recommends: ${activeRec.title.toLowerCase()} — ${activeRec.rationale}`);
  }
  parts.push(`${AI_NARRATIVE_UNAVAILABLE} ${AI_RECOVERY_HINT}`);
  return parts.join(" ");
}

function buildPrompt(holding: Holding, evaluation: PortfolioEvaluation, activeRec: Recommendation | null): string {
  const label = PORTFOLIO_CLASS_LABEL[holding.assetClass];
  const factorLines = Object.entries(holding.factors)
    .filter(([, v]) => v != null && Math.abs(v as number) > 0.01)
    .map(([k, v]) => `${k}: ${(v as number).toFixed(2)}`)
    .join(", ");

  return `You are a senior portfolio strategist explaining, to the investor who owns it, why a specific holding is in their portfolio. Be specific — reference the actual numbers below. Never give generic investment advice.

HOLDING
${holding.symbol ?? holding.name} (${label})
Weight: ${holding.weight.toFixed(1)}% of portfolio (${formatCurrency(holding.valuation.valueBase)})
Unrealized P&L: ${holding.unrealizedPct != null ? `${holding.unrealizedPct >= 0 ? "+" : ""}${holding.unrealizedPct.toFixed(1)}%` : "not measurable"}
Score: ${holding.score ? `${holding.score.score}/100 at ${holding.score.confidence}% confidence — ${holding.score.why.join("; ")}` : "no honest scoring basis for this asset class"}
Income: ${holding.income ? `${formatCurrency(holding.income.annual)}/yr (${holding.income.yieldPct.toFixed(2)}% yield)` : "none"}
Liquidity: ${holding.liquidity}
Macro factor exposures: ${factorLines || "negligible"}

PORTFOLIO CONTEXT
Total value: ${formatCurrency(evaluation.totalValue)}
Health: ${evaluation.health.total}/100
Top asset-class weight: ${evaluation.risk.topAssetClassWeight.toFixed(0)}%
${activeRec ? `The decision engine currently recommends acting on this holding: "${activeRec.title}" — ${activeRec.rationale}` : "The decision engine has no active recommendation to change this holding."}

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "explanation": "One paragraph (4-5 sentences) covering: its role in the portfolio, what it's expected to contribute (return source, income, or hedge), its risk/macro contribution, its diversification benefit or cost, and whether the investor should keep, trim, or exit it — if the decision engine has an active recommendation, be consistent with it rather than contradicting it"
}`;
}

export async function explainHolding(
  holding: Holding,
  evaluation: PortfolioEvaluation,
  recommendations: Recommendation[],
): Promise<HoldingExplanation> {
  const cacheKey = cacheKeyFor(holding, evaluation);
  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as HoldingExplanation;
    } catch {
      // corrupted cache entry — fall through and regenerate
    }
  }

  const activeRec = activeRecommendationFor(holding, recommendations);
  const confidence = confidenceFor(holding);

  let result: HoldingExplanation;
  try {
    const raw = await runPrompt("portfolio-intelligence", buildPrompt(holding, evaluation, activeRec), { json: true, maxTokens: 400 });
    const parsed = extractJsonObject(raw, { explanation: "" });
    result = parsed.explanation
      ? { explanation: parsed.explanation, confidence, generatedAt: new Date().toISOString(), source: "ai" }
      : { explanation: fallbackExplanation(holding, evaluation, activeRec), confidence, generatedAt: new Date().toISOString(), source: "fallback" };
  } catch {
    result = { explanation: fallbackExplanation(holding, evaluation, activeRec), confidence, generatedAt: new Date().toISOString(), source: "fallback" };
  }

  if (result.source === "ai") putScannerCache(cacheKey, JSON.stringify(result));
  return result;
}
