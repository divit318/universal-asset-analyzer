"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shared core behind usePreview() (Optimize tab) and useCashPreview() (Cash
 * tab): both fire a POST 350ms after their inputs settle, and both need to
 * drop a response if a newer request has since superseded it. Only WHAT to
 * fetch and WHEN to skip entirely (an empty selection, a non-positive amount)
 * differ between them — the debounce/stale-guard plumbing was duplicated
 * byte-for-byte until this was extracted.
 *
 * `depsKey` must be a string that changes if and only if `fetcher`'s result
 * would differ — the effect re-runs on `depsKey`, not on `fetcher`'s identity,
 * exactly as both call sites already did with their own `selectionKey`/
 * `customTargetKey` locals.
 */
export function useDebouncedSimulation<T>(
  fetcher: () => Promise<T>,
  depsKey: string,
  skip: boolean,
  errorMessage: string,
): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (skip) {
      // Syncing local state to the (external, debounced) input going empty —
      // not derivable at render time.
      /* eslint-disable react-hooks/set-state-in-effect */
      setData(null);
      setError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    const id = ++requestId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetcherRef.current();
        if (requestId.current !== id) return; // a newer input superseded this request
        setData(result);
      } catch (e) {
        if (requestId.current === id) setError(e instanceof Error ? e.message : errorMessage);
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 350);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depsKey is the intentional, content-stable dependency; fetcher is read via fetcherRef.
  }, [depsKey, skip]);

  return { data, loading, error };
}
