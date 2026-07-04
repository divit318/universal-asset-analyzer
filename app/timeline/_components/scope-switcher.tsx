"use client";

import { useState } from "react";
import type { TimelineScope } from "@/lib/types";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { GICS_SECTORS as SECTORS } from "@/lib/gics-sectors";

const SCOPE_TABS: { value: TimelineScope; label: string }[] = [
  { value: "symbol", label: "Symbol / ETF" },
  { value: "portfolio", label: "Portfolio" },
  { value: "watchlist", label: "Watchlist" },
  { value: "sector", label: "Sector" },
];

export function ScopeSwitcher({
  scope,
  id,
  onSelect,
}: {
  scope: TimelineScope;
  id: string;
  onSelect: (scope: TimelineScope, id: string) => void;
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
              else if (tab.value === "sector") onSelect("sector", SECTORS[0]);
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
          {SECTORS.map((sector) => (
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

      {scope === "portfolio" && (
        <p className="text-xs text-muted">Aggregated across your current portfolio holdings.</p>
      )}
      {scope === "watchlist" && (
        <p className="text-xs text-muted">Aggregated across your current watchlist.</p>
      )}
    </div>
  );
}
