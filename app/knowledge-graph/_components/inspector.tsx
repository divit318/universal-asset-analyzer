"use client";

/**
 * Knowledge Graph inspector (v2). The right column is never empty:
 *
 * - Nothing selected: graph-level intelligence — stats, what changed since
 *   the last visit, concentration, correlation clusters (with their lookback
 *   window), risks/opportunities, and the AI narrative (on demand, labeled).
 * - Node selected: identity + live metrics, provenance, actions, and the
 *   full connection list grouped by relation type, sorted by strength.
 * - Edge selected: a real derivation — the relation, the evidence, computed
 *   confidence (or "Unknown", never fabricated), source, and timestamps.
 */

import Link from "next/link";
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  ConnectionExplanation,
  GraphNarrative,
} from "@/lib/knowledge-graph/types";
// Value import from the zero-I/O types module: importing it from the package
// index would drag build.ts (yahoo-finance2, node:sqlite) into the client
// bundle — see lib/gics-sectors.ts for the incident this pattern avoids.
import { INSTRUMENT_LABEL } from "@/lib/knowledge-graph/types";
import { DATA_SOURCES, freshness } from "@/lib/provenance";
import { NODE_VISUAL, EDGE_VISUAL, shapePath } from "./graph-model";
import type { GraphSelection } from "./graph-canvas";

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted">{children}</h4>;
}

function TypeGlyph({ type }: { type: GraphNode["type"] }) {
  const visual = NODE_VISUAL[type];
  return (
    <svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true" className="shrink-0">
      <path d={shapePath(visual.shape, 6)} fill={visual.color} fillOpacity={0.35} stroke={visual.color} strokeWidth={1.4} />
    </svg>
  );
}

function ProvenanceLine({ node }: { node: GraphNode | GraphEdge }) {
  const p = node.provenance;
  const source = DATA_SOURCES[p.source]?.name ?? p.source;
  const age = p.asOf ? freshness(p.asOf, 24).label : null;
  return (
    <p className="text-[11px] text-muted">
      Source: {source}
      {p.origin === "ai" && <span className="ml-1 rounded bg-chart-3/15 px-1 py-px text-[10px] text-chart-3">AI-generated</span>}
      {p.origin === "user" && <span className="ml-1">(your data)</span>}
      {age && <span> · as of {age}</span>}
    </p>
  );
}

function fmtNum(v: number): string {
  return Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100);
}

/* -------------------------------------------------------------------------- */
/* Graph summary (nothing selected)                                           */
/* -------------------------------------------------------------------------- */

export function GraphSummaryPanel({
  graph,
  narrative,
  narrativeLoading,
  onGenerateNarrative,
  onSelectNode,
}: {
  graph: KnowledgeGraph;
  narrative: GraphNarrative | null;
  narrativeLoading: boolean;
  onGenerateNarrative: () => void;
  onSelectNode: (id: string) => void;
}) {
  const { insights, changes, meta } = graph;
  const { stats } = insights;
  const hasChanges =
    changes != null &&
    (changes.addedNodes.length > 0 || changes.removedNodes.length > 0 || changes.addedEdges.length > 0 || changes.removedEdges.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel>This graph</SectionLabel>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          {[
            ["Nodes", String(stats.nodes)],
            ["Edges", String(stats.edges)],
            ["Density", stats.density.toFixed(2)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface-2 px-2.5 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{label}</dt>
              <dd className="font-mono text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        {stats.mostConnected.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {stats.mostConnected.map((m) => (
              <button
                key={m.nodeId}
                type="button"
                onClick={() => onSelectNode(m.nodeId)}
                className="flex items-center justify-between rounded-md px-2 py-1 text-left text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <span className="truncate">{m.label}</span>
                <span className="ml-2 shrink-0 font-mono text-[11px]">{m.degree} links</span>
              </button>
            ))}
          </div>
        )}
        {meta.truncation && (
          <p className="mt-2 text-[11px] text-warning">
            Showing {meta.truncation.shown} of {meta.truncation.total} tracked names (largest first).
          </p>
        )}
      </div>

      <div>
        <SectionLabel>Since your last visit</SectionLabel>
        {changes == null ? (
          <p className="mt-1.5 text-xs text-muted">First snapshot of this view. Changes will appear on your next visit.</p>
        ) : !hasChanges ? (
          <p className="mt-1.5 text-xs text-muted">
            No structural changes since the last snapshot ({freshness(changes.previousAt, 24).label}).
          </p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1">
            {changes.addedNodes.slice(0, 4).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onSelectNode(n.id)}
                  className="w-full truncate rounded-md px-2 py-1 text-left text-xs text-positive transition-colors hover:bg-surface-2"
                >
                  + {n.label}
                </button>
              </li>
            ))}
            {changes.addedEdges.slice(0, 3).map((e) => (
              <li key={e.id} className="truncate px-2 py-0.5 text-xs text-muted">
                + {e.sourceLabel} <span className="text-muted/70">{e.label}</span> {e.targetLabel}
              </li>
            ))}
            {changes.removedNodes.slice(0, 3).map((n) => (
              <li key={n.id} className="truncate px-2 py-0.5 text-xs text-negative/80">
                − {n.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {insights.concentrationRisks.length > 0 && (
        <div>
          <SectionLabel>Concentration</SectionLabel>
          <ul className="mt-1.5 flex flex-col gap-1">
            {insights.concentrationRisks.map((c) => (
              <li key={c.sector} className="text-xs text-muted">
                <span className="font-medium text-foreground">{c.sector}</span>
                {c.weight != null && <span className="font-mono text-warning"> {(c.weight * 100).toFixed(0)}%</span>}
                {" "}({c.symbols.join(", ")})
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.correlationClusters.length > 0 && (
        <div>
          <SectionLabel>Correlation clusters</SectionLabel>
          <p className="mt-1 text-[11px] text-muted/80">Sectors moving together, by {insights.correlationClusters[0].window}.</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {insights.correlationClusters.map((c) => (
              <li key={c.classification} className="text-xs text-muted">
                <span className="font-medium capitalize text-foreground">{c.classification}</span>: {c.sectors.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.emergingRisks.length > 0 && (
        <div>
          <SectionLabel>Emerging risks</SectionLabel>
          <ul className="mt-1.5 flex flex-col gap-1">
            {insights.emergingRisks.map((r) => (
              <li key={r.nodeId}>
                <button
                  type="button"
                  onClick={() => onSelectNode(r.nodeId)}
                  className="w-full truncate rounded-md px-2 py-1 text-left text-xs text-negative/90 transition-colors hover:bg-surface-2"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.hiddenOpportunities.length > 0 && (
        <div>
          <SectionLabel>Opportunities not owned</SectionLabel>
          <ul className="mt-1.5 flex flex-col gap-1">
            {insights.hiddenOpportunities.map((o) => (
              <li key={o.nodeId}>
                <button
                  type="button"
                  onClick={() => onSelectNode(o.nodeId)}
                  className="w-full truncate rounded-md px-2 py-1 text-left text-xs text-positive/90 transition-colors hover:bg-surface-2"
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <SectionLabel>AI read</SectionLabel>
          <button
            type="button"
            onClick={onGenerateNarrative}
            disabled={narrativeLoading}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
          >
            {narrativeLoading ? "Reading graph…" : narrative ? "Refresh" : "Generate"}
          </button>
        </div>
        {narrative && narrative.observations.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {narrative.observations.map((o, i) => (
              <div key={i} className="rounded-lg bg-surface-2 p-2.5">
                <p className="text-xs leading-5 text-foreground">{o.text}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {o.nodeIds.map((id) => {
                    const node = graph.nodes.find((n) => n.id === id);
                    return node ? (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onSelectNode(id)}
                        className="rounded-full border border-border px-2 py-px text-[10px] text-muted transition-colors hover:border-accent/50 hover:text-accent"
                      >
                        {node.label}
                      </button>
                    ) : null;
                  })}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted/80">
              AI-generated{narrative.model ? ` by ${narrative.model}` : ""} from this graph only. Every claim cites the nodes it rests on;
              unsupported claims are dropped.
            </p>
          </div>
        )}
        {narrative && narrative.observations.length === 0 && (
          <p className="mt-2 text-xs text-muted">The model produced no claims it could support from this graph.</p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Node inspector                                                             */
/* -------------------------------------------------------------------------- */

const METRIC_LABEL: Record<string, string> = {
  price: "Price",
  changePercent: "Change",
  currency: "Currency",
  sector: "Sector",
  instrument: "Instrument",
  shares: "Shares",
  avgCost: "Avg cost",
  positionValue: "Position value",
  valuationBasis: "Valued at",
  unrealizedPnlPct: "Unrealized P&L",
  rank: "Rotation rank",
  classification: "Rotation class",
  relativeStrength: "Rel. strength",
  category: "Category",
  impact: "Impact",
  date: "Date",
  source: "Source",
  verdict: "Verdict",
  direction: "Direction",
  theme: "Theme",
  timeHorizon: "Time horizon",
};

export function NodeInspectorPanel({
  node,
  graph,
  connecting,
  onSelectNode,
  onSelectEdge,
  onStartConnect,
  onRecenter,
}: {
  node: GraphNode;
  graph: KnowledgeGraph;
  connecting: boolean;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onStartConnect: () => void;
  onRecenter: (node: GraphNode) => void;
}) {
  const related = graph.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      const other = graph.nodes.find((n) => n.id === otherId);
      const outbound = e.source === node.id;
      return other ? { edge: e, other, outbound } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => b.edge.strength - a.edge.strength);

  const byRelation = new Map<string, typeof related>();
  for (const r of related) {
    const key = EDGE_VISUAL[r.edge.type]?.label ?? r.edge.type;
    byRelation.set(key, [...(byRelation.get(key) ?? []), r]);
  }

  const metricEntries = Object.entries(node.metrics).filter(([, v]) => v != null && v !== "");
  const canRecenter = node.type === "company" || node.type === "sector";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5"><TypeGlyph type={node.type} /></span>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">
              {NODE_VISUAL[node.type].label}
              {node.instrument && node.instrument !== "common_equity" ? ` · ${INSTRUMENT_LABEL[node.instrument]}` : ""}
            </span>
            <h3 className="text-sm font-semibold leading-5 text-foreground">{node.fullLabel}</h3>
          </div>
        </div>
        {node.confidence != null && (
          <span className="shrink-0 text-[11px] text-muted">Confidence {node.confidence}/100</span>
        )}
      </div>

      {node.summary && node.summary !== node.fullLabel && <p className="text-xs leading-5 text-muted">{node.summary}</p>}
      <ProvenanceLine node={node} />

      {metricEntries.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {metricEntries.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1">
              <dt className="text-[11px] text-muted">{METRIC_LABEL[k] ?? k}</dt>
              <dd className={`text-right font-mono text-[11px] ${
                k === "changePercent" || k === "unrealizedPnlPct"
                  ? Number(v) >= 0 ? "text-positive" : "text-negative"
                  : "text-foreground"
              }`}>
                {typeof v === "number" ? fmtNum(v) : String(v)}
                {(k === "changePercent" || k === "unrealizedPnlPct") && "%"}
              </dd>
            </div>
          ))}
          {node.weight != null && (
            <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1">
              <dt className="text-[11px] text-muted">Book weight</dt>
              <dd className="text-right font-mono text-[11px] text-foreground">{(node.weight * 100).toFixed(1)}%</dd>
            </div>
          )}
        </dl>
      )}

      <div className="flex flex-wrap gap-1.5">
        {node.href && (
          <Link
            href={node.href}
            className="rounded-md bg-accent-strong px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            {node.type === "company" ? "Open in Research" : "Open"}
          </Link>
        )}
        {canRecenter && (
          <button
            type="button"
            onClick={() => onRecenter(node)}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            Re-center graph here
          </button>
        )}
        <button
          type="button"
          onClick={onStartConnect}
          className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
            connecting
              ? "border-accent/50 bg-accent/10 text-accent"
              : "border-border text-muted hover:border-accent/40 hover:text-accent"
          }`}
        >
          {connecting ? "Pick a second node…" : "Find path from here"}
        </button>
      </div>

      {byRelation.size > 0 && (
        <div className="border-t border-border pt-3">
          <SectionLabel>Connections ({related.length})</SectionLabel>
          <div className="mt-2 flex flex-col gap-2.5">
            {[...byRelation.entries()].map(([relation, rows]) => (
              <div key={relation}>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted/80">{relation}</p>
                <ul className="flex flex-col gap-0.5">
                  {rows.slice(0, 8).map(({ edge, other, outbound }) => (
                    <li key={edge.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onSelectNode(other.id)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <span aria-hidden="true" className="shrink-0 text-muted/60">{outbound ? "→" : "←"}</span>
                        <TypeGlyph type={other.type} />
                        <span className="truncate">{other.label}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectEdge(edge.id)}
                        title="Inspect this connection"
                        aria-label={`Inspect connection to ${other.label}`}
                        className="shrink-0 rounded-md px-1.5 py-1 font-mono text-[10px] text-muted/70 transition-colors hover:bg-surface-2 hover:text-accent"
                      >
                        {edge.strength}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Edge inspector                                                             */
/* -------------------------------------------------------------------------- */

export function EdgeInspectorPanel({
  edge,
  graph,
  onSelectNode,
}: {
  edge: GraphEdge;
  graph: KnowledgeGraph;
  onSelectNode: (id: string) => void;
}) {
  const source = graph.nodes.find((n) => n.id === edge.source);
  const target = graph.nodes.find((n) => n.id === edge.target);
  const visual = EDGE_VISUAL[edge.type];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">Connection</span>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-foreground">
          <button type="button" onClick={() => source && onSelectNode(source.id)} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium hover:text-accent">
            {source?.label ?? edge.source}
          </button>
          <span className="text-xs" style={{ color: visual.color }}>
            {edge.directed ? "→" : "↔"} {visual.label}
          </span>
          <button type="button" onClick={() => target && onSelectNode(target.id)} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium hover:text-accent">
            {target?.label ?? edge.target}
          </button>
        </div>
      </div>

      <div>
        <SectionLabel>Evidence</SectionLabel>
        <p className="mt-1 text-xs leading-5 text-foreground">{edge.evidence || "No recorded evidence."}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1">
          <dt className="text-[11px] text-muted">Strength</dt>
          <dd className="font-mono text-[11px] text-foreground">{edge.strength}/100</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1">
          <dt className="text-[11px] text-muted">Confidence</dt>
          <dd className="font-mono text-[11px] text-foreground">{edge.confidence != null ? `${edge.confidence}/100` : "Unknown"}</dd>
        </div>
        {edge.timestamp && (
          <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1">
            <dt className="text-[11px] text-muted">Established</dt>
            <dd className="font-mono text-[11px] text-foreground">{edge.timestamp.slice(0, 10)}</dd>
          </div>
        )}
      </dl>

      <ProvenanceLine node={edge} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Path explanation                                                           */
/* -------------------------------------------------------------------------- */

export function PathExplanationPanel({
  explanation,
  loading,
  onClose,
  onSelectNode,
}: {
  explanation: ConnectionExplanation | null;
  loading: boolean;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionLabel>Path between nodes</SectionLabel>
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-foreground">
          Close
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none" />
          Finding connection…
        </div>
      ) : !explanation ? (
        <p className="text-xs text-muted">Select two nodes to trace a connection.</p>
      ) : !explanation.pathFound ? (
        <p className="text-xs text-muted">{explanation.aiExplanation}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {explanation.path.map((p, i) => (
              <span key={p.nodeId} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onSelectNode(p.nodeId)}
                  className="rounded-full border border-border bg-surface px-2 py-0.5 text-foreground transition-colors hover:border-accent/50 hover:text-accent"
                >
                  {p.label}
                </button>
                {i < explanation.path.length - 1 && <span aria-hidden="true" className="text-muted/60">→</span>}
              </span>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted">{explanation.aiExplanation}</p>
          {explanation.alternativePaths.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted/80">Alternative routes</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {explanation.alternativePaths.map((p, i) => (
                  <li key={i} className="truncate text-[11px] text-muted">
                    {p.labels.join(" → ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center gap-2 text-[10px] text-muted">
            <span>{explanation.confidence != null ? `Model confidence: ${explanation.confidence}%` : "Model confidence: unknown"}</span>
            <span aria-hidden="true">·</span>
            <span>
              {explanation.pathEdges.length} hop{explanation.pathEdges.length === 1 ? "" : "s"}
            </span>
            <span aria-hidden="true">·</span>
            <span>AI narration of a computed path</span>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Composite                                                                  */
/* -------------------------------------------------------------------------- */

export function Inspector({
  graph,
  selected,
  connecting,
  explanation,
  explanationLoading,
  showExplanation,
  narrative,
  narrativeLoading,
  onGenerateNarrative,
  onSelectNode,
  onSelectEdge,
  onStartConnect,
  onRecenter,
  onCloseExplanation,
}: {
  graph: KnowledgeGraph;
  selected: GraphSelection | null;
  connecting: boolean;
  explanation: ConnectionExplanation | null;
  explanationLoading: boolean;
  showExplanation: boolean;
  narrative: GraphNarrative | null;
  narrativeLoading: boolean;
  onGenerateNarrative: () => void;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onStartConnect: () => void;
  onRecenter: (node: GraphNode) => void;
  onCloseExplanation: () => void;
}) {
  const selectedNode = selected?.kind === "node" ? graph.nodes.find((n) => n.id === selected.id) ?? null : null;
  const selectedEdge = selected?.kind === "edge" ? graph.edges.find((e) => e.id === selected.id) ?? null : null;

  return (
    <aside
      aria-label="Graph inspector"
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-4"
    >
      {showExplanation || explanationLoading ? (
        <PathExplanationPanel
          explanation={explanation}
          loading={explanationLoading}
          onClose={onCloseExplanation}
          onSelectNode={onSelectNode}
        />
      ) : selectedNode ? (
        <NodeInspectorPanel
          node={selectedNode}
          graph={graph}
          connecting={connecting}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onStartConnect={onStartConnect}
          onRecenter={onRecenter}
        />
      ) : selectedEdge ? (
        <EdgeInspectorPanel edge={selectedEdge} graph={graph} onSelectNode={onSelectNode} />
      ) : (
        <GraphSummaryPanel
          graph={graph}
          narrative={narrative}
          narrativeLoading={narrativeLoading}
          onGenerateNarrative={onGenerateNarrative}
          onSelectNode={onSelectNode}
        />
      )}
    </aside>
  );
}
