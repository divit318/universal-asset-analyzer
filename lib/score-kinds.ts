/**
 * Every 0-100 score in UAA, named by the QUESTION it answers.
 *
 * ## The problem this solves
 *
 * The app computes several different 0-100 numbers about an asset, each from a
 * purpose-built engine, and each genuinely correct for its own question. But they
 * were all rendered as an unqualified score — often as "Overall", "Score", or a
 * bare `NN/100` — so two of them appearing on adjacent pages looked like the
 * product contradicting itself:
 *
 *   - AAPL read 57 ("Hold, High risk") on /research and 76 on /portfolio.
 *     Both true: it is an excellent business (76 on the fundamentals its asset
 *     class can measure) trading at a price that makes the all-in call a Hold
 *     (57, which also weighs valuation, analysts, momentum and sector).
 *   - Watchlist showed "Fit 73", DCF showed "Portfolio Fit 57/100", Screener
 *     showed "Rank 97" beside "Overall 83".
 *
 * A user cannot reconcile those without being told what each one measures. The
 * fix is not to collapse them into one number — that would destroy real
 * information — but to make every one of them state its own question, and to
 * make the distinction visible at the point of confusion.
 *
 * A separate class of divergence WAS a bug and was fixed rather than labelled:
 * /compare and /research both call `computeScore` from lib/scoring.ts, but
 * /compare omitted the opt-in `sectorRotation` argument, so NVDA scored 86 there
 * and 80 on Research. Same engine plus different inputs is not a difference worth
 * explaining; it is a difference worth removing.
 *
 * Pure and client-safe — no imports beyond types.
 */

export type ScoreKindId = "conviction" | "screen" | "quality" | "fit" | "quant" | "health";

export interface ScoreKindSpec {
  id: ScoreKindId;
  /** Short label rendered beside the number. Never just "Score". */
  label: string;
  /** The question it answers, in the user's language. Shown in the explainer. */
  question: string;
  /** Which engine produces it — so a reader can tell two numbers apart. */
  engine: string;
  /** What moves it. One sentence. */
  inputs: string;
  /**
   * Whether the canonical Buy/Hold/Sell bands (lib/recommendation.ts) apply.
   *
   * False for `fit`, `quality`, and `health`: none of those is a directional
   * call. Colouring a portfolio-fit of 45 as "Sell" would assert something the
   * number does not mean.
   */
  banded: boolean;
}

export const SCORE_KINDS: Record<ScoreKindId, ScoreKindSpec> = {
  conviction: {
    id: "conviction",
    label: "Conviction",
    question: "Is this worth owning at today's price?",
    engine: "Decision engine (lib/scoring.ts)",
    inputs:
      "Fundamentals 45%, analyst consensus 25%, price momentum 15%, capital allocation 7%, sector rotation 8% — reweighted toward fundamentals for Indian listings, and renormalized when a signal is unavailable.",
    banded: true,
  },

  screen: {
    id: "screen",
    label: "Screen score",
    question: "How does this rank against the rest of the screened universe?",
    engine: "Batch dimensional scorer (lib/composite.ts)",
    inputs:
      "Quality 28%, value 24%, growth 24%, financial health 18%, momentum 6%, with sector-aware thresholds so a utility is not judged on a technology company's margins.",
    banded: true,
  },

  quality: {
    id: "quality",
    label: "Quality",
    question: "How good is the underlying asset, setting price aside?",
    engine: "Asset-class adapter (lib/portfolio/classes/*)",
    inputs:
      "Whatever the holding's own asset class can actually measure — return on equity and margins for an equity, cost and credit quality for a bond. Never a fabricated midpoint: an unscoreable holding reads 'no basis'.",
    banded: false,
  },

  fit: {
    id: "fit",
    label: "Portfolio fit",
    question: "Does this belong in YOUR book?",
    engine: "Investment policy engine (lib/ios)",
    inputs:
      "Your existing sector weights, concentration limits, cash position and stated objective. It says nothing about whether the asset is good — only whether it suits the portfolio you already hold.",
    banded: false,
  },

  quant: {
    id: "quant",
    label: "Quant signal",
    question: "What does the systematic factor model say?",
    engine: "Python quant engine (engine/daily_run.py)",
    inputs:
      "Momentum, quality, value, low-volatility, revision, regime and forecast z-scores, weighted by each factor's own rolling information coefficient rather than by hand.",
    banded: true,
  },

  health: {
    id: "health",
    label: "Portfolio health",
    question: "How sound is the book as a whole?",
    engine: "Health engine (lib/portfolio/engines/health.ts)",
    inputs:
      "Diversification, liquidity, income, risk and cost dimensions, each weighted by how much of the portfolio it could actually be measured on. Dimensions with no basis abstain instead of scoring 50.",
    banded: false,
  },
};

export function scoreKind(id: ScoreKindId): ScoreKindSpec {
  return SCORE_KINDS[id];
}

/**
 * One-line disambiguation between two scores a user is seeing together.
 *
 * Used where two kinds genuinely appear side by side (Research shows Conviction
 * and Portfolio fit; Portfolio Holdings shows Quality next to a Conviction link),
 * so the difference is explained in place rather than left to be inferred.
 */
export function distinguish(a: ScoreKindId, b: ScoreKindId): string {
  const first = SCORE_KINDS[a];
  const second = SCORE_KINDS[b];
  return `${first.label} answers "${first.question}" ${second.label} answers "${second.question}" They are different questions, so they can disagree.`;
}
