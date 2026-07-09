"use client";

/**
 * Intelligence layer — the single source of truth shared by the Graph and
 * Timeline views under /intelligence, which now sit behind the primary
 * Mission Control dashboard as secondary "explore" destinations.
 *
 * Graph and Timeline used an identical `{ scope, id }` shape (`GraphScope`/
 * `TimelineScope` are the same union), so this context lifts that shared
 * concept up one level instead of duplicating it — no scoring/business
 * logic lives here, only UI focus state that the existing view components
 * already knew how to consume.
 *
 * A third view, Opportunity Map, used to share this context too; it was
 * retired (zero analytical content beyond Scanner's own opportunity list —
 * see lib/mission-control.ts, which absorbs its value via rankByFit()
 * instead of a bubble/quadrant re-visualization). Its underlying data
 * function (lib/opportunity-map.ts) is kept — it still feeds Research's
 * "Related Opportunities" card and the AI copilot's context — only the
 * dedicated view is gone.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { GraphScope } from "@/lib/knowledge-graph";

export type IntelligenceView = "graph" | "timeline";

export interface IntelligenceFocus {
  scope: GraphScope;
  id: string;
}

interface IntelligenceContextValue {
  view: IntelligenceView;
  setView: (view: IntelligenceView) => void;
  focus: IntelligenceFocus;
  setFocus: (focus: IntelligenceFocus) => void;
  /** Convenience: jump straight to a view with a new focus in one call (used for cross-view links). */
  navigate: (view: IntelligenceView, focus: IntelligenceFocus) => void;
  selectedTheme: string | null;
  setSelectedTheme: (theme: string | null) => void;
}

const IntelligenceContext = createContext<IntelligenceContextValue | null>(null);

export function IntelligenceProvider({
  initialView,
  initialFocus,
  onStateChange,
  children,
}: {
  initialView?: IntelligenceView;
  initialFocus?: IntelligenceFocus;
  /** Fired whenever view/focus changes — used by the page to sync the URL. */
  onStateChange?: (state: { view: IntelligenceView; focus: IntelligenceFocus }) => void;
  children: ReactNode;
}) {
  const [view, setViewState] = useState<IntelligenceView>(initialView ?? "graph");
  const [focus, setFocusState] = useState<IntelligenceFocus>(initialFocus ?? { scope: "symbol", id: "AAPL" });
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

  const setView = useCallback(
    (nextView: IntelligenceView) => {
      setViewState(nextView);
      onStateChange?.({ view: nextView, focus });
    },
    [focus, onStateChange],
  );

  const setFocus = useCallback(
    (nextFocus: IntelligenceFocus) => {
      setFocusState(nextFocus);
      onStateChange?.({ view, focus: nextFocus });
    },
    [view, onStateChange],
  );

  const navigate = useCallback(
    (nextView: IntelligenceView, nextFocus: IntelligenceFocus) => {
      setViewState(nextView);
      setFocusState(nextFocus);
      onStateChange?.({ view: nextView, focus: nextFocus });
    },
    [onStateChange],
  );

  const value = useMemo(
    () => ({ view, setView, focus, setFocus, navigate, selectedTheme, setSelectedTheme }),
    [view, setView, focus, setFocus, navigate, selectedTheme],
  );

  return <IntelligenceContext.Provider value={value}>{children}</IntelligenceContext.Provider>;
}

export function useIntelligence(): IntelligenceContextValue {
  const ctx = useContext(IntelligenceContext);
  if (!ctx) throw new Error("useIntelligence must be used within an IntelligenceProvider");
  return ctx;
}
