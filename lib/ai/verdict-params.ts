/**
 * The personalization inputs that make one verdict different from another.
 *
 * Both verdict routes derive their cache key from this, so a personalized
 * verdict can never be served to a request that asked for a generic one (or vice
 * versa) — the difference is in the prompt, so it must be in the key.
 *
 * Kept separate from lib/ai/facts.ts (which turns these into prompt lines) and
 * from lib/ai/verdict.ts (which consumes the key) so that adding a new
 * personalization dimension requires touching exactly one list. Forgetting to
 * add it here would silently produce cache collisions between materially
 * different verdicts, which is the worst failure mode a cache has.
 */

/**
 * Query params that participate in the verdict prompt, in a fixed order.
 *
 * `objective` and `missingSectors` are included because the prompt instructs the
 * model to size the position against the user's investment policy and to call
 * out a sector gap explicitly — change either and the verdict text changes.
 */
const PERSONALIZATION_KEYS = [
  "fitScore",
  "fitTier",
  "reasons",
  "isInPortfolio",
  "suggestedPct",
  "missingSectors",
  "objective",
] as const;

/**
 * Extract the personalization params present on a request URL.
 *
 * Absent keys are omitted rather than defaulted, so a generic request produces
 * `{}` and therefore a distinct — and correctly shared — cache key.
 */
export function personalizationParams(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PERSONALIZATION_KEYS) {
    const value = url.searchParams.get(key);
    if (value != null && value !== "") out[key] = value;
  }
  return out;
}
