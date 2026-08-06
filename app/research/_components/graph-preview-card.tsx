"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LoadingPanel } from "@/app/_components/loading-panel";
import { Reveal } from "@/app/_components/reveal";

/**
 * Knowledge Graph, embedded as a compact related-entities list rather than
 * the full interactive force graph (GraphCanvas) — that component is
 * presentation-heavy and physics-based node positions don't translate well
 * to a small embedded card. Reuses /api/knowledge-graph as-is (same data
 * lib/knowledge-graph/build.ts's buildSymbolGraph() already computes for
 * the full /intelligence graph view) and links out to the interactive
 * version for deeper exploration.
 */

interface GraphNodeLite {
  id: string;
  type: string;
  label: string;
  summary: string;
  importance: number;
  href: string | null;
}

interface GraphEdgeLite {
  source: string;
  target: string;
  type: string;
  label: string;
  strength?: number | null;
}

const TYPE_ICON: Record<string, string> = {
  company: "◆",
  sector: "⬢",
  portfolio: "◈",
  watchlist: "★",
  timeline_event: "◷",
  market_event: "⚡",
  opportunity: "↗",
  thesis: "▤",
  catalyst: "●",
  risk: "△",
};

export function GraphPreviewCard({ symbol }: { symbol: string }) {
  const [nodes, setNodes] = useState<GraphNodeLite[]>([]);
  const [edges, setEdges] = useState<GraphEdgeLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void fetch(`/api/knowledge-graph?scope=symbol&id=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setNodes(data?.nodes ?? []);
        setEdges(data?.edges ?? []);
      })
      .catch(() => { if (!cancelled) { setNodes([]); setEdges([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (loading) return <LoadingPanel height="h-32" markSize={18} />;

  const companyId = `company:${symbol.toUpperCase()}`;
  const related = nodes
    .filter((n) => n.id !== companyId)
    .map((n) => {
      const edge = edges.find(
        (e) => (e.source === companyId && e.target === n.id) || (e.target === companyId && e.source === n.id),
      );
      return { node: n, edge, relationship: edge?.label ?? null };
    })
    // Only entities DIRECTLY connected to this company belong in a compact
    // "Related Entities" list. Market events that merely share the sector
    // (edge strength < 60 — e.g. a bond-market story tagged "Financials")
    // are graph context, not company relevance; the full graph still has them.
    .filter(({ node, edge }) => {
      if (!edge) return false;
      if (node.type === "market_event" && (edge.strength ?? 0) < 60) return false;
      return true;
    })
    .sort((a, b) => b.node.importance - a.node.importance)
    .slice(0, 8);

  if (related.length === 0) return null;

  return (
    <div className="card-lift flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Related Entities</h3>
        <Link
          href={`/knowledge-graph?scope=symbol&id=${encodeURIComponent(symbol)}`}
          className="text-xs text-accent hover:underline"
        >
          Explore full graph →
        </Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {related.map(({ node, relationship }, i) => (
          <Reveal key={node.id} index={i} className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2">
            <span className="mt-0.5 shrink-0 text-sm text-muted">{TYPE_ICON[node.type] ?? "•"}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{node.label}</p>
              <p className="truncate text-[10px] text-muted">{relationship ?? node.type.replace("_", " ")}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
