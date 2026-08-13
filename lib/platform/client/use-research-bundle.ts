/**
 * Consume the orchestrated research bundle stream.
 *
 * This is the client end of the seam described in `app/api/research/bundle`:
 * the server runs every independent request concurrently and flushes each step
 * the instant it settles; this hook writes each one into the platform store as
 * it arrives. Because the store notifies per key, the quote card paints the
 * moment the quote lands (~160ms) while the peer comparison is still fanning out
 * across the sector — and when peers finally arrives, *only* the peer card
 * re-renders.
 *
 * Failed steps are written as per-section errors, not as a page-level failure.
 * If news times out, the news card says so and the other eleven sections carry
 * on exactly as if nothing happened.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { resetSymbol, setData, setError, setLoading, key as makeKey } from "./store";

/** The step ids the bundle emits — one per rendering region on the page. */
export const BUNDLE_STEPS = [
  "quote",
  "history",
  "benchmarkHistory",
  "profile",
  "sectorHistory",
  "filings",
  "news",
  "fundamentals",
  "peers",
  "sectorRotation",
] as const;

export type BundleStep = (typeof BUNDLE_STEPS)[number];

export interface BundleState {
  /** Whether the stream itself is still open. Individual sections have their own status in the store. */
  streaming: boolean;
  /** A fatal error — a bad ticker, or the stream never opened. Section-level errors do NOT appear here. */
  error: string | null;
  /** Server-reported wall-clock for the whole plan, once complete. */
  durationMs: number | null;
  /** True when at least one section failed but the page still has data. */
  partial: boolean;
}

interface StreamLine {
  type: "step" | "meta" | "done" | "error";
  id?: BundleStep;
  status?: "ok" | "failed" | "skipped" | "cancelled";
  data?: unknown;
  error?: string | null;
  durationMs?: number;
  partial?: boolean;
  assetClass?: string;
  isEquity?: boolean;
}

export function useResearchBundle(symbol: string | null): BundleState {
  const [state, setState] = useState<BundleState>({
    streaming: false,
    error: null,
    durationMs: null,
    partial: false,
  });

  // Guards against a slow response for a previous symbol landing after the user
  // has already moved on. The AbortController below is the primary defence; this
  // is belt-and-braces for the tick between abort and the fetch actually unwinding.
  const activeSymbol = useRef<string | null>(null);

  useEffect(() => {
    if (!symbol) return;

    activeSymbol.current = symbol;
    const controller = new AbortController();

    // Every section goes to skeleton at once, and the previous symbol's entries
    // are dropped, so a stale value can never be shown under a new ticker.
    resetSymbol(symbol);
    for (const step of BUNDLE_STEPS) setLoading(makeKey(step, symbol), { keepData: false });

    setState({ streaming: true, error: null, durationMs: null, partial: false });

    void (async () => {
      try {
        const res = await fetch(`/api/research/bundle?symbol=${encodeURIComponent(symbol)}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Research failed (${res.status})`);
        }
        if (!res.body) throw new Error("Streaming is not supported by this browser");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // NDJSON: complete lines only. A partial trailing line stays in the
          // buffer until the rest of it arrives — parsing it early would throw.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (activeSymbol.current !== symbol) return;

            let msg: StreamLine;
            try {
              msg = JSON.parse(trimmed) as StreamLine;
            } catch {
              continue; // a malformed line must not kill the stream
            }

            applyMessage(msg, symbol, setState);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return; // the user moved on; not an error
        if (activeSymbol.current !== symbol) return;
        setState((s) => ({
          ...s,
          streaming: false,
          error: err instanceof Error ? err.message : "Research failed",
        }));
      } finally {
        if (activeSymbol.current === symbol) {
          setState((s) => ({ ...s, streaming: false }));
        }
      }
    })();

    return () => controller.abort();
  }, [symbol]);

  return state;
}

function applyMessage(
  msg: StreamLine,
  symbol: string,
  setState: React.Dispatch<React.SetStateAction<BundleState>>,
): void {
  switch (msg.type) {
    case "step": {
      if (!msg.id) return;
      const k = makeKey(msg.id, symbol);
      if (msg.status === "ok") {
        setData(k, msg.data);
      } else {
        // A section that failed, was skipped because its dependency failed, or
        // was cancelled — each is a per-section state, never a page failure.
        setError(k, msg.error ?? sectionErrorFor(msg.status));
      }
      return;
    }
    case "done":
      setState((s) => ({
        ...s,
        streaming: false,
        durationMs: msg.durationMs ?? null,
        partial: msg.partial ?? false,
      }));
      return;
    case "error":
      setState((s) => ({ ...s, streaming: false, error: msg.error ?? "Research failed" }));
      return;
    default:
      return;
  }
}

function sectionErrorFor(status: StreamLine["status"]): string {
  if (status === "skipped") return "Unavailable — depends on data that couldn't be loaded";
  if (status === "cancelled") return "Cancelled";
  return "Unavailable";
}
