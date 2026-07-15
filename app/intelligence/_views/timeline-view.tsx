"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { TimelineEvent, TimelineFeed, TimelineScope } from "@/lib/types";
import { useIntelligence } from "@/lib/intelligence/context";
import { ScopeSwitcher } from "@/app/timeline/_components/scope-switcher";
import { TimelineFilterBar, DEFAULT_FILTERS, type FilterState } from "@/app/timeline/_components/timeline-filters";
import { VisualTimeline } from "@/app/timeline/_components/visual-timeline";
import { EventDetailDrawer } from "@/app/timeline/_components/event-detail-drawer";
import { MovementExplainerCard } from "@/app/_components/movement-explainer-card";

// Only recharts-bearing chain in this view — deferred so it doesn't load
// on the "graph" secondary-view path, which statically imports this module.
const ThesisEvolutionPanel = dynamic(
  () => import("@/app/timeline/_components/thesis-evolution-panel").then((m) => m.ThesisEvolutionPanel),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] w-full animate-pulse rounded-xl border border-border bg-surface" />
    ),
  },
);

function buildQuery(scope: TimelineScope, id: string, filters: FilterState): string {
  const params = new URLSearchParams({ scope, id });
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.categories.length > 0) params.set("categories", filters.categories.join(","));
  if (filters.minImportance > 0) params.set("minImportance", String(filters.minImportance));
  if (filters.minConfidence > 0) params.set("minConfidence", String(filters.minConfidence));
  if (filters.impact !== "all") params.set("impact", filters.impact);
  if (filters.segment) params.set("segment", filters.segment);
  if (filters.metric) params.set("metric", filters.metric);
  if (filters.catalystOnly) params.set("catalystOnly", "true");
  if (filters.openThesisOnly) params.set("openThesisOnly", "true");
  return params.toString();
}

/** Timeline view of the Intelligence page — shares `focus` (scope+id) with the Graph and Opportunity Map views. */
export function TimelineView() {
  const { focus, setFocus } = useIntelligence();
  const { scope, id } = focus;

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [feed, setFeed] = useState<TimelineFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);

  const load = useCallback(async (nextScope: TimelineScope, nextId: string, nextFilters: FilterState) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/timeline?${buildQuery(nextScope, nextId, nextFilters)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load timeline");
      setFeed(json as TimelineFeed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load timeline");
      setFeed(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load() only sets state after an await, so this is safe to call here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(scope, id, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, id, filters]);

  function handleScopeSelect(nextScope: TimelineScope, nextId: string) {
    setFocus({ scope: nextScope, id: nextId });
  }

  const showSymbolOnCards = scope === "portfolio" || scope === "watchlist";

  return (
    <div className="flex flex-col gap-6">
      <ScopeSwitcher scope={scope} id={id} onSelect={handleScopeSelect} />
      {scope === "symbol" && <MovementExplainerCard symbol={id} />}
      <TimelineFilterBar filters={filters} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} />

      {error && (
        <div className="rounded-lg border border-negative/30 bg-negative/10 p-3 text-xs text-negative">{error}</div>
      )}

      {loading && !feed ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
          Building timeline…
        </div>
      ) : feed ? (
        <>
          {feed.thesisEvolution && <ThesisEvolutionPanel evolution={feed.thesisEvolution} />}
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{feed.events.length} event{feed.events.length === 1 ? "" : "s"}</span>
            {loading && <span className="text-accent">Refreshing…</span>}
          </div>
          <VisualTimeline events={feed.events} showSymbol={showSymbolOnCards} onSelect={setSelectedEvent} />
        </>
      ) : null}

      {selectedEvent && <EventDetailDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}
