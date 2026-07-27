"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Cross-component "focus mode" — the single piece of shared state that lets
 * every independent widget on the Compare page (cards, chart lines, radar
 * polygons, AI verdict rows) react to "which asset is the user looking at
 * right now" without wiring props through every layer.
 *
 * Deliberately scoped: only ever ≤5 symbols are compared at once, so this
 * context has at most a handful of consumers (cards, one chart, one radar,
 * one verdict list, a few table headers) — never per-table-cell, which is
 * where a naive version of this pattern would start costing real render
 * time on a 40-row metric table. See class-compare-view.tsx / page.tsx for
 * where this is (and isn't) wired in.
 */
interface HoverSymbolContextValue {
  hovered: string | null;
  setHovered: (symbol: string | null) => void;
}

const HoverSymbolContext = createContext<HoverSymbolContextValue>({
  hovered: null,
  setHovered: () => {},
});

export function HoverSymbolProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
  return <HoverSymbolContext.Provider value={value}>{children}</HoverSymbolContext.Provider>;
}

export function useHoverSymbol(): HoverSymbolContextValue {
  return useContext(HoverSymbolContext);
}

export type SymbolEmphasis = "none" | "active" | "dimmed";

/** "none" when nothing is hovered, "active" for the hovered symbol itself, "dimmed" for every other symbol. */
export function useSymbolEmphasis(symbol: string): SymbolEmphasis {
  const { hovered } = useHoverSymbol();
  if (hovered == null) return "none";
  return hovered === symbol ? "active" : "dimmed";
}

/** Spread onto any element that should set the hovered symbol on enter/leave. */
export function useHoverHandlers(symbol: string): { onMouseEnter: () => void; onMouseLeave: () => void } {
  const { setHovered } = useHoverSymbol();
  return {
    onMouseEnter: () => setHovered(symbol),
    onMouseLeave: () => setHovered(null),
  };
}

/** Tailwind classes for the common "brighten when active, dim when a sibling is active" pattern. */
export function emphasisClassName(emphasis: SymbolEmphasis): string {
  if (emphasis === "dimmed") return "opacity-90 saturate-[0.85] transition-[opacity,filter,transform] duration-200 ease-out";
  if (emphasis === "active") return "opacity-100 saturate-100 transition-[opacity,filter,transform] duration-200 ease-out";
  return "transition-[opacity,filter,transform] duration-200 ease-out";
}
