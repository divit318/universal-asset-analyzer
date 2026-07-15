"use client";

/**
 * /intelligence — Graph and Timeline, the two exploration surfaces.
 *
 * Mission Control used to live here. It is now the homepage (see app/page.tsx):
 * "what should I know and do right now" is the question a user has when they
 * open the app, so it belongs on the page they open, not one click into it.
 * Keeping a copy here would have given the same digest two homes and two
 * fetch paths — which is the duplication this page was created to end, not to
 * repeat.
 *
 * Graph and Timeline stay because they are genuinely differentiated: nothing
 * else visualizes entity relationships or a per-symbol event history. They are
 * exploratory rather than daily-habit surfaces, which is exactly why they work
 * as destinations rather than as a dashboard.
 *
 * Bare /intelligence redirects to the homepage. Every existing deep link
 * (?view=graph / ?view=timeline, plus scope/id) from Scanner, Portfolio,
 * Research, Watchlist and Compare continues to work unchanged.
 */

import { Suspense, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { IntelligenceProvider, type IntelligenceView, type IntelligenceFocus } from "@/lib/intelligence/context";
import type { GraphScope } from "@/lib/knowledge-graph";
import { GraphView } from "./_views/graph-view";
import { TimelineView } from "./_views/timeline-view";
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

  // The digest this page used to render is now the homepage. Send bare
  // /intelligence there rather than keeping a second copy of it alive.
  useEffect(() => {
    if (!secondaryView) router.replace("/");
  }, [secondaryView, router]);

  if (!secondaryView) {
    return (
      <PageShell>
        <p className="py-12 text-center text-sm text-muted">Taking you to your dashboard…</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex items-center gap-3">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-brand">
          ← Back to dashboard
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
