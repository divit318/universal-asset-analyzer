/**
 * Focus-symbol spine — the pure list mechanics (§4.4).
 *
 * The "working set" the app carries between tools: the last few symbols the user
 * acted on, most-recent first, deduped. This module is deliberately free of
 * React and of storage so the ordering/dedupe/cap rules are unit-testable in
 * isolation; the provider (lib/focus-context.tsx) owns persistence and the
 * sessionStorage side effects.
 */

/** How many symbols the spine remembers (§4.4 — "the last 5 symbols"). */
export const FOCUS_CAP = 5;

/**
 * Record `symbol` as the most-recent focus: normalized (trim + uppercase),
 * moved to the front, de-duplicated, and capped. A blank symbol is a no-op that
 * still returns a capped copy of the list.
 */
export function pushFocusSymbol(list: readonly string[], symbol: string, cap: number = FOCUS_CAP): string[] {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return list.slice(0, cap);
  return [sym, ...list.filter((s) => s !== sym)].slice(0, cap);
}

/**
 * Coerce whatever came out of sessionStorage into a clean focus list: strings
 * only, normalized, de-duplicated, capped. Anything malformed yields an empty
 * list rather than throwing — a corrupt storage blob must never break a paint.
 */
export function sanitizeFocusList(raw: unknown, cap: number = FOCUS_CAP): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim().toUpperCase();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}
