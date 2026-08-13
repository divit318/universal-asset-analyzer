"use client";

/**
 * The filter renderer. One component, every screening universe — it reads the
 * filter groups out of the Asset Registry and renders whatever it finds, so
 * switching universe swaps the entire filter set with no code path of its own.
 *
 * The "Not screenable yet" section at the bottom is the deliberate, visible
 * half of the honesty model: rather than quietly omitting TVL from a crypto
 * screen (leaving a user to wonder whether we forgot it or they missed it), the
 * metric is listed, greyed, and states exactly which provider it would need. A
 * data gap you can see is a roadmap; one you can't is a bug.
 */

import { useState } from "react";
import { getAssetClass, getFilterGroups, getMetric, unavailableMetrics } from "@/lib/assets/registry";
import type { AssetClassId, FilterDef, FilterFrame, MetricDef } from "@/lib/assets/types";
import { Card } from "@/app/_components/ui";
import { DistributionBar } from "./distribution-bar";
import type { MetricDistribution } from "@/lib/screener/universe-stats";
import type { Draft, DraftValue } from "./filter-state";
import { isActiveDraft } from "./filter-state";

interface Props {
  assetClass: AssetClassId;
  draft: Draft;
  onChange: (key: string, value: DraftValue | undefined) => void;
  /** Metric key → weight. Ranked toward rather than filtered on. */
  preferences: Record<string, number>;
  onTogglePreference: (key: string) => void;
  /** Per-metric universe distributions, fetched once per asset class. */
  distributions: Record<string, MetricDistribution> | null;
}

const UNIT_SUFFIX: Record<string, string> = {
  "%": "%",
  x: "×",
  $: "$",
  $B: "$B",
  "₹Cr": "₹Cr",
  pp: "pp",
  yrs: "yrs",
  bps: "bps",
  score: "/100",
  "": "",
};

/**
 * The frame cycle: absolute → vs class → vs peer group → absolute.
 *
 * A cycling button rather than a dropdown per filter. There are forty filters on
 * the equity class; forty select elements would dominate the panel visually to
 * express a choice that is "absolute" nine times out of ten. The button only
 * announces itself once you've moved it off the default.
 */
const FRAME_ORDER: FilterFrame[] = ["absolute", "class", "peer"];

/*
 * Glyphs, not words. "abs"/"%cls"/"%peer" cost 44px of a ~300px sidebar row and
 * squeezed the filter labels down to "Ove…", "Val…", "Qua…" — a control that
 * makes the thing it controls unreadable is a net loss. The state is still fully
 * legible: the button is tinted whenever it's off the default, and framed filters
 * carry a line of explanatory text underneath.
 */
const FRAME_LABEL: Record<FilterFrame, string> = {
  absolute: "#",
  class: "%",
  peer: "≈",
};

// "class" is the frame's internal id (lib/assets/types.ts FilterFrame); the
// percentiles behind it are computed per screening UNIVERSE (universe-stats),
// so the copy says universe — accurate for India Equities as much as Bonds.
const FRAME_HELP: Record<FilterFrame, string> = {
  absolute: "Absolute values. Click to compare against the whole universe instead.",
  class: "Percentile against every asset in this universe — 100 is best. Click for peer group.",
  peer: "Percentile against this asset's own peer group (sector, issuer type…). Click for absolute.",
};

function RangeFilter({
  filter,
  value,
  peerGroupLabel,
  preferred,
  metric,
  distribution,
  onTogglePreference,
  onChange,
}: {
  filter: FilterDef;
  value: DraftValue | undefined;
  peerGroupLabel: string | null;
  preferred: boolean;
  metric: MetricDef | null;
  distribution: MetricDistribution | null;
  onTogglePreference: () => void;
  onChange: (v: DraftValue | undefined) => void;
}) {
  const range = value?.kind === "range" ? value : { kind: "range" as const, min: "", max: "" };
  const frame = (range.kind === "range" ? range.frame : undefined) ?? "absolute";
  const framed = frame !== "absolute";
  // A percentile has no unit, so the metric's own suffix would be a lie.
  const suffix = framed ? "pct" : (UNIT_SUFFIX[filter.unit] ?? "");

  const patch = (next: Partial<Extract<DraftValue, { kind: "range" }>>) => {
    const merged: DraftValue = { kind: "range", min: range.min, max: range.max, frame, ...next };
    const empty = merged.kind === "range" && merged.min === "" && merged.max === "";
    onChange(empty && (next.frame ?? frame) === "absolute" ? undefined : merged);
  };

  const cycleFrame = () => {
    const available = peerGroupLabel ? FRAME_ORDER : FRAME_ORDER.filter((f) => f !== "peer");
    patch({ frame: available[(available.indexOf(frame) + 1) % available.length] });
  };

  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="min-w-0 flex-1 truncate text-xs text-muted" title={filter.description}>
          {filter.label}
          {suffix ? <span className="ml-1 text-[10px] opacity-60">{suffix}</span> : null}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            step={framed ? 5 : filter.step}
            value={range.min}
            onChange={(e) => patch({ min: e.target.value })}
            placeholder="min"
            aria-label={`${filter.label} minimum`}
            className="w-[3.4rem] rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs outline-none placeholder:text-muted/60 focus:border-brand"
          />
          <span className="text-[10px] text-muted">–</span>
          <input
            type="number"
            inputMode="decimal"
            step={framed ? 5 : filter.step}
            value={range.max}
            onChange={(e) => patch({ max: e.target.value })}
            placeholder="max"
            aria-label={`${filter.label} maximum`}
            className="w-[3.4rem] rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs outline-none placeholder:text-muted/60 focus:border-brand"
          />
          <button
            type="button"
            onClick={cycleFrame}
            title={FRAME_HELP[frame]}
            aria-label={`${filter.label} comparison frame: ${frame}`}
            className={`w-6 shrink-0 rounded-md border py-1 text-center text-[11px] font-semibold leading-none transition-colors ${
              framed
                ? "border-brand/40 bg-brand/10 text-brand"
                : "border-border bg-surface-2 text-muted/70 hover:text-fg"
            }`}
          >
            {FRAME_LABEL[frame]}
          </button>
          {/*
            * Soft preference. Beside every numeric filter because "I'd rather have
            * more of this" and "reject anything below this" answer the same
            * question, and being forced into the second when you mean the first is
            * what makes screens come back empty.
            */}
          <button
            type="button"
            onClick={onTogglePreference}
            title={
              preferred
                ? `Preferring better ${filter.label} in the ranking. Click to stop.`
                : `Prefer better ${filter.label} — ranks it up without excluding anything.`
            }
            aria-pressed={preferred}
            aria-label={`Prefer better ${filter.label}`}
            className={`w-5 shrink-0 rounded-md border py-1 text-center text-[10px] leading-none transition-colors ${
              preferred
                ? "border-brand/40 bg-brand/10 text-brand"
                : "border-transparent text-muted/30 hover:border-border hover:text-muted"
            }`}
          >
            ★
          </button>
        </div>
      </div>

      {framed ? (
        <p className="text-[10px] leading-tight text-muted/70">
          {frame === "peer"
            ? `Percentile within its own ${peerGroupLabel} · 100 = best`
            : "Percentile across the whole class · 100 = best"}
        </p>
      ) : null}

      {/*
        * Shown once this filter is in play, not for all forty at rest. A sidebar
        * of forty histograms is wallpaper; one histogram under the filter you are
        * actually setting is an instrument.
        */}
      {distribution && metric && (range.min !== "" || range.max !== "") ? (
        <DistributionBar
          distribution={distribution}
          metric={metric}
          min={parseBound(range.min, framed ? 1 : (metric.scale ?? 1))}
          max={parseBound(range.max, framed ? 1 : (metric.scale ?? 1))}
          framed={framed}
        />
      ) : null}
    </div>
  );
}

/** Input string → the metric's storage units, so bounds line up with the histogram. */
function parseBound(raw: string, scale: number): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n * scale : null;
}

function MultiselectFilter({
  filter,
  value,
  onChange,
}: {
  filter: FilterDef;
  value: DraftValue | undefined;
  onChange: (v: DraftValue | undefined) => void;
}) {
  const selected = value?.kind === "multiselect" ? value.values : [];

  const toggle = (option: string) => {
    const next = selected.includes(option)
      ? selected.filter((v) => v !== option)
      : [...selected, option];
    onChange(next.length ? { kind: "multiselect", values: next } : undefined);
  };

  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <span className="text-xs text-muted" title={filter.description}>
        {filter.label}
      </span>
      <div className="flex flex-wrap gap-1">
        {(filter.options ?? []).map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              aria-pressed={active}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                active
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-border bg-surface-2 text-muted hover:border-brand/50"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FilterPanel({
  assetClass,
  draft,
  onChange,
  preferences,
  onTogglePreference,
  distributions,
}: Props) {
  const groups = getFilterGroups(assetClass);
  const gaps = unavailableMetrics(assetClass);
  /*
   * Human-readable name for this class's peer grouping, used in the frame
   * button's copy. Absent for classes with no meaningful sub-grouping (forex),
   * where the peer frame is hidden rather than offered as a no-op.
   */
  const peerKey = getAssetClass(assetClass).peerGroupBy;
  const peerGroupLabel = peerKey
    ? (getMetric(assetClass, peerKey)?.label ?? peerKey).toLowerCase()
    : null;

  // Open the groups that have something set, plus the first two by default —
  // switching asset class shouldn't dump forty collapsed sections on the user.
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 2).map((g) => g.group)));

  const toggle = (group: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ group, filters }) => {
        const activeCount = filters.filter((f) => isActiveDraft(draft[f.key])).length;
        const isOpen = open.has(group) || activeCount > 0;

        return (
          <Card key={group} className="p-0">
            <button
              type="button"
              onClick={() => toggle(group)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {group}
                {activeCount > 0 ? (
                  <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                    {activeCount}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted">{isOpen ? "−" : "+"}</span>
            </button>

            {isOpen ? (
              <div className="border-t border-border px-4 py-2">
                {filters.map((filter) =>
                  filter.kind === "multiselect" ? (
                    <MultiselectFilter
                      key={filter.key}
                      filter={filter}
                      value={draft[filter.key]}
                      onChange={(v) => onChange(filter.key, v)}
                    />
                  ) : (
                    <RangeFilter
                      key={filter.key}
                      filter={filter}
                      value={draft[filter.key]}
                      peerGroupLabel={peerGroupLabel}
                      preferred={Boolean(preferences[filter.key])}
                      metric={getMetric(assetClass, filter.key)}
                      distribution={distributions?.[filter.key] ?? null}
                      onTogglePreference={() => onTogglePreference(filter.key)}
                      onChange={(v) => onChange(filter.key, v)}
                    />
                  ),

                )}
              </div>
            ) : null}
          </Card>
        );
      })}

      {gaps.length > 0 ? (
        <Card className="p-4">
          <p className="text-sm font-medium">Not screenable yet</p>
          <p className="mt-1 text-xs text-muted">
            These matter for {getAssetClass(assetClass).noun}, but no data provider
            is wired up for them. They are listed rather than hidden — a filter with no data behind it would
            match nothing and look like an empty result.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {gaps.map((m) => (
              <li key={m.key} className="text-xs">
                <span className="font-medium text-muted">{m.label}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted/70">{m.requires}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
