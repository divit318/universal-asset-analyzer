"use client";

import { useCallback, useEffect, useRef } from "react";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { Card, Badge } from "@/app/_components/ui";
import type { PortfolioThesis as Thesis } from "@/lib/portfolio/thesis";

/**
 * The Portfolio Thesis + Identity banner — one AI-generated paragraph plus a
 * handful of persistent identity tags, shown once at the top of the page.
 *
 * Fetched from its OWN endpoint (see app/api/portfolio/thesis/route.ts),
 * independently of the deterministic report — an AI call has no business
 * blocking the dashboard's numbers. Cached server-side by portfolio content
 * hash, so it only regenerates when the holdings actually change.
 */
export function PortfolioThesisBanner({
  enabled,
  refreshSignal,
}: {
  enabled: boolean;
  /** Bump this (e.g. a counter) to force a refetch — used after a trade execution changes the holdings. */
  refreshSignal?: number;
}) {
  const fetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/portfolio/thesis", { signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio thesis");
    return json as Thesis;
  }, []);

  const { data, error, isInitialLoading, refresh } = useDataset<Thesis>("portfolioThesis", "default", fetcher, { enabled });

  // A brand-new dataset's very first fetch can lose a race with React's
  // dev-mode double-invoke of effects: the synthetic mount->cleanup->mount
  // cycle aborts the in-flight request before it resolves, and the store is
  // left reporting "loading" with nothing actually in flight to end it. A
  // forced refresh bypasses the "already loading" guard and starts a real
  // request, so a component that's still loading after a generous window
  // self-heals instead of showing a skeleton forever.
  const loadingRef = useRef(isInitialLoading);
  useEffect(() => {
    loadingRef.current = isInitialLoading;
  }, [isInitialLoading]);
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      if (loadingRef.current) refresh();
    }, 4000);
    return () => clearTimeout(t);
  }, [enabled, refresh]);

  // Holdings changed elsewhere (a trade was executed) — the server-side cache
  // is already keyed by portfolio content hash so it will honestly regenerate,
  // but the client has to be told to ask again; nothing does that automatically.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (refreshSignal != null) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only on refreshSignal changing, not on every `refresh` identity change.
  }, [refreshSignal]);

  if (!enabled) return null;

  // Surfaced separately from the loading state — otherwise a failed fetch
  // (e.g. a transient 503 during a dev rebuild) looks identical to "still
  // loading" forever, since both leave `data` null.
  if (error && !data) {
    return (
      <Card className="flex items-center justify-between gap-3 p-4">
        <p className="text-xs text-muted">Portfolio thesis unavailable right now.</p>
        <button onClick={refresh} className="text-xs text-brand hover:underline">Retry</button>
      </Card>
    );
  }

  if (isInitialLoading || !data) {
    return (
      <Card className="flex flex-col gap-2 p-5">
        <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2" />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-2.5 p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {data.identity.map((tag) => (
          <Badge key={tag} variant="brand">{tag}</Badge>
        ))}
      </div>
      <p className="text-sm leading-relaxed text-foreground">{data.thesis}</p>
    </Card>
  );
}
