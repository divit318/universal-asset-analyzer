/**
 * Portfolio concentration & trade-materiality policy — the SINGLE source of truth.
 *
 * ── The bug this exists to prevent ────────────────────────────────────────────
 *
 * Three engines each carried their own literal for "how concentrated is too
 * concentrated", and their fixed points disagreed:
 *
 *   - optimize.ts   capped a holding at 20% (its target ceiling)
 *   - recommend.ts  trimmed any holding ≥20% down to 15%
 *   - health.ts     started penalising above ~8%
 *
 * The optimizer would size a high-conviction name to its 20% cap; the
 * recommendation engine would then insist on trimming that same name to 15%;
 * executing the trim left the name below the optimizer's target, so the next
 * optimizer run bought it straight back to 20% — an infinite 15%↔20% oscillation
 * between two engines with incompatible equilibria. CLAUDE.md already names this
 * exact failure mode for AI model routing ("policy duplicated per task drifts");
 * it had happened here for portfolio concentration too.
 *
 * Both executable engines now read the SAME numbers from this file, so they share
 * one equilibrium and the oscillation cannot exist.
 */

/**
 * Maximum acceptable weight for any single holding, in % — THE DEFAULT.
 *
 * Since the alignment engine shipped, the investor's own cap
 * (`InvestorPolicy.tolerances.maxPositionPct`) is the number that governs:
 * DEFAULT_POLICY seeds it from this constant, the recommendation engine's trim
 * trigger/target read the policy (recommend.ts), and this constant remains the
 * optimizer's default ceiling until the Optimize stage consumes
 * `constraintsFromPolicy()` too. The shared-equilibrium reasoning below still
 * holds — the equilibrium point is now the investor's cap rather than a
 * universal one.
 */
export const MAX_SINGLE_HOLDING_PCT = 20;

/**
 * Dead-band around the concentration boundary, in pp (hysteresis).
 *
 * A position must exceed the cap by MORE than this before a trim is recommended,
 * so live price/score jitter around exactly the cap cannot flip a recommendation
 * in and out with no real portfolio change.
 */
export const CONCENTRATION_HYSTERESIS_PCT = 1.5;

/**
 * Weight above which the recommendation engine proposes trimming a holding.
 * Sits a hysteresis band above the cap so a position parked exactly at the
 * optimizer's cap is never flagged.
 */
export const TRIM_TRIGGER_PCT = MAX_SINGLE_HOLDING_PCT + CONCENTRATION_HYSTERESIS_PCT;

/**
 * The weight a trim recommendation trims BACK to — the cap itself, never below it.
 *
 * Trimming below the cap while the optimizer actively targets the cap is exactly
 * the contradiction that produced the infinite oscillation. Trimming to the cap
 * makes the cap a genuine shared fixed point.
 */
export const TRIM_TARGET_PCT = MAX_SINGLE_HOLDING_PCT;

/**
 * Minimum weight change, in pp, worth generating a trade for.
 *
 * Below this a "trade" is noise — its dollar size is dwarfed by spreads and the
 * cognitive cost of acting. Used by optimize.ts for BOTH the BUY/SELL action
 * label and the trade-list filter, which previously used 0.5 and 1.0 respectively
 * (a latent drift bug: a holding could be labelled BUY yet never appear as a
 * trade).
 */
export const MATERIAL_WEIGHT_DELTA_PCT = 1;
