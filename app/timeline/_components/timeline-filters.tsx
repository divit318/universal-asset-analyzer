"use client";

import type { TimelineEventCategory, TimelineImpact } from "@/lib/types";
import { categoryLabel } from "./category-label";

export interface FilterState {
  fromDate: string;
  toDate: string;
  categories: TimelineEventCategory[];
  minImportance: number;
  minConfidence: number;
  impact: TimelineImpact | "all";
  segment: string;
  metric: string;
  catalystOnly: boolean;
  openThesisOnly: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  fromDate: "",
  toDate: "",
  categories: [],
  minImportance: 0,
  minConfidence: 0,
  impact: "all",
  segment: "",
  metric: "",
  catalystOnly: false,
  openThesisOnly: false,
};

const ALL_CATEGORIES: TimelineEventCategory[] = [
  "earnings", "guidance", "product_launch", "acquisition", "divestiture",
  "ceo_change", "executive_departure", "share_buyback", "dividend",
  "regulatory_action", "lawsuit", "macro_event", "industry_event",
  "ai_developments", "partnership", "capacity_expansion", "margin_expansion",
  "margin_compression", "demand_shift", "competitive_threat",
  "analyst_upgrade", "analyst_downgrade", "insider_buying", "insider_selling",
  "valuation_inflection", "technical_breakout", "sector_rotation", "portfolio_impact",
];

const IMPACT_OPTIONS: { value: FilterState["impact"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "bullish", label: "Bullish" },
  { value: "bearish", label: "Bearish" },
  { value: "neutral", label: "Neutral" },
];

function isActive(filters: FilterState): boolean {
  return (
    filters.fromDate !== "" ||
    filters.toDate !== "" ||
    filters.categories.length > 0 ||
    filters.minImportance > 0 ||
    filters.minConfidence > 0 ||
    filters.impact !== "all" ||
    filters.segment !== "" ||
    filters.metric !== "" ||
    filters.catalystOnly ||
    filters.openThesisOnly
  );
}

export function TimelineFilterBar({
  filters,
  onChange,
}: {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
}) {
  function toggleCategory(cat: TimelineEventCategory) {
    const has = filters.categories.includes(cat);
    onChange({ categories: has ? filters.categories.filter((c) => c !== cat) : [...filters.categories, cat] });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">From</label>
          <input
            type="date"
            value={filters.fromDate}
            onChange={(e) => onChange({ fromDate: e.target.value })}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">To</label>
          <input
            type="date"
            value={filters.toDate}
            onChange={(e) => onChange({ toDate: e.target.value })}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">Impact</label>
          <div className="flex gap-1">
            {IMPACT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ impact: opt.value })}
                className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                  filters.impact === opt.value
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-border text-muted hover:border-border/80 hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">
            Min importance {filters.minImportance}
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minImportance}
            onChange={(e) => onChange({ minImportance: Number(e.target.value) })}
            className="w-32 accent-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">
            Min confidence {filters.minConfidence}
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minConfidence}
            onChange={(e) => onChange({ minConfidence: Number(e.target.value) })}
            className="w-32 accent-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium uppercase tracking-widest text-muted/60">Segment</label>
          <input
            value={filters.segment}
            onChange={(e) => onChange({ segment: e.target.value })}
            placeholder="e.g. Technology"
            className="w-32 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted/50 focus:border-accent"
          />
        </div>

        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.catalystOnly}
            onChange={(e) => onChange({ catalystOnly: e.target.checked })}
            className="accent-accent"
          />
          Catalysts only
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.openThesisOnly}
            onChange={(e) => onChange({ openThesisOnly: e.target.checked })}
            className="accent-accent"
          />
          Open thesis only
        </label>

        {isActive(filters) && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="ml-auto rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-negative/40 hover:text-negative"
          >
            Clear filters
          </button>
        )}
      </div>

      <details className="group">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-muted transition-colors hover:text-accent">
          <span className="group-open:hidden">+ Categories ({filters.categories.length || "all"})</span>
          <span className="hidden group-open:inline">− Categories</span>
        </summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                filters.categories.includes(cat)
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-border text-muted hover:border-border/80 hover:text-foreground"
              }`}
            >
              {categoryLabel(cat)}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
