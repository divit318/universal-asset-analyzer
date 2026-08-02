/**
 * Financial Interpretation — "what changed and why it matters" insight for
 * the Financials/Ownership charts, generalizing the pattern India's
 * AiSectionInsight already established (button-triggered narrative over
 * already-computed data) to a US-equivalent backed by the platform's own
 * scoring engine instead of screener.in fields.
 *
 * Follows the codebase's standing convention: one small prompt builder per
 * feature (see ai-watchlist.ts, ai-compare.ts), runPrompt() for inference,
 * cached via scanner_cache to avoid re-generating on every tab open.
 */

import { runAnalysis } from "./ai/analysis";
import { TextAnalysisSchema, TextWireSchema, TEXT_SCHEMA_VERSION } from "./ai/schemas/text";
import { getScannerCache, putScannerCache } from "./db";
import type { FinancialStatements, FundamentalsSnapshot, ScoreResult } from "./types";
import { aiUnavailableMessage } from "./ai/availability";

export interface FinancialInsightInput {
  symbol: string;
  snapshot: FundamentalsSnapshot;
  statements: FinancialStatements | null;
  score: ScoreResult;
}

export interface FinancialInsightResult {
  insight: string;
  model: string;
}

const CACHE_PREFIX = "financial-insight";
// Cached via scanner_cache's shared, fixed TTL (15 min, see lib/db.ts
// SCANNER_CACHE_TTL) — no per-key TTL override is supported.

function statementsSummary(st: FinancialStatements | null): string {
  if (!st || st.revenue.length < 2) return "No multi-year statement history available.";
  const rev = st.revenue;
  const fcf = st.freeCashFlow;
  const om = st.operatingMargin;
  const revChange = ((rev.at(-1)!.value - rev.at(-2)!.value) / Math.abs(rev.at(-2)!.value)) * 100;
  const lines = [
    `Revenue: ${rev.at(-2)!.value.toLocaleString()} → ${rev.at(-1)!.value.toLocaleString()} (${revChange >= 0 ? "+" : ""}${revChange.toFixed(1)}%), FY${rev.at(-2)!.fy}→FY${rev.at(-1)!.fy}`,
  ];
  if (fcf.length >= 2) {
    lines.push(`Free cash flow: ${fcf.at(-2)!.value.toLocaleString()} → ${fcf.at(-1)!.value.toLocaleString()}`);
  }
  if (om.length >= 2) {
    const deltaPp = (om.at(-1)!.value - om.at(-2)!.value) * 100;
    lines.push(`Operating margin: ${(om.at(-2)!.value * 100).toFixed(1)}% → ${(om.at(-1)!.value * 100).toFixed(1)}% (${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(1)}pp)`);
  }
  if (st.revenueCagr != null) lines.push(`Revenue CAGR: ${(st.revenueCagr * 100).toFixed(1)}%`);
  if (st.fcfCagr != null) lines.push(`FCF CAGR: ${(st.fcfCagr * 100).toFixed(1)}%`);
  return lines.join("\n");
}

export function buildFinancialInsightPrompt(input: FinancialInsightInput): string {
  const { symbol, snapshot, statements, score } = input;
  const growthBucket = score.buckets.find((b) => b.name === "Growth");
  const capAllocBucket = score.buckets.find((b) => b.name === "Capital Allocation");

  return `You are an equity analyst writing a 2-3 sentence note on what changed in ${symbol}'s financials and why it matters to an investor. Use ONLY the data below — do not invent figures.

FINANCIAL STATEMENT TREND:
${statementsSummary(statements)}

CURRENT SNAPSHOT:
- Revenue growth YoY: ${snapshot.revenueGrowth != null ? `${(snapshot.revenueGrowth * 100).toFixed(1)}%` : "n/a"}
- Earnings growth YoY: ${snapshot.earningsGrowth != null ? `${(snapshot.earningsGrowth * 100).toFixed(1)}%` : "n/a"}
- Operating margin: ${snapshot.operatingMargins != null ? `${(snapshot.operatingMargins * 100).toFixed(1)}%` : "n/a"}
- Free cash flow: ${snapshot.freeCashflow != null ? snapshot.freeCashflow.toLocaleString() : "n/a"}

SCORING CONTEXT:
- Growth bucket: ${growthBucket ? `${growthBucket.points}/${growthBucket.max}` : "n/a"}
- Capital Allocation bucket: ${capAllocBucket ? `${capAllocBucket.points}/${capAllocBucket.max}` : "n/a"}

Be specific and cite the numbers above. Do not restate generic advice. Return plain text, no markdown, no preamble.`;
}

/** Generate (or return the cached) financial interpretation for a symbol. */
export async function generateFinancialInsight(input: FinancialInsightInput): Promise<FinancialInsightResult> {
  const cacheKey = `${CACHE_PREFIX}:${input.symbol}`;
  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FinancialInsightResult;
    } catch {
      // fall through and regenerate
    }
  }

  let model = "unavailable";
  let insight: string;
  try {
    // Migrated to the analysis seam (ai-migration/03 §9, tranche 2): text
    // mode keeps the Ollama prompt/behavior identical (no json flag); the
    // ai_result cache is content-keyed on the dossier, while the outer
    // symbol-keyed 15-minute short-circuit above is unchanged.
    const result = await runAnalysis(
      {
        taskType: "quick-summary",
        subjectKey: `insight:${input.symbol}`,
        prompt: buildFinancialInsightPrompt(input),
        schema: TextAnalysisSchema,
        wireSchema: TextWireSchema,
        schemaVersion: TEXT_SCHEMA_VERSION,
        output: "text",
      },
      { maxAgeMs: 15 * 60 * 1000 },
    );
    model = result.meta.model ?? result.provider;
    insight = result.data.text;
  } catch {
    insight = aiUnavailableMessage("financial insights");
  }

  const result: FinancialInsightResult = { insight, model };
  putScannerCache(cacheKey, JSON.stringify(result));
  return result;
}
