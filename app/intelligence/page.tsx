"use client";

/**
 * /intelligence — Mission Control, the personalized daily digest, with
 * Graph and Timeline kept as secondary "explore" destinations reached via
 * `?view=graph` / `?view=timeline` (preserving every existing deep-link from
 * Scanner, Portfolio, Research, Watchlist, and Compare).
 *
 * This used to be a three-tab merge of Graph + Opportunity Map + Timeline
 * sharing only a focus-state context, not a data model — each tab was a
 * separate re-visualization of data already shown elsewhere (Opportunity Map
 * duplicated Scanner's own opportunity list with zero new analytical
 * content). Mission Control replaces that with a single composed digest
 * (lib/mission-control.ts) built from engines that already exist across the
 * app — portfolio health/alerts, Scanner opportunities, sector rotation,
 * decision-journal calibration, upcoming events — so this page finally
 * answers "what should I know/do today" instead of re-drawing data you can
 * already see on Scanner or Portfolio.
 *
 * Graph remains genuinely differentiated (no other page visualizes entity
 * relationships) but is exploratory rather than a daily-habit surface, so it
 * — along with Timeline — is demoted to a secondary view instead of a
 * co-equal tab.
 */

import { Suspense, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { IntelligenceProvider, type IntelligenceView, type IntelligenceFocus } from "@/lib/intelligence/context";
import type { GraphScope } from "@/lib/knowledge-graph";
import { GraphView } from "./_views/graph-view";
import { TimelineView } from "./_views/timeline-view";
import { MissionControlView } from "./_views/mission-control-view";
import { PageShell, PageHeader } from "@/app/_components/ui";

const VALID_SCOPES: GraphScope[] = ["symbol", "sector", "portfolio", "watchlist"];
const VALID_VIEWS: IntelligenceView[] = ["graph", "timeline"];

const VIEW_LABEL: Record<IntelligenceView, string> = { graph: "Graph", timeline: "Timeline" };

function IntelligencePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewParam = searchParams.get("view");
  const secondaryView: IntelligenceView | null = VALID_VIEWS.includes(viewParam as IntelligenceView)
    ? (viewParam as IntelligenceView)
    : null;

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

  if (!secondaryView) {
    return (
      <PageShell>
        <PageHeader
          title="Intelligence"
          description="Your daily briefing — what changed, what needs attention, and what to do about it."
        />
        <MissionControlView />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex items-center gap-3">
        <Link href="/intelligence" className="text-sm text-muted transition-colors hover:text-brand">
          ← Back to Mission Control
        </Link>
      </div>
      <PageHeader title={VIEW_LABEL[secondaryView]} />
      <IntelligenceProvider initialView={secondaryView} initialFocus={initialFocus} onStateChange={handleStateChange}>
        {secondaryView === "graph" ? <GraphView /> : <TimelineView />}
      </IntelligenceProvider>
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
