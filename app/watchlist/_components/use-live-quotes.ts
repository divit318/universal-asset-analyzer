"use client";

/**
 * Live prices for a set of symbols.
 *
 * Reuses the existing `/api/quote` batch endpoint — one request for all 57
 * symbols, no new backend — and puts all of the intelligence into *when* to
 * issue it (`lib/live-quotes.ts`). The hook itself only has to guarantee the
 * mechanical properties that a naive `setInterval` gets wrong:
 *
 * - **Never two requests in flight.** A slow response must not pile up behind
 *   the next tick; the in-flight guard skips rather than queues.
 * - **Cancel on unmount and on re-key.** An `AbortController` per attempt, so
 *   navigating away mid-request neither warns nor writes into a dead component.
 * - **Refetch immediately when the tab is looked at again**, because the first
 *   thing a returning user does is read the prices.
 * - **Never clobber good data with an error.** A failed poll leaves the last
 *   good snapshot on screen and surfaces staleness through `lastUpdatedAt`,
 *   which is far more useful than blanking 57 rows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Quote } from "@/lib/types";
import type { MarketRegion } from "@/lib/market";
import { resolvePollInterval } from "@/lib/live-quotes";

export type LiveStatus = "idle" | "polling" | "paused" | "error";

export interface LiveQuotes {
  quotes: Record<string, Quote>;
  /** Epoch ms of the last successful fetch, or null before the first one. */
  lastUpdatedAt: number | null;
  status: LiveStatus;
  error: string | null;
  /** Symbols whose price moved on the most recent successful fetch. */
  moved: Record<string, "up" | "down">;
  /** Force an immediate refresh, bypassing the schedule. */
  refreshNow: () => void;
}

export function useLiveQuotes(
  symbols: string[],
  regions: MarketRegion[],
  options: { enabled?: boolean; onQuotes?: (q: Record<string, Quote>) => void } = {},
): LiveQuotes {
  const { enabled = true } = options;

  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, "up" | "down">>({});
  /**
   * Whether the schedule has deliberately stopped (hidden tab, or every tracked
   * market closed). Only ever written from event handlers and timer callbacks —
   * `status` itself is DERIVED below rather than stored, which is what keeps the
   * effect free of synchronous setState.
   */
  const [paused, setPaused] = useState(false);

  /**
   * The symbol set of the request currently running, or null.
   *
   * Deliberately not a boolean. A boolean "is a request in flight" guard is
   * correct for suppressing duplicate polls but WRONG when the symbol set
   * changes: the watchlist's first paint knows the benchmark before it knows the
   * holdings, so the opening request is for one symbol and is immediately
   * superseded by one for 58. With a boolean, the superseding call saw
   * `inFlight === true` — the aborted first request had not yet reached its
   * `finally` — skipped, and the table then sat empty until the next scheduled
   * tick. Keying by symbol set lets a *different* request supersede while still
   * skipping an *identical* one.
   */
  const inFlightKey = useRef<string | null>(null);
  const errorsRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quotesRef = useRef<Record<string, Quote>>({});
  // Callback identity changes every render in practice; hold it in a ref so it
  // never becomes a reason to tear down and re-arm the schedule. Synced in an
  // effect rather than during render — a ref write during render is not safe
  // under concurrent rendering.
  const onQuotesRef = useRef(options.onQuotes);
  useEffect(() => {
    onQuotesRef.current = options.onQuotes;
  }, [options.onQuotes]);

  // Stable dependency for the effect: the symbol SET, not the array identity.
  const symbolsKey = [...symbols].map((s) => s.toUpperCase()).sort().join(",");

  /**
   * Regions live in a ref, NOT in the effect's dependencies.
   *
   * They influence only the *cadence* (open markets poll faster), never what to
   * request. As a dependency they caused a self-inflicted extra round-trip on
   * every mount: the caller derives the region set from the quotes themselves, so
   * the first successful response changed `regions`, which tore down the schedule
   * and immediately re-fetched prices that had just arrived. Read at scheduling
   * time instead, so a region change simply adjusts the next interval.
   */
  const regionsRef = useRef<MarketRegion[]>(regions);
  const regionsKey = [...new Set(regions)].sort().join(",");
  useEffect(() => {
    regionsRef.current = regionsKey ? (regionsKey.split(",") as MarketRegion[]) : [];
  }, [regionsKey]);

  /**
   * Cancel the running request and release the slot, synchronously.
   *
   * Releasing the key here rather than in the aborted request's `finally` is what
   * makes the guard safe: an aborted request will never deliver data, so it must
   * stop blocking the next attempt the instant it is cancelled. Without this,
   * React's development double-mount could abort the only request that was going
   * to populate the table and leave the next call skipping against a key that no
   * live request owned.
   */
  const abortInFlight = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightKey.current = null;
  }, []);

  const fetchOnce = useCallback(async () => {
    const list = symbolsKey ? symbolsKey.split(",") : [];
    if (list.length === 0) return;
    // An identical poll is already running — skip rather than queue. A poll for a
    // different set supersedes instead.
    if (inFlightKey.current === symbolsKey) return;

    abortInFlight();
    inFlightKey.current = symbolsKey;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/quote?symbols=${encodeURIComponent(list.join(","))}`, {
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Quote provider did not respond");

      const next: Record<string, Quote> = {};
      for (const q of (json.quotes ?? []) as Quote[]) next[q.symbol] = q;

      // Flash only what a reader could actually see change, comparing the
      // rendered value rather than the raw float.
      const previous = quotesRef.current;
      const changes: Record<string, "up" | "down"> = {};
      for (const [sym, q] of Object.entries(next)) {
        const before = previous[sym];
        if (!before || before.price.toFixed(2) === q.price.toFixed(2)) continue;
        changes[sym] = q.price > before.price ? "up" : "down";
      }

      quotesRef.current = next;
      errorsRef.current = 0;
      setQuotes(next);
      setMoved(changes);
      setLastUpdatedAt(Date.now());
      setError(null);
      setPaused(false);
      onQuotesRef.current?.(next);
    } catch (err) {
      if (controller.signal.aborted) return; // deliberate cancellation, not a failure
      errorsRef.current += 1;
      // Deliberately does NOT clear `quotes`: stale prices plus an explicit
      // "as of" timestamp beat 57 empty rows.
      setError(err instanceof Error ? err.message : "Live price refresh failed");
    } finally {
      // Only clear if a newer request has not already claimed the slot.
      if (inFlightKey.current === symbolsKey) inFlightKey.current = null;
    }
  }, [symbolsKey, abortInFlight]);

  const refreshNow = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    // No synchronous setState here: `status` is derived from `enabled`,
    // `symbolsKey`, `error` and `paused` at the bottom of the hook.
    if (!enabled || !symbolsKey) return;

    let cancelled = false;

    const arm = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const wait = resolvePollInterval({
        regions: regionsRef.current,
        visible: typeof document === "undefined" || document.visibilityState === "visible",
        consecutiveErrors: errorsRef.current,
      });
      if (wait == null) {
        setPaused(true);
        return;
      }
      setPaused(false);
      timerRef.current = setTimeout(async () => {
        if (cancelled) return;
        await fetchOnce();
        if (!cancelled) arm();
      }, wait);
    };

    /* Fetch once on mount / whenever the symbol set changes, then schedule.
       The rule cannot see that every setState inside `fetchOnce` happens in a
       microtask after an `await`, never synchronously during the effect — and
       "load when the subject changes" is the same shape as `useFreshQuote` and
       the Watchlist page's own `load`, both of which suppress it here too. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchOnce().then(() => {
      if (!cancelled) arm();
    });

    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        // Returning to the tab: the on-screen prices are as stale as the time
        // away, so refresh immediately rather than waiting out an interval.
        void fetchOnce().then(() => {
          if (!cancelled) arm();
        });
      } else {
        if (timerRef.current) clearTimeout(timerRef.current);
        abortInFlight();
        setPaused(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
      abortInFlight();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, enabled]);

  /**
   * Derived, not stored. Storing it meant writing state synchronously inside the
   * scheduling effect, and it was redundant besides: every value below is already
   * knowable from the four pieces of state that genuinely change.
   */
  const status: LiveStatus =
    !enabled || symbolsKey.length === 0
      ? "idle"
      : error != null
        ? "error"
        : paused
          ? "paused"
          : lastUpdatedAt == null
            ? "idle"
            : "polling";

  return { quotes, lastUpdatedAt, status, error, moved, refreshNow };
}
