/**
 * When the "Deploy Cash" button must be inert.
 *
 * Extracted as a pure function because it is the only thing standing between a
 * stray second click and a duplicate write to the real ledger — a guard that
 * matters that much should be asserted by a test, not just read.
 *
 * The plan is compared by IDENTITY, not by a key derived from the inputs.
 * useCashPreview() hands back a freshly-parsed object on every fetch, so
 * `executedPlan === plan` is true for exactly as long as the plan on screen is
 * the one already written — and becomes false the moment a new plan arrives.
 * That distinction matters for a real case: a user who deploys $3,000, changes
 * the amount, then changes it back gets a NEW plan (computed against the
 * post-trade portfolio) which is legitimately deployable. An input-derived key
 * would wrongly keep blocking it.
 */
export type DeployBlockedReason = "already-executed" | "recomputing" | null;

export function deployBlockedReason(
  /** The plan currently on screen. */
  plan: object | null | undefined,
  /** The plan that was successfully deployed, if any. Cleared on a successful undo. */
  executedPlan: object | null | undefined,
  /** True while a fresh simulation is in flight — the plan on screen is the previous one. */
  loading: boolean,
): DeployBlockedReason {
  // Nothing to deploy at all.
  if (plan == null) return null;

  // Already written to the ledger. This is the B2 regression: the button used to
  // stay enabled after a successful deployment, beside a footer still reading
  // "$X of $X deployed", so one more click deposited the cash again and re-bought
  // the whole plan. On the live book the top recommendation was $277,841.
  if (executedPlan === plan) return "already-executed";

  // A re-simulation takes 30-90s on a real portfolio, and the PREVIOUS plan stays
  // on screen throughout. Deploying during that window writes a plan for an amount
  // the user has already moved away from.
  if (loading) return "recomputing";

  return null;
}
