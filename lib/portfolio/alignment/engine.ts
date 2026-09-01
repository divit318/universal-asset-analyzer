/**
 * Portfolio Alignment — how well the book matches what ITS OWNER said they want.
 *
 * ── What this replaces, and why ───────────────────────────────────────────────
 *
 * The Portfolio Health engine scored every investor against twelve universally-
 * weighted dimensions. Its arithmetic was careful (abstention, coverage
 * discounting, no floor collisions) but its premise was wrong in three ways:
 *
 *  1. UNIVERSAL WEIGHTS. "Income 8%, Inflation 8%, Geography 6%" asserts one
 *     definition of a healthy portfolio. A total-return investor lost points for
 *     a low yield; a US household lost points for holding USD. Alignment weights
 *     come from the investor's own stated priorities (./policy.ts); a theme the
 *     investor turned off is reported as a FACT and charged to nobody.
 *
 *  2. DOUBLE COUNTING. Diversification, Concentration, Correlation, Geographic
 *     and Currency Diversification were five dimensions measuring overlapping
 *     slices of the same risk — NVDA + QQQM + VOO was penalized five times for
 *     being one bet. The twelve dimensions are consolidated into seven themes
 *     with disjoint denominators (see the theme map below); co-movement is
 *     handled INSIDE concentration as correlation clusters ("these names are one
 *     bet"), not as a sixth parallel score.
 *
 *  3. COVERAGE AS WEIGHT. Discounting a thin-evidence dimension's weight hides
 *     missing data inside a precise-looking total. Here a theme that cannot be
 *     measured says "insufficient evidence" and is EXCLUDED BY NAME (dataGaps);
 *     evidence share is disclosed per theme, never blended into the arithmetic.
 *
 * ── The theme map (old dimension → new home) ──────────────────────────────────
 *
 *   structure      ← Asset Allocation (reframed: mix vs the investor's GOAL,
 *                    not "more classes is better")
 *   resilience     ← Expected Drawdown + the risk-bearing half of Cash
 *   concentration  ← Concentration + Diversification + Correlation (one theme,
 *                    one denominator: single names and correlated clusters vs
 *                    the investor's own position cap)
 *   liquidity      ← Liquidity + Cash Management (access to money vs stated need)
 *   income         ← Income (CONDITIONAL: scored only when the investor needs it)
 *   inflation      ← Inflation Protection (CONDITIONAL)
 *   exposure       ← Geographic + Currency Diversification (CONDITIONAL — home
 *                    bias is a deliberate choice unless the investor says otherwise)
 *   (removed)      ← Holding Quality. A good company is not automatically a good
 *                    position, and instrument-level quality already drives the
 *                    Decisions engine and the Holdings tab. Folding it into a
 *                    portfolio-construction score conflated two judgments; the
 *                    weakest-holdings FACT survives on those surfaces.
 *
 * ── The ruler (one shape for every check) ─────────────────────────────────────
 *
 * Every check compares a measured value to the investor's own limit, on one
 * documented curve (`toleranceScore`): 100 while comfortably inside, easing to
 * 75 at the limit, then falling by 55 points per 100% relative breach — so "at
 * your limit" reads 75 and "double your limit" reads 20, whatever the units.
 * Statuses come from the breach in REAL units (pp over cap, pp of shortfall),
 * with the trade-policy hysteresis band so live jitter cannot flip a verdict.
 *
 * The total is Σ(theme score × priority share), shares renormalized over the
 * themes that could actually be measured. Meaning: "of the things you told us
 * matter, weighted how you weighted them, this is how closely the book complies."
 * It is NOT a quality grade, and there are deliberately no letter grades.
 *
 * Deterministic and pure — no AI anywhere in this file. AI interprets and
 * challenges the result (see the panel's challenge action); it never produces it.
 */

import { CONCENTRATION_HYSTERESIS_PCT } from "../policy";
import { runAllScenarios } from "../engines/scenario";
import { correlationClusters, HIGH_CORRELATION_R } from "./cluster";
import {
  ALIGNMENT_THEMES,
  effectiveCapPct,
  priorityShares,
  type AlignmentThemeId,
  type InvestorPolicy,
  type PriorityLevel,
} from "./policy";
import type { Holding, PortfolioAssetClass } from "../model/types";
import type { PortfolioAllocation } from "../engines/allocation";
import type { UniversalRisk } from "../engines/risk";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type AlignmentStatus = "aligned" | "tension" | "mismatch";

export interface AlignmentFact {
  label: string;
  value: string;
  /** Symbols/names driving the fact, largest first, when nameable. */
  holdings?: string[];
}

export interface AlignmentMismatch {
  themeId: AlignmentThemeId;
  themeLabel: string;
  /** Relative severity in [0,1] — breach ÷ tolerance, capped. Orders the list. */
  severity: number;
  /** One sentence: what is out of line, in real units. */
  summary: string;
  /** The investor's own setting ("≤ 15%"). */
  stated: string;
  /** What the book measures ("26.2%"). */
  actual: string;
  /** The gap ("+11.2pp"). */
  excess: string;
  holdings: string[];
}

export interface AlignmentTheme {
  id: AlignmentThemeId;
  label: string;
  /** The question this theme answers, in the investor's terms. */
  question: string;
  /** The stated priority (0 = fact only). */
  priority: PriorityLevel;
  /** Share of the total score this theme carried. 0 when unscored. */
  weightShare: number;
  /** null = unrated (opted out or insufficient evidence). */
  score: number | null;
  /** Unrounded — every before/after comparison must difference THIS. */
  scoreExact: number | null;
  status: AlignmentStatus | null;
  unratedReason: "opted_out" | "insufficient_data" | null;
  /** What the book measures, in real units. Always stated, even when unrated. */
  finding: string;
  /** The ruler: the investor's setting and how the score responds to it. */
  basis: string;
  /** % of portfolio value the theme's facts could actually see. Disclosure only. */
  evidencePct: number;
  facts: AlignmentFact[];
  mismatch: AlignmentMismatch | null;
  /**
   * The theme's key measurements in REAL UNITS, machine-readable — the same
   * numbers the finding/facts strings phrase, emitted once here so downstream
   * consumers (the Research fit's policy context, lib/ios/policy-fit.ts) can
   * reason about direction and magnitude without parsing display strings or
   * recomputing anything. Keys are per-theme (documented at each theme);
   * null when the theme abstained before measuring.
   */
  metrics: Record<string, number> | null;
}

export interface AlignmentReport {
  /** null = not scorable (all themes off, or too little evidence). */
  score: number | null;
  scoreExact: number | null;
  /** "Strongly aligned" … "Misaligned"; null when unscored. THE VERDICT — the number supports it, not the reverse. */
  label: string | null;
  status: "scored" | "insufficient" | "empty";
  /** Whether the policy was actually set by the investor (vs assumed defaults). */
  confirmed: boolean;
  themes: AlignmentTheme[];
  /** Every mismatch across themes, most severe first. */
  mismatches: AlignmentMismatch[];
  /** Themes that could not be measured, by label — named, never hidden. */
  dataGaps: string[];
  summary: string;
  /** Value-weighted evidence across scored themes. Disclosure, never a weight. */
  evidencePct: number;
  /**
   * "Aligned with your policy — and objectively …" facts. Alignment measures
   * fit with the STATED policy; these keep the underlying magnitudes visible
   * when the policy accepts something large (a 60% tolerance absorbing a 50%
   * stress, a blessed 30% single name). Accepting risk never costs points —
   * and the risk itself is never hidden behind the acceptance. Deterministic.
   */
  objectiveNotes: string[];
  /**
   * Internal contradictions in the POLICY itself ("no book inside your own
   * growth band can stress under your drawdown tolerance"). Warnings only —
   * a conflict never changes the score, because silently resolving it would
   * mean overriding one of the investor's own statements.
   */
  policyConflicts: string[];
}

/* -------------------------------------------------------------------------- */
/* The shared ruler                                                            */
/* -------------------------------------------------------------------------- */

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/**
 * The beyond-the-limit decay, shared by every check: linear 75 → 20 across the
 * first 100% of relative breach, then an exponential tail (20 · e^−(b−1))
 * toward — but never reaching — zero.
 *
 * The tail is load-bearing, not cosmetic. A hard clamp at 0 creates a DEAD
 * ZONE: a book 2.5× over its cap and the same book trimmed to 2.2× over both
 * read exactly 0, so the delta engines (position sizing, cash allocation,
 * decision ranking) measure the trim as worthless — which is precisely
 * backwards. The exponential keeps a gradient everywhere, so every step
 * toward compliance registers, while "double your limit ≈ 20" stays true.
 */
function breachScore(breach: number): number {
  return breach <= 1 ? 75 - 55 * breach : 20 * Math.exp(-(breach - 1));
}

/**
 * Score a value against the investor's own limit. One curve for every check:
 *
 *   comfortably inside (≤ 90% of limit) → 100
 *   approaching the limit               → eases 100 → 75
 *   at the limit                        → 75
 *   beyond                              → breachScore: 75 − 55 × breach,
 *                                         with an exponential tail past 2×
 *
 * So "at your limit" is 75 (fine — it is YOUR limit), and "double your limit"
 * is 20, in every theme and every unit. Continuous with a nonzero gradient
 * everywhere, which is what lets the delta engines difference two books
 * without quantization cliffs or saturation dead zones. `invert` flips the
 * comparison for floors ("at least X").
 */
export function toleranceScore(value: number, limit: number, invert = false): number {
  if (limit <= 0) return invert ? (value >= 0 ? 100 : 0) : 100;
  const ratio = value / limit;
  const inside = invert ? ratio >= 1 : ratio <= 1;
  if (inside) {
    const headroom = invert ? ratio - 1 : 1 - ratio;
    return headroom >= 0.1 ? 100 : 75 + (headroom / 0.1) * 25;
  }
  const breach = invert ? 1 - ratio : ratio - 1;
  return clamp(breachScore(breach));
}

/** Severity of a breach relative to the limit, for ordering mismatches. */
const severityOf = (value: number, limit: number) =>
  limit > 0 ? Math.min(1, Math.max(0, (value - limit) / limit)) : 0;

const ALIGNED = "aligned" as const;
const TENSION = "tension" as const;
const MISMATCH = "mismatch" as const;

/**
 * The score → label bands. Exported because surfaces that project a SIMULATED
 * score (decision cards, trade confirmations) need the same words for the same
 * numbers. Deliberately alignment language, not quality grades: 62 does not
 * mean the portfolio is mediocre, it means the book and the stated policy
 * disagree in places.
 */
export function alignmentLabelOf(score: number): string {
  if (score >= 85) return "Strongly aligned";
  if (score >= 70) return "Well aligned";
  if (score >= 55) return "Mixed";
  if (score >= 40) return "Strained";
  return "Misaligned";
}

/* -------------------------------------------------------------------------- */
/* Theme scaffolding                                                           */
/* -------------------------------------------------------------------------- */

const THEME_LABEL: Record<AlignmentThemeId, string> = {
  structure: "Structure",
  resilience: "Downside",
  concentration: "Concentration",
  liquidity: "Liquidity",
  income: "Income",
  inflation: "Inflation",
  exposure: "Geography & currency",
};

const THEME_QUESTION: Record<AlignmentThemeId, string> = {
  structure: "Does the asset mix match what you're optimizing for?",
  resilience: "Is the plausible worst loss within what you said you can sit through?",
  concentration: "Is any single bet — one name or one correlated cluster — bigger than you allow?",
  liquidity: "Can you reach the money you said you might need?",
  income: "Does the book pay you what you said you need?",
  inflation: "Would an inflation surprise hurt more than you're willing to accept?",
  exposure: "Is the book as geographically spread as you asked for?",
};

interface ThemeSeed {
  score: number | null;
  status: AlignmentStatus | null;
  unratedReason: AlignmentTheme["unratedReason"];
  finding: string;
  basis: string;
  evidencePct: number;
  facts: AlignmentFact[];
  mismatch: Omit<AlignmentMismatch, "themeId" | "themeLabel"> | null;
  /** "Aligned with your policy — and objectively …" — collected onto the report. */
  objectiveNote?: string | null;
  /** See AlignmentTheme.metrics. Omitted = null (theme abstained before measuring). */
  metrics?: Record<string, number>;
}

function seedToTheme(id: AlignmentThemeId, priority: PriorityLevel, s: ThemeSeed): AlignmentTheme {
  const exact = s.score != null ? clamp(s.score) : null;
  return {
    id,
    label: THEME_LABEL[id],
    question: THEME_QUESTION[id],
    priority,
    weightShare: 0,
    score: exact != null ? Math.round(exact) : null,
    scoreExact: exact,
    status: s.status,
    unratedReason: s.unratedReason,
    finding: s.finding,
    basis: s.basis,
    evidencePct: Math.round(clamp(s.evidencePct)),
    facts: s.facts,
    mismatch: s.mismatch ? { ...s.mismatch, themeId: id, themeLabel: THEME_LABEL[id] } : null,
    metrics: s.metrics ?? null,
  };
}

/** A theme the investor opted out of: the fact is stated, nothing is judged. */
function factOnly(finding: string, facts: AlignmentFact[] = []): ThemeSeed {
  return {
    score: null,
    status: null,
    unratedReason: "opted_out",
    finding,
    basis: "Not part of your stated priorities — shown as a fact, carries no weight.",
    evidencePct: 100,
    facts,
    mismatch: null,
  };
}

function insufficient(finding: string, evidencePct: number): ThemeSeed {
  return {
    score: null,
    status: null,
    unratedReason: "insufficient_data",
    finding,
    basis: "Cannot be measured honestly on the available data, so it is excluded from the score rather than guessed.",
    evidencePct,
    facts: [],
    mismatch: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Growth-engine classification (structure theme input)                        */
/* -------------------------------------------------------------------------- */

/**
 * Class floors for "how much of this holding is growth engine" — the share of
 * its value held for long-run appreciation rather than stability or income.
 * The holding's own factor loadings win where they say more (a bond ETF's
 * equityBeta ≈ 0 correctly zeroes it; a convertible's ≈ 0.5 counts half), so
 * these floors only catch classes whose appreciation isn't equity-beta shaped.
 */
const GROWTH_FLOOR: Partial<Record<PortfolioAssetClass, number>> = {
  equity: 0.85,
  crypto: 1,
  private_market: 0.9,
  reit: 0.5,
  real_estate: 0.45,
  alternative: 0.3,
  structured_product: 0.3,
  commodity: 0.1,
};

function growthiness(h: Holding): number {
  const beta = Math.max(h.factors.equityBeta ?? 0, h.factors.cryptoBeta ?? 0);
  return Math.min(1, Math.max(beta, GROWTH_FLOOR[h.assetClass] ?? 0));
}

/**
 * The growth-share band each goal implies, in % of the book. Wide on purpose —
 * these are structural sanity bands ("a growth mandate needs a growth engine"),
 * not an optimizer's target. A short horizon shifts the band down (less time to
 * recover), a long one allows more.
 */
const GOAL_GROWTH_BAND: Record<InvestorPolicy["goal"], [number, number]> = {
  growth: [60, 100],
  balanced: [35, 80],
  income: [15, 60],
  preservation: [5, 45],
};

const HORIZON_SHIFT: Record<InvestorPolicy["horizon"], number> = { short: -10, medium: 0, long: 5 };

/* -------------------------------------------------------------------------- */
/* Themes                                                                      */
/* -------------------------------------------------------------------------- */

/** The growth band a policy implies: the investor's explicit range when they set one, the goal+horizon derivation otherwise. */
export function growthBandFor(policy: InvestorPolicy): [number, number] {
  if (policy.tolerances.growthBandPct) return policy.tolerances.growthBandPct;
  const [lo0, hi0] = GOAL_GROWTH_BAND[policy.goal];
  const shift = HORIZON_SHIFT[policy.horizon];
  return [clamp(lo0 + shift), clamp(hi0 + shift)];
}

function structureTheme(holdings: Holding[], policy: InvestorPolicy): ThemeSeed {
  const growthPct = holdings.reduce((s, h) => s + h.weight * growthiness(h), 0);
  const explicitBand = policy.tolerances.growthBandPct != null;
  const [lo, hi] = growthBandFor(policy);

  const engines = holdings
    .filter((h) => growthiness(h) >= 0.5)
    .sort((a, b) => b.weight * growthiness(b) - a.weight * growthiness(a))
    .slice(0, 3)
    .map((h) => h.symbol ?? h.name);

  const below = growthPct < lo;
  const outsidePp = below ? lo - growthPct : Math.max(0, growthPct - hi);
  // Same shape as toleranceScore, with the band edge as the limit: eases
  // 100 → 75 across the outer 8% of the band, reads 75 at the edge, then falls
  // to 20 at 30pp outside (an exponential tail beyond, so a 50pp-outside book
  // still improves measurably as the mix moves) — 30pp outside a structural
  // band is a different portfolio, not a tilt.
  const edgeZone = (hi - lo) * 0.08;
  const distIn = below ? growthPct - lo : hi - growthPct; // negative when outside
  const finalScore =
    outsidePp > 0
      ? clamp(outsidePp <= 30 ? 75 - 55 * (outsidePp / 30) : 20 * Math.exp(-(outsidePp - 30) / 30))
      : Math.min(distIn, hi - lo) >= edgeZone
        ? 100
        : 75 + (Math.max(0, distIn) / edgeZone) * 25;

  const status = outsidePp === 0 ? ALIGNED : outsidePp <= 8 ? TENSION : MISMATCH;
  const bandSource = explicitBand ? "the band you set explicitly" : "the band your goal implies";
  const basis = explicitBand
    ? `You set an explicit ${lo.toFixed(0)}–${hi.toFixed(0)}% growth-engine band (equity-like exposure via each holding's factor loadings). Inside it = aligned; the score falls as the mix drifts outside it.`
    : `Your ${policy.goal === "growth" ? "growth" : policy.goal} goal over a ${policy.horizon} horizon implies a ${lo.toFixed(0)}–${hi.toFixed(0)}% growth-engine share (equity-like exposure via each holding's factor loadings). Inside the band = aligned; the score falls as the mix drifts outside it.`;
  const finding = below
    ? `${growthPct.toFixed(0)}% of the book is growth engine — ${outsidePp.toFixed(0)}pp below the ${lo.toFixed(0)}% floor of ${bandSource}. The mix is structurally more defensive than your stated objective.`
    : outsidePp > 0
      ? `${growthPct.toFixed(0)}% of the book is growth engine — ${outsidePp.toFixed(0)}pp above the ${hi.toFixed(0)}% edge of ${bandSource}. The mix runs hotter than the objective you stated.`
      : `${growthPct.toFixed(0)}% growth engine, inside the ${lo.toFixed(0)}–${hi.toFixed(0)}% band ${explicitBand ? "you set" : "your goal implies"}.`;

  return {
    score: finalScore,
    status,
    unratedReason: null,
    finding,
    basis,
    evidencePct: 100,
    metrics: { growthEnginePct: growthPct, bandLo: lo, bandHi: hi },
    facts: [
      { label: "Growth-engine share", value: `${growthPct.toFixed(1)}%`, holdings: engines },
      { label: explicitBand ? "Your explicit band" : "Band for your goal", value: `${lo.toFixed(0)}–${hi.toFixed(0)}%` },
    ],
    mismatch:
      status === MISMATCH
        ? {
            severity: Math.min(1, outsidePp / 30),
            summary: finding,
            stated: `${lo.toFixed(0)}–${hi.toFixed(0)}% growth engine`,
            actual: `${growthPct.toFixed(1)}%`,
            excess: `${below ? "−" : "+"}${outsidePp.toFixed(1)}pp`,
            holdings: engines,
          }
        : null,
  };
}

function resilienceTheme(
  holdings: Holding[],
  totalValue: number,
  risk: UniversalRisk,
  policy: InvestorPolicy,
): ThemeSeed {
  const tol = policy.tolerances.maxDrawdownPct;
  const observed = risk.maxDrawdown != null ? Math.abs(risk.maxDrawdown) : null;
  // Factor-model stress: the worst of the standard scenario set, which covers
  // every holding through its factor loadings (a private stake stresses like
  // levered equity instead of like a flat line). Observed history and modelled
  // stress answer the same question two ways; the BINDING estimate is the worse.
  const scenarios = runAllScenarios(holdings, totalValue);
  const worstScenario = scenarios.length > 0 ? scenarios[0] : null;
  const modelled = worstScenario ? Math.abs(Math.min(0, worstScenario.portfolioImpactPct)) : null;

  if (observed == null && modelled == null) {
    return insufficient("No price history and no factor exposures to stress — downside cannot be estimated.", 0);
  }

  const stress = Math.max(observed ?? 0, modelled ?? 0);
  const source =
    (modelled ?? 0) >= (observed ?? 0)
      ? `modelled: ${worstScenario!.name}`
      : `observed over the book's own history`;

  const score = toleranceScore(stress, tol);
  const excess = stress - tol;
  const status = excess <= 0 ? ALIGNED : excess <= tol * 0.15 ? TENSION : MISMATCH;
  const evidencePct = 100 - (risk.coverage?.unmodelledPct ?? 0);

  const cvar = risk.cvar95Pct != null ? ` Expected loss on a bad day (CVaR 95): ${risk.cvar95Pct.toFixed(1)}%.` : "";
  const finding =
    excess > 0
      ? `A plausible bad stretch costs ~${stress.toFixed(0)}% (${source}) — ${excess.toFixed(0)}pp beyond the ${tol}% you said you could sit through.${cvar}`
      : `Plausible worst loss ~${stress.toFixed(0)}% (${source}), within the ${tol}% you said you could sit through.${cvar}`;

  return {
    score,
    status,
    unratedReason: null,
    finding,
    basis: `Your stated tolerance is a ${tol}% drawdown. The book is stressed two ways — its own worst observed drawdown and the worst standard factor scenario — and judged on the worse of the two. At your limit the theme reads 75; it falls 55 points per 100% of breach.`,
    evidencePct,
    metrics: { stressPct: stress, tolerancePct: tol },
    facts: [
      { label: "Stress estimate", value: `−${stress.toFixed(1)}%` },
      ...(observed != null ? [{ label: "Worst observed drawdown", value: `−${observed.toFixed(1)}%` }] : []),
      ...(modelled != null ? [{ label: `Worst scenario (${worstScenario!.name})`, value: `${worstScenario!.portfolioImpactPct.toFixed(1)}%` }] : []),
      ...(risk.annualizedVolatility != null ? [{ label: "Annualized volatility", value: `${risk.annualizedVolatility.toFixed(1)}%` }] : []),
    ],
    mismatch:
      status === MISMATCH
        ? {
            severity: severityOf(stress, tol),
            summary: finding,
            stated: `≤ ${tol}% drawdown`,
            actual: `~${stress.toFixed(1)}%`,
            excess: `+${excess.toFixed(1)}pp`,
            holdings: [],
          }
        : null,
    // Alignment ≠ safety. A wide tolerance absorbing a deep stress is the
    // investor's stated choice and costs nothing — but the magnitude stays on
    // the record, or acceptance would quietly become concealment.
    objectiveNote:
      status !== MISMATCH && stress >= 35
        ? `Aligned with your ${tol}% tolerance — and objectively volatile: a plausible bad stretch still costs ~${stress.toFixed(0)}% (${source}). Fit with your policy is not the same as low risk.`
        : null,
  };
}

function concentrationTheme(holdings: Holding[], risk: UniversalRisk, policy: InvestorPolicy): ThemeSeed {
  const cap = policy.tolerances.maxPositionPct;

  // EVERY position is judged against ITS OWN effective cap — the general cap,
  // or the investor's named exception for that symbol. An exception blesses
  // one deliberate position without loosening the rule for everything else;
  // the binding position is whichever sits worst against its own limit, which
  // is not necessarily the largest one (a 25% excepted-to-30% QQQM is aligned
  // while an 11% name under a 10% cap is the breach).
  const judged = holdings
    .filter((h) => h.weight > 0)
    .map((h) => {
      const name = h.symbol ?? h.name;
      const effCap = effectiveCapPct(policy, h.symbol);
      const exception = policy.exceptions.find((e) => h.symbol && e.symbol === h.symbol.toUpperCase()) ?? null;
      return { name, weight: h.weight, effCap, exception, score: toleranceScore(h.weight, effCap), excess: h.weight - effCap };
    })
    .sort((a, b) => a.score - b.score);
  const binding = judged[0] ?? null;
  const topWeight = risk.topHoldingWeight;
  const exceptionsApplied = judged.filter((j) => j.exception && j.weight > cap && j.weight <= j.effCap);

  // Correlated clusters: names that move as one trade (same r > threshold the
  // risk engine's highPairs uses) are ONE bet, and are judged against the same
  // cap a single name gets — with 1.75× room, because a cluster still carries
  // internal idiosyncratic cushioning a single ticker does not. Exceptions
  // deliberately do NOT extend the cluster allowance: blessing one position's
  // size says nothing about accepting four names that move as one trade.
  const clusterAllowance = cap * 1.75;
  const clusters = correlationClusters(risk.correlation, holdings);
  const biggest = clusters[0] ?? null;

  const capScore = binding ? binding.score : 100;
  const clusterScore = biggest ? toleranceScore(biggest.weight, clusterAllowance) : null;
  const score = clusterScore != null ? capScore * 0.6 + clusterScore * 0.4 : capScore;

  const capExcess = binding ? binding.excess : 0;
  const clusterExcess = biggest ? biggest.weight - clusterAllowance : 0;
  // Trade-policy hysteresis: a position sitting exactly at the optimizer's cap
  // must not flap between verdicts on quote jitter.
  const capStatus = capExcess <= 0 ? ALIGNED : capExcess <= CONCENTRATION_HYSTERESIS_PCT ? TENSION : MISMATCH;
  const clusterStatus =
    clusterExcess <= 0 ? ALIGNED : clusterExcess <= CONCENTRATION_HYSTERESIS_PCT * 2 ? TENSION : MISMATCH;
  const status = [capStatus, clusterStatus].includes(MISMATCH)
    ? MISMATCH
    : [capStatus, clusterStatus].includes(TENSION)
      ? TENSION
      : ALIGNED;

  const effN = risk.positionHhi > 0 ? 10_000 / risk.positionHhi : holdings.length;
  const bindingCapText = binding?.exception
    ? `your ${binding.effCap}% exception for ${binding.name}`
    : `your ${cap}% cap`;

  const parts: string[] = [];
  if (binding && capExcess > 0) {
    parts.push(`${binding.name} is ${binding.weight.toFixed(1)}% of the book against ${bindingCapText} (+${capExcess.toFixed(1)}pp).`);
  } else if (binding) {
    parts.push(`Largest position ${judged.reduce((a, b) => (b.weight > a.weight ? b : a), judged[0]).name} at ${topWeight.toFixed(1)}%, inside ${exceptionsApplied.length > 0 ? "your caps and stated exceptions" : `your ${cap}% cap`}.`);
  }
  for (const ex of exceptionsApplied) {
    parts.push(`${ex.name} at ${ex.weight.toFixed(1)}% sits above the general ${cap}% cap but within your stated ${ex.effCap}% exception${ex.exception?.note ? ` (“${ex.exception.note}”)` : ""} — deliberate, so it does not count against you.`);
  }
  if (biggest && clusterExcess > 0)
    parts.push(`${biggest.symbols.join(" + ")} move as one trade (r > ${HIGH_CORRELATION_R}) totalling ${biggest.weight.toFixed(1)}% — beyond the ${clusterAllowance.toFixed(0)}% one correlated bet gets under your cap.`);
  else if (biggest && biggest.weight > cap)
    parts.push(`${biggest.symbols.join(" + ")} co-move as a ${biggest.weight.toFixed(1)}% cluster — one bet, though within the ${clusterAllowance.toFixed(0)}% cluster allowance.`);

  const corrNote =
    risk.correlation == null
      ? " Correlation clusters could not be checked (not enough price history), so this rests on single-name sizes alone."
      : "";

  const worstIsCluster = clusterStatus === MISMATCH && (capStatus !== MISMATCH || clusterExcess > capExcess);
  const mismatchHoldings = worstIsCluster && biggest ? biggest.symbols : binding ? [binding.name] : [];

  return {
    score,
    status,
    unratedReason: null,
    finding: parts.join(" ") + corrNote,
    basis: `Your stated cap is ${cap}% for a single position${policy.exceptions.length > 0 ? `, with named exceptions (${policy.exceptions.map((e) => `${e.symbol} ≤ ${e.maxPositionPct}%`).join(", ")})` : ""}; a correlated cluster (names with r > ${HIGH_CORRELATION_R}) counts as one bet and gets ${clusterAllowance.toFixed(0)}%. Deliberate concentration inside those limits is YOUR call and scores as aligned — only breaches of your own numbers register.`,
    evidencePct: 100,
    metrics: {
      topWeightPct: topWeight,
      capPct: cap,
      ...(biggest ? { largestClusterPct: biggest.weight, clusterAllowancePct: clusterAllowance } : {}),
    },
    facts: [
      { label: "Largest position", value: `${topWeight.toFixed(1)}%`, holdings: judged.length ? [judged.reduce((a, b) => (b.weight > a.weight ? b : a), judged[0]).name] : [] },
      ...exceptionsApplied.map((ex) => ({
        label: "Within your stated exception",
        value: `${ex.name} ${ex.weight.toFixed(1)}% ≤ ${ex.effCap}%`,
        holdings: [ex.name],
      })),
      ...(biggest
        ? [{ label: "Largest correlated cluster", value: `${biggest.weight.toFixed(1)}%`, holdings: biggest.symbols }]
        : []),
      { label: "Effective holdings", value: effN.toFixed(1) },
    ],
    mismatch:
      status === MISMATCH
        ? {
            severity: worstIsCluster
              ? severityOf(biggest!.weight, clusterAllowance)
              : severityOf(binding!.weight, binding!.effCap),
            summary: worstIsCluster
              ? `${biggest!.symbols.join(" + ")} move as one ${biggest!.weight.toFixed(1)}% bet against the ${clusterAllowance.toFixed(0)}% your ${cap}% cap allows a cluster.`
              : `${binding!.name} is ${binding!.weight.toFixed(1)}% of the book against ${bindingCapText}.`,
            stated: worstIsCluster ? `≤ ${clusterAllowance.toFixed(0)}% per correlated bet` : `≤ ${binding!.effCap}% ${binding!.exception ? `(${binding!.name} exception)` : "per position"}`,
            actual: worstIsCluster ? `${biggest!.weight.toFixed(1)}%` : `${binding!.weight.toFixed(1)}%`,
            excess: `+${(worstIsCluster ? clusterExcess : capExcess).toFixed(1)}pp`,
            holdings: mismatchHoldings,
          }
        : null,
    // A blessed big position is deliberate and costs nothing — and it is still
    // one name carrying that much of the book. Both statements stay true.
    objectiveNote:
      status !== MISMATCH && exceptionsApplied.length > 0 && exceptionsApplied[0].weight >= 15
        ? `${exceptionsApplied[0].name} at ${exceptionsApplied[0].weight.toFixed(1)}% is within your stated exception — and objectively, a single name still drives ${exceptionsApplied[0].weight.toFixed(0)}% of the book's outcome.`
        : null,
  };
}

function liquidityTheme(alloc: PortfolioAllocation, risk: UniversalRisk, policy: InvestorPolicy): ThemeSeed {
  const floor = policy.tolerances.liquidityFloorPct;
  const [cashMin, cashMax] = policy.tolerances.cashRangePct;
  const liquidPct = clamp(100 - risk.illiquidPct);
  const cashPct = alloc.byAssetClass.slices.find((s) => s.key === "cash")?.weight ?? 0;

  const floorScore = toleranceScore(liquidPct, floor, true);
  // Cash band: inside = 100. Below the minimum bites fast (no buffer forces
  // selling at the market's price); above the maximum drags slowly (idle cash
  // loses purchasing power but loses it gradually).
  const cashScore =
    cashPct >= cashMin && cashPct <= cashMax
      ? 100
      : cashPct < cashMin
        ? clamp(75 - 55 * ((cashMin - cashPct) / Math.max(cashMin, 1)))
        : clamp(75 - 55 * ((cashPct - cashMax) / Math.max(cashMax, 5)));
  const score = floorScore * 0.7 + cashScore * 0.3;

  const shortfall = floor - liquidPct;
  const cashOff = cashPct < cashMin ? cashMin - cashPct : cashPct > cashMax ? cashPct - cashMax : 0;
  const status =
    shortfall > 2 ? MISMATCH : shortfall > 0 || cashOff > Math.max(3, cashMax * 0.3) ? TENSION : ALIGNED;

  const finding =
    shortfall > 0
      ? `${liquidPct.toFixed(0)}% of the book is sellable within days — ${shortfall.toFixed(0)}pp short of the ${floor}% you said you might need. Cash sits at ${cashPct.toFixed(1)}%.`
      : `${liquidPct.toFixed(0)}% sellable within days (you asked for ${floor}%). Cash at ${cashPct.toFixed(1)}%${
          cashOff > 0 ? `, outside your ${cashMin}–${cashMax}% band` : `, inside your ${cashMin}–${cashMax}% band`
        }.`;

  return {
    score,
    status,
    unratedReason: null,
    finding,
    basis: `You said ${floor}% must stay reachable within days and cash should run ${cashMin}–${cashMax}%. Access is 70% of the theme, the cash band 30%; a shortfall in access bites faster than idle cash drags.`,
    evidencePct: 100,
    metrics: { liquidPct, floorPct: floor, cashPct, cashMin, cashMax },
    facts: [
      { label: "Sellable within days", value: `${liquidPct.toFixed(1)}%` },
      { label: "Cash", value: `${cashPct.toFixed(1)}%` },
      ...(risk.illiquidHoldings > 0
        ? [{ label: "Illiquid holdings", value: `${risk.illiquidHoldings} (${risk.illiquidPct.toFixed(1)}% of value)` }]
        : []),
    ],
    mismatch:
      status === MISMATCH
        ? {
            severity: severityOf(floor, liquidPct),
            summary: `Only ${liquidPct.toFixed(0)}% of the book is sellable within days against the ${floor}% you said you might need.`,
            stated: `≥ ${floor}% liquid`,
            actual: `${liquidPct.toFixed(1)}%`,
            excess: `−${shortfall.toFixed(1)}pp`,
            holdings: [],
          }
        : null,
  };
}

function incomeTheme(holdings: Holding[], totalValue: number, policy: InvestorPolicy): ThemeSeed {
  const annual = holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);
  const yieldPct = totalValue > 0 ? Math.max(0, (annual / totalValue) * 100) : 0;

  if (policy.priorities.income === 0) {
    return factOnly(
      annual > 0
        ? `The book yields ${yieldPct.toFixed(2)}% (~${Math.round(annual).toLocaleString()}/yr). You've said income isn't a goal, so this is a fact, not a judgment.`
        : "The book produces no income — consistent with your stated total-return approach.",
      [{ label: "Portfolio yield", value: `${yieldPct.toFixed(2)}%` }],
    );
  }

  const req = policy.tolerances.incomeYieldPct;
  const ratio = req > 0 ? yieldPct / req : 1;
  // Meeting the requirement IS full alignment. There is deliberately no extra
  // credit beyond it — rewarding surplus yield is how a scorer starts
  // recommending junk-grade coupons to people who never asked for them.
  const score = ratio >= 1 ? 100 : clamp(100 * Math.pow(Math.max(0, ratio), 0.8));
  const status = ratio >= 1 ? ALIGNED : ratio >= 0.75 ? TENSION : MISMATCH;
  const gap = req - yieldPct;

  const payers = holdings
    .filter((h) => h.income)
    .sort((a, b) => (b.income?.annual ?? 0) - (a.income?.annual ?? 0))
    .slice(0, 3)
    .map((h) => h.symbol ?? h.name);

  return {
    score,
    status,
    unratedReason: null,
    finding:
      ratio >= 1
        ? `Yields ${yieldPct.toFixed(2)}% (~${Math.round(annual).toLocaleString()}/yr) against your ${req}% requirement. Quantity only — sustainability is not assessed here.`
        : `Yields ${yieldPct.toFixed(2)}% against your ${req}% requirement — ${gap.toFixed(2)}pp short (~${Math.round((gap / 100) * totalValue).toLocaleString()}/yr of missing income).`,
    basis: `You need ${req}%/yr from this book. Meeting it scores 100; the score falls with the shortfall. Surplus yield earns nothing extra — chasing yield you don't need is not alignment.`,
    evidencePct: 100,
    metrics: { yieldPct, requiredPct: req },
    facts: [
      { label: "Portfolio yield", value: `${yieldPct.toFixed(2)}%`, holdings: payers },
      { label: "Your requirement", value: `${req.toFixed(1)}%` },
    ],
    mismatch:
      status === MISMATCH
        ? {
            severity: severityOf(req, Math.max(yieldPct, 0.01)),
            summary: `The book yields ${yieldPct.toFixed(2)}% against the ${req}% you said you need to draw.`,
            stated: `≥ ${req}% yield`,
            actual: `${yieldPct.toFixed(2)}%`,
            excess: `−${gap.toFixed(2)}pp`,
            holdings: payers,
          }
        : null,
  };
}

/**
 * Inflation targets per priority level, in % of value per +1pp inflation
 * surprise (the calibrated INFLATION_1PP probe). Level 1 tolerates normal
 * nominal-asset exposure; level 3 wants near-neutrality. The sensitivity scale
 * spans roughly −7 (long nominal bonds + cash) to +6 (real-asset heavy).
 *
 * Exported: the recommendation engine's inflation-hedge gap trigger reads THIS
 * table, so a gap can only exist where this theme would score one — one floor,
 * two consumers, no drift.
 */
export const INFLATION_TARGET_S: Record<number, number> = { 1: -4, 2: -2.5, 3: -1 };

function inflationTheme(risk: UniversalRisk, policy: InvestorPolicy): ThemeSeed {
  const s = risk.inflationSensitivity;
  const level = policy.priorities.inflation;

  if (level === 0) {
    return factOnly(
      s == null
        ? "No inflation-sensitive exposures to report."
        : s < -0.5
          ? `A +1pp inflation surprise would cost roughly ${Math.abs(s).toFixed(1)}% of value (short-term). You've not made inflation protection a priority, so this is a fact, not a judgment.`
          : `Roughly inflation-${s > 0.5 ? "hedged" : "neutral"} (${s >= 0 ? "+" : ""}${s.toFixed(1)}% per +1pp surprise).`,
      s != null ? [{ label: "Sensitivity to +1pp surprise", value: `${s >= 0 ? "+" : ""}${s.toFixed(1)}%` }] : [],
    );
  }

  if (s == null) return insufficient("Inflation sensitivity could not be modelled for these holdings.", 0);

  const target = INFLATION_TARGET_S[level] ?? -2.5;
  const gap = target - s; // positive = worse than target
  // The 6-unit divisor is half the realistic sensitivity range (−7..+6): a book
  // a full half-range below target reads 20.
  const score = gap <= 0 ? 100 : clamp(75 - 55 * (gap / 6) + (gap < 0.6 ? ((0.6 - gap) / 0.6) * 25 : 0));
  const status = gap <= 0 ? ALIGNED : gap <= 1.2 ? TENSION : MISMATCH;

  return {
    score,
    status,
    unratedReason: null,
    finding:
      gap > 0
        ? `A +1pp inflation surprise costs ~${Math.abs(s).toFixed(1)}% of value — more exposed than the ${Math.abs(target).toFixed(1)}% loss your protection level implies. Real assets (TIPS, commodities, gold, real estate) are what move this.`
        : `Inflation response ${s >= 0 ? "+" : ""}${s.toFixed(1)}% per +1pp surprise — at or better than the level of protection you asked for.`,
    basis: `You asked for ${level === 3 ? "strong" : level === 2 ? "meaningful" : "some"} inflation protection, which sets a floor of ${INFLATION_TARGET_S[level]}% response to a +1pp surprise. Modelled from each holding's factor loadings.`,
    evidencePct: 100 - (risk.coverage?.unmodelledPct ?? 0),
    metrics: { sensitivityPct: s, floorPct: target },
    facts: [
      { label: "Sensitivity to +1pp surprise", value: `${s >= 0 ? "+" : ""}${s.toFixed(1)}%` },
      { label: "Your floor", value: `${target.toFixed(1)}%` },
    ],
    mismatch:
      status === MISMATCH
        ? {
            severity: Math.min(1, gap / 6),
            summary: `The book loses ~${Math.abs(s).toFixed(1)}% to a +1pp inflation surprise against the ${Math.abs(target).toFixed(1)}% your protection level tolerates.`,
            stated: `response ≥ ${target.toFixed(1)}%`,
            actual: `${s.toFixed(1)}%`,
            excess: `−${gap.toFixed(1)}pp`,
            holdings: [],
          }
        : null,
  };
}

/**
 * Exposure targets per priority level: max share of classified value in one
 * region, min unhedged foreign-currency share. Exported for the same reason as
 * INFLATION_TARGET_S — the recommendation engine's international gap uses the
 * SAME ceiling this theme scores against.
 */
export const EXPOSURE_TARGETS: Record<number, { maxTopRegionPct: number; minForeignFxPct: number }> = {
  1: { maxTopRegionPct: 85, minForeignFxPct: 8 },
  2: { maxTopRegionPct: 72, minForeignFxPct: 18 },
  3: { maxTopRegionPct: 62, minForeignFxPct: 28 },
};

function exposureTheme(alloc: PortfolioAllocation, risk: UniversalRisk, policy: InvestorPolicy): ThemeSeed {
  const level = policy.priorities.exposure;
  const geo = alloc.byGeography;
  const classifiedPct = clamp(100 - geo.unclassifiedPct);
  const topRegion = geo.slices[0] ?? null;
  const topOfClassified = topRegion && classifiedPct > 0 ? (topRegion.weight / classifiedPct) * 100 : null;
  const fx = risk.foreignCurrencyPct;

  if (level === 0) {
    return factOnly(
      topRegion && topOfClassified != null
        ? `${topOfClassified.toFixed(0)}% of classified exposure sits in ${topRegion.label}; ${fx.toFixed(0)}% of value is in non-base currencies. You've treated home concentration as deliberate, so this is a fact, not a judgment.`
        : "Geographic footprint could not be classified.",
      topRegion && topOfClassified != null
        ? [
            { label: "Largest region", value: `${topRegion.label} ${topOfClassified.toFixed(0)}%` },
            { label: "Non-base currency", value: `${fx.toFixed(0)}%` },
          ]
        : [],
    );
  }

  if (classifiedPct < 40 || topOfClassified == null) {
    return insufficient(
      `Geography is unknown for ${geo.unclassifiedPct.toFixed(0)}% of the book — too little classified to judge the spread you asked for.`,
      classifiedPct,
    );
  }

  const t = EXPOSURE_TARGETS[level] ?? EXPOSURE_TARGETS[2];
  const geoScore = toleranceScore(topOfClassified, t.maxTopRegionPct);
  const fxScore = toleranceScore(fx, t.minForeignFxPct, true);
  const score = geoScore * 0.65 + fxScore * 0.35;

  const geoExcess = topOfClassified - t.maxTopRegionPct;
  const fxShort = t.minForeignFxPct - fx;
  const status = geoExcess > 8 || fxShort > 12 ? MISMATCH : geoExcess > 0 || fxShort > 0 ? TENSION : ALIGNED;

  return {
    score,
    status,
    unratedReason: null,
    finding:
      geoExcess > 0
        ? `${topRegion!.label} is ${topOfClassified.toFixed(0)}% of classified exposure — ${geoExcess.toFixed(0)}pp above the ${t.maxTopRegionPct}% ceiling your diversification level implies. Non-base currencies: ${fx.toFixed(0)}%.`
        : `Largest region ${topRegion!.label} at ${topOfClassified.toFixed(0)}% of classified exposure (ceiling ${t.maxTopRegionPct}%); ${fx.toFixed(0)}% in non-base currencies${fxShort > 0 ? ` — ${fxShort.toFixed(0)}pp under the ${t.minForeignFxPct}% you'd want` : ""}.`,
    basis: `You asked for ${level === 3 ? "strong" : level === 2 ? "meaningful" : "some"} geographic spread: largest region ≤ ${t.maxTopRegionPct}% of classified value (65% of theme) and ≥ ${t.minForeignFxPct}% in non-base currencies (35%). Measured on the ${classifiedPct.toFixed(0)}% of the book that could be classified.`,
    evidencePct: classifiedPct,
    metrics: { topRegionPct: topOfClassified, regionCeilingPct: t.maxTopRegionPct, foreignFxPct: fx, fxFloorPct: t.minForeignFxPct },
    facts: [
      { label: "Largest region (of classified)", value: `${topRegion!.label} ${topOfClassified.toFixed(0)}%` },
      { label: "Non-base currency", value: `${fx.toFixed(0)}%` },
      ...(geo.unclassifiedPct > 5 ? [{ label: "Unclassified", value: `${geo.unclassifiedPct.toFixed(0)}%` }] : []),
    ],
    mismatch:
      status === MISMATCH
        ? {
            severity: severityOf(topOfClassified, t.maxTopRegionPct),
            summary: `${topRegion!.label} carries ${topOfClassified.toFixed(0)}% of classified exposure against the ${t.maxTopRegionPct}% ceiling your stated diversification level implies.`,
            stated: `≤ ${t.maxTopRegionPct}% in one region`,
            actual: `${topOfClassified.toFixed(0)}%`,
            excess: `+${geoExcess.toFixed(1)}pp`,
            holdings: [],
          }
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Compose                                                                     */
/* -------------------------------------------------------------------------- */

const EMPTY_REPORT: AlignmentReport = {
  score: null,
  scoreExact: null,
  label: null,
  status: "empty",
  confirmed: false,
  themes: [],
  mismatches: [],
  dataGaps: [],
  summary: "No holdings.",
  evidencePct: 0,
  objectiveNotes: [],
  policyConflicts: [],
};

/**
 * Internal contradictions in the POLICY itself — book-independent, pure, and
 * warning-only. The alternative to warning is silently letting one of the
 * investor's own statements lose to another, which is how a "faithful" score
 * quietly becomes unexplainable.
 *
 * Feasibility arithmetic (deliberately rough, stated conservatively):
 *  - a 2008-scale equity shock costs growth-engine assets ~55% and ballast
 *    ~5%, so a book AT THE FLOOR of the growth band still stresses about
 *    lo×0.55 + (100−lo)×0.05 percent — if even that exceeds the stated
 *    drawdown tolerance, no book inside the band can satisfy it;
 *  - growth-engine assets yield ~1.5% at best and income sleeves ~4.5%, so a
 *    band floor of lo% caps plausible portfolio yield near
 *    (lo×1.5 + (100−lo)×4.5)/100 — a higher requirement cannot be met without
 *    leaving the investor's own band.
 */
export function detectPolicyConflicts(policy: InvestorPolicy): string[] {
  const out: string[] = [];
  const [lo, hi] = growthBandFor(policy);
  const tol = policy.tolerances.maxDrawdownPct;

  // Hand-checked: lo=50 → 27.5 + 2.5 = 30; lo=60 → 33 + 2 = 35; lo=0 → 5.
  const minPlausibleStress = lo * 0.55 + (100 - lo) * 0.05;
  if (minPlausibleStress > tol + 2) {
    out.push(
      `Your growth band and drawdown tolerance conflict: even at the ${lo.toFixed(0)}% floor of your ${lo.toFixed(0)}–${hi.toFixed(0)}% growth band, a 2008-scale stress costs roughly ${minPlausibleStress.toFixed(0)}% — beyond the ${tol}% you said you could sit through. No portfolio can satisfy both; raise the tolerance or lower the band.`,
    );
  }

  if (policy.priorities.income > 0 && policy.tolerances.incomeYieldPct > 0) {
    const maxPlausibleYield = (lo * 1.5 + (100 - lo) * 4.5) / 100;
    if (policy.tolerances.incomeYieldPct > maxPlausibleYield + 0.3) {
      out.push(
        `Your income requirement and growth band conflict: a book holding at least ${lo.toFixed(0)}% growth engine plausibly yields ~${maxPlausibleYield.toFixed(1)}%/yr at most, below the ${policy.tolerances.incomeYieldPct}% you require. One of the two has to give.`,
      );
    }
  }

  return out;
}

export function computeAlignment(
  holdings: Holding[],
  totalValue: number,
  alloc: PortfolioAllocation,
  risk: UniversalRisk,
  policy: InvestorPolicy,
): AlignmentReport {
  if (holdings.length === 0 || totalValue <= 0) return { ...EMPTY_REPORT, confirmed: policy.confirmed };

  const seeds: Record<AlignmentThemeId, ThemeSeed> = {
    structure: structureTheme(holdings, policy),
    resilience: resilienceTheme(holdings, totalValue, risk, policy),
    concentration: concentrationTheme(holdings, risk, policy),
    liquidity: liquidityTheme(alloc, risk, policy),
    income: incomeTheme(holdings, totalValue, policy),
    inflation: inflationTheme(risk, policy),
    exposure: exposureTheme(alloc, risk, policy),
  };

  const shares = priorityShares(policy);
  const themes = ALIGNMENT_THEMES.map((id) => seedToTheme(id, policy.priorities[id], seeds[id]));

  // A theme the investor turned ON but that lacks evidence is EXCLUDED and
  // NAMED — its weight neither vanishes silently nor gets redistributed as if
  // the remaining themes had answered its question.
  const rated = themes.filter((t) => t.scoreExact != null && shares[t.id] > 0);
  const ratedShare = rated.reduce((s, t) => s + shares[t.id], 0);
  const dataGaps = themes
    .filter((t) => t.unratedReason === "insufficient_data" && shares[t.id] > 0)
    .map((t) => t.label);

  // Objective notes come from the seeds of themes that actually carry weight —
  // an opted-out theme's magnitudes already render as facts elsewhere.
  const objectiveNotes = ALIGNMENT_THEMES.filter((id) => policy.priorities[id] > 0)
    .map((id) => seeds[id].objectiveNote)
    .filter((n): n is string => n != null && n.length > 0);
  const policyConflicts = detectPolicyConflicts(policy);

  // Under half the stated priorities measurable → an honest "insufficient",
  // not a precise-looking number computed over whatever happened to be left.
  if (ratedShare < 0.5) {
    return {
      ...EMPTY_REPORT,
      status: "insufficient",
      confirmed: policy.confirmed,
      themes,
      dataGaps,
      policyConflicts,
      summary:
        dataGaps.length > 0
          ? `Not enough evidence to score alignment: ${dataGaps.join(", ")} cannot be measured on this book's data.`
          : "No priorities are enabled in your policy, so there is nothing to score against.",
    };
  }

  for (const t of themes) t.weightShare = t.scoreExact != null ? shares[t.id] / ratedShare : 0;

  const scoreExact = rated.reduce((s, t) => s + t.scoreExact! * (shares[t.id] / ratedShare), 0);
  const score = Math.round(scoreExact);

  const mismatches = themes
    .map((t) => t.mismatch)
    .filter((m): m is AlignmentMismatch => m != null)
    .sort((a, b) => b.severity - a.severity);

  const alignedCount = rated.filter((t) => t.status === ALIGNED).length;
  const evidencePct = Math.round(
    rated.reduce((s, t) => s + t.evidencePct * (shares[t.id] / ratedShare), 0),
  );

  const summary =
    mismatches.length > 0
      ? `${alignedCount} of ${rated.length} scored themes aligned. Biggest mismatch: ${mismatches[0].summary}`
      : rated.some((t) => t.status === TENSION)
        ? `Aligned on ${alignedCount} of ${rated.length} themes, with ${rated.length - alignedCount} running close to your stated limits.`
        : `The book sits inside every limit you set, weighted the way you weighted them.`;

  return {
    score,
    scoreExact,
    label: alignmentLabelOf(score),
    status: "scored",
    confirmed: policy.confirmed,
    themes,
    mismatches,
    dataGaps,
    summary: policy.confirmed ? summary : `${summary} (Scored against assumed defaults — set your own priorities to make this yours.)`,
    evidencePct,
    objectiveNotes,
    policyConflicts,
  };
}
