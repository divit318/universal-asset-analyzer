"use client";

import type { OpportunityCategory, Conviction, VolatilityTier } from "@/lib/opportunity-engine";
import { CATEGORY_LABELS } from "@/lib/opportunity-engine";
import type { SignalDirection } from "@/lib/types";

export interface OppFilterState {
  theme: string;
  category: OpportunityCategory | "all";
  conviction: Conviction | "all";
  risk: VolatilityTier | "all";
  minScore: number;
  direction: SignalDirection | "all";
  tier: "all" | "high_conviction" | "developing";
  portfolioOnly: boolean;
  watchlistOnly: boolean;
}

export const DEFAULT_OPP_FILTERS: OppFilterState = {
  theme: "all",
  category: "all",
  conviction: "all",
  risk: "all",
  minScore: 0,
  direction: "all",
  tier: "all",
  portfolioOnly: false,
  watchlistOnly: false,
};

function isActive(f: OppFilterState): boolean {
  return (
    f.theme !== "all" || f.category !== "all" || f.conviction !== "all" || f.risk !== "all" ||
    f.minScore > 0 || f.direction !== "all" || f.tier !== "all" || f.portfolioOnly || f.watchlistOnly
  );
}

export function OpportunityFilters({
  filters,
  themes,
  onChange,
}: {
  filters: OppFilterState;
  themes: string[];
  onChange: (patch: Partial<OppFilterState>) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">Theme</label>
        <select
          value={filters.theme}
          onChange={(e) => onChange({ theme: e.target.value })}
          className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
        >
          <option value="all">All themes</option>
          {themes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">Category</label>
        <select
          value={filters.category}
          onChange={(e) => onChange({ category: e.target.value as OppFilterState["category"] })}
          className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
        >
          <option value="all">All categories</option>
          {(Object.keys(CATEGORY_LABELS) as OpportunityCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">Conviction</label>
        <div className="flex gap-1">
          {(["all", "High", "Medium", "Low"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ conviction: c })}
              className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                filters.conviction === c ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">Risk</label>
        <div className="flex gap-1">
          {(["all", "Low", "Medium", "High"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange({ risk: r })}
              className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                filters.risk === r ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">
          Min score {filters.minScore}
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={filters.minScore}
          onChange={(e) => onChange({ minScore: Number(e.target.value) })}
          className="w-28 accent-accent"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">Tier</label>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onChange({ tier: "all" })}
            className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${filters.tier === "all" ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onChange({ tier: "high_conviction" })}
            className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${filters.tier === "high_conviction" ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}
          >
            High Conviction
          </button>
          <button
            type="button"
            onClick={() => onChange({ tier: "developing" })}
            className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${filters.tier === "developing" ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}
          >
            Emerging
          </button>
        </div>
      </div>

      <label className="flex items-center gap-1.5 pb-1.5 text-xs text-muted">
        <input type="checkbox" checked={filters.portfolioOnly} onChange={(e) => onChange({ portfolioOnly: e.target.checked })} className="accent-accent" />
        Portfolio only
      </label>
      <label className="flex items-center gap-1.5 pb-1.5 text-xs text-muted">
        <input type="checkbox" checked={filters.watchlistOnly} onChange={(e) => onChange({ watchlistOnly: e.target.checked })} className="accent-accent" />
        Watchlist only
      </label>

      {isActive(filters) && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_OPP_FILTERS)}
          className="ml-auto rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-negative/40 hover:text-negative"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
