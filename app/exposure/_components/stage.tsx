"use client";

/**
 * The stage — the system picks the visualization, the user never does.
 *
 * The old feature made the user choose between force, radial, graph and table,
 * which is a menu of ways to look at a thing rather than an answer to a
 * question. Here the question determines the form: money flowing along routes
 * is a Sankey, a shared driver is a ranked list, a two-name relationship is a
 * short table, and a finding is its evidence. There is no layout switcher
 * because there is no layout decision the user is better placed to make.
 *
 * The keyed wrapper is what gives every transition its 200ms settle: React
 * remounts on a change of subject, the reveal animation runs, and the movement
 * reads as "you went somewhere" rather than as decoration.
 */

import { OverviewView } from "./views/overview-view";
import { BlastView, TraceView } from "./views/trace-view";
import { OverlapView, PositionView } from "./views/position-view";
import { DriverView } from "./views/driver-view";
import { CompareView } from "./views/compare-view";
import type { ViewProps } from "./nav";

export function Stage(props: ViewProps) {
  const { selection } = props;

  const body = (() => {
    switch (selection.view) {
      case "trace":
        return <TraceView {...props} />;
      case "blast":
        return <BlastView {...props} />;
      case "position":
        return <PositionView {...props} />;
      case "overlap":
        return <OverlapView {...props} />;
      case "driver":
        return <DriverView {...props} />;
      case "compare":
        return <CompareView {...props} />;
      case "overview":
      default:
        return <OverviewView {...props} />;
    }
  })();

  return (
    <div
      key={`${selection.view}:${selection.nodeId}:${selection.secondaryId ?? ""}`}
      className="animate-fade-rise"
    >
      {body}
    </div>
  );
}
