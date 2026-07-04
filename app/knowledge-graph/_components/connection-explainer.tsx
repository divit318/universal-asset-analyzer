"use client";

import type { ConnectionExplanation } from "@/lib/knowledge-graph";

export function ConnectionExplainer({
  explanation,
  loading,
  onClose,
}: {
  explanation: ConnectionExplanation | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-accent">Why is this connected?</h3>
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-foreground">
          Close
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
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
                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-foreground">{p.label}</span>
                {i < explanation.path.length - 1 && <span className="text-muted/50">→</span>}
              </span>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted">{explanation.aiExplanation}</p>
          <div className="flex items-center gap-2 text-[10px] text-muted/70">
            <span>Confidence: {explanation.confidence}%</span>
            <span>·</span>
            <span>{explanation.pathEdges.length} hop{explanation.pathEdges.length === 1 ? "" : "s"}</span>
          </div>
        </>
      )}
    </div>
  );
}
