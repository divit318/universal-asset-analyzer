/**
 * Theme-string rules for the Thematic Research module.
 *
 * Client-safe by design (pure data + pure functions, no imports). It lives
 * apart from `lib/thematic-engine.ts` because the engine reaches `lib/db.ts`
 * and therefore `node:sqlite` — so importing *any runtime value* from it inside
 * a client component drags the whole server-only module into the browser bundle
 * and the page fails to build. Types are erased at compile time and are safe to
 * import from the engine; constants and functions are not, and belong here.
 *
 * Both sides share this file, so the input cap the search box enforces and the
 * cap the API rejects on can never drift apart.
 */

/**
 * Longest theme a prompt will carry. The theme string is interpolated into
 * eight prompts, so an unbounded one both blows the context window eight times
 * over and hands the model an arbitrarily long instruction block of the user's
 * choosing.
 */
export const MAX_THEME_LENGTH = 120;

/**
 * Collapse a raw search box value into the canonical theme used for prompts,
 * cache keys, and display. Strips control characters (which can smuggle
 * fake role markers into a prompt), collapses whitespace, and bounds length.
 */
export function normalizeTheme(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_THEME_LENGTH);
}

/** Stable cache identity — "AI  Compute" and "ai compute" are the same research question. */
export function themeCacheKey(theme: string): string {
  return normalizeTheme(theme).toLowerCase();
}

/**
 * The report shape's version, carried in the cache key.
 *
 * Persisted reports outlive the code that wrote them by up to the SWR window
 * (~6.5 days), and the page renders a served report without re-validating it —
 * a report written by an older engine shape (no `newsItems`, no `integrity`)
 * crashed the page on first paint once already, via the sessionStorage tier.
 * Bumping this constant when ThematicReport changes shape turns every
 * old-shape row into a clean cache miss instead of a render-time surprise.
 * The orphaned rows age out through the platform cache's normal pruning.
 */
export const REPORT_SCHEMA_VERSION = 3;

// Type-only import: erased at compile time, so this module stays client-safe
// (see the header comment — importing a runtime VALUE from the engine would
// drag node:sqlite into the browser bundle; a type costs nothing).
import type { ThematicReport } from "./thematic-engine";

/**
 * Structural check that a value has every field the report UI renders and
 * every array it iterates. THE one validator for stored reports — used by the
 * API route on a platform-cache hit and by the page on a sessionStorage
 * restore, so the two tiers can never drift apart again (the sessionStorage
 * tier was guarded after a crash; the disk tier was not, and served old-shape
 * reports for up to the SWR window).
 *
 * Deliberately shallow beyond array-ness: extractJsonObject-style coercion
 * has already shaped item internals at write time, and the crashes this
 * guards against are `.length`/`.map` on a missing collection.
 */
export function isRenderableReport(value: unknown): value is ThematicReport {
  const r = value as Partial<ThematicReport> | null;
  if (!r || typeof r !== "object") return false;
  if (typeof r.theme !== "string" || typeof r.generatedAt !== "string") return false;
  if (!r.futureState || !r.bottleneck || !r.commodityFramework) return false;
  if (!r.supplyDemand || !Array.isArray(r.supplyDemand.commodityProxies)) return false;
  if (!r.policy || !Array.isArray(r.policy.relevantPolicies) || !Array.isArray(r.policy.geopoliticalFactors)) return false;
  if (!r.structuralAdvantage || !Array.isArray(r.structuralAdvantage.regions)) return false;
  const o = r.opportunity;
  if (!o || typeof o.themeScore !== "number" || typeof o.verdict !== "string") return false;
  if (!Array.isArray(o.factors) || !Array.isArray(o.riskFlags) || !Array.isArray(o.analystChecklist) || !Array.isArray(o.topCompanies)) return false;
  if (!Array.isArray(r.dependencyChain) || !Array.isArray(r.tierCompanies) || !Array.isArray(r.newsItems) || !Array.isArray(r.stageFailures)) return false;
  const i = r.integrity;
  if (!i || !Array.isArray(i.caveats) || !Array.isArray(i.missingStages)) return false;
  if (!r.universePreview || !Array.isArray(r.universePreview.candidates)) return false;
  return true;
}
