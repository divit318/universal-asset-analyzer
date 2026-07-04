/**
 * IOS Fit Scorer — computes PortfolioFitAnalysis for any asset.
 *
 * Pure function: no network I/O, no Ollama calls. Every score is derived
 * deterministically from the InvestmentProfile + FitAssetData. Each dimension
 * is independently interpretable and shown to the user.
 *
 * Weights:
 *   Sector diversification  25%
 *   Correlation proxy       20%
 *   Objective alignment     20%
 *   Style balance           15%
 *   Geographic diversity    10%
 *   Sizing feasibility      10%
 */

import type { PortfolioObjective } from "@/lib/portfolio-analytics";
import type {
  FitAssetData,
  FitDimension,
  FitTier,
  InvestmentProfile,
  PortfolioFitAnalysis,
  ContextualRanking,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(v: number, lo: number, hi: number): number {
  if (hi === lo) return 50;
  return clamp(((v - lo) / (hi - lo)) * 100);
}

function fitTier(score: number): FitTier {
  if (score >= 80) return "excellent";
  if (score >= 65) return "good";
  if (score >= 45) return "neutral";
  if (score >= 30) return "poor";
  return "avoid";
}

function impactOf(score: number): "positive" | "neutral" | "negative" {
  if (score >= 65) return "positive";
  if (score >= 40) return "neutral";
  return "negative";
}

function growthScore(asset: FitAssetData): number {
  if (asset.compositeScores?.growth != null) return asset.compositeScores.growth;
  // Approximate from ScoreResult buckets
  if (asset.scoreResult) {
    const gb = asset.scoreResult.buckets.find((b) => b.name === "Growth");
    if (gb) return Math.round((gb.points / gb.max) * 100);
  }
  return 50;
}

function valueScore(asset: FitAssetData): number {
  if (asset.compositeScores?.value != null) return asset.compositeScores.value;
  if (asset.scoreResult) {
    const vb = asset.scoreResult.buckets.find((b) => b.name === "Valuation");
    if (vb) return Math.round((vb.points / vb.max) * 100);
  }
  return 50;
}

function momentumScoreOf(asset: FitAssetData): number {
  if (asset.compositeScores?.momentum != null) return asset.compositeScores.momentum;
  if (asset.scoreResult?.signals.momentum != null) return asset.scoreResult.signals.momentum;
  return 50;
}

function qualityScoreOf(asset: FitAssetData): number {
  if (asset.compositeScores?.quality != null) return asset.compositeScores.quality;
  if (asset.scoreResult) {
    const qb = asset.scoreResult.buckets.find((b) => b.name === "Quality");
    if (qb) return Math.round((qb.points / qb.max) * 100);
  }
  return 50;
}

function healthScoreOf(asset: FitAssetData): number {
  if (asset.compositeScores?.financialHealth != null) return asset.compositeScores.financialHealth;
  if (asset.scoreResult) {
    const hb = asset.scoreResult.buckets.find((b) => b.name === "Financial Health");
    if (hb) return Math.round((hb.points / hb.max) * 100);
  }
  return 50;
}

/* -------------------------------------------------------------------------- */
/* Dimension 1 — Sector Diversification (25%)                                 */
/* -------------------------------------------------------------------------- */

function scoreSector(
  asset: FitAssetData,
  profile: InvestmentProfile,
): FitDimension {
  const sector = asset.sector ?? "Unknown";

  if (!profile.hasPortfolio) {
    return {
      label: "Sector",
      score: 50,
      weight: 0.25,
      message: "Build your portfolio to see sector analysis",
      impact: "neutral",
    };
  }

  // Check if excluded
  if (profile.constraints.excludedSymbols.includes(asset.symbol.toUpperCase())) {
    return {
      label: "Sector",
      score: 0,
      weight: 0.25,
      message: `${asset.symbol} is on your excluded list`,
      impact: "negative",
    };
  }

  const sectorEntry = profile.sectorWeights.find((s) => s.sector === sector);
  const currentWeight = sectorEntry?.weight ?? 0;

  if (profile.missingSectors.includes(sector)) {
    return {
      label: "Sector",
      score: 90,
      weight: 0.25,
      message: `Fills missing ${sector} exposure`,
      impact: "positive",
    };
  }

  if (profile.underweightSectors.includes(sector)) {
    return {
      label: "Sector",
      score: 78,
      weight: 0.25,
      message: `Strengthens underweight ${sector} position (${currentWeight.toFixed(1)}%)`,
      impact: "positive",
    };
  }

  if (profile.overweightSectors.includes(sector)) {
    return {
      label: "Sector",
      score: 20,
      weight: 0.25,
      message: `${sector} already exceeds your ${profile.constraints.maxSectorPct}% sector limit (${currentWeight.toFixed(1)}%)`,
      impact: "negative",
    };
  }

  // Sector is present and within bounds — score based on current concentration
  const score = clamp(lerp(currentWeight, 30, 5));
  return {
    label: "Sector",
    score,
    weight: 0.25,
    message:
      currentWeight < 15
        ? `Adds to balanced ${sector} exposure (${currentWeight.toFixed(1)}%)`
        : `${sector} is already well-represented (${currentWeight.toFixed(1)}%)`,
    impact: impactOf(score),
  };
}

/* -------------------------------------------------------------------------- */
/* Dimension 2 — Correlation Proxy (20%)                                      */
/* -------------------------------------------------------------------------- */

function scoreCorrelation(
  asset: FitAssetData,
  profile: InvestmentProfile,
): FitDimension {
  if (!profile.hasPortfolio) {
    return {
      label: "Correlation",
      score: 50,
      weight: 0.20,
      message: "No portfolio to measure correlation against",
      impact: "neutral",
    };
  }

  const assetSector = asset.sector ?? "Unknown";

  // Compute a portfolio sector HHI proxy to judge how concentrated the existing
  // portfolio is in this sector. If the asset is in a dominant sector → high
  // correlation proxy → lower score.
  const topSectors = [...profile.sectorWeights]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((s) => s.sector);

  const dominantSectorWeight =
    profile.sectorWeights.find((s) => s.sector === assetSector)?.weight ?? 0;

  // Check if asset is already held (same sector, very high correlation)
  const alreadyHeld = profile.holdingSymbols.includes(asset.symbol.toUpperCase());
  if (alreadyHeld) {
    return {
      label: "Correlation",
      score: 35,
      weight: 0.20,
      message: `Already in portfolio — adding shares increases concentration`,
      impact: "negative",
    };
  }

  // If this is the dominant sector, correlation risk is high
  if (topSectors[0] === assetSector && dominantSectorWeight > 25) {
    return {
      label: "Correlation",
      score: 30,
      weight: 0.20,
      message: `High correlation with existing holdings — ${assetSector} is your top sector at ${dominantSectorWeight.toFixed(1)}%`,
      impact: "negative",
    };
  }

  if (topSectors.includes(assetSector)) {
    const score = clamp(lerp(dominantSectorWeight, 30, 5));
    return {
      label: "Correlation",
      score,
      weight: 0.20,
      message: `Moderate correlation with portfolio — ${assetSector} is ${dominantSectorWeight.toFixed(1)}% of holdings`,
      impact: impactOf(score),
    };
  }

  // Not in a top sector → low correlation proxy → good
  return {
    label: "Correlation",
    score: 82,
    weight: 0.20,
    message: `Low correlation with portfolio — adds a different return stream`,
    impact: "positive",
  };
}

/* -------------------------------------------------------------------------- */
/* Dimension 3 — Objective Alignment (20%)                                    */
/* -------------------------------------------------------------------------- */

function scoreObjective(
  asset: FitAssetData,
  objective: PortfolioObjective,
): FitDimension {
  const growth = growthScore(asset);
  const value = valueScore(asset);
  const quality = qualityScoreOf(asset);
  const health = healthScoreOf(asset);
  const momentum = momentumScoreOf(asset);
  const dividend = asset.dividendYield ?? 0;
  const beta = asset.beta ?? 1;

  let score: number;
  let message: string;

  switch (objective) {
    case "maximize_growth":
      score = Math.round(growth * 0.5 + momentum * 0.3 + quality * 0.2);
      message =
        score >= 65
          ? `Strong growth profile (growth ${Math.round(growth)}, momentum ${Math.round(momentum)})`
          : `Moderate growth profile — consider higher-growth alternatives`;
      break;

    case "reduce_risk":
      score = Math.round(
        health * 0.35 + quality * 0.30 + clamp(lerp(beta, 1.5, 0.5)) * 0.35,
      );
      message =
        score >= 65
          ? `Defensive profile — low volatility and strong financial health`
          : `Higher risk than your reduce-risk objective prefers`;
      break;

    case "improve_diversification":
      // Handled primarily by sector + correlation dimensions; give neutral-positive
      score = 65;
      message = `Diversification scored via sector and correlation dimensions`;
      break;

    case "increase_income":
      score = clamp(dividend > 0 ? lerp(dividend, 0, 5) : 15);
      message =
        dividend >= 2
          ? `Dividend yield ${dividend.toFixed(1)}% supports income objective`
          : dividend > 0
          ? `Low yield ${dividend.toFixed(1)}% — limited income contribution`
          : `No dividend — conflicts with income objective`;
      break;

    case "beat_benchmark":
      score = Math.round(quality * 0.3 + growth * 0.35 + momentum * 0.2 + value * 0.15);
      message =
        score >= 65
          ? `High alpha potential — strong quality, growth, and momentum`
          : `Below-average alpha potential vs benchmark`;
      break;

    case "preserve_capital":
      score = Math.round(
        health * 0.4 + quality * 0.35 + clamp(lerp(beta, 1.5, 0.3)) * 0.25,
      );
      message =
        score >= 65
          ? `Capital preservation profile — stable fundamentals and low volatility`
          : `Higher risk than capital preservation objective warrants`;
      break;

    case "ai_optimized":
    default:
      score = Math.round(
        growth * 0.25 + quality * 0.25 + health * 0.20 + momentum * 0.15 + value * 0.15,
      );
      message =
        score >= 65
          ? `Well-rounded fundamentals across growth, quality, and health`
          : `Mixed fundamental picture — review conviction before adding`;
      break;
  }

  return {
    label: "Objective",
    score: clamp(score),
    weight: 0.20,
    message,
    impact: impactOf(score),
  };
}

/* -------------------------------------------------------------------------- */
/* Dimension 4 — Style Balance (15%)                                          */
/* -------------------------------------------------------------------------- */

function scoreStyle(
  asset: FitAssetData,
  profile: InvestmentProfile,
): FitDimension {
  if (!profile.hasPortfolio) {
    return {
      label: "Style",
      score: 50,
      weight: 0.15,
      message: "Style analysis available after building portfolio",
      impact: "neutral",
    };
  }

  const s = profile.styleWeights;
  const assetGrowth = growthScore(asset);
  const assetValue = valueScore(asset);
  const assetMomentum = momentumScoreOf(asset);
  const assetQuality = qualityScoreOf(asset);

  // A stock scores well on style if it fills the *gaps* in the portfolio's tilts.
  // Gap: a dimension where portfolio is < 40 (underexposed)
  let bonus = 0;
  const messages: string[] = [];

  if (s.growth < 40 && assetGrowth > 65) { bonus += 25; messages.push("adds growth exposure"); }
  if (s.value < 40 && assetValue > 65) { bonus += 20; messages.push("adds value characteristics"); }
  if (s.momentum < 40 && assetMomentum > 65) { bonus += 20; messages.push("improves momentum tilt"); }
  if (s.quality < 40 && assetQuality > 65) { bonus += 20; messages.push("strengthens quality factor"); }

  // Penalise if it concentrates an already-dominant style (> 70)
  let penalty = 0;
  if (s.growth > 70 && assetGrowth > 70) { penalty += 20; }
  if (s.momentum > 70 && assetMomentum > 70) { penalty += 15; }

  const score = clamp(55 + bonus - penalty);
  return {
    label: "Style",
    score,
    weight: 0.15,
    message:
      messages.length > 0
        ? `Portfolio gains: ${messages.join(", ")}`
        : penalty > 0
        ? `Concentrates existing style tilts`
        : `Neutral style impact`,
    impact: impactOf(score),
  };
}

/* -------------------------------------------------------------------------- */
/* Dimension 5 — Geographic Diversification (10%)                             */
/* -------------------------------------------------------------------------- */

function scoreGeographic(
  asset: FitAssetData,
  profile: InvestmentProfile,
): FitDimension {
  const geo = asset.geography ?? "US";

  if (!profile.hasPortfolio) {
    return {
      label: "Geography",
      score: 50,
      weight: 0.10,
      message: "Geographic analysis available after building portfolio",
      impact: "neutral",
    };
  }

  // Estimate portfolio geography — approximate as US unless we have explicit data
  // (EnrichedPosition doesn't currently carry geography; this is a forward-looking hook)
  const isUSHeavy = true; // conservative assumption until positions carry geography

  if (geo === "US" && isUSHeavy) {
    return {
      label: "Geography",
      score: 50,
      weight: 0.10,
      message: "US equity — neutral geographic impact on a US-heavy portfolio",
      impact: "neutral",
    };
  }

  const geoLabels: Record<string, string> = {
    IN: "India", JP: "Japan", HK: "Hong Kong", AU: "Australia", EU: "Europe", CRYPTO: "Crypto",
  };
  const geoLabel = geoLabels[geo] || geo;

  return {
    label: "Geography",
    score: 78,
    weight: 0.10,
    message: `${geoLabel} exposure diversifies a US-heavy portfolio`,
    impact: "positive",
  };
}

/* -------------------------------------------------------------------------- */
/* Dimension 6 — Sizing Feasibility (10%)                                     */
/* -------------------------------------------------------------------------- */

function scoreSizing(
  asset: FitAssetData,
  profile: InvestmentProfile,
  suggestedPct: number,
): FitDimension {
  if (profile.constraints.excludedSymbols.includes(asset.symbol.toUpperCase())) {
    return {
      label: "Sizing",
      score: 0,
      weight: 0.10,
      message: `${asset.symbol} is on your excluded list`,
      impact: "negative",
    };
  }

  if (profile.constraints.requireDividend && !asset.dividendYield) {
    return {
      label: "Sizing",
      score: 20,
      weight: 0.10,
      message: `No dividend — conflicts with your dividend requirement`,
      impact: "negative",
    };
  }

  const capFilter = profile.constraints.marketCapFilter;
  if (capFilter !== "any" && asset.marketCap != null) {
    const isLarge = asset.marketCap >= 10e9;
    const isMid = asset.marketCap >= 2e9 && asset.marketCap < 10e9;
    const isSmall = asset.marketCap < 2e9;
    if (
      (capFilter === "large" && !isLarge) ||
      (capFilter === "mid" && !isMid) ||
      (capFilter === "small" && !isSmall)
    ) {
      return {
        label: "Sizing",
        score: 25,
        weight: 0.10,
        message: `Market cap outside your ${capFilter}-cap filter`,
        impact: "negative",
      };
    }
  }

  const willExceedMax = suggestedPct > profile.constraints.maxPositionPct;
  if (willExceedMax) {
    return {
      label: "Sizing",
      score: 45,
      weight: 0.10,
      message: `Position capped at your ${profile.constraints.maxPositionPct}% limit`,
      impact: "neutral",
    };
  }

  return {
    label: "Sizing",
    score: 85,
    weight: 0.10,
    message: `${suggestedPct.toFixed(1)}% allocation fits within your constraints`,
    impact: "positive",
  };
}

/* -------------------------------------------------------------------------- */
/* Suggested allocation calculation                                            */
/* -------------------------------------------------------------------------- */

function computeSuggestedAllocation(
  profile: InvestmentProfile,
  sectorScore: number,
  objectiveScore: number,
): { pct: number; amount: number } {
  const n = profile.positionCount;
  if (n === 0 || !profile.hasPortfolio) return { pct: 5, amount: 0 };

  // Base: equal weight among current + 1 new position
  const equalWeight = 100 / (n + 1);
  // Conviction multiplier: high fit → up to 1.5× base; low fit → 0.7×
  const conviction = (sectorScore * 0.5 + objectiveScore * 0.5) / 100;
  const multiplier = 0.7 + conviction * 0.8;
  const raw = equalWeight * multiplier;

  // Clamp to max position constraint
  const pct = Math.min(
    Math.round(Math.min(raw, profile.constraints.maxPositionPct) * 2) / 2,
    profile.constraints.maxPositionPct,
  );
  const amount = Math.round((profile.totalValue * pct) / 100);
  return { pct, amount };
}

/* -------------------------------------------------------------------------- */
/* Projected HHI after adding position                                         */
/* -------------------------------------------------------------------------- */

function projectHHI(currentHHI: number, currentN: number, addedPct: number): number {
  // HHI = Σ w_i² × 10000
  // Approximate: redistributing addedPct proportionally reduces existing weights
  const scale = (100 - addedPct) / 100;
  const newHHI = currentHHI * (scale ** 2) + (addedPct ** 2);
  return Math.round(clamp(newHHI, 0, 10000));
}

/* -------------------------------------------------------------------------- */
/* computePortfolioFit — main entry point                                      */
/* -------------------------------------------------------------------------- */

export function computePortfolioFit(
  asset: FitAssetData,
  profile: InvestmentProfile,
): PortfolioFitAnalysis {
  const isInPortfolio = profile.holdingSymbols.includes(asset.symbol.toUpperCase());
  const isOnWatchlist = asset.isOnWatchlist ?? false;
  const isGeneric = !profile.hasPortfolio;

  // ── Score all dimensions ──────────────────────────────────────────────────
  const sectorDim = scoreSector(asset, profile);
  const correlationDim = scoreCorrelation(asset, profile);
  const objectiveDim = scoreObjective(asset, profile.objective);
  const styleDim = scoreStyle(asset, profile);
  const geographicDim = scoreGeographic(asset, profile);

  // Re-compute allocation with real sector + objective scores
  const { pct: finalPct, amount: finalAmount } = computeSuggestedAllocation(
    profile,
    sectorDim.score,
    objectiveDim.score,
  );

  const sizingDim = scoreSizing(asset, profile, finalPct);

  // ── Composite fit score ───────────────────────────────────────────────────
  const fitScore = Math.round(
    sectorDim.score * sectorDim.weight +
    correlationDim.score * correlationDim.weight +
    objectiveDim.score * objectiveDim.weight +
    styleDim.score * styleDim.weight +
    geographicDim.score * geographicDim.weight +
    sizingDim.score * sizingDim.weight,
  );

  // ── Build reasons and trade-offs ──────────────────────────────────────────
  const allDims = [sectorDim, correlationDim, objectiveDim, styleDim, geographicDim, sizingDim];
  const reasons = allDims
    .filter((d) => d.impact === "positive")
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((d) => d.message);

  const tradeoffs = allDims
    .filter((d) => d.impact === "negative")
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((d) => d.message);

  // ── Concentration projection ──────────────────────────────────────────────
  const projectedHHI = profile.hasPortfolio
    ? projectHHI(profile.hhi, profile.positionCount, finalPct)
    : 0;
  const concentrationWarning = projectedHHI > 2500 || finalPct > profile.constraints.maxPositionPct * 0.8;

  return {
    symbol: asset.symbol,
    fitScore: clamp(fitScore),
    fitTier: fitTier(fitScore),
    dimensions: {
      sector: sectorDim,
      correlation: correlationDim,
      objective: objectiveDim,
      style: styleDim,
      geographic: geographicDim,
      sizing: sizingDim,
    },
    reasons: isGeneric ? ["Build your portfolio to get personalized fit analysis"] : reasons,
    tradeoffs: isGeneric ? [] : tradeoffs,
    suggestedAllocationPct: finalPct,
    suggestedAmount: finalAmount,
    projectedHHI,
    concentrationWarning,
    isInPortfolio,
    isOnWatchlist,
    isGeneric,
  };
}

/* -------------------------------------------------------------------------- */
/* rankByFit — re-rank any list by combining absolute + fit scores            */
/* -------------------------------------------------------------------------- */

export function rankByFit(
  items: Array<FitAssetData & { absoluteScore: number }>,
  profile: InvestmentProfile,
  fitWeight = 0.4,
): ContextualRanking[] {
  return items
    .map((item) => {
      const fit = computePortfolioFit(item, profile);
      const combined = Math.round(
        item.absoluteScore * (1 - fitWeight) + fit.fitScore * fitWeight,
      );
      const summary =
        fit.reasons[0] ??
        (fit.isGeneric ? "Build portfolio for personalized ranking" : "Neutral portfolio fit");

      return {
        symbol: item.symbol,
        absoluteScore: item.absoluteScore,
        fitScore: fit.fitScore,
        fitTier: fit.fitTier,
        combinedScore: combined,
        fitSummary: summary,
      } satisfies ContextualRanking;
    })
    .sort((a, b) => b.combinedScore - a.combinedScore);
}
