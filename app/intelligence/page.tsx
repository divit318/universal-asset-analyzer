"use client";

/**
 * /intelligence — unified Graph + Opportunity Map + Timeline.
 *
 * These were three standalone pages (`/knowledge-graph`, `/opportunity-map`,
 * `/timeline`) that each computed the same idea of "what am I looking at"
 * independently. They're one investment intelligence model with three
 * views over it: Graph (relationships) → Opportunity Map (where the best
 * opportunities are) → Timeline (how the thesis got here). Selecting a
 * company/sector in any view carries into the other two via the shared
 * `IntelligenceProvider` (lib/intelligence/context.tsx) — no per-view
 * duplication of scope/focus state, no new scoring or data-fetching logic.
 *
 * All three views stay mounted (toggled with `hidden`, not conditional
 * rendering) so switching tabs is instant and each view's own UI state
 * (Graph's pan/zoom/selection, Timeline's filters, Opportunity Map's
 * bubble/quadrant toggle) survives the switch, per the "seamless workflow"
 * requirement — the tradeoff is each view fetches once up front rather
 * than on first visit.
 */

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IntelligenceProvider, useIntelligence, type IntelligenceView, type IntelligenceFocus } from "@/lib/intelligence/context";
import type { GraphScope } from "@/lib/knowledge-graph";
import { GraphView } from "./_views/graph-view";
import { TimelineView } from "./_views/timeline-view";
import { OpportunityMapView } from "./_views/opportunity-map-view";

const TABS: { value: IntelligenceView; label: string; desc: string }[] = [
  { value: "graph", label: "Graph", desc: "Understand relationships" },
  { value: "opportunity-map", label: "Opportunity Map", desc: "Find where the best opportunities exist" },
  { value: "timeline", label: "Timeline", desc: "See how the thesis evolved over time" },
];

const VALID_SCOPES: GraphScope[] = ["symbol", "sector", "portfolio", "watchlist"];
const VALID_VIEWS: IntelligenceView[] = ["graph", "opportunity-map", "timeline"];

function IntelligencePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewParam = searchParams.get("view");
  const initialView: IntelligenceView = VALID_VIEWS.includes(viewParam as IntelligenceView)
    ? (viewParam as IntelligenceView)
    : "graph";

  const scopeParam = searchParams.get("scope");
  const initialFocus: IntelligenceFocus = {
    scope: VALID_SCOPES.includes(scopeParam as GraphScope) ? (scopeParam as GraphScope) : "symbol",
    id: searchParams.get("id") || "AAPL",
  };

  const handleStateChange = useCallback(
    (state: { view: IntelligenceView; focus: IntelligenceFocus }) => {
      router.replace(
        `/intelligence?view=${state.view}&scope=${state.focus.scope}&id=${encodeURIComponent(state.focus.id)}`,
        { scroll: false },
      );
    },
    [router],
  );

  return (
    <IntelligenceProvider initialView={initialView} initialFocus={initialFocus} onStateChange={handleStateChange}>
      <IntelligenceShell />
    </IntelligenceProvider>
  );
}

function IntelligenceShell() {
  const { view, setView } = useIntelligence();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Intelligence</h1>
        <p className="text-sm text-muted">
          One investment intelligence model, three synchronized views — select a company, sector, portfolio, or
          watchlist and it follows you across relationships, opportunities, and history.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 self-start rounded-lg border border-border bg-surface p-1">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setView(tab.value)}
            title={tab.desc}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              view === tab.value ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={view === "graph" ? "contents" : "hidden"}>
        <GraphView />
      </div>
      <div className={view === "opportunity-map" ? "contents" : "hidden"}>
        <OpportunityMapView />
      </div>
      <div className={view === "timeline" ? "contents" : "hidden"}>
        <TimelineView />
      </div>
    </div>
  );
}

export default function IntelligencePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Loading…</div>}>
      <IntelligencePageInner />
    </Suspense>
  );
}
