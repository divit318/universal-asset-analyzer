"use client";

/**
 * The "Customize" popover — watchlist preferences, not an admin panel.
 *
 * Every change persists the moment it is made (there is nothing to "save"), and
 * the popover stays open so several changes read as one gesture. The page
 * re-renders behind it, which doubles as a live preview. Scope is deliberately
 * the five preferences that materially change the page — chips, default filter,
 * columns, default sort, two attention thresholds — defined and sanitized in
 * `lib/watchlist-settings.ts`.
 *
 * Chip ordering is explicit ↑/↓ rather than drag: a popover this small has no
 * room to make dragging discoverable, and a filter list has at most ten items.
 */

import { useEffect, useRef, useState } from "react";
import {
  BIG_MOVE_CHOICES,
  DEFAULT_WATCHLIST_SETTINGS,
  EARNINGS_HORIZON_CHOICES,
  FILTER_DESCRIPTION,
  FILTER_LABEL,
  HIDEABLE_COLUMNS,
  SORT_CHOICES,
  WATCHLIST_FILTERS,
  isDefaultSettings,
  type WatchlistFilter,
  type WatchlistViewSettings,
} from "@/lib/watchlist-settings";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-label font-semibold uppercase tracking-widest text-muted/60">{children}</p>
  );
}

/** A compact single-choice pill row (used for thresholds). */
function Choice<T extends string | number>({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  format: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-foreground/85">{label}</span>
      <div role="group" aria-label={label} className="flex gap-1">
        {options.map((opt) => (
          <button
            key={String(opt)}
            type="button"
            aria-pressed={value === opt}
            onClick={() => onChange(opt)}
            className={`rounded-control border px-2 py-0.5 text-[11px] transition-colors ${
              value === opt
                ? "border-brand/40 bg-brand/10 text-brand"
                : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {format(opt)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WatchlistSettings({
  settings,
  onChange,
}: {
  settings: WatchlistViewSettings;
  onChange: (next: WatchlistViewSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  /* Outside click / Escape dismissal — the same pattern the table's row menu
     uses (contains-check, not stopPropagation). */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const chips = settings.quickFilters;
  const configurable = WATCHLIST_FILTERS.filter((f) => f !== "all");

  const toggleFilter = (f: WatchlistFilter) => {
    const has = chips.includes(f);
    const next = has ? chips.filter((c) => c !== f) : [...chips, f];
    onChange({
      ...settings,
      quickFilters: next,
      // A default the user can no longer reach is a trap; fall back to All.
      defaultFilter: has && settings.defaultFilter === f ? "all" : settings.defaultFilter,
    });
  };

  const moveFilter = (f: WatchlistFilter, dir: -1 | 1) => {
    const order: WatchlistFilter[] = chips.filter((c) => c !== "all");
    const i = order.indexOf(f);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onChange({ ...settings, quickFilters: ["all", ...order] });
  };

  const toggleColumn = (key: string) => {
    const hidden = settings.hiddenColumns.includes(key)
      ? settings.hiddenColumns.filter((c) => c !== key)
      : [...settings.hiddenColumns, key];
    onChange({ ...settings, hiddenColumns: hidden });
  };

  const dirty = !isDefaultSettings(settings);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Customize filters, columns, default sort and attention thresholds. Changes apply immediately."
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
          open
            ? "border-brand/40 bg-brand/10 text-brand"
            : `border-border hover:bg-surface-2 hover:text-foreground ${dirty ? "text-foreground" : "text-muted"}`
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M2 4.5h8M13 4.5h1M2 11.5h1M6 11.5h8" />
          <circle cx="11" cy="4.5" r="1.75" />
          <circle cx="4" cy="11.5" r="1.75" />
        </svg>
        Customize
        {/* A quiet mark that the view is personalised, so a "missing" column is
            recognisable as a choice rather than a bug. */}
        {dirty && !open && <span aria-hidden="true" className="h-1 w-1 rounded-full bg-brand" />}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Watchlist preferences"
          className="absolute right-0 z-30 mt-2 flex w-80 flex-col gap-4 rounded-panel border border-border bg-surface p-4 shadow-popover"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">Watchlist preferences</p>
            {dirty && (
              <button
                type="button"
                onClick={() => onChange({ ...DEFAULT_WATCHLIST_SETTINGS, quickFilters: [...DEFAULT_WATCHLIST_SETTINGS.quickFilters], hiddenColumns: [] })}
                className="rounded-control text-[11px] text-muted transition-colors hover:text-brand hover:underline"
              >
                Reset to defaults
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Quick filters</SectionLabel>
            <ul className="flex flex-col">
              {configurable.map((f) => {
                const enabled = chips.includes(f);
                const order = chips.filter((c) => c !== "all");
                const idx = order.indexOf(f);
                return (
                  <li key={f} className="flex items-center gap-2 border-b border-hairline py-1 last:border-0">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleFilter(f)}
                        className="accent-[var(--brand)]"
                      />
                      <span className="text-xs text-foreground/90" title={FILTER_DESCRIPTION[f]}>
                        {FILTER_LABEL[f]}
                      </span>
                    </label>
                    {enabled && (
                      <span className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          aria-label={`Move ${FILTER_LABEL[f]} earlier`}
                          disabled={idx <= 0}
                          onClick={() => moveFilter(f, -1)}
                          className="rounded-control px-1 text-[10px] text-muted transition-colors hover:text-foreground disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${FILTER_LABEL[f]} later`}
                          disabled={idx < 0 || idx >= order.length - 1}
                          onClick={() => moveFilter(f, 1)}
                          className="rounded-control px-1 text-[10px] text-muted transition-colors hover:text-foreground disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs text-foreground/85">Open on</span>
              <select
                value={settings.defaultFilter}
                onChange={(e) => onChange({ ...settings, defaultFilter: e.target.value as WatchlistFilter })}
                className="rounded-control border border-border bg-surface-2 px-2 py-1 text-xs outline-none focus:border-brand"
              >
                {chips.map((f) => (
                  <option key={f} value={f}>
                    {FILTER_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Columns</SectionLabel>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {HIDEABLE_COLUMNS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!settings.hiddenColumns.includes(c.key)}
                    onChange={() => toggleColumn(c.key)}
                    className="accent-[var(--brand)]"
                  />
                  <span className="text-xs text-foreground/90">{c.label}</span>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-muted/60">
              Symbol, price and today&apos;s move always show. Narrow screens hide some columns regardless.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Sort</SectionLabel>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs text-foreground/85">Default order</span>
              <select
                value={settings.defaultSortKey}
                onChange={(e) => onChange({ ...settings, defaultSortKey: e.target.value })}
                className="rounded-control border border-border bg-surface-2 px-2 py-1 text-xs outline-none focus:border-brand"
              >
                {SORT_CHOICES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[10px] text-muted/60">Clicking a column header still overrides this any time.</p>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Attention</SectionLabel>
            <Choice
              label="Earnings horizon"
              options={EARNINGS_HORIZON_CHOICES}
              value={settings.earningsHorizonDays as (typeof EARNINGS_HORIZON_CHOICES)[number]}
              format={(v) => `${v}d`}
              onChange={(v) => onChange({ ...settings, earningsHorizonDays: v })}
            />
            <Choice
              label="Big move is ±"
              options={BIG_MOVE_CHOICES}
              value={settings.bigMovePct as (typeof BIG_MOVE_CHOICES)[number]}
              format={(v) => `${v}%`}
              onChange={(v) => onChange({ ...settings, bigMovePct: v })}
            />
            <p className="text-[10px] text-muted/60">
              These feed &ldquo;Needs attention&rdquo; and the Earnings soon filter. Target and alert rules are not
              configurable — a crossed level always counts.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
