/**
 * Portfolio Thesis + Identity — the one-paragraph AI summary and the persistent
 * identity tags shown at the top of the Portfolio page.
 *
 * Regenerates automatically whenever the portfolio actually CHANGES — not on
 * every page load and not on every intraday price tick. The cache key is a
 * content hash of (asset class, symbol, weight rounded to the nearest whole
 * percent) for every holding, so adding, removing or meaningfully resizing a
 * position invalidates it, while today's quote wiggling the weight by 0.2pp
 * does not burn a redundant Ollama call. Uses the same `scanner_cache` table
 * every other cached AI output in this app uses (lib/timeline.ts,
 * lib/movement-explainer.ts, lib/ai-financial-insight.ts) — no new cache.
 *
 * Reuses the "portfolio-intelligence" task type verbatim: it is already
 * declared as "portfolio brief + new-position suggestions (JSON)", and a
 * thesis + identity tags is exactly that shape of output, just a different
 * consumer. No new task type, no new model policy.
 */

import { runPrompt } from "@/lib/ai";
import { extractJsonObject } from "@/lib/json-extract";
import { getScannerCache, putScannerCache } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { PORTFOLIO_CLASS_LABEL } from "./model/types";
import type { PortfolioEvaluation } from "./engines/simulate";
import { AI_NARRATIVE_UNAVAILABLE, AI_RECOVERY_HINT } from "../ai/availability";

export interface PortfolioThesis {
  thesis: string;
  identity: string[];
  generatedAt: string;
  /** Whether this came from the AI or the deterministic fallback (Ollama offline). */
  source: "ai" | "fallback";
}

/** Deterministic djb2 hash — a cache key, not a security primitive. */
function hashOf(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function contentHash(evaluation: PortfolioEvaluation): string {
  const parts = evaluation.holdings
    .map((h) => `${h.assetClass}:${h.symbol ?? h.name}:${Math.round(h.weight)}`)
    .sort();
  return `portfolio-thesis:${hashOf(parts.join("|"))}`;
}

/** Grounded, honest summary used when Ollama is unavailable or returns nothing usable. */
export function fallbackThesis(evaluation: PortfolioEvaluation): string {
  const { allocation, risk, health, totalValue } = evaluation;
  const top = allocation.byAssetClass.slices[0];
  const topLabel = top ? PORTFOLIO_CLASS_LABEL[top.key as keyof typeof PORTFOLIO_CLASS_LABEL] ?? top.label : "no single class";
  const concentrationNote = risk.topAssetClassWeight > 50
    ? `concentrated in ${topLabel.toLowerCase()} (${risk.topAssetClassWeight.toFixed(0)}% of value)`
    : `spread across ${allocation.byAssetClass.slices.length} asset classes with no single one dominating`;
  return `A ${formatCurrency(totalValue)} portfolio ${concentrationNote}. Health scores ${health.total}/100 (${health.grade}). ` +
    `${AI_NARRATIVE_UNAVAILABLE} ${AI_RECOVERY_HINT}`;
}

export function fallbackIdentity(evaluation: PortfolioEvaluation): string[] {
  const { risk, allocation } = evaluation;
  const tags: string[] = [];
  if (risk.topAssetClassWeight > 60) tags.push("Concentrated");
  else if (allocation.byAssetClass.slices.length >= 5) tags.push("Diversified");
  if (risk.beta != null && risk.beta > 1.1) tags.push("Aggressive Growth");
  else if (risk.beta != null && risk.beta < 0.8) tags.push("Defensive");
  const usPct = allocation.byGeography.slices.find((s) => /united states|usa|us/i.test(s.label))?.weight ?? 0;
  if (usPct > 80) tags.push("US-Centric");
  if (risk.illiquidPct > 15) tags.push("Illiquid-Heavy");
  return tags.length > 0 ? tags.slice(0, 5) : ["Balanced"];
}

function buildPrompt(evaluation: PortfolioEvaluation): string {
  const { holdings, allocation, risk, health, totalValue } = evaluation;
  const top = [...holdings].sort((a, b) => b.weight - a.weight).slice(0, 8);
  const holdingLines = top
    .map((h) => `${h.symbol ?? h.name} (${PORTFOLIO_CLASS_LABEL[h.assetClass]}): ${h.weight.toFixed(1)}%`)
    .join("\n");
  const classLines = allocation.byAssetClass.slices
    .map((s) => `${s.label}: ${s.weight.toFixed(1)}%`)
    .join(", ");

  return `You are a senior portfolio strategist writing a one-paragraph investment thesis and a short set of identity tags for a self-directed investor's portfolio. Be specific and reference actual holdings and numbers — never generic advice.

PORTFOLIO
Total value: ${formatCurrency(totalValue)}
Health: ${health.total}/100 (${health.grade})
Annualized volatility: ${risk.annualizedVolatility != null ? risk.annualizedVolatility.toFixed(1) + "%" : "not measurable from available data"}
Top asset-class weight: ${risk.topAssetClassWeight.toFixed(0)}%
Illiquid share: ${risk.illiquidPct.toFixed(1)}%

ASSET CLASSES
${classLines}

TOP HOLDINGS
${holdingLines}

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "thesis": "One paragraph (3-4 sentences): the portfolio's investment style and strategy, its real strengths, its real weaknesses/risks, and the dominant theme — name specific holdings and numbers from above",
  "identity": ["2-5 short tags describing this specific portfolio's character, e.g. 'Aggressive Growth', 'Concentrated', 'US-Centric' — must be justified by the numbers above, not generic"]
}`;
}

export async function buildPortfolioThesis(evaluation: PortfolioEvaluation): Promise<PortfolioThesis> {
  if (evaluation.holdings.length === 0) {
    return { thesis: "No holdings yet — add a position to generate a thesis.", identity: [], generatedAt: new Date().toISOString(), source: "fallback" };
  }

  const cacheKey = contentHash(evaluation);
  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as PortfolioThesis;
    } catch {
      // fall through and regenerate — a corrupted cache entry is not fatal
    }
  }

  let result: PortfolioThesis;
  try {
    const raw = await runPrompt("portfolio-intelligence", buildPrompt(evaluation), { json: true, maxTokens: 500 });
    const parsed = extractJsonObject(raw, { thesis: "", identity: [] as string[] });
    const identity = parsed.identity.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 5);
    result = parsed.thesis
      ? { thesis: parsed.thesis, identity: identity.length > 0 ? identity : fallbackIdentity(evaluation), generatedAt: new Date().toISOString(), source: "ai" }
      : { thesis: fallbackThesis(evaluation), identity: fallbackIdentity(evaluation), generatedAt: new Date().toISOString(), source: "fallback" };
  } catch {
    result = { thesis: fallbackThesis(evaluation), identity: fallbackIdentity(evaluation), generatedAt: new Date().toISOString(), source: "fallback" };
  }

  // Only cache a real AI result — caching the fallback would keep serving
  // "AI unavailable" for the TTL window even after Ollama comes back up.
  if (result.source === "ai") putScannerCache(cacheKey, JSON.stringify(result));
  return result;
}
