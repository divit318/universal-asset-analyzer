/**
 * The exploration contract.
 *
 * One `Navigate` callback threads through every view, so any entity drawn
 * anywhere on the page is clickable into its own view without the component
 * that drew it knowing what happens next. That is what makes the page feel like
 * a connected system rather than a set of screens: a constituent inside a fund,
 * a member of a driver, a name in a blast radius and a row in the findings rail
 * are all the same kind of link.
 */

import type { ExposureGraph } from "@/lib/exposure/types";
import type { GraphIndex } from "@/lib/exposure/query";

export type StageView =
  | "overview"
  | "trace"
  | "blast"
  | "position"
  | "overlap"
  | "driver"
  | "compare";

export interface Selection {
  nodeId: string;
  view: StageView;
  /** The second subject for the two-node views (compare, overlap). */
  secondaryId?: string;
}

export type Navigate = (next: Selection) => void;

export interface ViewProps {
  graph: ExposureGraph;
  index: GraphIndex;
  selection: Selection;
  navigate: Navigate;
}

/** Human label for a node id, for breadcrumbs and headings. */
export function labelForNode(index: GraphIndex, id: string): string {
  if (id === "portfolio") return "Portfolio";
  return (
    index.issuerById.get(id)?.symbol ??
    index.positionById.get(id)?.label ??
    index.driverById.get(id)?.label ??
    id
  );
}

export const VIEW_LABEL: Record<StageView, string> = {
  overview: "Overview",
  trace: "Exposure trace",
  blast: "Blast radius",
  position: "Inside this line",
  overlap: "Shared holdings",
  driver: "Shared driver",
  compare: "Relationship",
};
