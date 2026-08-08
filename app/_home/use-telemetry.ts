"use client";

/**
 * useTelemetry - the dashboard's fire-and-forget event recorder (IN-05).
 *
 * The use-record-activity precedent, generalized (IN-06): recording that you
 * dismissed a row must never be able to break the page that showed you the
 * row. Every path is wrapped, nothing is awaited by callers, and a dead
 * telemetry route costs events, never UI.
 *
 * Batching: events buffer at module level and flush every 5s, at 20 events,
 * and on pagehide / tab-hide via navigator.sendBeacon (fetch keepalive as the
 * fallback), so tab-close events are not lost. One sessionId per page load
 * (random UUID, never an identity - NORTH-STAR: no PII) is the join key for
 * per-session analyses like score calibration.
 *
 * SSR-safe: on the server track() is a no-op and no timer or listener exists.
 */

import type { HomeEventName } from "@/lib/home/telemetry-read";

export type TelemetryProps = Record<string, string | number | boolean | null>;

interface BufferedEvent {
  at: number;
  event: HomeEventName;
  props?: TelemetryProps;
}

const FLUSH_MS = 5_000;
const FLUSH_AT_COUNT = 20;

/** One id per page load. Module-level so every hook instance shares it. */
let sessionId: string | null = null;
let buffer: BufferedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;

function flush(): void {
  if (buffer.length === 0 || sessionId == null) return;
  const events = buffer;
  buffer = [];
  const payload = JSON.stringify({ sessionId, events });
  try {
    // sendBeacon survives page teardown; it is the only reliable pagehide path.
    if (navigator.sendBeacon?.("/api/home/telemetry", new Blob([payload], { type: "application/json" }))) {
      return;
    }
  } catch {
    // Fall through to fetch.
  }
  try {
    void fetch("/api/home/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Best-effort: a lost batch is acceptable, a thrown one is not.
    });
  } catch {
    // Same. Telemetry never throws into a component.
  }
}

function ensurePlumbing(): void {
  if (sessionId == null) {
    sessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  if (timer == null) timer = setInterval(flush, FLUSH_MS);
  if (!listenersBound) {
    listenersBound = true;
    // pagehide is the reliable teardown signal; visibilitychange:hidden also
    // flushes so a backgrounded-then-killed tab loses nothing.
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
}

/** The stable emit function. Callable from any component or handler. */
export function track(event: HomeEventName, props?: TelemetryProps): void {
  if (typeof window === "undefined") return; // SSR: no-op by design
  try {
    ensurePlumbing();
    buffer.push(props ? { at: Date.now(), event, props } : { at: Date.now(), event });
    if (buffer.length >= FLUSH_AT_COUNT) flush();
  } catch {
    // Never let instrumentation reach the component tree.
  }
}

/** Per-page-load dedupe keys (e.g. page_visit fires once even under React
 *  strict mode's double-invoked effects). */
const onceKeys = new Set<string>();

export function trackOnce(key: string, event: HomeEventName, props?: TelemetryProps): void {
  if (typeof window === "undefined") return;
  if (onceKeys.has(key)) return;
  onceKeys.add(key);
  track(event, props);
}

/** Hook form: a stable track() so emit calls can live in deps arrays safely.
 *  (track is module-level and already referentially stable; the hook exists so
 *  call sites read as React idiom and so the plumbing can move later without
 *  touching emitters.) */
export function useTelemetry(): (event: HomeEventName, props?: TelemetryProps) => void {
  return track;
}
