"use client";

/**
 * The filter renderer. One component, seven asset classes — it reads the filter
 * groups out of the Asset Registry and renders whatever it finds, so switching
 * asset class swaps the entire filter set with no code path of its own.
 *
 * The "Not screenable yet" section at the bottom is the deliberate, visible
 * half of the honesty model: rather than quietly omitting TVL from a crypto
 * screen (leaving a user to wonder whether we forgot it or they missed it), the
 * metric is listed, greyed, and states exactly which provider it would need. A
 * data gap you can see is a roadmap; one you can't is a bug.
 */

import { useState } from "react";
import { getFilterGroups, unavailableMetrics } from "@/lib/assets/registry";
import type { AssetClassId, FilterDef } from "@/lib/assets/types";
import { Card } from "@/app/_components/ui";
import type { Draft, DraftValue } from "./filter-state";
import { isActiveDraft } from "./filter-state";

interface Props {
  assetClass: AssetClassId;
  draft: Draft;
  onChange: (key: string, value: DraftValue | undefined) => void;
}

const UNIT_SUFFIX: Record<string, string> = {
  "%": "%",
  x: "×",
  $: "$",
  $B: "$B",
  yrs: "yrs",
  bps: "bps",
  score: "/100",
  "": "",
};

function RangeFilter({
  filter,
  value,
  onChange,
}: {
  filter: FilterDef;
  value: DraftValue | undefined;
  onChange: (v: DraftValue | undefined) => void;
}) {
  const range = value?.kind === "range" ? value : { kind: "range" as const, min: "", max: "" };
  const suffix = UNIT_SUFFIX[filter.unit] ?? "";

  const set = (part: "min" | "max", raw: string) => {
    const next: DraftValue = { kind: "range", min: range.min, max: range.max, [part]: raw };
    onChange(next.min === "" && next.max === "" ? undefined : next);
  };

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label className="flex-1 text-xs text-muted" title={filter.description}>
        {filter.label}
        {suffix ? <span className="ml-1 text-[10px] opacity-60">{suffix}</span> : null}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step={filter.step}
          value={range.min}
          onChange={(e) => set("min", e.target.value)}
          placeholder="min"
          aria-label={`${filter.label} minimum`}
          className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs outline-none placeholder:text-muted/60 focus:border-brand"
        />
        <span className="text-[10px] text-muted">–</span>
        <input
          type="number"
          inputMode="decimal"
          step={filter.step}
          value={range.max}
          onChange={(e) => set("max", e.target.value)}
          placeholder="max"
          aria-label={`${filter.label} maximum`}
          className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs outline-none placeholder:text-muted/60 focus:border-brand"
        />
      </div>
    </div>
  );
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

export function FilterPanel({ assetClass, draft, onChange }: Props) {
  const groups = getFilterGroups(assetClass);
  const gaps = unavailableMetrics(assetClass);

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
            These matter for {assetClass === "crypto" ? "tokens" : "this asset class"}, but no data provider
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
