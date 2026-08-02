/**
 * AI watchlist digest.
 *
 * Given a list of symbols with their live quotes + a quick fundamental fetch,
 * produces a ranked digest: which to watch, which to research deeper, any
 * concentration risks, and a portfolio-level summary.
 */

import { runAnalysis } from "./ai/analysis";
import {
  WatchlistDigestSchema,
  WatchlistDigestWireSchema,
  WATCHLIST_DIGEST_SCHEMA_VERSION,
} from "./ai/schemas/watchlist-digest";
import { getQuote } from "./yahoo";
import { getFundamentals } from "./fundamentals";
import { computeScore, computeMomentum, assessRisks } from "./scoring";
import { getHistory } from "./yahoo";
import { listWatchlist } from "./db";
import type { Quote, WatchlistItem, WatchlistAlert } from "./types";
import { formatCurrency, formatPercent, formatMarketCap } from "./format";
import { getLatestSectorRotation, findSectorRotationEntry } from "./sector-rotation";

export interface WatchlistPortfolioContext {
  objective: string;
  holdingSymbols: string[];
  sectorWeights: Array<{ sector: string; weight: number }>;
  missingSectors: string[];
  overweightSectors: string[];
}

export interface WatchlistStockSummary {
  symbol: string;
  name: string;
  quote: Quote | null;
  fundamentalScore: number | null;
  recommendation: string | null;
  topRisk: string | null;
  analystUpside: number | null;
  sector: string | null;
  momentumTrend: "up" | "down" | "flat" | null;
}

export interface WatchlistDigest {
  model: string;
  summary: string;
  actionItems: string[];
  concentrationRisks: string[];
  topPicks: string[];
  topConcerns: string[];
  stockSummaries: WatchlistStockSummary[];
  /** Structured, deterministic per-asset alerts — see computeWatchlistAlerts(). */
  alerts: WatchlistAlert[];
  generatedAt: string;
}

/** Fetch lightweight data for one symbol — quote + fast fundamental score. */
export async function summariseOne(item: WatchlistItem): Promise<WatchlistStockSummary> {
  try {
    const [quote, fundamentalParts, history] = await Promise.allSettled([
      getQuote(item.symbol),
      getFundamentals(item.symbol),
      getHistory(item.symbol, 420),
    ]);

    const q = quote.status === "fulfilled" ? quote.value : null;
    const fp = fundamentalParts.status === "fulfilled" ? fundamentalParts.value : null;
    const hist = history.status === "fulfilled" ? history.value : [];
    const momentum = computeMomentum(hist);
    const score = fp
      ? computeScore(fp.snapshot, null, fp.analyst, momentum)
      : null;
    const risks = fp && q
      ? assessRisks(fp.snapshot, null, fp.analyst, fp.insider)
      : [];

    return {
      symbol: item.symbol,
      name: item.name,
      quote: q,
      fundamentalScore: score?.composite ?? null,
      recommendation: score?.recommendation ?? null,
      topRisk: risks.find((r) => r.level === "high")?.category
        ?? risks.find((r) => r.level === "medium")?.category
        ?? null,
      analystUpside: fp?.analyst.upsidePercent ?? null,
      sector: fp?.snapshot.sector ?? null,
      momentumTrend: momentum?.trend ?? null,
    };
  } catch {
    return {
      symbol: item.symbol,
      name: item.name,
      quote: null,
      fundamentalScore: null,
      recommendation: null,
      topRisk: null,
      analystUpside: null,
      sector: null,
      momentumTrend: null,
    };
  }
}

/** Exported for the parity harness (scripts/ai-parity.ts) — pure, no I/O. */
export function buildDigestPrompt(summaries: WatchlistStockSummary[], portfolio?: WatchlistPortfolioContext): string {
  const lines = summaries.map((s) => {
    const price = s.quote ? formatCurrency(s.quote.price, s.quote.currency) : "n/a";
    const chg = s.quote ? formatPercent(s.quote.changePercent) : "";
    const mcap = s.quote ? formatMarketCap(s.quote.marketCap) : "n/a";
    const upside = s.analystUpside != null
      ? `${s.analystUpside >= 0 ? "+" : ""}${s.analystUpside.toFixed(0)}% analyst upside`
      : "no analyst target";
    const inPortfolio = portfolio?.holdingSymbols.includes(s.symbol) ? " [IN PORTFOLIO]" : "";
    return `- ${s.symbol}${inPortfolio} (${s.name}): price ${price} ${chg}, mkt cap ${mcap}, composite score ${s.fundamentalScore ?? "n/a"}/100, recommendation ${s.recommendation ?? "n/a"}, ${upside}, top risk: ${s.topRisk ?? "none flagged"}`;
  });

  const portfolioSection = portfolio
    ? `\nPORTFOLIO CONTEXT:
- Investment objective: ${portfolio.objective.replace(/_/g, " ")}
- Current holdings: ${portfolio.holdingSymbols.length} positions (${portfolio.holdingSymbols.slice(0, 8).join(", ")}${portfolio.holdingSymbols.length > 8 ? "..." : ""})
- Top sector weights: ${portfolio.sectorWeights.slice(0, 4).map((s) => `${s.sector}: ${s.weight.toFixed(1)}%`).join(", ")}
${portfolio.missingSectors.length > 0 ? `- Missing sectors (zero exposure): ${portfolio.missingSectors.join(", ")}` : ""}
${portfolio.overweightSectors.length > 0 ? `- Overweight sectors: ${portfolio.overweightSectors.join(", ")}` : ""}`
    : "";

  const portfolioRules = portfolio
    ? `\n- PORTFOLIO AWARENESS: Items marked [IN PORTFOLIO] are already held — flag if they should be trimmed or added to. Identify watchlist stocks that fill missing sectors (${portfolio.missingSectors.slice(0, 3).join(", ") || "none"}).
- Concentration warnings MUST reference the actual portfolio sector weights above, not just the watchlist.`
    : "";

  return `You are a portfolio strategist reviewing a personal watchlist. Using ONLY the data below, produce a concise digest.
${portfolioSection}
WATCHLIST (${summaries.length} stocks):
${lines.join("\n")}

Produce a JSON response:
{
  "summary": "2-3 sentence overall portfolio health summary — be specific about the mix of buy/hold/sell signals and overall risk profile",
  "actionItems": ["Specific actionable item for 1-2 highest-priority stocks", "..."],
  "concentrationRisks": ["Any obvious sector/theme concentration risks visible from this list AND the portfolio"],
  "topPicks": ["Top 2-3 symbols to research further with one-line reason each, e.g. 'AAPL: strong buy signal, +18% analyst upside'"],
  "topConcerns": ["Top 2-3 stocks with concerning signals and why, e.g. 'XYZ: SELL signal, high valuation risk'"]
}

Rules: cite symbol names and specific numbers. If fewer than 2 stocks, simplify. Keep each item under 15 words.${portfolioRules}`;
}

/** Run the AI watchlist digest across all items. Fetches data in parallel. */
export async function generateWatchlistDigest(
  items: WatchlistItem[],
  portfolio?: WatchlistPortfolioContext,
): Promise<WatchlistDigest> {
  if (items.length === 0) {
    return {
      model: "n/a",
      summary: "Watchlist is empty.",
      actionItems: [],
      concentrationRisks: [],
      topPicks: [],
      topConcerns: [],
      stockSummaries: [],
      alerts: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // Fetch all summaries in parallel (capped at 10 to avoid hammering Yahoo).
  const capped = items.slice(0, 10);
  const summaries = await Promise.all(capped.map(summariseOne));

  const prompt = buildDigestPrompt(summaries, portfolio);

  const defaults = {
    summary: "AI digest unavailable. Run `ollama serve` and pull a model.",
    actionItems: [] as string[],
    concentrationRisks: [] as string[],
    topPicks: [] as string[],
    topConcerns: [] as string[],
  };

  let model = "unavailable";
  let parsed = defaults;

  try {
    // Migrated to the analysis seam (tranche 2). The tolerant parse schema
    // reproduces extractJsonObject's defaults behavior; no caching (the panel
    // is an explicit Generate/Regenerate button, and summaries change with
    // live quotes anyway). No confidence field exists in this output — see
    // the Blocker-1 audit in ai-migration/06.
    const result = await runAnalysis({
      taskType: "watchlist-intelligence",
      subjectKey: `watchlist:${capped.map((i) => i.symbol).sort().join(",")}`,
      prompt,
      schema: WatchlistDigestSchema,
      wireSchema: WatchlistDigestWireSchema,
      schemaVersion: WATCHLIST_DIGEST_SCHEMA_VERSION,
    });
    model = result.meta.model ?? result.provider;
    parsed = {
      summary: result.data.summary || defaults.summary,
      actionItems: result.data.actionItems,
      concentrationRisks: result.data.concentrationRisks,
      topPicks: result.data.topPicks,
      topConcerns: result.data.topConcerns,
    };
  } catch {
    // parsed stays at defaults
  }

  return {
    model,
    ...parsed,
    stockSummaries: summaries,
    alerts: computeWatchlistAlerts(summaries, portfolio),
    generatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Watchlist Intelligence — structured, deterministic alerts                  */
/* -------------------------------------------------------------------------- */

/**
 * Proactive, structured per-asset alerts — mirrors lib/portfolio-analytics.ts's
 * computeAlerts() pattern (deterministic, severity-sorted) but for watchlist
 * items. Complements generateWatchlistDigest()'s free-form narrative digest
 * with itemized, actionable alerts a UI can render as a list (SmartAlerts-style).
 */
export function computeWatchlistAlerts(
  summaries: WatchlistStockSummary[],
  portfolio?: WatchlistPortfolioContext,
): WatchlistAlert[] {
  const alerts: WatchlistAlert[] = [];
  const rotation = getLatestSectorRotation();
  const holdingSet = new Set(portfolio?.holdingSymbols ?? []);
  const missingSectors = new Set(portfolio?.missingSectors ?? []);

  for (const s of summaries) {
    const inPortfolio = holdingSet.has(s.symbol);

    // New opportunity: strong score, not already held, ideally fills a gap
    if (!inPortfolio && s.fundamentalScore != null && s.fundamentalScore >= 70) {
      const fillsGap = s.sector != null && missingSectors.has(s.sector);
      alerts.push({
        type: "new_opportunity",
        severity: fillsGap ? "high" : "medium",
        title: `${s.symbol} scoring ${s.fundamentalScore}/100${fillsGap ? ` — fills missing ${s.sector} exposure` : ""}`,
        description: `${s.recommendation ?? "Strong"} signal on ${s.name}.${s.analystUpside != null ? ` ${s.analystUpside >= 0 ? "+" : ""}${s.analystUpside.toFixed(0)}% analyst upside.` : ""}`,
        action: fillsGap
          ? `Consider adding ${s.symbol} — closes a sector gap in your portfolio`
          : `Research ${s.symbol} for a potential new position`,
        symbol: s.symbol,
      });
    }

    // Deteriorating: weak score + negative momentum, especially if already held
    if (s.fundamentalScore != null && s.fundamentalScore < 40 && s.momentumTrend === "down") {
      alerts.push({
        type: "deteriorating",
        severity: inPortfolio ? "high" : "medium",
        title: `${s.symbol} deteriorating — score ${s.fundamentalScore}/100, negative momentum`,
        description: `${s.topRisk ? `Top risk: ${s.topRisk}. ` : ""}Below key moving averages.${inPortfolio ? " Currently held." : ""}`,
        action: inPortfolio ? `Review ${s.symbol} position — consider reducing` : `Deprioritize ${s.symbol} on the watchlist`,
        symbol: s.symbol,
      });
    }

    // Breakout: strong positive momentum + meaningful move today
    if (s.momentumTrend === "up" && s.quote?.changePercent != null && s.quote.changePercent > 5) {
      alerts.push({
        type: "breakout",
        severity: "medium",
        title: `${s.symbol} breaking out — ${s.quote.changePercent >= 0 ? "+" : ""}${s.quote.changePercent.toFixed(1)}% today`,
        description: `Positive momentum confirmed by today's move. Above key moving averages.`,
        action: `Check "Why did ${s.symbol} move?" on the Research page for the driving catalyst`,
        symbol: s.symbol,
      });
    }

    // Sector leadership: watchlist item's sector is strengthening/leading in the Sector Rotation Engine
    const rotationEntry = findSectorRotationEntry(rotation, s.sector);
    if (rotationEntry && (rotationEntry.classification === "leading" || rotationEntry.classification === "strengthening") && rotationEntry.rankChange != null && rotationEntry.rankChange >= 2) {
      alerts.push({
        type: "sector_leadership",
        severity: "low",
        title: `${s.sector} sector gaining leadership — ${s.symbol} may benefit`,
        description: `${s.sector} moved up ${rotationEntry.rankChange} ranks to #${rotationEntry.rank}/11 by relative strength.`,
        action: `Consider prioritizing ${s.symbol} research given sector tailwind`,
        symbol: s.symbol,
      });
    }

    // Valuation: significant undervaluation per analyst consensus
    if (s.analystUpside != null && s.analystUpside >= 20) {
      alerts.push({
        type: "valuation",
        severity: "low",
        title: `${s.symbol} trading ${s.analystUpside.toFixed(0)}% below analyst targets`,
        description: `Analyst consensus sees meaningful upside from current price.`,
        action: `Verify the thesis still holds before acting on analyst upside alone`,
        symbol: s.symbol,
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 8);
}

/**
 * Canonical "gather watchlist alerts" orchestration — fetch watchlist items,
 * summarise each (quote + fast fundamentals), compute structured alerts.
 * This exact list→summarise→compute sequence was previously duplicated
 * across /api/portfolio/audit, /api/ai/portfolio-brief, /api/dashboard, and
 * /api/portfolio/new-positions; all four now call this instead.
 *
 * Best-effort: any failure (Yahoo, fundamentals) degrades to an empty array
 * rather than throwing, so callers never need their own try/catch for this.
 */
export async function gatherWatchlistAlerts(
  portfolioContext?: WatchlistPortfolioContext,
  opts: { sampleSize?: number; alertLimit?: number; items?: WatchlistItem[] } = {},
): Promise<WatchlistAlert[]> {
  const { sampleSize = 10, alertLimit, items: providedItems } = opts;
  try {
    // `items` lets a caller pass a pre-filtered list (e.g. new-positions/route.ts
    // excludes already-held symbols before sampling) instead of the full watchlist.
    const items = (providedItems ?? listWatchlist()).slice(0, sampleSize);
    if (items.length === 0) return [];
    const summaries = await Promise.all(items.map((w) => summariseOne(w)));
    const alerts = computeWatchlistAlerts(summaries, portfolioContext);
    return alertLimit != null ? alerts.slice(0, alertLimit) : alerts;
  } catch {
    return [];
  }
}
