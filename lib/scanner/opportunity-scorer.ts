/**
 * Scanner v2 — opportunity scoring.
 *
 * Computes a composite OpportunityScore for each validated ScannerOpportunity
 * by combining:
 *   - Catalyst strength (from the sector signal that drove the opportunity)
 *   - Fundamental quality (from compositeScores.overall)
 *   - Valuation (from compositeScores.value)
 *   - Momentum (from compositeScores.momentum + live quote direction)
 *
 * Splits results into highConviction (composite >= 70) and developing (40-69).
 */

import type { ScannerOpportunity, OpportunityScore, SectorImpact } from "../types";
import { buildOpportunityProfile } from "../opportunity-engine";
import { getLatestSectorRotation, findSectorRotationEntry } from "../sector-rotation";

/** Weights for the composite opportunity score */
const WEIGHTS = {
  catalystStrength: 0.30,
  fundamentalQuality: 0.30,
  valuation: 0.20,
  momentum: 0.20,
};

function scoreToVerdict(score: number): OpportunityScore["verdict"] {
  if (score >= 75) return "exceptional";
  if (score >= 60) return "strong";
  if (score >= 45) return "moderate";
  return "weak";
}

function computeMomentumScore(opp: ScannerOpportunity): number {
  // Base momentum from composite scorer (if available)
  const compositeMomentum = opp.compositeScores?.momentum ?? null;
  // Adjust by today's price direction
  const todayChange = opp.quote?.changePercent ?? 0;
  const directionBoost =
    opp.direction === "bullish"
      ? Math.max(0, todayChange) * 2   // bonus for stocks already moving in our direction
      : opp.direction === "bearish"
        ? Math.max(0, -todayChange) * 2  // bonus for bearish thesis confirmed by price action
        : 0;

  if (compositeMomentum == null) {
    // Fallback: convert today's price change into a score
    const base = 50; // neutral
    return Math.max(0, Math.min(100, base + directionBoost));
  }
  return Math.max(0, Math.min(100, compositeMomentum + directionBoost));
}

/** Score and rank all opportunities. */
export function scoreOpportunities(
  opportunities: ScannerOpportunity[],
  sectorImpacts: SectorImpact[],
  emergingThemeNames: string[] = [],
): ScannerOpportunity[] {
  // Build sector strength lookup
  const sectorStrengthMap = new Map(
    sectorImpacts.map((s) => [s.sector, s.strength]),
  );
  const themeNameSet = new Set(emergingThemeNames.map((t) => t.toLowerCase()));

  // Sector Rotation Engine: continuous relative-strength context, blended
  // into catalyst strength alongside the one-off, event-driven SectorImpact
  // signal above. Best-effort — a missing/not-yet-persisted snapshot degrades
  // to the event-driven signal alone (unchanged prior behavior).
  const rotationSnapshot = getLatestSectorRotation();

  return opportunities.map((opp) => {
    // Catalyst strength: blend the event-driven sector impact strength with
    // the Sector Rotation Engine's continuous relative-strength signal for
    // the same sector, so opportunities in strengthening sectors rank higher
    // even without a fresh news event.
    const eventCatalyst =
      sectorStrengthMap.get(opp.theme) ??
      opp.opportunityScore.catalystStrength;
    const rotationEntry = findSectorRotationEntry(rotationSnapshot, opp.theme);
    const rotationCatalyst =
      rotationEntry != null
        ? Math.max(0, Math.min(100, 50 + rotationEntry.relativeStrength * 2))
        : null;
    const catalystStrength =
      rotationCatalyst != null
        ? Math.round(eventCatalyst * 0.7 + rotationCatalyst * 0.3)
        : eventCatalyst;

    // Fundamental quality from composite overall score (0 if unavailable)
    const fundamentalQuality = opp.compositeScores?.overall ?? 50;

    // Valuation from composite value score (neutral 50 if unavailable)
    const valuation = opp.compositeScores?.value ?? 50;

    // Momentum
    const momentum = computeMomentumScore(opp);

    // Weighted composite
    const composite = Math.round(
      catalystStrength * WEIGHTS.catalystStrength +
      fundamentalQuality * WEIGHTS.fundamentalQuality +
      valuation * WEIGHTS.valuation +
      momentum * WEIGHTS.momentum,
    );

    const opportunityScore: OpportunityScore = {
      catalystStrength,
      fundamentalQuality,
      valuation,
      momentum,
      composite,
      verdict: scoreToVerdict(composite),
    };

    const sectorStrength = sectorStrengthMap.get(opp.theme);
    const profile = buildOpportunityProfile({
      symbol: opp.ticker,
      score: composite,
      dimensions: {
        value: opp.compositeScores?.value ?? null,
        growth: opp.compositeScores?.growth ?? null,
        quality: opp.compositeScores?.quality ?? null,
        financialHealth: opp.compositeScores?.financialHealth ?? null,
        momentum: opp.compositeScores?.momentum ?? null,
      },
      dividendYieldPct: opp.dividendYieldPct,
      momentum3mReturn: opp.quote?.changePercent ?? null,
      momentumTrend: opp.direction === "bullish" ? "up" : opp.direction === "bearish" ? "down" : "flat",
      sectorSignalStrength: sectorStrength ?? null,
      isThematic: themeNameSet.has(opp.theme.toLowerCase()),
      riskItems: [],
      thesis: opp.thesis,
    });

    return { ...opp, opportunityScore, profile };
  });
}

/**
 * Re-derive `profile` after an AI thesis has been attached (thesis-builder runs
 * after scoreOpportunities, only for high-conviction ideas). The thesis's
 * bull/bear/catalysts/risks/confidence/horizon take precedence over the
 * heuristic narrative computed in scoreOpportunities.
 */
export function refreshProfileWithThesis(opp: ScannerOpportunity): ScannerOpportunity {
  if (!opp.thesis || !opp.profile) return opp;
  const profile = buildOpportunityProfile({
    symbol: opp.ticker,
    score: opp.opportunityScore.composite,
    dimensions: {
      value: opp.compositeScores?.value ?? null,
      growth: opp.compositeScores?.growth ?? null,
      quality: opp.compositeScores?.quality ?? null,
      financialHealth: opp.compositeScores?.financialHealth ?? null,
      momentum: opp.compositeScores?.momentum ?? null,
    },
    dividendYieldPct: opp.dividendYieldPct,
    momentum3mReturn: opp.quote?.changePercent ?? null,
    momentumTrend: opp.direction === "bullish" ? "up" : opp.direction === "bearish" ? "down" : "flat",
    sectorSignalStrength: opp.profile.categories.includes("sector_rotation") ? 45 : null,
    isThematic: opp.profile.categories.includes("emerging_theme"),
    riskItems: [],
    thesis: opp.thesis,
  });
  return { ...opp, profile };
}

/** Sort and segment opportunities into highConviction + developing buckets. */
export function segmentOpportunities(opportunities: ScannerOpportunity[]): {
  all: ScannerOpportunity[];
  highConviction: ScannerOpportunity[];
  developing: ScannerOpportunity[];
} {
  const sorted = [...opportunities].sort(
    (a, b) => b.opportunityScore.composite - a.opportunityScore.composite,
  );

  const highConviction = sorted.filter(
    (o) => o.opportunityScore.composite >= 70,
  );
  const developing = sorted.filter(
    (o) =>
      o.opportunityScore.composite >= 40 && o.opportunityScore.composite < 70,
  );

  return { all: sorted, highConviction, developing };
}
