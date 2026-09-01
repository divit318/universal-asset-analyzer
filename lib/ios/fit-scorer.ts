/**
 * IOS Fit Scorer — the Portfolio Context Engine + Portfolio Fit Score layers
 * of the unified recommendation hierarchy.
 *
 * Pure function: no network I/O, no AI calls. Every score is derived
 * deterministically from the InvestmentProfile + FitAssetData.
 *
 * ── Where this sits (see lib/ios/unified-action.ts for the full ladder) ────
 *
 *   Research Score  →  Portfolio Context Engine  →  Portfolio Fit Score
 *                      (the six dimensions below)    (research + effects blend)
 *
 * The fit score INHERITS the Research Score rather than recreating its own
 * opinion:  fit = researchWeight·research + (1−researchWeight)·portfolioEffects,
 * bounded by two guardrails (DEFAULT_FIT_CONFIG):
 *
 *   • Uplift cap — fit ≤ research + maxDiversificationUplift. Diversification
 *     benefit can never turn a weak asset into a "good fit".
 *   • Drag floor — fit ≥ research − maxPortfolioDrag. Portfolio friction can
 *     never bury an exceptional asset; only a HARD gate (which names its
 *     constraint in capReason) may cut deeper.
 *
 * When no research score exists, fit degrades to the pure portfolio-effects
 * composite with shrinkage toward a neutral prior (the pre-2026-08 behavior).
 * The full research → fit derivation is exported step-by-step on `bridge`.
 *
 * ── Portfolio-effects methodology ──────────────────────────────────────────
 * Each dimension returns a { score, confidence } pair. The composite is a
 * *confidence-weighted* renormalized average, so a dimension with no evidence
 * (confidence 0) drops out entirely instead of injecting a misleading
 * constant. This is the fix for the old behaviour where data-poor assets all
 * collapsed to ~73 because four of six dimensions silently returned favorable
 * constants.
 *
 * Two invariants the old system violated and this one enforces:
 *   1. Missing data is NEVER advantageous. An unknown sector/geography lowers
 *      confidence; it can never score higher than known-good data.
 *   2. Hard constraints are gates, not averaged dimensions. An excluded symbol
 *      or a cap breach clamps the final score into the poor/avoid band rather
 *      than being diluted to a passing average.
 *
 * Nominal weights (renormalized by confidence at composite time):
 *   Sector concentration / gap   0.22
 *   Correlation / overlap        0.18
 *   Objective alignment          0.24
 *   Style balance                0.10
 *   Geographic diversification   0.08
 *   Sizing feasibility           0.18
 */

import type { PortfolioObjective } from "./types";
import type {
  FitAssetData,
  FitBridgeStep,
  FitDimension,
  InvestmentProfile,
  PortfolioFitAnalysis,
  ContextualRanking,
} from "./types";
import { deriveUnifiedAction, fitTier } from "./unified-action";
import { assessPolicyFit } from "./policy-fit";
import { scoreLabel } from "../recommendation";

/* -------------------------------------------------------------------------- */
/* Nominal dimension weights                                                   */
/* -------------------------------------------------------------------------- */

const W = {
  sector: 0.22,
  correlation: 0.18,
  objective: 0.24,
  style: 0.10,
  geographic: 0.08,
  sizing: 0.18,
} as const;

/* -------------------------------------------------------------------------- */
/* Research-inheritance configuration                                          */
/* -------------------------------------------------------------------------- */

/**
 * How the Research Score and the portfolio-effects composite combine into the
 * Portfolio Fit Score. Exposed (and accepted as an override by
 * computePortfolioFit) so weights are configuration, not magic numbers.
 */
export interface FitScoringConfig {
  /** Share of the fit score carried by the standalone Research Score. */
  researchWeight: number;
  /** Fit may exceed the research score by at most this many points —
   *  diversification benefit cannot rescue a weak asset. */
  maxDiversificationUplift: number;
  /** Fit may fall below the research score by at most this many points before
   *  only a HARD gate (named in capReason) is allowed to cut deeper. */
  maxPortfolioDrag: number;
}

export const DEFAULT_FIT_CONFIG: FitScoringConfig = {
  researchWeight: 0.45,
  maxDiversificationUplift: 15,
  maxPortfolioDrag: 35,
};

/**
 * THE standalone Research Score for an asset, resolved from the richest
 * available source: an explicit override (the page's canonical headline
 * composite), the batch composite's overall, or the decision engine's
 * composite. Null when no scorer covered the asset.
 */
export function resolveResearchScore(asset: FitAssetData): number | null {
  return asset.researchScore ?? asset.compositeScores?.overall ?? asset.scoreResult?.composite ?? null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Whether the asset carries any real fundamental factor data. An all-null
 * compositeScores object (Yahoo returned nothing) does NOT count as data. */
function hasFundamentals(asset: FitAssetData): boolean {
  const c = asset.compositeScores;
  if (c && (c.growth ?? c.value ?? c.quality ?? c.financialHealth ?? c.momentum ?? c.overall) != null) {
    return true;
  }
  return asset.scoreResult != null;
}

/** Impact is only asserted when we actually have evidence for the dimension. */
function impactOf(score: number, confidence: number): FitDimension["impact"] {
  if (confidence < 0.4) return "neutral";
  if (score >= 62) return "positive";
  if (score >= 45) return "neutral";
  return "negative";
}

/* -------------------------------------------------------------------------- */
/* Factor extraction (fundamentals) — return null when genuinely absent        */
/* -------------------------------------------------------------------------- */

function bucketPct(asset: FitAssetData, name: string): number | null {
  const b = asset.scoreResult?.buckets.find((x) => x.name === name);
  if (b && b.max > 0) return Math.round((b.points / b.max) * 100);
  return null;
}

function growthScore(asset: FitAssetData): number | null {
  return asset.compositeScores?.growth ?? bucketPct(asset, "Growth");
}
function valueScore(asset: FitAssetData): number | null {
  return asset.compositeScores?.value ?? bucketPct(asset, "Valuation");
}
function momentumScoreOf(asset: FitAssetData): number | null {
  return asset.compositeScores?.momentum ?? asset.scoreResult?.signals.momentum ?? null;
}
function qualityScoreOf(asset: FitAssetData): number | null {
  return asset.compositeScores?.quality ?? bucketPct(asset, "Quality");
}
function healthScoreOf(asset: FitAssetData): number | null {
  return asset.compositeScores?.financialHealth ?? bucketPct(asset, "Financial Health");
}

/* -------------------------------------------------------------------------- */
/* Portfolio helpers                                                           */
/* -------------------------------------------------------------------------- */

function sectorWeightOf(profile: InvestmentProfile, sector: string): number {
  return profile.sectorWeights.find((s) => s.sector === sector)?.weight ?? 0;
}

/** Existing % weight of a held symbol, 0 when not held. Approximated as an
 * equal share of its sector when per-symbol weights aren't carried. */
function heldWeightOf(profile: InvestmentProfile, symbol: string): number {
  if (!profile.holdingSymbols.includes(symbol.toUpperCase())) return 0;
  if (profile.positionCount <= 0) return 0;
  // Uniform prior across positions — a conservative, monotonic proxy.
  return 100 / profile.positionCount;
}

/* -------------------------------------------------------------------------- */
/* Dimension 1 — Sector concentration / gap fill                               */
/* -------------------------------------------------------------------------- */

function scoreSector(asset: FitAssetData, profile: InvestmentProfile): FitDimension {
  const base = { label: "Sector", weight: W.sector };

  if (!profile.hasPortfolio) {
    return { ...base, score: 50, confidence: 0, impact: "neutral",
      message: "Build your portfolio to assess sector fit" };
  }

  const sector = asset.sector;
  // Unknown sector → we cannot assess concentration. Neutral, NO confidence.
  // (Old bug: this path returned 100, making unknown sectors the best diversifiers.)
  if (!sector) {
    return { ...base, score: 50, confidence: 0, impact: "neutral",
      message: "Sector unknown — cannot assess concentration impact" };
  }

  const cap = profile.constraints.maxSectorPct || 40;
  const w = sectorWeightOf(profile, sector);
  const u = w / cap; // 0 = no exposure, 1 = at cap

  // Continuous, monotonic: no exposure scores high (genuine diversification),
  // at/over cap scores low. Known data — full confidence.
  const score = clamp(100 - 65 * u);

  let message: string;
  if (w === 0) message = `Adds missing ${sector} exposure`;
  else if (u <= 0.5) message = `Strengthens underweight ${sector} (${w.toFixed(1)}% of ${cap}% cap)`;
  else if (u <= 1) message = `${sector} is already well-represented (${w.toFixed(1)}%)`;
  else message = `${sector} exceeds your ${cap}% sector cap (${w.toFixed(1)}%)`;

  return { ...base, score, confidence: 1, impact: impactOf(score, 1), message };
}

/* -------------------------------------------------------------------------- */
/* Dimension 2 — Correlation / overlap proxy                                   */
/* -------------------------------------------------------------------------- */

function scoreCorrelation(asset: FitAssetData, profile: InvestmentProfile): FitDimension {
  const base = { label: "Correlation", weight: W.correlation };

  if (!profile.hasPortfolio) {
    return { ...base, score: 50, confidence: 0, impact: "neutral",
      message: "No portfolio to measure overlap against" };
  }

  // Already held — overlap is certain regardless of sector data. Penalty scales
  // with how large the existing stake already is (continuous, not a flat cliff).
  const held = heldWeightOf(profile, asset.symbol);
  if (held > 0) {
    const score = clamp(62 - held * 1.8);
    return { ...base, score, confidence: 1, impact: impactOf(score, 1),
      message: `Already held (~${held.toFixed(1)}%) — adding raises single-name concentration` };
  }

  const sector = asset.sector;
  if (!sector) {
    return { ...base, score: 50, confidence: 0, impact: "neutral",
      message: "Sector unknown — cannot estimate correlation with holdings" };
  }

  // Same-sector weight is the dominant driver of realized correlation. Smooth,
  // monotonic decline — no top-3 membership cliff.
  const overlap = sectorWeightOf(profile, sector);
  const score = clamp(92 - overlap * 2.1);
  const message =
    overlap < 8 ? `Low overlap — ${sector} is a small part of your book (${overlap.toFixed(1)}%)`
    : overlap < 22 ? `Moderate overlap — correlated with your ${overlap.toFixed(1)}% ${sector} exposure`
    : `High overlap — ${sector} is already ${overlap.toFixed(1)}% of your portfolio`;

  return { ...base, score, confidence: 1, impact: impactOf(score, 1), message };
}

/* -------------------------------------------------------------------------- */
/* Dimension 3 — Objective alignment                                           */
/* -------------------------------------------------------------------------- */

function scoreObjective(asset: FitAssetData, objective: PortfolioObjective): FitDimension {
  const base = { label: "Objective", weight: W.objective };

  const growth = growthScore(asset);
  const value = valueScore(asset);
  const quality = qualityScoreOf(asset);
  const health = healthScoreOf(asset);
  const momentum = momentumScoreOf(asset);
  const dividend = asset.dividendYield;
  const beta = asset.beta;

  // Weighted blend that ignores absent factors and reports the share of weight
  // actually backed by data as the dimension confidence.
  const blend = (parts: Array<[number | null, number]>): { score: number; conf: number } => {
    let num = 0, den = 0, present = 0, total = 0;
    for (const [v, wt] of parts) {
      total += wt;
      if (v != null) { num += v * wt; den += wt; present += wt; }
    }
    if (den === 0) return { score: 50, conf: 0 };
    return { score: Math.round(num / den), conf: present / total };
  };

  // beta → defensiveness score (lower beta = more defensive). Only when known.
  const defensive = beta != null ? clamp(100 - (beta - 0.5) * 66) : null; // β0.5→100, β1→67, β1.5→34

  let res: { score: number; conf: number };
  let good: string, weak: string;

  switch (objective) {
    case "maximize_growth":
      res = blend([[growth, 0.5], [momentum, 0.3], [quality, 0.2]]);
      good = "Strong growth profile"; weak = "Moderate growth — consider higher-growth names";
      break;
    case "reduce_risk":
      res = blend([[health, 0.35], [quality, 0.3], [defensive, 0.35]]);
      good = "Defensive — solid financial health and low volatility";
      weak = "Higher risk than your reduce-risk objective prefers";
      break;
    case "increase_income": {
      // Income needs a real yield. Reward yield but taper the reach for very
      // high yields (often distress signals) rather than rewarding linearly.
      if (dividend == null) { res = { score: 50, conf: 0.15 }; }
      else {
        const y = clamp(dividend <= 4 ? dividend * 20 : 80 + (dividend - 4) * 4); // 2%→40, 4%→80, 8%→96
        res = { score: Math.round(y), conf: 1 };
      }
      good = dividend != null && dividend >= 2 ? `Yield ${dividend.toFixed(1)}% supports income`
        : "Limited income contribution";
      weak = dividend != null && dividend > 0 ? `Low yield ${dividend?.toFixed(1)}%` : "No dividend — conflicts with income objective";
      break;
    }
    case "beat_benchmark":
      res = blend([[growth, 0.35], [quality, 0.3], [momentum, 0.2], [value, 0.15]]);
      good = "High alpha potential — quality, growth and momentum";
      weak = "Below-average alpha potential vs benchmark";
      break;
    case "preserve_capital":
      res = blend([[health, 0.4], [quality, 0.35], [defensive, 0.25]]);
      good = "Capital-preservation profile — stable, low volatility";
      weak = "Higher risk than capital preservation warrants";
      break;
    case "improve_diversification":
      // Diversification alignment is carried by the sector + correlation dims;
      // keep this neutral and low-confidence so it doesn't double-count.
      res = { score: 60, conf: 0.25 };
      good = "Diversification scored via sector & correlation"; weak = good;
      break;
    case "ai_optimized":
    default:
      res = blend([[growth, 0.25], [quality, 0.25], [health, 0.2], [momentum, 0.15], [value, 0.15]]);
      good = "Well-rounded fundamentals"; weak = "Mixed fundamentals — review conviction before adding";
      break;
  }

  const score = clamp(res.score);
  return {
    ...base,
    score,
    confidence: res.conf,
    impact: impactOf(score, res.conf),
    message: res.conf < 0.4 ? "Insufficient fundamentals to judge objective alignment"
      : score >= 62 ? good : weak,
  };
}

/* -------------------------------------------------------------------------- */
/* Dimension 4 — Style balance                                                 */
/* -------------------------------------------------------------------------- */

function scoreStyle(asset: FitAssetData, profile: InvestmentProfile): FitDimension {
  const base = { label: "Style", weight: W.style };

  if (!profile.hasPortfolio || !hasFundamentals(asset)) {
    return { ...base, score: 50, confidence: 0, impact: "neutral",
      message: "Style analysis needs both a portfolio and asset fundamentals" };
  }

  const s = profile.styleWeights;
  const g = growthScore(asset) ?? 50;
  const v = valueScore(asset) ?? 50;
  const m = momentumScoreOf(asset) ?? 50;
  const q = qualityScoreOf(asset) ?? 50;

  let delta = 0;
  const messages: string[] = [];
  if (s.growth < 40 && g > 60) { delta += 22; messages.push("adds growth"); }
  if (s.value < 40 && v > 60) { delta += 18; messages.push("adds value"); }
  if (s.momentum < 40 && m > 60) { delta += 16; messages.push("adds momentum"); }
  if (s.quality < 40 && q > 60) { delta += 16; messages.push("adds quality"); }
  // Symmetric penalties for piling into an already-dominant tilt.
  if (s.growth > 70 && g > 70) { delta -= 20; }
  if (s.momentum > 70 && m > 70) { delta -= 16; }
  if (s.value > 70 && v > 70) { delta -= 12; }

  const score = clamp(50 + delta);
  return {
    ...base, score, confidence: 1, impact: impactOf(score, 1),
    message: messages.length ? `Fills style gaps: ${messages.join(", ")}`
      : delta < 0 ? "Concentrates an existing style tilt" : "Neutral style impact",
  };
}

/* -------------------------------------------------------------------------- */
/* Dimension 5 — Geographic diversification                                    */
/* -------------------------------------------------------------------------- */

function scoreGeographic(asset: FitAssetData, profile: InvestmentProfile): FitDimension {
  const base = { label: "Geography", weight: W.geographic };
  const geo = asset.geography;

  // We don't carry per-position geography, so we cannot measure the portfolio's
  // true geographic mix. Rather than assert a hardcoded "US-heavy" baseline at
  // full weight (old bug), we only contribute a low-confidence nudge when the
  // asset itself is explicitly non-US, and drop out otherwise.
  if (!profile.hasPortfolio || !geo) {
    return { ...base, score: 50, confidence: 0, impact: "neutral",
      message: "Geographic mix unknown" };
  }

  if (geo === "US") {
    return { ...base, score: 50, confidence: 0.2, impact: "neutral",
      message: "US equity — geographic impact depends on your existing mix" };
  }

  const labels: Record<string, string> = {
    IN: "India", JP: "Japan", HK: "Hong Kong", AU: "Australia", EU: "Europe", CRYPTO: "Crypto",
  };
  return { ...base, score: 70, confidence: 0.4, impact: "positive",
    message: `${labels[geo] ?? geo} exposure likely diversifies a US-centric book` };
}

/* -------------------------------------------------------------------------- */
/* Dimension 6 — Sizing feasibility                                            */
/* -------------------------------------------------------------------------- */

function scoreSizing(
  asset: FitAssetData,
  profile: InvestmentProfile,
  suggestedPct: number,
): FitDimension {
  const base = { label: "Sizing", weight: W.sizing };
  const c = profile.constraints;

  // Soft market-cap preference (hard exclusion handled by gates).
  if (c.marketCapFilter !== "any" && asset.marketCap != null) {
    const large = asset.marketCap >= 10e9;
    const mid = asset.marketCap >= 2e9 && asset.marketCap < 10e9;
    const small = asset.marketCap < 2e9;
    const mismatch =
      (c.marketCapFilter === "large" && !large) ||
      (c.marketCapFilter === "mid" && !mid) ||
      (c.marketCapFilter === "small" && !small);
    if (mismatch) {
      return { ...base, score: 30, confidence: 1, impact: "negative",
        message: `Market cap outside your ${c.marketCapFilter}-cap preference` };
    }
  }

  const headroom = c.maxPositionPct > 0 ? suggestedPct / c.maxPositionPct : 1;
  if (headroom >= 1) {
    return { ...base, score: 48, confidence: 1, impact: "neutral",
      message: `Would need capping at your ${c.maxPositionPct}% position limit` };
  }
  // Comfortable sizing scores well; sizing near the cap scores lower.
  const score = clamp(88 - headroom * 35);
  return { ...base, score, confidence: 1, impact: impactOf(score, 1),
    message: `${suggestedPct.toFixed(1)}% allocation fits comfortably within your limits` };
}

/* -------------------------------------------------------------------------- */
/* Suggested allocation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Base allocation, before the unified-action sizeFactor scales it.
 *
 * The formula, so every suggested weight is auditable:
 *
 *   base   = equalWeight(n+1) × conviction multiplier (0.7×–1.5×) × risk damp
 *   final  = min(base, maxPositionPct), rounded to 0.5pp
 *
 * where conviction is a renormalized blend of the Research Score (0.5), the
 * objective-alignment dimension (0.3) and the sector dimension (0.2) — the
 * allocation is driven by BOTH scores, not fit alone — and the risk damp
 * shrinks high-beta names by 1/√β (clamped to [0.75, 1.1]), so the same
 * conviction buys less of a more volatile asset.
 */
function computeSuggestedAllocation(
  profile: InvestmentProfile,
  conviction: number, // 0-1
  beta: number | null | undefined,
): { pct: number; amount: number } {
  const n = profile.positionCount;
  if (n === 0 || !profile.hasPortfolio) return { pct: 5, amount: 0 };

  const equalWeight = 100 / (n + 1);
  const multiplier = 0.7 + conviction * 0.8; // 0.7×..1.5× of equal weight
  const riskDamp = beta != null && beta > 0 ? Math.min(1.1, Math.max(0.75, 1 / Math.sqrt(beta))) : 1;
  const raw = equalWeight * multiplier * riskDamp;

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

function projectHHI(currentHHI: number, addedPct: number, alreadyHeld: boolean): number {
  if (alreadyHeld) {
    // Adding to an existing name concentrates rather than dilutes; nudge up.
    return Math.round(clamp(currentHHI + addedPct * addedPct * 0.5, 0, 10000));
  }
  const scale = (100 - addedPct) / 100;
  return Math.round(clamp(currentHHI * scale ** 2 + addedPct ** 2, 0, 10000));
}

/* -------------------------------------------------------------------------- */
/* Hard gates                                                                  */
/* -------------------------------------------------------------------------- */

function applyGates(
  asset: FitAssetData,
  profile: InvestmentProfile,
  composite: number,
): { score: number; reason: string | null } {
  const c = profile.constraints;
  const sym = asset.symbol.toUpperCase();
  let score = composite;
  let reason: string | null = null;
  const cap = (limit: number, why: string) => {
    if (score > limit) { score = limit; reason = why; }
  };

  if (c.excludedSymbols.includes(sym)) cap(12, `${asset.symbol} is on your excluded list`);

  if (profile.hasPortfolio && asset.sector && profile.overweightSectors.includes(asset.sector)) {
    cap(42, `${asset.sector} already exceeds your ${c.maxSectorPct}% sector cap`);
  }

  // Only gate on a KNOWN-absent dividend (real 0), never on unknown data.
  if (c.requireDividend && asset.dividendYield === 0) {
    cap(40, "No dividend — conflicts with your dividend requirement");
  }

  if (c.marketCapFilter !== "any" && asset.marketCap != null) {
    const large = asset.marketCap >= 10e9;
    const mid = asset.marketCap >= 2e9 && asset.marketCap < 10e9;
    const small = asset.marketCap < 2e9;
    const mismatch =
      (c.marketCapFilter === "large" && !large) ||
      (c.marketCapFilter === "mid" && !mid) ||
      (c.marketCapFilter === "small" && !small);
    if (mismatch) cap(45, `Outside your ${c.marketCapFilter}-cap requirement`);
  }

  return { score: Math.round(score), reason };
}

/* -------------------------------------------------------------------------- */
/* computePortfolioFit — main entry point                                      */
/* -------------------------------------------------------------------------- */

export function computePortfolioFit(
  asset: FitAssetData,
  profile: InvestmentProfile,
  config: FitScoringConfig = DEFAULT_FIT_CONFIG,
): PortfolioFitAnalysis {
  const isInPortfolio = profile.holdingSymbols.includes(asset.symbol.toUpperCase());
  const isOnWatchlist = asset.isOnWatchlist ?? false;
  const isGeneric = !profile.hasPortfolio;

  // ── Layer A input: the standalone Research Score (never recomputed here) ──
  const researchScore = resolveResearchScore(asset);

  // ── Layer B: Portfolio Context Engine — score the six dimensions ──────────
  const sectorDim = scoreSector(asset, profile);
  const correlationDim = scoreCorrelation(asset, profile);
  const objectiveDim = scoreObjective(asset, profile.objective);
  const styleDim = scoreStyle(asset, profile);
  const geographicDim = scoreGeographic(asset, profile);

  // Conviction for sizing is driven by BOTH layers: the Research Score anchors
  // it, the evidenced context dimensions refine it (renormalized when absent).
  const convParts: Array<[number, number]> = [];
  if (researchScore != null) convParts.push([researchScore, 0.5]);
  if ((objectiveDim.confidence ?? 1) >= 0.4) convParts.push([objectiveDim.score, 0.3]);
  if ((sectorDim.confidence ?? 1) >= 0.4) convParts.push([sectorDim.score, 0.2]);
  const conviction = convParts.length
    ? convParts.reduce((a, [s, w]) => a + s * w, 0) / convParts.reduce((a, [, w]) => a + w, 0) / 100
    : 0.5;

  const { pct: basePct } = computeSuggestedAllocation(profile, conviction, asset.beta);
  const sizingDim = scoreSizing(asset, profile, basePct);

  // ── Confidence-weighted portfolio-effects composite (renormalized) ────────
  const dims = [sectorDim, correlationDim, objectiveDim, styleDim, geographicDim, sizingDim];
  let num = 0, den = 0, nominal = 0;
  for (const d of dims) {
    const conf = d.confidence ?? 1;
    const ew = d.weight * conf;
    num += d.score * ew;
    den += ew;
    nominal += d.weight;
  }
  const evidenceFrac = nominal > 0 ? den / nominal : 0;

  // Overall confidence counts the research score as evidence at its blend
  // weight: an inherited 82/100 research composite is real data the fit now
  // rests on, and its absence should read as uncertainty.
  const rw = researchScore != null ? config.researchWeight : 0;
  const confidence = Math.round(
    (rw * 1 + (1 - config.researchWeight) * evidenceFrac) /
      (rw + (1 - config.researchWeight)) * 100,
  );

  // Shrinkage toward a neutral prior. With little evidence we should say
  // "neutral, we can't tell" (≈50) rather than emit a confident-looking score
  // off one or two dimensions. This is what stops data-poor assets from all
  // clustering in the "Good Fit" band — they now regress to Neutral and carry a
  // low-confidence flag, while data-rich assets keep their true, spread-out score.
  const rawComposite = den > 0 ? num / den : 50;
  const NEUTRAL_PRIOR = 50;
  const shrunk = evidenceFrac * rawComposite + (1 - evidenceFrac) * NEUTRAL_PRIOR;
  const rawEffectsScore = Math.round(shrunk);

  // ── Policy × Portfolio Health context (lib/ios/policy-fit.ts) ─────────────
  // The investor's CONFIRMED priorities × the alignment engine's health
  // verdicts × this asset — a bounded, signed shift on the effects composite
  // covering only what the six dimensions cannot see (growth-band structure,
  // drawdown stress, cash floor, income requirement). Zero when the policy is
  // unconfirmed, the book is healthy, or no honest asset connection exists.
  const policyCtx = assessPolicyFit(asset, profile, basePct);
  const effects = clamp(shrunk + policyCtx.adjustment);
  const portfolioEffectsScore = Math.round(effects);

  // ── Layer C: Portfolio Fit = Research Quality + Portfolio Effects ─────────
  const bridge: FitBridgeStep[] = [];
  const policyBridgeStep = (): FitBridgeStep => {
    const top = [...policyCtx.notes]
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 2)
      .map((n) => n.text);
    return {
      label: "Your policy & portfolio health",
      value: portfolioEffectsScore,
      detail: `${policyCtx.adjustment > 0 ? "+" : ""}${policyCtx.adjustment} from your stated priorities against the book's current health: ${top.join("; ")}.`,
    };
  };
  let preGate: number;
  if (researchScore != null) {
    const blended = config.researchWeight * researchScore + (1 - config.researchWeight) * effects;
    const upliftCap = researchScore + config.maxDiversificationUplift;
    const dragFloor = researchScore - config.maxPortfolioDrag;
    preGate = Math.min(Math.max(blended, dragFloor), upliftCap);

    bridge.push({
      label: "Research quality",
      value: researchScore,
      detail: `Standalone research score ${researchScore}/100 (${scoreLabel(researchScore)}) — unchanged by your portfolio.`,
    });
    const topDims = dims
      .filter((d) => (d.confidence ?? 1) >= 0.5 && d.impact !== "neutral")
      .sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50))
      .slice(0, 3)
      .map((d) => `${d.label} ${d.impact === "positive" ? "+" : "−"} (${Math.round(d.score)})`);
    bridge.push({
      label: "Portfolio effects",
      value: rawEffectsScore,
      detail: topDims.length
        ? `Context dimensions blend to ${rawEffectsScore}/100: ${topDims.join(", ")}.`
        : `Context dimensions blend to ${rawEffectsScore}/100 on the evidence available.`,
    });
    if (policyCtx.adjustment !== 0) bridge.push(policyBridgeStep());
    if (blended > upliftCap) {
      bridge.push({
        label: "Quality guardrail",
        value: Math.round(preGate),
        detail: `Fit capped at research +${config.maxDiversificationUplift} — diversification benefit cannot rescue a weak asset.`,
      });
    } else if (blended < dragFloor) {
      bridge.push({
        label: "Quality guardrail",
        value: Math.round(preGate),
        detail: `Fit floored at research −${config.maxPortfolioDrag} — only a hard constraint may penalize strong research further.`,
      });
    }
  } else {
    preGate = effects;
    bridge.push({
      label: "Research quality",
      value: null,
      detail: "No research score available — fit rests on portfolio context alone, at reduced confidence.",
    });
    bridge.push({
      label: "Portfolio effects",
      value: rawEffectsScore,
      detail: `Context dimensions blend to ${rawEffectsScore}/100 on the evidence available.`,
    });
    if (policyCtx.adjustment !== 0) bridge.push(policyBridgeStep());
  }

  // ── Hard gates ────────────────────────────────────────────────────────────
  const { score: fitScore, reason: capReason } = applyGates(asset, profile, preGate);
  if (capReason) {
    bridge.push({ label: "Constraint gate", value: fitScore, detail: capReason });
  }
  bridge.push({
    label: "Portfolio fit",
    value: clamp(fitScore),
    detail: `${clamp(fitScore)}/100 (${fitTier(fitScore)}) for this portfolio.`,
  });

  // ── Layer D/E: one action + one allocation from BOTH scores ──────────────
  const action = deriveUnifiedAction({ researchScore, fitScore: clamp(fitScore), isInPortfolio, capReason });
  const finalPct = Math.round(basePct * action.sizeFactor * 2) / 2;
  const finalAmount = Math.round((profile.totalValue * finalPct) / 100);
  if (!isGeneric) {
    bridge.push({
      label: "Suggested allocation",
      value: null,
      detail: finalPct > 0
        ? `${finalPct.toFixed(1)}% (base ${basePct.toFixed(1)}% × ${action.sizeFactor.toFixed(2)} conviction factor). ${action.reason}`
        : action.reason,
    });
  }

  // ── Reasons / trade-offs — only cite evidenced dimensions ─────────────────
  // Policy notes join the pools: positives after the concrete dimension
  // reasons (the biggest measured effect keeps the headline), negatives FIRST
  // among trade-offs — a conflict with the investor's own stated policy
  // outranks a generic dimension message.
  const evidenced = dims.filter((d) => (d.confidence ?? 1) >= 0.5);
  const reasons = [
    ...evidenced
      .filter((d) => d.impact === "positive")
      .sort((a, b) => b.score - a.score)
      .map((d) => d.message),
    ...policyCtx.notes.filter((n) => n.delta > 0).map((n) => n.text),
  ].slice(0, 3);
  const tradeoffs = [
    ...policyCtx.notes.filter((n) => n.delta < 0).map((n) => n.text),
    ...evidenced
      .filter((d) => d.impact === "negative")
      .sort((a, b) => a.score - b.score)
      .map((d) => d.message),
  ].slice(0, 3);
  if (capReason && !tradeoffs.includes(capReason)) tradeoffs.unshift(capReason);

  // ── Concentration projection ──────────────────────────────────────────────
  const projectedHHI = profile.hasPortfolio
    ? projectHHI(profile.hhi, finalPct, isInPortfolio)
    : 0;
  const concentrationWarning =
    projectedHHI > 2500 || finalPct > profile.constraints.maxPositionPct * 0.8;

  return {
    symbol: asset.symbol,
    fitScore: clamp(fitScore),
    fitTier: fitTier(fitScore),
    researchScore,
    portfolioEffectsScore,
    action,
    bridge,
    confidence,
    capReason,
    dimensions: {
      sector: sectorDim,
      correlation: correlationDim,
      objective: objectiveDim,
      style: styleDim,
      geographic: geographicDim,
      sizing: sizingDim,
    },
    reasons: isGeneric
      ? ["Build your portfolio to get personalized fit analysis"]
      : reasons.length ? reasons : ["Neutral portfolio impact on the evidence available"],
    tradeoffs: isGeneric ? [] : tradeoffs.slice(0, 3),
    policyInsight: isGeneric ? null : policyCtx.insight,
    policyAdjustment: policyCtx.adjustment,
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

/** The default blend weight on the fit score inside `combinedScore`. Exported
 *  so the surfaces that *explain* a combined score state the real formula
 *  instead of re-declaring the constant (lib/home/explain.ts). */
export const DEFAULT_FIT_WEIGHT = 0.4;

export function rankByFit(
  items: Array<FitAssetData & { absoluteScore: number }>,
  profile: InvestmentProfile,
  fitWeight = DEFAULT_FIT_WEIGHT,
): ContextualRanking[] {
  const ranked = items
    .map((item) => {
      const fit = computePortfolioFit(item, profile);
      const combined = Math.round(
        item.absoluteScore * (1 - fitWeight) + fit.fitScore * fitWeight,
      );
      return { item, fit, combined };
    })
    .sort((a, b) => b.combined - a.combined);

  // Reason strings must be row-specific within a ranked batch. `reasons[0]` is
  // often the same sizing/objective clause for every candidate ("8.0%
  // allocation fits comfortably within your limits" × 5 rows carries no
  // information), so each row takes its highest-ranked reason that no
  // higher-ranked row already claimed; when the pool is exhausted, the shared
  // clause is kept and the row's own fit number is appended so the string
  // still distinguishes it. `fitDetail` is the next distinct driver, for
  // surfaces that render the same symbol twice and must not repeat themselves.
  const used = new Set<string>();
  return ranked.map(({ item, fit, combined }) => {
    const pool = fit.reasons.length
      ? fit.reasons
      : [fit.isGeneric ? "Build portfolio for personalized ranking" : "Neutral portfolio fit"];

    let summary = pool[0];
    let detail: string | null = null;
    if (!fit.isGeneric) {
      // A "build your portfolio" notice is a shared CTA, not a per-row driver,
      // so only personalized reasons go through the uniquifier. The ladder:
      // an unclaimed reason, then a reason qualified by the row's own numbers,
      // then — for genuinely identical inputs — the symbol itself, which is
      // unique per batch by construction.
      const candidates = [
        ...pool,
        ...pool.map((s) => `${s}, fit ${fit.fitScore}/100`),
        ...pool.map((s) => `${s}, fit ${fit.fitScore}/100 on quality ${item.absoluteScore}`),
      ];
      summary = candidates.find((s) => !used.has(s)) ?? `${pool[0]} (${item.symbol})`;
      detail = pool.find((s) => s !== summary && !used.has(s)) ?? null;
      used.add(summary);
      if (detail) used.add(detail);
    }

    return {
      symbol: item.symbol,
      absoluteScore: item.absoluteScore,
      fitScore: fit.fitScore,
      fitTier: fit.fitTier,
      combinedScore: combined,
      fitSummary: summary,
      fitDetail: detail,
    } satisfies ContextualRanking;
  });
}
