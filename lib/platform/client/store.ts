/**
 * Client-side asset store — the browser half of the Platform Data Layer.
 *
 * One normalized store of dataset entries, keyed exactly like the server's
 * cache, plus per-key subscriptions. This is what makes incremental refresh
 * possible: a component subscribes to `quote:AAPL`, and when a price tick
 * lands, *only* that component re-renders. The financial statements, the news
 * panel, the AI report, and the navigation do not, because they are subscribed
 * to different keys and their entries did not change.
 *
 * The research page previously held ~25 `useState` slots in one 1,700-line
 * client component, so every arriving fetch re-rendered the entire page — every
 * chart, every table, every card — regardless of what had actually changed.
 *
 * Client-safe: no server imports. Deliberately dependency-free (no TanStack
 * Query) — the project already ships its own data layer, and a second one would
 * be exactly the duplicated infrastructure this refactor exists to remove.
 */

"use client";

import type { DatasetId } from "../types";

export type EntryStatus = "idle" | "loading" | "success" | "error";

export interface StoreEntry<T = unknown> {
  status: EntryStatus;
  data: T | null;
  error: string | null;
  /** ms epoch of the last successful write. */
  updatedAt: number | null;
  /** True while a background refresh is running behind already-displayed data. */
  revalidating: boolean;
}

const IDLE: StoreEntry = {
  status: "idle",
  data: null,
  error: null,
  updatedAt: null,
  revalidating: false,
};

const entries = new Map<string, StoreEntry>();
const subscribers = new Map<string, Set<() => void>>();

/** Same key shape as the server cache, so client and server can be reasoned about together. */
export function key(dataset: DatasetId | string, symbol?: string | null): string {
  return symbol ? `${dataset}:${symbol.toUpperCase()}` : String(dataset);
}

export function getEntry<T>(k: string): StoreEntry<T> {
  return (entries.get(k) as StoreEntry<T> | undefined) ?? (IDLE as StoreEntry<T>);
}

/**
 * Notify only the components subscribed to this exact key.
 *
 * This is the entire mechanism behind "a price tick must not re-render the AI
 * report". There is no global store version, no context value that changes on
 * every write — nothing that would cascade a re-render into unrelated subtrees.
 */
function notify(k: string): void {
  const subs = subscribers.get(k);
  if (!subs) return;
  for (const fn of subs) fn();
}

export function subscribe(k: string, onChange: () => void): () => void {
  let subs = subscribers.get(k);
  if (!subs) {
    subs = new Set();
    subscribers.set(k, subs);
  }
  subs.add(onChange);

  return () => {
    const current = subscribers.get(k);
    if (!current) return;
    current.delete(onChange);
    if (current.size === 0) subscribers.delete(k);
  };
}

/**
 * Write an entry and wake its subscribers.
 *
 * Bails out when nothing meaningfully changed, so a re-fetch that returns the
 * same value (a poll that found no new trades) doesn't repaint the UI or reset
 * anything the user was interacting with.
 */
export function setEntry<T>(k: string, next: Partial<StoreEntry<T>>): void {
  const prev = getEntry<T>(k);
  const merged: StoreEntry<T> = { ...prev, ...next };

  const unchanged =
    merged.status === prev.status &&
    merged.error === prev.error &&
    merged.revalidating === prev.revalidating &&
    merged.data === prev.data;
  if (unchanged) return;

  entries.set(k, merged as StoreEntry);
  notify(k);
}

/** Mark a key as loading without discarding the data already on screen. */
export function setLoading(k: string, opts: { keepData?: boolean } = {}): void {
  const prev = getEntry(k);
  const hasData = prev.data != null;

  // Data already displayed stays displayed while a refresh runs behind it —
  // that is the difference between "refreshing" (no flicker, no layout shift)
  // and "loading" (skeleton). Blowing the data away here is what makes a page
  // flash empty on every background refresh.
  if (hasData && opts.keepData !== false) {
    setEntry(k, { revalidating: true, error: null });
    return;
  }
  setEntry(k, { status: "loading", data: null, error: null, revalidating: false });
}

export function setData<T>(k: string, data: T): void {
  setEntry<T>(k, {
    status: "success",
    data,
    error: null,
    updatedAt: Date.now(),
    revalidating: false,
  });
}

export function setError(k: string, error: string): void {
  const prev = getEntry(k);
  // A failed *refresh* must not erase good data that is already on screen. The
  // section shows its stale value plus a quiet "couldn't refresh" affordance,
  // rather than throwing away a perfectly usable answer because the retry failed.
  setEntry(k, {
    status: prev.data != null ? "success" : "error",
    error,
    revalidating: false,
  });
}

/** Drop entries for one symbol (or everything) — used when the user switches assets. */
export function resetSymbol(symbol?: string): void {
  const suffix = symbol ? `:${symbol.toUpperCase()}` : null;
  for (const k of [...entries.keys()]) {
    if (suffix == null || k.endsWith(suffix)) {
      entries.delete(k);
      notify(k);
    }
  }
}

/** Test/debug hook. */
export function _debugSnapshot(): Record<string, StoreEntry> {
  return Object.fromEntries(entries);
}
