import type { ThematicReport } from "@/lib/thematic-engine";
import { isRenderableReport } from "@/lib/thematic-theme";

const RECENT_KEY = "uaa_thematic_recent";
/** Also referenced (as a literal, with a pointer here) by app/thematic/error.tsx. */
export const STORAGE_KEY = "uaa_thematic_last_report";

/**
 * Accept a stored report only if it has the fields this page renders.
 *
 * sessionStorage outlives the code that wrote it. A report saved by an earlier
 * version has no `integrity` or `factors`, so restoring it blindly crashed the
 * page on first paint with no way for the user to recover except clearing
 * storage by hand. The check itself is the shared `isRenderableReport` — the
 * same one the API route applies to platform-cache hits, so the two storage
 * tiers can never drift apart in what they consider renderable.
 */
export function asCurrentReport(value: unknown): ThematicReport | null {
  return isRenderableReport(value) ? value : null;
}

/**
 * Locally remembered themes.
 *
 * A report costs minutes of local inference, and the server now caches it — so
 * a list of what has already been researched is a list of one-click, instant
 * reports. Previously the page kept exactly one report in sessionStorage and
 * forgot every other theme the moment you searched again.
 */
export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function pushRecent(theme: string): string[] {
  const next = [theme, ...readRecent().filter((t) => t.toLowerCase() !== theme.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
  return next;
}
