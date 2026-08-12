import { resolveAiMode } from "./mode";

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
  // The unified action (Research × Fit) — the prompt pins the model's
  // suggested action to it, so it must be part of the cache identity.
  "action",
  "actionReason",
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

/**
 * The STABLE subset of the personalization that participates in the cache key.
 *
 * Phase 2 finding (2026-08-11): keying the verdict on the raw personalization
 * made the 6h cache useless for exactly the users it matters most for. The key
 * embedded `fitScore` (moves a point with any market tick), `reasons` and
 * `actionReason` (free text that quotes BOTH live scores verbatim), and an
 * unrounded `suggestedPct` — so the store held three AAPL verdicts at
 * fitScore 59/60/61, each a separate full generation of the same thesis.
 *
 * The identity below keeps every dimension that MATERIALLY changes the
 * conclusion — the fit *tier*, the computed *action*, whether it's already
 * held, the user's objective, and their sector gaps — and drops the volatile
 * details, which still reach the prompt (a cache MISS still generates with
 * the exact live numbers). A cached verdict can therefore cite a fit score a
 * point or two off today's — bounded by the tier band and the 6h TTL, and the
 * hero's direction/score are computed live in code, never read from the
 * cached prose.
 */
export function stableVerdictIdentity(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  // The AI depth mode changes which model writes the verdict, so it is part
  // of the cache identity — a Fast user must never be served a Deep user's
  // verdict or vice versa. `balanced` (the default) is deliberately UNMARKED
  // so every verdict cached before modes existed remains a balanced hit.
  {
    const mode = resolveAiMode();
    if (mode !== "balanced") out.aiMode = mode;
  }
  if (params.fitTier) out.fitTier = params.fitTier;
  if (params.action) out.action = params.action;
  if (params.isInPortfolio) out.isInPortfolio = params.isInPortfolio;
  if (params.objective) out.objective = params.objective;
  // Sector gaps change only when the portfolio's composition changes; sort so
  // an ordering difference can't fork the cache.
  if (params.missingSectors) {
    out.missingSectors = params.missingSectors
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort()
      .join(",");
  }
  // Position size to the nearest whole percent: 4.5% vs 4.6% is the same
  // advice; 0% vs 5% is not (and usually differs in `action` anyway).
  if (params.suggestedPct) {
    const pct = Number(params.suggestedPct);
    if (Number.isFinite(pct)) out.suggestedPct = String(Math.round(pct));
  }
  return out;
}
