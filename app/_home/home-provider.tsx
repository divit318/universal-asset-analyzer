"use client";

/**
 * HomeProvider — the homepage's single data source.
 *
 * Ten modules, one `/api/home` request. Each module selects its slice via
 * `useHomeSlice()`; none of them fetches. This is the "do not introduce
 * unnecessary network requests" requirement enforced structurally rather than
 * by convention — a module *cannot* fetch the digest itself, because it is
 * handed the data.
 *
 * Both fetches go through `useDataset`, the platform's client hook, rather than
 * a hand-rolled `useEffect` + `fetch` + `useState`. CLAUDE.md is explicit about
 * this and the reason is not stylistic: `useDataset` is built on
 * `useSyncExternalStore`, so it brings cancellation on unmount, cross-component
 * deduplication, and refresh-without-flicker — and a bare effect-and-fetch is
 * the exact pattern that left ten stale-response races on the research page.
 *
 * The AI brief is a second, independent dataset. It is deliberately not awaited
 * alongside the digest: the digest paints the page, and the narrative fills in
 * when the local model gets to it. Until then (and forever, if Ollama is down)
 * Today's Brief renders `fallbackBriefing`, which shipped inside the digest and
 * is always true.
 *
 * State lives here; presentation lives in the modules. Phase 2 rewrites the
 * modules and never touches this file.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { useBootReady } from "@/app/_components/boot-context";
import type { SectionState } from "@/app/_components/ui";
import type { HomeBrief, HomeBriefChunk, HomeDigest } from "@/lib/home/contracts";
import type { HomeModuleId, ModuleLifecycleEvent } from "@/lib/home/types";

interface HomeContextValue {
  digest: SectionState<HomeDigest>;
  brief: SectionState<HomeBrief>;
  refreshDigest: () => void;
  refreshBrief: () => void;
  /**
   * Phase 2's animation seam. Modules emit lifecycle events; nothing consumes
   * them yet. When motion lands, a listener registered here can drive
   * enter/exit/refresh transitions without any module knowing it is animated.
   */
  emit: (event: ModuleLifecycleEvent, moduleId: HomeModuleId) => void;
  subscribe: (listener: (event: ModuleLifecycleEvent, moduleId: HomeModuleId) => void) => () => void;
}

const HomeContext = createContext<HomeContextValue | null>(null);

/* ------------------------------------------------------------------ */
/* Fetchers                                                            */
/* ------------------------------------------------------------------ */

async function fetchDigest(signal: AbortSignal): Promise<HomeDigest> {
  const res = await fetch("/api/home", { signal });
  if (!res.ok) throw new Error(`Couldn't load your dashboard (${res.status})`);
  return (await res.json()) as HomeDigest;
}

/**
 * Reads the NDJSON brief stream to completion and returns the assembled brief.
 *
 * `useDataset` resolves a section once, so the intermediate chunks aren't
 * surfaced as separate renders — but reading them incrementally still matters:
 * a stream that dies halfway leaves us holding the headline rather than nothing,
 * and the headline is the part the user actually reads.
 */
async function fetchBrief(signal: AbortSignal): Promise<HomeBrief> {
  const res = await fetch("/api/home/brief", { signal });
  if (!res.ok || !res.body) throw new Error(`Brief unavailable (${res.status})`);

  const acc: HomeBrief = {
    headline: "",
    note: null,
    portfolioSummary: "",
    aiGenerated: false,
    generatedAt: new Date().toISOString(),
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // The trailing element is an incomplete line; hold it for the next read.
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      let chunk: HomeBriefChunk;
      try {
        chunk = JSON.parse(line) as HomeBriefChunk;
      } catch {
        continue; // A torn line is not worth failing the stream over.
      }

      if (chunk.type === "headline") acc.headline = chunk.text;
      else if (chunk.type === "portfolioSummary") acc.portfolioSummary = chunk.text;
      else if (chunk.type === "note") acc.note = chunk.note;
      else if (chunk.type === "done") {
        acc.aiGenerated = chunk.aiGenerated;
        acc.generatedAt = chunk.generatedAt;
      } else if (chunk.type === "error") {
        throw new Error(chunk.message);
      }
    }
  }

  if (!acc.headline) throw new Error("Brief unavailable");
  return acc;
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export function HomeProvider({ children }: { children: ReactNode }) {
  const digest = useDataset<HomeDigest>("home.digest", null, fetchDigest);
  const brief = useDataset<HomeBrief>("home.brief", null, fetchBrief);

  // The digest alone paints the page — the brief is deliberately independent
  // (see file doc comment), so the boot splash shouldn't wait on it either.
  useBootReady(digest.status !== "loading", "home");

  const listeners = useRef(new Set<(e: ModuleLifecycleEvent, id: HomeModuleId) => void>());

  const emit = useCallback((event: ModuleLifecycleEvent, moduleId: HomeModuleId) => {
    for (const l of listeners.current) l(event, moduleId);
  }, []);

  const subscribe = useCallback((listener: (e: ModuleLifecycleEvent, id: HomeModuleId) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<HomeContextValue>(
    () => ({
      // StoreEntry is structurally a SectionState plus `updatedAt`, which the
      // Section primitive ignores.
      digest,
      brief,
      refreshDigest: digest.refresh,
      refreshBrief: brief.refresh,
      emit,
      subscribe,
    }),
    [digest, brief, emit, subscribe],
  );

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>;
}

export function useHome(): HomeContextValue {
  const ctx = useContext(HomeContext);
  if (!ctx) throw new Error("useHome must be used inside <HomeProvider>");
  return ctx;
}

/**
 * Selects one module's slice out of the digest, preserving the surrounding
 * `SectionState` so the module gets loading/error/revalidating for free.
 *
 * This is the seam that keeps modules ignorant of the digest's shape: a module
 * asks for its own slice and never sees the other nine.
 */
export function useHomeSlice<K extends keyof HomeDigest>(key: K): SectionState<HomeDigest[K]> {
  const { digest } = useHome();
  return useMemo(
    () => ({
      status: digest.status === "idle" ? "loading" : digest.status,
      data: digest.data ? digest.data[key] : null,
      error: digest.error,
      revalidating: digest.revalidating,
    }),
    [digest, key],
  );
}
