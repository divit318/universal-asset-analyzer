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
import { PageShell, PageHeader, Tabs, type TabItem } from "@/app/_components/ui";

const TABS: TabItem<IntelligenceView>[] = [
  { id: "graph", label: "Graph" },
  { id: "opportunity-map", label: "Opportunity Map" },
  { id: "timeline", label: "Timeline" },
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
    <PageShell>
      <PageHeader
        title="Intelligence"
        description="One investment intelligence model, three synchronized views — select a company, sector, portfolio, or watchlist and it follows you across relationships, opportunities, and history."
      />

      <Tabs tabs={TABS} active={view} onChange={setView} layoutId="intelligence-tabs-underline" />

      <div className={view === "graph" ? "contents" : "hidden"}>
        <GraphView />
      </div>
      <div className={view === "opportunity-map" ? "contents" : "hidden"}>
        <OpportunityMapView />
      </div>
      <div className={view === "timeline" ? "contents" : "hidden"}>
        <TimelineView />
      </div>
    </PageShell>
  );
}

export default function IntelligencePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Loading…</div>}>
      <IntelligencePageInner />
    </Suspense>
  );
}
