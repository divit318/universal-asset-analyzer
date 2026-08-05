/**
 * The explanation layer: "why did this asset pass my screen?"
 *
 * Deterministic and local — no model call. Three reasons that matters:
 *  1. It runs for every row in the table, not just the ones a user asks about.
 *  2. It cannot hallucinate a number, because it only ever restates values the
 *     filter engine actually compared.
 *  3. It works with the AI unavailable.
 *
 * The AI layer (lib/screener/ai-summary.ts) sits *above* this and explains the
 * ranking as a whole — the pattern across the top names — which is the part
 * that genuinely benefits from a language model. Per-row "why" does not.
 */

import { getAssetClass, getMetric } from "../assets/registry";
import type { AssetClassId, FilterValue, FilterValues } from "../assets/types";
import { activeFilters } from "./filter-engine";
import { formatMetricValue } from "./format";
import type { MatchExplanation, ScreenerCandidate } from "./types";

/** Restate one active filter as the constraint the user set, e.g. "ROIC ≥ 12%". */
function constraintLabel(assetClass: AssetClassId, key: string, filter: FilterValue): string | null {
  const metric = getMetric(assetClass, key);
  if (!metric) return null;

  switch (filter.kind) {
    case "range": {
      const lo = filter.min != null ? formatMetricValue(metric, filter.min) : null;
      const hi = filter.max != null ? formatMetricValue(metric, filter.max) : null;
      if (lo != null && hi != null) return `${metric.label} between ${lo} and ${hi}`;
      if (lo != null) return `${metric.label} ≥ ${lo}`;
      if (hi != null) return `${metric.label} ≤ ${hi}`;
      return null;
    }
    case "select":
      return filter.value ? `${metric.label} is ${filter.value}` : null;
    case "multiselect":
      return filter.values.length ? `${metric.label} is ${filter.values.join(" or ")}` : null;
    case "boolean":
      return filter.value != null ? `${metric.label}: ${filter.value ? "yes" : "no"}` : null;
  }
}

/** The candidate's actual value for a filtered metric, formatted. */
function actualValue(
  candidate: ScreenerCandidate,
  assetClass: AssetClassId,
  key: string,
): string {
  const metric = getMetric(assetClass, key);
  if (!metric) return "—";
  if (metric.options) return candidate.attributes[key] ?? "—";
  return formatMetricValue(metric, candidate.metrics[key] ?? null);
}

/** Percentile → plain English. Avoids making the user parse "83rd percentile". */
function strengthPhrase(pct: number): string | null {
  if (pct >= 95) return "top 5% of the universe";
  if (pct >= 90) return "top 10%";
  if (pct >= 75) return "top quartile";
  return null;
}

export function explain(
  candidate: ScreenerCandidate,
  assetClass: AssetClassId,
  filters: FilterValues,
  percentiles: Record<string, number>,
): MatchExplanation {
  const def = getAssetClass(assetClass);

  // Why it passed: every active filter, with the value that cleared it.
  const passed: MatchExplanation["passed"] = [];
  for (const [key, filter] of Object.entries(activeFilters(assetClass, filters))) {
    const label = constraintLabel(assetClass, key, filter);
    if (label) passed.push({ label, detail: actualValue(candidate, assetClass, key) });
  }

  // Strengths: where it ranks well on the factors that actually drove its
  // score. Sorted by percentile so the strongest claim leads, capped at three
  // so the UI stays scannable.
  const strengths = Object.entries(percentiles)
    .map(([key, pct]) => ({ key, pct, phrase: strengthPhrase(pct) }))
    .filter((x) => x.phrase != null)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)
    .map(({ key, phrase }) => {
      const metric = getMetric(assetClass, key);
      return {
        label: metric?.label ?? key,
        detail: `${actualValue(candidate, assetClass, key)} — ${phrase}`,
      };
    });

  // Warnings: the registry's own risk flags. Same flags Scanner/Watchlist can reuse.
  const warnings = def.warnings
    .filter((w) => {
      try {
        return w.test(candidate.metrics, candidate.attributes);
      } catch {
        return false; // a flag that throws on odd data must not take down the screen
      }
    })
    .map((w) => w.label);

  return { passed, strengths, warnings };
}
