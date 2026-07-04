"use client";

import { useState } from "react";
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              if (tab.value === "portfolio" || tab.value === "watchlist") onSelect(tab.value, tab.value);
              else if (tab.value === "sector") onSelect("sector", GICS_SECTORS[0]);
              else onSelect("symbol", symbolInput || id);
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              scope === tab.value ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {scope === "symbol" && (
        <SymbolSearch value={symbolInput} onChange={setSymbolInput} onSelect={(s) => onSelect("symbol", s.toUpperCase())} />
      )}

      {scope === "sector" && (
        <div className="flex flex-wrap gap-1.5">
          {GICS_SECTORS.map((sector) => (
            <button
              key={sector}
              type="button"
              onClick={() => onSelect("sector", sector)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                scope === "sector" && id === sector
                  ? "border-accent/50 bg-accent/10 text-accent"
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
