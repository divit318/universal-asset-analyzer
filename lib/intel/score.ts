/**
 * Contextual intelligence scoring — the relevance gate.
 *
 * This is the part of the intel layer that enforces "quality > frequency":
 * every candidate is scored on the same seven dimensions, only candidates
 * above an absolute threshold survive, and at most three are selected with
 * category diversity preferred over raw score ties. When nothing clears the
 * bar the correct output is an empty array, not the least-bad candidate.
 *
 * Pure — no I/O, no clock. Unit-tested in tests/intel-score.test.ts.
 */

import type { IntelCandidate, IntelCard, IntelCategory, IntelSignals } from "./types";

/**
 * Dimension weights. Relevance and materiality dominate by design: an insight
 * about the wrong company, or one that couldn't change any conclusion, should
 * never be rescued by being fresh or actionable.
 */
const WEIGHTS: Record<keyof IntelSignals, number> = {
  relevance: 0.26,
  materiality: 0.24,
  timeliness: 0.14,
  novelty: 0.11,
  actionability: 0.1,
  confidence: 0.1,
  portfolioRelevance: 0.05,
};

/** Below this composite score a candidate is noise and must not render. */
export const INTEL_THRESHOLD = 0.55;

/** Suggestions carry a stricter bar — recommendations must earn their place. */
export const SUGGESTION_THRESHOLD = 0.66;

/** Never more than three cards; the design target is 1–2. */
export const MAX_CARDS = 3;

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export function scoreCandidate(signals: IntelSignals): number {
  let total = 0;
  for (const [dim, weight] of Object.entries(WEIGHTS) as [keyof IntelSignals, number][]) {
    total += clamp01(signals[dim]) * weight;
  }
  return Math.round(total * 1000) / 1000;
}

function thresholdFor(category: IntelCategory): number {
  return category === "suggestion" ? SUGGESTION_THRESHOLD : INTEL_THRESHOLD;
}

/**
 * Rank candidates, apply thresholds and caps, and return at most MAX_CARDS.
 *
 * Rules, in order:
 *  1. Suppressed ids (already dismissed/opened/recently shown) never appear.
 *  2. Duplicate ids collapse to the highest-scored instance.
 *  3. Every survivor must clear its category's absolute threshold.
 *  4. At most one `suggestion` per set.
 *  5. Category diversity: a second card of an already-picked category is only
 *     taken when no unrepresented category has a qualifying candidate left.
 */
export function selectCards(
  candidates: IntelCandidate[],
  opts: { suppressedIds?: ReadonlySet<string>; maxCards?: number } = {},
): IntelCard[] {
  const suppressed = opts.suppressedIds ?? new Set<string>();
  const maxCards = opts.maxCards ?? MAX_CARDS;

  const byId = new Map<string, { candidate: IntelCandidate; score: number }>();
  for (const candidate of candidates) {
    if (suppressed.has(candidate.id)) continue;
    const score = scoreCandidate(candidate.signals);
    if (score < thresholdFor(candidate.category)) continue;
    const existing = byId.get(candidate.id);
    if (!existing || score > existing.score) byId.set(candidate.id, { candidate, score });
  }

  const pool = [...byId.values()].sort((a, b) => b.score - a.score);

  const picked: { candidate: IntelCandidate; score: number }[] = [];
  const pickedCategories = new Set<IntelCategory>();
  let suggestionTaken = false;

  // Pass 1: best candidate of each category, highest score first.
  for (const entry of pool) {
    if (picked.length >= maxCards) break;
    const { category } = entry.candidate;
    if (pickedCategories.has(category)) continue;
    if (category === "suggestion") {
      if (suggestionTaken) continue;
      suggestionTaken = true;
    }
    picked.push(entry);
    pickedCategories.add(category);
  }

  // Pass 2: fill remaining slots by score, still max one suggestion.
  for (const entry of pool) {
    if (picked.length >= maxCards) break;
    if (picked.includes(entry)) continue;
    if (entry.candidate.category === "suggestion") continue;
    picked.push(entry);
  }

  return picked
    .sort((a, b) => b.score - a.score)
    .map(({ candidate, score }) => ({
      id: candidate.id,
      category: candidate.category,
      eyebrow: candidate.eyebrow,
      title: candidate.title,
      detail: candidate.detail,
      symbol: candidate.symbol,
      action: candidate.action,
      source: candidate.source,
      score,
    }));
}

/**
 * Timeliness from an event's age: 1 within the first two hours, decaying to 0
 * at `horizonHours`. Shared by generators so "fresh" means one thing.
 */
export function timelinessFromAge(ageMs: number, horizonHours: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  const horizonMs = horizonHours * 3_600_000;
  if (ageMs <= 2 * 3_600_000) return 1;
  if (ageMs >= horizonMs) return 0;
  return clamp01(1 - (ageMs - 2 * 3_600_000) / (horizonMs - 2 * 3_600_000));
}
