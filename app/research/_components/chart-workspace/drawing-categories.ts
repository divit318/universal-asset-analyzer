import {
  TrendingUp,
  GitBranch,
  Minus,
  ArrowRight,
  Square,
  Percent,
  Target,
  Ruler,
  MoveUpRight,
  Type,
  MessageSquare,
  MousePointer2,
  Crosshair as CrosshairIcon,
  Paintbrush,
  type LucideIcon,
} from "lucide-react";
import type { DrawingCategory, DrawingToolId } from "./types";

export interface DrawingTool {
  id: DrawingToolId;
  label: string;
  icon: LucideIcon;
  /** One-line hint shown the first time this tool is selected. */
  hint: string;
}

export const CATEGORY_LABEL: Record<DrawingCategory, string> = {
  trend: "Trend",
  levels: "Levels & Zones",
  fibonacci: "Fibonacci",
  "trade-planning": "Trade Planning",
  annotations: "Annotations",
  utilities: "Utilities",
};

export const DRAWING_CATEGORIES: { category: DrawingCategory; tools: DrawingTool[] }[] = [
  {
    category: "trend",
    tools: [
      { id: "trend-line", label: "Trend Line", icon: TrendingUp, hint: "Click two points to define a trend." },
      { id: "parallel-channel", label: "Parallel Channel", icon: GitBranch, hint: "Click three points to set the channel width." },
      { id: "pitchfork", label: "Andrews Pitchfork", icon: GitBranch, hint: "Select three pivot points." },
    ],
  },
  {
    category: "levels",
    tools: [
      { id: "horizontal-line", label: "Horizontal Line", icon: Minus, hint: "Click once to place a level." },
      { id: "horizontal-ray", label: "Horizontal Ray", icon: ArrowRight, hint: "Click once to extend a level forward." },
      { id: "rectangle", label: "Support / Resistance Zone", icon: Square, hint: "Click two corners to define a zone." },
    ],
  },
  {
    category: "fibonacci",
    tools: [
      { id: "fib-retracement", label: "Fibonacci Retracement", icon: Percent, hint: "Select the swing low, then the swing high." },
      { id: "fib-extension", label: "Fibonacci Extension", icon: Percent, hint: "Select the swing low, then the swing high." },
    ],
  },
  {
    category: "trade-planning",
    tools: [
      { id: "risk-reward", label: "Risk / Reward Tool", icon: Target, hint: "Click entry, then stop-loss, then target." },
      { id: "measure", label: "Measure Tool", icon: Ruler, hint: "Click two points to measure the move between them." },
    ],
  },
  {
    category: "annotations",
    tools: [
      { id: "arrow", label: "Arrow", icon: MoveUpRight, hint: "Click the start, then the point to arrow at." },
      { id: "text", label: "Text", icon: Type, hint: "Click a point, then type your note." },
      { id: "callout", label: "Callout", icon: MessageSquare, hint: "Click a point, then type your note." },
    ],
  },
  {
    category: "utilities",
    tools: [
      { id: "cursor", label: "Cursor", icon: MousePointer2, hint: "Default pointer — click a drawing to select it." },
      { id: "crosshair", label: "Crosshair", icon: CrosshairIcon, hint: "Hover the chart to read exact price and time." },
      { id: "brush", label: "Brush", icon: Paintbrush, hint: "Click and drag to draw freehand." },
    ],
  },
];

/** Maps our UI-facing tool ids to the actual klinecharts overlay name to create. `null` = not an overlay (cursor/crosshair are interaction modes). */
export const TOOL_TO_OVERLAY_NAME: Record<DrawingToolId, string | null> = {
  "trend-line": "segment",
  "parallel-channel": "priceChannelLine",
  pitchfork: "pitchfork",
  "horizontal-line": "horizontalStraightLine",
  "horizontal-ray": "horizontalRayLine",
  rectangle: "rect",
  // klinecharts' built-in fibonacciLine is the standard 2-point retracement;
  // there's no separate built-in extension overlay, so both tools map to it
  // for Phase 1 — a distinct 3-point extension would need its own custom
  // overlay template, deferred as a follow-up.
  "fib-retracement": "fibonacciLine",
  "fib-extension": "fibonacciLine",
  "risk-reward": "risk-reward",
  measure: "measure",
  arrow: "arrow",
  text: "simpleAnnotation",
  callout: "simpleTag",
  cursor: null,
  crosshair: null,
  brush: "brush",
};

/** Every tool's human label, flattened out of DRAWING_CATEGORIES for O(1) lookup. */
export const DRAWING_TOOL_LABEL: Record<DrawingToolId, string> = Object.fromEntries(
  DRAWING_CATEGORIES.flatMap((c) => c.tools.map((t) => [t.id, t.label])),
) as Record<DrawingToolId, string>;

/**
 * Inverse of TOOL_TO_OVERLAY_NAME — resolves a klinecharts overlay's own
 * `.name` back to our UI-facing DrawingToolId, so the AI context builder can
 * label a selected/visible overlay without re-deriving this map itself.
 * First tool wins when two ids share an overlay name (fib-retracement and
 * fib-extension both map to "fibonacciLine") — fine here, since callers only
 * need "Fibonacci", not the sub-variant.
 */
export const OVERLAY_NAME_TO_TOOL_ID: Partial<Record<string, DrawingToolId>> = (() => {
  const out: Partial<Record<string, DrawingToolId>> = {};
  for (const [toolId, overlayName] of Object.entries(TOOL_TO_OVERLAY_NAME) as [DrawingToolId, string | null][]) {
    if (overlayName && !(overlayName in out)) out[overlayName] = toolId;
  }
  return out;
})();
