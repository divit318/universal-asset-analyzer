/**
 * Market sentiment gauge — a UAA proxy, not CNN's Fear & Greed Index.
 *
 * CNN's index has no free API. Reproducing its name and its 0-100 scale from
 * different inputs and presenting it as the same number would be exactly the
 * kind of fabricated capability this project forbids. So: we build our own
 * gauge from three inputs we *already* fetch for the Scanner, we show the
 * user which components produced the score, and every surface that renders it
 * labels it as ours.
 *
 * The three components, and why each one is a defensible sentiment input:
 *
 *   - **Volatility (VIX level).** The market's own price for insurance. A VIX
 *     of 12 is complacency; 35 is fear. Weighted highest because it is the one
 *     input that is *forward-looking* rather than a reading of what already
 *     happened.
 *   - **Breadth.** The share of sectors advancing. A rally carried by one
 *     sector is a narrower, more fragile thing than a rally carried by nine,
 *     and breadth is what tells them apart.
 *   - **Momentum.** The S&P's own move. The most obvious input and the least
 *     informative on its own, so it carries the smallest weight.
 *
 * Missing inputs are *dropped and the weights renormalized* over what's left,
 * rather than defaulting to a neutral 50. Substituting 50 for "unknown" would
 * quietly drag every score toward the middle and make a 1-of-3 gauge look as
 * confident as a 3-of-3 one; instead we renormalize and report reduced
 * `confidence`. If nothing is available, the gauge is null — there is no score
 * to show, and we say so.
 *
 * Pure — no I/O. Unit-tested in tests/home-sentiment.test.ts.
 */

import type { SentimentGauge } from "./contracts";

export interface SentimentInputs {
  /** VIX index *level* (not a % change). */
  vixLevel: number | null;
  /** Percentage of sectors advancing, 0-100. */
  breadthPct: number | null;
  /** S&P 500 change, in percent. */
  sp500ChangePct: number | null;
}

const WEIGHTS = { volatility: 0.5, breadth: 0.3, momentum: 0.2 } as const;

/** Map a raw reading onto a 0-100 greed scale (0 = maximum fear). */
function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * VIX → greed. Inverted: high volatility is fear.
 *
 * Anchors chosen from where the VIX actually spends its time rather than from
 * its theoretical range: ≤12 is the complacent end of the post-2010 regime and
 * scores 100; ≥35 is a genuine panic and scores 0; the long-run median of ~19
 * lands close to neutral. Linear between the anchors.
 */
export function scoreVolatility(vixLevel: number): number {
  const LOW = 12;
  const HIGH = 35;
  const pct = (vixLevel - LOW) / (HIGH - LOW);
  return clamp01to100(100 - pct * 100);
}

/** Breadth is already a 0-100 "share advancing", which is already a greed scale. */
export function scoreBreadth(breadthPct: number): number {
  return clamp01to100(breadthPct);
}

/**
 * S&P move → greed. A ±2% day is a big day; anything beyond that saturates.
 * 0% maps to neutral 50.
 */
export function scoreMomentum(changePct: number): number {
  const SATURATE = 2;
  return clamp01to100(50 + (changePct / SATURATE) * 50);
}

function labelFor(score: number): SentimentGauge["label"] {
  if (score < 25) return "Extreme Fear";
  if (score < 45) return "Fear";
  if (score <= 55) return "Neutral";
  if (score <= 75) return "Greed";
  return "Extreme Greed";
}

/**
 * Builds the gauge, or returns null when not one component has data — a gauge
 * with no inputs is not a neutral reading, it's an absent one.
 */
export function computeSentiment(inputs: SentimentInputs): SentimentGauge | null {
  const parts: { name: string; value: number | null; score: number | null; weight: number }[] = [
    { name: "Volatility (VIX)", value: inputs.vixLevel, score: inputs.vixLevel != null ? scoreVolatility(inputs.vixLevel) : null, weight: WEIGHTS.volatility },
    { name: "Market breadth", value: inputs.breadthPct, score: inputs.breadthPct != null ? scoreBreadth(inputs.breadthPct) : null, weight: WEIGHTS.breadth },
    { name: "S&P 500 momentum", value: inputs.sp500ChangePct, score: inputs.sp500ChangePct != null ? scoreMomentum(inputs.sp500ChangePct) : null, weight: WEIGHTS.momentum },
  ];

  const present = parts.filter((p) => p.score != null);
  if (present.length === 0) return null;

  // Renormalize over the components we actually have (see the header note on
  // why the missing ones are not silently treated as 50).
  const totalWeight = present.reduce((sum, p) => sum + p.weight, 0);
  const score = Math.round(
    present.reduce((sum, p) => sum + (p.score as number) * (p.weight / totalWeight), 0),
  );

  const confidence: SentimentGauge["confidence"] =
    present.length === 3 ? "high" : present.length === 2 ? "medium" : "low";

  return {
    score,
    label: labelFor(score),
    confidence,
    components: parts.map((p) => ({
      name: p.name,
      value: p.value,
      // Contribution is 0 for a missing component, which is honest: it
      // contributed nothing, and the remaining weights absorbed its share.
      contribution: p.score != null ? Math.round((p.score * (p.weight / totalWeight))) : 0,
    })),
  };
}
