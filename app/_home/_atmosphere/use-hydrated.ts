"use client";

/**
 * True only once hydrated.
 *
 * `toLocaleDateString`/`toLocaleTimeString` resolve against the *renderer's*
 * locale and timezone. Components using them are server-rendered before they
 * are hydrated, so the server (UTC) and the browser (wherever the user
 * actually is) format the same instant into different strings — and React
 * throws a hydration mismatch (#418), which the e2e suite catches as a
 * console error.
 *
 * `useSyncExternalStore` is the sanctioned way to express "this value differs
 * between server and client": the server snapshot returns false, the client
 * snapshot returns true, and nothing subscribes because the answer never
 * changes after mount. Doing it with `useState` + `useEffect` works too, but
 * sets state synchronously inside an effect, which is a cascading render that
 * React's lint rules (correctly) reject.
 *
 * Extracted from home-header.tsx so the page header and the Market Overview
 * card share one hydration gate for their locale-formatted timestamps.
 */

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
