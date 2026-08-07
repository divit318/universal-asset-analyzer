"use client";

import { useEffect, useState } from "react";
import type { GraphScope } from "@/lib/knowledge-graph";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { GICS_SECTORS } from "@/lib/gics-sectors";

const SCOPE_TABS: { value: GraphScope; label: string }[] = [
  { value: "symbol", label: "Symbol / ETF" },
  { value: "portfolio", label: "Portfolio" },
  { value: "watchlist", label: "Watchlist" },
  { value: "sector", label: "Sector" },
];

export function GraphScopeSwitcher({
  scope,
  id,
  onSelect,
}: {
  scope: GraphScope;
  id: string;
  onSelect: (scope: GraphScope, id: string) => void;
}) {
  const [symbolInput, setSymbolInput] = useState(scope === "symbol" ? id : "");

  // Keep the input in sync when the focus arrives via URL, back/forward, or a
  // node click — the box must always show the symbol the graph is showing.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (scope === "symbol") setSymbolInput(id);
  }, [scope, id]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="tablist" aria-label="Graph scope" className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={scope === tab.value}
            onClick={() => {
              if (tab.value === "portfolio" || tab.value === "watchlist") onSelect(tab.value, tab.value);
              else if (tab.value === "sector") onSelect("sector", GICS_SECTORS[0]);
              else onSelect("symbol", symbolInput || id);
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              scope === tab.value ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {scope === "symbol" && (
        <div className="w-64">
          <SymbolSearch
            value={symbolInput}
            onChange={setSymbolInput}
            onSelect={(s) => onSelect("symbol", s.toUpperCase())}
            placeholder="Ticker or company name"
          />
        </div>
      )}

      {scope === "sector" && (
        // One horizontally scrollable row on narrow viewports (three stacked
        // rows of chrome ate the content at 390px - KG-051); wraps at sm+.
        <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {GICS_SECTORS.map((sector) => (
            <button
              key={sector}
              type="button"
              aria-pressed={id === sector}
              onClick={() => onSelect("sector", sector)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                scope === "sector" && id === sector
                  ? "border-accent bg-accent/15 font-medium text-accent"
                  : "border-border text-muted hover:border-border/80 hover:text-foreground"
              }`}
            >
              {sector}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
