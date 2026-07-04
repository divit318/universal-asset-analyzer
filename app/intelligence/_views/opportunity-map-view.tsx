"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { OpportunityMapData, OpportunityMapNode } from "@/lib/opportunity-map";
import { useIntelligence } from "@/lib/intelligence/context";
import { BubbleView } from "@/app/opportunity-map/_components/bubble-view";
import { QuadrantView } from "@/app/opportunity-map/_components/quadrant-view";
import { OpportunityFilters, DEFAULT_OPP_FILTERS, type OppFilterState } from "@/app/opportunity-map/_components/opportunity-filters";
import { OpportunityDetailPanel } from "@/app/opportunity-map/_components/opportunity-detail-panel";
import { formatDate } from "@/lib/format";

type ViewMode = "bubble" | "quadrant";

function applyFilters(nodes: OpportunityMapNode[], f: OppFilterState): OpportunityMapNode[] {
  return nodes.filter((n) => {
    if (f.theme !== "all" && n.theme !== f.theme) return false;
    if (f.category !== "all" && n.category !== f.category) return false;
    if (f.conviction !== "all" && n.conviction !== f.conviction) return false;
    if (f.risk !== "all" && n.expectedVolatility !== f.risk) return false;
    if (n.opportunityScore < f.minScore) return false;
    if (f.direction !== "all" && n.direction !== f.direction) return false;
    if (f.tier !== "all" && n.tier !== f.tier) return false;
    if (f.portfolioOnly && !n.inPortfolio) return false;
    if (f.watchlistOnly && !n.inWatchlist) return false;
    return true;
  });
}

/** Opportunity Map view of the Intelligence page — shares `focus` (scope+id) with the Graph and Timeline views. */
export function OpportunityMapView() {
  const { focus, setFocus, setSelectedTheme } = useIntelligence();

  const [data, setData] = useState<OpportunityMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("bubble");
  const [filters, setFilters] = useState<OppFilterState>(DEFAULT_OPP_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/opportunity-map")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json as OpportunityMapData);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load opportunity map");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredNodes = useMemo(() => (data ? applyFilters(data.nodes, filters) : []), [data, filters]);
  const themes = useMemo(() => [...new Set((data?.nodes ?? []).map((n) => n.theme))].sort(), [data]);

  // A symbol selected elsewhere (Graph node click, Timeline scope switch) selects
  // its opportunity node here too, if one exists in the current dataset.
  useEffect(() => {
    if (focus.scope !== "symbol" || !data) return;
    const match = data.nodes.find((n) => n.symbol.toUpperCase() === focus.id.toUpperCase());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (match) setSelectedId(match.id);
  }, [focus, data]);

  // A theme picked here also drives the Graph view's highlight when the user switches tabs.
  useEffect(() => {
    if (filters.theme !== "all") setSelectedTheme(filters.theme);
  }, [filters.theme, setSelectedTheme]);

  const selectedNode = filteredNodes.find((n) => n.id === selectedId) ?? null;

  function handleSelect(nodeId: string) {
    setSelectedId(nodeId);
    const node = filteredNodes.find((n) => n.id === nodeId);
    if (node) setFocus({ scope: "symbol", id: node.symbol });
  }

  return (
    <div className="flex flex-col gap-6">
      {loading ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
          Loading opportunity map…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-negative/30 bg-negative/10 p-3 text-xs text-negative">{error}</div>
      ) : !data || data.nodes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <span className="text-2xl">◇</span>
          <p className="text-sm text-muted">No opportunity data yet — run a Scanner auto-scan to populate the map.</p>
          <Link href="/scanner" className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background hover:opacity-90 transition-opacity">
            Go to Scanner →
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
              <button
                type="button"
                onClick={() => setView("bubble")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === "bubble" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"}`}
              >
                Opportunity Galaxy
              </button>
              <button
                type="button"
                onClick={() => setView("quadrant")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === "quadrant" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"}`}
              >
                Risk / Return
              </button>
            </div>
            <span className="text-xs text-muted">
              {filteredNodes.length} of {data.nodes.length} opportunities
              {data.scannedAt && ` · Scanner last ran ${formatDate(data.scannedAt)}`}
            </span>
          </div>

          <OpportunityFilters filters={filters} themes={themes} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} />

          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            {view === "bubble" ? (
              <BubbleView nodes={filteredNodes} selectedId={selectedId} onSelect={handleSelect} />
            ) : (
              <QuadrantView nodes={filteredNodes} selectedId={selectedId} onSelect={handleSelect} />
            )}
            <div>
              {selectedNode ? (
                <OpportunityDetailPanel node={selectedNode} />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted">
                  <span className="text-2xl">◇</span>
                  Click an opportunity to inspect it.
                </div>
              )}
            </div>
          </div>

          {data.clusters.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-accent">Theme Clusters</h3>
              <div className="flex flex-wrap gap-2">
                {data.clusters.map((c) => (
                  <button
                    key={c.theme}
                    type="button"
                    onClick={() => {
                      const nextTheme = filters.theme === c.theme ? "all" : c.theme;
                      setFilters((f) => ({ ...f, theme: nextTheme }));
                      setSelectedTheme(nextTheme === "all" ? null : nextTheme);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      filters.theme === c.theme ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:border-border/80 hover:text-foreground"
                    }`}
                  >
                    {c.theme} · {c.count} · avg {c.avgScore}/100
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
