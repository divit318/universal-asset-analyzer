/**
 * POST /api/portfolio/new-positions
 *
 * AI-powered new stock recommendations for the portfolio.
 * Analyzes current portfolio gaps, sector exposure, alignment themes,
 * and portfolio objective, then asks the AI platform to suggest NEW stocks
 * (not currently held) that would improve the portfolio.
 */

import { NextResponse } from "next/server";
import { unavailableMessage } from "@/lib/ai/platform-health";
import { listWatchlist } from "@/lib/db";
import { runPrompt } from "@/lib/ai";
import { AllModelsFailedError } from "@/lib/ai/router";
import { extractJsonArray } from "@/lib/json-extract";
import { gatherWatchlistAlerts, type WatchlistPortfolioContext } from "@/lib/ai-watchlist";
// Objective/constraints/recommendation vocabulary moved into the IOS module
// when lib/portfolio-analytics.ts stopped being a portfolio engine; see the
// note above PortfolioObjective in lib/ios/types.ts.
import type {
  PortfolioObjective,
  PortfolioConstraints,
  NewPositionRecommendation,
} from "@/lib/ios/types";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import { GICS_SECTORS } from "@/lib/gics-sectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  objective?: PortfolioObjective;
  constraints?: Partial<PortfolioConstraints>;
}

async function getReport(): Promise<UniversalPortfolioReport | null> {
  try {
    const host = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${host}/api/portfolio/report`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as UniversalPortfolioReport;
  } catch {
    return null;
  }
}

/** GICS sectors the portfolio holds ~0% of — a plain coverage diff, not a fabricated ranking. */
function missingSectorsOf(report: UniversalPortfolioReport): string[] {
  const held = new Set(
    report.allocation.bySector.slices.filter((s) => s.weight >= 1).map((s) => s.label),
  );
  return GICS_SECTORS.filter((s) => !held.has(s));
}

/** Reuses the report's own (already-computed, already-tested) concentration findings — no separate threshold invented here. */
function overweightSectorsOf(report: UniversalPortfolioReport): string[] {
  return report.concentration.filter((c) => c.type === "sector").map((c) => c.label);
}

function objectivePromptClause(obj: PortfolioObjective): string {
  const map: Record<PortfolioObjective, string> = {
    maximize_growth:         "Focus on stocks with high revenue growth (>20% YoY), strong price momentum, and expanding margins. Prefer technology, healthcare innovation, and consumer discretionary.",
    reduce_risk:             "Focus on low-beta (<0.8), defensive stocks with stable earnings, strong balance sheets, and low correlation to the existing portfolio.",
    improve_diversification: "Focus on sectors and factors NOT currently represented in the portfolio. Prioritize geographic diversity, different business models, and uncorrelated assets.",
    increase_income:         "Focus on stocks with dividend yield >2.5%, stable payout ratios, and dividend growth history. Prefer utilities, REITs, consumer staples, and financial sectors.",
    beat_benchmark:          "Focus on high-conviction alpha opportunities: stocks with analyst upgrades, earnings momentum, or sectors expected to outperform SPY in the next 6-12 months.",
    preserve_capital:        "Focus on defensive quality companies with fortress balance sheets, low debt, consistent cash flow, and low historical volatility. Avoid speculative names.",
    ai_optimized:            "Select the best combination of growth, risk management, and diversification based on the current portfolio's gaps and alignment score. Balance upside with downside protection.",
  };
  return map[obj] ?? map.ai_optimized;
}

function buildRecommendationPrompt(
  report: UniversalPortfolioReport,
  objective: PortfolioObjective,
  constraints: Partial<PortfolioConstraints>,
  watchlistSymbols: string[],
  autoQualifiedSymbols: string[] = [],
): string {
  const positions = report.holdings
    .filter((h) => h.symbol)
    .map((h) => `${h.symbol} (${h.attributes.sector ?? "Unknown"}, ${h.weight.toFixed(1)}%)`)
    .join(", ");
  const sectors = report.allocation.bySector.slices.map((s) => `${s.label}: ${s.weight.toFixed(1)}%`).join(", ");
  const missingExposures = missingSectorsOf(report).join(", ") || "none identified";
  const overweight = overweightSectorsOf(report).join(", ") || "none";
  const alignmentLine =
    report.alignment.score == null
      ? "not scorable"
      : `${report.alignment.score}/100 (${report.alignment.label})`;
  const alignmentThemes = report.alignment.themes
    .map((t) => `${t.label}: ${t.score ?? "n/a"} — ${t.finding}`)
    .join("; ");
  const watchlistNote = watchlistSymbols.length > 0
    ? `The user's watchlist includes: ${watchlistSymbols.join(", ")}. Prefer recommending watchlist stocks when they fit the objective.`
    : "";
  // Watchlist Intelligence auto-promotion: symbols that already crossed the
  // "new opportunity" threshold (composite >= 70, sector gap or strong fundamentals)
  // — a stronger signal than the general watchlist-preference note above.
  const autoQualifiedNote = autoQualifiedSymbols.length > 0
    ? `AUTO-QUALIFIED from Watchlist Intelligence (composite score >= 70, evaluated as a strong new-opportunity candidate): ${autoQualifiedSymbols.join(", ")}. Strongly prefer including these if they fit the objective and constraints.`
    : "";
  const constraintNote = [
    constraints.maxPositionPct ? `Max position size: ${constraints.maxPositionPct}%` : "",
    constraints.maxSectorPct ? `Max sector exposure: ${constraints.maxSectorPct}%` : "",
    constraints.excludedSymbols?.length ? `Excluded symbols (never recommend): ${constraints.excludedSymbols.join(", ")}` : "",
    constraints.requireDividend ? "Only recommend dividend-paying stocks" : "",
    constraints.marketCapFilter && constraints.marketCapFilter !== "any" ? `Market cap filter: ${constraints.marketCapFilter}-cap only` : "",
  ].filter(Boolean).join("; ") || "none";

  return `You are an institutional portfolio manager. Recommend exactly 5 NEW stocks to ADD to this portfolio.

CURRENT PORTFOLIO:
- Positions: ${positions || "none"}
- Sector allocation: ${sectors || "none"}
- Portfolio alignment: ${alignmentLine}
- Alignment themes: ${alignmentThemes}
- Missing exposures: ${missingExposures}
- Overweight sectors: ${overweight}
- Portfolio value: $${Math.round(report.totalValue).toLocaleString()}

INVESTMENT OBJECTIVE: ${objective.replace(/_/g, " ").toUpperCase()}
Strategy: ${objectivePromptClause(objective)}

USER CONSTRAINTS: ${constraintNote}

${watchlistNote}
${autoQualifiedNote}

RULES:
1. Only recommend stocks NOT already in the portfolio above
2. Each recommendation must address a specific portfolio gap or objective
3. Each symbol must be a real, liquid US-listed stock (NYSE/NASDAQ)
4. Diversify across sectors — do not recommend 2 stocks from the same sector unless strongly justified
5. Be specific about WHY each stock improves this particular portfolio

Respond with ONLY a JSON array (no markdown, no explanation outside JSON):
[
  {
    "symbol": "TICKER",
    "name": "Full Company Name",
    "sector": "Technology",
    "reason": "1-2 sentence explanation of why this stock fits THIS portfolio and objective",
    "weaknessAddressed": "Specific portfolio gap or weakness this stock fixes",
    "suggestedAllocationPct": 5,
    "confidenceScore": 75,
    "expectedImpact": {
      "diversification": "improves",
      "risk": "reduces",
      "growthPotential": "high",
      "incomePotential": "low"
    },
    "breakdown": {
      "portfolioFitScore": 80,
      "fundamentalScore": 70,
      "technicalScore": 65,
      "valuationScore": 72,
      "momentumScore": 68
    },
    "supportingFactors": ["factor 1", "factor 2", "factor 3"]
  }
]`;
}

function sanitizeRecommendation(item: unknown): NewPositionRecommendation | null {
  if (item === null || typeof item !== "object") return null;
  const r = item as Partial<NewPositionRecommendation & { fromWatchlist?: boolean }>;
  if (!r.symbol || !r.name || !r.reason) return null;
  return {
    symbol: String(r.symbol ?? "").toUpperCase(),
    name: String(r.name ?? ""),
    currentPrice: null,
    marketCap: null,
    sector: String(r.sector ?? "Unknown"),
    reason: String(r.reason ?? ""),
    weaknessAddressed: String(r.weaknessAddressed ?? ""),
    expectedImpact: {
      diversification: (["improves", "neutral", "reduces"].includes(String(r.expectedImpact?.diversification ?? "")) ? r.expectedImpact?.diversification : "neutral") as "improves" | "neutral" | "reduces",
      risk: (["reduces", "neutral", "increases"].includes(String(r.expectedImpact?.risk ?? "")) ? r.expectedImpact?.risk : "neutral") as "reduces" | "neutral" | "increases",
      growthPotential: (["high", "medium", "low"].includes(String(r.expectedImpact?.growthPotential ?? "")) ? r.expectedImpact?.growthPotential : "medium") as "high" | "medium" | "low",
      incomePotential: (["high", "medium", "low"].includes(String(r.expectedImpact?.incomePotential ?? "")) ? r.expectedImpact?.incomePotential : "low") as "high" | "medium" | "low",
    },
    suggestedAllocationPct: Math.min(25, Math.max(1, Number(r.suggestedAllocationPct ?? 5))),
    suggestedDollarAmount: 0, // computed below based on portfolio value
    confidenceScore: Math.min(100, Math.max(0, Number(r.confidenceScore ?? 65))),
    breakdown: {
      portfolioFitScore: Math.min(100, Math.max(0, Number(r.breakdown?.portfolioFitScore ?? 65))),
      fundamentalScore:  Math.min(100, Math.max(0, Number(r.breakdown?.fundamentalScore  ?? 65))),
      technicalScore:    Math.min(100, Math.max(0, Number(r.breakdown?.technicalScore    ?? 60))),
      valuationScore:    Math.min(100, Math.max(0, Number(r.breakdown?.valuationScore    ?? 60))),
      momentumScore:     Math.min(100, Math.max(0, Number(r.breakdown?.momentumScore     ?? 60))),
    },
    supportingFactors: Array.isArray(r.supportingFactors) ? r.supportingFactors.slice(0, 4).map(String) : [],
    fromWatchlist: r.fromWatchlist ?? false,
    autoQualified: false, // recomputed accurately below once autoQualifiedSymbols is known
  };
}

function parseRecommendations(raw: string): NewPositionRecommendation[] | null {
  const recommendations = extractJsonArray(raw, sanitizeRecommendation).slice(0, 6);
  return recommendations.length > 0 ? recommendations : null;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try { body = await request.json(); } catch { body = {}; }

  const objective: PortfolioObjective   = (body.objective as PortfolioObjective) ?? "ai_optimized";
  const constraints: Partial<PortfolioConstraints> = body.constraints ?? {};

  const report = await getReport();
  if (!report || report.holdingCount === 0) {
    return NextResponse.json({ error: "No portfolio data available" }, { status: 404 });
  }

  const watchlist = listWatchlist();
  const currentSymbols = new Set(report.holdings.map((h) => h.symbol).filter((s): s is string => !!s));
  const eligibleWatchlist = watchlist.filter((w) => !currentSymbols.has(w.symbol));
  const watchlistSymbols = eligibleWatchlist.map((w) => w.symbol);

  // Watchlist Intelligence auto-promotion: evaluate eligible watchlist items
  // (capped to keep this route fast) for "new opportunity" alerts and surface
  // qualifying symbols to the AI as pre-vetted candidates.
  const watchlistContext: WatchlistPortfolioContext = {
    objective,
    holdingSymbols: [...currentSymbols],
    sectorWeights: report.allocation.bySector.slices.map((s) => ({ sector: s.label, weight: s.weight })),
    missingSectors: missingSectorsOf(report),
    overweightSectors: overweightSectorsOf(report),
  };
  const autoQualifiedSymbols = (
    await gatherWatchlistAlerts(watchlistContext, { items: eligibleWatchlist })
  )
    .filter((a) => a.type === "new_opportunity")
    .map((a) => a.symbol);

  const prompt = buildRecommendationPrompt(report, objective, constraints, watchlistSymbols, autoQualifiedSymbols);

  let responseText = "";
  try {
    // Generating 5 structured recommendations is a heavy prompt for a local
    // model — 90s was too tight (observed 92-94s for comparable calls
    // elsewhere in this route family) and caused spurious 502s.
    responseText = await runPrompt("portfolio-intelligence", prompt, {
      json: true,
      timeoutMs: 180_000,
    });
  } catch (e) {
    if (e instanceof AllModelsFailedError) {
      return NextResponse.json(
        { error: unavailableMessage("AI recommendations"), code: "ai_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed" }, { status: 502 });
  }

  const parsed = parseRecommendations(responseText);
  if (!parsed || parsed.length === 0) {
    return NextResponse.json({ error: "Could not parse AI recommendations. Try again." }, { status: 502 });
  }

  // Compute dollar amounts + mark watchlist stocks
  const watchlistSet = new Set(watchlistSymbols);
  const autoQualifiedSet = new Set(autoQualifiedSymbols);
  const recommendations = parsed.map((r) => ({
    ...r,
    suggestedDollarAmount: Math.round((r.suggestedAllocationPct / 100) * report.totalValue),
    fromWatchlist: watchlistSet.has(r.symbol),
    autoQualified: autoQualifiedSet.has(r.symbol),
  }));

  return NextResponse.json({ recommendations, objective, generatedAt: new Date().toISOString() });
}
