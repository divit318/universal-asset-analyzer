"use client";

/**
 * /knowledge-graph — the interactive entity graph, promoted to a first-class
 * route in the IA repair (§4.3). Previously it rendered only inside the
 * dissolved `/intelligence` container behind `?view=graph`.
 *
 * The wiring is lifted from the old Intelligence page: read the graph focus
 * (scope + id) from the URL, hand it to the shared IntelligenceProvider, and
 * keep the URL in sync as the user re-scopes — so deep links and back/forward
 * both work. Deep links carry `?scope=&id=`, not a plain `?symbol=`.
 */

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IntelligenceProvider, type IntelligenceView, type IntelligenceFocus } from "@/lib/intelligence/context";
import type { GraphScope } from "@/lib/knowledge-graph";
import { GraphView } from "./_components/graph-view";
import { PageShell, PageHeader } from "@/app/_components/ui";

const VALID_SCOPES: GraphScope[] = ["symbol", "sector", "portfolio", "watchlist"];

function KnowledgeGraphInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const scopeParam = searchParams.get("scope");
  const initialFocus: IntelligenceFocus = {
    scope: VALID_SCOPES.includes(scopeParam as GraphScope) ? (scopeParam as GraphScope) : "symbol",
    id: searchParams.get("id") || "AAPL",
  };

  const handleStateChange = useCallback(
    (state: { view: IntelligenceView; focus: IntelligenceFocus }) => {
      router.replace(
        `/knowledge-graph?scope=${state.focus.scope}&id=${encodeURIComponent(state.focus.id)}`,
        { scroll: false },
      );
    },
    [router],
  );

  return (
    <PageShell>
      <PageHeader title="Knowledge Graph" description="How your names connect — companies, sectors, events, and theses." />
      <IntelligenceProvider initialView="graph" initialFocus={initialFocus} onStateChange={handleStateChange}>
        <GraphView />
      </IntelligenceProvider>
    </PageShell>
  );
}

export default function KnowledgeGraphPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Loading…</div>}>
      <KnowledgeGraphInner />
    </Suspense>
  );
}
