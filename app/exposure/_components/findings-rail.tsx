"use client";

/**
 * The findings ledger — findings first, graph second.
 *
 * The single most important conclusion from auditing the old feature: the user
 * must not have to search a canvas for the thing that matters. So the left rail
 * is a ranked list of what the Portfolio Intelligence detectors actually found,
 * and each row is a door into the evidence for it.
 *
 * This page does not detect anything. `IntelligenceFinding` arrives complete
 * from lib/portfolio/intelligence/detectors.ts — severity, evidence with
 * per-line basis labels, caveats and all — and the only thing added here is the
 * `explore` link that each detector declares for itself. Two implementations of
 * "what is wrong with this portfolio" is exactly the duplication the rebuild
 * existed to remove.
 */

import { useState } from "react";
import type { IntelligenceFinding } from "@/lib/portfolio/intelligence/types";
import { resolveExplore, type GraphIndex } from "@/lib/exposure/query";
import { BasisTag, Eyebrow, Pct } from "./primitives";
import type { Navigate, Selection, StageView } from "./nav";

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-negative",
  medium: "bg-warning",
  low: "bg-faint",
};

export function FindingsRail({
  findings,
  index,
  navigate,
  selection,
}: {
  findings: IntelligenceFinding[];
  index: GraphIndex;
  navigate: Navigate;
  selection: Selection;
}) {
  const [expanded, setExpanded] = useState<string | null>(findings[0]?.id ?? null);

  if (findings.length === 0) {
    return (
      <aside className="space-y-3">
        <Eyebrow>Findings</Eyebrow>
        <p className="text-sm leading-relaxed text-muted">
          Nothing rose to a finding on this run. That is a measured statement, not a shrug — the
          detectors checked look-through concentration, fund overlap, correlated clusters, hidden
          sector bets and offsetting positions, and none crossed its threshold.
        </p>
        <p className="text-caption text-faint">
          The map on the right is still fully explorable. Start anywhere.
        </p>
      </aside>
    );
  }

  return (
    <aside className="space-y-3">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Findings</Eyebrow>
        <span className="font-mono text-caption text-faint">{findings.length}</span>
      </div>

      <div className="space-y-1.5">
        {findings.map((f) => {
          const open = expanded === f.id;
          const target = f.explore ? resolveExplore(index, f.explore) : null;
          const isActive =
            target != null &&
            target.nodeId === selection.nodeId &&
            target.view === selection.view;

          return (
            <div
              key={f.id}
              className={[
                "rounded-card border transition-colors duration-[var(--duration-base)]",
                isActive
                  ? "border-border-strong bg-surface-2"
                  : "border-border bg-surface hover:border-border-strong",
              ].join(" ")}
            >
              <button
                onClick={() => setExpanded(open ? null : f.id)}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
                aria-expanded={open}
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[f.severity] ?? "bg-faint"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-snug text-foreground">
                    {f.title}
                  </span>
                  {!open ? (
                    <span className="mt-0.5 block truncate text-caption text-muted">{f.headline}</span>
                  ) : null}
                </span>
                {f.weightPct != null ? (
                  <span className="shrink-0 font-mono text-caption text-muted">
                    <Pct value={f.weightPct} dp={1} />
                  </span>
                ) : null}
              </button>

              {open ? (
                <div className="space-y-3 border-t border-hairline px-3 py-3">
                  <p className="text-caption leading-relaxed text-foreground">{f.headline}</p>

                  <ul className="space-y-1.5">
                    {f.evidence.map((e, i) => (
                      <li key={i} className="flex gap-2">
                        <BasisTag basis={e.basis} />
                        <span className="min-w-0 flex-1 text-caption leading-relaxed text-muted">
                          {e.text}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className="text-caption leading-relaxed text-muted">{f.whyItMatters}</p>

                  {f.blindSpot ? (
                    <p className="border-l-2 border-border pl-2.5 text-caption leading-relaxed text-faint">
                      {f.blindSpot}
                    </p>
                  ) : null}

                  {f.caveat ? (
                    <p className="text-caption leading-relaxed text-faint">{f.caveat}</p>
                  ) : null}

                  {target ? (
                    <button
                      onClick={() =>
                        navigate({
                          nodeId: target.nodeId,
                          view: target.view as StageView,
                          secondaryId: target.secondaryId,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-control border border-border-strong bg-surface-3 px-2.5 py-1.5 text-caption font-medium text-foreground transition-colors duration-[var(--duration-feedback)] hover:bg-surface-2"
                    >
                      Show me exactly why
                      <span aria-hidden>→</span>
                    </button>
                  ) : (
                    <p className="text-caption text-faint">
                      This one has no exposure route to draw — the evidence above is the whole story.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
