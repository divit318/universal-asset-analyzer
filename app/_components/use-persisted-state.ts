"use client";

/**
 * Persisted view state.
 *
 * A portfolio manager who always ranks by upside should not have to re-sort on
 * every visit, and the density toggle was resetting to Dense on every navigation
 * even though the component documented it as "remembered by the caller if it
 * wants to persist it" — nobody did.
 *
 * Written to localStorage rather than to the URL because this is a single-user
 * self-hosted app and the value wanted is "how I like to look at my watchlist",
 * which should survive a reload and a fresh tab, not travel in a link.
 *
 * Hydration: the first render always uses the fallback so server and client
 * markup agree, and the stored value is adopted immediately afterwards. A stored
 * value is validated before adoption, so hand-edited or stale storage cannot put
 * the table into a state it has no column for.
 *
 * Lived in app/watchlist/_components/use-view-state.ts until The Wire needed the
 * same pattern for per-section collapse state; promoted here so neither page
 * imports from the other's _components.
 */

import { useEffect, useState } from "react";

export function usePersistedState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      /* private mode / storage disabled — the fallback is a fine answer */
    }
    if (stored == null) return;
    try {
      const parsed: unknown = JSON.parse(stored);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- adopting persisted state after mount is the only way to avoid a hydration mismatch; it cannot be derived during render because localStorage does not exist on the server
      if (isValid(parsed)) setValue(parsed);
    } catch {
      /* corrupt entry — ignore it rather than crash the page */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `isValid` is a stable predicate defined at module scope by every caller; re-running on its identity would re-read storage and clobber a user's in-session change
  }, [key]);

  const update = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* best-effort */
    }
  };

  return [value, update];
}
