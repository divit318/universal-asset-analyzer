"use client";

/**
 * The applied screen, stated in one line, with every constraint removable.
 *
 * Until now the only way to know what a screen was actually filtering on was to
 * scroll ten collapsed accordion sections and look for populated inputs. That is
 * a genuine failure of a research tool: the *definition* of the screen is the
 * most important thing on the page, and it was the least visible. It also made
 * the classic mistake cheap — leaving a filter set from twenty minutes ago and
 * wondering why a universe looks small.
 *
 * Chips describe the **applied** screen, not the draft, for the same reason the
 * result count does: they answer "what produced these rows", not "what am I
 * midway through typing".
 */

import type { AssetClassId, FilterValues, SoftPreferences } from "@/lib/assets/types";
import { getMetric } from "@/lib/assets/registry";
import { formatMetricValue } from "@/lib/screener/format";

interface Props {
  assetClass: AssetClassId;
  filters: FilterValues;
  preferences: SoftPreferences;
  onRemoveFilter: (key: string) => void;
  onRemovePreference: (key: string) => void;
}

/** "ROIC ≥ 12%", "P/E top 25% of sector", "Sector: Technology or Energy". */
function describe(assetClass: AssetClassId, key: string, filter: FilterValues[string]): string | null {
  const metric = getMetric(assetClass, key);
  if (!metric) return null;
  const label = metric.label;

  switch (filter.kind) {
    case "range": {
      const frame = filter.frame ?? "absolute";
      if (frame !== "absolute") {
        // Percentiles read as "top N%", which is how the constraint was meant.
        const where = frame === "peer" ? "of peers" : "of class";
        if (filter.min != null && filter.max == null) return `${label} top ${100 - filter.min}% ${where}`;
        if (filter.max != null && filter.min == null) return `${label} bottom ${filter.max}% ${where}`;
        return `${label} ${filter.min ?? 0}–${filter.max ?? 100}pct ${where}`;
      }
      const lo = filter.min != null ? formatMetricValue(metric, filter.min) : null;
      const hi = filter.max != null ? formatMetricValue(metric, filter.max) : null;
      if (lo && hi) return `${label} ${lo}–${hi}`;
      if (lo) return `${label} ≥ ${lo}`;
      if (hi) return `${label} ≤ ${hi}`;
      return null;
    }
    case "select":
      return filter.value ? `${label}: ${filter.value}` : null;
    case "multiselect":
      return filter.values.length ? `${label}: ${filter.values.join(" or ")}` : null;
    case "boolean":
      return filter.value != null ? `${label}: ${filter.value ? "yes" : "no"}` : null;
  }
}

export function FilterChips({
  assetClass,
  filters,
  preferences,
  onRemoveFilter,
  onRemovePreference,
}: Props) {
  const chips = Object.entries(filters)
    .map(([key, filter]) => ({ key, text: describe(assetClass, key, filter) }))
    .filter((c): c is { key: string; text: string } => c.text != null);

  const prefs = Object.keys(preferences)
    .map((key) => ({ key, label: getMetric(assetClass, key)?.label }))
    .filter((p): p is { key: string; label: string } => Boolean(p.label));

  if (chips.length === 0 && prefs.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemoveFilter(chip.key)}
          title={`Remove: ${chip.text}`}
          className="group inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-negative/40 hover:text-fg"
        >
          <span>{chip.text}</span>
          <span className="text-muted/50 transition-colors group-hover:text-negative">×</span>
        </button>
      ))}

      {/* Preferences look different because they behave differently: they tilt
          the ranking rather than removing anything. */}
      {prefs.map((pref) => (
        <button
          key={pref.key}
          type="button"
          onClick={() => onRemovePreference(pref.key)}
          title={`Stop preferring better ${pref.label}`}
          className="group inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] text-brand transition-colors hover:border-brand/60"
        >
          <span>★ {pref.label}</span>
          <span className="text-brand/50 transition-colors group-hover:text-brand">×</span>
        </button>
      ))}
    </div>
  );
}
