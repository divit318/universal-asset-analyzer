/**
 * Policy Fit — where the investor's OWN priorities and the book's MEASURED
 * health enter the Portfolio Fit conclusion.
 *
 * ── The three-layer question this answers ────────────────────────────────────
 *
 *   User priorities  (InvestorPolicy — what you told us you care about)
 *        ×
 *   Portfolio Health (alignment themes — what the book currently does, judged
 *                     by lib/portfolio/alignment/engine.ts and PROJECTED here
 *                     as PolicyFitContext; never recomputed)
 *        ×
 *   This asset       (what adding it would actually do)
 *        ↓
 *   One bounded adjustment to the portfolio-effects composite
 *   + one personalized sentence, when — and only when — an honest
 *     "you said X → the book does Y → this does Z" chain exists.
 *
 * ── Honesty rules (each one is load-bearing) ─────────────────────────────────
 *
 *  1. CONFIRMED POLICY ONLY. An unconfirmed policy is assumed defaults;
 *     claiming "you prioritized X" against defaults the user never chose is
 *     the exact universal-weights bug the alignment system replaced. Nothing
 *     here fires until the investor has actually saved a policy.
 *  2. NO DOUBLE COUNTING. The fit dimensions already price sector
 *     concentration, single-name overlap, position-cap sizing and geography.
 *     Only themes the dimensions CANNOT see may adjust the score:
 *       structure   (growth-band breach × the asset's beta)
 *       resilience  (drawdown-tolerance breach × the asset's beta) — skipped
 *                   when the IOS objective already prices defensiveness
 *       liquidity   (cash below the investor's own band — a cash-funded buy
 *                   presses on it; nothing in the six dimensions knows cash)
 *       income      (stated yield requirement unmet × the asset's yield) —
 *                   skipped when the IOS objective is increase_income
 *     Concentration, exposure and inflation NEVER adjust the score here —
 *     they may only ground the personalized sentence.
 *  3. A THEME THE INVESTOR OPTED OUT OF (priority 0) never fires. Their
 *     health score doesn't judge it; their fit score must not either.
 *  4. ABSTAIN WITHOUT EVIDENCE. No asset beta → no structure/resilience
 *     claim. No theme metrics (stale cached report) → nothing fires.
 *  5. BOTH DIRECTIONS. Helping a stated priority raises fit; working against
 *     one lowers it. Conflicts are surfaced, not resolved silently.
 *  6. BOUNDED. The summed adjustment is clamped to ±POLICY_FIT_MAX_ADJUSTMENT
 *     on the effects composite (which itself carries 1−researchWeight of the
 *     fit), and the fit scorer's research guardrails still apply after it —
 *     portfolio need can never manufacture conviction (see the fit scorer's
 *     uplift cap and unified-action's "average research earns a starter at
 *     most").
 *
 * Pure, deterministic, client-safe. No AI anywhere.
 */

import { RECOMMENDATION_LABEL, scoreToRecommendation } from "../recommendation";
import type { FitAssetData, InvestmentProfile, PolicyThemeSnapshot } from "./types";

/** The summed policy adjustment can never move the effects composite more than this. */
export const POLICY_FIT_MAX_ADJUSTMENT = 8;

/** Beta at/above which an asset counts as growth-engine-like / stress-adding. */
const GROWTH_BETA = 0.85;
/** Beta at/below which an asset counts as defensive / stress-damping. */
const DEFENSIVE_BETA = 0.7;

/** Sectors with recognized real-asset/inflation-pass-through character — used
 *  ONLY to ground the inflation insight sentence, never to move the score. */
export const INFLATION_HEDGE_SECTORS = ["Energy", "Basic Materials", "Real Estate", "Utilities"];

export interface PolicyFitNote {
  themeId: string;
  /** Signed contribution to the portfolio-effects composite. */
  delta: number;
  /** One evidence line in real units — flows into reasons (+) / tradeoffs (−). */
  text: string;
}

export interface PolicyFitAssessment {
  /** Σ note deltas, clamped to ±POLICY_FIT_MAX_ADJUSTMENT. 0 when nothing fired. */
  adjustment: number;
  notes: PolicyFitNote[];
  /** THE personalized line, or null when no honest connection exists. */
  insight: string | null;
}

const NONE: PolicyFitAssessment = { adjustment: 0, notes: [], insight: null };

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** An insight candidate: a standalone sentence plus a composable "but" fragment. */
interface InsightCandidate {
  themeId: string;
  sign: 1 | -1;
  /** priority(1-3) × status severity(mismatch 2, tension 1) × relevance. Orders candidates. */
  weight: number;
  sentence: string;
  /** Lowercase continuation used when this candidate is the counterweight in a tradeoff sentence. */
  butFragment: string;
}

const themeById = (
  themes: PolicyThemeSnapshot[],
  id: string,
): PolicyThemeSnapshot | undefined => themes.find((t) => t.id === id);

/** Actionable = the user weights it AND the engine measured a strain. */
function strained(t: PolicyThemeSnapshot | undefined): t is PolicyThemeSnapshot {
  return !!t && t.priority > 0 && (t.status === "tension" || t.status === "mismatch");
}

const sev = (t: PolicyThemeSnapshot): number => (t.status === "mismatch" ? 2 : 1);

/** "You prioritized Liquidity" (≥2) vs "You said Liquidity matters" (1). */
function youSaid(t: PolicyThemeSnapshot): string {
  return t.priority >= 2 ? `You prioritized ${t.label.toLowerCase()}` : `You said ${t.label.toLowerCase()} matters`;
}

const fmt = (n: number, dp = 0): string => n.toFixed(dp);

/* -------------------------------------------------------------------------- */
/* assessPolicyFit                                                             */
/* -------------------------------------------------------------------------- */

export function assessPolicyFit(
  asset: FitAssetData,
  profile: InvestmentProfile,
  /** The pre-action suggested allocation — how hard a cash-funded buy would press on a cash shortfall. */
  suggestedPct: number,
): PolicyFitAssessment {
  const ctx = profile.policyContext;
  // Rule 1: nothing personalizes against a policy the investor never confirmed.
  if (!profile.hasPortfolio || !ctx || !ctx.confirmed || ctx.themes.length === 0) return NONE;

  const notes: PolicyFitNote[] = [];
  const candidates: InsightCandidate[] = [];
  const beta = asset.beta ?? null;
  const yieldPct = asset.dividendYield ?? null;

  /* ── Structure: growth-band breach × asset beta ────────────────────────── */
  const structure = themeById(ctx.themes, "structure");
  if (strained(structure) && structure.metrics && beta != null) {
    const { growthEnginePct: g, bandLo: lo, bandHi: hi } = structure.metrics;
    if (g != null && lo != null && hi != null) {
      const below = g < lo;
      const outside = below ? lo - g : Math.max(0, g - hi);
      if (outside > 0) {
        const growthLike = beta >= GROWTH_BETA;
        const defensive = beta <= DEFENSIVE_BETA;
        const base = structure.status === "mismatch" ? 3 : 1.5;
        let delta = 0;
        let text = "";
        if (below && growthLike) {
          delta = base;
          text = `Adds growth engine (beta ${fmt(beta, 2)}) to a book running ${fmt(g)}% against the ${fmt(lo)}–${fmt(hi)}% band your goal implies`;
        } else if (below && defensive) {
          delta = -base / 2;
          text = `Defensive (beta ${fmt(beta, 2)}) while the book already sits ${fmt(outside)}pp below its ${fmt(lo)}% growth-engine floor`;
        } else if (!below && growthLike) {
          delta = -base;
          text = `Adds growth exposure (beta ${fmt(beta, 2)}) to a book already ${fmt(outside)}pp above the ${fmt(hi)}% edge of your growth band`;
        } else if (!below && defensive) {
          delta = base;
          text = `Defensive ballast (beta ${fmt(beta, 2)}) for a book running ${fmt(outside)}pp hotter than your growth band allows`;
        }
        if (delta !== 0) {
          notes.push({ themeId: "structure", delta, text });
          candidates.push({
            themeId: "structure",
            sign: delta > 0 ? 1 : -1,
            weight: structure.priority * sev(structure),
            sentence:
              delta > 0
                ? `${youSaid(structure)} — the book is ${fmt(outside)}pp ${below ? "below" : "above"} your ${fmt(lo)}–${fmt(hi)}% growth band, and this (beta ${fmt(beta, 2)}) works toward closing that.`
                : `${youSaid(structure)} — the book is already ${fmt(outside)}pp ${below ? "below" : "above"} your ${fmt(lo)}–${fmt(hi)}% growth band, and this (beta ${fmt(beta, 2)}) pushes it further out.`,
            butFragment:
              delta > 0
                ? `it does help the ${fmt(outside)}pp gap to your growth band`
                : `the book already sits ${fmt(outside)}pp outside your growth band and this pushes it further`,
          });
        }
      }
    }
  }

  /* ── Resilience: drawdown-tolerance breach × asset beta ────────────────── */
  // Skipped when the IOS objective already prices defensiveness — the
  // objective dimension scored this asset's beta there (rule 2).
  const objectivePricesDefense = profile.objective === "reduce_risk" || profile.objective === "preserve_capital";
  const resilience = themeById(ctx.themes, "resilience");
  if (!objectivePricesDefense && strained(resilience) && resilience.metrics && beta != null) {
    const { stressPct, tolerancePct } = resilience.metrics;
    if (stressPct != null && tolerancePct != null) {
      const base = resilience.status === "mismatch" ? 3 : 1.5;
      if (beta >= 1.15) {
        notes.push({
          themeId: "resilience",
          delta: -base,
          text: `High beta (${fmt(beta, 2)}) deepens a stress estimate already at ~${fmt(stressPct)}% against the ${fmt(tolerancePct)}% drawdown you said you could sit through`,
        });
        candidates.push({
          themeId: "resilience",
          sign: -1,
          weight: resilience.priority * sev(resilience),
          sentence: `${youSaid(resilience)} — a plausible bad stretch already costs ~${fmt(stressPct)}% against the ${fmt(tolerancePct)}% you said you could sit through, and at beta ${fmt(beta, 2)} this deepens it.`,
          butFragment: `the book already stresses ~${fmt(stressPct)}% against your ${fmt(tolerancePct)}% tolerance and beta ${fmt(beta, 2)} deepens that`,
        });
      } else if (beta <= DEFENSIVE_BETA) {
        notes.push({
          themeId: "resilience",
          delta: base,
          text: `Low beta (${fmt(beta, 2)}) dampens a stress estimate running ~${fmt(stressPct)}% against your ${fmt(tolerancePct)}% drawdown tolerance`,
        });
        candidates.push({
          themeId: "resilience",
          sign: 1,
          weight: resilience.priority * sev(resilience),
          sentence: `${youSaid(resilience)} — the book stresses ~${fmt(stressPct)}% against the ${fmt(tolerancePct)}% you said you could sit through, and at beta ${fmt(beta, 2)} this dampens rather than deepens it.`,
          butFragment: `at beta ${fmt(beta, 2)} it does damp a stress estimate already past your tolerance`,
        });
      }
    }
  }

  /* ── Liquidity: cash below the investor's own band ─────────────────────── */
  // A new position here is funded from cash, so it presses on a cash shortfall
  // the six dimensions cannot see. No positive direction: buying a security
  // never fixes a cash floor.
  const liquidity = themeById(ctx.themes, "liquidity");
  if (strained(liquidity) && liquidity.metrics) {
    const { cashPct, cashMin } = liquidity.metrics;
    if (cashPct != null && cashMin != null && cashPct < cashMin) {
      const delta = -Math.min(3, 1 + suggestedPct * 0.25);
      notes.push({
        themeId: "liquidity",
        delta,
        text: `A ${fmt(suggestedPct, 1)}% cash-funded buy presses on cash already at ${fmt(cashPct, 1)}%, below the ${fmt(cashMin)}% floor of your stated band`,
      });
      candidates.push({
        themeId: "liquidity",
        sign: -1,
        weight: liquidity.priority * sev(liquidity),
        sentence: `${youSaid(liquidity)} — cash sits at ${fmt(cashPct, 1)}%, below the ${fmt(cashMin)}% floor you set — and funding this buy would pull it further from that floor.`,
        butFragment: `cash is already at ${fmt(cashPct, 1)}% against the ${fmt(cashMin)}% floor you set, and funding this pulls it lower`,
      });
    }
  }

  /* ── Income: stated yield requirement unmet × asset yield ──────────────── */
  // Skipped when the IOS objective is increase_income — the objective
  // dimension already scored this asset's yield there (rule 2).
  const income = themeById(ctx.themes, "income");
  if (profile.objective !== "increase_income" && strained(income) && income.metrics && yieldPct != null) {
    const { yieldPct: bookYield, requiredPct } = income.metrics;
    if (bookYield != null && requiredPct != null && requiredPct > 0) {
      const base = income.status === "mismatch" ? 3 : 1.5;
      if (yieldPct >= requiredPct) {
        notes.push({
          themeId: "income",
          delta: base,
          text: `Yields ${fmt(yieldPct, 1)}% — above the ${fmt(requiredPct, 1)}% you require while the book pays only ${fmt(bookYield, 2)}%`,
        });
        candidates.push({
          themeId: "income",
          sign: 1,
          weight: income.priority * sev(income),
          sentence: `You said you need ${fmt(requiredPct, 1)}% income — the book yields ${fmt(bookYield, 2)}% — and at ${fmt(yieldPct, 1)}% this works toward that gap rather than diluting it.`,
          butFragment: `its ${fmt(yieldPct, 1)}% yield does work toward the ${fmt(requiredPct, 1)}% income you said you need`,
        });
      } else if (yieldPct < Math.min(1, requiredPct * 0.4) && income.status === "mismatch") {
        notes.push({
          themeId: "income",
          delta: -1.5,
          text: `Yields ${yieldPct <= 0 ? "nothing" : `only ${fmt(yieldPct, 1)}%`} while the book already pays ${fmt(bookYield, 2)}% against the ${fmt(requiredPct, 1)}% you require`,
        });
        candidates.push({
          themeId: "income",
          sign: -1,
          weight: income.priority * sev(income),
          sentence: `You said you need ${fmt(requiredPct, 1)}% income and the book yields only ${fmt(bookYield, 2)}% — this ${yieldPct <= 0 ? "pays nothing" : `yields just ${fmt(yieldPct, 1)}%`}, so it dilutes that requirement further.`,
          butFragment: `it ${yieldPct <= 0 ? "pays no income" : `yields only ${fmt(yieldPct, 1)}%`} against the ${fmt(requiredPct, 1)}% you said you need`,
        });
      }
    }
  }

  /* ── Insight-only themes (never adjust the score — rule 2) ─────────────── */

  // Concentration: the dimensions price the mechanics; the PERSONAL statement
  // ("you prioritized this, and this asset is/feeds/avoids the flagged bet")
  // is what only the policy knows.
  const concentration = themeById(ctx.themes, "concentration");
  if (strained(concentration)) {
    const sym = asset.symbol.toUpperCase();
    const held = profile.holdingSymbols.includes(sym);
    const flagged = (concentration.mismatch?.holdings ?? []).map((h) => h.toUpperCase());
    const sectorWeight = asset.sector
      ? profile.sectorWeights.find((s) => s.sector === asset.sector)?.weight ?? 0
      : null;

    if (flagged.includes(sym)) {
      candidates.push({
        themeId: "concentration",
        sign: -1,
        weight: concentration.priority * sev(concentration) * 1.5, // it IS the flagged position
        sentence: `${youSaid(concentration)} — ${concentration.mismatch!.actual} sits against your ${concentration.mismatch!.stated} limit — and ${asset.symbol} is that position, so adding feeds the breach directly.`,
        butFragment: `${asset.symbol} is already the position breaching your ${concentration.mismatch!.stated} concentration limit`,
      });
    } else if (!held && asset.sector && sectorWeight != null && sectorWeight < 8) {
      candidates.push({
        themeId: "concentration",
        sign: 1,
        weight: concentration.priority * sev(concentration),
        sentence: `${youSaid(concentration)} — ${concentration.mismatch ? `${concentration.mismatch.actual} sits against your ${concentration.mismatch.stated} limit` : "the book runs close to your stated limits"} — and ${asset.sector} at ${fmt(sectorWeight, 1)}% of the book adds exposure outside that bet.`,
        butFragment: `it does add ${asset.sector} exposure outside the concentrated bet you flagged`,
      });
    } else if (asset.sector && sectorWeight != null && sectorWeight >= 20) {
      candidates.push({
        themeId: "concentration",
        sign: -1,
        weight: concentration.priority * sev(concentration),
        sentence: `${youSaid(concentration)} — and this adds to ${asset.sector}, already ${fmt(sectorWeight, 1)}% of the book, rather than spreading the bet.`,
        butFragment: `it adds to ${asset.sector}, already ${fmt(sectorWeight, 1)}% of an over-concentrated book`,
      });
    }
  }

  // Exposure: geography dim contributes a low-confidence nudge; the personal
  // statement cites the user's own ceiling and the measured region share.
  const exposure = themeById(ctx.themes, "exposure");
  if (strained(exposure) && asset.geography && asset.geography !== "US" && asset.geography !== "CRYPTO") {
    const top = exposure.metrics?.topRegionPct;
    candidates.push({
      themeId: "exposure",
      sign: 1,
      weight: exposure.priority * sev(exposure),
      sentence: `${youSaid(exposure)} — ${top != null ? `${fmt(top)}% of classified exposure sits in one region` : "the book is more home-biased than you asked for"} — and this adds the non-US exposure that spread calls for.`,
      butFragment: `it does add the non-US exposure your geographic spread asks for`,
    });
  }

  // Inflation: recognized real-asset sectors only, insight only.
  const inflation = themeById(ctx.themes, "inflation");
  if (
    strained(inflation) &&
    inflation.status === "mismatch" &&
    inflation.priority >= 2 &&
    asset.sector != null &&
    INFLATION_HEDGE_SECTORS.includes(asset.sector)
  ) {
    const s = inflation.metrics?.sensitivityPct;
    candidates.push({
      themeId: "inflation",
      sign: 1,
      weight: inflation.priority * sev(inflation),
      sentence: `You asked for inflation protection — ${s != null ? `a +1pp surprise currently costs the book ~${fmt(Math.abs(s), 1)}%` : "the book is more exposed to inflation than you accepted"} — and ${asset.sector} is one of the real-asset exposures that moves that.`,
      butFragment: `${asset.sector} exposure does work toward the inflation protection you asked for`,
    });
  }

  /* ── Compose: bounded adjustment + ONE sentence ────────────────────────── */

  const raw = notes.reduce((s, n) => s + n.delta, 0);
  const adjustment =
    Math.round(Math.max(-POLICY_FIT_MAX_ADJUSTMENT, Math.min(POLICY_FIT_MAX_ADJUSTMENT, raw)) * 10) / 10;

  let insight: string | null = null;
  if (candidates.length > 0) {
    const ranked = [...candidates].sort((a, b) => b.weight - a.weight);
    const top = ranked[0];
    const counter = ranked.find((c) => c.sign !== top.sign);
    // A real conflict between two stated priorities is the tradeoff the user
    // must see — one sentence, both sides, no silent resolution (rule 5).
    insight =
      counter && counter.weight >= Math.max(1.5, top.weight * 0.5)
        ? `${top.sentence.replace(/\.$/, "")} — but ${counter.butFragment}.`
        : top.sentence;

    // Requirement: portfolio need must never oversell weak research. When the
    // personal case is positive but the research verdict is below Buy-grade,
    // the sentence says which one is the constraint (canonical bands from
    // lib/recommendation.ts — the same edges the action matrix uses).
    const research = asset.researchScore ?? asset.compositeScores?.overall ?? asset.scoreResult?.composite ?? null;
    if (top.sign > 0 && research != null) {
      const band = scoreToRecommendation(research);
      if (band !== "BUY" && band !== "STRONG_BUY") {
        insight += ` The research score (${Math.round(research)}/100, ${RECOMMENDATION_LABEL[band]}) is the constraint — portfolio need alone doesn't size a position.`;
      }
    }
  }

  return { adjustment, notes, insight };
}
