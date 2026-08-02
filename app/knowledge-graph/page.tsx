"use client";

/**
 * /knowledge-graph — the interactive entity graph.
 *
 * This page owns URL state. Everything needed to restore a view rides in the
 * query string: scope, id (omitted for the singleton portfolio/watchlist
 * scopes), layout, view mode, highlight query, hidden node types, minimum
 * edge strength, and the selected node. A bare /knowledge-graph visit is
 * immediately canonicalized to ?scope=symbol&id=AAPL so the default view is
 * shareable too. Focus changes push history (back/forward re-scope the
 * graph); view-state changes replace in place.
 */

import { Suspense, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import type { GraphScope } from "@/lib/knowledge-graph/types";
import { GraphView, type GraphViewState } from "./_components/graph-view";
import { GraphScopeSwitcher } from "./_components/graph-scope-switcher";
import { PageShell, PageHeader } from "@/app/_components/ui";

const VALID_SCOPES: GraphScope[] = ["symbol", "sector", "portfolio", "watchlist"];
const SINGLETON_SCOPES: GraphScope[] = ["portfolio", "watchlist"];

function KnowledgeGraphInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const scopeParam = searchParams.get("scope");
  const scope: GraphScope = VALID_SCOPES.includes(scopeParam as GraphScope) ? (scopeParam as GraphScope) : "symbol";
  const id = SINGLETON_SCOPES.includes(scope) ? scope : searchParams.get("id") || (scope === "sector" ? "Technology" : "AAPL");

  const initialState = useMemo<Partial<GraphViewState>>(
    () => ({
      layout: (["force", "radial"].includes(searchParams.get("layout") ?? "") ? searchParams.get("layout") : null) as
        | "force"
        | "radial"
        | null,
      view: searchParams.get("view") === "table" ? "table" : "graph",
      q: searchParams.get("q") ?? "",
      hiddenTypes: searchParams.get("hide")?.split(",").filter(Boolean) ?? [],
      minStrength: Number(searchParams.get("min")) || 0,
      selected: searchParams.get("sel"),
    }),
    // Deliberately only computed for the initial mount of a given focus;
    // live view state is owned by GraphView afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, id],
  );

  const buildParams = useCallback(
    (nextScope: GraphScope, nextId: string, state?: GraphViewState) => {
      const params = new URLSearchParams();
      params.set("scope", nextScope);
      if (!SINGLETON_SCOPES.includes(nextScope)) params.set("id", nextId);
      if (state) {
        if (state.layout) params.set("layout", state.layout);
        if (state.view === "table") params.set("view", "table");
        if (state.q) params.set("q", state.q);
        if (state.hiddenTypes.length > 0) params.set("hide", state.hiddenTypes.join(","));
        if (state.minStrength > 0) params.set("min", String(state.minStrength));
        if (state.selected) params.set("sel", state.selected);
      }
      return params;
    },
    [],
  );

  // Canonicalize a bare URL so the default view is a shareable permalink.
  useEffect(() => {
    if (!searchParams.get("scope")) {
      router.replace(`/knowledge-graph?${buildParams(scope, id).toString()}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFocusChange = useCallback(
    (nextScope: GraphScope, nextId: string) => {
      // Focus changes are navigation: push, so back/forward walk the history.
      router.push(`/knowledge-graph?${buildParams(nextScope, nextId).toString()}`, { scroll: false });
    },
    [router, buildParams],
  );

  const handleViewStateChange = useCallback(
    (state: GraphViewState) => {
      router.replace(`/knowledge-graph?${buildParams(scope, id, state).toString()}`, { scroll: false });
    },
    [router, buildParams, scope, id],
  );

  return (
    <PageShell width="wide" gap="gap-5">
      <PageHeader
        title="Knowledge Graph"
        description="How your holdings and watchlist connect across sectors, events, filings, and market signals."
      />
      <GraphScopeSwitcher scope={scope} id={id} onSelect={handleFocusChange} />
      <GraphView
        key={`${scope}:${id}`}
        scope={scope}
        id={id}
        initialState={initialState}
        onViewStateChange={handleViewStateChange}
        onFocusChange={handleFocusChange}
      />
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
