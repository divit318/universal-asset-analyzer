/**
 * Client hooks over the platform store.
 *
 * `useDataset` is the one way a component asks for data. It gives every caller,
 * for free, the four things the old hand-rolled `useEffect` + `fetch` + five
 * `useState` slots per section did not:
 *
 *   1. Cancellation. Switching symbols aborts the in-flight request. Ten of the
 *      research page's eleven effects had no cancellation at all, so a slow
 *      response for the *previous* symbol could — and did — land after the new
 *      one and overwrite it.
 *   2. Deduplication. Two components asking for the same key mount one request.
 *   3. Granular re-render. Only components subscribed to the changed key repaint.
 *   4. Refresh without flicker. A background refresh keeps the current data on
 *      screen (`revalidating`) instead of blanking the section back to a skeleton.
 */

"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { dedupe, inflightKeys } from "../dedup";
import { getEntry, key as makeKey, setData, setError, setLoading, subscribe, type StoreEntry } from "./store";
import type { DatasetId } from "../types";

export interface UseDatasetOptions<T> {
  /** Skip fetching entirely (e.g. an equity-only section on a crypto asset). */
  enabled?: boolean;
  /** Seed the store from data already fetched elsewhere (the research bundle). */
  initialData?: T | null;
  /** How long a value stays fresh before a re-mount refetches it. Defaults to no refetch. */
  staleMs?: number;
}

export interface UseDatasetResult<T> extends StoreEntry<T> {
  /** Force a refresh, keeping the current data on screen while it runs. */
  refresh: () => void;
  /** True only on the first load — i.e. there is nothing to show yet. */
  isInitialLoading: boolean;
}

/**
 * Fetch and subscribe to one dataset.
 *
 * `fetcher` must be stable or cheap to recreate — it is only invoked on a real
 * miss, and is passed the AbortSignal it is expected to forward to `fetch`.
 */
export function useDataset<T>(
  dataset: DatasetId | string,
  symbol: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: UseDatasetOptions<T> = {},
): UseDatasetResult<T> {
  const { enabled = true, initialData = null, staleMs } = opts;
  const k = makeKey(dataset, symbol);

  const entry = useSyncExternalStore(
    useCallback((onChange) => subscribe(k, onChange), [k]),
    useCallback(() => getEntry<T>(k), [k]),
    // Server snapshot: the store is empty during SSR, which is correct —
    // sections render their skeletons and hydrate into the real fetch.
    useCallback(() => getEntry<T>(k), [k]),
  );

  // Keep the latest fetcher without making it a dependency of the effect below;
  // an inline arrow fetcher would otherwise re-trigger the fetch on every render.
  // Synced in an effect rather than during render — mutating a ref mid-render is
  // unsafe once React can discard a render pass.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const run = useCallback(
    (signal: AbortSignal, force: boolean) => {
      const current = getEntry<T>(k);

      if (!force) {
        // A "loading" status alone is not proof a request is actually running.
        // React's dev-mode double-invoke (mount -> cleanup -> mount) can abort
        // a brand-new key's very first fetch before it resolves: the aborting
        // consumer was the dedupe entry's last (only) subscriber, so the real
        // underlying request gets cancelled too, and the store is left saying
        // "loading" forever with nothing in flight to end it. Checking the
        // dedupe registry directly — the actual source of truth for what's
        // running — means a second mount reliably restarts a fetch instead of
        // trusting a status flag that can outlive the work it described.
        if (current.status === "loading" && inflightKeys().includes(`client:${k}`)) return;
        const isFresh =
          current.status === "success" &&
          current.updatedAt != null &&
          (staleMs == null || Date.now() - current.updatedAt < staleMs);
        if (isFresh) return;
      }

      setLoading(k, { keepData: force });

      // Deduped by key across the whole app: two components mounting the same
      // section at once share one HTTP request.
      void dedupe(`client:${k}`, (s) => fetcherRef.current(s), { signal })
        .then((data) => {
          if (signal.aborted) return;
          setData(k, data);
        })
        .catch((err: unknown) => {
          // An abort is not a failure — it means the user moved on, and writing
          // an error here would paint a spurious "Failed to load" on a section
          // the user is no longer even looking at.
          if (signal.aborted || (err instanceof Error && err.name === "AbortError")) return;
          setError(k, err instanceof Error ? err.message : "Request failed");
        });
    },
    [k, staleMs],
  );

  useEffect(() => {
    if (!enabled) return;

    if (initialData != null && getEntry<T>(k).data == null) {
      setData(k, initialData);
      return;
    }

    const controller = new AbortController();
    run(controller.signal, false);

    // Cancellation on unmount / symbol change / dependency change. This is the
    // fix for stale-response races: the old request is aborted the instant the
    // symbol changes, so it can never resolve and clobber the new symbol's data.
    return () => controller.abort();
  }, [k, enabled, run, initialData]);

  const refreshRef = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    refreshRef.current?.abort();
    const controller = new AbortController();
    refreshRef.current = controller;
    run(controller.signal, true);
  }, [run]);

  return {
    ...entry,
    refresh,
    /*
     * "There is nothing to show yet" — which includes the `idle` tick before the
     * effect has run, not just `loading`.
     *
     * Missing the idle case made this false on the very first paint, so a page
     * that renders `empty` as `!isInitialLoading && !data` flashed its
     * empty state before any request had even started. /portfolio told a user
     * with 26 holdings "No holdings yet." for the first frame, and showed no
     * skeleton for the ~10s that followed.
     *
     * Gated on `enabled`: a deliberately-disabled dataset is not loading, it is
     * simply not wanted, and reporting it as loading would leave callers that
     * derive readiness from this (lib/ios-context.tsx) waiting forever.
     */
    isInitialLoading: enabled && entry.data == null && (entry.status === "loading" || entry.status === "idle"),
  };
}

/** Read a dataset without fetching it — for components that only display what's already loaded. */
export function useDatasetValue<T>(dataset: DatasetId | string, symbol: string | null): StoreEntry<T> {
  const k = makeKey(dataset, symbol);
  return useSyncExternalStore(
    useCallback((onChange) => subscribe(k, onChange), [k]),
    useCallback(() => getEntry<T>(k), [k]),
    useCallback(() => getEntry<T>(k), [k]),
  );
}
