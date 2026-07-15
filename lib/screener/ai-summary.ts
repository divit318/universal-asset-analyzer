/**
 * The AI explanation layer: what the *ranking as a whole* is telling you.
 *
 * Deliberately scoped above the per-row explanation. lib/screener/explain.ts
 * already says why each individual name passed — deterministically, for free,
 * offline, and without any risk of inventing a number. What a language model
 * adds is the part that genuinely needs judgement: is the top of this screen
 * one coherent idea or seven unrelated ones? Are the leaders all the same bet?
 * Is the screen quietly selecting for a risk the user didn't ask for?
 *
 * The prompt is built from the Asset Registry, so it's automatically framed for
 * the class being screened (`aiPrompt.role` / `aiPrompt.focus`) — an FX screen
 * gets an FX strategist, and one who has been told the rate table is static.
 *
 * The model is only ever shown values that were actually computed, and is told
 * explicitly which metrics have no data behind them for this class, so it says
 * "no on-chain data is available" instead of confidently inventing a TVL.
 */

import { runPromptWithMeta } from "../ai";
import { getAssetClass, getMetric, unavailableMetrics } from "../assets/registry";
import type { AssetClassId } from "../assets/types";
import { formatMetricValue } from "./format";
import type { RankedCandidate } from "./types";

/** How many of the top results to describe to the model. Enough to see a pattern, few enough to stay in context. */
const SAMPLE = 10;

function describeRow(assetClass: AssetClassId, row: RankedCandidate): string {
  const def = getAssetClass(assetClass);

  // Only the class's own result columns — i.e. the metrics that matter for this
  // asset class, not every metric we happen to hold.
  const parts = def.columns
    .filter((c) => c.key !== "rankScore")
    .map((c) => {
      const metric = getMetric(assetClass, c.key);
      if (!metric) return null;
      const value = metric.options
        ? row.attributes[c.key]
        : formatMetricValue(metric, row.metrics[c.key] ?? null);
      if (value == null || value === "—") return null;
      return `${c.label}: ${value}`;
    })
    .filter((p): p is string => p != null);

  const warnings = row.match.warnings.length ? ` | flags: ${row.match.warnings.join("; ")}` : "";

  return `${row.rank}. ${row.symbol} (${row.name}) — score ${row.rankScore}/100, confidence ${row.confidence}% | ${parts.join(", ")}${warnings}`;
}

export interface RankingSummary {
  summary: string;
  model: string;
}

export async function summarizeRanking(
  assetClass: AssetClassId,
  rows: RankedCandidate[],
  templateName: string | null,
  activeFilterLabels: string[],
): Promise<RankingSummary> {
  const def = getAssetClass(assetClass);
  const sample = rows.slice(0, SAMPLE);

  if (sample.length === 0) {
    return {
      summary: "No assets matched this screen, so there's nothing to rank or explain. Loosen a filter and run it again.",
      model: "none",
    };
  }

  const gaps = unavailableMetrics(assetClass).map((m) => m.label);

  const prompt = `You are ${def.aiPrompt.role} reviewing the output of a ${def.label.toLowerCase()} screen.

${templateName ? `Template: ${templateName}` : "Custom screen (no template)."}
${activeFilterLabels.length ? `Active filters: ${activeFilterLabels.join("; ")}` : "No filters — this is the full ranked universe."}

Results were ranked by percentile against the whole ${def.label.toLowerCase()} universe (${rows.length} matched). Top ${sample.length}:

${sample.map((r) => describeRow(assetClass, r)).join("\n")}

Focus your read on: ${def.aiPrompt.focus}.

IMPORTANT — data the screen does NOT have, and that you must not speculate about as if it did: ${gaps.length ? gaps.join(", ") : "none"}. If one of these would change the conclusion, say so plainly as a limitation.

Write 3-4 short paragraphs, in plain prose, no headers or bullets:
1. What these top names have in common — is this one coherent idea or a grab-bag?
2. The single most interesting or counterintuitive name in the list, and why.
3. The main risk the screen is selecting for without asking (and any data gap that matters).

Only reference figures shown above. Do not invent numbers.`;

  const { text, model } = await runPromptWithMeta(def.taskType, prompt);
  return { summary: text.trim(), model };
}
