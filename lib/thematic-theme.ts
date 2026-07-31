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
